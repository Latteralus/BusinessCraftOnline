import { reactivateEmployee, reactivateEmployeeSchema } from "@/domains/employees";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    reactivateEmployeeSchema,
    "Invalid reactivation payload.",
    async ({ supabase, user }, data) => {
      const employee = await reactivateEmployee(supabase, user.id, data);
      return NextResponse.json({ employee });
    },
    { errorMessage: "Failed to reactivate employee." }
  );
}
