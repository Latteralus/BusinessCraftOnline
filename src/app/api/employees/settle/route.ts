import { settleEmployeeWages } from "@/domains/employees";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";
import { z } from "zod";

const settleEmployeeWagesSchema = z.object({
  employeeId: z.uuid("Employee id is invalid."),
});

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    settleEmployeeWagesSchema,
    "Invalid settlement payload.",
    async ({ supabase, user }, data) => {
      const employee = await settleEmployeeWages(supabase, user.id, data);
      return NextResponse.json({ employee });
    },
    { errorMessage: "Failed to settle employee wages." }
  );
}
