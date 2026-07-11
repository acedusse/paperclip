import { describe, expect, it, vi } from "vitest";
import {
  makeWoundDownResumeSource,
  shouldSuppressContinuationOnFinish,
  STOPPABLE_WIND_DOWN_STATUSES,
  windDownRun,
  type OrphanedWoundDownRun,
  type WindDownDeps,
  type WindDownRunRow,
} from "./run-wind-down.js";

function makeDeps(run: WindDownRunRow | null) {
  const calls: string[] = [];
  const deps: WindDownDeps = {
    getRun: vi.fn(async () => run),
    captureContinuation: vi.fn(async () => {
      calls.push("capture");
    }),
    terminateProcess: vi.fn(async () => {
      calls.push("terminate");
    }),
    markWoundDown: vi.fn(async () => {
      calls.push("markWoundDown");
    }),
    markSoftIntent: vi.fn(async () => {
      calls.push("markSoftIntent");
    }),
    releaseIssue: vi.fn(async (_run, opts) => {
      calls.push(`release:${opts.reenqueue}`);
    }),
  };
  return { deps, calls };
}

const RUN: WindDownRunRow = { id: "run-1", status: "running", agentId: "agent-1" };

describe("windDownRun", () => {
  it("noops when the run is missing", async () => {
    const { deps } = makeDeps(null);
    expect(await windDownRun(deps, "run-1", { mode: "hard", resume: "no", reason: "panic" })).toEqual({
      outcome: "noop",
    });
    expect(deps.terminateProcess).not.toHaveBeenCalled();
  });

  it("noops when the run is in a non-stoppable status", async () => {
    const { deps } = makeDeps({ id: "run-1", status: "finished", agentId: "agent-1" });
    expect(await windDownRun(deps, "run-1", { mode: "hard", resume: "no", reason: "panic" })).toEqual({
      outcome: "noop",
    });
    expect(deps.terminateProcess).not.toHaveBeenCalled();
  });

  it("hard + when-allowed: captures before terminating, marks wound_down, re-enqueues", async () => {
    const { deps, calls } = makeDeps(RUN);
    const result = await windDownRun(deps, "run-1", {
      mode: "hard",
      resume: "when-allowed",
      reason: "cap-cost",
    });
    expect(result).toEqual({ outcome: "terminated" });
    expect(calls).toEqual(["capture", "terminate", "markWoundDown", "release:true"]);
    expect(deps.markWoundDown).toHaveBeenCalledWith("run-1", "cap-cost", "when-allowed");
  });

  it("hard + no: marks wound_down, releases WITHOUT re-enqueue", async () => {
    const { deps, calls } = makeDeps(RUN);
    const result = await windDownRun(deps, "run-1", { mode: "hard", resume: "no", reason: "panic" });
    expect(result).toEqual({ outcome: "terminated" });
    expect(calls).toEqual(["capture", "terminate", "markWoundDown", "release:false"]);
  });

  it("soft: records intent only, no process action", async () => {
    const { deps, calls } = makeDeps(RUN);
    const result = await windDownRun(deps, "run-1", { mode: "soft", resume: "no", reason: "drain" });
    expect(result).toEqual({ outcome: "marked-soft" });
    expect(calls).toEqual(["markSoftIntent"]);
    expect(deps.markSoftIntent).toHaveBeenCalledWith("run-1", "drain", "no");
    expect(deps.terminateProcess).not.toHaveBeenCalled();
    expect(deps.captureContinuation).not.toHaveBeenCalled();
  });

  it("exposes the stoppable status set", () => {
    expect(STOPPABLE_WIND_DOWN_STATUSES).toEqual(["queued", "running", "scheduled_retry"]);
  });
});

describe("wound-down-resume reconcile source", () => {
  it("re-enqueues every resumable orphan and reports the count", async () => {
    const orphans: OrphanedWoundDownRun[] = [
      { id: "r1", agentId: "a1" },
      { id: "r2", agentId: "a2" },
    ];
    const reenqueueOrphan = vi.fn(async () => {});
    const source = makeWoundDownResumeSource({
      findResumableOrphans: vi.fn(async () => orphans),
      reenqueueOrphan,
    });
    const result = await source.reconcile(new Date());
    expect(source.name).toBe("wound-down-resume");
    expect(reenqueueOrphan).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ source: "wound-down-resume", drifted: 2, repaired: 2 });
  });

  it("reports zero when nothing is resumable", async () => {
    const source = makeWoundDownResumeSource({
      findResumableOrphans: vi.fn(async () => []),
      reenqueueOrphan: vi.fn(async () => {}),
    });
    expect(await source.reconcile(new Date())).toEqual({
      source: "wound-down-resume",
      drifted: 0,
      repaired: 0,
    });
  });
});

describe("shouldSuppressContinuationOnFinish", () => {
  it("suppresses continuation for a soft wind-down with resume=no", () => {
    expect(shouldSuppressContinuationOnFinish({ windDownReason: "drain", resumePolicy: "no" })).toBe(true);
  });

  it("allows normal promotion for a soft wind-down with resume=when-allowed", () => {
    expect(
      shouldSuppressContinuationOnFinish({ windDownReason: "drain", resumePolicy: "when-allowed" }),
    ).toBe(false);
  });

  it("allows normal promotion for an ordinary finish (no wind-down intent)", () => {
    expect(shouldSuppressContinuationOnFinish({ windDownReason: null, resumePolicy: null })).toBe(false);
  });
});
