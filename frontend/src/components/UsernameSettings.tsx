"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";

import { backendGet, backendPatch } from "@/lib/backendClient";
import type { User } from "@/lib/types";

function deriveHandleFromEmail(email?: string | null): string | null {
  if (!email) return null;
  const beforeAt = email.split("@")[0]?.trim();
  if (!beforeAt) return null;
  const sanitized = beforeAt.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 30);
  return sanitized.length >= 3 ? sanitized : null;
}

function normalizeHandle(input: string): string {
  return input.trim();
}

export function UsernameSettings() {
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const clerkFullName = clerkUser?.fullName ?? null;
  const clerkEmail = clerkUser?.primaryEmailAddress?.emailAddress ?? null;
  const clerkAvatarUrl = clerkUser?.imageUrl ?? null;
  const suggestedHandle = useMemo(() => deriveHandleFromEmail(clerkEmail), [clerkEmail]);

  const [username, setUsername] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken().catch(() => null);
        const m = await backendGet<User>("/me", token);
        if (cancelled) return;
        setMe(m);
        setUsername(m.username ?? "");

        // One-time sync: store provider name if backend doesn't have it yet.
        if (!m.full_name && clerkFullName) {
          const updated = await backendPatch<User>("/me", { full_name: clerkFullName }, token);
          if (!cancelled) setMe(updated);
        }
        // One-time sync: JWT often doesn't include these, but Clerk frontend always has them.
        if ((!m.email && clerkEmail) || (!m.avatar_url && clerkAvatarUrl)) {
          const updated = await backendPatch<User>(
            "/me",
            { email: clerkEmail ?? null, avatar_url: clerkAvatarUrl ?? null },
            token,
          );
          if (!cancelled) setMe(updated);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [clerkAvatarUrl, clerkEmail, clerkFullName, getToken]);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken().catch(() => null);
      const updated = await backendPatch<User>("/me", { username: normalizeHandle(username) }, token);
      setMe(updated);
      setUsername(updated.username ?? "");
      setSuccess("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
      <div className="text-sm font-semibold">Profile</div>
      <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
        {loading ? "Loading…" : me ? `Signed in as: ${me.username || me.full_name || me.email || me.clerk_id}` : "—"}
      </div>

      <div className="mt-4 grid gap-2">
        <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Username (custom handle)</label>
        <input
          className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. nbafan2k"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Allowed: letters, numbers, underscore. 3–30 chars. This is what we’ll show in lobbies instead of your real name.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {suggestedHandle ? (
            <button
              type="button"
              onClick={() => setUsername(suggestedHandle)}
              className="h-9 rounded-full border border-black/10 bg-white px-3 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-black dark:text-white dark:hover:bg-white/10"
            >
              Use email handle
            </button>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="h-9 rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Save username
          </button>
        </div>
        {error ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            {success}
          </div>
        ) : null}
      </div>
    </div>
  );
}


