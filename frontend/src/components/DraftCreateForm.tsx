"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";

import { backendPost } from "@/lib/backendClient";
import type { Draft, DraftType } from "@/lib/types";
import { SearchableSelect } from "@/components/SearchableSelect";

export function DraftCreateForm({ draftTypes }: { draftTypes: DraftType[] }) {
  const router = useRouter();
  const { getToken } = useAuth();

  // No default selection: force the user to explicitly choose a draft type.
  const [draftTypeId, setDraftTypeId] = useState<number | null>(null);
  const [picksPerPlayer, setPicksPerPlayer] = useState<number>(10);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(true);
  const [localMode, setLocalMode] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onCreate() {
    setError(null);
    if (!draftTypeId) {
      setError("Pick a draft type first.");
      return;
    }
    setIsSubmitting(true);
    try {
      const token = await getToken().catch(() => null);
      const draft = await backendPost<Draft>(
        "/drafts",
        {
          draft_type_id: draftTypeId,
          picks_per_player: picksPerPlayer,
          show_suggestions: showSuggestions,
        },
        token,
      );
      router.push(`/draft/${draft.public_id}${localMode ? "?local=1" : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create draft.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-6 grid gap-6">
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Draft type</label>
          <Link href="/draft-types" className="text-sm text-zinc-600 hover:text-zinc-950 dark:text-zinc-300">
            Manage draft types
          </Link>
        </div>
        <SearchableSelect<DraftType>
          items={draftTypes}
          value={draftTypeId}
          onChange={(dt) => setDraftTypeId(dt ? dt.id : null)}
          getKey={(dt) => dt.id}
          getLabel={(dt) => dt.name}
          placeholder="Select a draft type"
          searchPlaceholder="Search draft types…"
          emptyText="No matches"
          disabled={draftTypes.length === 0}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="grid gap-2">
          <label className="text-sm font-medium">Picks per player</label>
          <input
            className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
            type="number"
            min={1}
            max={30}
            value={picksPerPlayer}
            onChange={(e) => setPicksPerPlayer(Number(e.target.value))}
          />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <label className="text-sm font-medium">Suggestions</label>
          <label className="flex h-11 items-center gap-3 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black">
            <input
              type="checkbox"
              checked={showSuggestions}
              onChange={(e) => setShowSuggestions(e.target.checked)}
            />
            Show player suggestions during drafting
          </label>
        </div>
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-3 text-sm dark:border-white/10 dark:bg-black">
        <input type="checkbox" checked={localMode} onChange={(e) => setLocalMode(e.target.checked)} />
        Local 2-player mode (host + guest on this device)
      </label>

      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onCreate}
        disabled={isSubmitting || draftTypes.length === 0}
        className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {isSubmitting ? "Creating…" : "Create lobby"}
      </button>
    </div>
  );
}


