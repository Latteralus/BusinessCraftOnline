import {
  EXTRACTION_SLOT_STATUSES,
  MANUFACTURING_RECIPE_KEYS,
  TOOL_ITEM_TYPES,
} from "@/config/production";
import { z } from "zod";

const extractionSlotStatusSchema = z.enum(EXTRACTION_SLOT_STATUSES);
const toolItemTypeSchema = z.enum(TOOL_ITEM_TYPES);
const manufacturingRecipeKeySchema = z.enum(MANUFACTURING_RECIPE_KEYS);

export const productionStatusQuerySchema = z.object({
  businessId: z.uuid("Business id is invalid."),
});

export const assignExtractionSlotSchema = z.object({
  slotId: z.uuid("Slot id is invalid."),
  employeeId: z.uuid("Employee id is invalid."),
});

export const unassignExtractionSlotSchema = z.object({
  slotId: z.uuid("Slot id is invalid."),
});

export const installToolSchema = z.object({
  slotId: z.uuid("Slot id is invalid."),
  itemType: toolItemTypeSchema,
});

export const setExtractionSlotStatusSchema = z.object({
  slotId: z.uuid("Slot id is invalid."),
  status: extractionSlotStatusSchema,
});

export const retoolExtractionSlotSchema = z.object({
  slotId: z.uuid("Slot id is invalid."),
  itemKey: z.string().trim().min(1, "Item key is required.").max(64, "Item key is invalid."),
});

export const manufacturingStatusQuerySchema = z.object({
  businessId: z.uuid("Business id is invalid."),
});

export const setManufacturingRecipeSchema = z.object({
  lineId: z.uuid("Line id is invalid."),
  recipeKey: manufacturingRecipeKeySchema,
});

export const startManufacturingSchema = z.object({
  lineId: z.uuid("Line id is invalid."),
});

export const stopManufacturingSchema = z.object({
  lineId: z.uuid("Line id is invalid."),
});

export const assignManufacturingLineSchema = z.object({
  lineId: z.uuid("Line id is invalid."),
  employeeId: z.uuid("Employee id is invalid."),
});

export const unassignManufacturingLineSchema = z.object({
  lineId: z.uuid("Line id is invalid."),
});

export const setManufacturingLineStatusSchema = z.object({
  lineId: z.uuid("Line id is invalid."),
  status: z.enum(["active", "idle"]),
});

export const retoolManufacturingLineSchema = z.object({
  lineId: z.uuid("Line id is invalid."),
  recipeKey: manufacturingRecipeKeySchema,
});
