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
    app_env = settings.app_env.lower()
    allow_origin_regex = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$" if app_env == "dev" else None
    # Production safety-net: if you forgot to set CORS_ALLOW_ORIGINS on Fly/Vercel,
    # allow Vercel preview/prod domains so the app isn't bricked by CORS.
    #
    # You can (and should) still set CORS_ALLOW_ORIGINS to your exact prod domain(s) for stricter control.
    if app_env != "dev" and not allow_origins and not allow_origin_regex:
        allow_origin_regex = r"^https://.*\.vercel\.app$"
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_origin_regex=allow_origin_regex,
        # Frontend uses Authorization bearer tokens, not cookies, so credentials aren't needed.
        # Keeping this false avoids the common "CORS + credentials" footguns.
        allow_credentials=False,
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



