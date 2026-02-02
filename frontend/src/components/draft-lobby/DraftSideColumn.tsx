"use client";

import Image from "next/image";

import type { DraftPickWs } from "./types";

export function DraftSideColumn({
  label,
  name,
  avatarUrl,
  thisPlayerTurn,
  connectionState,
  rerollsDisplay,
  picks,
  renderPick,
  totalSlots,
}: {
  label: "Host" | "Guest";
  name: string;
  avatarUrl: string | null;
  thisPlayerTurn: boolean;
  connectionState?: "connected" | "disconnected" | "empty";
  rerollsDisplay?: { remaining: number; max: number } | null;
  picks: DraftPickWs[];
  renderPick: (p: DraftPickWs, slotNumber: number) => React.ReactNode;
  totalSlots: number;
}) {
  const sorted = [...picks].sort((a, b) => a.pick_number - b.pick_number);
  const ringClass =
    connectionState === "connected"
      ? "ring-3 ring-emerald-500"
      : connectionState === "empty"
        ? "ring-3 ring-zinc-500/40"
        : "ring-3 ring-red-500";
  const ringTitle =
    connectionState === "connected" ? "Connected" : connectionState === "empty" ? "Slot empty" : "Disconnected";
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/50">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Image
            src={avatarUrl || "/avatar-placeholder.svg"}
            alt={name}
            width={28}
            height={28}
            title={ringTitle}
            className={`h-7 w-7 flex-none rounded-full object-cover ${ringClass}`}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold">{name}</span>
              {thisPlayerTurn ? (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">CHOOSING</span>
              ) : null}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
          </div>
        </div>
        {rerollsDisplay ? (
          <div
            className={`text-xs font-semibold tabular-nums ${
              rerollsDisplay.remaining > 0 ? "text-emerald-400" : "text-red-400"
            }`}
            title="Rerolls remaining"
          >
            {rerollsDisplay.remaining}/{rerollsDisplay.max}
          </div>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2">
        {Array.from({ length: Math.max(0, totalSlots) }).map((_, idx) => {
          const p = sorted[idx];
          if (p) return renderPick(p, idx + 1);
          return (
            <div
              key={`empty-${idx}`}
              className="w-full rounded-xl border border-dashed border-black/15 bg-white px-3 py-2 text-left text-sm text-zinc-500 dark:border-white/15 dark:bg-zinc-900/40 dark:text-zinc-400"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate">
                  <span className="mr-2 text-xs">#{idx + 1}</span>
                  Empty slot
                </div>
                <div className="text-xs">—</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


