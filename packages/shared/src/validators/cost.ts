/**
 * FILE: packages/shared/src/validators/cost.ts
 * ABOUT: cost.ts (validators module).
 *
 * SECTIONS:
 *   [TAG: module] - cost.ts (validators module).
 */
// ==========================================
// [META: module]
// INTENT: cost.ts (validators module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/validators/cost.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { z } from "zod";
import { BILLING_TYPES } from "../constants.js";

export const createCostEventSchema = z.object({
  agentId: z.string().uuid(),
  issueId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  heartbeatRunId: z.string().uuid().optional().nullable(),
  billingCode: z.string().optional().nullable(),
  provider: z.string().min(1),
  biller: z.string().min(1).optional(),
  billingType: z.enum(BILLING_TYPES).optional().default("unknown"),
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative().optional().default(0),
  cachedInputTokens: z.number().int().nonnegative().optional().default(0),
  outputTokens: z.number().int().nonnegative().optional().default(0),
  costCents: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
}).transform((value) => ({
  ...value,
  biller: value.biller ?? value.provider,
}));

export type CreateCostEvent = z.infer<typeof createCostEventSchema>;

export const updateBudgetSchema = z.object({
  budgetMonthlyCents: z.number().int().nonnegative(),
});

export type UpdateBudget = z.infer<typeof updateBudgetSchema>;
// [END: module]
