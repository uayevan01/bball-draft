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

export type DraftRules = {
  spin_fields: ("year" | "team")[];
  year_constraint: YearConstraint;
  team_constraint: TeamConstraint;
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

  const yc = rules.year_constraint as YearConstraint | undefined;
  if (yc) {
    if (yc.type === "any") parts.push("year:any");
    if (yc.type === "decade") parts.push(`year:${(yc.options ?? []).join(",") || "decade"}`);
    if (yc.type === "range") parts.push(`year:${yc.options?.startYear}-${yc.options?.endYear}`);
    if (yc.type === "specific") parts.push(`year:${(yc.options ?? []).join(",")}`);
  }

  const tc = rules.team_constraint as TeamConstraint | undefined;
  if (tc) {
    if (tc.type === "any") parts.push("team:any");
    if (tc.type === "conference") parts.push(`team:${(tc.options ?? []).join(",") || "conference"}`);
    if (tc.type === "division") parts.push(`team:${(tc.options ?? []).join(",") || "division"}`);
    if (tc.type === "specific") parts.push(`team:${(tc.options ?? []).join(",") || "specific"}`);
  }

  if (typeof rules.allow_reroll === "boolean") {
    parts.push(`reroll:${rules.allow_reroll ? `yes(${rules.max_rerolls ?? 0})` : "no"}`);
  }
  if (typeof rules.snake_draft === "boolean") parts.push(`snake:${rules.snake_draft ? "yes" : "no"}`);
  if (typeof rules.show_suggestions === "boolean") parts.push(`suggest:${rules.show_suggestions ? "yes" : "no"}`);

  return parts.join(" • ") || "—";
}


