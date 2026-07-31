import { describe, expect, it } from "vitest";
import {
  assertShareViewable,
  narrateStakeholder,
  projectStakeholderPayload,
  type StakeholderSignals,
  type StakeholderToggles,
} from "./stakeholder-share-policy.js";

const NOW = new Date("2026-07-31T12:00:00.000Z");

const allOff: StakeholderToggles = {
  showGoalProgress: false,
  showShippedWork: false,
  showNarrative: false,
  showActivityTimeline: false,
};

const fullSignals: StakeholderSignals = {
  companyName: "Acme",
  goalProgress: {
    byStatus: { planned: 1, active: 2, achieved: 3, cancelled: 0 },
    goals: [{ title: "Reach 100 customers", status: "active" }],
  },
  shippedWork: [{ title: "Shipped billing v2", completedAt: "2026-07-30T00:00:00.000Z" }],
  activityTimeline: [{ at: "2026-07-30T00:00:00.000Z", label: "Milestone reached" }],
};

describe("assertShareViewable", () => {
  it("allows an active share with no expiry", () => {
    expect(assertShareViewable({ status: "active", expiresAt: null }, NOW)).toEqual({ ok: true });
  });

  it("allows an active share whose expiry is in the future", () => {
    const later = new Date(NOW.getTime() + 60_000);
    expect(assertShareViewable({ status: "active", expiresAt: later }, NOW)).toEqual({ ok: true });
  });

  it("denies a revoked share", () => {
    expect(assertShareViewable({ status: "revoked", expiresAt: null }, NOW)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("denies an expired share", () => {
    const past = new Date(NOW.getTime() - 60_000);
    expect(assertShareViewable({ status: "active", expiresAt: past }, NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("treats expiry as inclusive — expiring exactly now is already dead", () => {
    expect(assertShareViewable({ status: "active", expiresAt: NOW }, NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("reports revoked ahead of expired when both apply", () => {
    const past = new Date(NOW.getTime() - 60_000);
    expect(assertShareViewable({ status: "revoked", expiresAt: past }, NOW)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("denies any status it does not explicitly recognise (default-deny)", () => {
    expect(assertShareViewable({ status: "something_new", expiresAt: null }, NOW)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });
});

describe("projectStakeholderPayload", () => {
  it("omits every section when all toggles are off", () => {
    const payload = projectStakeholderPayload(allOff, fullSignals);
    expect(payload.companyName).toBe("Acme");
    expect("goalProgress" in payload).toBe(false);
    expect("shippedWork" in payload).toBe(false);
    expect("narrative" in payload).toBe(false);
    expect("activityTimeline" in payload).toBe(false);
  });

  it("includes only the section whose toggle is on", () => {
    const payload = projectStakeholderPayload({ ...allOff, showGoalProgress: true }, fullSignals);
    expect("goalProgress" in payload).toBe(true);
    expect("shippedWork" in payload).toBe(false);
    expect("activityTimeline" in payload).toBe(false);
  });

  it("includes shipped work only when its toggle is on", () => {
    const payload = projectStakeholderPayload({ ...allOff, showShippedWork: true }, fullSignals);
    expect(payload.shippedWork).toEqual(fullSignals.shippedWork);
    expect("goalProgress" in payload).toBe(false);
  });

  it("omits a section that is toggled on but has no gathered signal", () => {
    const payload = projectStakeholderPayload({ ...allOff, showGoalProgress: true }, {
      companyName: "Acme",
    });
    expect("goalProgress" in payload).toBe(false);
  });

  // The narrative is generated from the already-filtered signals, so it cannot
  // become a side channel for a section whose toggle is off.
  it("does not let the narrative leak a disabled section", () => {
    const payload = projectStakeholderPayload({ ...allOff, showNarrative: true }, fullSignals);
    expect("narrative" in payload).toBe(true);
    expect(payload.narrative?.text).not.toContain("Reach 100 customers");
    expect(payload.narrative?.text).not.toContain("Shipped billing v2");
  });

  it("lets the narrative describe a section that is enabled alongside it", () => {
    const payload = projectStakeholderPayload(
      { ...allOff, showNarrative: true, showShippedWork: true },
      fullSignals,
    );
    expect(payload.narrative?.text).toContain("1");
  });
});

describe("narrateStakeholder", () => {
  it("is deterministic for the same signals", () => {
    const a = narrateStakeholder(fullSignals);
    const b = narrateStakeholder(fullSignals);
    expect(a).toEqual(b);
  });

  it("degrades to a neutral headline with no signals", () => {
    const out = narrateStakeholder({ companyName: "Acme" });
    expect(out.headline).toContain("Acme");
    expect(out.sections).toEqual([]);
  });
});
