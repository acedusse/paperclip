import { z } from "zod";
import { APPROVAL_TYPES } from "../constants.js";
import { AUTO_DECISION_MAX_BAND } from "./auto-approve-policy.js";

const bandSchema = z.enum(["low", "medium", "high", "critical"]);
const BAND_ORDER = ["low", "medium", "high", "critical"] as const;

export const createBoundedAgentApproverSchema = z
  .object({
    delegateAgentId: z.string().min(1),
    approvalTypes: z.array(z.enum(APPROVAL_TYPES)).default([]),
    maxBand: bandSchema,
    maxSpendCents: z.number().int().nonnegative().nullable().default(null),
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime(),
  })
  .refine((v) => BAND_ORDER.indexOf(v.maxBand) <= BAND_ORDER.indexOf(AUTO_DECISION_MAX_BAND), {
    message: `maxBand may not exceed the auto-decision ceiling (${AUTO_DECISION_MAX_BAND})`,
    path: ["maxBand"],
  });
export type CreateBoundedAgentApprover = z.infer<typeof createBoundedAgentApproverSchema>;
