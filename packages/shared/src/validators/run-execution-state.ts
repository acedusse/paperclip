import { z } from "zod";

// Combo-01 Phase 2c: fleet execution state for an instance or company.
// running = normal admission; draining = refuse NEW run starts, let in-flight
// finish; halted = refuse new + wind down in-flight (reversibly).
export const RUN_EXECUTION_STATES = ["running", "draining", "halted"] as const;
export const runExecutionStateSchema = z.enum(RUN_EXECUTION_STATES);
export type RunExecutionState = z.infer<typeof runExecutionStateSchema>;
