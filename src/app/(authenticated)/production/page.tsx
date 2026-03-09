import ProductionClient from "./ProductionClient";
import { loadProductionPageData, requireAuthedPageContext } from "../server-data";

export default async function ProductionPage() {
  const { user } = await requireAuthedPageContext();
  const initialData = await loadProductionPageData(user.id);

  return <ProductionClient initialData={initialData} />;
}
