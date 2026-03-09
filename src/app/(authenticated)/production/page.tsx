import ProductionClient from "./ProductionClient";
import { loadProductionPageData } from "../server-data";

export default async function ProductionPage() {
  const initialData = await loadProductionPageData();

  return <ProductionClient initialData={initialData} />;
}
