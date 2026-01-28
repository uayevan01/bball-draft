from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.draft_types import router as draft_types_router
from app.routers.drafts import router as drafts_router
from app.routers.games import router as games_router
from app.routers.health import router as health_router
from app.routers.me import router as me_router
from app.routers.players import router as players_router
from app.routers.teams import router as teams_router
from app.websocket.draft_ws import router as ws_router


def create_app() -> FastAPI:
    app = FastAPI(title="NBA Draft App API")

    allow_origins = [o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()]
    # In local dev, Next may run on 3000, 3001, etc. Allow any localhost port to prevent
    # opaque "Failed to fetch" errors caused by CORS.
    allow_origin_regex = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$" if settings.app_env.lower() == "dev" else None
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_origin_regex=allow_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router, prefix=settings.api_prefix)
    app.include_router(me_router, prefix=settings.api_prefix)
    app.include_router(teams_router, prefix=settings.api_prefix)
    app.include_router(players_router, prefix=settings.api_prefix)
    app.include_router(draft_types_router, prefix=settings.api_prefix)
    app.include_router(drafts_router, prefix=settings.api_prefix)
    app.include_router(games_router, prefix=settings.api_prefix)
    app.include_router(ws_router)
    return app


app = create_app()



