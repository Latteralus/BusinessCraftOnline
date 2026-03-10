import BusinessesClient from "./BusinessesClient";
import { GameHydrationProvider } from "@/providers/game-hydration-provider";
import { loadBusinessesPageData } from "../server-data";

export default async function BusinessesPage() {
  const initialData = await loadBusinessesPageData();

  return (
    <GameHydrationProvider
      initialData={{
        businesses: initialData.businesses,
        travel: initialData.travelState,
      }}
    >
      <BusinessesClient initialData={initialData} />
    </GameHydrationProvider>
  );
}
