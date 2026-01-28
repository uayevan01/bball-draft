from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore", case_sensitive=False)

    app_env: str = Field(default="dev", validation_alias="APP_ENV")
    api_prefix: str = Field(default="/api", validation_alias="API_PREFIX")

    # Prefer async for runtime. Alembic env will convert this to a sync URL when migrating.
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/nba_draft",
        validation_alias="DATABASE_URL",
    )

    cors_allow_origins: str = Field(default="http://localhost:3000", validation_alias="CORS_ALLOW_ORIGINS")

    # Clerk
    clerk_issuer: str | None = Field(default=None, validation_alias="CLERK_ISSUER")  # e.g. https://clerk.yourdomain.com
    clerk_jwks_url: str | None = Field(
        default=None, validation_alias="CLERK_JWKS_URL"
    )  # e.g. https://clerk.yourdomain.com/.well-known/jwks.json
    auth_optional_in_dev: bool = Field(default=True, validation_alias="AUTH_OPTIONAL_IN_DEV")


settings = Settings()


