from __future__ import annotations

import argparse
import asyncio
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone

from sqlalchemy import ColumnElement, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.config import settings
from app.models import Award, Player, PlayerAward, PlayerSeasonStat, PlayerTeamStint, Season, Team
from app.scraper.basketball_reference import scrape_all_players_index, scrape_drafts, scrape_teams, scrape_team_logo
from app.scraper.basketball_reference import scrape_player_team_seasons, scrape_player_stats_and_awards, seasons_to_stints

try:
    from tqdm.auto import tqdm  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    tqdm = None  # type: ignore

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
    # Historical / temporary abbreviations (used by BRef player season tables)
    "WSB": {"conference": "East", "division": "Southeast"},  # Washington Bullets
    "NOK": {"conference": "West", "division": "Southwest"},  # New Orleans/Oklahoma City Hornets
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
    # Wizards historical identity (BRef uses WSB for many seasons in the 70s–90s)
    {
        "abbreviation": "WSB",
        "name": "Washington Bullets",
        "city": "Washington",
        # Best-effort range: Bullets name used for decades; exact start varies with earlier Baltimore/Capital eras.
        "founded_year": 1973,
        "dissolved_year": 1997,
        "conference": "East",
        "division": "Southeast",
        "previous_abbreviation": None,
    },
    {
        "abbreviation": "WAS",
        "name": "Washington Wizards",
        "city": "Washington",
        "founded_year": 1997,
        "dissolved_year": None,
        "conference": "East",
        "division": "Southeast",
        "previous_abbreviation": "WSB",
    },

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
    # Temporary relocation (Hurricane Katrina): BRef uses NOK for those seasons, so we need a separate identity row.
    {
        "abbreviation": "NOK",
        "name": "New Orleans/Oklahoma City Hornets",
        "city": "New Orleans / Oklahoma City",
        "founded_year": 2005,
        "dissolved_year": 2007,
        "conference": "West",
        "division": "Southwest",
        "previous_abbreviation": "NOH",
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


async def upsert_teams(*, with_logos: bool = False) -> int:
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
            "logo_url": None,
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
            "logo_url": None,
        }

    if with_logos:
        # One extra request per team; keep the global BRef throttle in mind.
        it = tqdm(by_abbr.items(), total=len(by_abbr), desc="Team logos", unit="team", dynamic_ncols=True) if tqdm else by_abbr.items()
        for abbr, row in it:
            try:
                row["logo_url"] = await scrape_team_logo(abbr)
            except Exception:
                row["logo_url"] = None

    values = list(by_abbr.values())
    if not values:
        return 0

    stmt = insert(Team).values(values)
    set_fields = {
        "name": stmt.excluded.name,
        "city": stmt.excluded.city,
        "founded_year": stmt.excluded.founded_year,
        "dissolved_year": stmt.excluded.dissolved_year,
        "conference": stmt.excluded.conference,
        "division": stmt.excluded.division,
    }
    # Important: only overwrite logo_url when we explicitly scraped logos, otherwise a plain --teams run would wipe them.
    if with_logos:
        set_fields["logo_url"] = stmt.excluded.logo_url
    stmt = stmt.on_conflict_do_update(
        constraint="uq_teams_abbreviation",
        set_=set_fields,
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


def _stale_cutoff(stale_days: int | None) -> datetime | None:
    if stale_days is None:
        return None
    if stale_days < 1:
        raise ValueError("--stale-days must be >= 1")
    return datetime.now(timezone.utc) - timedelta(days=stale_days)


def _needs_scrape(*columns, cutoff: datetime | None) -> ColumnElement[bool]:
    """True when any timestamp is NULL, or (if cutoff set) older than cutoff."""
    conditions = [col.is_(None) for col in columns]
    if cutoff is not None:
        conditions.extend(col < cutoff for col in columns)
    return or_(*conditions)


async def upsert_players_from_drafts(start_year: int, end_year: int) -> int:
    """
    Scrape NBA draft tables and merge draft_year / round / pick / drafted team onto players.

    Matches by bref_id from the player link on the draft page (not name+year), so this
    updates the same rows created by --all-players instead of creating orphans.
    """
    draft_rows = await scrape_drafts(start_year, end_year)
    if not draft_rows:
        return 0

    async with SessionLocal() as session:
        abbr_to_team_id = await _team_abbr_map(session)

        # Career-start was previously used as a stand-in draft year. Clear those so
        # anyone not present in the draft tables correctly shows as Undrafted.
        await session.execute(
            update(Player)
            .where(Player.draft_pick.is_(None))
            .values(draft_year=None, draft_round=None)
        )

        values: list[dict] = []
        skipped_no_bref = 0
        it = (
            tqdm(draft_rows, total=len(draft_rows), desc="Draft rows", unit="row", dynamic_ncols=True)
            if tqdm
            else draft_rows
        )
        for r in it:
            if not r.bref_id:
                skipped_no_bref += 1
                continue
            team_id = None
            if r.team_abbreviation:
                abbr = ABBR_ALIASES.get(r.team_abbreviation.upper(), r.team_abbreviation.upper())
                team_id = abbr_to_team_id.get(abbr)

            values.append(
                {
                    "bref_id": r.bref_id,
                    "name": r.name,
                    "draft_year": r.draft_year,
                    "draft_round": r.draft_round,
                    "draft_pick": r.draft_pick,
                    "team_id": team_id,
                    "position": r.position,
                }
            )

        # One player can appear once per draft; if a bref_id somehow repeats, last wins.
        by_bref: dict[str, dict] = {}
        for row in values:
            by_bref[row["bref_id"]] = row
        values = list(by_bref.values())

        total = 0
        for batch in _chunk(values, 2000):
            stmt = insert(Player).values(batch)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_players_bref_id",
                set_={
                    "draft_year": stmt.excluded.draft_year,
                    "draft_round": stmt.excluded.draft_round,
                    "draft_pick": stmt.excluded.draft_pick,
                    "team_id": stmt.excluded.team_id,
                    # Keep existing position when the draft table omits it.
                    "position": func.coalesce(stmt.excluded.position, Player.position),
                },
            )
            await session.execute(stmt)
            total += len(batch)

        await session.commit()
        if skipped_no_bref:
            print(f"[drafts] skipped {skipped_no_bref} rows with no player bref_id link")
        return total


async def upsert_all_players_from_index(concurrency: int = 4) -> int:
    """
    Inserts/updates all players (drafted + undrafted) using Basketball Reference A–Z index pages.

    - `bref_id` is the stable upsert key.
    - `position` is stored if present.
    - BRef index From/To columns use season **end** years (e.g. 2004 = 2003-04).
      We convert to season **start** years for career_start_year / retirement_year.
    - Does not set draft_year (use --drafts for real draft info; null = Undrafted).
    """
    rows = await scrape_all_players_index(concurrency=concurrency)
    if not rows:
        return 0

    current_year = datetime.now(timezone.utc).year
    values = []
    it = tqdm(rows, total=len(rows), desc="Players (A–Z)", unit="player", dynamic_ncols=True) if tqdm else rows
    for r in it:
        # BRef year_min/year_max are end years of first/last season → convert to start years.
        career_start_year = (r.year_min - 1) if r.year_min else None
        retirement_year = None
        if r.year_max and r.year_max < current_year:
            retirement_year = r.year_max - 1
        values.append(
            {
                "bref_id": r.bref_id,
                "name": r.name,
                "position": r.position,
                "career_start_year": career_start_year,
                "retirement_year": retirement_year,
                "hall_of_fame": bool(getattr(r, "hall_of_fame", False)),
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
                    "career_start_year": stmt.excluded.career_start_year,
                    "retirement_year": stmt.excluded.retirement_year,
                    "hall_of_fame": stmt.excluded.hall_of_fame,
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
    stale_days: int | None = None,
    commit_every_players: int = 10,
) -> int:
    """
    Populate PlayerTeamStint rows by scraping each player's BRef page and computing contiguous team ranges.

    Without --force: only players missing stints/image timestamps (resume), plus any whose
    timestamps are older than --stale-days when that flag is set.
    """
    print(f"[player-stints] using DATABASE_URL={settings.database_url}")
    cutoff = None if force else _stale_cutoff(stale_days)
    if cutoff is not None:
        print(f"[player-stints] refreshing scrapes older than {stale_days} day(s) (before {cutoff.isoformat()})")

    async with SessionLocal() as session:
        # Backfill: for retired players, a NULL stint end_year should never exist
        # (otherwise UI/eligibility treats them as active forever).
        # This is safe because only the final stint would have end_year NULL.
        await backfill_retired_stint_end_years(session)
        abbr_to_team_id = await _team_abbr_map(session)

        # Resume by default:
        # - process players we haven't attempted stints for
        # - OR players we haven't attempted image scraping for
        # - OR (with --stale-days) players whose scrape timestamps are older than the cutoff
        stmt = select(Player.id, Player.bref_id).where(Player.bref_id.is_not(None))
        if bref_id:
            stmt = stmt.where(Player.bref_id == bref_id)
        elif not force:
            stmt = stmt.where(
                _needs_scrape(Player.stints_scraped_at, Player.image_scraped_at, cutoff=cutoff)
            )
        stmt = stmt.order_by(Player.id.asc())
        if limit:
            stmt = stmt.limit(limit)
        rows = (await session.execute(stmt)).all()

        sem = asyncio.Semaphore(max(1, concurrency))

        async def _one(player_id: int, bref_id: str) -> list[dict]:
            async with sem:
                # Determine active vs retired so we don't mark the final stint as "current" for retired players.
                player_ret = (
                    await session.execute(select(Player.retirement_year).where(Player.id == player_id))
                ).scalar_one_or_none()
                is_active = player_ret is None
                seasons, headshot_url = await scrape_player_team_seasons(bref_id)
                stints = seasons_to_stints(bref_id, seasons, is_active=is_active)
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
                if headshot_url:
                    out.append({"player_id": player_id, "image_url": headshot_url})
                return out

        total_processed_players = 0
        total_inserted_stints = 0
        total_players = len(rows)

        bar = (
            tqdm(total=total_players, desc="Player stints", unit="player", dynamic_ncols=True) if tqdm else None
        )

        # Incremental commit so you can restart safely.
        batch_values: list[dict] = []
        batch_image_updates: dict[int, str] = {}
        batch_player_ids: list[int] = []
        commit_every_players = max(1, commit_every_players)

        errors = 0
        for i, (player_id, bref_id) in enumerate(rows, 1):
            if not bref_id:
                continue
            try:
                values = await _one(player_id, bref_id)
                for v in values:
                    if "image_url" in v:
                        batch_image_updates[player_id] = v["image_url"]
                    else:
                        batch_values.append(v)
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
                if batch_image_updates:
                    for pid, url in batch_image_updates.items():
                        await session.execute(
                            update(Player).where(Player.id == pid).values(image_url=url)
                        )
                # Mark players as attempted (even if they had 0 stints); this enables true resume.
                await session.execute(
                    update(Player)
                    .where(Player.id.in_(batch_player_ids))
                    .values(
                        stints_scraped_at=datetime.now(timezone.utc),
                        image_scraped_at=datetime.now(timezone.utc),
                    )
                )
                await session.commit()
                total_processed_players += len(batch_player_ids)
                batch_values.clear()
                batch_image_updates.clear()
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
            if batch_image_updates:
                for pid, url in batch_image_updates.items():
                    await session.execute(update(Player).where(Player.id == pid).values(image_url=url))
            await session.execute(
                update(Player)
                .where(Player.id.in_(batch_player_ids))
                .values(
                    stints_scraped_at=datetime.now(timezone.utc),
                    image_scraped_at=datetime.now(timezone.utc),
                )
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


async def backfill_retired_stint_end_years(session) -> int:
    res = await session.execute(
        text(
            """
            UPDATE player_team_stints pts
            SET end_year = p.retirement_year
            FROM players p
            WHERE pts.player_id = p.id
              AND pts.end_year IS NULL
              AND p.retirement_year IS NOT NULL
            """
        )
    )
    await session.commit()
    # rowcount can be -1 depending on driver; still useful when available.
    return int(res.rowcount or 0)


def _season_label(start_year: int) -> str:
    return f"{start_year}-{str(start_year + 1)[-2:]}"


async def _ensure_seasons(session, start_years: Sequence[int]) -> dict[int, int]:
    """
    Resolve start_year -> season.id.

    Seasons are prefilled by migration (1946+). This only inserts any missing
    future / edge-case years the catalog does not yet include.
    """
    years = sorted({int(y) for y in start_years})
    if not years:
        return {}
    existing = (
        await session.execute(select(Season).where(Season.start_year.in_(years)))
    ).scalars().all()
    by_year = {s.start_year: s.id for s in existing}
    missing = [y for y in years if y not in by_year]
    if missing:
        values = [
            {
                "start_year": y,
                "end_year": y + 1,
                "label": _season_label(y),
            }
            for y in missing
        ]
        stmt = insert(Season).values(values)
        stmt = stmt.on_conflict_do_nothing(constraint="uq_seasons_start_year")
        await session.execute(stmt)
        await session.flush()
        existing = (
            await session.execute(select(Season).where(Season.start_year.in_(years)))
        ).scalars().all()
        by_year = {s.start_year: s.id for s in existing}
    return by_year


_STAT_UPDATE_FIELDS = (
    "games",
    "games_started",
    "minutes",
    "fg",
    "fga",
    "fg3",
    "fg3a",
    "fg2",
    "fg2a",
    "ft",
    "fta",
    "orb",
    "drb",
    "trb",
    "ast",
    "stl",
    "blk",
    "tov",
    "pf",
    "pts",
    "fg_pct",
    "fg3_pct",
    "fg2_pct",
    "efg_pct",
    "ft_pct",
    "ts_pct",
    "per",
    "orb_pct",
    "drb_pct",
    "trb_pct",
    "ast_pct",
    "stl_pct",
    "blk_pct",
    "tov_pct",
    "usg_pct",
    "ows",
    "dws",
    "ws",
    "ws_per_48",
    "obpm",
    "dbpm",
    "bpm",
    "vorp",
    "scraped_at",
)


async def upsert_player_season_stats_and_awards(
    *,
    concurrency: int = 3,
    limit: int | None = None,
    bref_id: str | None = None,
    force: bool = False,
    stale_days: int | None = None,
    commit_every_players: int = 10,
    do_stats: bool = True,
    do_awards: bool = True,
) -> tuple[int, int]:
    """
    Scrape player pages and upsert season stats and/or awards.
    Returns (stats_rows_upserted, award_rows_upserted) approximate counts.

    Without --force: only players missing relevant timestamps (resume), plus any whose
    timestamps are older than --stale-days when that flag is set.
    """
    if not do_stats and not do_awards:
        return 0, 0

    print(f"[player-stats/awards] using DATABASE_URL={settings.database_url}")
    cutoff = None if force else _stale_cutoff(stale_days)
    if cutoff is not None:
        print(
            f"[player-stats/awards] refreshing scrapes older than {stale_days} day(s) "
            f"(before {cutoff.isoformat()})"
        )

    async with SessionLocal() as session:
        abbr_to_team_id = await _team_abbr_map(session)
        award_rows = (await session.execute(select(Award))).scalars().all()
        slug_to_award_id = {a.slug: a.id for a in award_rows}

        stmt = select(Player.id, Player.bref_id).where(Player.bref_id.is_not(None))
        if bref_id:
            stmt = stmt.where(Player.bref_id == bref_id)
        elif not force:
            columns = []
            if do_stats:
                columns.append(Player.stats_scraped_at)
                # Lets a postseason backfill resume over players already scraped for
                # regular season, without forcing a full re-scrape.
                columns.append(Player.postseason_scraped_at)
            if do_awards:
                columns.append(Player.awards_scraped_at)
            stmt = stmt.where(_needs_scrape(*columns, cutoff=cutoff))
        stmt = stmt.order_by(Player.id.asc())
        if limit:
            stmt = stmt.limit(limit)
        players = (await session.execute(stmt)).all()

    sem = asyncio.Semaphore(max(1, concurrency))

    async def _scrape(player_bref_id: str):
        async with sem:
            return await scrape_player_stats_and_awards(player_bref_id)

    total_stats = 0
    total_awards = 0
    total_players = len(players)
    bar = (
        tqdm(total=total_players, desc="Player stats/awards", unit="player", dynamic_ncols=True)
        if tqdm
        else None
    )

    batch_stats: list[dict] = []
    batch_awards: list[dict] = []
    batch_player_ids: list[int] = []
    commit_every_players = max(1, commit_every_players)
    errors = 0

    async with SessionLocal() as session:
        async def _flush() -> None:
            nonlocal total_stats, total_awards
            if not batch_player_ids:
                return
            if batch_stats:
                stmt_ins = insert(PlayerSeasonStat).values(batch_stats)
                stmt_ins = stmt_ins.on_conflict_do_update(
                    constraint="uq_player_season_stats_player_season_team_type",
                    set_={field: getattr(stmt_ins.excluded, field) for field in _STAT_UPDATE_FIELDS},
                )
                await session.execute(stmt_ins)
                total_stats += len(batch_stats)
            if batch_awards:
                stmt_ins = insert(PlayerAward).values(batch_awards)
                stmt_ins = stmt_ins.on_conflict_do_update(
                    constraint="uq_player_awards_player_award_season",
                    set_={"team_id": stmt_ins.excluded.team_id},
                )
                await session.execute(stmt_ins)
                total_awards += len(batch_awards)

            values: dict = {}
            now = datetime.now(timezone.utc)
            if do_stats:
                values["stats_scraped_at"] = now
                values["postseason_scraped_at"] = now
            if do_awards:
                values["awards_scraped_at"] = now
            await session.execute(update(Player).where(Player.id.in_(batch_player_ids)).values(**values))
            await session.commit()
            batch_stats.clear()
            batch_awards.clear()
            batch_player_ids.clear()

        for i, (player_id, player_bref_id) in enumerate(players, 1):
            if not player_bref_id:
                continue
            try:
                stats, awards = await _scrape(player_bref_id)
                now = datetime.now(timezone.utc)
                start_years = [s.start_year for s in stats] + [a.start_year for a in awards]
                season_ids = await _ensure_seasons(session, start_years)

                if do_stats:
                    for s in stats:
                        abbr = ABBR_ALIASES.get(s.team_abbreviation.upper(), s.team_abbreviation.upper())
                        team_id = abbr_to_team_id.get(abbr)
                        season_id = season_ids.get(s.start_year)
                        if not team_id or not season_id:
                            continue
                        row = {
                            "player_id": player_id,
                            "season_id": season_id,
                            "team_id": team_id,
                            "is_postseason": bool(s.is_postseason),
                            "scraped_at": now,
                        }
                        for field in _STAT_UPDATE_FIELDS:
                            if field == "scraped_at":
                                continue
                            row[field] = getattr(s, field, None)
                        batch_stats.append(row)

                if do_awards:
                    for a in awards:
                        award_id = slug_to_award_id.get(a.award_slug)
                        season_id = season_ids.get(a.start_year)
                        if not award_id or not season_id:
                            continue
                        team_id = None
                        if a.team_abbreviation:
                            abbr = ABBR_ALIASES.get(a.team_abbreviation.upper(), a.team_abbreviation.upper())
                            team_id = abbr_to_team_id.get(abbr)
                        batch_awards.append(
                            {
                                "player_id": player_id,
                                "award_id": award_id,
                                "season_id": season_id,
                                "team_id": team_id,
                            }
                        )
                batch_player_ids.append(player_id)
            except Exception:  # pylint: disable=broad-exception-caught
                errors += 1
                if not bar:
                    print(f"Error on player_id={player_id} bref_id={player_bref_id}")

            if bar:
                bar.update(1)
            elif i == 1 or i % 25 == 0 or i == total_players:
                print(f"Processed {i}/{total_players} players…")

            if len(batch_player_ids) >= commit_every_players:
                await _flush()

        await _flush()

    if bar:
        bar.close()
    if errors and not bar:
        print(f"Done with {errors} errors. Re-run to retry failed players.")
    print(f"[player-stats/awards] stats~={total_stats} awards~={total_awards}")
    return total_stats, total_awards


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Teams/Players from Basketball Reference.")
    parser.add_argument("--teams", action="store_true", help="Scrape and upsert Teams")
    parser.add_argument("--team-logos", action="store_true", help="Also scrape and store team logo_url (slower)")
    parser.add_argument(
        "--drafts",
        nargs=2,
        type=int,
        metavar=("START_YEAR", "END_YEAR"),
        help="Scrape draft tables and merge year/round/pick onto players by bref_id",
    )
    parser.add_argument("--all-players", action="store_true", help="Scrape ALL players A–Z (drafted + undrafted) and upsert by bref_id")
    parser.add_argument("--player-stints", action="store_true", help="Scrape player pages and populate player_team_stints")
    parser.add_argument("--player-stats", action="store_true", help="Scrape player pages and upsert player_season_stats")
    parser.add_argument("--player-awards", action="store_true", help="Scrape player pages and upsert player_awards")
    parser.add_argument(
        "--backfill-retired-stint-ends",
        action="store_true",
        help="Only backfill player_team_stints.end_year for retired players (no web scraping).",
    )
    parser.add_argument("--concurrency", type=int, default=4, help="Concurrency for web scraping (default: 4)")
    parser.add_argument("--limit", type=int, default=None, help="Optional limit (for testing) for certain seed modes")
    parser.add_argument("--bref-id", type=str, default=None, help="Only process one player by bref_id (e.g. jamesle01)")
    parser.add_argument("--force", action="store_true", help="Reprocess even if scrape timestamps are set")
    parser.add_argument(
        "--stale-days",
        type=int,
        default=None,
        metavar="N",
        help=(
            "Also re-scrape players whose relevant *_scraped_at is older than N days "
            "(ignored when --force is set). Useful for weekly refreshes without a full re-scrape."
        ),
    )
    parser.add_argument("--commit-every", type=int, default=10, help="Commit after N successful players (default: 10)")
    args = parser.parse_args()

    async def _run() -> None:
        if args.backfill_retired_stint_ends:
            async with SessionLocal() as session:
                n = await backfill_retired_stint_end_years(session)
            print(f"Backfilled retired stint end_years: {n}")
            return
        if args.teams:
            n = await upsert_teams(with_logos=bool(args.team_logos))
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
                stale_days=args.stale_days,
                commit_every_players=args.commit_every,
            )
            print(f"Inserted player team stints (approx): {n}")
        if args.player_stats or args.player_awards:
            n_stats, n_awards = await upsert_player_season_stats_and_awards(
                concurrency=args.concurrency,
                limit=args.limit,
                bref_id=args.bref_id,
                force=args.force,
                stale_days=args.stale_days,
                commit_every_players=args.commit_every,
                do_stats=bool(args.player_stats),
                do_awards=bool(args.player_awards),
            )
            if args.player_stats:
                print(f"Upserted player season stats (approx): {n_stats}")
            if args.player_awards:
                print(f"Upserted player awards (approx): {n_awards}")

    asyncio.run(_run())


if __name__ == "__main__":
    main()



