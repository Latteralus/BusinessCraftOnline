Business Craft Online - World, City Economy & Logistics

Technical Design & Implementation Plan

Status: Proposed architecture
Version: 1.1
Date: August 19, 2026
Repository baseline: Latteralus/BusinessCraftOnline main

Revision 1.1: Government simulation reduced to a 24-hour cadence outside automatic stock-threshold replenishment; added shared Federal procurement provider placeholder and due-time stock threshold optimization.

Implementation status (2026-08-20): Phases 1-5 shipped and verified locally -- see `Documents/changelog.md` (2026-08-19, "CityPlan Phase 1" through "CityPlan Phase 4"; 2026-08-20, "CityPlan Phase 5"). Not yet pushed to the hosted project. The City Page UI (Overview/Resources/Business Environment/Municipal Stock/Contracts/Logistics tabs) and the player-owned trucking reach goal are still proposed, not built.

Executive Summary

Add a regional economic simulation layer where cities have static resource/tax characteristics, dynamic population/labor/demand conditions, physical municipal stockpiles, shortage-driven procurement contracts, and route-based inter-city freight. Preserve the current abstract shipping system as the first carrier and design it so player-owned trucking companies can replace the carrier layer later without changing city contracts or inventory semantics.

Core loop

World conditions -> City economy/profile -> Resources/labor/taxes/demand -> Player production/trade -> Inter-city freight -> Municipal/market consumption

Design Principles

Static city characteristics and dynamic economic state are separate.

Resource abundance is 0.0..2.0: 0 = none, 1 = neutral base output, 2 = double base output.

True zero resource availability is allowed and encouraged to force trade.

City stock is physical government inventory, separate from NPC retail demand.

Contracts emerge from low stock; they are not random quests.

Stock consumption uses elapsed-time math and lazy materialization, not minute-by-minute writes.

Government/world economic simulation updates on a 24-hour cadence; only automatic stock-threshold procurement remains event/due-time driven between daily updates.

Federal procurement uses the same contract-provider abstraction as cities, but remains a static placeholder until a later federal-economy phase.

City/world wage effects apply to skill-based employee value through labor supply vs labor demand.

Shared route data drives player travel, abstract shipping, and future trucking.

Abstract shipping remains available until trucking companies are a mature optional business.

Current BCO Foundation to Reuse

public.cities already exists.

travel_log already models timed city-to-city player travel.

shipping_queue already models timed inter-city cargo.

tick-travel and tick-shipping already finalize due arrivals through database RPCs.

Do not replace these systems unnecessarily. Extend them.

Phase 1 - City Profiles, Resources and Routes

Extend cities

Recommended fields:

population_baseline bigint

business_tax_rate numeric

property_cost_index numeric default 1

utility_cost_index numeric default 1

base_labor_index numeric default 1

latitude, longitude

is_active

city_resource_modifiers

city_id

resource_key

abundance_multiplier numeric CHECK 0 <= value <= 2

notes

updated_at

unique (city_id, resource_key)

Prefer raw item keys such as raw_wood, water, iron_ore, coal, copper_ore, crude_oil.

cityAdjustedBaseOutput = baseExtractionOutput * cityResourceAbundance;
finalOutput = cityAdjustedBaseOutput * existingProductionMultipliers;

Resource abundance affects quantity, not QL.

city_routes

from_city_id, to_city_id

road_distance_miles

baseline_drive_minutes

optional base_freight_cost_per_lb_mile

optional toll_cost

is_active

Seed curated road distance/time data. Do not require an external maps API.

Phase 2 - World and City Economic State

city_economic_state

city_id

population

population_growth_index

labor_supply_index

labor_demand_index

consumer_demand_index

municipal_consumption_index

economic_activity_index

updated_at

world_economic_state

labor_index

consumer_demand_index

municipal_consumption_index

transport_cost_index

optional inflation_index

updated_at

Labor formula

cityLaborPressure = clamp(
  laborDemandIndex / Math.max(laborSupplyIndex, 0.25),
  0.70,
  1.50
);

effectiveCityLaborIndex =
  city.baseLaborIndex * cityLaborPressure * world.laborIndex;

expectedWage =
  skillBasedWage * effectiveCityLaborIndex * employeeExpectationFactor;

Population changes labor supply and demand. Population should not directly set wages.

Events

Use time-bounded world/city events with typed modifier payloads. Examples: Population Boom, Labor Shortage, Recession, Construction Surge, Drought, Energy Shock, Migration Inflow.

Government / Economic Update Cadence

Outside of automatic replenishment procurement caused by municipal stock crossing a reorder threshold, government and world economic state should update once every 24 hours. Do not create minute-by-minute or hourly city-economy writes.

Recommended daily job: tick-government-daily (name can match existing project conventions). One run should process all due government/world simulation work in bounded batches and should be idempotent for a given economic day.

The daily update may:

advance population and city economic indices;

recalculate labor supply/demand and wage pressure;

apply/start/end city and world events;

refresh non-stock government statistics;

create any future non-replenishment public contracts;

update cached city-page statistics where caching is useful;

perform low-priority stockpile maintenance/materialization if required.

Store a field such as last_government_update_at or an economic-day key so repeated scheduler calls cannot advance a city twice during the same 24-hour period. Prefer one authoritative server-side RPC/job over client-triggered writes.

Federal government state is static in the initial implementation and does not require its own recurring update job.

Phase 3 - Municipal Stockpiles

city_stockpiles

city_id, item_key

stored_quantity

target_quantity

reorder_point

critical_point

base_consumption_per_hour

minimum_quality

last_materialized_at

next_reorder_at (nullable projected threshold-crossing time)

is_active

unique (city_id, item_key)

Index next_reorder_at for active stockpiles so automatic procurement can query only stockpiles that are actually due instead of scanning every city/item row.

elapsedHours = hoursBetween(lastMaterializedAt, now);

rate = baseConsumptionPerHour
  * populationScale
  * city.municipalConsumptionIndex
  * world.municipalConsumptionIndex
  * activeItemEventMultiplier;

currentStock = Math.max(0, storedQuantity - elapsedHours * rate);

Do not update stock every minute. Materialize on delivery, a due reorder check with locking, an event/rate boundary, or the daily government maintenance pass.

Whenever stock, consumption rate, population scaling, or relevant demand modifiers change, recompute next_reorder_at:

if (currentStock <= reorderPoint) {
  nextReorderAt = now;
} else if (effectiveConsumptionPerHour > 0) {
  hoursUntilReorder =
    (currentStock - reorderPoint) / effectiveConsumptionPerHour;
  nextReorderAt = now + hoursUntilReorder;
} else {
  nextReorderAt = null;
}

This allows an indexed due query such as next_reorder_at <= now() to drive replenishment contracts without a high-frequency full-table scan.

Phase 4 - Government Procurement Contracts

Municipal replenishment contracts are created automatically from shortages and are the main exception to the 24-hour government update cadence:

if (currentStock <= reorderPoint && !equivalentActiveContract) {
  requestedQuantity = targetQuantity - currentStock;
  createReplenishmentContract();
}

Run this from an indexed due-threshold process using next_reorder_at, and also re-check immediately after relevant stock delivery/materialization. The check must be transactional/idempotent so concurrent workers cannot create duplicate contracts.

Shared Government Contract Provider Model

Use a provider abstraction so city and federal procurement share one contract engine rather than creating incompatible systems later.

Recommended government_contract_providers fields:

id

provider_type = city | federal

city_id nullable; populated for municipal providers

provider_key (for example city:boise or federal:us)

display_name

is_active

optional metadata jsonb for future provider-specific details

Each active city should have one provider record. Seed one Federal provider such as United States Federal Government.

government_contracts

Recommended lifecycle: available -> awarded -> in_progress -> fulfilled -> closed, plus expired and cancelled.

Fields:

provider_id

city_id nullable delivery/issuing city context

stockpile_id nullable; used by municipal replenishment contracts

contract_type such as replenishment | federal_placeholder | future_project

agency_key nullable

item_key

quantity_requested, quantity_delivered

minimum_quality

unit_price, total_value

status, urgency

awarded_business_id

posted_at, deadline_at, closed_at

Municipal replenishment contracts point to a city stockpile. Cross-city goods must be shipped to the issuing/destination city before they can be delivered. Contract delivery atomically deducts destination-city business inventory, replenishes municipal stock, updates contract progress, and pays the business.

Federal Contract Provider - Initial Placeholder

Add the Federal provider now, but keep it intentionally static. It should appear as a valid government contract source in the architecture/UI without simulating a federal stockpile, budget, population, agency economy, or federal economic modifiers yet.

Initial behavior:

Seed one provider_type = federal provider.

Federal contracts may remain empty/disabled in normal gameplay initially.

Do not give the provider a recurring tick or automatic inventory consumption.

Do not let federal placeholder logic alter city/world economic indices yet.

Reserve agency_key / metadata for later agencies and programs such as DOE, DOI, DOT/infrastructure, DOD/military procurement, disaster response, and other large national contracts.

Future federal contracts should use the same award, fulfillment, shipping, QL, payment, history, and closed-contract semantics as city contracts.

Federal contracts are expected to be materially larger and potentially multi-city/multi-delivery in later phases, so avoid schema assumptions that every contract must map to exactly one municipal stockpile.

The purpose of adding this provider in v1 is architectural compatibility, not active federal simulation.

Phase 5 - Route-Based Abstract Freight

Retain shipping_queue as the system carrier.

shipmentTravelMinutes = route.baselineDriveMinutes * LOGISTICS_TIME_SCALE;
arrivesAt = dispatchedAt + shipmentTravelMinutes;

Use LOGISTICS_TIME_SCALE = 1.0 for real-world-like timing initially. If game pacing requires compression later, change the config rather than the route data/schema.

Route-based freight cost can start simple and later use item weights:

freightCost = Math.max(
  minimumShipmentCharge,
  distanceMiles * chargeableWeightLb * baseRatePerLbMile
) * world.transportCostIndex;

Preserve item QL in transit.

City Page

Tabs/sections:

Overview - population, trend, economy, labor pressure, active events.

Resources - all 0..2 abundance values and labels.

Business Environment - tax/property/utility/labor indices.

Municipal Stock - current/target/depletion and healthy/low/critical status.

Available Contracts.

My/Active Contracts.

Closed Contracts.

Logistics - distance/time/freight estimates to other cities.

Government procurement navigation should also provide a Federal provider entry/tab. In the initial release it may show a clear placeholder such as Federal contracting - coming later while still using the shared provider model underneath.

Performance / Supabase Strategy

Government/world economic simulation: once per 24 hours. Do not run general city/government simulation hourly.

Municipal consumption: lazy elapsed-time calculation; never decrement inventory with minute/hour write loops.

Replenishment procurement: event/due-time driven using indexed next_reorder_at, not a full-table scan.

Recompute next_reorder_at only when stock or its effective depletion rate materially changes.

Federal provider: static placeholder; no recurring federal tick in the initial release.

Keep existing due-arrival shipping/travel ticks because they finalize concrete player/cargo events rather than continuously simulating government state.

Use bounded batches, indexed status, deadline, arrives_at, and next_reorder_at queries plus transactional RPCs.

Prefer set-based SQL/RPC updates during the daily government job over one API/database round-trip per city.

Make daily updates idempotent with an economic-day/version key so retries are safe.

Use normalized tables for resources/stock/contracts; reserve JSONB for flexible event/provider metadata.

City economic and government-provider tables are readable but player clients cannot directly modify them.

Avoid realtime subscriptions for broad city statistics unless a specific screen needs them; city pages can fetch a snapshot and refresh on meaningful actions.

Target write profile

For normal inactive cities, the desired pattern is roughly:

zero per-minute city/government writes;

zero per-hour general government writes;

one daily city/economic-state update batch;

stock writes only when materialized because of a delivery, threshold crossing, modifier boundary, or daily maintenance;

contract writes only when contract state actually changes.

This keeps database load driven primarily by meaningful economic events and player activity rather than by the number of simulated minutes that pass.

Reach Goal - Player-Owned Trucking Companies

Gameplay

Create a trucking_company business, buy trucks and trailers, hire drivers, assign one driver + compatible trailer to a truck, load a realistic cargo quantity, dispatch between cities, wait the route-based travel time, then unload/deliver.

Fleet tables

fleet_trucks

fleet_trailers

truck_dispatches

truck_dispatch_cargo

optional freight_jobs

later fleet_maintenance

Assignment rules

One active dispatch per truck.

One active dispatch per trailer.

One active driving dispatch per employee.

Server validates truck/trailer compatibility and driver availability.

Cargo is removed/reserved at origin when dispatch commits.

Item logistics metadata

Eventually add:

unit_weight_lb

unit_volume_cuft

cargo_category

optional refrigeration/liquid/hazard flags

cargoWeightLb = sum(quantity * unitWeightLb);
cargoVolumeCuFt = sum(quantity * unitVolumeCuFt);

validLoad =
  cargoWeightLb <= trailer.maxPayloadLb &&
  cargoVolumeCuFt <= trailer.volumeCuFt &&
  cargoTypesCompatible;

Truck travel time

arrivalAt = departAt
  + route.baselineDriveMinutes * LOGISTICS_TIME_SCALE;

Later add loading/unloading, rest scheduling, congestion, weather and breakdowns if desired. The first trucking release does not need those to achieve realistic city-distance travel.

Truck economics later

driver payroll

fuel = distance / effective MPG

route tolls

mileage-based maintenance/depreciation

empty repositioning

backhaul freight jobs

Critical migration rule

The future trucking system must reuse the same city_routes, cargo QL, inventory destinations, contract destinations and arrival semantics as abstract shipping. Trucks replace the carrier, not the economy.

Implementation Order

Static city profile + resources + route matrix.

Shared government contract-provider abstraction + Federal placeholder.

Dynamic city/world state + employee wage integration with one 24-hour government update cadence.

Municipal stockpiles with lazy depletion and indexed next_reorder_at.

Automatic municipal replenishment contracts + shared government contract lifecycle.

Route-based abstract freight and cross-city contract enforcement.

Player-owned trucking reach goal.

AI Agent Instruction

Implement one phase per branch/PR. Before editing, inspect current city, extraction, employee, travel, shipping, inventory, accounting and tick/RPC code. Centralize deterministic formulas in shared modules. Do not add high-frequency database writes. General government/world simulation must advance at most once per 24-hour economic period; automatic municipal replenishment is the exception and should be triggered only for indexed due stockpiles or relevant stock events. Seed a static Federal government contract provider using the same provider/contract abstraction as cities, but do not implement federal economic simulation yet. Do not allow client-side contract payment or city-state mutation. Add unit/integration tests for resource multipliers, labor indices, daily-update idempotency, lazy consumption, next_reorder_at, contract uniqueness/idempotency, city-vs-federal provider behavior, route timing, cross-city delivery restrictions and QL preservation.