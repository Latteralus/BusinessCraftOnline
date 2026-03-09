import MarketClient from "./MarketClient";
import { loadMarketPageData } from "../server-data";

export default async function MarketPage() {
  const initialData = await loadMarketPageData();

  return <MarketClient initialData={initialData} />;
}
