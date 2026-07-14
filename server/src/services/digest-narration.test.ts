import { describe, it, expect } from "vitest";
import { narrateDigest, deterministicNarrator } from "./digest-narration.js";
import type { DigestSignals } from "./digest-signals.js";

const empty: DigestSignals = {
  openApprovals: { total: 0, byBand: { low: 0, medium: 0, high: 0, critical: 0 }, top: [] },
  autoApprovedSince: 0,
  staleRuns: { total: 0, top: [] },
};

describe("narrateDigest", () => {
  it("produces a calm headline and no sections when nothing needs the human", () => {
    const p = narrateDigest(empty);
    expect(p.headline.toLowerCase()).toContain("nothing");
    expect(p.sections).toEqual([]);
  });

  it("leads with the approval ask and includes a section per non-empty signal", () => {
    const signals: DigestSignals = {
      openApprovals: {
        total: 3,
        byBand: { low: 2, medium: 0, high: 0, critical: 1 },
        top: [{ id: "a1", type: "hire_agent", band: "critical", score: 90 }],
      },
      autoApprovedSince: 7,
      staleRuns: { total: 1, top: [{ runId: "r1", agentId: "ag1", status: "running", staleForMinutes: 400 }] },
    };
    const p = narrateDigest(signals);
    expect(p.headline).toContain("3 approvals");
    const keys = p.sections.map((s) => s.key);
    expect(keys).toEqual(["approvals", "auto-handled", "stale-runs"]);
    expect(p.text).toContain("hire_agent");
    expect(p.text).toContain("7");
  });

  it("is deterministic", () => {
    expect(narrateDigest(empty)).toEqual(narrateDigest(empty));
  });

  it("exposes the deterministic narrator as the default", () => {
    expect(narrateDigest(empty, deterministicNarrator)).toEqual(narrateDigest(empty));
  });
});
