import { AppShell } from "@/components/AppShell";
import { RecentDrafts } from "@/components/RecentDrafts";
import { StartDraftPanel } from "@/components/StartDraftPanel";
import { UsernameSettings } from "@/components/UsernameSettings";

export default function DashboardPage() {
  return (
    <AppShell fitViewport>
      <div className="grid min-h-0 w-full flex-1 gap-4 lg:h-full lg:grid-cols-[minmax(0,1.7fr)_minmax(22rem,32rem)] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
        <StartDraftPanel className="min-h-0 lg:row-span-2 lg:h-full lg:overflow-y-auto" />
        <UsernameSettings />
        <RecentDrafts limit={8} />
      </div>
    </AppShell>
  );
}
