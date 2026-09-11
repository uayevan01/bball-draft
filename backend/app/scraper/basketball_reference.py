from __future__ import annotations

import re
import asyncio
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse

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
    hall_of_fame: bool = False


@dataclass(frozen=True)
class BRefPlayerStintRow:
    bref_id: str
    team_abbreviation: str
    start_year: int
    end_year: int | None


@dataclass(frozen=True)
class BRefSeasonStatRow:
    bref_id: str
    start_year: int
    team_abbreviation: str
    games: int | None = None
    games_started: int | None = None
    minutes: int | None = None
    fg: int | None = None
    fga: int | None = None
    fg3: int | None = None
    fg3a: int | None = None
    fg2: int | None = None
    fg2a: int | None = None
    ft: int | None = None
    fta: int | None = None
    orb: int | None = None
    drb: int | None = None
    trb: int | None = None
    ast: int | None = None
    stl: int | None = None
    blk: int | None = None
    tov: int | None = None
    pf: int | None = None
    pts: int | None = None
    fg_pct: float | None = None
    fg3_pct: float | None = None
    fg2_pct: float | None = None
    efg_pct: float | None = None
    ft_pct: float | None = None
    ts_pct: float | None = None
    per: float | None = None
    orb_pct: float | None = None
    drb_pct: float | None = None
    trb_pct: float | None = None
    ast_pct: float | None = None
    stl_pct: float | None = None
    blk_pct: float | None = None
    tov_pct: float | None = None
    usg_pct: float | None = None
    ows: float | None = None
    dws: float | None = None
    ws: float | None = None
    ws_per_48: float | None = None
    obpm: float | None = None
    dbpm: float | None = None
    bpm: float | None = None
    vorp: float | None = None


@dataclass(frozen=True)
class BRefAwardRow:
    bref_id: str
    award_slug: str
    start_year: int
    team_abbreviation: str | None = None


# BRef Awards-column tokens we persist (voting ranks only when place == 1).
_AWARD_TOKEN_TO_SLUG: dict[str, str] = {
    "AS": "all_star",
    "NBA1": "all_nba_1",
    "NBA2": "all_nba_2",
    "NBA3": "all_nba_3",
    "DEF1": "all_defense_1",
    "DEF2": "all_defense_2",
}
_AWARD_PLACE_WINNERS: dict[str, str] = {
    "MVP": "mvp",
    "DPOY": "dpoy",
    "ROY": "roy",
    "MIP": "mip",
    "6MOY": "sixth_man",
    "FINALSMVP": "finals_mvp",
}


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


_TEAM_PAGE_ABBR_OVERRIDES: dict[str, str] = {
    # Our DB uses common NBA shorthand, but Basketball Reference team pages sometimes use different codes.
    "BKN": "BRK",
    "CHA": "CHO",
    "PHX": "PHO",
}


def _normalize_bref_img_src(src: str | None) -> str | None:
    if not src:
        return None
    s = src.strip()
    if s.startswith("//"):
        return f"https:{s}"
    if s.startswith("/"):
        return f"{_BREF_BASE}{s}"
    # Prefer https everywhere to avoid mixed-content + Next image config issues.
    if s.startswith("http://"):
        s = "https://" + s[len("http://") :]
    return s


def _unwrap_ssref_resizer(url: str | None) -> str | None:
    """
    Sports Reference sometimes serves logos via:
      http(s)://cdn.ssref.net/scripts/image_resize.cgi?...&url=http://cdn.ssref.net/nocdn/tlogo/bbr/MIA.png
    For our app, store the direct PNG URL instead.
    """
    if not url:
        return None
    try:
        u = urlparse(url)
        if "cdn.ssref.net" not in (u.hostname or ""):
            return url
        if not u.path.endswith("/scripts/image_resize.cgi"):
            return url
        qs = parse_qs(u.query)
        inner = (qs.get("url") or [None])[0]
        return _normalize_bref_img_src(inner) or url
    except (ValueError, TypeError):
        return url


async def scrape_team_logo(abbreviation: str) -> str | None:
    """
    Fetch a team page (/teams/XXX/) and attempt to extract the logo image URL.

    Note: This is an additional request per team, so call it sparingly (e.g., a one-time seed).
    """
    abbr = abbreviation.upper().strip()
    abbr = _TEAM_PAGE_ABBR_OVERRIDES.get(abbr, abbr)
    async with httpx.AsyncClient(headers={"User-Agent": "nba-draft-app/1.0"}) as client:
        html = await _get(client, f"{_BREF_BASE}/teams/{abbr}/")
    soup = BeautifulSoup(html, "lxml")

    # First try meta tags (these are consistent and often point at cdn.ssref.net logos).
    meta = soup.select_one('meta[property="og:image"]') or soup.select_one('meta[name="twitter:image"]')
    if meta and meta.get("content"):
        url = _unwrap_ssref_resizer(_normalize_bref_img_src(meta.get("content")))
        if url:
            return url

    # Fall back to scanning for an actual <img>.
    selectors = [
        "div#meta div.media-item img",
        "div#meta img",
        "div#info div.media-item img",
        "div#info img",
        'img[alt*="Logo"]',
        'img[alt*="logo"]',
    ]
    for sel in selectors:
        img = soup.select_one(sel)
        if not img:
            continue
        src = img.get("src") or img.get("data-src")
        url = _unwrap_ssref_resizer(_normalize_bref_img_src(src))
        if url:
            return url

    return None


def _parse_int(s: str | None) -> int | None:
    if not s:
        return None
    try:
        return int(s.replace(",", ""))
    except ValueError:
        return None


def _parse_float(s: str | None) -> float | None:
    if not s:
        return None
    try:
        return float(s)
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

        player_th = tr.select_one('th[data-stat="player"]')
        name_cell = tr.select_one('th[data-stat="player"] a')
        if not player_th or not name_cell:
            continue
        # Hall of Fame players have an asterisk after their name, and BRef often renders it OUTSIDE the <a>.
        # Example: <th data-stat="player"><a>Bill Russell</a>*</th>
        player_cell_text = _clean(player_th.get_text()) or ""
        hall_of_fame = "*" in player_cell_text

        # Use the <a> text as the canonical player name (without the asterisk).
        name = _clean(name_cell.get_text())
        if not name:
            continue
        bref_id = _parse_bref_player_id_from_href(name_cell.get("href"))
        if not name or not bref_id:
            continue

        pos_cell = tr.select_one('td[data-stat="pos"]')
        pos = _clean(pos_cell.get_text()) if pos_cell else None

        year_min_cell = tr.select_one('td[data-stat="year_min"], th[data-stat="year_min"]')
        year_max_cell = tr.select_one('td[data-stat="year_max"], th[data-stat="year_max"]')
        year_min = _parse_year(_clean(year_min_cell.get_text() if year_min_cell else None))
        year_max = _parse_year(_clean(year_max_cell.get_text() if year_max_cell else None))

        rows.append(
            BRefPlayerIndexRow(
                bref_id=bref_id,
                name=name,
                position=pos,
                year_min=year_min,
                year_max=year_max,
                hall_of_fame=hall_of_fame,
            )
        )

    return rows


async def scrape_all_players_index(concurrency: int = 4) -> list[BRefPlayerIndexRow]:
    sem = asyncio.Semaphore(max(1, concurrency))

    try:
        from tqdm.auto import tqdm  # type: ignore[import-not-found]
    except ImportError:  # pragma: no cover
        tqdm = None  # type: ignore

    async def _one(letter: str) -> list[BRefPlayerIndexRow]:
        async with sem:
            return await scrape_player_index(letter)

    letters = [chr(c) for c in range(ord("a"), ord("z") + 1)]
    tasks = [asyncio.create_task(_one(l)) for l in letters]

    out: list[BRefPlayerIndexRow] = []
    bar = tqdm(total=len(tasks), desc="Player index pages", unit="page", dynamic_ncols=True) if tqdm else None
    try:
        for fut in asyncio.as_completed(tasks):
            part = await fut
            out.extend(part)
            if bar:
                bar.update(1)
    finally:
        if bar:
            bar.close()
    return out


def _season_text_to_start_year(season_text: str) -> int | None:
    """
    BRef season text is usually like '2003-04'. We treat start_year as 2003.
    """
    m = re.match(r"^(\d{4})-\d{2}$", season_text.strip())
    return int(m.group(1)) if m else None


async def scrape_player_team_seasons(bref_id: str) -> tuple[dict[int, str], str | None]:
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
    headshot_url = None
    img = soup.select_one("div#meta img")
    if img and img.get("src"):
        headshot_url = str(img.get("src"))
        if headshot_url.startswith("//"):
            headshot_url = "https:" + headshot_url
        elif headshot_url.startswith("/"):
            headshot_url = _BREF_BASE + headshot_url
    # Basketball Reference has been rolling out "Upgraded stats tables" which use different IDs/columns.
    # Prefer per-game, then fall back to totals.
    table = None
    for sel in ("table#per_game_stats", "table#per_game", "table#totals_stats", "table#totals"):
        table = _find_table_including_comments(soup, sel)
        if table is not None:
            break
    if table is None:
        return {}, headshot_url

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

    seasons = {season: team for season, (team, _games) in best.items()}
    return seasons, headshot_url


def seasons_to_stints(bref_id: str, seasons: dict[int, str], *, is_active: bool) -> list[BRefPlayerStintRow]:
    """
    Convert season_start_year->team into contiguous stints.

    end_year follows your examples:
    - start_year = first season start year
    - end_year = year the stint ended (last_season_start + 1)
    - current stint => end_year None (only if player is active)
    """
    if not seasons:
        return []

    years = sorted(seasons.keys())
    stints: list[BRefPlayerStintRow] = []

    cur_team = seasons[years[0]]
    cur_start = years[0]
    prev_year = years[0]

    def _close(team: str, start: int, last_start_year: int, is_last: bool) -> None:
        end_year = None if (is_last and is_active) else (last_start_year + 1)
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

    # close last stint as current only if active; otherwise close with end_year
    _close(cur_team, cur_start, prev_year, True)
    return stints


def _cell_text(tr: Any, *data_stats: str) -> str | None:
    for stat in data_stats:
        cell = tr.select_one(f'td[data-stat="{stat}"], th[data-stat="{stat}"]')
        if cell is not None:
            return _clean(cell.get_text())
    return None


def _row_season_start_year(tr: Any) -> int | None:
    season_cell = tr.select_one('th[data-stat="year_id"], th[data-stat="season"], td[data-stat="year_id"], td[data-stat="season"]')
    if season_cell is None:
        return None
    season_text = _clean(season_cell.get_text())
    if not season_text or not re.match(r"^\d{4}-\d{2}$", season_text):
        return None
    return _season_text_to_start_year(season_text)


def _row_team_abbr(tr: Any) -> str | None:
    team_cell = tr.select_one(
        'td[data-stat="team_name_abbr"] a, td[data-stat="team_name_abbr"], '
        'td[data-stat="team_id"] a, td[data-stat="team_id"]'
    )
    if team_cell is None:
        return None
    abbr = _clean(team_cell.get_text())
    if not abbr:
        return None
    return abbr.upper()


def _parse_award_tokens(awards_text: str | None) -> list[str]:
    """
    Map BRef Awards-column tokens to award slugs.
    Voting awards are kept only when place == 1 (e.g. MVP-1).
    """
    if not awards_text:
        return []
    out: list[str] = []
    for raw in awards_text.split(","):
        token = raw.strip().upper().replace(" ", "")
        if not token:
            continue
        if token in _AWARD_TOKEN_TO_SLUG:
            out.append(_AWARD_TOKEN_TO_SLUG[token])
            continue
        # Finals MVP appears as "Finals MVP-1" -> FINALSMVP-1 after space strip
        m = re.match(r"^([A-Z0-9]+)-(\d+)$", token)
        if not m:
            continue
        kind, place = m.group(1), int(m.group(2))
        if place != 1:
            continue
        slug = _AWARD_PLACE_WINNERS.get(kind)
        if slug:
            out.append(slug)
    return out


def _parse_totals_rows(soup: BeautifulSoup, _bref_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Returns (per_team_stat_rows, tot_award_rows).
    Per-team rows skip TOT; award-only rows from TOT are returned separately.
    """
    table = None
    for sel in ("table#totals_stats", "table#totals"):
        table = _find_table_including_comments(soup, sel)
        if table is not None:
            break
    if table is None:
        return [], []

    rows: list[dict[str, Any]] = []
    tot_awards: list[dict[str, Any]] = []
    for tr in table.select("tbody tr"):
        if tr.get("class") and "thead" in tr.get("class", []):
            continue
        start_year = _row_season_start_year(tr)
        team_abbr = _row_team_abbr(tr)
        if start_year is None or not team_abbr:
            continue

        awards_text = _cell_text(tr, "awards")
        award_slugs = _parse_award_tokens(awards_text)

        if team_abbr == "TOT":
            if award_slugs:
                tot_awards.append({"start_year": start_year, "awards": award_slugs})
            continue

        rows.append(
            {
                "start_year": start_year,
                "team_abbreviation": team_abbr,
                "games": _parse_int(_cell_text(tr, "games", "g")),
                "games_started": _parse_int(_cell_text(tr, "games_started", "gs")),
                "minutes": _parse_int(_cell_text(tr, "mp")),
                "fg": _parse_int(_cell_text(tr, "fg")),
                "fga": _parse_int(_cell_text(tr, "fga")),
                "fg3": _parse_int(_cell_text(tr, "fg3")),
                "fg3a": _parse_int(_cell_text(tr, "fg3a")),
                "fg2": _parse_int(_cell_text(tr, "fg2")),
                "fg2a": _parse_int(_cell_text(tr, "fg2a")),
                "ft": _parse_int(_cell_text(tr, "ft")),
                "fta": _parse_int(_cell_text(tr, "fta")),
                "orb": _parse_int(_cell_text(tr, "orb")),
                "drb": _parse_int(_cell_text(tr, "drb")),
                "trb": _parse_int(_cell_text(tr, "trb")),
                "ast": _parse_int(_cell_text(tr, "ast")),
                "stl": _parse_int(_cell_text(tr, "stl")),
                "blk": _parse_int(_cell_text(tr, "blk")),
                "tov": _parse_int(_cell_text(tr, "tov")),
                "pf": _parse_int(_cell_text(tr, "pf")),
                "pts": _parse_int(_cell_text(tr, "pts")),
                "fg_pct": _parse_float(_cell_text(tr, "fg_pct")),
                "fg3_pct": _parse_float(_cell_text(tr, "fg3_pct")),
                "fg2_pct": _parse_float(_cell_text(tr, "fg2_pct")),
                "efg_pct": _parse_float(_cell_text(tr, "efg_pct")),
                "ft_pct": _parse_float(_cell_text(tr, "ft_pct")),
                "awards": award_slugs,
            }
        )
    return rows, tot_awards


def _parse_advanced_by_key(soup: BeautifulSoup) -> dict[tuple[int, str], dict[str, float | None]]:
    table = None
    for sel in ("table#advanced", "table#advanced_stats"):
        table = _find_table_including_comments(soup, sel)
        if table is not None:
            break
    if table is None:
        return {}

    out: dict[tuple[int, str], dict[str, float | None]] = {}
    for tr in table.select("tbody tr"):
        if tr.get("class") and "thead" in tr.get("class", []):
            continue
        start_year = _row_season_start_year(tr)
        team_abbr = _row_team_abbr(tr)
        if start_year is None or not team_abbr or team_abbr == "TOT":
            continue
        out[(start_year, team_abbr)] = {
            "ts_pct": _parse_float(_cell_text(tr, "ts_pct")),
            "per": _parse_float(_cell_text(tr, "per")),
            "orb_pct": _parse_float(_cell_text(tr, "orb_pct")),
            "drb_pct": _parse_float(_cell_text(tr, "drb_pct")),
            "trb_pct": _parse_float(_cell_text(tr, "trb_pct")),
            "ast_pct": _parse_float(_cell_text(tr, "ast_pct")),
            "stl_pct": _parse_float(_cell_text(tr, "stl_pct")),
            "blk_pct": _parse_float(_cell_text(tr, "blk_pct")),
            "tov_pct": _parse_float(_cell_text(tr, "tov_pct")),
            "usg_pct": _parse_float(_cell_text(tr, "usg_pct")),
            "ows": _parse_float(_cell_text(tr, "ows")),
            "dws": _parse_float(_cell_text(tr, "dws")),
            "ws": _parse_float(_cell_text(tr, "ws")),
            "ws_per_48": _parse_float(_cell_text(tr, "ws_per_48")),
            "obpm": _parse_float(_cell_text(tr, "obpm")),
            "dbpm": _parse_float(_cell_text(tr, "dbpm")),
            "bpm": _parse_float(_cell_text(tr, "bpm")),
            "vorp": _parse_float(_cell_text(tr, "vorp")),
        }
    return out


def _parse_playoff_finals_mvp(soup: BeautifulSoup, bref_id: str) -> list[BRefAwardRow]:
    table = None
    for sel in (
        "table#totals_stats_post",
        "table#per_game_stats_post",
        "table#playoffs_totals",
        "table#playoffs_totals_stats",
        "table#playoffs_per_game",
    ):
        table = _find_table_including_comments(soup, sel)
        if table is not None:
            break
    if table is None:
        return []

    out: list[BRefAwardRow] = []
    seen: set[int] = set()
    for tr in table.select("tbody tr"):
        if tr.get("class") and "thead" in tr.get("class", []):
            continue
        start_year = _row_season_start_year(tr)
        team_abbr = _row_team_abbr(tr)
        if start_year is None or not team_abbr or team_abbr == "TOT":
            continue
        awards_text = _cell_text(tr, "awards")
        for slug in _parse_award_tokens(awards_text):
            if slug != "finals_mvp":
                continue
            if start_year in seen:
                continue
            seen.add(start_year)
            out.append(
                BRefAwardRow(
                    bref_id=bref_id,
                    award_slug="finals_mvp",
                    start_year=start_year,
                    team_abbreviation=team_abbr,
                )
            )
    return out


def _parse_notable_finals_mvp(soup: BeautifulSoup, bref_id: str) -> list[BRefAwardRow]:
    """Fallback: notable-awards leaderboard lists 'YYYY Finals Most Valuable Player'."""
    block = soup.select_one("#leaderboard_notable-awards")
    if block is None:
        for c in soup.find_all(string=lambda x: isinstance(x, Comment)):
            if "leaderboard_notable-awards" in c:
                inner = BeautifulSoup(c, "lxml")
                block = inner.select_one("#leaderboard_notable-awards")
                if block is not None:
                    break
    if block is None:
        return []

    out: list[BRefAwardRow] = []
    for a in block.select("a[href*='finals_mvp']"):
        text = _clean(a.get_text()) or ""
        # e.g. "2012 Finals Most Valuable Player ..." => end year 2012 => start 2011
        m = re.match(r"^(\d{4})\s+Finals", text)
        if not m:
            continue
        end_year = int(m.group(1))
        out.append(
            BRefAwardRow(
                bref_id=bref_id,
                award_slug="finals_mvp",
                start_year=end_year - 1,
                team_abbreviation=None,
            )
        )
    return out


def _parse_championships(soup: BeautifulSoup, bref_id: str) -> list[BRefAwardRow]:
    """
    BRef championship leaderboard uses league/end year in links (NBA_2012 = 2011-12).
    """
    block = _find_table_including_comments(soup, "#leaderboard_championships")
    # leaderboard is a div, not a table — fall back to comment/DOM search
    if block is None:
        block = soup.select_one("#leaderboard_championships")
        if block is None:
            for c in soup.find_all(string=lambda x: isinstance(x, Comment)):
                if "leaderboard_championships" in c:
                    inner = BeautifulSoup(c, "lxml")
                    block = inner.select_one("#leaderboard_championships")
                    if block is not None:
                        break
    if block is None:
        return []

    out: list[BRefAwardRow] = []
    for a in block.select("a[href*='/teams/']"):
        href = a.get("href") or ""
        m = re.search(r"/teams/([A-Z]{3})/(\d{4})\.html", href)
        if not m:
            continue
        team_abbr = m.group(1).upper()
        end_year = int(m.group(2))
        start_year = end_year - 1
        out.append(
            BRefAwardRow(
                bref_id=bref_id,
                award_slug="championship",
                start_year=start_year,
                team_abbreviation=team_abbr,
            )
        )
    return out


def _parse_all_rookie(soup: BeautifulSoup, bref_id: str) -> list[BRefAwardRow]:
    block = soup.select_one("#leaderboard_all_league")
    if block is None:
        for c in soup.find_all(string=lambda x: isinstance(x, Comment)):
            if "leaderboard_all_league" in c:
                inner = BeautifulSoup(c, "lxml")
                block = inner.select_one("#leaderboard_all_league")
                if block is not None:
                    break
    if block is None:
        return []

    out: list[BRefAwardRow] = []
    for span in block.select("span"):
        text = _clean(span.get_text()) or ""
        m = re.search(r"(\d{4})-(\d{2})\s+All-Rookie\s*\((1st|2nd)\)", text, re.I)
        if not m:
            continue
        start_year = int(m.group(1))
        tier = m.group(3).lower()
        slug = "all_rookie_1" if tier == "1st" else "all_rookie_2"
        out.append(
            BRefAwardRow(
                bref_id=bref_id,
                award_slug=slug,
                start_year=start_year,
                team_abbreviation=None,
            )
        )
    return out


def _primary_team_by_season(totals_rows: list[dict[str, Any]]) -> dict[int, str]:
    """Pick the team with the most games for each season (for awards lacking a team)."""
    best: dict[int, tuple[str, int]] = {}
    for row in totals_rows:
        start_year = int(row["start_year"])
        team = str(row["team_abbreviation"])
        games = int(row.get("games") or 0)
        cur = best.get(start_year)
        if cur is None or games >= cur[1]:
            best[start_year] = (team, games)
    return {year: team for year, (team, _) in best.items()}


async def scrape_player_stats_and_awards(
    bref_id: str,
) -> tuple[list[BRefSeasonStatRow], list[BRefAwardRow]]:
    """
    Fetch a player page once and return per-team season totals (+ advanced) and awards.
    Skips BRef TOT rows.
    """
    first_letter = bref_id[0].lower()
    url = f"{_BREF_BASE}/players/{first_letter}/{bref_id}.html"
    async with httpx.AsyncClient(headers={"User-Agent": "nba-draft-app/1.0"}) as client:
        await asyncio.sleep(0.3)
        html = await _get(client, url)

    soup = BeautifulSoup(html, "lxml")
    totals_rows, tot_awards = _parse_totals_rows(soup, bref_id)
    advanced = _parse_advanced_by_key(soup)

    stats: list[BRefSeasonStatRow] = []
    award_rows: list[BRefAwardRow] = []
    seen_awards: set[tuple[str, int]] = set()

    for row in totals_rows:
        start_year = int(row["start_year"])
        team_abbr = str(row["team_abbreviation"])
        adv = advanced.get((start_year, team_abbr), {})
        stats.append(
            BRefSeasonStatRow(
                bref_id=bref_id,
                start_year=start_year,
                team_abbreviation=team_abbr,
                games=row.get("games"),
                games_started=row.get("games_started"),
                minutes=row.get("minutes"),
                fg=row.get("fg"),
                fga=row.get("fga"),
                fg3=row.get("fg3"),
                fg3a=row.get("fg3a"),
                fg2=row.get("fg2"),
                fg2a=row.get("fg2a"),
                ft=row.get("ft"),
                fta=row.get("fta"),
                orb=row.get("orb"),
                drb=row.get("drb"),
                trb=row.get("trb"),
                ast=row.get("ast"),
                stl=row.get("stl"),
                blk=row.get("blk"),
                tov=row.get("tov"),
                pf=row.get("pf"),
                pts=row.get("pts"),
                fg_pct=row.get("fg_pct"),
                fg3_pct=row.get("fg3_pct"),
                fg2_pct=row.get("fg2_pct"),
                efg_pct=row.get("efg_pct"),
                ft_pct=row.get("ft_pct"),
                ts_pct=adv.get("ts_pct"),
                per=adv.get("per"),
                orb_pct=adv.get("orb_pct"),
                drb_pct=adv.get("drb_pct"),
                trb_pct=adv.get("trb_pct"),
                ast_pct=adv.get("ast_pct"),
                stl_pct=adv.get("stl_pct"),
                blk_pct=adv.get("blk_pct"),
                tov_pct=adv.get("tov_pct"),
                usg_pct=adv.get("usg_pct"),
                ows=adv.get("ows"),
                dws=adv.get("dws"),
                ws=adv.get("ws"),
                ws_per_48=adv.get("ws_per_48"),
                obpm=adv.get("obpm"),
                dbpm=adv.get("dbpm"),
                bpm=adv.get("bpm"),
                vorp=adv.get("vorp"),
            )
        )
        for slug in row.get("awards") or []:
            key = (slug, start_year)
            if key in seen_awards:
                continue
            seen_awards.add(key)
            award_rows.append(
                BRefAwardRow(
                    bref_id=bref_id,
                    award_slug=slug,
                    start_year=start_year,
                    team_abbreviation=team_abbr,
                )
            )

    primary_team = _primary_team_by_season(totals_rows)

    for tot in tot_awards:
        start_year = int(tot["start_year"])
        team = primary_team.get(start_year)
        for slug in tot.get("awards") or []:
            key = (slug, start_year)
            if key in seen_awards:
                continue
            seen_awards.add(key)
            award_rows.append(
                BRefAwardRow(
                    bref_id=bref_id,
                    award_slug=slug,
                    start_year=start_year,
                    team_abbreviation=team,
                )
            )

    for extra in (
        _parse_playoff_finals_mvp(soup, bref_id)
        + _parse_notable_finals_mvp(soup, bref_id)
        + _parse_championships(soup, bref_id)
        + _parse_all_rookie(soup, bref_id)
    ):
        key = (extra.award_slug, extra.start_year)
        if key in seen_awards:
            continue
        team = extra.team_abbreviation or primary_team.get(extra.start_year)
        seen_awards.add(key)
        award_rows.append(
            BRefAwardRow(
                bref_id=bref_id,
                award_slug=extra.award_slug,
                start_year=extra.start_year,
                team_abbreviation=team,
            )
        )

    return stats, award_rows


async def scrape_player_season_stats(bref_id: str) -> list[BRefSeasonStatRow]:
    stats, _awards = await scrape_player_stats_and_awards(bref_id)
    return stats


async def scrape_player_awards(bref_id: str) -> list[BRefAwardRow]:
    _stats, awards = await scrape_player_stats_and_awards(bref_id)
    return awards


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
    try:
        from tqdm.auto import tqdm  # type: ignore[import-not-found]
    except ImportError:  # pragma: no cover
        tqdm = None  # type: ignore

    rows: list[BRefDraftRow] = []
    years = list(range(start_year, end_year + 1))
    it = tqdm(years, desc="Draft years", unit="year", dynamic_ncols=True) if tqdm else years
    for year in it:
        rows.extend(await scrape_draft_year(int(year)))
    return rows


def to_dict(row: Any) -> dict[str, Any]:
    if hasattr(row, "__dict__"):
        return dict(row.__dict__)
    raise TypeError("Unsupported row type")


