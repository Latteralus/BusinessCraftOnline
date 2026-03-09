import EmployeesClient from "./EmployeesClient";
import { loadEmployeesPageData } from "../server-data";

export default async function EmployeesPage() {
  const initialData = await loadEmployeesPageData();

  return <EmployeesClient initialData={initialData} />;
}
