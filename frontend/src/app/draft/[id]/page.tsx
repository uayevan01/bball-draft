import { AppShell } from "@/components/AppShell";
import { DraftLobbyClient } from "@/components/DraftLobbyClient";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function DraftLobbyPage({ params }: Props) {
  const { id } = await params;

  return (
    <AppShell wide>
      <DraftLobbyClient draftRef={id} />
    </AppShell>
  );
}


