/**
 * FILE: server/src/__tests__/health-sentinel-deadlock.test.ts
 * ABOUT: health-sentinel-deadlock.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - health-sentinel-deadlock.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: health-sentinel-deadlock.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/health-sentinel-deadlock.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  detectDeadlocks,
  findBlockedDeadEnds,
  findBlockerCycles,
  type BlockerEdge,
  type DeadlockIssue,
} from "../services/health-sentinel/deadlock.ts";

const open = (id: string): DeadlockIssue => ({ id, identifier: id.toUpperCase(), status: "todo" });
const cancelled = (id: string): DeadlockIssue => ({ id, identifier: id.toUpperCase(), status: "cancelled" });
const done = (id: string): DeadlockIssue => ({ id, identifier: id.toUpperCase(), status: "done" });

const edge = (blockerId: string, blockedId: string): BlockerEdge => ({ blockerId, blockedId });

describe("findBlockerCycles", () => {
  it("finds no cycle in a plain chain", () => {
    const cycles = findBlockerCycles(["a", "b", "c"], [edge("a", "b"), edge("b", "c")]);
    expect(cycles).toEqual([]);
  });

  it("finds a two-node cycle", () => {
    const cycles = findBlockerCycles(["a", "b"], [edge("a", "b"), edge("b", "a")]);
    expect(cycles).toHaveLength(1);
    expect([...cycles[0]!].sort()).toEqual(["a", "b"]);
  });

  it("finds a three-node cycle", () => {
    const cycles = findBlockerCycles(
      ["a", "b", "c"],
      [edge("a", "b"), edge("b", "c"), edge("c", "a")],
    );
    expect(cycles).toHaveLength(1);
    expect([...cycles[0]!].sort()).toEqual(["a", "b", "c"]);
  });

  it("treats a self-block as a cycle", () => {
    const cycles = findBlockerCycles(["a"], [edge("a", "a")]);
    expect(cycles).toEqual([["a"]]);
  });

  it("does not report trivial single-node components as cycles", () => {
    const cycles = findBlockerCycles(["a", "b"], [edge("a", "b")]);
    expect(cycles).toEqual([]);
  });

  it("finds two independent cycles separately", () => {
    const cycles = findBlockerCycles(
      ["a", "b", "c", "d"],
      [edge("a", "b"), edge("b", "a"), edge("c", "d"), edge("d", "c")],
    );
    expect(cycles).toHaveLength(2);
    expect(cycles.map((cycle) => [...cycle].sort()).sort()).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("ignores edges pointing outside the node set", () => {
    const cycles = findBlockerCycles(["a"], [edge("a", "ghost"), edge("ghost", "a")]);
    expect(cycles).toEqual([]);
  });

  it("handles a deep chain without overflowing the stack", () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => `n${i}`);
    const edges = ids.slice(0, -1).map((id, i) => edge(id, ids[i + 1]!));
    // Close the loop so there is exactly one giant cycle to find.
    edges.push(edge(ids[ids.length - 1]!, ids[0]!));

    const cycles = findBlockerCycles(ids, edges);

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(20_000);
  });
});

describe("findBlockedDeadEnds", () => {
  it("flags work blocked directly by a cancelled issue", () => {
    const deadEnds = findBlockedDeadEnds([open("a"), cancelled("b")], [edge("b", "a")]);
    expect(deadEnds).toEqual([{ blockedId: "a", deadBlockerId: "b" }]);
  });

  it("reports the direct victim of a cancelled blocker, not the whole downstream chain", () => {
    // c (cancelled) blocks b, b blocks a. Fixing the c->b edge unblocks both,
    // so only b is reported — one finding per fix, not per affected issue.
    const deadEnds = findBlockedDeadEnds(
      [open("a"), open("b"), cancelled("c")],
      [edge("b", "a"), edge("c", "b")],
    );
    expect(deadEnds).toEqual([{ blockedId: "b", deadBlockerId: "c" }]);
  });

  it("does not flag work blocked by a completed issue", () => {
    const deadEnds = findBlockedDeadEnds([open("a"), done("b")], [edge("b", "a")]);
    expect(deadEnds).toEqual([]);
  });

  it("does not flag an issue that is itself terminal", () => {
    const deadEnds = findBlockedDeadEnds([done("a"), cancelled("b")], [edge("b", "a")]);
    expect(deadEnds).toEqual([]);
  });

  it("terminates on a cycle rather than looping forever", () => {
    const deadEnds = findBlockedDeadEnds(
      [open("a"), open("b")],
      [edge("a", "b"), edge("b", "a")],
    );
    expect(deadEnds).toEqual([]);
  });
});

describe("detectDeadlocks", () => {
  it("returns nothing for a healthy graph", () => {
    expect(detectDeadlocks([open("a"), open("b")], [edge("a", "b")])).toEqual([]);
  });

  it("reports a cycle as an actionable error naming the edge to cut", () => {
    const findings = detectDeadlocks([open("a"), open("b")], [edge("a", "b"), edge("b", "a")]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("blocker_cycle");
    expect(findings[0]!.level).toBe("error");
    expect(findings[0]!.issueIds.sort()).toEqual(["a", "b"]);
    expect(findings[0]!.remediation).toContain("Cut one edge");
  });

  it("excludes terminal issues from cycle detection", () => {
    // A closed issue cannot hold anyone up, so this must not read as a cycle.
    const findings = detectDeadlocks([open("a"), done("b")], [edge("a", "b"), edge("b", "a")]);
    expect(findings.filter((f) => f.kind === "blocker_cycle")).toEqual([]);
  });

  it("reports a cancelled blocker as a dead end", () => {
    const findings = detectDeadlocks([open("a"), cancelled("b")], [edge("b", "a")]);

    const deadEnd = findings.find((f) => f.kind === "blocked_dead_end");
    expect(deadEnd).toBeDefined();
    expect(deadEnd!.level).toBe("error");
    expect(deadEnd!.issueIds).toEqual(["a", "b"]);
  });
});
// [END: module]
