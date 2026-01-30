# BBall Draft

Real-time NBA-themed “draft lobby” app for running fun constraint-based drafts with a friend.

## What it does

- **Draft lobbies** with invite links and a live pick history.
- **WebSocket realtime** updates: rolls, constraints, picks, and “selected player” previews sync across clients.
- **Rule-driven constraints** per pick:
  - Year (decades/ranges)
  - Team (including franchise history segments)
  - Name-letter (first/last/either) with optional minimum viable players
- **Rerolls** with a per-player limit.
- **Player search** can be restricted to only eligible players for the current constraint.

## Repo layout

- `frontend/`: Next.js app (UI)
- `backend/`: FastAPI + SQLAlchemy (REST + WebSockets)
- `docker-compose.yml`: local Postgres + backend container

## Local development

### Prereqs

- Docker Desktop
- Node.js (for `frontend/`)
- Python 3.12 (optional, only needed if you want to run Alembic/seed scripts on the host)

### 1) Start backend + Postgres

From repo root:

```bash
docker compose up --build
```

Health check:

```bash
curl http://localhost:8000/api/health
```

### 2) Run database migrations

In a separate terminal:

```bash
cd backend
python -m alembic -c alembic.ini upgrade head
```

### 3) (Optional) Seed data

```bash
cd backend
python -m app.scraper.seed --teams
python -m app.scraper.seed --drafts 1980 1985
```

### 4) Start the frontend

```bash
cd frontend
cp env.example .env.local
# Fill in Clerk keys (and any other envs referenced by env.example)
npm install
npm run dev
```

Open:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000/api/health`

## Notes

- **WebSockets**: the frontend connects to `ws://localhost:8000/ws/draft/<draft_id_or_public_id>?role=host|guest` in dev.
- **Auth**: the frontend uses Clerk; ensure your local `.env.local` is configured.
