/**
 * FILE: server/src/services/health-sentinel/deadlock.ts
 * ABOUT: Idea 010 — blocker-graph deadlock and dead-end detection.
 *
 * SECTIONS:
 *   [TAG: module] - deadlock.ts (health-sentinel module).
 */
// ==========================================
// [META: module]
// INTENT: Find blocks-graph cycles and open work blocked behind unfinishable issues.
// PSEUDOCODE: 1. Build adjacency. 2. Tarjan SCC for cycles. 3. Reachability for dead ends.
// JSON_FLOW: {"file": "server/src/services/health-sentinel/deadlock.ts", "imports": "shared types", "exports": "findBlockerCycles, findBlockedDeadEnds, detectDeadlocks"}
// ==========================================
// [START: module]
import type { HealthFinding } from "@paperclipai/shared";

/** `blockerId` must finish before `blockedId` can proceed. */
export interface BlockerEdge {
  blockerId: string;
  blockedId: string;
}

export interface DeadlockIssue {
  id: string;
  identifier: string | null;
  /** Terminal issues (done/cancelled) cannot block anything. */
  status: string;
}

const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);

/**
 * Tarjan's strongly-connected-components, iterative.
 *
 * Recursion is avoided deliberately: a blocker graph is operator/agent
 * generated and can be arbitrarily deep, and a stack overflow inside a health
 * check would take out the very thing meant to report problems.
 *
 * Returns only components that are genuine cycles — size > 1, or a single node
 * with a self-edge. Every other node is its own trivial SCC and is not a
 * deadlock.
 */
export function findBlockerCycles(nodeIds: string[], edges: BlockerEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  const selfLoops = new Set<string>();
  for (const edge of edges) {
    if (!adjacency.has(edge.blockerId) || !adjacency.has(edge.blockedId)) continue;
    adjacency.get(edge.blockerId)!.push(edge.blockedId);
    if (edge.blockerId === edge.blockedId) selfLoops.add(edge.blockerId);
  }

  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let nextIndex = 0;

  for (const root of nodeIds) {
    if (index.has(root)) continue;

    // Explicit DFS stack of (node, next-neighbour-cursor).
    const work: Array<{ node: string; cursor: number }> = [{ node: root, cursor: 0 }];
    index.set(root, nextIndex);
    lowLink.set(root, nextIndex);
    nextIndex += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const neighbours = adjacency.get(frame.node) ?? [];

      if (frame.cursor < neighbours.length) {
        const next = neighbours[frame.cursor]!;
        frame.cursor += 1;
        if (!index.has(next)) {
          index.set(next, nextIndex);
          lowLink.set(next, nextIndex);
          nextIndex += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, cursor: 0 });
        } else if (onStack.has(next)) {
          lowLink.set(frame.node, Math.min(lowLink.get(frame.node)!, index.get(next)!));
        }
        continue;
      }

      // Frame exhausted — close it out and propagate the low-link upward.
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1]!.node;
        lowLink.set(parent, Math.min(lowLink.get(parent)!, lowLink.get(frame.node)!));
      }
      if (lowLink.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const popped = stack.pop()!;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        if (component.length > 1 || selfLoops.has(frame.node)) components.push(component);
      }
    }
  }

  return components;
}

/**
 * Open issues blocked by a cancelled issue, which can never unblock them.
 * The common real-world case: someone kills an issue and forgets the work
 * waiting on it, which then waits forever while looking perfectly healthy.
 *
 * Deliberately reports only *direct* victims. Transitive chains are not lost:
 * any chain ending at a cancelled issue necessarily has an open issue directly
 * blocked by it, so the root cause is always reported. Walking downstream as
 * well would emit one finding per issue in the chain — every one of which is
 * fixed by the same single edit — which is noise in an escalation contract.
 */
export function findBlockedDeadEnds(
  issues: DeadlockIssue[],
  edges: BlockerEdge[],
): Array<{ blockedId: string; deadBlockerId: string }> {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const results: Array<{ blockedId: string; deadBlockerId: string }> = [];

  for (const edge of edges) {
    const blocked = byId.get(edge.blockedId);
    const blocker = byId.get(edge.blockerId);
    if (!blocked || !blocker) continue;
    if (TERMINAL_ISSUE_STATUSES.has(blocked.status)) continue;
    if (blocker.status !== "cancelled") continue;
    results.push({ blockedId: edge.blockedId, deadBlockerId: edge.blockerId });
  }

  return results;
}

function label(issue: DeadlockIssue | undefined, id: string) {
  return issue?.identifier ?? id;
}

export function detectDeadlocks(issues: DeadlockIssue[], edges: BlockerEdge[]): HealthFinding[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const findings: HealthFinding[] = [];

  // Cycles are computed over non-terminal issues only: a closed issue cannot
  // hold anyone up, so including it would invent deadlocks that do not exist.
  const openIssues = issues.filter((issue) => !TERMINAL_ISSUE_STATUSES.has(issue.status));
  const openIds = openIssues.map((issue) => issue.id);

  for (const cycle of findBlockerCycles(openIds, edges)) {
    const ordered = [...cycle].sort();
    const labels = ordered.map((id) => label(byId.get(id), id));
    findings.push({
      kind: "blocker_cycle",
      level: "error",
      summary: `${ordered.length} issues form a blocking cycle: ${labels.join(" → ")} → ${labels[0]}. None can start.`,
      remediation: `Cut one edge in the cycle — remove the "blocks" relation into ${labels[0]} from whichever issue least needs to go first.`,
      issueIds: ordered,
      agentIds: [],
      goalIds: [],
    });
  }

  for (const deadEnd of findBlockedDeadEnds(issues, edges)) {
    const blocked = byId.get(deadEnd.blockedId);
    const deadBlocker = byId.get(deadEnd.deadBlockerId);
    findings.push({
      kind: "blocked_dead_end",
      level: "error",
      summary: `${label(blocked, deadEnd.blockedId)} is waiting on ${label(deadBlocker, deadEnd.deadBlockerId)}, which is cancelled and will never complete.`,
      remediation: `Remove the "blocks" relation from ${label(deadBlocker, deadEnd.deadBlockerId)}, or re-open it if the work is still needed.`,
      issueIds: [deadEnd.blockedId, deadEnd.deadBlockerId],
      agentIds: [],
      goalIds: [],
    });
  }

  return findings;
}
// [END: module]
