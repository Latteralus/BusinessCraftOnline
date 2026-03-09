import {
  STORE_BUSINESS_TYPES as SHARED_STORE_BUSINESS_TYPES,
  isStoreBusinessType as sharedIsStoreBusinessType,
} from "../../shared/businesses/store";
import {
  BUSINESS_UPGRADE_KEYS,
  getBusinessUpgradeKeysForBusinessType,
  type BusinessUpgradeKey,
} from "./business-upgrades";

export const BUSINESS_TYPES = [
  "mine",
  "farm",
  "water_company",
  "logging_camp",
  "oil_well",
  "sawmill",
  "metalworking_factory",
  "food_processing_plant",
  "winery_distillery",
  "carpentry_workshop",
  "general_store",
  "specialty_store",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const STORE_BUSINESS_TYPES = SHARED_STORE_BUSINESS_TYPES;
export type StoreBusinessType = (typeof STORE_BUSINESS_TYPES)[number];

export function isStoreBusinessType(type: string): type is StoreBusinessType {
  return sharedIsStoreBusinessType(type);
}

export const BUSINESS_ENTITY_TYPES = [
  "sole_proprietorship",
  "llc",
] as const;

export type BusinessEntityType = (typeof BUSINESS_ENTITY_TYPES)[number];

export const STARTUP_COSTS: Record<BusinessType, number> = {
  mine: 3000,
  farm: 2200,
  water_company: 1800,
  logging_camp: 3000,
  oil_well: 4500,
  sawmill: 3500,
  metalworking_factory: 5000,
  food_processing_plant: 3500,
  winery_distillery: 5000,
  carpentry_workshop: 4500,
  general_store: 4000,
  specialty_store: 3500,
};

export const BUSINESS_UPGRADE_KEYS_BY_TYPE: Record<BusinessType, readonly BusinessUpgradeKey[]> =
  BUSINESS_TYPES.reduce(
    (accumulator, businessType) => {
      accumulator[businessType] = getBusinessUpgradeKeysForBusinessType(businessType);
      return accumulator;
    },
    {} as Record<BusinessType, readonly BusinessUpgradeKey[]>
  );

export { BUSINESS_UPGRADE_KEYS };
export type { BusinessUpgradeKey };

export const EXTRACTION_BASE_RATE_PER_MINUTE = 1;
export const MANUFACTURING_TICK_MINUTES = 1;
