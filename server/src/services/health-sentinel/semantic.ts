/**
 * FILE: server/src/services/health-sentinel/semantic.ts
 * ABOUT: Combo-03 Phase 3 — semantic tier seam with confidence thresholds.
 *
 * SECTIONS:
 *   [TAG: module] - semantic.ts (health-sentinel module).
 */
// ==========================================
// [META: module]
// INTENT: Gate semantic judgements behind a confidence threshold and an injectable judge.
// PSEUDOCODE: 1. Define judge contract. 2. Ship deterministic default. 3. Filter by confidence.
// JSON_FLOW: {"file": "server/src/services/health-sentinel/semantic.ts", "imports": "shared types", "exports": "SemanticJudge, deterministicOverlapJudge, judgeDecompositionOverlap"}
// ==========================================
// [START: module]
import type { HealthFinding } from "@paperclipai/shared";

/**
 * Phase 3 of the combo calls for semantic tiers "on a free local model behind
 * confidence thresholds". There is no inference API in this codebase today:
 * `ServerAdapterModule.execute` runs a whole agent session (spawns a CLI,
 * manages a workspace and a session), not a prompt completion. A general
 * inference contract across adapters is combo 02's job.
 *
 * So this module ships the *seam* rather than faking a model call — the same
 * shape Combo 05 used for `digest-narration.ts`, which injects a narrator and
 * defaults to a deterministic one. When combo 02 lands an inference API, a
 * model-backed judge drops in here with no change to callers.
 */
export interface SemanticJudgment {
  /** 0..1. Findings below the caller's threshold are discarded. */
  confidence: number;
  reason: string;
}

export interface DecompositionChild {
  issueId: string;
  title: string;
}

export interface SemanticJudge {
  /**
   * Decide whether two sibling sub-issues are the same work. Returns null when
   * the judge has no opinion — distinct from a low-confidence opinion.
   */
  judgeSiblingOverlap(a: DecompositionChild, b: DecompositionChild): SemanticJudgment | null;
}

/** Findings below this are not worth an operator's attention. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

function normalizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

/**
 * Jaccard similarity over title tokens. Genuinely deterministic, so it is
 * honest about what it can decide: it catches "Add login form" vs "Add the
 * login form", not "Add login form" vs "Build authentication UI". The latter
 * needs the model tier.
 */
export function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeTitle(a));
  const tokensB = new Set(normalizeTitle(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection += 1;
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export const deterministicOverlapJudge: SemanticJudge = {
  judgeSiblingOverlap(a, b) {
    const similarity = titleSimilarity(a.title, b.title);
    if (similarity === 0) return null;
    return {
      // Similarity maps directly to confidence: this judge is only confident
      // about near-identical wording, which is exactly what it can see.
      confidence: similarity,
      reason: `titles overlap ${Math.round(similarity * 100)}%`,
    };
  },
};

/**
 * Idea 059's overlap tier: sibling sub-issues that describe the same work, so
 * two agents are about to do it twice.
 */
export function judgeDecompositionOverlap(
  sourceIssueLabel: string,
  children: DecompositionChild[],
  judge: SemanticJudge = deterministicOverlapJudge,
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): HealthFinding[] {
  const findings: HealthFinding[] = [];

  for (let i = 0; i < children.length; i += 1) {
    for (let j = i + 1; j < children.length; j += 1) {
      const a = children[i]!;
      const b = children[j]!;
      const judgment = judge.judgeSiblingOverlap(a, b);
      if (!judgment) continue;
      if (judgment.confidence < confidenceThreshold) continue;

      findings.push({
        kind: "decomposition_overlap",
        level: "warn",
        summary: `Sub-issues of ${sourceIssueLabel} appear to duplicate each other: "${a.title}" and "${b.title}" (${judgment.reason}).`,
        remediation: `Merge or cancel one of them — otherwise two agents do the same work and both bill for it.`,
        issueIds: [a.issueId, b.issueId],
        agentIds: [],
        goalIds: [],
      });
    }
  }

  return findings;
}
// [END: module]
