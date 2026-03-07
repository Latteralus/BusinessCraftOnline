import {
  EMPLOYEE_ROLES,
  EMPLOYEE_SKILL_KEYS,
  EMPLOYEE_STATUSES,
  EMPLOYEE_TYPES,
} from "@/config/employees";
import { z } from "zod";

const employeeTypeSchema = z.enum(EMPLOYEE_TYPES);
const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES);
const employeeRoleSchema = z.enum(EMPLOYEE_ROLES);
const employeeSkillKeySchema = z.enum(EMPLOYEE_SKILL_KEYS);

export const employeeListFilterSchema = z.object({
  status: employeeStatusSchema.optional(),
  employeeType: employeeTypeSchema.optional(),
});

export const hireEmployeeSchema = z
  .object({
    businessId: z.uuid("Business id is invalid."),
    firstName: z
      .string({ error: "First name is required." })
      .trim()
      .min(1, "First name is required.")
      .max(40, "First name must be 40 characters or less."),
    lastName: z
      .string({ error: "Last name is required." })
      .trim()
      .min(1, "Last name is required.")
      .max(40, "Last name must be 40 characters or less."),
    employeeType: employeeTypeSchema,
    specialtySkillKey: employeeSkillKeySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.employeeType === "specialist" && !value.specialtySkillKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["specialtySkillKey"],
        message: "Specialists require a specialty skill.",
      });
    }

    if (value.employeeType !== "specialist" && value.specialtySkillKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["specialtySkillKey"],
        message: "Only specialists can have a specialty skill.",
      });
    }
  });

export const assignEmployeeSchema = z.object({
  employeeId: z.uuid("Employee id is invalid."),
  businessId: z.uuid("Business id is invalid."),
  role: employeeRoleSchema,
  slotNumber: z
    .number({ error: "Slot number must be a number." })
    .int("Slot number must be an integer.")
    .min(1, "Slot number must be at least 1.")
    .optional(),
  wageVariance: z
    .number({ error: "Wage variance must be a number." })
    .min(-2, "Wage variance cannot be less than -2.")
    .max(2, "Wage variance cannot exceed 2.")
    .optional(),
  roleSkillKey: employeeSkillKeySchema.optional(),
});

export const reactivateEmployeeSchema = z.object({
  employeeId: z.uuid("Employee id is invalid."),
});

export const unassignEmployeeSchema = z.object({
  employeeId: z.uuid("Employee id is invalid."),
});

export const fireEmployeeSchema = z.object({
  employeeId: z.uuid("Employee id is invalid."),
});

export type EmployeeListFilterInput = z.infer<typeof employeeListFilterSchema>;
export type HireEmployeeInput = z.infer<typeof hireEmployeeSchema>;
export type AssignEmployeeInput = z.infer<typeof assignEmployeeSchema>;
export type ReactivateEmployeeInput = z.infer<typeof reactivateEmployeeSchema>;
export type UnassignEmployeeInput = z.infer<typeof unassignEmployeeSchema>;
export type FireEmployeeInput = z.infer<typeof fireEmployeeSchema>;
