# Business Upgrades Master Plan

## Purpose
This document defines the target upgrade system for every player-owned business in LifeCraftOnline. It covers:

- The product vision for upgrades at a business-by-business level.
- The source-of-truth model for content, formulas, and runtime behavior.
- The supporting code model, utility files, and DB shape.
- The balancing rationale behind proposed values.
- The rollout order from the current partial implementation to a complete system.

This is intended to be the master reference before implementation work begins.

## Current State Summary
The repo already has the beginnings of a generic upgrade framework:

- `business_upgrades` stores upgrade levels per business.
- `upgrade_definitions` stores reusable upgrade metadata.
- Purchase flow exists in [src/domains/businesses/service.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\domains\businesses\service.ts).
- Preview math exists in [src/domains/upgrades/service.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\domains\upgrades\service.ts) and [src/config/upgrades.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\config\upgrades.ts).
- Runtime effects already exist for:
  - Extraction in [supabase/functions/tick-extraction/index.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\supabase\functions\tick-extraction\index.ts)
  - Manufacturing in [supabase/functions/tick-manufacturing/index.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\supabase\functions\tick-manufacturing\index.ts)
  - Store traffic/sales in [supabase/functions/tick-npc-purchases/index.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\supabase\functions\tick-npc-purchases\index.ts)

The problem is that the system is only half-normalized. Some values live in DB seeds, some in config, some in shared files, and some directly inside tick functions.

## Key Findings From Audit
### 1. Upgrade SSOT is split
Upgrade ownership is currently divided across:

- [src/config/businesses.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\config\businesses.ts)
- [src/config/upgrades.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\config\upgrades.ts)
- [supabase/migrations/20260302150000_017_upgrade_definitions.sql](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\supabase\migrations\20260302150000_017_upgrade_definitions.sql)
- Hardcoded behavior in tick functions

That is manageable for a prototype, but it will drift fast as more businesses and upgrade effects are added.

### 2. One drift already exists
`seed_efficiency` exists in the seeded upgrade definitions migration, but it is not part of the current business config and was later removed by [supabase/migrations/20260309020000_041_remove_farm_seed_input.sql](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\supabase\migrations\20260309020000_041_remove_farm_seed_input.sql).

### 3. Manufacturing ticks still duplicate recipe content
Manufacturing recipes are canonically defined in [src/config/production.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\config\production.ts), but [supabase/functions/tick-manufacturing/index.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\supabase\functions\tick-manufacturing\index.ts) redefines recipe inputs and outputs locally.

### 4. Upgrade effect semantics are inconsistent
Some upgrades are multiplicative above `1.0`, some are reductions below `1.0`, some are additive slot counts, and some are quality bonuses. The current UI in [src/components/businesses/BusinessDetailsClient.tsx](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\components\businesses\BusinessDetailsClient.tsx) presents effects with one generic percentage-oriented pattern, which will become misleading for additive and reduction upgrades.

### 5. Runtime access pattern is too raw
Each tick fetches levels and manually interprets them. That works now, but once each business has 4 to 6 upgrades with different math types, duplicated interpretation logic will become the main bug source.

## Design Goals
The upgrade system should satisfy these goals:

- Each business feels mechanically distinct and flavorful.
- Every upgrade has a clear operational effect and a clear fantasy.
- Upgrades feel like real capital improvements, not abstract stat points.
- Expensive upgrades feel earned and meaningful.
- Upgrades take time to install, so growth feels operational and physical.
- All upgrade definitions come from one canonical content layer.
- Runtime systems consume normalized effect values, not raw upgrade rows.
- UI can render upgrade cards, previews, and effect summaries from the same SSOT.
- Balancing stays legible enough that we can tune values without rewriting domain code.

## Product Vision
Upgrades should feel like the player is physically improving a place, not just increasing a stat.

- A mine should feel like shafts are being reinforced, pumps installed, sorting tables expanded, and deeper veins opened.
- A farm should feel like irrigation is improving, soil is stabilizing, and harvest systems are getting organized.
- A water company should feel like pumps, filters, and delivery pressure are being modernized.
- A logging camp should feel like roads are cleared, felling crews are coordinated, and saw crews stop wasting timber.
- An oil well should feel dangerous, expensive, and high-leverage.
- Manufacturing businesses should feel like floor machinery, process discipline, and throughput engineering.
- Stores should feel like merchandising, shelf density, foot traffic, and conversion skill.

The upgrade UI should read like a foreman’s improvement ledger, not a generic RPG stat panel.

### Growth fantasy
The player should feel a clear journey:

- Startup: improvising with basic tools, limited capacity, and fragile cash flow.
- Early operator: making the first meaningful reinvestments and stabilizing operations.
- Established business: funding serious equipment upgrades and process improvements from profits.
- Regional player: absorbing downtime, planning installs, and specializing businesses by role.
- Large enterprise: making capital decisions with long install windows and significant opportunity cost.

The correct emotional tone is not "I leveled up a building." It is "I finally had the money and operational cushion to install a new dryer line / filtration system / reinforced shaft lift."

## Proposed SSOT Model
### Core principle
The canonical source of upgrade content should live in TypeScript, not only in SQL.

Reason:

- Domain code and UI are already TypeScript-first.
- Tick functions need consistent formulas and descriptors.
- SQL seeds are poor at expressing rich metadata, display sections, tags, unlock notes, and behavior mappings.

### Target ownership
#### 1. Business catalog SSOT
Keep business identity and startup rules in:

- [src/config/businesses.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\config\businesses.ts)

This file should own:

- Business type ids
- Business family/group
- Startup cost
- Business fantasy labels
- Available upgrade ids per business

#### 2. Upgrade content SSOT
Create:

- `src/config/business-upgrades.ts`

This file should own:

- Every upgrade definition
- Which business types it applies to
- Progression model
- Effect semantics
- Display copy
- Flavor text
- Max level rules
- Numeric tuning defaults

Suggested shape:

```ts
type UpgradeEffectKind =
  | "multiplier"
  | "reduction_multiplier"
  | "flat_slots"
  | "flat_quality"
  | "price_tolerance"
  | "traffic_multiplier"
  | "conversion_multiplier";

type BusinessUpgradeDefinition = {
  key: BusinessUpgradeKey;
  family: "extraction" | "capacity" | "durability" | "quality" | "manufacturing" | "store";
  displayName: string;
  shortDescription: string;
  immersiveLabel: string;
  projectCategory: "equipment" | "facility" | "systems" | "staffing" | "storefront";
  appliesTo: BusinessType[];
  effectKind: UpgradeEffectKind;
  baseCost: number;
  costMultiplier: number;
  baseEffect: number;
  gainMultiplier: number;
  installTimeMinutes: number;
  downtimePolicy: "none" | "partial" | "full";
  stage: "early" | "mid" | "late" | "specialization";
  maxLevel: number | null;
  isInfinite: boolean;
  uiFormat: "percent_up" | "percent_down" | "flat_integer" | "quality_points";
};
```

#### 3. Runtime resolver SSOT
Create:

- `src/domains/upgrades/runtime.ts`

This file should own:

- Loading purchased levels for a business
- Resolving upgrade levels into normalized effects
- Returning a business effect bundle used by production/store/tick systems

Suggested shape:

```ts
type BusinessUpgradeEffects = {
  workerCapacitySlots: number;
  extractionOutputMultiplier: number;
  farmWaterUseMultiplier: number;
  toolDurabilityMultiplier: number;
  extractionQualityBonus: number;
  manufacturingOutputMultiplier: number;
  manufacturingInputUseMultiplier: number;
  manufacturingQualityBonus: number;
  storefrontTrafficMultiplier: number;
  storefrontListingCapacityBonus: number;
  storefrontConversionMultiplier: number;
  storefrontPriceToleranceMultiplier: number;
};
```

#### 4. Installation project model
Add a real installation layer between "purchase" and "effect active".

Recommended new table:

- `business_upgrade_projects`

Suggested shape:

```ts
type BusinessUpgradeProject = {
  id: string;
  businessId: string;
  upgradeKey: BusinessUpgradeKey;
  targetLevel: number;
  projectStatus: "queued" | "installing" | "completed" | "cancelled";
  quotedCost: number;
  startedAt: string | null;
  completesAt: string | null;
  appliedAt: string | null;
  downtimePolicy: "none" | "partial" | "full";
  createdAt: string;
  updatedAt: string;
};
```

Rules:

- Purchase creates a project, not an immediate active upgrade.
- Only completed projects contribute effects.
- Install time and downtime come from upgrade definition SSOT.
- A business can have a limited number of concurrent projects, ideally `1` at first.
- Cancelling a project should refund only part of the cost, if refunds are allowed at all.

#### 5. Persistence mirror
Keep DB tables:

- `upgrade_definitions`
- `business_upgrades`

But treat `upgrade_definitions` as a deploy-time mirror of TS SSOT, not the authoring source.

That means:

- TS content is canonical.
- A sync script or migration seed updates DB rows.
- Runtime reads may still use DB if needed, but definitions originate from TS.

## Proposed Utility Files
### New files
- `src/config/business-upgrades.ts`
  - Canonical upgrade catalog and business-to-upgrade mapping.
- `src/domains/upgrades/runtime.ts`
  - Converts rows into applied business effects.
- `src/domains/upgrades/projects.ts`
  - Starts, advances, completes, and cancels installation projects.
- `src/domains/upgrades/formatting.ts`
  - Formats effects correctly for UI by effect kind.
- `src/domains/upgrades/catalog.ts`
  - Query helpers for allowed upgrades per business and content grouping.
- `scripts/sync-upgrade-definitions.ts`
  - Pushes TS-defined upgrade content into `upgrade_definitions`.

### Existing files to simplify
- [src/config/businesses.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\config\businesses.ts)
  - Keep business identities and startup values.
  - Remove detailed upgrade base costs from here.
- [src/config/upgrades.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\config\upgrades.ts)
  - Keep only generic math helpers if still useful.
- [src/domains/upgrades/service.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\domains\upgrades\service.ts)
  - Use the new catalog/runtime layer instead of raw generic DB-only logic.

## Proposed Data Model
### Keep
- `business_upgrades`
  - Good shape for current needs.
- `upgrade_definitions`
  - Good as a queryable copy for UI/admin/runtime.

### Add in phase 1
- `business_upgrade_projects`
  - Required for installation time and earned-feeling capital projects.

### Consider adding later
- `business_upgrade_events`
  - Audit log for upgrade purchases and balancing analytics.
- `business_upgrade_unlocks`
  - Only if future design introduces prerequisites or city-specific tech unlocks.

### Why a project table is required
If upgrades should take time to install, then `business_upgrades` alone is not enough. We need a stateful project record so the game can show:

- what is being installed
- how long remains
- whether operations are disrupted
- when effects go live
- whether the player is tying up capital in active expansion

## Balancing Rules
### Cost philosophy
Early upgrades should feel attainable inside a short play session. Mid-tier upgrades should require business reinvestment. High-tier upgrades should become specialization choices, not defaults.

Refinement from the vision:

- Attainable does not mean cheap.
- The first upgrade should still feel like a serious reinvestment for a young business.
- Mid and late upgrades should feel like capital expenditures, not convenience purchases.
- If the player can casually buy multiple upgrades back-to-back from routine cash on hand, costs are too low.

Recommended default bands:

- Early operational upgrades: base cost `20%` to `40%` of startup cost
- Mid-tier process upgrades: base cost `45%` to `90%` of startup cost
- Major equipment upgrades: base cost `1.0x` to `1.75x` startup cost
- Capacity/facility expansions: base cost `1.5x` to `3.0x` startup cost
- Signature specialization upgrades: base cost `2.0x+` startup cost

Recommended cost multiplier:

- Default `1.35`
- Use `1.45` for upgrades with very strong late-game leverage
- Use finite caps for highly impactful capacity upgrades instead of letting them scale forever

### Effect philosophy
Upgrades should not erase business identity.

- Extraction businesses should win on raw input supply, not premium product margins.
- Manufacturing businesses should win on quality and input shaping, not infinite throughput.
- Stores should win on turnover and pricing resilience, not production.

Recommended effect defaults:

- Throughput multipliers: `+6%` to `+10%` equivalent per level
- Input reduction: `3%` to `5%` equivalent per level
- Tool durability: `+8%` to `+12%` per level
- Quality bonuses: `+3` to `+5` quality points per level before worker/random modifiers
- Store traffic: `+4%` to `+6%` per level
- Conversion / price tolerance: `+2%` to `+4%` per level
- Listing capacity: flat integer, capped

### Why these values
- Capital upgrades should feel expensive enough that even modest gains are worth respecting.
- `+6%` to `+10%` feels meaningful when the upgrade itself is a serious project with installation time.
- `3` to `5` quality points is strong enough to matter in pricing and item differentiation without making workers irrelevant.
- Flat slot gains belong to capacity because slot count has stepwise impact and should remain expensive.
- Store traffic at `+5%` scales well because ad spend and time-of-day demand already compound it.

### Installation time philosophy
Time is part of the cost.

Recommended install windows:

- Early systems tune-up: `15` to `45` minutes
- Equipment replacement / reinforcement: `1` to `3` hours
- Facility expansion / additional line / major storefront renovation: `4` to `12` hours
- Prestige or enterprise projects: `12` to `24+` hours

Downtime guidance:

- `none`: signage, training, software/process work, light optimization
- `partial`: reduced output or traffic while install is underway
- `full`: major construction, floor rebuild, shaft reinforcement, line replacement

The player should sometimes choose between immediate production and long-term growth.

### Upgrade purchase funding rule
Upgrades should be funded from the business account, not personal money, whenever possible.

Reason:

- It reinforces the fantasy of reinvestment.
- It makes each business feel like an operation with its own capital base.
- It naturally creates "startup -> profitable shop -> expansion" progression.

Personal cash can still matter by letting the player transfer money into the business to fund a project.

## Business-by-Business Upgrade Vision
Each business should keep 3 core upgrades and optionally 1 signature upgrade.

### Mine
Fantasy:
Deeper shafts, reinforced supports, ore sorting tables, and cleaner extraction routes.

Upgrade ladder:

- `extraction_efficiency` -> Ventilation improvements, rail cart flow, drilling pattern upgrades.
- `worker_capacity` -> Additional shaft lane, hoist access, expanded staging area.
- `tool_durability` -> Maintenance bay, reinforced tooling, hardened cutting heads.
- `ore_quality` -> Sorting deck, wash tables, deeper seam access.

Why:
The mine is the archetypal raw-material specialist. It should scale in both volume and material grade.

### Farm
Fantasy:
Irrigation ditches, soil management, crop rotation discipline, and harvest organization.

Upgrade ladder:

- `crop_yield` -> Better irrigation layout, improved row spacing, cleaner harvest process.
- `water_efficiency` -> Pump automation, retention trenches, irrigation controls.
- `worker_capacity` -> Additional field crews, expanded equipment access, more harvest lanes.
- Proposed new signature upgrade: `soil_quality`

`soil_quality` rationale:
Farms currently lack a premium-output identity. A soil-quality upgrade would let farms occasionally or consistently output higher-quality crops without stealing manufacturing’s role.

### Water Company
Fantasy:
Pump pressure, filtration, storage tanks, and route reliability.

Upgrade ladder:

- `extraction_efficiency`
- `worker_capacity`
- Proposed new signature upgrade: `purity_control`

`purity_control` rationale:
Water is a foundational industrial input. A purity upgrade gives it a meaningful premium axis for downstream manufacturing recipes later.

### Logging Camp
Fantasy:
Road clearing, crew coordination, equipment hardening, and timber grading.

Upgrade ladder:

- `extraction_efficiency` -> Better haul roads, organized felling zones, faster loading.
- `worker_capacity` -> More crews and yard throughput.
- `tool_durability` -> Hardened saw chains, maintenance shed, spare parts stock.
- Proposed new signature upgrade: `timber_quality`

Why:
Logging should mirror mining structurally but output organic materials and feed sawmills more efficiently.

### Oil Well
Fantasy:
Pressure handling, pump tuning, hazard controls, and high-risk extraction.

Upgrade ladder:

- `extraction_efficiency` -> Pump tuning, flow management, more reliable extraction cycles.
- `worker_capacity` -> Additional shift crews and support handling.
- `tool_durability` -> Reinforced drill assemblies and maintenance hardening.
- Proposed new signature upgrade: `well_pressure_control`

Why:
Oil should be expensive to improve but highly levered. Its signature upgrade can later reduce downtime or improve premium output odds.

### Sawmill
Fantasy:
Blade alignment, feed speed, lumber drying, and reduced offcut waste.

Upgrade ladder:

- `production_efficiency` -> Feed line tuning, blade speed optimization, cleaner movement between stages.
- `worker_capacity` -> Additional line hands and material handling positions.
- `equipment_quality` -> Better blade alignment, planing quality, finish consistency.
- `input_reduction` -> Offcut reduction, tighter cuts, waste capture.

Why:
This is the baseline manufacturing pattern. It converts abundant raw materials into dependable intermediates.

### Metalworking Factory
Fantasy:
Furnace discipline, mold quality, forge heat control, and efficient slag handling.

Upgrade ladder:

- `production_efficiency` -> Furnace pacing, mold turnaround, improved workflow.
- `worker_capacity` -> Additional floor crew and machine support.
- `equipment_quality` -> Better dies, tighter tolerances, cleaner finish.
- `input_reduction` -> Less slag loss, better batch discipline, reduced waste.

Why:
It should be expensive, stable, and quality-sensitive. Strong candidate for a future fifth upgrade around heat treatment or batch consistency.

### Food Processing Plant
Fantasy:
Cleaner milling, tighter prep lines, preservation, and throughput hygiene.

Upgrade ladder:

- `production_efficiency` -> Better line coordination, cleaner prep turnover, faster processing.
- `worker_capacity` -> Additional packing and prep stations.
- `equipment_quality` -> Better milling, preservation, and consistency.
- `input_reduction` -> Less spoilage and lower process waste.

Why:
This business should excel at turning bulk agriculture into reliable retail-ready goods.

### Winery / Distillery
Fantasy:
Fermentation control, barrel handling, selective blending, and finish quality.

Upgrade ladder:

- `production_efficiency` -> Better batching, cleaner cycle timing, improved throughput.
- `worker_capacity` -> Additional cellar/floor handling staff.
- `equipment_quality` -> Better vats, barrel systems, and finish consistency.
- `input_reduction` -> Less spillage, lower batch loss, tighter blending waste.
- Proposed later signature upgrade: `aging_program`

Why:
This is the best candidate for future time-based premium goods. Its fantasy benefits from one prestige-style upgrade later.

### Carpentry Workshop
Fantasy:
Bench layout, joinery precision, finishing quality, and material efficiency.

Upgrade ladder:

- `production_efficiency` -> Better shop layout, smoother handoff between stations.
- `worker_capacity` -> Additional benches and assembly coverage.
- `equipment_quality` -> Better jigs, finishing tools, precision setup.
- `input_reduction` -> Less scrap, better cuts, more efficient material usage.

Why:
It is a craft-heavy manufacturer. Quality should matter more here than raw quantity in the long run.

### General Store
Fantasy:
Cleaner storefront, denser shelving, more foot traffic, and better conversion.

Upgrade ladder:

- `storefront_appeal` -> Window refresh, signage, lighting, exterior cleanup.
- `listing_capacity` -> Shelving expansion, stockroom organization, denser merchandising.
- `customer_service` -> Counter layout, checkout speed, trained floor staff.

Why:
General stores should feel broad, efficient, and volume-oriented.

### Specialty Store
Fantasy:
Curated displays, reputation, knowledgeable staff, and premium buyer confidence.

Upgrade ladder:

- `storefront_appeal` -> Premium displays, curated layout, exterior polish.
- `listing_capacity` -> Additional fixtures and specialty shelving.
- `customer_service` -> Product expertise, higher trust, premium sales handling.
- Proposed later distinction: better premium pricing tolerance than general stores

Why:
Specialty stores should share the same skeleton as general stores but eventually branch into stronger high-quality item monetization.

## Target Runtime Model
### Rule
Ticks and domain services should not manually interpret raw upgrade levels.

They should instead do:

1. Load purchased upgrades for a business.
2. Resolve them into a `BusinessUpgradeEffects` bundle.
3. Use named effect fields.

Example:

```ts
const effects = await getResolvedUpgradeEffects(client, business.id, business.type);
const outputQty = Math.max(1, Math.floor(baseQty * effects.manufacturingOutputMultiplier));
```

This removes hidden formula duplication from:

- Extraction tick
- Manufacturing tick
- NPC store purchases
- UI preview rendering
- Any future analytics or AI/NPC logic

### Project lifecycle rule
Only completed upgrade projects count toward active effects.

Lifecycle:

1. Player selects an upgrade project.
2. Cost is quoted from current target level.
3. Business funds are debited.
4. Project enters `queued` or `installing`.
5. Optional downtime rules are applied while in progress.
6. Completion promotes the target level in `business_upgrades`.
7. Runtime effects become active only after completion.

## UI Model
### Upgrade card content
Each card should render:

- Display name
- Operational description
- Immersive sublabel
- Current level
- Current effect
- Next effect
- Next cost
- Install time
- Downtime expectation
- Project stage
- Max level state

### Formatting rules
- Multipliers above `1.0`: show `+10%`, `+21%`, etc.
- Reduction multipliers below `1.0`: show `-10% water use`, not `+90%`.
- Flat slot bonuses: show `+1 slot`, `+2 slots`.
- Quality bonuses: show `+5 quality`.

This requires formatter logic instead of one generic UI formula.

### Upgrade presentation direction
The UI should present upgrades as business projects, not buttons in a stat list.

Each upgrade card should feel like a contractor or operations proposal:

- Project name
- Why it matters operationally
- What is being physically installed or improved
- Capital required
- Install window
- Disruption level
- Expected gains after completion

Good labels:

- "Reinforced Shaft Lift"
- "Irrigation Control Retrofit"
- "Kiln Alignment Package"
- "Premium Windowfront Renovation"

Bad labels:

- "Efficiency II"
- "Capacity +1"
- "Quality Boost"

### In-progress UI
Each business page should surface:

- active capital project
- remaining install time
- current downtime effect
- projects waiting in queue

This is what makes the feature feel earned.

## Concrete Implementation Plan
### Phase 1: Normalize content ownership
- Add `src/config/business-upgrades.ts`.
- Move upgrade definitions out of scattered config into one catalog.
- Keep DB rows but generate/sync them from TS content.
- Remove obsolete `seed_efficiency` references completely.
- Add real-world metadata: install time, downtime policy, project category, and stage.

### Phase 2: Add installation project layer
- Add `business_upgrade_projects`.
- Add upgrade project domain service and validations.
- Change purchase flow from "instant level up" to "fund project".
- Add completion logic so only finished projects affect gameplay.

### Phase 3: Add runtime effect resolver
- Add `src/domains/upgrades/runtime.ts`.
- Update business purchase flow to validate against catalog SSOT.
- Update preview logic to use effect-kind-aware formatting.

### Phase 4: Refactor ticks to use resolved effects
- Refactor extraction tick to use resolved effect bundle.
- Refactor manufacturing tick to stop duplicating recipe data and upgrade logic.
- Refactor NPC purchase tick to use store upgrade effects from one helper.
- Add optional downgrade behavior during active installation if downtime policy requires it.

### Phase 5: Expand business flavor
- Add signature upgrades where needed:
  - `soil_quality`
  - `purity_control`
  - `timber_quality`
  - `well_pressure_control`
  - `aging_program`
- Only add these after the resolver and UI formatting layer are stable.

### Phase 6: UI immersion pass
- Rework business upgrade tab into business-themed cards.
- Group upgrades by business system: throughput, quality, staffing, storefront.
- Add short flavor copy per business type.
- Add project timeline, install progress, and downtime indicators.

## Implementation Notes By File
### Files to edit first
- [src/config/businesses.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\config\businesses.ts)
- [src/config/upgrades.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\config\upgrades.ts)
- [src/domains/upgrades/service.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\domains\upgrades\service.ts)
- `src/domains/upgrades/projects.ts`
- [src/domains/businesses/service.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\domains\businesses\service.ts)
- [src/components/businesses/BusinessDetailsClient.tsx](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\components\businesses\BusinessDetailsClient.tsx)
- [supabase/functions/tick-extraction/index.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\supabase\functions\tick-extraction\index.ts)
- [supabase/functions/tick-manufacturing/index.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\supabase\functions\tick-manufacturing\index.ts)
- [supabase/functions/tick-npc-purchases/index.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\supabase\functions\tick-npc-purchases\index.ts)

### Files that should remain SSOT-adjacent
- [src/config/production.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\src\config\production.ts)
- [shared/production/extraction.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\shared\production\extraction.ts)
- [shared/businesses/store.ts](c:\Users\Chris\OneDrive\Desktop\LifeCraftOnline\shared\businesses\store.ts)

## Recommended First Implementation Slice
The safest first coding slice is:

1. Create `src/config/business-upgrades.ts`.
2. Add `business_upgrade_projects` and switch purchases to install projects.
3. Refactor upgrade preview and purchase validation to use the catalog.
4. Add `runtime.ts` effect resolution helpers.
5. Wire extraction, manufacturing, and storefront ticks to that resolver.
6. Fix upgrade card formatting and add project timelines in the business details UI.

This gives one clean vertical slice with the earned-feeling installation loop, without yet introducing a large number of new upgrade ids.

## Final Recommendation
Do not start by adding more upgrade rows. Start by building the capital-project loop.

If the system remains instant-purchase and split between SQL seeds, config constants, and tick-local formulas, the feature will feel gamey no matter how good the upgrade names are. The feature becomes immersive when:

- upgrades are real-world operational improvements
- they cost serious money
- they take time to install
- they sometimes disrupt operations
- they come online as completed business projects

That is the version that will make the player feel they built something substantial.
