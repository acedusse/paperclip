/**
 * FILE: packages/shared/src/validators/stakeholder-share.ts
 * ABOUT: Validators for Combo-05 Phase 4c stakeholder transparency shares.
 *
 * SECTIONS:
 *   [TAG: module] - stakeholder-share.ts (validators module).
 */
// [START: module]
import { z } from "zod";

/**
 * Exposure toggles. Every one defaults to false: a share created without an
 * explicit opt-in renders nothing. The public projection and the signal
 * gatherer are both driven by this same shape, so a section that is off is
 * never queried, not merely hidden.
 */
const toggles = {
  showGoalProgress: z.boolean().default(false),
  showShippedWork: z.boolean().default(false),
  showNarrative: z.boolean().default(false),
  showActivityTimeline: z.boolean().default(false),
};

export const createStakeholderShareSchema = z.object({
  label: z.string().min(1).max(200),
  expiresAt: z.string().datetime().nullable().optional(),
  ...toggles,
});
export type CreateStakeholderShare = z.infer<typeof createStakeholderShareSchema>;

export const updateStakeholderShareSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  showGoalProgress: z.boolean().optional(),
  showShippedWork: z.boolean().optional(),
  showNarrative: z.boolean().optional(),
  showActivityTimeline: z.boolean().optional(),
});
export type UpdateStakeholderShare = z.infer<typeof updateStakeholderShareSchema>;
// [END: module]
