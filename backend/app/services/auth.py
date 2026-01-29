from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User


@dataclass
class _JwksCache:
    jwks: dict[str, Any] | None = None
    fetched_at: float = 0.0
    ttl_seconds: float = 60.0 * 10

    def fresh(self) -> bool:
        return self.jwks is not None and (time.time() - self.fetched_at) < self.ttl_seconds


_jwks_cache = _JwksCache()


async def _get_jwks() -> dict[str, Any]:
    if _jwks_cache.fresh():
        return _jwks_cache.jwks or {}

    if not settings.clerk_jwks_url:
        raise RuntimeError("CLERK_JWKS_URL is not configured.")

    async with httpx.AsyncClient(headers={"User-Agent": "nba-draft-app/1.0"}) as client:
        resp = await client.get(settings.clerk_jwks_url, timeout=20)
        resp.raise_for_status()
        jwks = resp.json()

    _jwks_cache.jwks = jwks
    _jwks_cache.fetched_at = time.time()
    return jwks


async def _get_or_create_user(
    db: AsyncSession,
    *,
    clerk_id: str,
    email: str | None,
    username: str | None,
    full_name: str | None,
) -> User:
    existing = (await db.execute(select(User).where(User.clerk_id == clerk_id))).scalar_one_or_none()
    if existing:
        changed = False
        if email and existing.email != email:
            existing.email = email
            changed = True
        # Only set username from auth claims if the user hasn't chosen one yet.
        if username and (not existing.username or not existing.username.strip()):
            existing.username = username
            changed = True
        if full_name and existing.full_name != full_name:
            existing.full_name = full_name
            changed = True
        if changed:
            await db.commit()
            await db.refresh(existing)
        return existing

    user = User(clerk_id=clerk_id, email=email, username=username, full_name=full_name)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def get_current_user(
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> User:
    """
    Validates Clerk JWT if present. In dev, can fall back to a deterministic dev user.
    """
    is_dev = settings.app_env.lower() == "dev"

    def _claims_to_identity(payload: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
        clerk_id = payload.get("sub")
        email = payload.get("email") or payload.get("primary_email") or None
        full_name = payload.get("name") or payload.get("full_name") or None
        if not full_name:
            given = payload.get("given_name") or payload.get("first_name")
            family = payload.get("family_name") or payload.get("last_name")
            if given and family:
                full_name = f"{given} {family}"
            elif given:
                full_name = str(given)
        username = payload.get("username") or payload.get("preferred_username") or None
        return clerk_id, email, (username or full_name)

    async def _dev_user_from_token(token: str) -> User:
        """
        Dev-only: create/lookup a stable backend user from an unverified Clerk token.
        This prevents refreshes from "turning into" dev_user and breaking host/guest identity.
        """
        try:
            payload = jwt.decode(token, options={"verify_signature": False, "verify_aud": False, "verify_iss": False})
        except jwt.PyJWTError:
            return await _get_or_create_user(db, clerk_id="dev_user", email=None, username="dev_user", full_name="Dev User")
        clerk_id, email, username = _claims_to_identity(payload)
        if not clerk_id:
            return await _get_or_create_user(db, clerk_id="dev_user", email=None, username="dev_user", full_name="Dev User")
        # In dev, if Clerk doesn't provide username, use a stable-ish fallback derived from email/full_name.
        full_name = payload.get("name") or payload.get("full_name") or None
        return await _get_or_create_user(db, clerk_id=clerk_id, email=email, username=username, full_name=full_name)

    # If Clerk JWKS isn't configured locally, still allow per-user identity in dev by decoding the token unverified.
    if is_dev and settings.auth_optional_in_dev and not settings.clerk_jwks_url:
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization.split(" ", 1)[1].strip()
            return await _dev_user_from_token(token)
        return await _get_or_create_user(db, clerk_id="dev_user", email=None, username="dev_user", full_name="Dev User")

    if not authorization or not authorization.lower().startswith("bearer "):
        if is_dev and settings.auth_optional_in_dev:
            return await _get_or_create_user(db, clerk_id="dev_user", email=None, username="dev_user", full_name="Dev User")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as e:
        if is_dev and settings.auth_optional_in_dev:
            return await _dev_user_from_token(token)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token header") from e

    kid = unverified_header.get("kid")
    if not kid:
        if is_dev and settings.auth_optional_in_dev:
            return await _dev_user_from_token(token)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing kid")

    try:
        jwks = await _get_jwks()
        keys = jwks.get("keys") or []
        jwk = next((k for k in keys if k.get("kid") == kid), None)
        if not jwk:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown signing key")

        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(jwk)
        payload = jwt.decode(
            token,
            public_key,
            algorithms=[unverified_header.get("alg", "RS256")],
            issuer=settings.clerk_issuer if settings.clerk_issuer else None,
            options={"verify_aud": False},
        )
    except (jwt.PyJWTError, HTTPException) as e:
        if is_dev and settings.auth_optional_in_dev:
            return await _dev_user_from_token(token)
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from e

    clerk_id = payload.get("sub")
    if not clerk_id:
        if is_dev and settings.auth_optional_in_dev:
            return await _dev_user_from_token(token)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")

    email = payload.get("email") or payload.get("primary_email") or None
    # Try to derive a reasonable initial username + full name from common claim shapes.
    full_name = payload.get("name") or payload.get("full_name") or None
    if not full_name:
        given = payload.get("given_name") or payload.get("first_name")
        family = payload.get("family_name") or payload.get("last_name")
        if given and family:
            full_name = f"{given} {family}"
        elif given:
            full_name = str(given)

    username = payload.get("username") or payload.get("preferred_username") or None
    return await _get_or_create_user(db, clerk_id=clerk_id, email=email, username=username, full_name=full_name)


