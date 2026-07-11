import { describe, expect, it } from "vitest";
import { instanceGeneralSettingsSchema } from "@paperclipai/shared";

describe("instance general settings — per-run caps", () => {
  it("accepts and preserves the two per-run cap fields", () => {
    const parsed = instanceGeneralSettingsSchema.parse({
      maxRunWallClockMs: 600000,
      maxRunCostCents: 500,
    });
    expect(parsed.maxRunWallClockMs).toBe(600000);
    expect(parsed.maxRunCostCents).toBe(500);
  });

  it("rejects non-positive cap values", () => {
    expect(() => instanceGeneralSettingsSchema.parse({ maxRunCostCents: 0 })).toThrow();
    expect(() => instanceGeneralSettingsSchema.parse({ maxRunWallClockMs: -1 })).toThrow();
  });
});
