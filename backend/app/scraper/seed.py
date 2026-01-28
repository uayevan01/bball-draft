from __future__ import annotations

import argparse
import asyncio
from collections.abc import Sequence
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.config import settings
from app.models import Player, PlayerTeamStint, Team
from app.scraper.basketball_reference import scrape_all_players_index, scrape_drafts, scrape_teams
from app.scraper.basketball_reference import scrape_player_team_seasons, seasons_to_stints


TEAM_METADATA: dict[str, dict[str, str]] = {
    # East
    "BOS": {"conference": "East", "division": "Atlantic"},
    "BKN": {"conference": "East", "division": "Atlantic"},
    "NYK": {"conference": "East", "division": "Atlantic"},
    "PHI": {"conference": "East", "division": "Atlantic"},
    "TOR": {"conference": "East", "division": "Atlantic"},
    "CHI": {"conference": "East", "division": "Central"},
    "CLE": {"conference": "East", "division": "Central"},
    "DET": {"conference": "East", "division": "Central"},
    "IND": {"conference": "East", "division": "Central"},
    "MIL": {"conference": "East", "division": "Central"},
    "ATL": {"conference": "East", "division": "Southeast"},
    "CHA": {"conference": "East", "division": "Southeast"},
    "MIA": {"conference": "East", "division": "Southeast"},
    "ORL": {"conference": "East", "division": "Southeast"},
    "WAS": {"conference": "East", "division": "Southeast"},
    # West
    "DEN": {"conference": "West", "division": "Northwest"},
    "MIN": {"conference": "West", "division": "Northwest"},
    "OKC": {"conference": "West", "division": "Northwest"},
    "POR": {"conference": "West", "division": "Northwest"},
    "UTA": {"conference": "West", "division": "Northwest"},
    "GSW": {"conference": "West", "division": "Pacific"},
    "LAC": {"conference": "West", "division": "Pacific"},
    "LAL": {"conference": "West", "division": "Pacific"},
    "PHX": {"conference": "West", "division": "Pacific"},
    "SAC": {"conference": "West", "division": "Pacific"},
    "DAL": {"conference": "West", "division": "Southwest"},
    "HOU": {"conference": "West", "division": "Southwest"},
    "MEM": {"conference": "West", "division": "Southwest"},
    "NOP": {"conference": "West", "division": "Southwest"},
    "SAS": {"conference": "West", "division": "Southwest"},
}

ABBR_ALIASES: dict[str, str] = {
    # Basketball Reference uses some different 3-letter codes than common NBA shorthand.
    "BRK": "BKN",
    "CHO": "CHA",
    "PHO": "PHX",
}


# Minimal historical team identity list (separate rows) + lineage via previous_team_id.
# Note: conference/division is often time-varying historically; we store a best-effort snapshot.
TEAM_HISTORY: list[dict] = [
    # Relocations / renames (common modern ones)
    {
        "abbreviation": "SEA",
        "name": "Seattle SuperSonics",
        "city": "Seattle",
        "founded_year": 1967,
        "dissolved_year": 2008,
        "conference": "West",
        "division": "Northwest",
        "previous_abbreviation": None,
    },
    {
        "abbreviation": "OKC",
        "name": "Oklahoma City Thunder",
        "city": "Oklahoma City",
        "founded_year": 2008,
        "dissolved_year": None,
        "conference": "West",
        "division": "Northwest",
        "previous_abbreviation": "SEA",
    },
    {
        "abbreviation": "VAN",
        "name": "Vancouver Grizzlies",
        "city": "Vancouver",
        "founded_year": 1995,
        "dissolved_year": 2001,
        "conference": "West",
        "division": "Midwest",
        "previous_abbreviation": None,
    },
    {
        "abbreviation": "MEM",
        "name": "Memphis Grizzlies",
        "city": "Memphis",
        "founded_year": 2001,
        "dissolved_year": None,
        "conference": "West",
        "division": "Southwest",
        "previous_abbreviation": "VAN",
    },
    {
        "abbreviation": "NOH",
        "name": "New Orleans Hornets",
        "city": "New Orleans",
        "founded_year": 2002,
        "dissolved_year": 2013,
        "conference": "West",
        "division": "Southwest",
        "previous_abbreviation": None,
    },
    {
        "abbreviation": "NOP",
        "name": "New Orleans Pelicans",
        "city": "New Orleans",
        "founded_year": 2013,
        "dissolved_year": None,
        "conference": "West",
        "division": "Southwest",
        "previous_abbreviation": "NOH",
    },
    {
        "abbreviation": "NJN",
        "name": "New Jersey Nets",
        "city": "New Jersey",
        "founded_year": 1977,
        "dissolved_year": 2012,
        "conference": "East",
        "division": "Atlantic",
        "previous_abbreviation": None,
    },
    {
        "abbreviation": "BKN",
        "name": "Brooklyn Nets",
        "city": "Brooklyn",
        "founded_year": 2012,
        "dissolved_year": None,
        "conference": "East",
        "division": "Atlantic",
        "previous_abbreviation": "NJN",
    },
    {
        "abbreviation": "BUF",
        "name": "Buffalo Braves",
        "city": "Buffalo",
        "founded_year": 1970,
        "dissolved_year": 1978,
        "conference": "West",
        "division": "Pacific",
        "previous_abbreviation": None,
    },
    {
        "abbreviation": "LAC",
        "name": "Los Angeles Clippers",
        "city": "Los Angeles",
        "founded_year": 1984,
        "dissolved_year": None,
        "conference": "West",
        "division": "Pacific",
        "previous_abbreviation": "SDC",
    },
    {
        "abbreviation": "SDC",
        "name": "San Diego Clippers",
        "city": "San Diego",
        "founded_year": 1978,
        "dissolved_year": 1984,
        "conference": "West",
        "division": "Pacific",
        "previous_abbreviation": "BUF",
    },
]


async def upsert_teams() -> int:
    team_rows = await scrape_teams()
    # Avoid duplicate abbreviations within the same INSERT statement (Postgres will error even with ON CONFLICT).
    by_abbr: dict[str, dict] = {}
    for t in team_rows:
        if not t.abbreviation:
            continue
        abbr = ABBR_ALIASES.get(t.abbreviation.upper(), t.abbreviation.upper())
        meta = TEAM_METADATA.get(abbr, {})
        by_abbr[abbr] = {
            "name": t.name,
            "city": t.city,
            "abbreviation": abbr,
            "founded_year": t.founded_year,
            "dissolved_year": t.dissolved_year,
            "conference": meta.get("conference"),
            "division": meta.get("division"),
        }

    # Add curated historical identities (separate rows) + ensure current teams have conference/division.
    for h in TEAM_HISTORY:
        abbr = ABBR_ALIASES.get(str(h["abbreviation"]).upper(), str(h["abbreviation"]).upper())
        by_abbr[abbr] = {
            "name": h["name"],
            "city": h.get("city"),
            "abbreviation": abbr,
            "founded_year": h.get("founded_year"),
            "dissolved_year": h.get("dissolved_year"),
            "conference": h.get("conference"),
            "division": h.get("division"),
        }

    values = list(by_abbr.values())
    if not values:
        return 0

    stmt = insert(Team).values(values)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_teams_abbreviation",
        set_={
            "name": stmt.excluded.name,
            "city": stmt.excluded.city,
            "founded_year": stmt.excluded.founded_year,
            "dissolved_year": stmt.excluded.dissolved_year,
            "conference": stmt.excluded.conference,
            "division": stmt.excluded.division,
        },
    )

    async with SessionLocal() as session:
        await session.execute(stmt)
        # Link previous_team_id for our curated chain entries
        abbr_to_id = await _team_abbr_map(session)
        for h in TEAM_HISTORY:
            prev = h.get("previous_abbreviation")
            if not prev:
                continue
            team_abbr = ABBR_ALIASES.get(str(h["abbreviation"]).upper(), str(h["abbreviation"]).upper())
            prev_abbr = ABBR_ALIASES.get(str(prev).upper(), str(prev).upper())
            team_id = abbr_to_id.get(team_abbr)
            prev_id = abbr_to_id.get(prev_abbr)
            if team_id and prev_id:
                await session.execute(update(Team).where(Team.id == team_id).values(previous_team_id=prev_id))
        await session.commit()
    return len(values)


async def _team_abbr_map(session) -> dict[str, int]:
    rows = (await session.execute(select(Team.id, Team.abbreviation))).all()
    out: dict[str, int] = {}
    for team_id, abbr in rows:
        if abbr:
            out[abbr.upper()] = team_id
    return out


def _chunk(seq: Sequence, n: int) -> list[Sequence]:
    return [seq[i : i + n] for i in range(0, len(seq), n)]


async def upsert_players_from_drafts(start_year: int, end_year: int) -> int:
    draft_rows = await scrape_drafts(start_year, end_year)
    if not draft_rows:
        return 0

    async with SessionLocal() as session:
        abbr_to_team_id = await _team_abbr_map(session)

        values = []
        for r in draft_rows:
            team_id = None
            if r.team_abbreviation:
                abbr = ABBR_ALIASES.get(r.team_abbreviation.upper(), r.team_abbreviation.upper())
                team_id = abbr_to_team_id.get(abbr)

            values.append(
                {
                    "name": r.name,
                    "draft_year": r.draft_year,
                    "draft_round": r.draft_round,
                    "draft_pick": r.draft_pick,
                    "team_id": team_id,
                    "position": r.position,
                }
            )

        # Upsert in chunks to keep statements manageable.
        total = 0
        for batch in _chunk(values, 2000):
            stmt = insert(Player).values(batch)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_players_name_year_pick",
                set_={
                    "draft_round": stmt.excluded.draft_round,
                    "team_id": stmt.excluded.team_id,
                    "position": stmt.excluded.position,
                },
            )
            await session.execute(stmt)
            total += len(batch)

        await session.commit()
        return total


async def upsert_all_players_from_index(concurrency: int = 4) -> int:
    """
    Inserts/updates all players (drafted + undrafted) using Basketball Reference A–Z index pages.

    - `bref_id` is the stable upsert key.
    - `position` is stored if present.
    - `retirement_year` is treated as a best-effort "last season year" (None for active).
    """
    rows = await scrape_all_players_index(concurrency=concurrency)
    if not rows:
        return 0

    values = []
    for r in rows:
        # Treat year_max as last season year; keep None if still active.
        retirement_year = None
        if r.year_max and r.year_max < 2100:
            retirement_year = r.year_max
        values.append(
            {
                "bref_id": r.bref_id,
                "name": r.name,
                "position": r.position,
                "retirement_year": retirement_year,
            }
        )

    async with SessionLocal() as session:
        total = 0
        for batch in _chunk(values, 2000):
            stmt = insert(Player).values(batch)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_players_bref_id",
                set_={
                    "name": stmt.excluded.name,
                    "position": stmt.excluded.position,
                    "retirement_year": stmt.excluded.retirement_year,
                },
            )
            await session.execute(stmt)
            total += len(batch)
        await session.commit()
        return total


async def upsert_player_team_stints(
    concurrency: int = 3,
    limit: int | None = None,
    *,
    bref_id: str | None = None,
    force: bool = False,
    commit_every_players: int = 10,
) -> int:
    """
    Populate PlayerTeamStint rows by scraping each player's BRef page and computing contiguous team ranges.
    """
    # Optional progress bar (falls back to simple prints if tqdm isn't installed)
    try:
        from tqdm.auto import tqdm  # type: ignore[import-not-found]
    except ImportError:  # pragma: no cover
        tqdm = None  # type: ignore

    print(f"[player-stints] using DATABASE_URL={settings.database_url}")

    async with SessionLocal() as session:
        abbr_to_team_id = await _team_abbr_map(session)

        # Resume by default: only process players we haven't attempted yet.
        stmt = select(Player.id, Player.bref_id).where(Player.bref_id.is_not(None))
        if bref_id:
            stmt = stmt.where(Player.bref_id == bref_id)
        elif not force:
            stmt = stmt.where(Player.stints_scraped_at.is_(None))
        stmt = stmt.order_by(Player.id.asc())
        if limit:
            stmt = stmt.limit(limit)
        rows = (await session.execute(stmt)).all()

        sem = asyncio.Semaphore(max(1, concurrency))

        async def _one(player_id: int, bref_id: str) -> list[dict]:
            async with sem:
                seasons = await scrape_player_team_seasons(bref_id)
                stints = seasons_to_stints(bref_id, seasons)
                out: list[dict] = []
                for s in stints:
                    abbr = ABBR_ALIASES.get(s.team_abbreviation.upper(), s.team_abbreviation.upper())
                    team_id = abbr_to_team_id.get(abbr)
                    if not team_id:
                        # Team not present in DB; skip for now.
                        continue
                    out.append(
                        {
                            "player_id": player_id,
                            "team_id": team_id,
                            "start_year": s.start_year,
                            "end_year": s.end_year,
                        }
                    )
                return out

        total_processed_players = 0
        total_inserted_stints = 0
        total_players = len(rows)

        bar = (
            tqdm(total=total_players, desc="Player stints", unit="player", dynamic_ncols=True) if tqdm else None
        )

        # Incremental commit so you can restart safely.
        batch_values: list[dict] = []
        batch_player_ids: list[int] = []
        commit_every_players = max(1, commit_every_players)

        errors = 0
        for i, (player_id, bref_id) in enumerate(rows, 1):
            if not bref_id:
                continue
            try:
                batch_values.extend(await _one(player_id, bref_id))
                batch_player_ids.append(player_id)
            except Exception as e:  # pylint: disable=broad-exception-caught
                errors += 1
                # Leave stints_scraped_at NULL so you can retry later.
                if not bar:
                    print(f"Error on player_id={player_id} bref_id={bref_id}: {type(e).__name__}")

            if bar:
                bar.update(1)
            else:
                if i == 1 or i % 25 == 0 or i == total_players:
                    print(f"Processed {i}/{total_players} players…")

            if len(batch_player_ids) >= commit_every_players:
                if batch_values:
                    stmt_ins = insert(PlayerTeamStint).values(batch_values)
                    stmt_ins = stmt_ins.on_conflict_do_update(
                        constraint="uq_player_team_stints_player_team_start",
                        set_={"end_year": stmt_ins.excluded.end_year},
                    )
                    await session.execute(stmt_ins)
                    total_inserted_stints += len(batch_values)
                # Mark players as attempted (even if they had 0 stints); this enables true resume.
                await session.execute(
                    update(Player)
                    .where(Player.id.in_(batch_player_ids))
                    .values(stints_scraped_at=datetime.now(timezone.utc))
                )
                await session.commit()
                total_processed_players += len(batch_player_ids)
                batch_values.clear()
                batch_player_ids.clear()

        # Flush tail
        if batch_player_ids:
            if batch_values:
                stmt_ins = insert(PlayerTeamStint).values(batch_values)
                stmt_ins = stmt_ins.on_conflict_do_update(
                    constraint="uq_player_team_stints_player_team_start",
                    set_={"end_year": stmt_ins.excluded.end_year},
                )
                await session.execute(stmt_ins)
                total_inserted_stints += len(batch_values)
            await session.execute(
                update(Player)
                .where(Player.id.in_(batch_player_ids))
                .values(stints_scraped_at=datetime.now(timezone.utc))
            )
            await session.commit()
            total_processed_players += len(batch_player_ids)

        if bar:
            bar.close()
        if errors and not bar:
            print(f"Done with {errors} errors. Re-run to retry failed players.")
        print(
            f"[player-stints] processed_players={total_processed_players} inserted_stints~={total_inserted_stints}"
        )
        return total_inserted_stints


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Teams/Players from Basketball Reference.")
    parser.add_argument("--teams", action="store_true", help="Scrape and upsert Teams")
    parser.add_argument("--drafts", nargs=2, type=int, metavar=("START_YEAR", "END_YEAR"), help="Scrape drafts and upsert Players")
    parser.add_argument("--all-players", action="store_true", help="Scrape ALL players A–Z (drafted + undrafted) and upsert by bref_id")
    parser.add_argument("--player-stints", action="store_true", help="Scrape player pages and populate player_team_stints")
    parser.add_argument("--concurrency", type=int, default=4, help="Concurrency for web scraping (default: 4)")
    parser.add_argument("--limit", type=int, default=None, help="Optional limit (for testing) for certain seed modes")
    parser.add_argument("--bref-id", type=str, default=None, help="Only process one player by bref_id (e.g. jamesle01)")
    parser.add_argument("--force", action="store_true", help="Reprocess even if stints_scraped_at is set (dangerous)")
    parser.add_argument("--commit-every", type=int, default=10, help="Commit after N successful players (default: 10)")
    args = parser.parse_args()

    async def _run() -> None:
        if args.teams:
            n = await upsert_teams()
            print(f"Upserted teams: {n}")
        if args.drafts:
            start_year, end_year = args.drafts
            n = await upsert_players_from_drafts(start_year, end_year)
            print(f"Upserted draft rows (players): {n}")
        if args.all_players:
            n = await upsert_all_players_from_index(concurrency=args.concurrency)
            print(f"Upserted players (A–Z index): {n}")
        if args.player_stints:
            n = await upsert_player_team_stints(
                concurrency=args.concurrency,
                limit=args.limit,
                bref_id=args.bref_id,
                force=args.force,
                commit_every_players=args.commit_every,
            )
            print(f"Inserted player team stints (approx): {n}")

    asyncio.run(_run())


if __name__ == "__main__":
    main()



