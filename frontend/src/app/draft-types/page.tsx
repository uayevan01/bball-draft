import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { apiGet } from "@/lib/api";
import { summarizeRules } from "@/lib/draftRules";
import type { DraftType } from "@/lib/types";

export default async function DraftTypesPage() {
  let items: DraftType[] = [];
  let error: string | null = null;

  try {
    items = await apiGet<DraftType[]>("/draft-types");
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load draft types.";
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Draft types</h2>
        <Link
          href="/draft-types/new"
          className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          New draft type
        </Link>
      </div>

      {error ? (
        <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3">
        {items.length === 0 ? (
          <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-black dark:text-zinc-300">
            No draft types yet.
          </div>
        ) : (
          items.map((dt) => (
            <div
              key={dt.id}
              className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold">{dt.name}</div>
                  {dt.description ? (
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{dt.description}</div>
                  ) : null}
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {summarizeRules(dt.rules)}
                  </div>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">{dt.is_public ? "Public" : "Private"}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}


