import { Topbar } from "@/components/layout/Topbar";
import { requireAuthedPageContext } from "./server-data";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { character } = await requireAuthedPageContext();

  const initials = character.first_name[0] + character.last_name[0];

  return (
    <>
      <Topbar
        initials={initials}
        firstName={character.first_name}
        lastName={character.last_name}
      />
      <div className="main-container">
        {children}
      </div>
    </>
  );
}
