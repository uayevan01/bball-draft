import { AppShell } from "@/components/AppShell";
import { DraftCreateForm } from "@/components/DraftCreateForm";
import { apiGet } from "@/lib/api";
import type { DraftType } from "@/lib/types";

export default async function NewDraftPage() {
  let draftTypes: DraftType[] = [];
  let error: string | null = null;

  // In dev, the backend can allow missing auth; in prod, Clerk token should be used via client calls.
  try {
    draftTypes = await apiGet<DraftType[]>("/draft-types");
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load draft types.";
  }

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


