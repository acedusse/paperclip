import { describe, expect, it, vi } from "vitest";
import {
  STOPPABLE_WIND_DOWN_STATUSES,
  windDownRun,
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
