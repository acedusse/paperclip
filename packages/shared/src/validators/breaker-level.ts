import { z } from "zod";

// Combo-01 Phase 3a: predictive-breaker ladder level for a company.
// normal = no cap effect; warn = event only; throttle = reduced cap;
// halt = cap 0 + in-flight runs wound down (reversibly, self-releasing).
export const BREAKER_LEVELS = ["normal", "warn", "throttle", "halt"] as const;
export const breakerLevelSchema = z.enum(BREAKER_LEVELS);
export type BreakerLevel = z.infer<typeof breakerLevelSchema>;
