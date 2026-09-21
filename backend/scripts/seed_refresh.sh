#!/usr/bin/env sh
# Periodic Basketball Reference refresh for Fly scheduled Machines.
# Upserts by stable keys (bref_id / abbreviation); does not recreate player IDs.
#
# Env knobs:
#   SEED_STALE_DAYS   — re-scrape players with *_scraped_at older than N days (default: 14)
#   SEED_DRAFT_START  — draft scrape start year (default: 1947)
#   SEED_DRAFT_END    — draft scrape end year (default: current UTC year)
#   SEED_CONCURRENCY  — scraper concurrency (default: 3)
set -eu

STALE_DAYS="${SEED_STALE_DAYS:-14}"
DRAFT_START="${SEED_DRAFT_START:-1947}"
DRAFT_END="${SEED_DRAFT_END:-$(date -u +%Y)}"
CONCURRENCY="${SEED_CONCURRENCY:-3}"

echo "[seed_refresh] stale_days=${STALE_DAYS} drafts=${DRAFT_START}-${DRAFT_END} concurrency=${CONCURRENCY}"

exec python -m app.scraper.seed \
  --teams \
  --all-players \
  --drafts "${DRAFT_START}" "${DRAFT_END}" \
  --player-stints \
  --player-stats \
  --player-awards \
  --stale-days "${STALE_DAYS}" \
  --concurrency "${CONCURRENCY}"
