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
) -> User:
    existing = (await db.execute(select(User).where(User.clerk_id == clerk_id))).scalar_one_or_none()
    if existing:
        changed = False
        if email and existing.email != email:
            existing.email = email
            changed = True
        if username and existing.username != username:
            existing.username = username
            changed = True
        if changed:
            await db.commit()
            await db.refresh(existing)
        return existing

    user = User(clerk_id=clerk_id, email=email, username=username)
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

    # If Clerk isn't configured locally, allow dev auth to work even if the frontend sends a token.
    if is_dev and settings.auth_optional_in_dev and not settings.clerk_jwks_url:
        return await _get_or_create_user(db, clerk_id="dev_user", email=None, username="Dev User")

    if not authorization or not authorization.lower().startswith("bearer "):
        if is_dev and settings.auth_optional_in_dev:
            return await _get_or_create_user(db, clerk_id="dev_user", email=None, username="Dev User")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as e:
        if is_dev and settings.auth_optional_in_dev:
            return await _get_or_create_user(db, clerk_id="dev_user", email=None, username="Dev User")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token header") from e

    kid = unverified_header.get("kid")
    if not kid:
        if is_dev and settings.auth_optional_in_dev:
            return await _get_or_create_user(db, clerk_id="dev_user", email=None, username="Dev User")
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
            return await _get_or_create_user(db, clerk_id="dev_user", email=None, username="Dev User")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from e

    clerk_id = payload.get("sub")
    if not clerk_id:
        if is_dev and settings.auth_optional_in_dev:
            return await _get_or_create_user(db, clerk_id="dev_user", email=None, username="Dev User")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")

    email = payload.get("email") or payload.get("primary_email") or None
    username = payload.get("username") or payload.get("preferred_username") or None
    return await _get_or_create_user(db, clerk_id=clerk_id, email=email, username=username)


