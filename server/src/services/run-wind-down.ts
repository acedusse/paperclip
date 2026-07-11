// Combo-01 Phase 2.0: the shared graceful wind-down primitive. Stops one
// in-flight heartbeat run either softly (let the current turn finish, then
// don't continue it) or hard (terminate the turn now, capture a continuation
// artifact, and re-enqueue the work per the caller's resume policy).
//
// Pure + dependency-injected: it never touches the heartbeat singleton or the
// DB directly. The heartbeat service wires concrete deps (see heartbeat.ts).

export type WindDownMode = "soft" | "hard";
export type ResumePolicy = "when-allowed" | "no";
export type WindDownReason = "cap-wallclock" | "cap-cost" | "panic" | "drain";
export type WindDownOutcome = "terminated" | "marked-soft" | "noop";

// The minimal run shape the primitive needs. Concrete deps map the full
// heartbeat_runs row down to this.
export type WindDownRunRow = { id: string; status: string; agentId: string };

// Only runs in one of these statuses can be wound down; anything already
// terminal is a noop.
export const STOPPABLE_WIND_DOWN_STATUSES: readonly string[] = ["queued", "running", "scheduled_retry"];

export type WindDownDeps = {
  getRun(runId: string): Promise<WindDownRunRow | null>;
  // Snapshot last-known state to the issue continuation summary BEFORE the kill.
  captureContinuation(run: WindDownRunRow): Promise<void>;
  // Terminate the OS process (grace window) and drop it from the in-memory map.
  terminateProcess(run: WindDownRunRow): Promise<void>;
  // Set status=wound_down + windDownReason + resumePolicy + finishedAt, notify.
  markWoundDown(runId: string, reason: WindDownReason, resume: ResumePolicy): Promise<void>;
  // Soft mode: persist intent on the still-running row; do NOT change status.
  markSoftIntent(runId: string, reason: WindDownReason, resume: ResumePolicy): Promise<void>;
  // Release the issue execution lock; reenqueue=true promotes a continuation run,
  // reenqueue=false parks the work.
  releaseIssue(run: WindDownRunRow, opts: { reenqueue: boolean }): Promise<void>;
};

export async function windDownRun(
  deps: WindDownDeps,
  runId: string,
  opts: { mode: WindDownMode; resume: ResumePolicy; reason: WindDownReason },
): Promise<{ outcome: WindDownOutcome }> {
  const run = await deps.getRun(runId);
  if (!run || !STOPPABLE_WIND_DOWN_STATUSES.includes(run.status)) {
    return { outcome: "noop" };
  }

  if (opts.mode === "soft") {
    await deps.markSoftIntent(runId, opts.reason, opts.resume);
    return { outcome: "marked-soft" };
  }

  // Hard: capture continuation FIRST so we snapshot last-known state before the
  // process dies, then terminate, mark, and release per resume policy.
  await deps.captureContinuation(run);
  await deps.terminateProcess(run);
  await deps.markWoundDown(runId, opts.reason, opts.resume);
  await deps.releaseIssue(run, { reenqueue: opts.resume === "when-allowed" });
  return { outcome: "terminated" };
}
