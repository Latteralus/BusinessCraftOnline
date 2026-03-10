import EmployeesClient from "./EmployeesClient";
import { GameHydrationProvider } from "@/providers/game-hydration-provider";
import { loadEmployeesPageData } from "../server-data";

export default async function EmployeesPage() {
  const initialData = await loadEmployeesPageData();

  return (
    <GameHydrationProvider
      initialData={{
        employees: initialData,
      }}
    >
      <EmployeesClient initialData={initialData} />
    </GameHydrationProvider>
  );
}
