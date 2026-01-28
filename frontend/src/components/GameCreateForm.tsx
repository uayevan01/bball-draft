"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";

import { backendPost } from "@/lib/backendClient";

type GameOut = {
  id: number;
};

export function GameCreateForm() {
  const router = useRouter();
  const { getToken } = useAuth();

  const [draftId, setDraftId] = useState<number>(0);
  const [userScore, setUserScore] = useState<number | "">("");
  const [oppScore, setOppScore] = useState<number | "">("");
  const [mode, setMode] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!draftId) return setError("Draft ID is required.");

    setIsSubmitting(true);
    try {
      const token = await getToken().catch(() => null);
      await backendPost<GameOut>(
        "/games",
        {
          draft_id: draftId,
          user1_score: userScore === "" ? null : userScore,
          user2_score: oppScore === "" ? null : oppScore,
          game_mode: mode.trim() || null,
          notes: notes.trim() || null,
        },
        token,
      );
      router.push("/games");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create game.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-6 grid gap-6">
      <div className="grid gap-2">
        <div className="grid gap-2">
          <label className="text-sm font-medium">Draft ID</label>
          <input
            className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
            type="number"
            min={1}
            value={draftId || ""}
            onChange={(e) => setDraftId(Number(e.target.value))}
            placeholder="123"
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <label className="text-sm font-medium">Your score</label>
          <input
            className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
            type="number"
            min={0}
            value={userScore}
            onChange={(e) => setUserScore(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        <div className="grid gap-2">
          <label className="text-sm font-medium">Opponent score</label>
          <input
            className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
            type="number"
            min={0}
            value={oppScore}
            onChange={(e) => setOppScore(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium">Mode</label>
        <input
          className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          placeholder="Play Now / MyNBA / Online"
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium">Notes</label>
        <textarea
          className="min-h-24 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-black"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting}
        className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {isSubmitting ? "Saving…" : "Save game"}
      </button>
    </div>
  );
}


