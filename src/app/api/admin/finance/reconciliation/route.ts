import { handleAdminRequest, notFound } from "@/app/api/_shared/route-helpers";
import { getAllBusinessesReconciliation, getBusinessReconciliation } from "@/domains/businesses";
import { createSupabaseServiceRoleClient } from "@/lib/supabase-service-role";
import { NextResponse } from "next/server";

// AccountingFixPlan Phase H (item 53): "Create a server/admin reconciliation
// function that can examine one business or every business". Uses the
// service-role client, not the admin's own request-scoped client -- the
// admin is very likely reconciling businesses owned by other players, and
// business_inventory/business_journal_lines/business_financial_events RLS
// policies are all scoped to `b.player_id = auth.uid()`, so the admin's own
// session would only ever see their own businesses. This mirrors how every
// other cross-player internal read/write in this codebase (e.g. the
// service_role-only accounting RPCs themselves) is deliberately not routed
// through a player-scoped client.
export async function GET(request: Request) {
  return handleAdminRequest(
    async () => {
      const client = createSupabaseServiceRoleClient();
      const businessId = new URL(request.url).searchParams.get("businessId");

      if (businessId) {
        const { data: business, error } = await client
          .from("businesses")
          .select("id, player_id")
          .eq("id", businessId)
          .maybeSingle();
        if (error) throw error;
        if (!business) return notFound("Business not found.");

        const report = await getBusinessReconciliation(client, business as { id: string; player_id: string });
        return NextResponse.json({ report });
      }

      const summary = await getAllBusinessesReconciliation(client);
      return NextResponse.json(summary);
    },
    { errorMessage: "Failed to run reconciliation.", errorStatus: 500 }
  );
}
