import ProductionClient from "./ProductionClient";
import { GameHydrationProvider } from "@/providers/game-hydration-provider";
import { loadProductionPageData } from "../server-data";

export default async function ProductionPage() {
  const initialData = await loadProductionPageData();

  return (
    <GameHydrationProvider
      initialData={{
        businesses: initialData.businesses,
        production: initialData,
      }}
    >
      <ProductionClient initialData={initialData} />
    </GameHydrationProvider>
  );
}
