"use client";

import Image from "next/image";

import type { EligibilityConstraint, PlayerSearchResult, SpinPreviewTeam } from "./types";
import { HoverTooltip } from "./HoverTooltip";

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
  spinPreviewDecades,
  spinPreviewTeams,
  spinPreviewLetters,
  spinPreviewPlayers,
  rollStageDecadeLabel,
  constraints,
  rollCount,
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
  rollStage: null | "idle" | "spinning_decade" | "spinning_team" | "spinning_letter" | "spinning_player";
  spinPreviewDecades: Array<string | null>;
  spinPreviewTeams: Array<SpinPreviewTeam | null>;
  spinPreviewLetters: Array<string | null>;
  spinPreviewPlayers: Array<PlayerSearchResult | null>;
  rollStageDecadeLabel: string | null;
  constraints: EligibilityConstraint[] | null;
  rollCount: number;
}) {
  const constraint = constraints?.[0] ?? null;
  const segments = constraint?.teams ?? [];
  const segmentCount = segments.length;
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

  // (grouping for team segments is now computed per option when rendering multi-roll constraints)

  return (
    <div className="relative rounded-xl border border-black/10 bg-white p-4 pb-4 dark:border-white/10 dark:bg-zinc-900/50">
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
              <div className="relative w-full h-[240px] overflow-y-auto overscroll-contain rounded-2xl px-5 pt-10 pb-4 text-center">
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
                  <div className="min-h-full grid content-center justify-items-center gap-3">
                    <div className="flex flex-wrap items-center justify-center gap-4">
                      {Array.from({ length: Math.max(1, rollCount || 1) }).map(
                        (_, i) => {
                          const team = spinPreviewTeams[i] ?? null;
                          const decade = spinPreviewDecades[i] ?? null;
                          const letter = spinPreviewLetters[i] ?? null;
                          const player = spinPreviewPlayers[i] ?? null;
                          const opt = constraints?.[i] ?? null;
                          const lastTeamLogo =
                            opt?.teams?.length ? opt.teams[opt.teams.length - 1]?.team?.logo_url ?? null : null;
                          const lastTeamName = opt?.teams?.length ? opt.teams[opt.teams.length - 1]?.team?.name ?? "Team" : "Team";
                          return (
                            <div key={i} className="grid justify-items-center gap-2">
                              {rollStage === "spinning_team" ? (
                                team?.logo_url ? (
                                  <Image src={team.logo_url} alt={team.name} width={72} height={72} className="h-[72px] w-[72px] object-contain" />
                                ) : (
                                  <div className="h-[72px] w-[72px]" />
                                )
                              ) : rollStage === "spinning_letter" ? (
                                lastTeamLogo ? (
                                  <Image src={lastTeamLogo} alt={lastTeamName} width={72} height={72} className="h-[72px] w-[72px] object-contain" />
                                ) : (
                                  <div className="h-[72px] w-[72px]" />
                                )
                              ) : rollStage === "spinning_player" ? (
                                <div className="flex items-center gap-2">
                                  {lastTeamLogo ? (
                                    <Image src={lastTeamLogo} alt={lastTeamName} width={72} height={72} className="h-[72px] w-[72px] object-contain" />
                                  ) : (
                                    <div className="h-[72px] w-[72px]" />
                                  )}
                                  <Image
                                    src={player?.image_url ?? "/avatar-placeholder.svg"}
                                    alt={player?.name ?? "Player"}
                                    width={72}
                                    height={72}
                                    className="h-[72px] w-[72px] rounded-2xl object-contain"
                                  />
                                </div>
                              ) : (
                                <div className="h-[72px] w-[72px]" />
                              )}

                              <div className="text-sm font-semibold text-zinc-950 dark:text-white">
                                {rollStage === "spinning_decade"
                                  ? decade ?? "Any"
                                  : rollStage === "spinning_team"
                                    ? team?.name ?? "Any"
                                    : rollStage === "spinning_letter"
                                      ? letter ?? "Any"
                                      : rollStage === "spinning_player"
                                        ? player?.name ?? "Any"
                                        : "Any"}
                              </div>
                            </div>
                          );
                        },
                      )}
                    </div>
                    <div className="text-xs font-semibold tracking-wide text-zinc-600 dark:text-zinc-300">
                      {rollStage === "spinning_decade"
                        ? "SPINNING YEAR"
                        : rollStage === "spinning_team"
                          ? "SPINNING TEAM"
                          : rollStage === "spinning_letter"
                            ? "SPINNING LETTER"
                            : "SPINNING PLAYER"}
                    </div>
                    <div className="text-sm text-zinc-700 dark:text-zinc-200">
                      {rollStage === "spinning_team" ? (
                        `(${rollStageDecadeLabel ?? constraint?.yearLabel ?? "Any"})`
                      ) : rollStage === "spinning_letter" ? (
                        (() => {
                          const year = constraint?.yearLabel ?? "Any";
                          const seg = constraint?.teams?.length ? constraint.teams[constraint.teams.length - 1] : null;
                          const team = seg?.team?.abbreviation ?? seg?.team?.name ?? "Any";
                          return `Year: ${year} • Team: ${team}`;
                        })()
                      ) : rollStage === "spinning_player" ? (
                        (() => {
                          const year = constraint?.yearLabel ?? "Any";
                          const seg = constraint?.teams?.length ? constraint.teams[constraint.teams.length - 1] : null;
                          const team = seg?.team?.abbreviation ?? seg?.team?.name ?? "Any";
                          const letter = constraint?.nameLetter ?? "Any";
                          return `Year: ${year} • Team: ${team} • Letter: ${letter}`;
                        })()
                      ) : (
                        " "
                      )}
                    </div>
                  </div>
                ) : constraints?.length ? (
                  <div className="min-h-full grid content-center justify-items-center gap-3">
                    <div className="flex flex-wrap items-stretch justify-center gap-3">
                      {constraints.map((c, idx) => {
                        const segs = c.teams ?? [];
                        const byId = new Map<number, { previous_team_id?: number | null }>();
                        for (const s of segs) byId.set(s.team.id, { previous_team_id: s.team.previous_team_id ?? null });
                        const groups = new Map<number, typeof segs>();
                        for (const s of segs) {
                          const root = resolveFranchiseRootId(s.team.id, byId);
                          const arr = groups.get(root) ?? [];
                          arr.push(s);
                          groups.set(root, arr);
                        }
                        const grouped = Array.from(groups.entries())
                          .sort(([a], [b]) => a - b)
                          .map(([, xs]) =>
                            xs.sort((x, y) => {
                              const ax = x.team.founded_year ?? 9999;
                              const ay = y.team.founded_year ?? 9999;
                              if (ax !== ay) return ax - ay;
                              return x.team.name.localeCompare(y.team.name);
                            }),
                          );

                        return (
                          <div
                            key={idx}
                            className="min-w-[220px] rounded-2xl border border-black/10 bg-white/40 p-3 dark:border-white/10 dark:bg-zinc-900/30"
                          >
                            <div className="flex flex-wrap items-center justify-center gap-3">
                              {grouped.map((fr, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  {fr.map((seg) => (
                                    <HoverTooltip key={seg.team.id} label={seg.team.name} className="grid justify-items-center gap-1">
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
                                    </HoverTooltip>
                                  ))}
                                </div>
                              ))}
                              {c.player ? (
                                <HoverTooltip label={c.player.name} className="grid justify-items-center gap-1">
                                  <Image
                                    src={c.player.image_url ?? "/avatar-placeholder.svg"}
                                    alt={c.player.name}
                                    width={sizePx}
                                    height={sizePx}
                                    className="rounded-2xl object-contain"
                                    style={{ width: sizePx, height: sizePx }}
                                  />
                                </HoverTooltip>
                              ) : null}
                            </div>
                            <div className="mt-3 text-center text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                              {(c.yearLabel ?? "No constraint") === "No constraint" ? "Any year" : (c.yearLabel ?? "Any year")}
                            </div>
                            {c.nameLetter ? (
                              <div className="mt-1 text-center text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                {(c.namePart ?? "first")}={c.nameLetter.toUpperCase()}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : showBigRoll ? (
                  <div className="flex min-h-full items-center justify-center">
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
                  <div className="flex min-h-full items-center justify-center text-sm text-zinc-600 dark:text-zinc-300">
                    Waiting for other player to spin
                  </div>
                ) : (
                  <div className="flex min-h-full items-center justify-center text-sm text-zinc-600 dark:text-zinc-300">
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
        <div className="absolute bottom-3 left-4 right-4 text-center text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {infoMessage}
        </div>
      ) : null}
    </div>
  );
}


