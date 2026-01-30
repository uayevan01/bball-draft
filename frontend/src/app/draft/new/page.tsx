"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

import { AppShell } from "@/components/AppShell";
import { DraftCreateForm } from "@/components/DraftCreateForm";
import { backendGet } from "@/lib/backendClient";
import type { DraftType } from "@/lib/types";

export default function NewDraftPage() {
  const { getToken } = useAuth();
  const [draftTypes, setDraftTypes] = useState<DraftType[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setError(null);
      try {
        const token = await getToken().catch(() => null);
        const items = await backendGet<DraftType[]>("/draft-types", token);
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
    <AppShell>
      <h2 className="text-2xl font-semibold tracking-tight">Create draft</h2>
      <p className="mt-2 text-zinc-600 dark:text-zinc-300">Choose a draft type and create a lobby.</p>

      {error ? (
        <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <DraftCreateForm draftTypes={draftTypes} />
    </AppShell>
  );
}


