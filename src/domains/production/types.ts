import type { BusinessType } from "@/config/businesses";
import type { EmployeeStatus } from "@/config/employees";
import type {
  ExtractionProductOption,
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
  configured_item_key: string | null;
  pending_item_key: string | null;
  input_progress: number;
  output_progress: number;
  last_extracted_at: string | null;
  retool_started_at: string | null;
  retool_complete_at: string | null;
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
  configured_output: ExtractionProductOption | null;
  pending_output: ExtractionProductOption | null;
  line_label: string;
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
    retooling: number;
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

export type RetoolExtractionSlotInput = {
  slotId: string;
  itemKey: string;
};

export type ManufacturingLine = {
  id: string;
  business_id: string;
  line_number: number;
  employee_id: string | null;
  configured_recipe_key: string | null;
  pending_recipe_key: string | null;
  status: ManufacturingStatus;
  worker_assigned: boolean;
  output_progress: number;
  input_progress: Record<string, number>;
  last_tick_at: string | null;
  retool_started_at: string | null;
  retool_complete_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ManufacturingLineWithDetails = ManufacturingLine & {
  business_type: BusinessType;
  available_recipes: ManufacturingRecipe[];
  configured_recipe: ManufacturingRecipe | null;
  pending_recipe: ManufacturingRecipe | null;
};

export type ManufacturingStatusView = {
  businessId: string;
  businessType: BusinessType;
  maxLines: number;
  lines: ManufacturingLineWithDetails[];
  summary: {
    total: number;
    active: number;
    idle: number;
    resting: number;
    retooling: number;
    occupied: number;
  };
};

export type SetManufacturingRecipeInput = {
  lineId: string;
  recipeKey: string;
};

export type StartManufacturingInput = {
  lineId: string;
};

export type StopManufacturingInput = {
  lineId: string;
};

export type AssignManufacturingLineInput = {
  lineId: string;
  employeeId: string;
};

export type UnassignManufacturingLineInput = {
  lineId: string;
};

export type SetManufacturingLineStatusInput = {
  lineId: string;
  status: Extract<ManufacturingStatus, "active" | "idle">;
};

export type RetoolManufacturingLineInput = {
  lineId: string;
  recipeKey: string;
};

export type { ExtractionSlotStatus, ToolItemType };
