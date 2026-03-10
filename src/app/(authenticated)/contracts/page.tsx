import ContractsClient from "./ContractsClient";
import { GameHydrationProvider } from "@/providers/game-hydration-provider";
import { loadContractsPageData } from "../server-data";

export default async function ContractsPage() {
  const initialData = await loadContractsPageData();

  return (
    <GameHydrationProvider
      initialData={{
        businesses: initialData.businesses,
        contracts: initialData.contracts,
      }}
    >
      <ContractsClient initialData={initialData} />
    </GameHydrationProvider>
  );
}
