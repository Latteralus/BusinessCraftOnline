import type { BusinessType } from "@/config/businesses";
import type { EmployeeStatus } from "@/config/employees";
import type {
  ExtractionSlotStatus,
  ManufacturingRecipe,
  ManufacturingStatus,
  ToolItemType,
} from "@/config/production";

export type ExtractionSlot = {
  id: string;
  business_id: string;
  slot_number: number;
  employee_id: string | null;
  status: ExtractionSlotStatus;
  tool_item_key: ToolItemType | null;
  input_progress: number;
  output_progress: number;
  last_extracted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ToolDurability = {
  id: string;
  extraction_slot_id: string;
  item_type: ToolItemType;
  uses_remaining: number;
  installed_at: string;
  updated_at: string;
};

export type ExtractionSlotWithDetails = ExtractionSlot & {
  business_type: BusinessType;
  employee_status: EmployeeStatus | null;
  tool: ToolDurability | null;
};

export type ProductionStatus = {
  businessId: string;
  businessType: BusinessType;
  maxSlots: number;
  slots: ExtractionSlotWithDetails[];
  summary: {
    total: number;
    active: number;
    idle: number;
    resting: number;
    toolBroken: number;
    occupied: number;
  };
};

export type EnsureSlotsInput = {
  businessId: string;
};

export type AssignExtractionSlotInput = {
  slotId: string;
  employeeId: string;
};

export type UnassignExtractionSlotInput = {
  slotId: string;
};

export type InstallToolInput = {
  slotId: string;
  itemType: ToolItemType;
};

export type SetExtractionSlotStatusInput = {
  slotId: string;
  status: ExtractionSlotStatus;
};

export type ManufacturingJob = {
  id: string;
  business_id: string;
  active_recipe_key: string | null;
  status: ManufacturingStatus;
  worker_assigned: boolean;
  output_progress: number;
  input_progress: Record<string, number>;
  last_tick_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ManufacturingJobWithDetails = ManufacturingJob & {
  business_type: BusinessType;
  recipes: ManufacturingRecipe[];
  active_recipe: ManufacturingRecipe | null;
};

export type ManufacturingStatusView = {
  businessId: string;
  businessType: BusinessType;
  job: ManufacturingJobWithDetails;
};

export type SetManufacturingRecipeInput = {
  businessId: string;
  recipeKey: string;
};

export type StartManufacturingInput = {
  businessId: string;
};

export type StopManufacturingInput = {
  businessId: string;
};

export type { ExtractionSlotStatus, ToolItemType };
