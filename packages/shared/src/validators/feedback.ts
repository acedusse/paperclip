/**
 * FILE: packages/shared/src/validators/feedback.ts
 * ABOUT: feedback.ts (validators module).
 *
 * SECTIONS:
 *   [TAG: module] - feedback.ts (validators module).
 */
// ==========================================
// [META: module]
// INTENT: feedback.ts (validators module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/validators/feedback.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { z } from "zod";
import {
  FEEDBACK_DATA_SHARING_PREFERENCES,
  FEEDBACK_TARGET_TYPES,
  FEEDBACK_TRACE_STATUSES,
  FEEDBACK_VOTE_VALUES,
} from "../types/feedback.js";

export const feedbackTargetTypeSchema = z.enum(FEEDBACK_TARGET_TYPES);
export const feedbackTraceStatusSchema = z.enum(FEEDBACK_TRACE_STATUSES);
export const feedbackVoteValueSchema = z.enum(FEEDBACK_VOTE_VALUES);
export const feedbackDataSharingPreferenceSchema = z.enum(FEEDBACK_DATA_SHARING_PREFERENCES);

export const upsertIssueFeedbackVoteSchema = z.object({
  targetType: feedbackTargetTypeSchema,
  targetId: z.string().uuid(),
  vote: feedbackVoteValueSchema,
  reason: z.string().trim().max(1000).optional(),
  allowSharing: z.boolean().optional(),
});

export type UpsertIssueFeedbackVote = z.infer<typeof upsertIssueFeedbackVoteSchema>;
// [END: module]
