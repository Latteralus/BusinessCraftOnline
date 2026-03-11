import { getPlayer } from "@/domains/auth-character";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const [{ id: businessId }, supabase] = await Promise.all([
    context.params,
    createSupabaseServerClient(),
  ]);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const player = await getPlayer(supabase, user.id).catch(() => null);
  if (!player) {
    return NextResponse.json({ error: "Player not found." }, { status: 404 });
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, player_id, name, type, city_id, created_at, updated_at")
    .eq("id", businessId)
    .maybeSingle();

  if (businessError) {
    return NextResponse.json({ error: businessError.message }, { status: 500 });
  }

  if (!business) {
    return NextResponse.json({ error: "Business not found." }, { status: 404 });
  }

  const isOwner = String(business.player_id) === user.id;
  const isAdmin = player.role === "admin";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const [settingsRes, shelfRes, inventoryRes, snapshotsRes, txRes, ledgerRes, financialEventsRes, tickLogsRes] =
    await Promise.all([
      supabase
        .from("market_storefront_settings")
        .select("*")
        .eq("business_id", businessId)
        .order("updated_at", { ascending: false })
        .limit(1),
      supabase
        .from("store_shelf_items")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false }),
      supabase
        .from("business_inventory")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false }),
      supabase
        .from("market_storefront_performance_snapshots")
        .select("*")
        .eq("business_id", businessId)
        .order("captured_at", { ascending: false })
        .limit(20),
      supabase
        .from("market_transactions")
        .select("*")
        .eq("seller_business_id", businessId)
        .eq("buyer_type", "npc")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("business_accounts")
        .select("*")
        .eq("business_id", businessId)
        .in("category", ["npc_sale", "market_fee", "storefront_ads"])
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("business_financial_events")
        .select("*")
        .eq("business_id", businessId)
        .order("effective_at", { ascending: false })
        .limit(20),
      supabase
        .from("tick_run_logs")
        .select("*")
        .eq("tick_name", "tick-npc-purchases")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const errors = [
    settingsRes.error,
    shelfRes.error,
    inventoryRes.error,
    snapshotsRes.error,
    txRes.error,
    ledgerRes.error,
    financialEventsRes.error,
    tickLogsRes.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    return NextResponse.json(
      { error: errors[0]?.message ?? "Failed to load storefront debug data." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    business,
    actor: {
      userId: user.id,
      playerRole: player.role,
      isOwner,
      isAdmin,
    },
    storefrontSettings: settingsRes.data ?? [],
    shelfItems: shelfRes.data ?? [],
    inventory: inventoryRes.data ?? [],
    snapshots: snapshotsRes.data ?? [],
    npcTransactions: txRes.data ?? [],
    storefrontLedger: ledgerRes.data ?? [],
    financialEvents: financialEventsRes.data ?? [],
    tickLogs: tickLogsRes.data ?? [],
    generatedAt: new Date().toISOString(),
  });
}
