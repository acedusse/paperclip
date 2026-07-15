import { describe, it, expect } from "vitest";
import { shouldPushToUser } from "./push-prefs.js";

const at = (iso: string) => new Date(iso);

describe("shouldPushToUser", () => {
  it("delivers high band with no prefs (system floor)", () => {
    expect(shouldPushToUser({ prefs: null, band: "high", now: at("2026-07-14T12:00:00Z") })).toBe(true);
  });

  it("suppresses high when user floor is critical", () => {
    const prefs = { minBand: "critical" as const, quietStart: null, quietEnd: null, timezone: null };
    expect(shouldPushToUser({ prefs, band: "high", now: at("2026-07-14T12:00:00Z") })).toBe(false);
    expect(shouldPushToUser({ prefs, band: "critical", now: at("2026-07-14T12:00:00Z") })).toBe(true);
  });

  it("suppresses non-critical inside a quiet window evaluated in the user's tz", () => {
    // 04:00 UTC == 00:00 America/New_York (EDT, UTC-4) → inside 22:00–08:00
    const prefs = { minBand: "high" as const, quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" };
    expect(shouldPushToUser({ prefs, band: "high", now: at("2026-07-14T04:00:00Z") })).toBe(false);
  });

  it("lets critical break through quiet hours", () => {
    const prefs = { minBand: "high" as const, quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" };
    expect(shouldPushToUser({ prefs, band: "critical", now: at("2026-07-14T04:00:00Z") })).toBe(true);
  });

  it("delivers outside the quiet window", () => {
    // 18:00 UTC == 14:00 America/New_York → outside 22:00–08:00
    const prefs = { minBand: "high" as const, quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" };
    expect(shouldPushToUser({ prefs, band: "high", now: at("2026-07-14T18:00:00Z") })).toBe(true);
  });

  it("fails open (delivers) on an invalid timezone", () => {
    const prefs = { minBand: "high" as const, quietStart: "22:00", quietEnd: "08:00", timezone: "Not/AZone" };
    expect(shouldPushToUser({ prefs, band: "high", now: at("2026-07-14T04:00:00Z") })).toBe(true);
  });
});
