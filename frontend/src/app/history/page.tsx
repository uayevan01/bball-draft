"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";

import { AppShell } from "@/components/AppShell";
import { backendGet } from "@/lib/backendClient";
import type { Draft } from "@/lib/types";

export default function HistoryPage() {
  const { getToken } = useAuth();
  const [items, setItems] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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


