import MarketClient from "./MarketClient";
import { GameHydrationProvider } from "@/providers/game-hydration-provider";
import { loadMarketPageData } from "../server-data";

export default async function MarketPage() {
  const initialData = await loadMarketPageData();

  return (
    <GameHydrationProvider
      initialData={{
        businesses: initialData.businesses,
        inventory: {
          personalInventory: initialData.personalInventory,
          businessInventory: initialData.businessInventory,
        },
        market: initialData,
      }}
    >
      <MarketClient initialData={initialData} />
    </GameHydrationProvider>
  );
}
