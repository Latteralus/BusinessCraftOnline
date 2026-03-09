import MarketClient from "./MarketClient";
import { loadMarketPageData, requireAuthedPageContext } from "../server-data";

export default async function MarketPage() {
  const { user } = await requireAuthedPageContext();
  const initialData = await loadMarketPageData(user.id);

  return <MarketClient initialData={initialData} />;
}
