"use client";

import Image from "next/image";

import type { EligibilityConstraint, SpinPreviewTeam } from "./types";

export function MainInfoCard({
  isLocal,
  infoMessage,
  draftComplete,
  showRollButton,
  canRoll,
  rollButtonLabel,
  rollDisabled,
  onRoll,
  showConstraint,
  isSpinning,
  rollStage,
  spinPreviewDecade,
  spinPreviewTeam,
  spinPreviewLetter,
  rollStageDecadeLabel,
  constraint,
}: {
  currentTurnName: string;
  isLocal: boolean;
  infoMessage: string | null;
  draftComplete?: boolean;
  showRollButton: boolean;
  canRoll: boolean;
  rollButtonLabel: string;
  rollDisabled: boolean;
  onRoll: () => void;
  showConstraint: boolean;
  isSpinning: boolean;
  rollStage: null | "idle" | "spinning_decade" | "spinning_team" | "spinning_letter";
  spinPreviewDecade: string | null;
  spinPreviewTeam: SpinPreviewTeam | null;
  spinPreviewLetter: string | null;
  rollStageDecadeLabel: string | null;
  constraint: EligibilityConstraint | null;
}) {
  const segments = constraint?.teams ?? [];
  const segmentCount = segments.length;
  const showNames = segmentCount <= 4;
  const sizePx = segmentCount <= 2 ? 96 : segmentCount <= 4 ? 72 : segmentCount <= 8 ? 56 : 44;

  function resolveFranchiseRootId(teamId: number, byId: Map<number, { previous_team_id?: number | null }>): number {
    let cur = teamId;
    const seen = new Set<number>();
    while (!seen.has(cur)) {
      seen.add(cur);
      const t = byId.get(cur);
      const prev = t?.previous_team_id ?? null;
      if (!prev) break;
      if (!byId.has(prev)) break;
      cur = prev;
    }
    return cur;
  }

  const groupedSegments = (() => {
    if (!constraint) return [];
    const byId = new Map<number, { previous_team_id?: number | null }>();
    for (const s of segments) byId.set(s.team.id, { previous_team_id: s.team.previous_team_id ?? null });
    const groups = new Map<number, typeof segments>();
    for (const s of segments) {
      const root = resolveFranchiseRootId(s.team.id, byId);
      const arr = groups.get(root) ?? [];
      arr.push(s);
      groups.set(root, arr);
    }
    // Sort groups and segments for stable UI
    const groupArr = Array.from(groups.entries())
      .sort(([a], [b]) => a - b)
      .map(([, segs]) =>
        segs.sort((x, y) => {
          const ax = x.team.founded_year ?? 9999;
          const ay = y.team.founded_year ?? 9999;
          if (ax !== ay) return ax - ay;
          return x.team.name.localeCompare(y.team.name);
        }),
      );
    return groupArr;
  })();

  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/50">
      {/* NOTE: Intentionally hiding "Current turn" + whose turn it is for now (redundant with other UI). */}
      {draftComplete ? (
        <div className="grid gap-3">
          <div className="min-w-0 text-center md:text-left">
            <div className="mt-1 text-sm font-semibold text-zinc-950 dark:text-white">
              Draft Complete
              {isLocal ? <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">(local)</span> : null}
            </div>
          </div>
        </div>
      ) : null}

      {!draftComplete && showConstraint ? (
        <div className="mt-4">
          {(() => {
            const showBigRoll = !isSpinning && !constraint && showRollButton && canRoll;
            const showWaiting = !isSpinning && !constraint && showRollButton && !canRoll;
            const showRerollOverlay = !isSpinning && Boolean(constraint) && showRollButton && canRoll;

            return (
              <div className="relative w-full min-h-[120px] rounded-2xl px-5 py-4 text-center">
                {/* Reroll lives as an overlay when a constraint exists */}
                {showRerollOverlay ? (
                  <div className="absolute right-4 top-4">
                    <button
                      type="button"
                      onClick={onRoll}
                      disabled={rollDisabled}
                      className={`h-10 rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200 transition-transform will-change-transform ${
                        rollDisabled ? "" : "subtle-pulse"
                      }`}
                    >
                      {rollButtonLabel}
                    </button>
                  </div>
                ) : null}

                {/* Main content */}
                {isSpinning ? (
                  <div className="grid justify-items-center gap-2">
                    {rollStage === "spinning_team" && spinPreviewTeam?.logo_url ? (
                      <Image
                        src={spinPreviewTeam.logo_url}
                        alt={spinPreviewTeam.name}
                        width={96}
                        height={96}
                        className="h-24 w-24 object-contain"
                      />
                    ) : rollStage === "spinning_letter" && constraint?.teams?.length ? (
                      (() => {
                        const seg = constraint.teams[constraint.teams.length - 1];
                        const logo = seg?.team?.logo_url ?? null;
                        const name = seg?.team?.name ?? "Team";
                        return logo ? (
                          <Image src={logo} alt={name} width={96} height={96} className="h-24 w-24 object-contain" />
                        ) : (
                          <div className="h-24 w-24" />
                        );
                      })()
                    ) : (
                      <div className="h-24 w-24" />
                    )}
                    <div className="text-xs font-semibold tracking-wide text-zinc-600 dark:text-zinc-300">
                      {rollStage === "spinning_decade"
                        ? "SPINNING YEAR"
                        : rollStage === "spinning_team"
                          ? "SPINNING TEAM"
                          : "SPINNING LETTER"}
                    </div>
                    <div className="text-lg font-semibold text-zinc-950 dark:text-white">
                      {rollStage === "spinning_decade"
                        ? spinPreviewDecade ?? "—"
                        : rollStage === "spinning_team"
                          ? spinPreviewTeam?.name ?? "—"
                          : spinPreviewLetter ?? "—"}
                    </div>
                    <div className="text-sm text-zinc-700 dark:text-zinc-200">
                      {rollStage === "spinning_team" ? (
                        `(${rollStageDecadeLabel ?? constraint?.yearLabel ?? "—"})`
                      ) : rollStage === "spinning_letter" ? (
                        (() => {
                          const year = constraint?.yearLabel ?? "—";
                          const seg = constraint?.teams?.length ? constraint.teams[constraint.teams.length - 1] : null;
                          const team = seg?.team?.abbreviation ?? seg?.team?.name ?? "—";
                          return `Year: ${year} • Team: ${team}`;
                        })()
                      ) : (
                        " "
                      )}
                    </div>
                  </div>
                ) : constraint ? (
                  <div className="grid justify-items-center gap-2">
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      {groupedSegments.map((segs, i) => (
                        <div key={i} className="flex items-center gap-2">
                          {segs.map((seg) => (
                            <div
                              key={seg.team.id}
                              className="group relative grid justify-items-center gap-1"
                              title={seg.team.name}
                            >
                              {/* Instant tooltip (avoid browser title delay) */}
                              <div className="pointer-events-none absolute -top-2 left-1/2 z-20 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-zinc-950 px-2 py-1 text-[11px] font-semibold text-white shadow-md group-hover:block dark:bg-white dark:text-black">
                                {seg.team.name}
                              </div>
                              {seg.team.logo_url ? (
                                <Image
                                  src={seg.team.logo_url}
                                  alt={seg.team.name}
                                  width={sizePx}
                                  height={sizePx}
                                  className="rounded-2xl object-contain"
                                  style={{ width: sizePx, height: sizePx }}
                                />
                              ) : (
                                <div
                                  className="rounded-2xl border border-black/10 bg-white/60 dark:border-white/10 dark:bg-zinc-900/60"
                                  style={{ width: sizePx, height: sizePx }}
                                />
                              )}
                              {showNames ? (
                                <div className="max-w-40 truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                                  {seg.team.name}
                                </div>
                              ) : null}
                              {seg.startYear != null && seg.endYear != null ? (
                                <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                                  {String(seg.startYear).slice(-2)}-{String(seg.endYear).slice(-2)}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{constraint.yearLabel ?? "No constraint"}</div>
                    {constraint.nameLetter ? (
                      <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                        {(constraint.namePart ?? "first")} name starts with{" "}
                        <span className="font-bold text-zinc-950 dark:text-white">{constraint.nameLetter.toUpperCase()}</span>
                      </div>
                    ) : null}
                  </div>
                ) : showBigRoll ? (
                  <div className="flex min-h-[120px] items-center justify-center">
                    <button
                      type="button"
                      onClick={onRoll}
                      disabled={rollDisabled}
                      className={`h-12 w-full max-w-sm rounded-full bg-zinc-950 px-8 text-base font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200 transition-transform will-change-transform ${
                        rollDisabled ? "" : "subtle-pulse"
                      }`}
                    >
                      {rollButtonLabel}
                    </button>
                  </div>
                ) : showWaiting ? (
                  <div className="flex min-h-[120px] items-center justify-center text-sm text-zinc-600 dark:text-zinc-300">
                    Waiting for other player to spin
                  </div>
                ) : (
                  <div className="flex min-h-[120px] items-center justify-center text-sm text-zinc-600 dark:text-zinc-300">
                    Constraint loading…
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      ) : null}

      {/* Ephemeral info message (moved to bottom, under constraints) */}
      {!draftComplete && infoMessage ? (
        <div className="mt-3 text-center text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {infoMessage}
        </div>
      ) : null}
    </div>
  );
}


