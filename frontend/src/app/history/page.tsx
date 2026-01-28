import { AppShell } from "@/components/AppShell";
import { apiGet } from "@/lib/api";
import type { Draft } from "@/lib/types";

export default async function HistoryPage() {
  let items: Draft[] = [];
  let error: string | null = null;

  try {
    items = await apiGet<Draft[]>("/drafts/history");
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load draft history.";
  }

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
        {items.length === 0 ? (
          <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-black dark:text-zinc-300">
            No drafts yet.
          </div>
        ) : (
          items.map((d) => (
            <a
              key={d.id}
              href={`/draft/${d.id}`}
              className="rounded-xl border border-black/10 bg-white p-4 hover:bg-black/5 dark:border-white/10 dark:bg-black dark:hover:bg-white/10"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="font-semibold">Draft #{d.id}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">{d.status}</div>
              </div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Picks per player: {d.picks_per_player} • Suggestions: {d.show_suggestions ? "on" : "off"}
              </div>
            </a>
          ))
        )}
      </div>
    </AppShell>
  );
}


