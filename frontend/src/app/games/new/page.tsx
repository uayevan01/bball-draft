import { AppShell } from "@/components/AppShell";
import { GameCreateForm } from "@/components/GameCreateForm";

export default function NewGamePage() {
  return (
    <AppShell>
      <h2 className="text-2xl font-semibold tracking-tight">Log a game</h2>
      <GameCreateForm />
    </AppShell>
  );
}


