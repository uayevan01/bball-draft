"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";

import { AppShell } from "@/components/AppShell";
import { backendGet } from "@/lib/backendClient";
import { summarizeRules } from "@/lib/draftRules";
import type { DraftType } from "@/lib/types";

export default function DraftTypesPage() {
  const { getToken } = useAuth();
  const [publicItems, setPublicItems] = useState<DraftType[]>([]);
  const [myItems, setMyItems] = useState<DraftType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [tab, setTab] = useState<"public" | "mine">("public");
  const [publicQuery, setPublicQuery] = useState<string>("");
  const [mineQuery, setMineQuery] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setError(null);
      try {
        const token = await getToken().catch(() => null);
        const [me, pub, mine] = await Promise.all([
          backendGet<{ id: string }>("/me", token),
          backendGet<DraftType[]>("/draft-types?public_only=true&sort=usage", token),
          backendGet<DraftType[]>("/draft-types?mine=true&sort=created_at", token),
        ]);
        if (!cancelled) {
          setMyId(me.id);
          setPublicItems(pub);
          setMyItems(mine);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load draft types.");
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const mineSet = useMemo(() => new Set([myId].filter(Boolean) as string[]), [myId]);

  const filteredPublicItems = useMemo(() => {
    const q = publicQuery.trim().toLowerCase();
    if (!q) return publicItems;
    return publicItems.filter((dt) => dt.name.toLowerCase().includes(q));
  }, [publicItems, publicQuery]);

  const filteredMyItems = useMemo(() => {
    const q = mineQuery.trim().toLowerCase();
    if (!q) return myItems;
    return myItems.filter((dt) => dt.name.toLowerCase().includes(q));
  }, [myItems, mineQuery]);

  const items = tab === "public" ? filteredPublicItems : filteredMyItems;

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

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-full border border-black/10 bg-white p-1 text-sm dark:border-white/10 dark:bg-black">
          <button
            type="button"
            onClick={() => setTab("public")}
            className={[
              "h-9 rounded-full px-4 font-semibold",
              tab === "public"
                ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
            ].join(" ")}
          >
            Public
          </button>
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={[
              "h-9 rounded-full px-4 font-semibold",
              tab === "mine"
                ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
            ].join(" ")}
          >
            My drafts
          </button>
        </div>

        <input
          className="h-11 w-full max-w-lg rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
          value={tab === "public" ? publicQuery : mineQuery}
          onChange={(e) => (tab === "public" ? setPublicQuery(e.target.value) : setMineQuery(e.target.value))}
          placeholder={tab === "public" ? "Search public draft types…" : "Search my draft types…"}
        />
      </div>

      <div className="mt-6 grid gap-3">
        {items.length === 0 ? (
          <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-zinc-600 dark:border-white/10 dark:bg-black dark:text-zinc-300">
            No draft types found.
          </div>
        ) : (
          items.map((dt) => {
            const isMine = Boolean(dt.created_by_id && mineSet.has(dt.created_by_id));
            return (
              <div
                key={dt.id}
                className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="font-semibold">{dt.name}</div>
                      {isMine ? (
                        <Link
                          href={`/draft-types/${dt.id}/edit`}
                          className="text-xs font-semibold text-zinc-700 hover:underline dark:text-zinc-200"
                        >
                          Edit
                        </Link>
                      ) : null}
                    </div>
                    {dt.description ? (
                      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{dt.description}</div>
                    ) : null}
                    <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{summarizeRules(dt.rules)}</div>
                  </div>
                  <div className="text-right text-xs text-zinc-500 dark:text-zinc-400">
                    <div>{dt.is_public ? "Public" : "Private"}</div>
                    {tab === "public" ? (
                      <div className="mt-1">
                        {dt.created_by_username ? `Posted by ${dt.created_by_username}` : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </AppShell>
  );
}


