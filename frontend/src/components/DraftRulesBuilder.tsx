"use client";

import { useMemo } from "react";

import { DECADES, DIVISIONS, type DraftRules, defaultDraftRules } from "@/lib/draftRules";

export function DraftRulesBuilder({
  rules,
  onChange,
}: {
  rules: DraftRules;
  onChange: (next: DraftRules) => void;
}) {
  const spinYear = rules.spin_fields.includes("year");
  const spinTeam = rules.spin_fields.includes("team");

  const yearType = rules.year_constraint.type;
  const teamType = rules.team_constraint.type;

  const specificTeamText = useMemo(() => {
    if (rules.team_constraint.type !== "specific") return "";
    return rules.team_constraint.options.join(",");
  }, [rules.team_constraint]);

  return (
    <div className="mt-6 grid gap-6">
      <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
        <div className="text-sm font-semibold">Supported rules</div>
        <div className="mt-2 grid gap-1 text-sm text-zinc-600 dark:text-zinc-300">
          <div>- Spin fields (year/team)</div>
          <div>- Year restriction (any, decade, range, specific years)</div>
          <div>- Team restriction (any, conference, division, specific teams)</div>
          <div>- Rerolls + max rerolls</div>
          <div>- Snake draft toggle</div>
          <div>- Suggestions toggle</div>
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
        <div className="text-sm font-semibold">Spin fields</div>
        <div className="mt-3 grid gap-2">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={spinYear}
              onChange={(e) => {
                const next = e.target.checked
                  ? Array.from(new Set([...rules.spin_fields, "year"]))
                  : rules.spin_fields.filter((x) => x !== "year");
                onChange({ ...rules, spin_fields: next });
              }}
            />
            Spin a year constraint each pick
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={spinTeam}
              onChange={(e) => {
                const next = e.target.checked
                  ? Array.from(new Set([...rules.spin_fields, "team"]))
                  : rules.spin_fields.filter((x) => x !== "team");
                onChange({ ...rules, spin_fields: next });
              }}
            />
            Spin a team constraint each pick
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
        <div className="text-sm font-semibold">Year restriction</div>
        <div className="mt-3 grid gap-3">
          <select
            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
            value={yearType}
            onChange={(e) => {
              const t = e.target.value as DraftRules["year_constraint"]["type"];
              const next =
                t === "any"
                  ? { type: "any", options: null }
                  : t === "decade"
                    ? { type: "decade", options: ["2000-2009"] }
                    : t === "range"
                      ? { type: "range", options: { startYear: 1980, endYear: 2025 } }
                      : { type: "specific", options: [2003] };
              onChange({ ...rules, year_constraint: next });
            }}
          >
            <option value="any">Any year</option>
            <option value="decade">Decades</option>
            <option value="range">Range</option>
            <option value="specific">Specific years</option>
          </select>

          {rules.year_constraint.type === "decade" ? (
            <div className="grid gap-2">
              <div className="text-xs text-zinc-600 dark:text-zinc-300">Select decades</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {DECADES.map((d) => (
                  <label key={d} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={rules.year_constraint.options.includes(d)}
                      onChange={(e) => {
                        const opts = e.target.checked
                          ? Array.from(new Set([...rules.year_constraint.options, d]))
                          : rules.year_constraint.options.filter((x) => x !== d);
                        onChange({
                          ...rules,
                          year_constraint: { type: "decade", options: opts },
                        });
                      }}
                    />
                    {d}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {rules.year_constraint.type === "range" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <div className="text-xs text-zinc-600 dark:text-zinc-300">Start year</div>
                <input
                  className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
                  type="number"
                  value={rules.year_constraint.options.startYear}
                  onChange={(e) =>
                    onChange({
                      ...rules,
                      year_constraint: {
                        type: "range",
                        options: { ...rules.year_constraint.options, startYear: Number(e.target.value) },
                      },
                    })
                  }
                />
              </div>
              <div className="grid gap-1">
                <div className="text-xs text-zinc-600 dark:text-zinc-300">End year</div>
                <input
                  className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
                  type="number"
                  value={rules.year_constraint.options.endYear}
                  onChange={(e) =>
                    onChange({
                      ...rules,
                      year_constraint: {
                        type: "range",
                        options: { ...rules.year_constraint.options, endYear: Number(e.target.value) },
                      },
                    })
                  }
                />
              </div>
            </div>
          ) : null}

          {rules.year_constraint.type === "specific" ? (
            <div className="grid gap-1">
              <div className="text-xs text-zinc-600 dark:text-zinc-300">Comma-separated years</div>
              <input
                className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
                value={rules.year_constraint.options.join(",")}
                onChange={(e) => {
                  const years = e.target.value
                    .split(",")
                    .map((s) => Number(s.trim()))
                    .filter((n) => Number.isFinite(n) && n > 0);
                  onChange({ ...rules, year_constraint: { type: "specific", options: years } });
                }}
                placeholder="2003,2010,2018"
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
        <div className="text-sm font-semibold">Team restriction</div>
        <div className="mt-3 grid gap-3">
          <select
            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
            value={teamType}
            onChange={(e) => {
              const t = e.target.value as DraftRules["team_constraint"]["type"];
              const next =
                t === "any"
                  ? { type: "any", options: null }
                  : t === "conference"
                    ? { type: "conference", options: ["East"] }
                    : t === "division"
                      ? { type: "division", options: ["Atlantic"] }
                      : { type: "specific", options: ["LAL", "BOS"] };
              onChange({ ...rules, team_constraint: next });
            }}
          >
            <option value="any">Any team</option>
            <option value="conference">Conference (East/West)</option>
            <option value="division">Division</option>
            <option value="specific">Specific teams (abbrev)</option>
          </select>

          {rules.team_constraint.type === "conference" ? (
            <div className="flex flex-wrap gap-4">
              {(["East", "West"] as const).map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rules.team_constraint.options.includes(c)}
                    onChange={(e) => {
                      const opts = e.target.checked
                        ? Array.from(new Set([...rules.team_constraint.options, c]))
                        : rules.team_constraint.options.filter((x) => x !== c);
                      onChange({ ...rules, team_constraint: { type: "conference", options: opts } });
                    }}
                  />
                  {c}
                </label>
              ))}
            </div>
          ) : null}

          {rules.team_constraint.type === "division" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {DIVISIONS.map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rules.team_constraint.options.includes(d)}
                    onChange={(e) => {
                      const opts = e.target.checked
                        ? Array.from(new Set([...rules.team_constraint.options, d]))
                        : rules.team_constraint.options.filter((x) => x !== d);
                      onChange({ ...rules, team_constraint: { type: "division", options: opts } });
                    }}
                  />
                  {d}
                </label>
              ))}
            </div>
          ) : null}

          {rules.team_constraint.type === "specific" ? (
            <div className="grid gap-1">
              <div className="text-xs text-zinc-600 dark:text-zinc-300">Comma-separated team abbreviations</div>
              <input
                className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
                value={specificTeamText}
                onChange={(e) => {
                  const teams = e.target.value
                    .split(",")
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean);
                  onChange({ ...rules, team_constraint: { type: "specific", options: teams } });
                }}
                placeholder="CLE,MIA,LAL"
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
        <div className="text-sm font-semibold">Draft mechanics</div>
        <div className="mt-3 grid gap-2">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={rules.snake_draft}
              onChange={(e) => onChange({ ...rules, snake_draft: e.target.checked })}
            />
            Snake draft order
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={rules.show_suggestions}
              onChange={(e) => onChange({ ...rules, show_suggestions: e.target.checked })}
            />
            Show player suggestions
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={rules.allow_reroll}
              onChange={(e) => onChange({ ...rules, allow_reroll: e.target.checked })}
            />
            Allow rerolls
          </label>
          <div className="grid gap-1 sm:max-w-xs">
            <div className="text-xs text-zinc-600 dark:text-zinc-300">Max rerolls</div>
            <input
              className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
              type="number"
              min={0}
              max={50}
              value={rules.max_rerolls}
              onChange={(e) => onChange({ ...rules, max_rerolls: Number(e.target.value) })}
              disabled={!rules.allow_reroll}
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        className="inline-flex h-10 items-center justify-center rounded-full border border-black/10 px-4 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        onClick={() => onChange(defaultDraftRules())}
      >
        Reset to defaults
      </button>
    </div>
  );
}


