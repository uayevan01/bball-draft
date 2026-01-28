import { AppShell } from "@/components/AppShell";
import { DraftTypeCreateForm } from "@/components/DraftTypeCreateForm";

export default function NewDraftTypePage() {
  return (
    <AppShell>
      <h2 className="text-2xl font-semibold tracking-tight">New draft type</h2>
      <p className="mt-2 text-zinc-600 dark:text-zinc-300">
        Start simple: name + description. You can expand rules later.
      </p>
      <DraftTypeCreateForm />
    </AppShell>
  );
}


