/**
 * FILE: packages/shared/src/validators/schedule.ts
 * ABOUT: schedule.ts (validators module).
 *
 * SECTIONS:
 *   [TAG: module] - schedule.ts (validators module).
 */
// ==========================================
// [META: module]
// INTENT: schedule.ts (validators module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/validators/schedule.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { z } from "zod";

// Weekday convention: Sun=0 ... Sat=6.
export const scheduleWindowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(100),
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .refine((d) => new Set(d).size === d.length, { message: "days must be unique" }),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  maxConcurrentRuns: z.number().int().min(0),
});

export type ScheduleWindow = z.infer<typeof scheduleWindowSchema>;

export const scheduleWindowsSchema = z.array(scheduleWindowSchema).max(24);

export const capOverrideSchema = z.object({
  cap: z.number().int().min(0),
  durationMinutes: z.number().int().positive().max(24 * 60),
});

export type CapOverride = z.infer<typeof capOverrideSchema>;
// [END: module]
