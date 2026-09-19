"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

import { DraftCreateForm } from "@/components/DraftCreateForm";
import { JoinDraftById } from "@/components/JoinDraftById";
import { backendGet } from "@/lib/backendClient";
import type { DraftType } from "@/lib/types";

export function StartDraftPanel({ className }: { className?: string }) {
  const { getToken } = useAuth();
  const [draftTypes, setDraftTypes] = useState<DraftType[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setError(null);
      try {
        const token = await getToken().catch(() => null);
        const items = await backendGet<DraftType[]>("/draft-types?sort=usage", token);
        if (!cancelled) setDraftTypes(items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load draft types.");
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return (
    <section
      className={`flex min-h-0 flex-col rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black sm:p-5 ${className ?? ""}`}
    >
      <h2 className="text-lg font-semibold tracking-tight">Start a draft</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
        Pick a draft type, create a lobby, or jump in with a draft ID.
      </p>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <DraftCreateForm draftTypes={draftTypes} />

      <div className="mt-6 border-t border-black/10 pt-5 dark:border-white/10">
        <JoinDraftById />
      </div>
    </section>
  );
}
