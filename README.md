# BBall Draft

## Local development

### Backend + Postgres (Docker)

From repo root:

```bash
docker compose up --build
```

Health check:

```bash
curl http://localhost:8000/api/health
```

### Migrations (recommended)

In a separate terminal:

```bash
cd backend
/Users/uayevan/NBA-draft-app/.venv/bin/python -m alembic -c alembic.ini upgrade head
```

### Seed data (optional)

```bash
cd backend
/Users/uayevan/NBA-draft-app/.venv/bin/python -m app.scraper.seed --teams
/Users/uayevan/NBA-draft-app/.venv/bin/python -m app.scraper.seed --drafts 1980 1985
```

### Seed ALL players (drafted + undrafted)

This uses Basketball Reference A–Z player index pages and upserts by a stable `bref_id`.

1) Apply the latest migrations (includes `players.bref_id`):

```bash
cd backend
/Users/uayevan/NBA-draft-app/.venv/bin/python -m alembic -c alembic.ini upgrade head
```

2) Run the all-players seed (this can take a while):

```bash
cd backend
/Users/uayevan/NBA-draft-app/.venv/bin/python -m app.scraper.seed --all-players --concurrency 3
```

### Frontend

```bash
cd frontend
cp env.example .env.local
# Fill Clerk keys in .env.local
npm run dev
```

Open:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000/api/health`

## Deployment (Vercel + Railway)

- **Frontend (Vercel)**: set `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_WS_BASE_URL` to your Railway backend URL, plus Clerk env vars.
- **Backend (Railway)**: set `DATABASE_URL`, `CORS_ALLOW_ORIGINS` to your Vercel domain, plus `CLERK_ISSUER` and `CLERK_JWKS_URL`.


