/**
 * FILE: server/src/services/digest-narration.ts
 * ABOUT: digest-narration.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - digest-narration.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: Pure narration engine: transforms DigestSignals into human-readable
// DigestPayload (headline, sections, full text). Pluggable narrator strategy.
// PSEUDOCODE: 1. Produce section per non-empty signal (approvals, auto-handled,
// stale-runs). 2. Compose headline based on approval count. 3. Flatten to text.
// 4. Return payload with signals for downstream use.
// JSON_FLOW: {"file": "server/src/services/digest-narration.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { DigestSignals } from "./digest-signals.js";

export type DigestSection = { key: string; title: string; lines: string[] };
export type DigestPayload = { headline: string; sections: DigestSection[]; text: string; signals: DigestSignals };
export type DigestNarrator = (signals: DigestSignals) => DigestPayload;

function approvalsSection(s: DigestSignals): DigestSection | null {
  const a = s.openApprovals;
  if (a.total === 0) return null;
  const bandParts = (["critical", "high", "medium", "low"] as const)
    .filter((b) => a.byBand[b] > 0)
    .map((b) => `${a.byBand[b]} ${b}`);
  const lines = [bandParts.join(", ")];
  for (const t of a.top) lines.push(`top: ${t.type} (score ${t.score}, ${t.band})`);
  return { key: "approvals", title: "Approvals waiting", lines };
}

function autoHandledSection(s: DigestSignals): DigestSection | null {
  if (s.autoApprovedSince === 0) return null;
  return {
    key: "auto-handled",
    title: "Handled for you",
    lines: [`${s.autoApprovedSince} approval${s.autoApprovedSince === 1 ? "" : "s"} auto-approved by policy since the last digest`],
  };
}

function staleRunsSection(s: DigestSignals): DigestSection | null {
  if (s.staleRuns.total === 0) return null;
  const lines = [`${s.staleRuns.total} run${s.staleRuns.total === 1 ? "" : "s"} idle`];
  for (const r of s.staleRuns.top) {
    lines.push(`${r.status} run idle ${Math.floor(r.staleForMinutes / 60)}h${r.agentId ? ` (agent ${r.agentId})` : ""}`);
  }
  return { key: "stale-runs", title: "Stuck runs", lines };
}

export const deterministicNarrator: DigestNarrator = (signals) => {
  const sections = [approvalsSection(signals), autoHandledSection(signals), staleRunsSection(signals)].filter(
    (x): x is DigestSection => x !== null,
  );

  const n = signals.openApprovals.total;
  const headline =
    n > 0 ? `${n} approval${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you` : "Nothing needs you right now";

  const text = [headline, ...sections.flatMap((sec) => [sec.title, ...sec.lines.map((l) => `  ${l}`)])].join("\n");

  return { headline, sections, text, signals };
};

export function narrateDigest(signals: DigestSignals, narrator: DigestNarrator = deterministicNarrator): DigestPayload {
  return narrator(signals);
}
// [END: module]
