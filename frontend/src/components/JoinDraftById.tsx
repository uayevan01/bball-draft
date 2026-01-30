"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export function JoinDraftById() {
  const router = useRouter();
  const [draftId, setDraftId] = useState("");

  const trimmed = useMemo(() => draftId.trim(), [draftId]);

  return (
    <div className="mt-6 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
      <div className="text-sm font-semibold">Join by ID</div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
        Paste a draft ID (UUID or numeric) and jump straight into the lobby.
      </p>

      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed) return;
          router.push(`/draft/${encodeURIComponent(trimmed)}`);
        }}
      >
        <input
          value={draftId}
          onChange={(e) => setDraftId(e.target.value)}
          placeholder="e.g. 5afbfc99-16e3-4e1c-9329-7626d245520e"
          className="h-10 w-full rounded-full border border-black/10 bg-white px-4 text-sm text-zinc-950 placeholder:text-zinc-400 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          disabled={!trimmed}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          Join
        </button>
      </form>
    </div>
  );
}


