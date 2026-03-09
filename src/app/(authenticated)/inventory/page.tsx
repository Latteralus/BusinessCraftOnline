import InventoryClient from "./InventoryClient";
import { loadInventoryPageData } from "../server-data";

export default async function InventoryPage() {
  const initialData = await loadInventoryPageData();

  return <InventoryClient initialData={initialData} />;
}
