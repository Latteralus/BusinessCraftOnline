import BankingClient from "./BankingClient";
import { loadBankingPageData, requireAuthedPageContext } from "../server-data";

export default async function BankingPage() {
  const { user, character } = await requireAuthedPageContext();
  const initialData = await loadBankingPageData(user.id, character.business_level);

  return <BankingClient initialData={initialData} />;
}
