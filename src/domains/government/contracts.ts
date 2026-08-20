import type { GovernmentContract, GovernmentContractProvider, ProjectedCityStockpile } from "./types";

export type CityStockpilesResponse = {
  stockpiles: ProjectedCityStockpile[];
  error?: string;
};

// CityPlan Phase 4 response shapes. Deliberately named for the API-route
// response envelope, not the government_contracts table -- see this file's
// existing role as the domain's "view"/response-DTO file (table logic lives
// in service.ts, row types in types.ts).

export type GovernmentContractProvidersResponse = {
  providers: GovernmentContractProvider[];
  error?: string;
};

export type GovernmentContractsResponse = {
  contracts: GovernmentContract[];
  error?: string;
};
