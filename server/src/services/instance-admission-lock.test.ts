/**
 * FILE: server/src/services/instance-admission-lock.test.ts
 * ABOUT: instance-admission-lock.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - instance-admission-lock.test.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: instance-admission-lock.test.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/instance-admission-lock.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../middleware/logger.js";
import { withInstanceAdmissionLock } from "./instance-admission-lock.js";

describe("withInstanceAdmissionLock", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("serializes critical sections (no interleaving)", async () => {
    const events: string[] = [];
    const critical = (id: string) =>
      withInstanceAdmissionLock(async () => {
        events.push(`enter-${id}`);
        await new Promise((r) => setTimeout(r, 5));
        events.push(`exit-${id}`);
      });
    await Promise.all([critical("a"), critical("b")]);
    // Each enter is immediately followed by its own exit — no interleave.
    expect(events).toEqual(["enter-a", "exit-a", "enter-b", "exit-b"]);
  });

  it("releases the lock even when fn throws", async () => {
    await expect(
      withInstanceAdmissionLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Lock is free again:
    await expect(withInstanceAdmissionLock(async () => "ok")).resolves.toBe("ok");
  });

  it("abandons a hung holder after the stale timeout (fail-open)", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    // A holder whose critical section never resolves (e.g. DB pool exhaustion).
    // We intentionally never await it — it stays pending for the whole test.
    void withInstanceAdmissionLock(() => new Promise<void>(() => {}));

    let secondRan = false;
    const second = withInstanceAdmissionLock(async () => {
      secondRan = true;
      return "second";
    });

    // Let microtasks flush; the waiter must still be blocked before the timeout.
    await Promise.resolve();
    expect(secondRan).toBe(false);

    // Advance past the 30s stale timeout: the hung holder is abandoned and the
    // next waiter proceeds (fail-open) instead of blocking instance-wide forever.
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(second).resolves.toBe("second");
    expect(secondRan).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});
// [END: module]
