Business Craft Online — Quality Economy Implementation Plan
1. Define the production-quality rules centrally

Create a shared quality utility, preferably something like:

shared/production/quality.ts

Do not duplicate quality formulas inside manufacturing, farming, extraction, storefronts, etc.

The production rule should be:

processCapability =
  employeeSkillLevel +
  facilityQualityBonus;


outputQuality =
  min(inputQualityCap, processCapability);

Everything is clamped to 1–100.

For example:

Inputs:             85 QL
Employee Skill:     45
Facility Upgrades: +20


Process Capability: 65 QL


Output:             65 QL

But:

Inputs:             40 QL
Employee Skill:     70
Facility Upgrades: +25


Process Capability: 95 QL


Output:             40 QL

The excellent worker and factory cannot turn QL40 materials into QL95 materials. They can only realize the potential available in their inputs.

I recommend the shared API look conceptually like:

resolveInputQualityCap(...)
resolveProcessQualityCapability(...)
resolveProductionQuality(...)

with:

resolveProcessQualityCapability({
  employeeSkillLevel,
  facilityQualityBonus,
})

and:

resolveProductionQuality({
  inputQualityCap,
  processCapability,
})

No random parameters. No RNG.

2. Multiple inputs determine one quality cap

Manufacturing already knows the quality and exact quantity of inventory rows consumed. It currently quantity-weights those qualities and then adds manufacturingQualityBonus.

Keep the quantity-weighted calculation, but change its meaning.

Instead of:

weighted input QL + quality bonus
= output QL

make it:

weighted input QL
= input quality cap

For example:

2 × QL80 iron bar
1 × QL50 wood handle


Input cap:


(80×2 + 50×1) / 3
= 70 QL

Then:

Employee skill:       55
Factory quality bonus: +25


Process capability = 80


Input cap          = 70
Process capability = 80


Output = 70 QL

Or with a worse employee/factory:

Input cap          = 70
Process capability = 48


Output = 48 QL

For now, keep quantity weighting. Don't add recipe-specific QL weights yet. That can always be added later if you decide, for example, that iron-bar quality should matter more than handle quality in a pickaxe.

Use floor or otherwise ensure the resulting output never rounds above its calculated input cap.

3. Change manufacturing to use employee skill

This is the most obvious missing piece.

Your manufacturing tick already fetches the recipe-specific employee skill, but currently the skill earns XP without participating in the product-quality calculation.

Change manufacturing to:

Actual consumed input quality
            ↓
Weighted Input Quality Cap
            ↓


Employee recipe skill
        +
effects.manufacturingQualityBonus
            ↓
Process Capability
            ↓


MIN(Input Cap, Process Capability)
            ↓
Output QL

The recipe already contains the appropriate skillKey, such as:

carpentry
metalworking
food_production
brewing

so use that employee skill directly.

Do not change XP progression as part of this task.

Do not change output quantities.

Do not change input consumption quantities.

This task should only change how QL is resolved.

4. Reinterpret existing facility quality upgrades

Don't build another factory-level system.

You already have exactly what we need:

effects.manufacturingQualityBonus
effects.extractionQualityBonus

and your upgrade architecture maps many existing upgrades into those fields.

Examples already include things such as:

Equipment Quality
Sawmill Blade Set
Kiln Dryer
Metal Grinder Rack
CNC Lathe
Heat Treatment Oven
Pasteurizer
Freeze Dryer
Oak Barrels
Temperature Tanks
Spray Booth
CNC Joinery
etc.

Your generic equipment_quality upgrade already grants +5 quality points per level and is explicitly described as raising manufacturing output quality.

So simply reinterpret these bonuses as:

additional process-quality capability

rather than:

quality magically added to the inputs.

That distinction is important.

5. Apply the same system to extraction businesses

Raw-resource businesses have no manufactured input from which to inherit QL.

For these businesses:

Employee Skill
      +
Extraction Quality Upgrades
      ↓
Raw Resource QL

So:

rawResourceQuality =
  clamp(
    employeeSkillLevel +
    effects.extractionQualityBonus,
    1,
    100
  );

Use the appropriate employee skill already associated with that extraction business.

This means the origin of quality enters the economy through extraction.

For example:

Mine
Mining Skill 40
Ore-quality upgrades +15


→ QL55 iron ore

That ore can eventually become:

QL55 Ore
   ↓
QL≤55 Iron Bar
   ↓
QL≤55 Steel
   ↓
QL≤55 Tool

unless mixed with other materials that alter the weighted input cap.

That gives the supply chain real provenance.

6. Farms are the special bridge between extraction and manufacturing

Your farm system already consumes water and even orders the available water inventory by highest QL first, but it currently doesn't retain that water quality when determining crop QL. Crop output is presently based on extractionQualityBonus.

Change farm input consumption so it also returns the quality of the water being used.

Then:

Water QL
   ↓
Crop Input Cap


Farming Skill
     +
Farm Quality Upgrades
     ↓
Farm Process Capability


MIN(Input Cap, Process Capability)
     ↓
Crop QL

Example:

100 QL water


Farmer: 47 farming
Farm upgrades: +18 QL


Process capability = 65


Crop output = 65 QL

But:

40 QL water


Farmer: 80
Farm upgrades: +20


Process capability = 100


Crop output = 40 QL

This is the behavior you described.

Structure this so additional farm inputs can later participate without rewriting the quality engine:

Water
Seeds
Fertilizer
etc.
   ↓
resolveInputQualityCap()

You don't need to add those inputs now.

7. Don't require a database redesign

This should preferably use your existing:

business_inventory.quality
employee_skills.level
manufacturingQualityBonus
extractionQualityBonus

Manufacturing already distinguishes inventory rows by QL and consumes actual rows, so use that rather than introducing per-item serial numbers or provenance tracking.

Avoid adding schema unless inspection during implementation reveals an actual requirement.

Also preserve the current highest-quality-first input consumption behavior for now. Choosing exactly which QL batches a production line consumes can become a separate production-control feature later.

8. Add quality-adjusted NPC value

Implement the pricing system we discussed as a separate shared calculation.

Keep:

NPC_PRICE_CEILINGS

as the 0QL reference value.

Do not modify those base values.

Add something equivalent to:

export const NPC_QUALITY_PRICE_PREMIUM_MAX = 0.50;

and:

qualityMultiplier =
  1 + (quality / 100) * NPC_QUALITY_PRICE_PREMIUM_MAX;

Therefore:

QL 0   = 1.00×
QL 20  = 1.10×
QL 40  = 1.20×
QL 60  = 1.30×
QL 80  = 1.40×
QL 100 = 1.50×

Then:

qualityAdjustedNpcValue =
  baseNpcValue * qualityMultiplier;

Example:

Base NPC value: $100


QL0   → $100
QL50  → $125
QL100 → $150

This is not the player's sale price.

It is the NPC's quality-adjusted reference value.

9. Change storefront NPC price evaluation

Currently the storefront score uses the fixed base NPC value for its price ratio, even though quality separately improves desirability.

Change:

priceRatio =
  unitPrice / baseNpcValue;

to conceptually:

priceRatio =
  unitPrice / qualityAdjustedNpcValue;

So:

QL0 product
NPC value $100
Player price $100


Price ratio = 1.0

and:

QL100 product
NPC value $150
Player price $150


Price ratio = 1.0

Both are considered normally priced.

Keep the existing NPC qualityPreference system.

The difference is:

Quality-adjusted value:
"Is this item's price justified by its QL?"


Quality preference:
"How much does this particular shopper care about QL?"

Those should remain separate concepts.

10. Fix the cheapest-listing price band

This must happen at the same time.

Both storefront and open-market NPC purchasing currently create a candidate band based on the cheapest raw price.

That would unfairly exclude premium products.

Instead compare quality-normalized prices:

normalizedPrice =
  unitPrice / qualityMultiplier;

Example:

QL0 @ $100


$100 / 1.00
= $100 normalized




QL100 @ $150


$150 / 1.50
= $100 normalized

Those should occupy the same pricing band.

Then the existing shopper quality preference can determine which one the NPC prefers.

Apply this to both:

tick-npc-purchases
tick-npc-market-purchases

Both already share the storefront scoring system, so keep the common logic centralized.

11. Important accounting rule

Do not apply the 50% QL premium to manufacturing cost basis.

Your current code uses NPC_PRICE_CEILINGS * 0.55 in several places as a fallback accounting cost.

Leave that behavior alone.

The new QL calculation controls:

NPC perceived economic value

not:

inventory accounting cost

The actual production cost should continue to come from consumed materials whenever available.

12. Required deterministic acceptance tests

The AI implementing this should verify at minimum:

CASE 1
Input QL: 100
Employee skill: 40
Facility bonus: 20


Capability = 60
Output = 60
CASE 2
Input QL: 50
Employee skill: 80
Facility bonus: 20


Capability = 100
Output = 50
CASE 3
Inputs:
2 × QL80
1 × QL50


Input cap = 70


Employee = 50
Facility = +10


Output = 60
CASE 4
Same inputs


Employee = 80
Facility = +20


Output = 70
CASE 5 — Farm
100QL water
Farming 35
Farm quality upgrades +20


Crop = QL55
CASE 6 — Raw extraction
Mining skill 60
Extraction quality upgrades +15


Ore = QL75
CASE 7 — NPC pricing
Base value = $100
QL0 item @ $100


Normalized price/value ratio = 1.0
CASE 8
Base value = $100
QL100 item @ $150


Normalized price/value ratio = 1.0
CASE 9
Base value = $100
QL100 item @ $200


Adjusted value = $150
Price ratio = 1.333...

And the invariants:

1 <= QL <= 100


outputQL <= inputQualityCap
for production requiring inputs


No Math.random()
No seeded RNG
No probability-based QL


Higher employee skill never reduces capability.


Higher quality upgrades never reduce capability.


Higher input QL never reduces the possible output QL.


QL100 produces a maximum NPC value premium of exactly +50%.
Copy-paste instruction for your coding AI

You can give your VS Code agent this essentially verbatim:

Implement the Quality Economy plan below in Business Craft Online. First inspect the existing production, extraction, employee skill, business upgrade, storefront NPC purchase, and open-market NPC purchase systems before editing.

Production quality must be completely deterministic. Do not introduce RNG.

Production rule: input quality determines the maximum possible output quality. Employee skill plus the business's existing quality-upgrade effect determines process capability. Output quality is the lesser of the input-quality cap and process capability.

For manufacturing, calculate the input-quality cap from the quantity-weighted quality of the actual inventory rows used. Calculate process capability as the recipe-relevant employee skill level plus manufacturingQualityBonus, clamped to 1–100. Output QL must be min(inputQualityCap, processCapability).

For raw extraction businesses without material inputs, output QL should be the relevant employee skill plus extractionQualityBonus, clamped to 1–100.

For farms, water quality must become an input-quality cap. Modify farm water consumption so its QL participates in crop quality. Crop process capability should be farming skill plus extractionQualityBonus. Structure this so future farm inputs can later participate in the same shared input-quality calculation.

Centralize reusable quality calculations under shared production code rather than duplicating formulas across Edge Functions. Preserve existing production quantities, XP behavior, input quantities, cost accounting, and upgrade progression unless required for this feature.

Then implement quality-adjusted NPC valuation. Keep NPC_PRICE_CEILINGS as the QL0/base reference values. Add a centralized quality-value multiplier where QL0 = 1.00× and QL100 = 1.50×, interpolated linearly. Use the quality-adjusted value when calculating NPC price ratios.

Fix both storefront and open-market candidate price-band filtering so listings are compared by quality-normalized price rather than raw price. A QL0 item at $100 and QL100 item at $150 must be considered equivalently priced for band-selection purposes when the base value is $100.

Preserve existing shopper quality preference behavior. Quality-adjusted value answers whether a price is justified by product quality; shopper quality preference determines how strongly an individual shopper prefers higher-quality goods.

Do not apply the quality price premium to inventory cost basis or the existing 55%-of-ceiling fallback accounting calculations.

Search the repository for all uses of NPC_PRICE_CEILINGS, getNpcBuyerPriceRange, getStorefrontShelfPurchaseScore, manufacturingQualityBonus, extractionQualityBonus, and employee skill calculations before making changes so shared behavior is not missed.

Add or update tests for the deterministic examples and invariants in this specification. Run the project's typecheck and relevant tests after implementation. Do not suppress new TypeScript errors with @ts-ignore, additional @ts-nocheck, unsafe casts, or weakened typing. Report the files changed, exact formulas implemented, tests run, and any edge cases found.

The part I particularly like about this design is that it creates one continuous economic loop:

Skilled Water Company + Upgrades
            ↓
         90QL Water
            ↓
Skilled Farm + Farm Upgrades
            ↓
         75QL Wheat
            ↓
Skilled Food Factory + Equipment
            ↓
         70QL Flour
            ↓
        Retailer
            ↓
NPCs recognize QL70 as worth ~35% more

Quality has to be created upstream, preserved downstream, and monetized at the end. That gives suppliers, employees, factory upgrades, vertical integration, and premium retailers reasons to exist within the same economic system.