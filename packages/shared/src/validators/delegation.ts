import { z } from "zod";
import { APPROVAL_TYPES } from "../constants.js";

const bandSchema = z.enum(["low", "medium", "high", "critical"]);

export const createDelegationGrantSchema = z.object({
  delegateUserId: z.string().min(1),
  approvalTypes: z.array(z.enum(APPROVAL_TYPES)).default([]),
  maxBand: bandSchema,
  maxSpendCents: z.number().int().nonnegative().nullable().default(null),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime(),
});
export type CreateDelegationGrant = z.infer<typeof createDelegationGrantSchema>;

export const coverageConfigSchema = z
  .object({
    enabled: z.boolean(),
    backupUserId: z.string().min(1).nullable().optional(),
    slaCriticalMinutes: z.number().int().positive().optional(),
    slaHighMinutes: z.number().int().positive().optional(),
    slaMediumMinutes: z.number().int().positive().optional(),
    slaLowMinutes: z.number().int().positive().optional(),
  })
  .refine((c) => !c.enabled || (typeof c.backupUserId === "string" && c.backupUserId.length > 0), {
    message: "backupUserId is required when coverage is enabled",
    path: ["backupUserId"],
  });
export type CoverageConfigUpdate = z.infer<typeof coverageConfigSchema>;

export const outOfOfficeSchema = z
  .object({
    enabled: z.boolean(),
    backupUserId: z.string().min(1).optional(),
    maxBand: bandSchema.optional(),
    until: z.string().datetime().optional(),
  })
  .refine((o) => !o.enabled || (o.backupUserId && o.maxBand && o.until), {
    message: "backupUserId, maxBand and until are required when enabling out-of-office",
    path: ["enabled"],
  });
export type OutOfOfficeUpdate = z.infer<typeof outOfOfficeSchema>;
