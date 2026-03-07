import {
  employeeListFilterSchema,
  fireEmployee,
  getEmployeeSummary,
  getPlayerEmployees,
  hireEmployee,
  hireEmployeeSchema,
} from "@/domains/employees";
import { addBusinessAccountEntry, getBusinessBalance, getBusinessById } from "@/domains/businesses";
import { HIRE_COSTS } from "@/config/employees";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawFilters = {
    status: url.searchParams.get("status") ?? undefined,
    employeeType: url.searchParams.get("employeeType") ?? undefined,
  };

  const parsed = employeeListFilterSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid filters." },
      { status: 400 }
    );
  }

  try {
    const [employees, summary] = await Promise.all([
      getPlayerEmployees(supabase, user.id, parsed.data),
      getEmployeeSummary(supabase, user.id),
    ]);

    return NextResponse.json({ employees, summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch employees." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = hireEmployeeSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid employee payload." },
      { status: 400 }
    );
  }

  try {
    const businessId = parsed.data.businessId;
    const business = await getBusinessById(supabase, user.id, businessId);
    if (!business) {
      return NextResponse.json({ error: "Business not found." }, { status: 404 });
    }

    const hireCost = HIRE_COSTS[parsed.data.employeeType];
    if (hireCost > 0) {
      const businessBalance = await getBusinessBalance(supabase, user.id, businessId);
      if (businessBalance < hireCost) {
        return NextResponse.json(
          {
            error: `Insufficient business funds. Hire cost is $${hireCost.toFixed(2)} and balance is $${businessBalance.toFixed(2)}.`,
          },
          { status: 400 }
        );
      }
    }

    const employee = await hireEmployee(supabase, user.id, parsed.data);

    if (hireCost > 0) {
      try {
        await addBusinessAccountEntry(supabase, user.id, businessId, {
          amount: hireCost,
          entryType: "debit",
          category: "employee_hire",
          description: `Hiring cost: ${employee.first_name} ${employee.last_name}`,
          referenceId: employee.id,
        });
      } catch (ledgerError) {
        await fireEmployee(supabase, user.id, { employeeId: employee.id }).catch(() => null);
        throw ledgerError;
      }
    }

    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to hire employee." },
      { status: 400 }
    );
  }
}
