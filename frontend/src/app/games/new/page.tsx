import { AppShell } from "@/components/AppShell";
import { GameCreateForm } from "@/components/GameCreateForm";

export default function NewGamePage() {
  return (
    <AppShell>
      <h2 className="text-2xl font-semibold tracking-tight">Log a game</h2>
      <p className="mt-2 text-zinc-600 dark:text-zinc-300">Attach an NBA 2K result to a draft.</p>
      <GameCreateForm />
    </AppShell>
  );
}


