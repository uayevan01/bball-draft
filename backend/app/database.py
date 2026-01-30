from __future__ import annotations

from collections.abc import AsyncGenerator

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
    if u.startswith("postgres://"):
        return "postgresql+asyncpg://" + u[len("postgres://") :]
    if u.startswith("postgresql://") and "+asyncpg" not in u and "+psycopg" not in u:
        return "postgresql+asyncpg://" + u[len("postgresql://") :]
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



