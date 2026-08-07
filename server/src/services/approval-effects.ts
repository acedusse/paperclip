/**
 * FILE: server/src/services/approval-effects.ts
 * ABOUT: approval-effects.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - the single owner of post-decision side effects for an approval.
 */
// ==========================================
// [META: module]
// INTENT: Emit the `approval.approved` domain event and wake the requesting agent so it can resume.
//   Extracted from routes/approvals.ts so every decision path — the HTTP route, auto-approve, and the
//   Telegram inline buttons — produces identical effects. Callers still add their own recordDecision.
// PSEUDOCODE: 1. Resolve the approval's linked issues. 2. Log approval.approved.
//   3. Wake the requester, logging queued/failed either way; a wakeup failure never throws.
//   4. applyApprovalRejectedEffects logs the rejection event.
// JSON_FLOW: {"file": "server/src/services/approval-effects.ts", "imports": "@paperclipai/db, ./heartbeat.js, ./issue-approvals.js, ./activity-log.js", "exports": "approvalEffectsService, ApprovalEffectsActor"}
// ==========================================
// [START: module]
import type { Db } from "@paperclipai/db";
import { heartbeatService } from "./heartbeat.js";
import { issueApprovalService } from "./issue-approvals.js";
import { logActivity } from "./activity-log.js";
import { logger } from "../middleware/logger.js";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";

export type ApprovalEffectsActor = { actorType: "user" | "system" | "agent"; actorId: string };

/** Only the slice of the heartbeat this service uses; callers may pass their own instance. */
export type ApprovalEffectsHeartbeat = Pick<ReturnType<typeof heartbeatService>, "wakeup">;

type DecidedApproval = {
  id: string;
  companyId: string;
  type: string;
  status: string;
  requestedByAgentId: string | null;
};

export function approvalEffectsService(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager; heartbeat?: ApprovalEffectsHeartbeat } = {},
) {
  // Callers that already own a configured heartbeat pass it in — routes/approvals.ts does, which also
  // keeps the services-barrel seam its tests stub. Otherwise build the default one.
  const heartbeat = options.heartbeat ?? heartbeatService(db, { pluginWorkerManager: options.pluginWorkerManager });
  const issueApprovalsSvc = issueApprovalService(db);

  return {
    async applyApprovalApprovedEffects(
      approval: DecidedApproval,
      actor: ApprovalEffectsActor,
    ): Promise<{ linkedIssueIds: string[]; primaryIssueId: string | null }> {
      const linkedIssues = await issueApprovalsSvc.listIssuesForApproval(approval.id);
      const linkedIssueIds = linkedIssues.map((issue) => issue.id);
      const primaryIssueId = linkedIssueIds[0] ?? null;

      await logActivity(db, {
        companyId: approval.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "approval.approved",
        entityType: "approval",
        entityId: approval.id,
        details: {
          type: approval.type,
          requestedByAgentId: approval.requestedByAgentId,
          linkedIssueIds,
        },
      });

      if (approval.requestedByAgentId) {
        try {
          const wakeRun = await heartbeat.wakeup(approval.requestedByAgentId, {
            source: "automation",
            triggerDetail: "system",
            reason: "approval_approved",
            payload: {
              approvalId: approval.id,
              approvalStatus: approval.status,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
            },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: {
              source: "approval.approved",
              approvalId: approval.id,
              approvalStatus: approval.status,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
              taskId: primaryIssueId,
              wakeReason: "approval_approved",
            },
          });

          await logActivity(db, {
            companyId: approval.companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            action: "approval.requester_wakeup_queued",
            entityType: "approval",
            entityId: approval.id,
            details: {
              requesterAgentId: approval.requestedByAgentId,
              wakeRunId: wakeRun?.id ?? null,
              linkedIssueIds,
            },
          });
        } catch (err) {
          logger.warn(
            { err, approvalId: approval.id, requestedByAgentId: approval.requestedByAgentId },
            "failed to queue requester wakeup after approval",
          );
          await logActivity(db, {
            companyId: approval.companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            action: "approval.requester_wakeup_failed",
            entityType: "approval",
            entityId: approval.id,
            details: {
              requesterAgentId: approval.requestedByAgentId,
              linkedIssueIds,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }

      return { linkedIssueIds, primaryIssueId };
    },

    async applyApprovalRejectedEffects(approval: DecidedApproval, actor: ApprovalEffectsActor): Promise<void> {
      await logActivity(db, {
        companyId: approval.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "approval.rejected",
        entityType: "approval",
        entityId: approval.id,
        details: { type: approval.type },
      });
    },
  };
}
// [END: module]
