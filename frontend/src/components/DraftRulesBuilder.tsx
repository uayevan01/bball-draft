"use client";

import { useMemo } from "react";

import {
  DECADES,
  DIVISIONS,
  type DraftRules,
  type NameLetterConstraint,
  type TeamConstraint,
  type YearConstraint,
  defaultDraftRules,
} from "@/lib/draftRules";

export function DraftRulesBuilder({
  rules,
  onChange,
}: {
  rules: DraftRules;
  onChange: (next: DraftRules) => void;
}) {
  type SpinField = DraftRules["spin_fields"][number];
  const addSpin = (fields: DraftRules["spin_fields"], field: SpinField): DraftRules["spin_fields"] =>
    fields.includes(field) ? fields : [...fields, field];
  const removeSpin = (fields: DraftRules["spin_fields"], field: SpinField): DraftRules["spin_fields"] =>
    fields.filter((x) => x !== field);

  const spinYear = rules.spin_fields.includes("year");
  const spinTeam = rules.spin_fields.includes("team");
  const spinNameLetter = rules.spin_fields.includes("name_letter");

  const yearType = rules.year_constraint.type;
  const teamType = rules.team_constraint.type;
  const nameLetterType = rules.name_letter_constraint.type;

  const specificLettersText = useMemo(() => {
    if (rules.name_letter_constraint.type !== "specific") return "";
    return rules.name_letter_constraint.options.join(",");
  }, [rules.name_letter_constraint]);

  const specificTeamText = useMemo(() => {
    if (rules.team_constraint.type !== "specific") return "";
    return rules.team_constraint.options.join(",");
  }, [rules.team_constraint]);

  return (
    <div className="mt-6 grid gap-6">

      <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
        <div className="text-sm font-semibold">Spin fields</div>
        <div className="mt-3 grid gap-2">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={spinYear}
              onChange={(e) => {
                const next = e.target.checked ? addSpin(rules.spin_fields, "year") : removeSpin(rules.spin_fields, "year");
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
                const next = e.target.checked ? addSpin(rules.spin_fields, "team") : removeSpin(rules.spin_fields, "team");
                onChange({ ...rules, spin_fields: next });
              }}
            />
            Spin a team constraint each pick
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={spinNameLetter}
              onChange={(e) => {
                const next = e.target.checked
                  ? addSpin(rules.spin_fields, "name_letter")
                  : removeSpin(rules.spin_fields, "name_letter");
                onChange({ ...rules, spin_fields: next });
              }}
            />
            Spin a name-letter constraint each pick
          </label>
          
          {rules.spin_fields.includes("year") || rules.spin_fields.includes("team") || rules.spin_fields.includes("name_letter") ?  (
            <>  {/* if spin fields are on, show reroll options */}
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
          </>
          ) : null}
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
              let next: YearConstraint;
              if (t === "any") next = { type: "any", options: null };
              else if (t === "decade") next = { type: "decade", options: ["2000-2009"] };
              else next = { type: "range", options: { startYear: 1980, endYear: 2025 } };
              // else next = { type: "specific", options: [2003] };
              onChange({ ...rules, year_constraint: next });
            }}
          >
            <option value="any">Any year</option>
            <option value="decade">Decades</option>
            <option value="range">Range</option>
            {/* <option value="specific">Specific years</option> */}
          </select>

          {rules.year_constraint.type === "decade" ? (() => {
            const decadeOptions = rules.year_constraint.options;
            return (
            <div className="grid gap-2">
              <div className="text-xs text-zinc-600 dark:text-zinc-300">Select decades</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {DECADES.map((d) => (
                  <label key={d} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={decadeOptions.includes(d)}
                      onChange={(e) => {
                        const opts = e.target.checked
                          ? Array.from(new Set([...decadeOptions, d]))
                          : decadeOptions.filter((x) => x !== d);
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
            );
          })() : null}

          {rules.year_constraint.type === "range" ? (() => {
            const rangeOptions = rules.year_constraint.options;
            return (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <div className="text-xs text-zinc-600 dark:text-zinc-300">Start year</div>
                <input
                  className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
                  type="number"
                  value={rangeOptions.startYear}
                  onChange={(e) =>
                    onChange({
                      ...rules,
                      year_constraint: {
                        type: "range",
                        options: { startYear: Number(e.target.value), endYear: rangeOptions.endYear },
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
                  value={rangeOptions.endYear}
                  onChange={(e) =>
                    onChange({
                      ...rules,
                      year_constraint: {
                        type: "range",
                        options: { startYear: rangeOptions.startYear, endYear: Number(e.target.value) },
                      },
                    })
                  }
                />
              </div>
            </div>
            );
          })() : null}

          {/* {rules.year_constraint.type === "specific" ? (
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
          ) : null} */}
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
              let next: TeamConstraint;
              if (t === "any") next = { type: "any", options: null };
              else if (t === "conference") next = { type: "conference", options: ["East"] };
              else if (t === "division") next = { type: "division", options: ["Atlantic"] };
              else next = { type: "specific", options: ["LAL", "BOS"] };
              onChange({ ...rules, team_constraint: next });
            }}
          >
            <option value="any">Any team</option>
            <option value="conference">Conference (East/West)</option>
            <option value="division">Division</option>
            <option value="specific">Specific teams (abbrev)</option>
          </select>

          {rules.team_constraint.type === "conference" ? (() => {
            const confOptions = rules.team_constraint.options;
            return (
            <div className="flex flex-wrap gap-4">
              {(["East", "West"] as const).map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confOptions.includes(c)}
                    onChange={(e) => {
                      const opts = e.target.checked
                        ? Array.from(new Set([...confOptions, c]))
                        : confOptions.filter((x) => x !== c);
                      onChange({ ...rules, team_constraint: { type: "conference", options: opts } });
                    }}
                  />
                  {c}
                </label>
              ))}
            </div>
            );
          })() : null}

          {rules.team_constraint.type === "division" ? (() => {
            const divOptions = rules.team_constraint.options;
            return (
            <div className="grid gap-2 sm:grid-cols-2">
              {DIVISIONS.map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={divOptions.includes(d)}
                    onChange={(e) => {
                      const opts = e.target.checked
                        ? Array.from(new Set([...divOptions, d]))
                        : divOptions.filter((x) => x !== d);
                      onChange({ ...rules, team_constraint: { type: "division", options: opts } });
                    }}
                  />
                  {d}
                </label>
              ))}
            </div>
            );
          })() : null}

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
        <div className="text-sm font-semibold">Name letter restriction</div>
        <div className="mt-3 grid gap-3">
          <select
            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
            value={nameLetterType}
            onChange={(e) => {
              const t = e.target.value as DraftRules["name_letter_constraint"]["type"];
              let next: NameLetterConstraint;
              if (t === "any") next = { type: "any", options: null };
              else next = { type: "specific", options: ["K"] };
              onChange({ ...rules, name_letter_constraint: next });
            }}
          >
            <option value="any">No restriction</option>
            <option value="specific">Specific letters</option>
          </select>

          <select
            className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
            value={rules.name_letter_part}
            onChange={(e) => onChange({ ...rules, name_letter_part: e.target.value as DraftRules["name_letter_part"] })}
          >
            <option value="first">First name (first word)</option>
            <option value="last">Last name (second word)</option>
            <option value="either">First or last</option>
          </select>

          {rules.name_letter_constraint.type === "specific" ? (
            <div className="grid gap-1">
              <div className="text-xs text-zinc-600 dark:text-zinc-300">Comma-separated letters</div>
              <input
                className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm uppercase tracking-wider dark:border-white/10 dark:bg-black"
                value={specificLettersText}
                onChange={(e) => {
                  const letters = e.target.value
                    .split(",")
                    .map((s) => s.trim().toUpperCase())
                    .filter((s) => /^[A-Z]$/.test(s));
                  onChange({ ...rules, name_letter_constraint: { type: "specific", options: letters } });
                }}
                placeholder="A,B,K"
              />
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Tip: with spinning on, this becomes the allowed pool of letters. With spinning off, it’s a fixed constraint.
              </div>
            </div>
          ) : null}

          {spinNameLetter ? (
            <div className="grid gap-1 sm:max-w-xs">
              <div className="text-xs text-zinc-600 dark:text-zinc-300">Minimum viable players (n)</div>
              <input
                type="number"
                min={1}
                className="h-10 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
                value={rules.name_letter_min_options}
                onChange={(e) =>
                  onChange({ ...rules, name_letter_min_options: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
        <div className="text-sm font-semibold">Player restrictions</div>
        <div className="mt-3 grid gap-2">
        <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={rules.allow_active}
              onChange={(e) => onChange({ ...rules, allow_active: e.target.checked })}
            />
            Allow active (unretired) players
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={rules.allow_retired}
              onChange={(e) => onChange({ ...rules, allow_retired: e.target.checked })}
            />
            Allow retired players
          </label>
          {!rules.allow_active && !rules.allow_retired ? (
            <div className="text-xs text-red-700 dark:text-red-300">Warning: with both off, no players will be eligible.</div>
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


