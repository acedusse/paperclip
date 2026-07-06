/**
 * FILE: server/src/services/instance-admission-lock.ts
 * ABOUT: instance-admission-lock.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - instance-admission-lock.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: instance-admission-lock.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/instance-admission-lock.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]

// Single global mutex for the run-admission critical section. In-memory,
// single-process — same class as agent-start-lock.ts. The chain guarantees
// FIFO, non-interleaved execution of the count+claim step across agents.
let tail: Promise<unknown> = Promise.resolve();

export async function withInstanceAdmissionLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  // Keep the chain alive regardless of success/failure so a throw never
  // wedges the lock.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
// [END: module]
