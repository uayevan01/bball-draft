"use client";

import Image from "next/image";

import type { RollConstraint, SpinPreviewTeam } from "./types";

export function MainInfoCard({
  currentTurnName,
  isLocal,
  infoMessage,
  needsConstraint,
  canRoll,
  rollButtonLabel,
  rollDisabled,
  onRoll,
  isSpinning,
  rollStage,
  spinPreviewDecade,
  spinPreviewTeam,
  rollStageDecadeLabel,
  rollConstraint,
}: {
  currentTurnName: string;
  isLocal: boolean;
  infoMessage: string | null;
  needsConstraint: boolean;
  canRoll: boolean;
  rollButtonLabel: string;
  rollDisabled: boolean;
  onRoll: () => void;
  isSpinning: boolean;
  rollStage: null | "idle" | "spinning_decade" | "spinning_team";
  spinPreviewDecade: string | null;
  spinPreviewTeam: SpinPreviewTeam | null;
  rollStageDecadeLabel: string | null;
  rollConstraint: RollConstraint | null;
}) {
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
          {needsConstraint && canRoll ? (
            <button
              type="button"
              onClick={onRoll}
              disabled={rollDisabled}
              className="h-10 rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              {rollButtonLabel}
            </button>
          ) : null}
          {!needsConstraint && canRoll ? (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">No roll required for this draft type.</div>
          ) : null}
        </div>
      </div>

      {needsConstraint ? (
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
            ) : rollConstraint ? (
              <div className="grid justify-items-center gap-2">
                {rollConstraint.team.logo_url ? (
                  <Image
                    src={rollConstraint.team.logo_url}
                    alt={rollConstraint.team.name}
                    width={72}
                    height={72}
                    className="h-[72px] w-[72px] rounded-2xl object-contain"
                  />
                ) : (
                  <div className="h-[72px] w-[72px] rounded-2xl border border-black/10 bg-white/60 dark:border-white/10 dark:bg-zinc-900/60" />
                )}
                <div className="text-xs font-semibold tracking-wide text-zinc-600 dark:text-zinc-300">CONSTRAINT</div>
                <div className="text-xl font-bold text-zinc-950 dark:text-white">{rollConstraint.team.name}</div>
                <div className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{rollConstraint.decadeLabel}</div>
              </div>
            ) : (
              <div className="text-sm text-zinc-600 dark:text-zinc-300">Constraint: click Roll to spin decade + team.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}


