import { fireEmployee, getEmployeeWithDetails } from "@/domains/employees";
import { handleAuthedRequest, notFound } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    const employee = await getEmployeeWithDetails(supabase, user.id, id);

    if (!employee) {
      return notFound("Employee not found.");
    }

    return NextResponse.json({ employee });
  }, { errorMessage: "Failed to fetch employee.", errorStatus: 500 });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    const employee = await fireEmployee(supabase, user.id, { employeeId: id });
    return NextResponse.json({ employee });
  }, { errorMessage: "Failed to fire employee." });
}
