import { z } from "zod";

const inventoryLocationTypeSchema = z.enum(["personal", "business"]);

export const transferItemsSchema = z
  .object({
    sourceType: inventoryLocationTypeSchema,
    sourceBusinessId: z.uuid("Source business id is invalid.").optional(),
    sourceCityId: z.uuid("Source city id is invalid.").optional(),
    destinationType: inventoryLocationTypeSchema,
    destinationBusinessId: z.uuid("Destination business id is invalid.").optional(),
    destinationCityId: z.uuid("Destination city id is invalid.").optional(),
    itemKey: z
      .string({ error: "Item key is required." })
      .trim()
      .min(1, "Item key is required.")
      .max(64, "Item key must be at most 64 characters."),
    quantity: z
      .number({ error: "Quantity must be a number." })
      .int("Quantity must be a whole number.")
      .positive("Quantity must be greater than zero."),
    quality: z
      .number({ error: "Quality must be a number." })
      .int("Quality must be a whole number.")
      .min(1, "Quality must be at least 1.")
      .max(100, "Quality must be at most 100."),
    fundingAccountId: z.uuid("Funding account id is invalid.").optional(),
  })
  .superRefine((value, context) => {
    if (value.sourceType === "business" && !value.sourceBusinessId) {
      context.addIssue({
        code: "custom",
        message: "Source business id is required for business source.",
        path: ["sourceBusinessId"],
      });
    }

    if (value.destinationType === "business" && !value.destinationBusinessId) {
      context.addIssue({
        code: "custom",
        message: "Destination business id is required for business destination.",
        path: ["destinationBusinessId"],
      });
    }

    if (value.sourceType === value.destinationType) {
      if (value.sourceType === "personal") {
        context.addIssue({
          code: "custom",
          message: "Personal-to-personal transfers are not supported.",
          path: ["destinationType"],
        });
      }

      if (
        value.sourceType === "business" &&
        value.sourceBusinessId &&
        value.destinationBusinessId &&
        value.sourceBusinessId === value.destinationBusinessId
      ) {
        context.addIssue({
          code: "custom",
          message: "Source and destination business must be different.",
          path: ["destinationBusinessId"],
        });
      }
    }
  });

export type TransferItemsInput = z.infer<typeof transferItemsSchema>;
