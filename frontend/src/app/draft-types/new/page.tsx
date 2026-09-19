import { AppShell } from "@/components/AppShell";
import { DraftTypeCreateForm } from "@/components/DraftTypeCreateForm";

export default function NewDraftTypePage() {
  return (
    <AppShell>
      <h2 className="text-2xl font-semibold tracking-tight">New draft type</h2>
      <DraftTypeCreateForm />
    </AppShell>
  );
}


