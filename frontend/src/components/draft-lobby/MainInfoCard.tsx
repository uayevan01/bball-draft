"use client";

import Image from "next/image";

import type { EligibilityConstraint, SpinPreviewTeam } from "./types";

export function MainInfoCard({
  currentTurnName,
  isLocal,
  infoMessage,
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
  rollStageDecadeLabel,
  constraint,
}: {
  currentTurnName: string;
  isLocal: boolean;
  infoMessage: string | null;
  showRollButton: boolean;
  canRoll: boolean;
  rollButtonLabel: string;
  rollDisabled: boolean;
  onRoll: () => void;
  showConstraint: boolean;
  isSpinning: boolean;
  rollStage: null | "idle" | "spinning_decade" | "spinning_team";
  spinPreviewDecade: string | null;
  spinPreviewTeam: SpinPreviewTeam | null;
  rollStageDecadeLabel: string | null;
  constraint: EligibilityConstraint | null;
}) {
  const segments = constraint?.teams ?? [];
  const segmentCount = segments.length;
  const showNames = segmentCount <= 4;
  const sizePx = segmentCount <= 2 ? 72 : segmentCount <= 4 ? 56 : segmentCount <= 8 ? 44 : 36;

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
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <div className="min-w-0 text-center md:text-left">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Current turn</div>
          <div className="mt-1 text-sm font-semibold text-zinc-950 dark:text-white">
            {currentTurnName}
            {isLocal ? <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">(local)</span> : null}
          </div>
          {infoMessage ? <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">{infoMessage}</div> : null}
        </div>

        <div className="flex flex-none items-center justify-center gap-2 md:justify-end">
          {showRollButton && canRoll ? (
            <button
              type="button"
              onClick={onRoll}
              disabled={rollDisabled}
              className="h-10 rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              {rollButtonLabel}
            </button>
          ) : null}
        </div>
      </div>

      {showConstraint ? (
        <div className="mt-4 flex justify-center">
          <div className="w-full max-w-3xl rounded-2xl border border-black/10 bg-black/5 px-5 py-4 text-center dark:border-white/10 dark:bg-white/10">
            {isSpinning ? (
              <div className="grid justify-items-center gap-2">
                {rollStage === "spinning_team" && spinPreviewTeam?.logo_url ? (
                  <Image
                    src={spinPreviewTeam.logo_url}
                    alt={spinPreviewTeam.name}
                    width={64}
                    height={64}
                    className="h-16 w-16 rounded-xl object-contain"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-xl border border-black/10 bg-white/60 dark:border-white/10 dark:bg-zinc-900/60" />
                )}
                <div className="text-xs font-semibold tracking-wide text-zinc-600 dark:text-zinc-300">
                  {rollStage === "spinning_decade" ? "SPINNING DECADE" : "SPINNING TEAM"}
                </div>
                <div className="text-lg font-semibold text-zinc-950 dark:text-white">
                  {rollStage === "spinning_decade" ? spinPreviewDecade ?? "—" : spinPreviewTeam?.name ?? "—"}
                </div>
                <div className="text-sm text-zinc-700 dark:text-zinc-200">
                  {rollStage === "spinning_team" ? `(${rollStageDecadeLabel ?? "—"})` : " "}
                </div>
              </div>
            ) : constraint ? (
              <div className="grid justify-items-center gap-2">
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {groupedSegments.map((segs, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {segs.map((seg) => (
                        <div key={seg.team.id} className="grid justify-items-center gap-1">
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
                            <div className="max-w-[10rem] truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">
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
                <div className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{constraint.yearLabel ?? "Any year"}</div>
              </div>
            ) : (
              <div className="text-sm text-zinc-600 dark:text-zinc-300">
                {showRollButton ? "Constraint: click Roll to spin." : "Constraint: loading…"}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}


