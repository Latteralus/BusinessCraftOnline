import { Topbar } from "@/components/layout/Topbar";
import { GameHydrationProvider } from "@/providers/game-hydration-provider";
import { RealtimeProvider } from "@/providers/realtime-provider";
import { loadAuthenticatedShellInitialData } from "./server-data";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const shellData = await loadAuthenticatedShellInitialData();

  return (
    <GameHydrationProvider
      initialData={{
        player: {
          playerId: shellData.identity.playerId,
          initials: shellData.identity.initials,
          firstName: shellData.identity.firstName,
          lastName: shellData.identity.lastName,
        },
        appShell: shellData.appShell,
        hydrated: true,
      }}
    >
      <RealtimeProvider />
      <Topbar />
      <div className="main-container">
        {children}
      </div>
    </GameHydrationProvider>
  );
}
