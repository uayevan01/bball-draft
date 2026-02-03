"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth, useUser } from "@clerk/nextjs";

import { AppShell } from "@/components/AppShell";
import { backendGet } from "@/lib/backendClient";
import type { Draft } from "@/lib/types";

function opponentDisplayForDraft(d: Draft, myClerkId: string | null) {
  const isMeHost = !!myClerkId && d.host?.clerk_id === myClerkId;
  const isMeGuest = !!myClerkId && d.guest?.clerk_id === myClerkId;

  // Local guest: a second player slot with no signed-in user.
  if (isMeHost && !d.guest_id) {
    return { name: "Local guest", avatarUrl: null };
  }

  const opponent = isMeGuest ? d.host : isMeHost ? d.guest : null;
  const fallbackUser = d.guest ?? d.host ?? null;
  const u = opponent ?? fallbackUser;
  const name = u?.username ?? u?.full_name ?? u?.email ?? (u?.clerk_id ? `User ${u.clerk_id}` : "—");
  const avatarUrl = u?.avatar_url ?? null;
  return { name, avatarUrl };
}

export default function HistoryPage() {
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const [items, setItems] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const myClerkId = clerkUser?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken().catch(() => null);
        const data = await backendGet<Draft[]>("/drafts/history?limit=100", token);
        if (!cancelled) setItems(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load draft history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return (
    <AppShell>
      <h2 className="text-2xl font-semibold tracking-tight">Draft history</h2>
      <p className="mt-2 text-zinc-600 dark:text-zinc-300">Your recent drafts.</p>

      {error ? (
        <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3">
        {loading ? (
          <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-black dark:text-zinc-300">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-black dark:text-zinc-300">
            No drafts yet.
          </div>
        ) : (
          items.map((d) => (
            <Link
              key={d.id}
              href={`/draft/${d.public_id}`}
              className="rounded-xl border border-black/10 bg-white p-4 hover:bg-black/5 dark:border-white/10 dark:bg-black dark:hover:bg-white/10"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="font-semibold">{d.name || "Draft"}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">{d.status}</div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                <span className="text-zinc-500 dark:text-zinc-400">vs</span>
                {(() => {
                  const opp = opponentDisplayForDraft(d, myClerkId);
                  return (
                    <>
                      <Image
                        src={opp.avatarUrl || "/avatar-placeholder.svg"}
                        alt={opp.name}
                        width={18}
                        height={18}
                        className="h-[18px] w-[18px] rounded-full object-cover"
                      />
                      <span className="truncate font-medium">{opp.name}</span>
                    </>
                  );
                })()}
              </div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Picks per player: {d.picks_per_player} • Suggestions: {d.show_suggestions ? "on" : "off"}
              </div>
            </Link>
          ))
        )}
      </div>
    </AppShell>
  );
}


