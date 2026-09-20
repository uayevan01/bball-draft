"""Career-stat and accolade filters shared by player search and the draft engine."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import Float, and_, exists, func, select

from app.models import Award, Player, PlayerAward, PlayerSeasonStat

COUNTING_STAT_KEYS = ("pts", "trb", "ast", "stl", "blk")
SHOOTING_PCT_KEYS = ("fg_pct", "fg3_pct", "ft_pct")
ACCOLADE_KEYS = ("all_star", "all_nba", "mvp", "championship", "finals_mvp")
STAT_MODES = ("totals", "per_game")
DEFAULT_ALL_NBA_SLUGS = ("all_nba_1", "all_nba_2", "all_nba_3")

_SHOOTING_COLS = {
    "fg_pct": (PlayerSeasonStat.fg, PlayerSeasonStat.fga),
    "fg3_pct": (PlayerSeasonStat.fg3, PlayerSeasonStat.fg3a),
    "ft_pct": (PlayerSeasonStat.ft, PlayerSeasonStat.fta),
}
_ACCOLADE_SLUGS = {
    "all_star": ("all_star",),
    "all_nba": DEFAULT_ALL_NBA_SLUGS,
    "mvp": ("mvp",),
    "championship": ("championship",),
    "finals_mvp": ("finals_mvp",),
}


@dataclass
class StatRange:
    min: float | None = None
    max: float | None = None

    def active(self) -> bool:
        return self.min is not None or self.max is not None


@dataclass
class PlayerStatFilters:
    stat_mode: str = "totals"
    pts: StatRange = field(default_factory=StatRange)
    trb: StatRange = field(default_factory=StatRange)
    ast: StatRange = field(default_factory=StatRange)
    stl: StatRange = field(default_factory=StatRange)
    blk: StatRange = field(default_factory=StatRange)
    games: StatRange = field(default_factory=StatRange)
    fg_pct: StatRange = field(default_factory=StatRange)
    fg3_pct: StatRange = field(default_factory=StatRange)
    ft_pct: StatRange = field(default_factory=StatRange)
    all_star: StatRange = field(default_factory=StatRange)
    all_nba: StatRange = field(default_factory=StatRange)
    mvp: StatRange = field(default_factory=StatRange)
    championship: StatRange = field(default_factory=StatRange)
    finals_mvp: StatRange = field(default_factory=StatRange)
    all_nba_slugs: list[str] = field(default_factory=lambda: list(DEFAULT_ALL_NBA_SLUGS))
    all_star_legacy: bool | None = None
    all_nba_legacy: bool | None = None
    mvp_legacy: bool | None = None
    championship_legacy: bool | None = None
    finals_mvp_legacy: bool | None = None

    def has_career_bounds(self) -> bool:
        return any(
            getattr(self, key).active()
            for key in (*COUNTING_STAT_KEYS, "games", *SHOOTING_PCT_KEYS)
        )

    def has_award_bounds(self) -> bool:
        return any(getattr(self, key).active() for key in ACCOLADE_KEYS) or any(
            (
                self.all_star_legacy,
                self.all_nba_legacy,
                self.mvp_legacy,
                self.championship_legacy,
                self.finals_mvp_legacy,
            )
        )

    def active(self) -> bool:
        return self.has_career_bounds() or self.has_award_bounds()


def career_stat_expr(col: object, *, per_game: bool):
    total = func.coalesce(func.sum(col), 0)
    if not per_game:
        return total
    games = func.nullif(func.coalesce(func.sum(PlayerSeasonStat.games), 0), 0)
    return func.cast(total, Float) / games


def career_pct_expr(makes_col: object, atts_col: object):
    makes = func.cast(func.coalesce(func.sum(makes_col), 0), Float)
    atts = func.cast(func.nullif(func.coalesce(func.sum(atts_col), 0), 0), Float)
    return makes / atts


def career_stat_sort_expr(col: object, *, per_game: bool):
    return (
        select(career_stat_expr(col, per_game=per_game))
        .where(
            PlayerSeasonStat.player_id == Player.id,
            PlayerSeasonStat.is_postseason.is_(False),
        )
        .scalar_subquery()
    )


def award_count_expr(*slugs: str):
    return (
        select(func.count())
        .select_from(PlayerAward)
        .join(Award, Award.id == PlayerAward.award_id)
        .where(PlayerAward.player_id == Player.id, Award.slug.in_(list(slugs)))
        .scalar_subquery()
    )


def has_awards(*slugs: str):
    return exists(
        select(1)
        .select_from(PlayerAward)
        .join(Award, Award.id == PlayerAward.award_id)
        .where(PlayerAward.player_id == Player.id, Award.slug.in_(list(slugs)))
    )


def apply_award_count_bounds(
    stmt,
    *,
    slugs: list[str] | tuple[str, ...],
    min_v: float | None,
    max_v: float | None,
    label: str,
    legacy: bool | None = None,
):
    if min_v is not None and max_v is not None and min_v > max_v:
        raise ValueError(f"min_{label} cannot exceed max_{label}")
    if min_v is None and max_v is None:
        if legacy:
            return stmt.where(has_awards(*slugs))
        return stmt
    expr = award_count_expr(*slugs)
    if min_v is not None:
        stmt = stmt.where(expr >= min_v)
    if max_v is not None:
        stmt = stmt.where(expr <= max_v)
    return stmt


def apply_player_stat_filters(stmt, filters: PlayerStatFilters):
    """
    Restrict a Player-select statement by career counting stats, shooting percentages,
    and accolade counts. Raises ValueError if any min exceeds its max.
    """
    if filters.stat_mode not in STAT_MODES:
        raise ValueError(f"stat_mode must be one of: {', '.join(STAT_MODES)}")

    having_clauses = []
    per_game = filters.stat_mode == "per_game"
    counting = [
        ("pts", filters.pts, PlayerSeasonStat.pts, True),
        ("trb", filters.trb, PlayerSeasonStat.trb, True),
        ("ast", filters.ast, PlayerSeasonStat.ast, True),
        ("stl", filters.stl, PlayerSeasonStat.stl, True),
        ("blk", filters.blk, PlayerSeasonStat.blk, True),
        ("games", filters.games, PlayerSeasonStat.games, False),
    ]
    for label, rng, col, uses_stat_mode in counting:
        if rng.min is not None and rng.max is not None and rng.min > rng.max:
            raise ValueError(f"min_{label} cannot exceed max_{label}")
        expr = career_stat_expr(col, per_game=per_game and uses_stat_mode)
        if rng.min is not None:
            having_clauses.append(expr >= rng.min)
        if rng.max is not None:
            having_clauses.append(expr <= rng.max)

    for label, (makes_col, atts_col) in _SHOOTING_COLS.items():
        rng: StatRange = getattr(filters, label)
        if rng.min is not None and rng.max is not None and rng.min > rng.max:
            raise ValueError(f"min_{label} cannot exceed max_{label}")
        expr = career_pct_expr(makes_col, atts_col)
        if rng.min is not None:
            having_clauses.append(expr >= rng.min)
        if rng.max is not None:
            having_clauses.append(expr <= rng.max)

    if having_clauses:
        career_subq = (
            select(PlayerSeasonStat.player_id)
            .where(PlayerSeasonStat.is_postseason.is_(False))
            .group_by(PlayerSeasonStat.player_id)
            .having(and_(*having_clauses))
        )
        stmt = stmt.where(Player.id.in_(career_subq))

    all_nba_slugs = filters.all_nba_slugs or list(DEFAULT_ALL_NBA_SLUGS)
    award_specs: list[tuple[str, tuple[str, ...] | list[str], StatRange, bool | None]] = [
        ("all_star", _ACCOLADE_SLUGS["all_star"], filters.all_star, filters.all_star_legacy),
        ("all_nba", all_nba_slugs, filters.all_nba, filters.all_nba_legacy),
        ("mvp", _ACCOLADE_SLUGS["mvp"], filters.mvp, filters.mvp_legacy),
        ("championship", _ACCOLADE_SLUGS["championship"], filters.championship, filters.championship_legacy),
        ("finals_mvp", _ACCOLADE_SLUGS["finals_mvp"], filters.finals_mvp, filters.finals_mvp_legacy),
    ]
    for label, slugs, rng, legacy in award_specs:
        stmt = apply_award_count_bounds(
            stmt,
            slugs=slugs,
            min_v=rng.min,
            max_v=rng.max,
            label=label,
            legacy=legacy,
        )
    return stmt


def _num(value: object, *, integer: bool = False) -> float | None:
    if value is None or value == "":
        return None
    try:
        n = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if n != n:  # NaN
        return None
    return float(int(n)) if integer else n


def _range_from_mapping(raw: object, *, integer: bool = False, as_percent: bool = False) -> StatRange:
    data = raw if isinstance(raw, dict) else {}
    mn = _num(data.get("min"), integer=integer)
    mx = _num(data.get("max"), integer=integer)
    if as_percent:
        if mn is not None:
            mn = mn / 100.0
        if mx is not None:
            mx = mx / 100.0
    return StatRange(min=mn, max=mx)


def _mapping(raw: object) -> dict:
    return raw if isinstance(raw, dict) else {}


def percent_to_rate(value: float | None) -> float | None:
    if value is None:
        return None
    return value / 100.0


def filters_from_draft_rules(rules: dict | None) -> PlayerStatFilters:
    """Parse draft-type JSON rules into SQL filters. Shooting bounds are stored as 0–100."""
    rules = rules if isinstance(rules, dict) else {}
    mode = rules.get("stat_mode")
    if mode not in STAT_MODES:
        mode = "per_game"
    career = _mapping(rules.get("career_stat_bounds"))
    shooting = _mapping(rules.get("shooting_bounds"))
    accolades = _mapping(rules.get("accolade_bounds"))
    return PlayerStatFilters(
        stat_mode=str(mode),
        pts=_range_from_mapping(career.get("pts")),
        trb=_range_from_mapping(career.get("trb")),
        ast=_range_from_mapping(career.get("ast")),
        stl=_range_from_mapping(career.get("stl")),
        blk=_range_from_mapping(career.get("blk")),
        fg_pct=_range_from_mapping(shooting.get("fg_pct"), as_percent=True),
        fg3_pct=_range_from_mapping(shooting.get("fg3_pct"), as_percent=True),
        ft_pct=_range_from_mapping(shooting.get("ft_pct"), as_percent=True),
        all_star=_range_from_mapping(accolades.get("all_star"), integer=True),
        all_nba=_range_from_mapping(accolades.get("all_nba"), integer=True),
        mvp=_range_from_mapping(accolades.get("mvp"), integer=True),
        championship=_range_from_mapping(accolades.get("championship"), integer=True),
        finals_mvp=_range_from_mapping(accolades.get("finals_mvp"), integer=True),
    )
