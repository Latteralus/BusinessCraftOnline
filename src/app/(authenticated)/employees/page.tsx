import EmployeesClient from "./EmployeesClient";
import { loadEmployeesPageData, requireAuthedPageContext } from "../server-data";

export default async function EmployeesPage() {
  const { user } = await requireAuthedPageContext();
  const initialData = await loadEmployeesPageData(user.id);

  return <EmployeesClient initialData={initialData} />;
}
