import { describe, expect, it } from "vitest";
import { detectConcurrentSharedActivity } from "./workspace-conflict.js";

describe("detectConcurrentSharedActivity", () => {
  it("flags a shared workspace with other active runs (deduped)", () => {
    expect(detectConcurrentSharedActivity({
      workspaceMode: "shared_workspace",
      otherActiveRunIds: ["r1", "r2", "r1"],
    })).toEqual({ isConcurrent: true, otherRunIds: ["r1", "r2"] });
  });
  it("does not flag a shared workspace with no other runs", () => {
    expect(detectConcurrentSharedActivity({
      workspaceMode: "shared_workspace",
      otherActiveRunIds: [],
    })).toEqual({ isConcurrent: false, otherRunIds: [] });
  });
  it("never flags an isolated workspace, even with other runs", () => {
    expect(detectConcurrentSharedActivity({
      workspaceMode: "isolated_workspace",
      otherActiveRunIds: ["r1"],
    })).toEqual({ isConcurrent: false, otherRunIds: [] });
  });
  it("never flags a null/undefined mode", () => {
    expect(detectConcurrentSharedActivity({ workspaceMode: null, otherActiveRunIds: ["r1"] }))
      .toEqual({ isConcurrent: false, otherRunIds: [] });
    expect(detectConcurrentSharedActivity({ workspaceMode: undefined, otherActiveRunIds: ["r1"] }))
      .toEqual({ isConcurrent: false, otherRunIds: [] });
  });
});
