import ContractsClient from "./ContractsClient";
import { loadContractsPageData, requireAuthedPageContext } from "../server-data";

export default async function ContractsPage() {
  const { user } = await requireAuthedPageContext();
  const initialData = await loadContractsPageData(user.id);

  return <ContractsClient initialData={initialData} />;
}
