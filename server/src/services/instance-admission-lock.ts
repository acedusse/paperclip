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
import { logger } from "../middleware/logger.js";

// Single global mutex for the run-admission critical section. In-memory,
// single-process — same class as agent-start-lock.ts. The chain guarantees
// FIFO, non-interleaved execution of the count+claim step across agents.
//
// Known limitation (Phase 1): this lock only serializes admission WITHIN one
// process. Multiple server replicas each hold their own lock, so each could
// admit up to the cap and collectively breach the instance ceiling. A
// multi-process fix (DB advisory lock / SELECT ... FOR UPDATE) is a later slice.
const INSTANCE_ADMISSION_LOCK_STALE_MS = 30_000;
let holder: { promise: Promise<void>; startedAtMs: number } | null = null;

// Wait for the current holder to release, but fail open if it has been holding
// the lock longer than the stale threshold (e.g. DB pool exhaustion or a stuck
// query). Without this, a hung critical section would wedge admission for the
// entire instance forever with no recovery short of a restart.
async function waitForInstanceAdmissionLock(lock: { promise: Promise<void>; startedAtMs: number }) {
  const elapsedMs = Date.now() - lock.startedAtMs;
  const remainingMs = INSTANCE_ADMISSION_LOCK_STALE_MS - elapsedMs;
  if (remainingMs <= 0) {
    logger.warn({ staleMs: elapsedMs }, "instance admission lock stale; continuing admission");
    return;
  }

  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    lock.promise,
    new Promise<void>((resolve) => {
      timeout = setTimeout(() => {
        timedOut = true;
        resolve();
      }, remainingMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);

  if (timedOut) {
    logger.warn({ staleMs: INSTANCE_ADMISSION_LOCK_STALE_MS }, "instance admission lock timed out; continuing admission");
  }
}

export async function withInstanceAdmissionLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = holder;
  const waitForPrevious = previous ? waitForInstanceAdmissionLock(previous) : Promise.resolve();
  const run = waitForPrevious.then(fn);
  // Keep the chain alive regardless of success/failure so a throw never wedges
  // the lock, and stamp the start time so the next waiter can detect staleness.
  const marker = run.then(
    () => undefined,
    () => undefined,
  );
  holder = { promise: marker, startedAtMs: Date.now() };
  try {
    return await run;
  } finally {
    if (holder?.promise === marker) {
      holder = null;
    }
  }
}
// [END: module]
