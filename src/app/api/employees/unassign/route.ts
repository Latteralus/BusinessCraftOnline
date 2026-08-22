import { unassignEmployee, unassignEmployeeSchema } from "@/domains/employees";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    unassignEmployeeSchema,
    "Invalid unassign payload.",
    async ({ supabase, user }, data) => {
      const employee = await unassignEmployee(supabase, user.id, data);
      return NextResponse.json({ employee });
    },
    { errorMessage: "Failed to unassign employee." }
  );
}
