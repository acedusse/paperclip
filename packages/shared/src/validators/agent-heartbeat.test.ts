import { describe, expect, it } from "vitest";
import { idleBackoffSchema, wipLimitSchema } from "./agent-heartbeat.js";

describe("idleBackoffSchema", () => {
  it("defaults to disabled with multiplier 2 when empty", () => {
    const parsed = idleBackoffSchema.parse({});
    expect(parsed).toEqual({ enabled: false, multiplier: 2, maxIntervalSec: 3600 });
  });

  it("accepts a valid config", () => {
    const parsed = idleBackoffSchema.parse({ enabled: true, multiplier: 3, maxIntervalSec: 1800 });
    expect(parsed).toEqual({ enabled: true, multiplier: 3, maxIntervalSec: 1800 });
  });

  it("rejects multiplier <= 1", () => {
    expect(() => idleBackoffSchema.parse({ multiplier: 1 })).toThrow();
  });

  it("rejects non-positive maxIntervalSec", () => {
    expect(() => idleBackoffSchema.parse({ maxIntervalSec: 0 })).toThrow();
  });
});

describe("wipLimitSchema", () => {
  it("defaults to disabled with a maxInProgress of 3", () => {
    expect(wipLimitSchema.parse({})).toEqual({ enabled: false, maxInProgress: 3 });
  });

  it("accepts an explicit enabled limit", () => {
    expect(wipLimitSchema.parse({ enabled: true, maxInProgress: 5 })).toEqual({
      enabled: true,
      maxInProgress: 5,
    });
  });

  it("rejects a non-positive or non-integer maxInProgress", () => {
    expect(() => wipLimitSchema.parse({ maxInProgress: 0 })).toThrow();
    expect(() => wipLimitSchema.parse({ maxInProgress: -1 })).toThrow();
    expect(() => wipLimitSchema.parse({ maxInProgress: 2.5 })).toThrow();
  });
});
