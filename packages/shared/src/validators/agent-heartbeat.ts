import { z } from "zod";

/**
 * Combo-01 Phase 4A idle-backoff config, stored under
 * `runtimeConfig.heartbeat.idleBackoff`. Disabled by default so existing
 * agents keep their fixed cadence until an operator opts in.
 */
export const idleBackoffSchema = z.object({
  enabled: z.boolean().default(false),
  multiplier: z.number().gt(1).default(2),
  maxIntervalSec: z.number().int().positive().default(3600),
});

export type IdleBackoffConfig = z.infer<typeof idleBackoffSchema>;
