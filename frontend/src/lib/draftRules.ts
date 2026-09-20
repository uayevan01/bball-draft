import type { PlayerAwardCounts, PlayerCareerStats } from "@/lib/playerTypes";

export type YearConstraint =
  | { type: "any"; options: null }
  | { type: "decade"; options: string[] }
  | { type: "range"; options: { startYear: number; endYear: number } }
  | { type: "specific"; options: number[] };

export type TeamConstraint =
  | { type: "any"; options: null }
  | { type: "conference"; options: ("East" | "West")[] }
  | { type: "division"; options: string[] }
  | { type: "specific"; options: string[] }; // team abbreviations

export type NameLetterConstraint =
  | { type: "any"; options: null }
  | { type: "specific"; options: string[] }; // letters like ["K","M"]

export type NameLetterPart = "first" | "last" | "either";

export type StatMode = "totals" | "per_game";

export type RangeBound = { min: number | null; max: number | null };

export type CareerStatKey = "pts" | "trb" | "ast" | "stl" | "blk";
export type ShootingKey = "fg_pct" | "fg3_pct" | "ft_pct";
export type AccoladeKey = "all_star" | "all_nba" | "mvp" | "championship" | "finals_mvp";

export type CareerStatBounds = Record<CareerStatKey, RangeBound>;
export type ShootingBounds = Record<ShootingKey, RangeBound>;
export type AccoladeBounds = Record<AccoladeKey, RangeBound>;

export type DraftRules = {
  spin_fields: ("year" | "team" | "name_letter" | "player")[];
  roll_count: number; // number of parallel roll options per turn (1..5)
  year_constraint: YearConstraint;
  team_constraint: TeamConstraint;
  name_letter_constraint: NameLetterConstraint;
  name_letter_part: NameLetterPart;
  name_letter_min_options: number; // for spinner: minimum number of viable letters (>=1)
  allow_active: boolean;
  allow_retired: boolean;
  // Player constraint: number of team stints in career (consecutive same-franchise stints coalesce).
  min_team_stints: number | null;
  max_team_stints: number | null;
  stat_mode: StatMode;
  career_stat_bounds: CareerStatBounds;
  shooting_bounds: ShootingBounds;
  accolade_bounds: AccoladeBounds;
  allow_reroll: boolean;
  max_rerolls: number;
  snake_draft: boolean;
  show_suggestions: boolean;
};

export const DECADES = ["1950-1959", "1960-1969", "1970-1979", "1980-1989", "1990-1999", "2000-2009", "2010-2019", "2020-2029"] as const;

export const DIVISIONS = ["Atlantic", "Central", "Southeast", "Northwest", "Pacific", "Southwest"] as const;

export const CAREER_STAT_FIELDS: Array<{ key: CareerStatKey; label: string; totalShort: string; perGameShort: string }> = [
  { key: "pts", label: "Points", totalShort: "PTS", perGameShort: "PPG" },
  { key: "trb", label: "Rebounds", totalShort: "TRB", perGameShort: "RPG" },
  { key: "ast", label: "Assists", totalShort: "AST", perGameShort: "APG" },
  { key: "stl", label: "Steals", totalShort: "STL", perGameShort: "SPG" },
  { key: "blk", label: "Blocks", totalShort: "BLK", perGameShort: "BPG" },
];

export const SHOOTING_FIELDS: Array<{ key: ShootingKey; label: string; param: string }> = [
  { key: "fg_pct", label: "FG%", param: "fg_pct" },
  { key: "fg3_pct", label: "3P%", param: "fg3_pct" },
  { key: "ft_pct", label: "FT%", param: "ft_pct" },
];

export const ACCOLADE_FIELDS: Array<{ key: AccoladeKey; label: string; minParam: string; maxParam: string }> = [
  { key: "all_star", label: "All-Star", minParam: "min_all_star", maxParam: "max_all_star" },
  { key: "all_nba", label: "All-NBA", minParam: "min_all_nba", maxParam: "max_all_nba" },
  { key: "mvp", label: "MVP", minParam: "min_mvp", maxParam: "max_mvp" },
  { key: "championship", label: "Rings", minParam: "min_championship", maxParam: "max_championship" },
  { key: "finals_mvp", label: "Finals MVPs", minParam: "min_finals_mvp", maxParam: "max_finals_mvp" },
];

export function emptyRangeBound(): RangeBound {
  return { min: null, max: null };
}

export function defaultCareerStatBounds(): CareerStatBounds {
  return {
    pts: emptyRangeBound(),
    trb: emptyRangeBound(),
    ast: emptyRangeBound(),
    stl: emptyRangeBound(),
    blk: emptyRangeBound(),
  };
}

export function defaultShootingBounds(): ShootingBounds {
  return {
    fg_pct: emptyRangeBound(),
    fg3_pct: emptyRangeBound(),
    ft_pct: emptyRangeBound(),
  };
}

export function defaultAccoladeBounds(): AccoladeBounds {
  return {
    all_star: emptyRangeBound(),
    all_nba: emptyRangeBound(),
    mvp: emptyRangeBound(),
    championship: emptyRangeBound(),
    finals_mvp: emptyRangeBound(),
  };
}

export function rangeIsActive(bound?: RangeBound | null): boolean {
  return typeof bound?.min === "number" || typeof bound?.max === "number";
}

function mergeRange(base: RangeBound, extra?: Partial<RangeBound> | null): RangeBound {
  return {
    min: extra && "min" in extra ? extra.min ?? null : base.min,
    max: extra && "max" in extra ? extra.max ?? null : base.max,
  };
}

export function defaultDraftRules(): DraftRules {
  return {
    spin_fields: ["year", "team"],
    roll_count: 1,
    year_constraint: { type: "any", options: null },
    team_constraint: { type: "any", options: null },
    name_letter_constraint: { type: "any", options: null },
    name_letter_part: "first",
    name_letter_min_options: 1,
    allow_active: true,
    allow_retired: true,
    min_team_stints: null,
    max_team_stints: null,
    stat_mode: "per_game",
    career_stat_bounds: defaultCareerStatBounds(),
    shooting_bounds: defaultShootingBounds(),
    accolade_bounds: defaultAccoladeBounds(),
    allow_reroll: true,
    max_rerolls: 3,
    snake_draft: true,
    show_suggestions: true,
  };
}

export function normalizeDraftRules(partial?: Partial<DraftRules> | null): DraftRules {
  const base = defaultDraftRules();
  if (!partial) return base;
  const career = partial.career_stat_bounds ?? defaultCareerStatBounds();
  const shooting = partial.shooting_bounds ?? defaultShootingBounds();
  const accolades = partial.accolade_bounds ?? defaultAccoladeBounds();
  return {
    ...base,
    ...partial,
    career_stat_bounds: {
      pts: mergeRange(base.career_stat_bounds.pts, career.pts),
      trb: mergeRange(base.career_stat_bounds.trb, career.trb),
      ast: mergeRange(base.career_stat_bounds.ast, career.ast),
      stl: mergeRange(base.career_stat_bounds.stl, career.stl),
      blk: mergeRange(base.career_stat_bounds.blk, career.blk),
    },
    shooting_bounds: {
      fg_pct: mergeRange(base.shooting_bounds.fg_pct, shooting.fg_pct),
      fg3_pct: mergeRange(base.shooting_bounds.fg3_pct, shooting.fg3_pct),
      ft_pct: mergeRange(base.shooting_bounds.ft_pct, shooting.ft_pct),
    },
    accolade_bounds: {
      all_star: mergeRange(base.accolade_bounds.all_star, accolades.all_star),
      all_nba: mergeRange(base.accolade_bounds.all_nba, accolades.all_nba),
      mvp: mergeRange(base.accolade_bounds.mvp, accolades.mvp),
      championship: mergeRange(base.accolade_bounds.championship, accolades.championship),
      finals_mvp: mergeRange(base.accolade_bounds.finals_mvp, accolades.finals_mvp),
    },
    stat_mode: partial.stat_mode === "totals" ? "totals" : "per_game",
  };
}

export function rulesHaveStatConstraints(rules?: Partial<DraftRules> | null): boolean {
  if (!rules) return false;
  const career = Object.values(rules.career_stat_bounds ?? {}).some(rangeIsActive);
  const shooting = Object.values(rules.shooting_bounds ?? {}).some(rangeIsActive);
  const accolades = Object.values(rules.accolade_bounds ?? {}).some(rangeIsActive);
  return career || shooting || accolades;
}

export function appendStatFilterParams(
  params: URLSearchParams,
  opts: {
    statMode?: StatMode | null;
    careerStatBounds?: CareerStatBounds | null;
    shootingBounds?: ShootingBounds | null;
    accoladeBounds?: AccoladeBounds | null;
  },
): void {
  const careerActive = Object.values(opts.careerStatBounds ?? {}).some(rangeIsActive);
  if (careerActive && opts.statMode) params.set("stat_mode", opts.statMode);
  for (const field of CAREER_STAT_FIELDS) {
    const bound = opts.careerStatBounds?.[field.key];
    if (typeof bound?.min === "number") params.set(`min_${field.key}`, String(bound.min));
    if (typeof bound?.max === "number") params.set(`max_${field.key}`, String(bound.max));
  }
  for (const field of SHOOTING_FIELDS) {
    const bound = opts.shootingBounds?.[field.key];
    if (typeof bound?.min === "number") params.set(`min_${field.param}`, String(bound.min));
    if (typeof bound?.max === "number") params.set(`max_${field.param}`, String(bound.max));
  }
  for (const field of ACCOLADE_FIELDS) {
    const bound = opts.accoladeBounds?.[field.key];
    if (typeof bound?.min === "number") params.set(field.minParam, String(bound.min));
    if (typeof bound?.max === "number") params.set(field.maxParam, String(bound.max));
  }
}

function formatBound(label: string, bound?: RangeBound | null): string | null {
  if (!rangeIsActive(bound)) return null;
  if (typeof bound?.min === "number" && typeof bound?.max === "number") return `${label}:${bound.min}-${bound.max}`;
  if (typeof bound?.min === "number") return `${label}:≥${bound.min}`;
  if (typeof bound?.max === "number") return `${label}:≤${bound.max}`;
  return null;
}

export function summarizeRules(rules: Partial<DraftRules> | undefined): string {
  if (!rules) return "—";
  const parts: string[] = [];

  const spins = Array.isArray(rules.spin_fields) ? rules.spin_fields.join("+") : null;
  if (spins) parts.push(`spin:${spins}`);

  const yc = rules.year_constraint;
  if (yc) {
    if (yc.type === "any") parts.push("year:any");
    if (yc.type === "decade") parts.push(`year:${yc.options.join(",") || "decade"}`);
    if (yc.type === "range") parts.push(`year:${yc.options?.startYear}-${yc.options?.endYear}`);
    if (yc.type === "specific") parts.push(`year:${yc.options.join(",")}`);
  }

  const tc = rules.team_constraint;
  if (tc) {
    if (tc.type === "any") parts.push("team:any");
    if (tc.type === "conference") parts.push(`team:${tc.options.join(",") || "conference"}`);
    if (tc.type === "division") parts.push(`team:${tc.options.join(",") || "division"}`);
    if (tc.type === "specific") parts.push(`team:${tc.options.join(",") || "specific"}`);
  }

  const nc = rules.name_letter_constraint;
  const np = rules.name_letter_part;
  if (nc) {
    if (nc.type === "any") parts.push("name:any");
    if (nc.type === "specific") parts.push(`name:${nc.options.join(",") || "letter"}`);
    if (np) parts.push(`part:${np}`);
  }

  if (typeof rules.allow_active === "boolean" || typeof rules.allow_retired === "boolean") {
    const a = rules.allow_active !== false;
    const r = rules.allow_retired !== false;
    const label = a && r ? "any" : a ? "active" : r ? "retired" : "none";
    parts.push(`pool:${label}`);
  }

  if (typeof rules.allow_reroll === "boolean") {
    parts.push(`reroll:${rules.allow_reroll ? `yes(${rules.max_rerolls ?? 0})` : "no"}`);
  }
  if (typeof rules.min_team_stints === "number") parts.push(`stints:≥${rules.min_team_stints}`);
  if (typeof rules.max_team_stints === "number") parts.push(`stints:≤${rules.max_team_stints}`);

  const perGame = rules.stat_mode !== "totals";
  for (const field of CAREER_STAT_FIELDS) {
    const formatted = formatBound(perGame ? field.perGameShort : field.totalShort, rules.career_stat_bounds?.[field.key]);
    if (formatted) parts.push(formatted);
  }
  for (const field of SHOOTING_FIELDS) {
    const formatted = formatBound(field.label, rules.shooting_bounds?.[field.key]);
    if (formatted) parts.push(formatted);
  }
  for (const field of ACCOLADE_FIELDS) {
    const formatted = formatBound(field.label, rules.accolade_bounds?.[field.key]);
    if (formatted) parts.push(formatted);
  }

  if (typeof rules.snake_draft === "boolean") parts.push(`snake:${rules.snake_draft ? "yes" : "no"}`);
  if (typeof rules.show_suggestions === "boolean") parts.push(`suggest:${rules.show_suggestions ? "yes" : "no"}`);

  return parts.join(" • ") || "—";
}

function inRange(value: number | null | undefined, bound?: RangeBound | null): boolean {
  if (!rangeIsActive(bound)) return true;
  if (value == null || Number.isNaN(value)) return false;
  if (typeof bound?.min === "number" && value < bound.min) return false;
  if (typeof bound?.max === "number" && value > bound.max) return false;
  return true;
}

function countingValue(stats: PlayerCareerStats | null | undefined, key: CareerStatKey, mode: StatMode): number | null {
  const total = stats?.[key];
  if (total == null) return null;
  if (mode !== "per_game") return total;
  const games = stats?.games;
  if (games == null || games <= 0) return null;
  return total / games;
}

export function playerMatchesStatConstraints(
  stats: PlayerCareerStats | null | undefined,
  awards: PlayerAwardCounts | null | undefined,
  opts: {
    statMode?: StatMode | null;
    careerStatBounds?: CareerStatBounds | null;
    shootingBounds?: ShootingBounds | null;
    accoladeBounds?: AccoladeBounds | null;
  },
): boolean {
  const mode = opts.statMode === "totals" ? "totals" : "per_game";
  for (const field of CAREER_STAT_FIELDS) {
    if (!inRange(countingValue(stats, field.key, mode), opts.careerStatBounds?.[field.key])) return false;
  }
  for (const field of SHOOTING_FIELDS) {
    const bound = opts.shootingBounds?.[field.key];
    if (!rangeIsActive(bound)) continue;
    const rate = stats?.[field.key];
    const pct = rate == null ? null : rate * 100;
    if (!inRange(pct, bound)) return false;
  }
  const counts = awards ?? {};
  const accoladeValue: Record<AccoladeKey, number> = {
    all_star: counts.all_star ?? 0,
    all_nba: counts.all_nba ?? 0,
    mvp: counts.mvp ?? 0,
    championship: counts.championship ?? 0,
    finals_mvp: counts.finals_mvp ?? 0,
  };
  for (const field of ACCOLADE_FIELDS) {
    if (!inRange(accoladeValue[field.key], opts.accoladeBounds?.[field.key])) return false;
  }
  return true;
}
