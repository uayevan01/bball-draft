import { AppShell } from "@/components/AppShell";
import { apiGet } from "@/lib/api";
import Link from "next/link";

type GameOut = {
  id: number;
  draft_id: number;
  user1_id: string;
  user2_id: string;
  user1_score?: number | null;
  user2_score?: number | null;
  game_mode?: string | null;
  notes?: string | null;
  played_at: string;
};

export default async function GamesPage() {
  let games: GameOut[] = [];
  let error: string | null = null;

  try {
    games = await apiGet<GameOut[]>("/games");
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load games.";
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Games</h2>
        <Link
          href="/games/new"
          className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          Log a game
        </Link>
      </div>
      <p className="mt-2 text-zinc-600 dark:text-zinc-300">Logged NBA 2K games attached to drafts.</p>

      {error ? (
        <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3">
        {games.length === 0 ? (
          <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-black dark:text-zinc-300">
            No games yet.
          </div>
        ) : (
          games.map((g) => (
            <div
              key={g.id}
              className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="font-semibold">Game #{g.id}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">{new Date(g.played_at).toLocaleString()}</div>
              </div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Draft: <a className="underline" href={`/draft/${g.draft_id}`}>View</a> • Mode:{" "}
                {g.game_mode ?? "—"}
              </div>
              <div className="mt-1 text-sm">
                Score: {g.user1_score ?? "—"} - {g.user2_score ?? "—"}
              </div>
              {g.notes ? <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{g.notes}</div> : null}
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}


