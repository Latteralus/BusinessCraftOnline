import InventoryClient from "./InventoryClient";
import { GameHydrationProvider } from "@/providers/game-hydration-provider";
import { loadInventoryPageData } from "../server-data";

export default async function InventoryPage() {
  const initialData = await loadInventoryPageData();

  return (
    <GameHydrationProvider
      initialData={{
        businesses: initialData.businesses,
        inventory: initialData,
        banking: {
          accounts: initialData.accounts,
          businesses: initialData.businesses,
        },
      }}
    >
      <InventoryClient initialData={initialData} />
    </GameHydrationProvider>
  );
}
