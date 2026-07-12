import { describe, expect, it } from "vitest";
import { getZonedMinuteParts, isValidTimeZone, WEEKDAY_INDEX } from "./zoned-time.js";

describe("zoned-time", () => {
  it("maps a UTC instant into the target timezone's wall clock + weekday", () => {
    // 2026-07-12T13:30:00Z is Sunday 09:30 in America/New_York (EDT, UTC-4)
    const parts = getZonedMinuteParts(new Date("2026-07-12T13:30:00Z"), "America/New_York");
    expect(parts.weekday).toBe(WEEKDAY_INDEX.Sun); // 0
    expect(parts.hour).toBe(9);
    expect(parts.minute).toBe(30);
  });

  it("honors DST: the same wall-clock hour maps to different UTC offsets", () => {
    // Winter (EST, UTC-5): 14:30Z -> 09:30 local
    const winter = getZonedMinuteParts(new Date("2026-01-11T14:30:00Z"), "America/New_York");
    expect(winter.hour).toBe(9);
    expect(winter.minute).toBe(30);
  });

  it("validates timezones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
