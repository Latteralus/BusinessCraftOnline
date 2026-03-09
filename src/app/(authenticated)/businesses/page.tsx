import BusinessesClient from "./BusinessesClient";
import { loadBusinessesPageData } from "../server-data";

export default async function BusinessesPage() {
  const initialData = await loadBusinessesPageData();

  return <BusinessesClient initialData={initialData} />;
}
