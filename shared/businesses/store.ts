export const STORE_BUSINESS_TYPES = ["general_store", "specialty_store"] as const;

export type SharedStoreBusinessType = (typeof STORE_BUSINESS_TYPES)[number];

export function isStoreBusinessType(type: string): type is SharedStoreBusinessType {
  return STORE_BUSINESS_TYPES.includes(type as SharedStoreBusinessType);
}
