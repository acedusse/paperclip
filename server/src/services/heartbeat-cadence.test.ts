import { describe, expect, it } from "vitest";
import type { IdleBackoffConfig } from "@paperclipai/shared";
import { effectiveIntervalSec, isEmptyTimerHeartbeat, nextIdleStreak } from "./heartbeat-cadence.js";

const on: IdleBackoffConfig = { enabled: true, multiplier: 2, maxIntervalSec: 3600 };

describe("effectiveIntervalSec", () => {
  it("returns base when disabled", () => {
    expect(effectiveIntervalSec(300, 5, { ...on, enabled: false })).toBe(300);
  });
  it("returns base at streak 0", () => {
    expect(effectiveIntervalSec(300, 0, on)).toBe(300);
  });
  it("grows exponentially with the streak", () => {
    expect(effectiveIntervalSec(300, 1, on)).toBe(600);
    expect(effectiveIntervalSec(300, 3, on)).toBe(2400);
  });
  it("clamps at maxIntervalSec", () => {
    expect(effectiveIntervalSec(300, 10, on)).toBe(3600);
  });
  it("never returns below base even if max < base", () => {
    expect(effectiveIntervalSec(300, 0, { ...on, maxIntervalSec: 60 })).toBe(300);
  });
});

describe("nextIdleStreak", () => {
  it("increments on an empty heartbeat", () => {
    expect(nextIdleStreak(3, true)).toBe(4);
  });
  it("resets to 0 on a non-empty completion", () => {
    expect(nextIdleStreak(3, false)).toBe(0);
  });
});

describe("isEmptyTimerHeartbeat", () => {
  it("is true for a successful timer wake with no concrete progress", () => {
    expect(isEmptyTimerHeartbeat({ wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: "empty_response" })).toBe(true);
    expect(isEmptyTimerHeartbeat({ wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: "plan_only" })).toBe(true);
    expect(isEmptyTimerHeartbeat({ wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: null })).toBe(true);
  });
  it("is false when the run made concrete progress", () => {
    expect(isEmptyTimerHeartbeat({ wakeReason: "heartbeat_timer", outcome: "succeeded", livenessState: "advanced" })).toBe(false);
  });
  it("is false for non-timer wakes", () => {
    expect(isEmptyTimerHeartbeat({ wakeReason: "issue_monitor_due", outcome: "succeeded", livenessState: "empty_response" })).toBe(false);
  });
  it("is false for non-success outcomes", () => {
    expect(isEmptyTimerHeartbeat({ wakeReason: "heartbeat_timer", outcome: "failed", livenessState: "empty_response" })).toBe(false);
  });
});
