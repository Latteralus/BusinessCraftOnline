import { Topbar } from "@/components/layout/Topbar";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Topbar />
      <div className="main-container">
        {children}
      </div>
    </>
  );
}
