import BankingClient from "./BankingClient";
import { loadBankingPageData } from "../server-data";

export default async function BankingPage() {
  const initialData = await loadBankingPageData();

  return <BankingClient initialData={initialData} />;
}
