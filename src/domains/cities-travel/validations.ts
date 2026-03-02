import { z } from "zod";

export const startTravelSchema = z.object({
  toCityId: z.uuid("Destination city id is invalid."),
});

export const completeTravelSchema = z.object({
  travelId: z.uuid("Travel id is invalid."),
});

export type StartTravelInput = z.infer<typeof startTravelSchema>;
export type CompleteTravelInput = z.infer<typeof completeTravelSchema>;
