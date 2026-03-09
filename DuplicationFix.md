Findings

High: the inventory transfer API contract has already drifted between producer and consumer. The client treats a non-shipping transfer as "instant" in InventoryClient.tsx (line 82), but the domain/service contract returns "same_city" in types.ts (line 59) and service.ts (line 99). This should be a shared API response type, not an inline client alias.

High: ShippingStatus and ShippingQueueItem are defined twice with effectively the same shape in separate domains, which guarantees eventual divergence if one side changes first. See src/domains/inventory/types.ts (line 3) and src/domains/cities-travel/types.ts (line 27). These belong in one dedicated shared transport/shipping contract file.

Medium: manufacturing business membership is also duplicated instead of sourced from the existing production config. The canonical list exists in src/config/production.ts (line 52), but the UI redefines it inline in src/app/(authenticated)/production/ProductionClient.tsx (line 28). This is exactly the kind of config drift that will happen when a new manufacturing business type is added.