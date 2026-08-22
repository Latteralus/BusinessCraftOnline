import { assignEmployee, assignEmployeeSchema } from "@/domains/employees";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    assignEmployeeSchema,
    "Invalid assignment payload.",
    async ({ supabase, user }, data) => {
      const employee = await assignEmployee(supabase, user.id, data);
      return NextResponse.json({ employee });
    },
    { errorMessage: "Failed to assign employee." }
  );
}
