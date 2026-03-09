import { Topbar } from "@/components/layout/Topbar";
import { AuthenticatedQueryProvider } from "@/components/providers/AuthenticatedQueryProvider";
import { AuthenticatedShellDataLayer } from "@/components/realtime/AuthenticatedShellDataLayer";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthenticatedQueryProvider>
      <AuthenticatedShellDataLayer />
      <Topbar />
      <div className="main-container">
        {children}
      </div>
    </AuthenticatedQueryProvider>
  );
}
