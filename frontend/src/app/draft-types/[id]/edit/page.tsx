"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

import { AppShell } from "@/components/AppShell";
import { DraftRulesBuilder } from "@/components/DraftRulesBuilder";
import { backendGet, backendPatch } from "@/lib/backendClient";
import { defaultDraftRules, type DraftRules } from "@/lib/draftRules";
import type { DraftType } from "@/lib/types";

export default function DraftTypeEditPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { getToken } = useAuth();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [rules, setRules] = useState<DraftRules>(defaultDraftRules());
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!id) return;
      setError(null);
      setLoading(true);
      try {
        const token = await getToken().catch(() => null);
        const dt = await backendGet<DraftType>(`/draft-types/${encodeURIComponent(id)}`, token);
        if (!cancelled) {
          setName(dt.name ?? "");
          setDescription(dt.description ?? "");
          setIsPublic(Boolean(dt.is_public));
          setRules({ ...defaultDraftRules(), ...((dt.rules as Partial<DraftRules>) ?? {}) });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load draft type.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [id, getToken]);

  async function onSubmit() {
    if (!id) return;
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setIsSubmitting(true);
    try {
      const token = await getToken().catch(() => null);
      await backendPatch<DraftType>(
        `/draft-types/${encodeURIComponent(id)}`,
        {
          name: name.trim(),
          description: description.trim() || null,
          rules,
          is_public: isPublic,
        },
        token,
      );
      router.push("/draft-types");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update draft type.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Edit draft type</h2>
      </div>

      {loading ? (
        <div className="mt-6 rounded-xl border border-black/10 bg-white p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-black dark:text-zinc-300">
          Loading…
        </div>
      ) : null}

      {!loading ? (
        <div className="mt-6 grid gap-6">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Name</label>
            <input
              className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="min-h-24 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-black"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-3 text-sm dark:border-white/10 dark:bg-black">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            Make this draft type public
          </label>

          <DraftRulesBuilder rules={rules} onChange={setRules} />

          {error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => router.push("/draft-types")}
              className="inline-flex h-11 items-center justify-center rounded-full border border-black/10 bg-white px-5 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-black dark:text-white dark:hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={isSubmitting}
              className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              {isSubmitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}


