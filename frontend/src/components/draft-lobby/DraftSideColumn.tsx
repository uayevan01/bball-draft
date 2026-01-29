"use client";

import Image from "next/image";

import type { DraftPickWs } from "./types";

export function DraftSideColumn({
  label,
  name,
  avatarUrl,
  isYourTurn,
  picks,
  renderPick,
  emptyText,
}: {
  label: "Host" | "Guest";
  name: string;
  avatarUrl: string | null;
  isYourTurn: boolean;
  picks: DraftPickWs[];
  renderPick: (p: DraftPickWs) => React.ReactNode;
  emptyText: string;
}) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/50">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Image
            src={avatarUrl || "/avatar-placeholder.svg"}
            alt={name}
            width={28}
            height={28}
            className="h-7 w-7 flex-none rounded-full object-cover"
          />
          <span className="truncate">{name}</span>
          {isYourTurn ? (
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">YOUR TURN</span>
          ) : null}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      </div>
      <div className="mt-3 grid gap-2">
        {picks.length ? picks.map((p) => renderPick(p)) : <div className="text-sm text-zinc-600 dark:text-zinc-300">{emptyText}</div>}
      </div>
    </div>
  );
}


