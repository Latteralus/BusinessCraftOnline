import BusinessesClient from "./BusinessesClient";
import { loadBusinessesPageData, requireAuthedPageContext } from "../server-data";

export default async function BusinessesPage() {
  const { user } = await requireAuthedPageContext();
  const initialData = await loadBusinessesPageData(user.id);

  return <BusinessesClient initialData={initialData} />;
}
