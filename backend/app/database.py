from __future__ import annotations

from collections.abc import AsyncGenerator

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings


def _normalize_async_database_url(url: str) -> str:
    """
    Fly/Neon often provide DATABASE_URL as:
      - postgres://...
      - postgresql://...
    For SQLAlchemy async runtime we must use an async driver, e.g. postgresql+asyncpg://...
    """
    u = (url or "").strip()
    if not u:
        return u

    # Normalize scheme -> asyncpg driver.
    if u.startswith("postgres://"):
        u = "postgresql+asyncpg://" + u[len("postgres://") :]
    elif u.startswith("postgresql://") and "+asyncpg" not in u and "+psycopg" not in u:
        u = "postgresql+asyncpg://" + u[len("postgresql://") :]

    # asyncpg.connect() does NOT accept sslmode=..., but many hosted Postgres URLs include it
    # (e.g. Neon: ?sslmode=require). SQLAlchemy's asyncpg dialect passes query params through
    # to asyncpg.connect(), causing: TypeError: connect() got an unexpected keyword argument 'sslmode'
    #
    # Fix: drop sslmode and translate it into asyncpg's `ssl` argument.
    # asyncpg accepts `ssl` as a string mode: disable/allow/prefer/require/verify-ca/verify-full.
    try:
        parts = urlsplit(u)
        params = dict(parse_qsl(parts.query, keep_blank_values=True))
        sslmode = params.pop("sslmode", None)
        if sslmode:
            mode = sslmode.lower()
            # Map common postgres sslmodes to asyncpg ssl modes.
            if mode in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
                params.setdefault("ssl", mode)
        new_query = urlencode(params, doseq=True)
        u = urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))
    except Exception:
        # Best-effort: if parsing fails, keep the URL as-is.
        return u

    return u


def create_engine() -> AsyncEngine:
    return create_async_engine(
        _normalize_async_database_url(settings.database_url),
        pool_pre_ping=True,
    )


engine = create_engine()
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session



