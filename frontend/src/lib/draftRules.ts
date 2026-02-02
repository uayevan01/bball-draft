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

export type DraftRules = {
  spin_fields: ("year" | "team" | "name_letter")[];
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
  allow_reroll: boolean;
  max_rerolls: number;
  snake_draft: boolean;
  show_suggestions: boolean;
};

export const DECADES = ["1950-1959", "1960-1969", "1970-1979", "1980-1989", "1990-1999", "2000-2009", "2010-2019", "2020-2029"] as const;

export const DIVISIONS = ["Atlantic", "Central", "Southeast", "Northwest", "Pacific", "Southwest"] as const;

export function defaultDraftRules(): DraftRules {
  return {
    spin_fields: ["year", "team"],
    year_constraint: { type: "any", options: null },
    team_constraint: { type: "any", options: null },
    name_letter_constraint: { type: "any", options: null },
    name_letter_part: "first",
    name_letter_min_options: 1,
    allow_active: true,
    allow_retired: true,
    min_team_stints: null,
    max_team_stints: null,
    allow_reroll: true,
    max_rerolls: 3,
    snake_draft: true,
    show_suggestions: true,
  };
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
  if (typeof rules.snake_draft === "boolean") parts.push(`snake:${rules.snake_draft ? "yes" : "no"}`);
  if (typeof rules.show_suggestions === "boolean") parts.push(`suggest:${rules.show_suggestions ? "yes" : "no"}`);

  return parts.join(" • ") || "—";
}


