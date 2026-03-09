Findings

Medium: Travel rules are split across config and service code, which makes route pricing easy to desync later. cities.ts owns tier prices, but adjacency and “far cross country” classification live only in cities-travel/service.ts. Shipping then depends on that quote logic in inventory/service.ts. The smart consolidation is one travel topology module that owns tier classification, quote calculation, and shipping tier lookup together.

Priority Order

Standardize API route helpers.
Centralize number/money/time utilities.
Extract a shared client API helper and route constants.
Move travel topology into one shared config/module.
Add a shared UI formatter module.
I didn’t make code changes. If you want, I can turn this into an implementation pass and start with the highest-leverage piece: consolidating the API route layer.