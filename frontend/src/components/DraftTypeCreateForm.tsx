"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";

import { backendPost } from "@/lib/backendClient";
import { DraftRulesBuilder } from "@/components/DraftRulesBuilder";
import { defaultDraftRules, type DraftRules } from "@/lib/draftRules";
import type { DraftType } from "@/lib/types";

export function DraftTypeCreateForm() {
  const router = useRouter();
  const { getToken } = useAuth();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [rules, setRules] = useState<DraftRules>(defaultDraftRules());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setIsSubmitting(true);
    try {
      const token = await getToken().catch(() => null);
      await backendPost<DraftType>(
        "/draft-types",
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
      setError(e instanceof Error ? e.message : "Failed to create draft type.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-6 grid gap-6">
      <div className="grid gap-2">
        <label className="text-sm font-medium">Name</label>
        <input
          className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Random year + random team"
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium">Description</label>
        <textarea
          className="min-h-24 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-black"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Rules: spin year/team; snake draft; rerolls allowed…"
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

      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting}
        className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {isSubmitting ? "Creating…" : "Create draft type"}
      </button>
    </div>
  );
}


