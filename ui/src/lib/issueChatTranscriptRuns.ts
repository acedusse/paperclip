/**
 * FILE: ui/src/lib/issueChatTranscriptRuns.ts
 * ABOUT: issueChatTranscriptRuns.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - issueChatTranscriptRuns.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: issueChatTranscriptRuns.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/issueChatTranscriptRuns.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { ActiveRunForIssue, LiveRunForIssue } from "../api/heartbeats";
import type { RunTranscriptSource } from "../components/transcript/useLiveRunTranscripts";
import type { IssueChatLinkedRun } from "./issue-chat-messages";

export function resolveIssueChatTranscriptRuns(args: {
  linkedRuns?: readonly IssueChatLinkedRun[];
  liveRuns?: readonly LiveRunForIssue[];
  activeRun?: ActiveRunForIssue | null;
}): RunTranscriptSource[] {
  const { linkedRuns = [], liveRuns = [], activeRun = null } = args;
  const combined = new Map<string, RunTranscriptSource>();

  for (const run of liveRuns) {
    combined.set(run.id, {
      id: run.id,
      status: run.status,
      adapterType: run.adapterType,
      logBytes: run.logBytes,
      lastOutputBytes: run.lastOutputBytes,
    });
  }

  if (activeRun) {
    combined.set(activeRun.id, {
      id: activeRun.id,
      status: activeRun.status,
      adapterType: activeRun.adapterType,
      logBytes: activeRun.logBytes,
      lastOutputBytes: activeRun.lastOutputBytes,
    });
  }

  for (const run of linkedRuns) {
    if (combined.has(run.runId)) continue;
    const adapterType = run.adapterType;
    if (!adapterType) continue;
    combined.set(run.runId, {
      id: run.runId,
      status: run.status,
      adapterType,
      hasStoredOutput: run.hasStoredOutput,
      logBytes: run.logBytes,
    });
  }

  return [...combined.values()];
}
// [END: module]
