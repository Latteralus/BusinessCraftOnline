import type { BusinessType } from "@/config/businesses";

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  mine: "Mine",
  farm: "Farm",
  water_company: "Water Company",
  logging_camp: "Logging Camp",
  oil_well: "Oil Well",
  sawmill: "Sawmill",
  metalworking_factory: "Metalworking Factory",
  food_processing_plant: "Food Processing Plant",
  winery_distillery: "Winery / Distillery",
  carpentry_workshop: "Carpentry Workshop",
  general_store: "General Store",
  specialty_store: "Specialty Store",
};

export function formatBusinessType(value: string): string {
  return BUSINESS_TYPE_LABELS[value as BusinessType] ?? value;
}
