import BankingClient from "./BankingClient";
import { GameHydrationProvider } from "@/providers/game-hydration-provider";
import { loadBankingPageData } from "../server-data";

export default async function BankingPage() {
  const initialData = await loadBankingPageData();

  return (
    <GameHydrationProvider
      initialData={{
        businesses: initialData.businesses,
        banking: initialData,
      }}
    >
      <BankingClient initialData={initialData} />
    </GameHydrationProvider>
  );
}
