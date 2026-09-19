import { AppShell } from "@/components/AppShell";
import { JoinDraftById } from "@/components/JoinDraftById";
import { RecentDrafts } from "@/components/RecentDrafts";
import { UsernameSettings } from "@/components/UsernameSettings";

export default function DashboardPage() {
  return (
    <AppShell>
      <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
      <UsernameSettings />
      <JoinDraftById />
      <RecentDrafts />
    </AppShell>
  );
}


