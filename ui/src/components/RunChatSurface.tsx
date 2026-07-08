/**
 * FILE: ui/src/components/RunChatSurface.tsx
 * ABOUT: RunChatSurface.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - RunChatSurface.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: RunChatSurface.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/RunChatSurface.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { memo, useMemo } from "react";
import type { TranscriptEntry } from "../adapters";
import type { LiveRunForIssue } from "../api/heartbeats";
import { IssueChatThread } from "./IssueChatThread";
import { IssueChatThreadClassic } from "./IssueChatThreadClassic";
import { useConferenceRoomChatEnabled } from "../hooks/useConferenceRoomChatEnabled";
import type { IssueChatLinkedRun } from "../lib/issue-chat-messages";

const EMPTY_COMMENTS: [] = [];
const EMPTY_TIMELINE_EVENTS: [] = [];
const EMPTY_LIVE_RUNS: [] = [];
const EMPTY_LINKED_RUNS: [] = [];
const handleEmbeddedAdd = async () => {};

function isRunActive(run: LiveRunForIssue) {
  return run.status === "queued" || run.status === "running";
}

interface RunChatSurfaceProps {
  run: LiveRunForIssue;
  transcript: TranscriptEntry[];
  hasOutput: boolean;
  companyId?: string | null;
}

export const RunChatSurface = memo(function RunChatSurface({
  run,
  transcript,
  hasOutput,
  companyId,
}: RunChatSurfaceProps) {
  const active = isRunActive(run);
  const liveRuns = useMemo(() => (active ? [run] : EMPTY_LIVE_RUNS), [active, run]);
  const linkedRuns = useMemo<IssueChatLinkedRun[]>(
    () =>
      active
        ? EMPTY_LINKED_RUNS
        : [{
            runId: run.id,
            status: run.status,
            agentId: run.agentId,
            agentName: run.agentName,
            createdAt: run.createdAt,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
          }],
    [active, run],
  );
  const transcriptsByRunId = useMemo(
    () => new Map([[run.id, transcript as readonly TranscriptEntry[]]]),
    [run.id, transcript],
  );
  // Conference Room Chat experimental flag (PAP-136/PAP-139): OFF renders the
  // frozen master fork so embedded run chat looks exactly like master.
  const { enabled: conferenceRoomChatEnabled } = useConferenceRoomChatEnabled();
  const ThreadComponent = conferenceRoomChatEnabled ? IssueChatThread : IssueChatThreadClassic;

  return (
    <ThreadComponent
      comments={EMPTY_COMMENTS}
      linkedRuns={linkedRuns}
      timelineEvents={EMPTY_TIMELINE_EVENTS}
      liveRuns={liveRuns}
      companyId={companyId}
      onAdd={handleEmbeddedAdd}
      showComposer={false}
      showJumpToLatest={false}
      variant="embedded"
      emptyMessage={active ? "Waiting for run output..." : "No run output captured."}
      enableLiveTranscriptPolling={false}
      transcriptsByRunId={transcriptsByRunId}
      hasOutputForRun={(runId) => runId === run.id && hasOutput}
      includeSucceededRunsWithoutOutput
    />
  );
});
// [END: module]
