/**
 * FILE: ui/src/pages/CompanySettings.schedule.test.ts
 * ABOUT: Pure-logic tests for the company schedule editor's presets and time helpers.
 *
 * SECTIONS:
 *   [TAG: module] - CompanySettings.schedule.test.ts (pages module).
 */
// ==========================================
// [META: module]
// INTENT: Verify SCHEDULE_PRESETS shapes and minute<->time round-trip helpers.
// PSEUDOCODE: 1. Import exported constants/helpers. 2. Assert preset shapes. 3. Assert helper round-trip.
// JSON_FLOW: {"file": "ui/src/pages/CompanySettings.schedule.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { SCHEDULE_PRESETS, minuteToTime, timeToMinute } from "./CompanySettings";

describe("schedule presets & helpers", () => {
  it("Paused preset is a full-day cap-0 window on all days", () => {
    const paused = SCHEDULE_PRESETS.find((p) => p.key === "paused")!.windows(2);
    expect(paused).toHaveLength(1);
    expect(paused[0]).toMatchObject({ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 0, maxConcurrentRuns: 0 });
  });
  it("Always full clears windows", () => {
    expect(SCHEDULE_PRESETS.find((p) => p.key === "always-full")!.windows(2)).toEqual([]);
  });
  it("round-trips minute<->time", () => {
    expect(timeToMinute("09:30")).toBe(570);
    expect(minuteToTime(570)).toBe("09:30");
  });
});
// [END: module]
