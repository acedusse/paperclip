import { describe, expect, it } from "vitest";
import { scheduleWindowSchema, scheduleWindowsSchema, capOverrideSchema } from "./schedule.js";

const good = {
  id: "w1",
  label: "Business hours",
  days: [1, 2, 3, 4, 5],
  startMinute: 540, // 09:00
  endMinute: 1020, // 17:00
  maxConcurrentRuns: 4,
};

describe("scheduleWindowSchema", () => {
  it("accepts a well-formed window", () => {
    expect(scheduleWindowSchema.parse(good)).toEqual(good);
  });
  it("rejects out-of-range weekdays", () => {
    expect(scheduleWindowSchema.safeParse({ ...good, days: [7] }).success).toBe(false);
  });
  it("rejects an empty days list", () => {
    expect(scheduleWindowSchema.safeParse({ ...good, days: [] }).success).toBe(false);
  });
  it("rejects out-of-range minutes", () => {
    expect(scheduleWindowSchema.safeParse({ ...good, endMinute: 1440 }).success).toBe(false);
  });
  it("rejects a negative cap", () => {
    expect(scheduleWindowSchema.safeParse({ ...good, maxConcurrentRuns: -1 }).success).toBe(false);
  });
  it("accepts cap 0 (paused)", () => {
    expect(scheduleWindowSchema.safeParse({ ...good, maxConcurrentRuns: 0 }).success).toBe(true);
  });
});

describe("scheduleWindowsSchema", () => {
  it("rejects more than 24 windows", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...good, id: `w${i}` }));
    expect(scheduleWindowsSchema.safeParse(many).success).toBe(false);
  });
});

describe("capOverrideSchema", () => {
  it("accepts a boost", () => {
    expect(capOverrideSchema.parse({ cap: 20, durationMinutes: 120 })).toEqual({ cap: 20, durationMinutes: 120 });
  });
  it("accepts a quiet-now (cap 0)", () => {
    expect(capOverrideSchema.safeParse({ cap: 0, durationMinutes: 120 }).success).toBe(true);
  });
  it("rejects a non-positive duration", () => {
    expect(capOverrideSchema.safeParse({ cap: 5, durationMinutes: 0 }).success).toBe(false);
  });
});
