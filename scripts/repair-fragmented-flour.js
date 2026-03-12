const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function clampQuality(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function weightedAverageQuality(rows) {
  let totalUnits = 0;
  let weightedQuality = 0;

  for (const row of rows) {
    const units = Math.max(0, toNumber(row.quantity));
    if (units <= 0) continue;
    totalUnits += units;
    weightedQuality += units * toNumber(row.quality);
  }

  if (totalUnits <= 0) return null;
  return weightedQuality / totalUnits;
}

function resolveTotalCost(row) {
  const totalCost = row.total_cost;
  if (totalCost !== null && totalCost !== undefined) return toNumber(totalCost);
  const unitCost = row.unit_cost;
  if (unitCost !== null && unitCost !== undefined) {
    return toNumber(unitCost) * toNumber(row.quantity);
  }
  return null;
}

async function main() {
  loadEnvFile(path.join(process.cwd(), ".env.local"));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dryRun = process.argv.includes("--dry-run");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: flourRows, error: flourError } = await supabase
    .from("business_inventory")
    .select("id, owner_player_id, business_id, city_id, item_key, quality, quantity, reserved_quantity, unit_cost, total_cost")
    .eq("item_key", "flour")
    .order("business_id", { ascending: true })
    .order("quality", { ascending: false });

  if (flourError) throw flourError;

  const flourBusinessIds = Array.from(new Set((flourRows ?? []).map((row) => String(row.business_id))));
  const { data: businessRows, error: businessError } = flourBusinessIds.length === 0
    ? { data: [], error: null }
    : await supabase
        .from("businesses")
        .select("id, name, type")
        .in("id", flourBusinessIds)
        .eq("type", "food_processing_plant");
  if (businessError) throw businessError;

  const businessById = new Map((businessRows ?? []).map((row) => [String(row.id), row]));

  const businesses = new Map();
  for (const row of flourRows ?? []) {
    const businessId = String(row.business_id);
    const businessRow = businessById.get(businessId);
    if (!businessRow) continue;
    const current = businesses.get(businessId) ?? {
      businessId,
      ownerPlayerId: String(row.owner_player_id),
      cityId: String(row.city_id),
      businessName: businessRow.name ?? businessId,
      flourRows: [],
    };
    current.flourRows.push(row);
    businesses.set(businessId, current);
  }

  let touchedBusinesses = 0;
  let consolidatedRows = 0;

  for (const business of businesses.values()) {
    const { data: wheatRows, error: wheatError } = await supabase
      .from("business_inventory")
      .select("quality, quantity")
      .eq("business_id", business.businessId)
      .eq("item_key", "wheat");
    if (wheatError) throw wheatError;

    const { data: upgradeRows, error: upgradeError } = await supabase
      .from("business_upgrades")
      .select("level")
      .eq("business_id", business.businessId)
      .eq("upgrade_key", "equipment_quality");
    if (upgradeError) throw upgradeError;

    const wheatQuality = weightedAverageQuality(wheatRows ?? []);
    const equipmentLevel = Math.max(
      0,
      ...((upgradeRows ?? []).map((row) => toNumber(row.level)))
    );
    const qualityBonus = equipmentLevel * 5;
    const fallbackFlourQuality = Math.max(
      ...business.flourRows.map((row) => toNumber(row.quality))
    );
    const targetQuality = clampQuality((wheatQuality ?? fallbackFlourQuality) + qualityBonus);

    const totalQuantity = business.flourRows.reduce((sum, row) => sum + Math.max(0, toNumber(row.quantity)), 0);
    const totalReserved = business.flourRows.reduce((sum, row) => sum + Math.max(0, toNumber(row.reserved_quantity)), 0);
    const rowCosts = business.flourRows.map(resolveTotalCost).filter((value) => value !== null);
    const totalCost = rowCosts.length > 0
      ? Number(rowCosts.reduce((sum, value) => sum + value, 0).toFixed(2))
      : null;
    const unitCost = totalCost !== null && totalQuantity > 0
      ? Number((totalCost / totalQuantity).toFixed(2))
      : null;

    const alreadyNormalized =
      business.flourRows.length === 1 &&
      toNumber(business.flourRows[0].quality) === targetQuality;
    if (alreadyNormalized) continue;

    touchedBusinesses += 1;
    consolidatedRows += business.flourRows.length;

    console.log(
      `${dryRun ? "[dry-run] " : ""}${business.businessName}: ${business.flourRows
        .map((row) => `Q${toNumber(row.quality)}x${toNumber(row.quantity)}`)
        .join(", ")} -> Q${targetQuality}x${totalQuantity}`
    );

    if (dryRun) continue;

    const keeper =
      business.flourRows.find((row) => toNumber(row.quality) === targetQuality) ??
      business.flourRows[0];

    const { error: updateError } = await supabase
      .from("business_inventory")
      .update({
        quality: targetQuality,
        quantity: totalQuantity,
        reserved_quantity: Math.min(totalReserved, totalQuantity),
        unit_cost: unitCost,
        total_cost: totalCost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", keeper.id);
    if (updateError) throw updateError;

    const deleteIds = business.flourRows
      .filter((row) => row.id !== keeper.id)
      .map((row) => row.id);
    if (deleteIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("business_inventory")
        .delete()
        .in("id", deleteIds);
      if (deleteError) throw deleteError;
    }
  }

  console.log(
    `${dryRun ? "Would normalize" : "Normalized"} ${touchedBusinesses} business(es); reviewed ${businesses.size} food processing plant(s); consolidated ${consolidatedRows} flour row(s).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
