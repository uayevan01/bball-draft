import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { DraftLobbyClient } from "@/components/DraftLobbyClient";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function DraftLobbyPage({ params }: Props) {
  const { id } = await params;

  return (
    <AppShell wide>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Draft lobby</h2>
          <p className="mt-2 text-zinc-600 dark:text-zinc-300">Draft</p>
        </div>
        <Link
          href="/draft/new"
          className="inline-flex h-10 items-center justify-center rounded-full border border-black/10 px-4 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          New draft
        </Link>
      </div>
      <DraftLobbyClient draftRef={id} />
    </AppShell>
  );
}


