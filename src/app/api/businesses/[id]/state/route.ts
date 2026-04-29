import { type FinancePeriod } from "@/config/finance";
import { getBusinessById } from "@/domains/businesses";
import {
  handleAuthedRequest,
  notFound,
} from "@/app/api/_shared/route-helpers";
import { loadBusinessDetailsEntry } from "@/lib/business-details-data";
import { loadBusinessDetailsSection, type BusinessDetailsSection } from "@/lib/business-details-data";
import { withTiming } from "@/lib/server-timing";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

function resolveFinancePeriod(searchParams: URLSearchParams): FinancePeriod {
  const requested = searchParams.get("period");
  return requested === "24h" || requested === "7d" || requested === "30d" ? requested : "1h";
}

function resolveSection(searchParams: URLSearchParams): BusinessDetailsSection | null {
  const section = searchParams.get("section");
  return section === "overview" ||
    section === "finance" ||
    section === "operations" ||
    section === "employees" ||
    section === "inventory" ||
    section === "upgrades" ||
    section === "options"
    ? section
    : null;
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const period = resolveFinancePeriod(new URL(request.url).searchParams);
  const section = resolveSection(new URL(request.url).searchParams);

  return handleAuthedRequest(async ({ supabase, user }) => {
    const business = await getBusinessById(supabase, user.id, id).catch(() => null);

    if (!business || business.player_id !== user.id) {
      return notFound("Business not found.");
    }

    if (section) {
      const detailPatch = await withTiming("api-route", `/api/businesses/${id}/state ${section}`, async (timing) =>
        timing.measure("business-detail-section", () =>
          loadBusinessDetailsSection(supabase, user.id, business.id, section, period)
        )
      );

      return NextResponse.json({
        section,
        detailPatch,
      });
    }

    const detail = await withTiming("api-route", `/api/businesses/${id}/state`, async (timing) =>
      timing.measure("business-detail-full", () => loadBusinessDetailsEntry(supabase, user.id, business.id, period))
    );

    return NextResponse.json({
      detail,
    });
  }, { errorMessage: "Failed to fetch business state.", errorStatus: 500 });
}
