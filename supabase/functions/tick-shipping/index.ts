// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

async function writeTickRunLog(
  supabase: ReturnType<typeof createClient>,
  input: {
    status: "ok" | "error";
    startedAtIso: string;
    finishedAtIso: string;
    durationMs: number;
    processedCount: number;
    metrics?: Record<string, unknown>;
    errorMessage?: string | null;
  }
) {
  await supabase.from("tick_run_logs").insert({
    tick_name: "tick-shipping",
    status: input.status,
    started_at: input.startedAtIso,
    finished_at: input.finishedAtIso,
    duration_ms: Math.max(0, Math.floor(input.durationMs)),
    processed_count: Math.max(0, Math.floor(input.processedCount)),
    metrics: input.metrics ?? {},
    error_message: input.errorMessage ?? null,
  });
}

async function deliverToPersonalInventory(
  supabase: ReturnType<typeof createClient>,
  shipment: {
    owner_player_id: string;
    item_key: string;
    quantity: number | string;
  }
) {
  const quality = 40;
  const quantity = Math.max(1, toNumber(shipment.quantity));

  const { data: existing } = await supabase
    .from("personal_inventory")
    .select("id, quantity")
    .eq("player_id", shipment.owner_player_id)
    .eq("item_key", shipment.item_key)
    .eq("quality", quality)
    .maybeSingle();

  if (!existing) {
    await supabase.from("personal_inventory").insert({
      player_id: shipment.owner_player_id,
      item_key: shipment.item_key,
      quantity,
      quality,
    });
    return;
  }

  await supabase
    .from("personal_inventory")
    .update({
      quantity: toNumber(existing.quantity) + quantity,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
}

async function deliverToBusinessInventory(
  supabase: ReturnType<typeof createClient>,
  shipment: {
    owner_player_id: string;
    destination_id: string;
    to_city_id: string;
    item_key: string;
    quantity: number | string;
  }
) {
  const quality = 40;
  const quantity = Math.max(1, toNumber(shipment.quantity));

  const { data: existing } = await supabase
    .from("business_inventory")
    .select("id, quantity")
    .eq("owner_player_id", shipment.owner_player_id)
    .eq("business_id", shipment.destination_id)
    .eq("item_key", shipment.item_key)
    .eq("quality", quality)
    .maybeSingle();

  if (!existing) {
    await supabase.from("business_inventory").insert({
      owner_player_id: shipment.owner_player_id,
      business_id: shipment.destination_id,
      city_id: shipment.to_city_id,
      item_key: shipment.item_key,
      quantity,
      quality,
      reserved_quantity: 0,
    });
    return;
  }

  await supabase
    .from("business_inventory")
    .update({
      quantity: toNumber(existing.quantity) + quantity,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
}

Deno.serve(async () => {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  try {
    const nowIso = new Date().toISOString();

    const { data: dueShipments, error: shipmentsError } = await supabase
      .from("shipping_queue")
      .select("id, owner_player_id, to_city_id, item_key, quantity, destination_type, destination_id")
      .eq("status", "in_transit")
      .lte("arrives_at", nowIso)
      .order("arrives_at", { ascending: true })
      .limit(500);

    if (shipmentsError) {
      throw shipmentsError;
    }

    let processed = 0;
    let deliveredPersonal = 0;
    let deliveredBusiness = 0;

    for (const shipment of dueShipments ?? []) {
      if (shipment.destination_type === "personal") {
        await deliverToPersonalInventory(supabase, shipment);
        deliveredPersonal += 1;
      } else {
        await deliverToBusinessInventory(supabase, shipment);
        deliveredBusiness += 1;
      }

      await supabase
        .from("shipping_queue")
        .update({ status: "delivered" })
        .eq("id", shipment.id)
        .eq("status", "in_transit");

      processed += 1;
    }

    const finishedAtIso = new Date().toISOString();
    const payload = {
      ok: true,
      function: "tick-shipping",
      processed,
      deliveredPersonal,
      deliveredBusiness,
    };

    await writeTickRunLog(supabase, {
      status: "ok",
      startedAtIso,
      finishedAtIso,
      durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
      processedCount: processed,
      metrics: payload,
      errorMessage: null,
    });

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const finishedAtIso = new Date().toISOString();
    const message = error instanceof Error ? error.message : "tick-shipping failed";

    await writeTickRunLog(supabase, {
      status: "error",
      startedAtIso,
      finishedAtIso,
      durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
      processedCount: 0,
      metrics: {},
      errorMessage: message,
    });

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
