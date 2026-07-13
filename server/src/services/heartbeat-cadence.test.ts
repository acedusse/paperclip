import { describe, expect, it } from "vitest";
import type { IdleBackoffConfig } from "@paperclipai/shared";
import {
  cadenceTransition,
  effectiveIntervalSec,
  isEmptyTimerHeartbeat,
  nextIdleStreak,
  parseHeartbeatCadenceConfig,
} from "./heartbeat-cadence.js";

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

describe("parseHeartbeatCadenceConfig", () => {
  it("extracts intervalSec and idleBackoff, defaulting a missing block", () => {
    expect(parseHeartbeatCadenceConfig({ heartbeat: { intervalSec: 300, idleBackoff: { enabled: true } } }))
      .toEqual({ intervalSec: 300, idleBackoff: { enabled: true, multiplier: 2, maxIntervalSec: 3600 } });
  });
  it("returns interval 0 and disabled backoff for an empty config", () => {
    expect(parseHeartbeatCadenceConfig(null)).toEqual({ intervalSec: 0, idleBackoff: { enabled: false, multiplier: 2, maxIntervalSec: 3600 } });
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

describe("cadenceTransition", () => {
  const cfg = { enabled: true, multiplier: 2, maxIntervalSec: 480 };

  it("flags a backoff when the interval grows (streak 0 -> 1)", () => {
    const t = cadenceTransition(60, 0, 1, cfg);
    expect(t).toEqual({ changed: true, direction: "backoff", oldIntervalSec: 60, newIntervalSec: 120 });
  });

  it("flags a reset when the interval snaps back (streak 3 -> 0)", () => {
    const t = cadenceTransition(60, 3, 0, cfg);
    expect(t.changed).toBe(true);
    expect(t.direction).toBe("reset");
    expect(t.oldIntervalSec).toBe(480); // 60*2^3=480 capped at 480
    expect(t.newIntervalSec).toBe(60);
  });

  it("reports no change once the interval is pinned at the cap (streak 3 -> 4)", () => {
    const t = cadenceTransition(60, 3, 4, cfg);
    expect(t.changed).toBe(false); // both capped at 480
  });

  it("reports no change when the streak is unchanged (0 -> 0)", () => {
    expect(cadenceTransition(60, 0, 0, cfg).changed).toBe(false);
  });

  it("reports no change when backoff is disabled", () => {
    const t = cadenceTransition(60, 0, 5, { enabled: false, multiplier: 2, maxIntervalSec: 480 });
    expect(t.changed).toBe(false); // effectiveIntervalSec returns base when disabled
  });
});
