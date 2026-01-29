import { AppShell } from "@/components/AppShell";
import { RecentDrafts } from "@/components/RecentDrafts";
import { UsernameSettings } from "@/components/UsernameSettings";

export default function DashboardPage() {
  return (
    <AppShell>
      <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
      <p className="mt-2 text-zinc-600 dark:text-zinc-300">
        This will show your recent drafts, draft types, and game results.
      </p>
      <RecentDrafts />
      <UsernameSettings />
    </AppShell>
  );
}


