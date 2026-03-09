import InventoryClient from "./InventoryClient";
import { loadInventoryPageData, requireAuthedPageContext } from "../server-data";

export default async function InventoryPage() {
  const { user } = await requireAuthedPageContext();
  const initialData = await loadInventoryPageData(user.id);

  return <InventoryClient initialData={initialData} />;
}
