import type { BusinessType } from "@/config/businesses";
import { isStoreBusinessType } from "@/config/businesses";
import {
  isExtractionBusinessType,
  isManufacturingBusinessType,
  type ExtractionBusinessType,
  type ManufacturingBusinessType,
} from "@/config/production";

export type BusinessOperationalMode = "storefront" | "extraction" | "manufacturing";

export function supportsStorefront(type: BusinessType): boolean {
  return isStoreBusinessType(type);
}

export function supportsExtraction(type: BusinessType): type is ExtractionBusinessType {
  return isExtractionBusinessType(type);
}

export function supportsManufacturing(type: BusinessType): type is ManufacturingBusinessType {
  return isManufacturingBusinessType(type);
}

export function isProductionBusinessType(type: BusinessType): boolean {
  return supportsExtraction(type) || supportsManufacturing(type);
}

export function getBusinessOperationalMode(type: BusinessType): BusinessOperationalMode {
  if (supportsStorefront(type)) return "storefront";
  if (supportsExtraction(type)) return "extraction";
  return "manufacturing";
}
