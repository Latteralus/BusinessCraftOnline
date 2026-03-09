Findings

Medium: Travel rules are split across config and service code, which makes route pricing easy to desync later. cities.ts owns tier prices, but adjacency and “far cross country” classification live only in cities-travel/service.ts. Shipping then depends on that quote logic in inventory/service.ts. The smart consolidation is one travel topology module that owns tier classification, quote calculation, and shipping tier lookup together.

Medium: Client-side API calling is duplicated across pages, with repeated fetch, JSON parsing, error extraction, and reload patterns. See BankingClient.tsx\banking\BankingClient.tsx#L68), InventoryClient.tsx\inventory\InventoryClient.tsx#L67), MarketClient.tsx\market\MarketClient.tsx#L100), BusinessesClient.tsx\businesses\BusinessesClient.tsx#L91), and the very dense action block in BusinessDetailsClient.tsx. A small src/lib/client/api.ts plus route-path constants would remove a lot of repeated glue and would also clean up inconsistent route naming like /api/banking/business-transfer vs /api/banking/businesses-transfer.

Medium: Presentation formatting is scattered instead of having one UI-facing formatter layer. Currency/date formatting is redefined in BankingClient.tsx\banking\BankingClient.tsx#L33), InventoryClient.tsx\inventory\InventoryClient.tsx#L23), BusinessesClient.tsx\businesses\BusinessesClient.tsx#L64), and EmployeesClient.tsx\employees\EmployeesClient.tsx#L17). Title-casing logic is also duplicated between items.ts and BusinessDetailsClient.tsx. A single src/lib/formatters.ts would prevent small UI inconsistencies from accumulating.

Priority Order

Standardize API route helpers.
Centralize number/money/time utilities.
Extract a shared client API helper and route constants.
Move travel topology into one shared config/module.
Add a shared UI formatter module.
I didn’t make code changes. If you want, I can turn this into an implementation pass and start with the highest-leverage piece: consolidating the API route layer.