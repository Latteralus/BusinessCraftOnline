LifeCraft Online — Economy Balancing Report
Executive Summary
The current economy has three structural problems that dominate everything else:

Most manufacturing is unprofitable or break-even. Raw material ceilings are too high relative to finished goods, meaning players who extract and sell raw materials outperform players who invest in the entire supply chain.
Extraction is wildly more profitable per hour than manufacturing, both because extraction ticks every 1 minute while manufacturing ticks every 10, and because raw material prices are already high enough to sell directly.
Several finished goods have no production path, and several production recipes create items worth less than their inputs.

The recommendations below aim for a semi-realistic economy where: vertical integration (extraction → manufacturing → retail) is the most rewarding long-term strategy; pure extraction is viable early but plateaus; manufacturing margins reward investment in upgrades and skilled workers; and retail stores serve as the high-throughput cash-out mechanism that ties everything together.

Part 1: Margin Analysis of Every Production Chain
All figures use baseline cost (55% of ceiling) for inputs and NPC ceiling as the best-case sale price. Real margins will be narrower.
Extraction Profitability (per hour, 1 slot, variance 0)
BusinessOutputUnits/hrCeilingRev/hrTemp WageTool Cost/hrNet/hrmineiron_ore60$10.00$600$15.50$14.00¹$570farmwheat60$6.00$360$15.50—$344²water_companywater60$2.50$150$15.50—$134logging_campraw_wood60$6.80$408$15.50$16.80³$376oil_wellcrude_oil60$10.60$636$15.50$33.75⁴$587
¹ Pickaxe $28 / 120 ticks = $0.23/min = $14/hr
² Farm also consumes 1 water/tick at base. At baseline water cost ($1.38): 60 × $1.38 = $82.80/hr, reducing net to $261/hr.
³ Axe $24 / 100 ticks = $0.24/min = $14.40/hr (using baseline purchase ~$13.20 → ~$7.92/hr if self-supplied)
⁴ Drill bit $45 / 80 ticks = $0.5625/min = $33.75/hr — this is a major cost center
Takeaway: Extraction is extremely profitable. Even the weakest extractor (water_company) clears $134/hr. Mining and oil earn $500+/hr from a single slot with minimal investment. This sets a very high bar that manufacturing must beat to justify its higher startup cost and complexity.
Manufacturing Profitability (per 10-min tick, then per hour)
RecipeInputs (baseline cost)OutputCeilingMargin/tickMargin/hrWage/hrNet/hrsawmill_planks2 raw_wood ($7.48)wood_plank$5.20−$2.28−$13.68$15.50−$29metal_iron_bars2 iron_ore + 1 coal ($19.25)iron_bar$20.00+$0.75+$4.50$15.50−$11food_flour2 wheat ($6.60)flour$8.80+$2.20+$13.20$15.50−$2.30winery_red_wine3 red_grape ($7.43)red_wine$8.00+$0.57+$3.42$15.50−$12carpentry_chair2 plank + 1 handle ($11.50)chair$45.00+$33.50+$201$15.50+$186
Takeaway: The sawmill loses money on every unit produced — the output is worth less than the inputs. Iron bars, flour, and red wine are all unprofitable after wages. Only carpentry is viable, and it depends on wood_plank (loss-making to produce) and wood_handle (no recipe exists). This means carpentry only works if players can buy those inputs cheaply on the market, which creates a contradiction: who would produce wood_planks at a loss to supply carpenters?

Part 2: Structural Issues
Issue 1: Raw materials are priced too high relative to finished goods
The NPC ceiling for raw_wood ($6.80) is higher than wood_plank ($5.20). Coal at $15.00 is 75% the price of its end product iron_bar ($20.00). There is no economic incentive to add value through manufacturing.
Issue 2: Manufacturing tick rate creates a 6:1 throughput disadvantage
Extraction produces 60 units/hr. Manufacturing produces 6 units/hr (one every 10 minutes). Even if manufacturing had healthy margins per unit, the throughput gap means extraction will almost always win on gross profit per hour unless finished goods are priced ~10x their input cost.
Issue 3: Missing recipes leave dead ends
Items with ceiling prices but no production recipe: wood_handle, steel_bar, steel_beam, pickaxe, axe, drill_bit, chips, red_grape, corn, potato, seeds, whiskey, corn_whiskey, copper_ore, gravel, table. Some of these are critical manufacturing inputs (wood_handle for chairs, tools for extraction). Without recipes, they must come from NPC shops or other unknown sources, which makes supply chain planning impossible.
Issue 4: Farm water consumption is punishing
At base multiplier 1.0, farms consume 1 water every single extraction tick. That's 60 water/hr. At baseline cost, that's $82.80/hr in water alone, eating 23% of gross wheat revenue. The water_efficiency upgrade starts at 0.92 and scales by 1.08, meaning it takes many levels just to make a meaningful dent.
Issue 5: Loans are free money
With no interest accrual, a $50,000 loan at "8% interest" is actually a 0% interest installment plan. Players can borrow max, invest in high-ROI extraction businesses, and pay back from profits with zero carrying cost. This eliminates the intended risk/reward tradeoff of debt.
Issue 6: NPC storefront has 0% fee vs 3% player market fee
This makes storefronts strictly better than the player market for selling to NPCs, removing any reason to engage with the player economy for commodity goods.

Part 3: Recommended Rebalancing
The philosophy: extraction should be the accessible entry point, manufacturing should be the scaling engine, and retail should be the multiplier. Players should feel the pull to move up the value chain.
3A. Revised Item Price Ceilings
The key change: raw materials go down, finished goods go up. Manufacturing margin targets are 40–60% gross margin at baseline input cost to leave room for wages, upgrades, and profit.
ItemCurrent CeilingProposed CeilingRationaleRaw Materialsiron_ore10.005.00Halved; ore is abundant, value comes from refiningcoal15.004.00Support material, should be cheapcopper_ore20.007.00Reduced to match ore tiergravel6.003.00Bulk commoditycrude_oil10.608.00Slightly reduced; high tool cost already limits marginraw_wood6.803.50Must be well below wood_plankwater2.502.00Slight reduction; it's a utility inputwheat6.003.50Reduced; value should come from flour/food chainpotato4.203.00Crop tier pricingcorn4.002.80Crop tier pricingred_grape4.503.50Slightly premium crop for wine chainseeds1.801.50Consumable inputManufactured Goodswood_plank5.208.00Must exceed 2× raw_wood to justify sawmillwood_handle10.5014.00Intermediate good, needs recipeiron_bar20.0018.00Slight reduction, but now inputs are much cheapersteel_bar40.0045.00Premium manufactured goodsteel_beam50.0060.00High-tier construction materialpickaxe28.0035.00Tool demand is constant; price should reflect thataxe24.0030.00Same logic as pickaxedrill_bit45.0055.00Highest tool tier, high consumption ratechair45.0050.00Slight increase; already profitable with new input coststable120.00140.00Premium furnitureflour8.8010.00Comfortable margin over 2× wheatchips0.704.50Currently absurdly low; this is a packaged food productred_wine8.0016.00Doubled; wine/spirits should be high-margin luxury goodswhiskey10.0020.00Luxury spiritcorn_whiskey9.0018.00Luxury spirit
Revised Manufacturing Margins (at proposed prices)
RecipeInput Cost (55% of new ceilings)Output CeilingGross MarginMargin %sawmill_planks2 × $1.93 = $3.85$8.00+$4.1552%metal_iron_bars2 × $2.75 + $2.20 = $7.70$18.00+$10.3057%food_flour2 × $1.93 = $3.85$10.00+$6.1562%winery_red_wine3 × $1.93 = $5.78$16.00+$10.2264%carpentry_chair2 × $4.40 + $7.70 = $16.50$50.00+$33.5067%
Every manufacturing recipe is now clearly profitable before wages and upgrades. After a temp worker wage (~$15.50/hr ÷ 6 ticks/hr = ~$2.58/tick), margins remain healthy:
RecipeNet Margin/tick (after wage)Net/hrsawmill_planks+$1.57+$9.42metal_iron_bars+$7.72+$46.32food_flour+$3.57+$21.42winery_red_wine+$7.64+$45.84carpentry_chair+$30.92+$185.52
Revised Extraction Profitability (new ceilings, 1 slot)
BusinessRev/hr (new ceiling)WageToolWaterNet/hrmine$300$15.50$14.00—$270farm$210$15.50—$66.00¹$128water_company$120$15.50——$104logging_camp$210$15.50$14.40—$180oil_well$480$15.50$33.75—$431
¹ Water consumption at 60/hr × $1.10 baseline
Extraction is still profitable and a good starting point, but no longer so dominant that manufacturing feels pointless. A fully upgraded sawmill or metalworking factory can now compete with or exceed pure extraction returns.
3B. Manufacturing Tick Rate
Consider reducing the manufacturing tick from 10 minutes to 5 minutes. This doubles throughput and makes the per-hour numbers more competitive with extraction without changing per-unit margins. At 5-minute ticks:
RecipeNet/hr (5-min ticks)sawmill_planks+$18.84metal_iron_bars+$92.64food_flour+$42.84winery_red_wine+$91.68carpentry_chair+$371.04
This makes mid-tier manufacturing (iron bars, wine) genuinely competitive with extraction, which is the right dynamic.
3C. Farm Water Consumption
Change the base farmWaterUseMultiplier from 1.0 to 0.6. This means farms consume water 60% of ticks instead of 100%, making farming viable from day one while still giving the water_efficiency upgrade a meaningful role. At 0.6 base, water cost drops from $66/hr to ~$40/hr, bringing farm net up to ~$155/hr — competitive with logging.
3D. Loan Interest Implementation
Actually implement the 8% interest as a weekly accrual:

Each payment period, add balance_remaining × (0.08 / 52) to the balance before calculating the minimum payment.
This gives loans real carrying cost (~0.15%/week) without being punishing.
Alternatively, if you want simpler math: charge a flat 2% origination fee on disbursement. This is a one-time cost that's easy to understand and implement.

3E. NPC Storefront Fee
Add a 5% NPC storefront fee (higher than the 3% player market fee). Rationale: NPC storefronts offer guaranteed, passive demand — that convenience should cost more than the player market where you have to find a buyer. This also creates a meaningful choice: sell fast through your store at lower margin, or list on the market for potentially better returns.
3F. Missing Recipe Priorities
The most critical missing recipes to add, in priority order:

Tool recipes (toolsmith/metalworking): iron_bar + wood_handle → pickaxe/axe, steel_bar + components → drill_bit. Without these, tool costs are arbitrary and disconnected from the economy.
wood_handle (carpentry_workshop or sawmill): 1 raw_wood → 1 wood_handle. This unlocks the chair supply chain.
steel_bar (metalworking_factory): 2 iron_bar + 1 coal → 1 steel_bar. Creates a tier-2 manufacturing chain.
chips (food_processing_plant): 2 potato → chips (with higher output quantity like 4–6 to reflect mass production of a cheap good).
red_grape needs a farming path — either as a farm output option or a crop-switching mechanic.

3G. Startup Cost Adjustments
With lower extraction revenue from reduced raw material ceilings, some startup costs should come down slightly so early game still feels achievable:
BusinessCurrentProposedReasoningmine3,5003,000Lower ore prices mean slower paybackfarm2,5002,200Farming is now mid-tier incomewater_company2,0001,800Lowest revenue extractor, should be cheapest entryoil_well4,5004,500Still highest extraction earner, keep premiumsawmill4,0003,500Manufacturing needs lower barriermetalworking_factory5,5005,000High-margin output justifies moderate cost
3H. Wage Curve Smoothing
Current temp workers at skill 1 cost $15.50/hr but produce the same 1 unit/tick as anyone else. The wage floor is fine, but consider tying worker skill to either extraction speed or quality more aggressively so that paying for skilled workers has a clearer ROI:

Extraction output bonus: 1 + (skillLevel - 1) * 0.005 — a skill-20 worker produces ~10% more per tick.
This makes the wage premium for part_time and full_time workers feel justified rather than purely a cost increase.

3I. Upgrade Cost Recalibration
With revised revenue numbers, check that upgrades pay for themselves within a reasonable timeframe. Target: an upgrade should pay for itself within 2–4 hours of operation at the current business tier.
Example check with proposed numbers — extraction_efficiency level 1 for a mine:

Cost: $900
Effect: output multiplier becomes 1.08 → 8% more ore/hr
Extra revenue: $300/hr × 0.08 = $24/hr
Payback: $900 / $24 = 37.5 hours

That's too long. Either reduce the base cost to ~$400 (payback ~17 hrs) or increase the base effect to 1.15 (payback ~17 hrs). I'd suggest:
UpgradeCurrent Base CostProposedCurrent EffectProposed Effectextraction_efficiency9005001.081.12crop_yield7004001.081.12production_efficiency10006001.081.15tool_durability16508001.101.15
This makes early upgrades feel impactful and achievable, while the exponential cost multiplier still creates meaningful decisions at higher levels.

Part 4: NPC Demand Recheck
Current NPC traffic generates enormous theoretical throughput: 360 base shoppers per 10-minute window across tiers with average budgets of ~$45 each = ~$16,000 per window per store. That's $96,000/hr in potential NPC demand per store.
This is far more demand than any single store could supply, which means stores will almost never feel supply-constrained from the demand side. That's probably fine for a single-store player, but with multiple stores it means NPC revenue scales linearly with inventory supply, not with any competitive pressure.
Recommendation: Reduce base shoppers per sub-tick from 18 to 8. This brings the per-store demand down to ~$43,000/hr — still more than enough to clear inventory, but it means ads, appeal upgrades, and listing capacity matter more because you're competing for a more finite pool of buyers. It also makes the demand curve by time-of-day feel more meaningful.

Part 5: Summary of All Proposed Changes
CategoryChangeImpactRaw material ceilingsReduce 30–60%Makes extraction viable but not dominantFinished good ceilingsIncrease 10–100%Makes manufacturing consistently profitableManufacturing tick10min → 5minDoubles manufacturing throughputFarm water base rate1.0 → 0.6Makes farming competitive at launchLoan interestImplement weekly accrual or origination feeAdds real cost to debtNPC storefront fee0% → 5%Creates sell-channel tradeoffChips ceiling$0.70 → $4.50Fixes absurd pricingRed wine ceiling$8.00 → $16.00Makes winery viableMissing recipesAdd tool, wood_handle, steel_bar, chips, grape pathsCompletes supply chainsStartup costsReduce 10–15% for extraction/early manufacturingEases early game with lower raw pricesUpgrade base costsReduce 35–45%Achievable payback within reasonable playtimeUpgrade base effectsIncrease to 1.12–1.15Early upgrades feel impactfulNPC shoppers/sub-tick18 → 8Makes store upgrades and ads more meaningfulWorker skill → outputAdd 0.5% output/levelJustifies paying for skilled workers
These changes should create an economy where the intended progression — start extracting, invest in manufacturing, open retail — is the natural path of least resistance because each tier multiplies the value of the tier below it.