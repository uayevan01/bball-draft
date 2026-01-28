from __future__ import annotations

import re
import asyncio
from dataclasses import dataclass
from typing import Any

import httpx
from bs4 import BeautifulSoup, Comment
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception


_BREF_BASE = "https://www.basketball-reference.com"
# Sports Reference rate limiting policy: Basketball Reference blocks above ~20 req/min.
# Keep a safety margin: 3.2s => 18.75 req/min.
_BREF_MIN_INTERVAL_SECONDS = 3.2
_bref_rate_lock = asyncio.Lock()
_bref_next_time = 0.0


class TooManyRequestsError(RuntimeError):
    def __init__(self, *, url: str, retry_after_seconds: float | None):
        super().__init__(f"429 Too Many Requests: {url}")
        self.url = url
        self.retry_after_seconds = retry_after_seconds


def _retry_on(e: BaseException) -> bool:
    if isinstance(e, TooManyRequestsError):
        return True
    if isinstance(e, httpx.TransportError):
        return True
    if isinstance(e, httpx.HTTPStatusError):
        return e.response.status_code in {408, 425, 429, 500, 502, 503, 504}
    return False


@dataclass(frozen=True)
class BRefTeamRow:
    name: str
    city: str | None
    abbreviation: str | None
    founded_year: int | None
    dissolved_year: int | None


@dataclass(frozen=True)
class BRefDraftRow:
    name: str
    draft_year: int
    draft_round: int | None
    draft_pick: int | None
    team_abbreviation: str | None
    position: str | None


@dataclass(frozen=True)
class BRefPlayerIndexRow:
    bref_id: str
    name: str
    position: str | None
    year_min: int | None
    year_max: int | None


@dataclass(frozen=True)
class BRefPlayerStintRow:
    bref_id: str
    team_abbreviation: str
    start_year: int
    end_year: int | None


def _clean(text: str | None) -> str | None:
    if text is None:
        return None
    s = re.sub(r"\s+", " ", text).strip()
    return s or None


@retry(
    stop=stop_after_attempt(8),
    wait=wait_exponential(multiplier=1.0, min=1.0, max=60),
    retry=retry_if_exception(_retry_on),
)
async def _get(client: httpx.AsyncClient, url: str) -> str:
    # Global rate limit (shared across all scraping) to reduce 429s.
    global _bref_next_time  # pylint: disable=global-statement
    async with _bref_rate_lock:
        now = asyncio.get_running_loop().time()
        if now < _bref_next_time:
            await asyncio.sleep(_bref_next_time - now)
        _bref_next_time = asyncio.get_running_loop().time() + _BREF_MIN_INTERVAL_SECONDS

    resp = await client.get(url, timeout=30, follow_redirects=True)
    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After")
        retry_after_seconds = None
        if retry_after:
            try:
                retry_after_seconds = float(retry_after)
            except ValueError:
                retry_after_seconds = None
        # If server tells us how long to wait, do it once here to avoid long "stuck on player 1" feelings.
        if retry_after_seconds and retry_after_seconds > 0:
            await asyncio.sleep(min(retry_after_seconds, 60.0))
        raise TooManyRequestsError(url=url, retry_after_seconds=retry_after_seconds)
    resp.raise_for_status()
    return resp.text


def _find_table_including_comments(soup: BeautifulSoup, css_selector: str) -> Any:
    """
    Basketball Reference frequently wraps tables in HTML comments.
    This helper finds tables in normal DOM first, then inside comment blocks.
    """
    table = soup.select_one(css_selector)
    if table is not None:
        return table

    # Search commented HTML for the selector.
    for node in soup.find_all(string=lambda t: isinstance(t, Comment)):
        comment = str(node)
        if "<table" not in comment:
            continue
        inner = BeautifulSoup(comment, "lxml")
        table = inner.select_one(css_selector)
        if table is not None:
            return table

    return None


async def scrape_teams() -> list[BRefTeamRow]:
    """
    Scrape current team abbreviations & names from BRef.

    Note: this is a lightweight bootstrap. Franchise history (relocations) can be layered in later.
    """
    async with httpx.AsyncClient(headers={"User-Agent": "nba-draft-app/1.0"}) as client:
        html = await _get(client, f"{_BREF_BASE}/teams/")

    soup = BeautifulSoup(html, "lxml")

    # BRef usually has active + defunct tables; parse both to get year ranges for all teams.
    # Important: year_max means different things:
    # - active: latest season year (NOT a dissolved year)
    # - defunct: final season year
    tables: list[tuple[str, Any]] = []
    for sel in ("table#teams_active", "table#teams_defunct"):
        t = _find_table_including_comments(soup, sel)
        if t is not None:
            tables.append((sel, t))
    if not tables:
        raise RuntimeError("Could not find teams tables on Basketball Reference.")

    rows: list[BRefTeamRow] = []
    for sel, table in tables:
        for tr in table.select("tbody tr"):
            name_cell = tr.select_one('td[data-stat="franch_name"], th[data-stat="franch_name"]')

            # Prefer the /teams/XXX/ code from the franchise link (this reflects the current team page code on BRef).
            abbreviation = None
            link = tr.select_one('a[href^="/teams/"]')
            if link and link.get("href"):
                m = re.match(r"^/teams/([A-Z]{3})/", link.get("href", ""))
                if m:
                    abbreviation = m.group(1)

            # Fallback: BRef sometimes shows a franchise id in the row (not always the current abbreviation).
            if not abbreviation:
                abbr_cell = tr.select_one('th[data-stat="franch_id"], td[data-stat="franch_id"]')
                abbreviation = _clean(abbr_cell.get_text()) if abbr_cell else None

            name = _clean(name_cell.get_text()) if name_cell else None

            if not name:
                continue

            year_min_cell = tr.select_one('td[data-stat="year_min"], th[data-stat="year_min"]')
            year_max_cell = tr.select_one('td[data-stat="year_max"], th[data-stat="year_max"]')
            founded_year = _parse_year(_clean(year_min_cell.get_text() if year_min_cell else None))
            year_max = _parse_year(_clean(year_max_cell.get_text() if year_max_cell else None))

            dissolved_year = year_max if sel == "table#teams_defunct" else None

            # Best-effort city extraction (BRef uses "Boston Celtics" style)
            parts = name.split(" ")
            city = None
            if len(parts) >= 2:
                city = " ".join(parts[:-1])

            # Skip if we still couldn't infer an abbreviation; the DB upsert key depends on it.
            if not abbreviation:
                continue

            rows.append(
                BRefTeamRow(
                    name=name,
                    city=city,
                    abbreviation=abbreviation,
                    founded_year=founded_year,
                    dissolved_year=dissolved_year,
                )
            )

    return rows


def _parse_int(s: str | None) -> int | None:
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        return None


def _parse_year(s: str | None) -> int | None:
    """
    Extract a 4-digit year from messy strings (some BRef cells can contain ranges/footnotes).
    """
    if not s:
        return None
    m = re.search(r"(\d{4})", s)
    return int(m.group(1)) if m else None


def _parse_bref_player_id_from_href(href: str | None) -> str | None:
    # Example: /players/a/abdulka01.html -> abdulka01
    if not href:
        return None
    m = re.match(r"^/players/[a-z]/([a-z0-9]+)\.html$", href)
    return m.group(1) if m else None


async def scrape_player_index(letter: str) -> list[BRefPlayerIndexRow]:
    """
    Scrape https://www.basketball-reference.com/players/{letter}/
    Includes drafted + undrafted players.
    """
    letter = letter.lower()
    url = f"{_BREF_BASE}/players/{letter}/"
    async with httpx.AsyncClient(headers={"User-Agent": "nba-draft-app/1.0"}) as client:
        html = await _get(client, url)

    soup = BeautifulSoup(html, "lxml")
    table = _find_table_including_comments(soup, "table#players")
    if table is None:
        raise RuntimeError(f"Could not find players index table for '{letter}'.")

    rows: list[BRefPlayerIndexRow] = []
    for tr in table.select("tbody tr"):
        if tr.get("class") and "thead" in tr.get("class", []):
            continue

        name_cell = tr.select_one('th[data-stat="player"] a')
        if not name_cell:
            continue
        name = _clean(name_cell.get_text())
        bref_id = _parse_bref_player_id_from_href(name_cell.get("href"))
        if not name or not bref_id:
            continue

        pos_cell = tr.select_one('td[data-stat="pos"]')
        pos = _clean(pos_cell.get_text()) if pos_cell else None

        year_min_cell = tr.select_one('td[data-stat="year_min"], th[data-stat="year_min"]')
        year_max_cell = tr.select_one('td[data-stat="year_max"], th[data-stat="year_max"]')
        year_min = _parse_year(_clean(year_min_cell.get_text() if year_min_cell else None))
        year_max = _parse_year(_clean(year_max_cell.get_text() if year_max_cell else None))

        rows.append(BRefPlayerIndexRow(bref_id=bref_id, name=name, position=pos, year_min=year_min, year_max=year_max))

    return rows


async def scrape_all_players_index(concurrency: int = 4) -> list[BRefPlayerIndexRow]:
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _one(letter: str) -> list[BRefPlayerIndexRow]:
        async with sem:
            return await scrape_player_index(letter)

    letters = [chr(c) for c in range(ord("a"), ord("z") + 1)]
    results = await asyncio.gather(*[_one(l) for l in letters])
    out: list[BRefPlayerIndexRow] = []
    for part in results:
        out.extend(part)
    return out


def _season_text_to_start_year(season_text: str) -> int | None:
    """
    BRef season text is usually like '2003-04'. We treat start_year as 2003.
    """
    m = re.match(r"^(\d{4})-\d{2}$", season_text.strip())
    return int(m.group(1)) if m else None


async def scrape_player_team_seasons(bref_id: str) -> dict[int, str]:
    """
    Returns mapping: season_start_year -> team_abbreviation (best-effort).

    For seasons with multiple teams, we pick the team row with the most games played.
    """
    first_letter = bref_id[0].lower()
    url = f"{_BREF_BASE}/players/{first_letter}/{bref_id}.html"
    async with httpx.AsyncClient(headers={"User-Agent": "nba-draft-app/1.0"}) as client:
        # tiny politeness delay to reduce 429s when looping through many players
        await asyncio.sleep(0.3)
        html = await _get(client, url)

    soup = BeautifulSoup(html, "lxml")
    # Basketball Reference has been rolling out "Upgraded stats tables" which use different IDs/columns.
    # Prefer per-game, then fall back to totals.
    table = None
    for sel in ("table#per_game_stats", "table#per_game", "table#totals_stats", "table#totals"):
        table = _find_table_including_comments(soup, sel)
        if table is not None:
            break
    if table is None:
        return {}

    # For each season, choose best team based on max games (exclude TOT).
    best: dict[int, tuple[str, int]] = {}  # season_start -> (team_abbr, games)
    for tr in table.select("tbody tr"):
        if tr.get("class") and "thead" in tr.get("class", []):
            continue

        # Old tables: season/team_id ; New tables: year_id/team_name_abbr
        season_cell = tr.select_one('th[data-stat="year_id"], th[data-stat="season"]')
        team_cell = tr.select_one(
            'td[data-stat="team_name_abbr"] a, td[data-stat="team_name_abbr"], td[data-stat="team_id"] a, td[data-stat="team_id"]'
        )
        g_cell = tr.select_one('td[data-stat="g"]')

        if not season_cell or not team_cell:
            continue

        season_text = _clean(season_cell.get_text())
        if not season_text:
            continue
        # Skip non-season rows (e.g. "Career")
        if not re.match(r"^\d{4}-\d{2}$", season_text):
            continue
        start_year = _season_text_to_start_year(season_text)
        if start_year is None:
            continue

        team_abbr = _clean(team_cell.get_text())
        if not team_abbr or team_abbr.upper() == "TOT":
            continue

        games = _parse_int(_clean(g_cell.get_text() if g_cell else None)) or 0
        current = best.get(start_year)
        if current is None or games >= current[1]:
            best[start_year] = (team_abbr.upper(), games)

    return {season: team for season, (team, _games) in best.items()}


def seasons_to_stints(bref_id: str, seasons: dict[int, str]) -> list[BRefPlayerStintRow]:
    """
    Convert season_start_year->team into contiguous stints.

    end_year follows your examples:
    - start_year = first season start year
    - end_year = year the stint ended (last_season_start + 1)
    - current stint => end_year None
    """
    if not seasons:
        return []

    years = sorted(seasons.keys())
    stints: list[BRefPlayerStintRow] = []

    cur_team = seasons[years[0]]
    cur_start = years[0]
    prev_year = years[0]

    def _close(team: str, start: int, last_start_year: int, is_last: bool) -> None:
        end_year = None if is_last else (last_start_year + 1)
        stints.append(BRefPlayerStintRow(bref_id=bref_id, team_abbreviation=team, start_year=start, end_year=end_year))

    for y in years[1:]:
        team = seasons[y]
        contiguous = y == prev_year + 1
        if team == cur_team and contiguous:
            prev_year = y
            continue

        # close current
        _close(cur_team, cur_start, prev_year, False)
        # start new
        cur_team = team
        cur_start = y
        prev_year = y

    # close last stint as current
    _close(cur_team, cur_start, prev_year, True)
    return stints


async def scrape_draft_year(draft_year: int) -> list[BRefDraftRow]:
    """
    Scrape the draft table for a given year.

    Source: https://www.basketball-reference.com/draft/NBA_YYYY.html
    """
    url = f"{_BREF_BASE}/draft/NBA_{draft_year}.html"
    async with httpx.AsyncClient(headers={"User-Agent": "nba-draft-app/1.0"}) as client:
        html = await _get(client, url)

    soup = BeautifulSoup(html, "lxml")
    table = _find_table_including_comments(soup, "table#stats")
    if table is None:
        raise RuntimeError(f"Could not find draft table for {draft_year} on Basketball Reference.")

    out: list[BRefDraftRow] = []
    for tr in table.select("tbody tr"):
        # Skip header-like separators
        if tr.get("class") and "thead" in tr.get("class", []):
            continue

        player_cell = tr.select_one('td[data-stat="player"]')
        if player_cell is None:
            continue
        name = _clean(player_cell.get_text())
        if not name:
            continue

        rnd_cell = tr.select_one('td[data-stat="draft_round"]')
        pk_cell = tr.select_one('td[data-stat="pick_overall"]')

        rnd = _parse_int(_clean(rnd_cell.get_text() if rnd_cell else None))
        pk = _parse_int(_clean(pk_cell.get_text() if pk_cell else None))

        team_cell = tr.select_one('td[data-stat="team_id"]')
        team_abbr = _clean(team_cell.get_text()) if team_cell else None

        pos_cell = tr.select_one('td[data-stat="pos"]')
        pos = _clean(pos_cell.get_text()) if pos_cell else None

        out.append(
            BRefDraftRow(
                name=name,
                draft_year=draft_year,
                draft_round=rnd,
                draft_pick=pk,
                team_abbreviation=team_abbr,
                position=pos,
            )
        )

    return out


async def scrape_drafts(start_year: int, end_year: int) -> list[BRefDraftRow]:
    rows: list[BRefDraftRow] = []
    for year in range(start_year, end_year + 1):
        rows.extend(await scrape_draft_year(year))
    return rows


def to_dict(row: Any) -> dict[str, Any]:
    if hasattr(row, "__dict__"):
        return dict(row.__dict__)
    raise TypeError("Unsupported row type")


