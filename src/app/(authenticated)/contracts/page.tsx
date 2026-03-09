import ContractsClient from "./ContractsClient";
import { loadContractsPageData } from "../server-data";

export default async function ContractsPage() {
  const initialData = await loadContractsPageData();

  return <ContractsClient initialData={initialData} />;
}
