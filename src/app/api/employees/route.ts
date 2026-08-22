import {
  employeeListFilterSchema,
  getEmployeeSummary,
  getPlayerEmployees,
  hireEmployee,
  hireEmployeeSchema,
} from "@/domains/employees";
import { badRequest, handleAuthedJsonRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const url = new URL(request.url);
    const rawFilters = {
      status: url.searchParams.get("status") ?? undefined,
      employeeType: url.searchParams.get("employeeType") ?? undefined,
      businessId: url.searchParams.get("businessId") ?? undefined,
    };

    const parsed = employeeListFilterSchema.safeParse(rawFilters);
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid filters.");
    }

    const [employees, summary] = await Promise.all([
      getPlayerEmployees(supabase, user.id, parsed.data),
      getEmployeeSummary(supabase, user.id),
    ]);

    return NextResponse.json({ employees, summary });
  }, { errorMessage: "Failed to fetch employees.", errorStatus: 500 });
}

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    hireEmployeeSchema,
    "Invalid employee payload.",
    async ({ supabase, user }, data) => {
      const employee = await hireEmployee(supabase, user.id, data);
      return NextResponse.json({ employee }, { status: 201 });
    },
    { errorMessage: "Failed to hire employee." }
  );
}
