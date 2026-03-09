import { Topbar } from "@/components/layout/Topbar";
import { AuthenticatedQueryProvider } from "@/components/providers/AuthenticatedQueryProvider";
import { AuthenticatedShellDataLayer } from "@/components/realtime/AuthenticatedShellDataLayer";
import { loadAuthenticatedShellInitialData } from "./server-data";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const shellData = await loadAuthenticatedShellInitialData();

  return (
    <AuthenticatedQueryProvider>
      <AuthenticatedShellDataLayer />
      <Topbar
        initials={shellData.identity.initials}
        firstName={shellData.identity.firstName}
        lastName={shellData.identity.lastName}
        initialAppShell={shellData.appShell}
      />
      <div className="main-container">
        {children}
      </div>
    </AuthenticatedQueryProvider>
  );
}
