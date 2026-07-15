import { z } from "zod";

// Locked constant — a policy may never auto-decide above this band. Mirrored server-side
// as AUTO_DECISION_MAX_BAND; keep both in sync.
export const AUTO_DECISION_MAX_BAND = "low" as const;

// Bands at or below the locked max (RISK_BAND_ORDER prefix). Widen when the constant is raised.
const ALLOWED_POLICY_BANDS = ["low"] as const;

export const createAutoApprovePolicySchema = z.object({
  agentId: z.string().uuid(),
  approvalType: z.string().trim().min(1).max(120),
  maxBand: z.enum(ALLOWED_POLICY_BANDS),
  maxSpendCents: z.number().int().min(0),
  requireNoSecrets: z.boolean(),
});
export type CreateAutoApprovePolicy = z.infer<typeof createAutoApprovePolicySchema>;

export const updateAutoApprovePolicySchema = z.object({
  maxBand: z.enum(ALLOWED_POLICY_BANDS).optional(),
  maxSpendCents: z.number().int().min(0).optional(),
  requireNoSecrets: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAutoApprovePolicy = z.infer<typeof updateAutoApprovePolicySchema>;
