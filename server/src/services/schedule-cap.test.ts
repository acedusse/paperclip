import { describe, expect, it } from "vitest";
import { activeScheduleCap, activeManualOverride } from "./schedule-cap.js";
import type { ScheduleWindow } from "@paperclipai/shared";

const w = (over: Partial<ScheduleWindow>): ScheduleWindow => ({
  id: "w",
  label: "win",
  days: [0, 1, 2, 3, 4, 5, 6],
  startMinute: 540,
  endMinute: 1020,
  maxConcurrentRuns: 4,
  ...over,
});

const tz = "America/New_York";

describe("activeScheduleCap", () => {
  it("returns null with no timezone, no windows, or empty windows", () => {
    expect(activeScheduleCap([w({})], null, new Date())).toBeNull();
    expect(activeScheduleCap(null, tz, new Date())).toBeNull();
    expect(activeScheduleCap([], tz, new Date())).toBeNull();
  });

  it("applies a window inside its range and gives no opinion outside it", () => {
    // 2026-07-13 is a Monday. 14:00Z = 10:00 EDT -> inside 09:00–17:00.
    expect(activeScheduleCap([w({})], tz, new Date("2026-07-13T14:00:00Z"))).toBe(4);
    // 22:00Z = 18:00 EDT -> outside.
    expect(activeScheduleCap([w({})], tz, new Date("2026-07-13T22:00:00Z"))).toBeNull();
  });

  it("treats start inclusive and end exclusive", () => {
    // 13:00Z = 09:00 EDT exactly -> inside; end 17:00 exactly -> outside.
    expect(activeScheduleCap([w({})], tz, new Date("2026-07-13T13:00:00Z"))).toBe(4);
    expect(activeScheduleCap([w({})], tz, new Date("2026-07-13T21:00:00Z"))).toBeNull();
  });

  it("only applies on listed days", () => {
    const weekdaysOnly = w({ days: [1, 2, 3, 4, 5] });
    // 2026-07-12 is Sunday (day 0) -> excluded even at 10:00 local.
    expect(activeScheduleCap([weekdaysOnly], tz, new Date("2026-07-12T14:00:00Z"))).toBeNull();
  });

  it("handles a midnight-wrapping window on both sides of midnight", () => {
    // Fri 22:00 -> Sat 02:00, days lists Friday (5).
    const overnight = w({ days: [5], startMinute: 1320, endMinute: 120, maxConcurrentRuns: 2 });
    // Fri 2026-07-17 23:00 EDT = 2026-07-18T03:00Z -> inside (start segment).
    expect(activeScheduleCap([overnight], tz, new Date("2026-07-18T03:00:00Z"))).toBe(2);
    // Sat 2026-07-18 01:00 EDT = 2026-07-18T05:00Z -> inside (wrapped tail from Friday's window).
    expect(activeScheduleCap([overnight], tz, new Date("2026-07-18T05:00:00Z"))).toBe(2);
    // Sat 2026-07-18 03:00 EDT = 2026-07-18T07:00Z -> outside.
    expect(activeScheduleCap([overnight], tz, new Date("2026-07-18T07:00:00Z"))).toBeNull();
  });

  it("treats start === end as a full 24h window on its days", () => {
    const allDay = w({ days: [1], startMinute: 0, endMinute: 0, maxConcurrentRuns: 0 });
    // Monday any time -> active, cap 0.
    expect(activeScheduleCap([allDay], tz, new Date("2026-07-13T14:00:00Z"))).toBe(0);
  });

  it("takes the most-restrictive cap on overlap", () => {
    const a = w({ maxConcurrentRuns: 4 });
    const b = w({ id: "b", maxConcurrentRuns: 1 });
    expect(activeScheduleCap([a, b], tz, new Date("2026-07-13T14:00:00Z"))).toBe(1);
  });

  it("lets a cap-0 window dominate an overlap", () => {
    const a = w({ maxConcurrentRuns: 5 });
    const paused = w({ id: "p", maxConcurrentRuns: 0 });
    expect(activeScheduleCap([a, paused], tz, new Date("2026-07-13T14:00:00Z"))).toBe(0);
  });
});

describe("activeManualOverride", () => {
  const now = new Date("2026-07-12T12:00:00Z");
  it("returns the cap while unexpired", () => {
    expect(
      activeManualOverride({ manualCapOverride: 20, manualCapOverrideExpiresAt: new Date("2026-07-12T13:00:00Z") }, now),
    ).toBe(20);
  });
  it("returns null when expired (boundary is expired)", () => {
    expect(activeManualOverride({ manualCapOverride: 20, manualCapOverrideExpiresAt: now }, now)).toBeNull();
  });
  it("returns null when absent", () => {
    expect(activeManualOverride({ manualCapOverride: null, manualCapOverrideExpiresAt: null }, now)).toBeNull();
    expect(activeManualOverride({}, now)).toBeNull();
  });
});
