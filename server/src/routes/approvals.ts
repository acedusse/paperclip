/**
 * FILE: server/src/routes/approvals.ts
 * ABOUT: approvals.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - approvals.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: approvals.ts (routes module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/routes/approvals.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { Router, type Request } from "express";
import { eq } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import {
  addApprovalCommentSchema,
  bulkResolveApprovalsSchema,
  createApprovalSchema,
  requestApprovalRevisionSchema,
  resolveApprovalSchema,
  resubmitApprovalSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import {
  approvalService,
  approvalRiskService,
  approvalTriageService,
  autoApprovePolicyService,
  accessService,
  canDecide,
  heartbeatService,
  issueApprovalService,
  logActivity,
  recordDecision,
  secretService,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { redactEventPayload } from "../redaction.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";

// Combo-05 Phase 2a: locked ceiling — no policy may auto-decide above this band.
const AUTO_DECISION_MAX_BAND = "low" as const;

function redactApprovalPayload<T extends { payload: Record<string, unknown> }>(approval: T): T {
  return {
    ...approval,
    payload: redactEventPayload(approval.payload) ?? {},
  };
}

function isStatusOnlyCheapRecoveryContext(contextSnapshot: unknown) {
  if (!contextSnapshot || typeof contextSnapshot !== "object" || Array.isArray(contextSnapshot)) return false;
  const context = contextSnapshot as Record<string, unknown>;
  return context.modelProfile === "cheap" &&
    context.recoveryIntent === "status_only" &&
    context.allowDeliverableWork === false &&
    context.allowDocumentUpdates === false &&
    context.resumeRequiresNormalModel === true;
}

export function approvalRoutes(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const svc = approvalService(db);
  const riskSvc = approvalRiskService(db);
  const autoPolicySvc = autoApprovePolicyService(db);
  const triageSvc = approvalTriageService(db);
  const access = accessService(db);
  const heartbeat = heartbeatService(db, {
    pluginWorkerManager: options.pluginWorkerManager,
  });
  const issueApprovalsSvc = issueApprovalService(db);
  const secretsSvc = secretService(db);
  const strictSecretsMode = process.env.PAPERCLIP_SECRETS_STRICT_MODE === "true";

  // Shared post-approval side effects for BOTH the human approve route and the Phase-2a auto-approve
  // path: emit the `approval.approved` domain event and wake the requesting agent so it can resume.
  // Callers add their own recordDecision (explicit_human vs auto_policy). Keep this the single owner.
  async function applyApprovalApprovedEffects(
    approval: {
      id: string;
      companyId: string;
      type: string;
      status: string;
      requestedByAgentId: string | null;
    },
    actor: { actorType: "user" | "system"; actorId: string },
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
  }

  async function requireApprovalAccess(req: Request, id: string) {
    const approval = await svc.getById(id);
    if (!approval) {
      return null;
    }
    assertCompanyAccess(req, approval.companyId);
    return approval;
  }

  async function assertApprovalAccessAllowed(req: Request, res: any, companyId: string) {
    const decision = await access.decide({
      actor: req.actor,
      action: "company_scope:read",
      resource: { type: "company", companyId },
    });
    if (decision.allowed) return true;
    res.status(403).json({ error: "Approvals are outside this actor's authorization boundary" });
    return false;
  }

  async function assertApprovalMutationAllowedByRunContext(req: Request, res: any, companyId: string) {
    if (req.actor.type !== "agent") return true;
    const runId = req.actor.runId?.trim();
    if (!runId || !req.actor.agentId) return true;

    const run = await db
      .select({
        id: heartbeatRuns.id,
        companyId: heartbeatRuns.companyId,
        agentId: heartbeatRuns.agentId,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    if (!run || run.companyId !== companyId || run.agentId !== req.actor.agentId) return true;
    if (!isStatusOnlyCheapRecoveryContext(run.contextSnapshot)) return true;

    res.status(403).json({
      error: "Cheap status-only recovery runs cannot create or modify approvals",
      details: {
        companyId,
        runId: run.id,
        modelProfile: "cheap",
        recoveryIntent: "status_only",
        resumeRequiresNormalModel: true,
      },
    });
    return false;
  }

  router.get("/companies/:companyId/approvals", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (!(await assertApprovalAccessAllowed(req, res, companyId))) return;
    const status = req.query.status as string | undefined;
    const result = await svc.list(companyId, status);
    res.json(result.map((approval) => redactApprovalPayload(approval)));
  });

  // Route ordering: this literal /triage path must be registered before any
  // /companies/:companyId/approvals/:something param route so it isn't
  // swallowed as a param match. There is no such param route today, but keep
  // triage + bulk grouped here to preserve that invariant as routes are added.
  router.get("/companies/:companyId/approvals/triage", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (!(await assertApprovalAccessAllowed(req, res, companyId))) return;
    res.json(await triageSvc.listTriage(companyId));
  });

  router.post(
    "/companies/:companyId/approvals/bulk",
    validate(bulkResolveApprovalsSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await triageSvc.bulkResolve(companyId, {
        ids: req.body.ids,
        action: req.body.action,
        note: req.body.decisionNote ?? null,
        actor: { actorId: req.actor.userId ?? "board" },
      });
      res.json(result);
    },
  );

  router.get("/approvals/:id", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    if (!(await assertApprovalAccessAllowed(req, res, approval.companyId))) return;
    res.json(redactApprovalPayload(approval));
  });

  router.post("/companies/:companyId/approvals", validate(createApprovalSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (!(await assertApprovalAccessAllowed(req, res, companyId))) return;
    if (!(await assertApprovalMutationAllowedByRunContext(req, res, companyId))) return;
    const rawIssueIds = req.body.issueIds;
    const issueIds = Array.isArray(rawIssueIds)
      ? rawIssueIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const uniqueIssueIds = Array.from(new Set(issueIds));
    const { issueIds: _issueIds, ...approvalInput } = req.body;
    const normalizedPayload =
      approvalInput.type === "hire_agent"
        ? await secretsSvc.normalizeHireApprovalPayloadForPersistence(
            companyId,
            approvalInput.payload,
            { strictMode: strictSecretsMode },
          )
        : approvalInput.payload;

    const actor = getActorInfo(req);
    const approval = await svc.create(companyId, {
      ...approvalInput,
      payload: normalizedPayload,
      requestedByUserId: actor.actorType === "user" ? actor.actorId : null,
      requestedByAgentId:
        approvalInput.requestedByAgentId ?? (actor.actorType === "agent" ? actor.actorId : null),
      status: "pending",
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      updatedAt: new Date(),
    });

    if (uniqueIssueIds.length > 0) {
      await issueApprovalsSvc.linkManyForApproval(approval.id, uniqueIssueIds, {
        agentId: actor.agentId,
        userId: actor.actorType === "user" ? actor.actorId : null,
      });
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.created",
      entityType: "approval",
      entityId: approval.id,
      details: { type: approval.type, issueIds: uniqueIssueIds },
    });

    await riskSvc.computeAndPersist(approval.id).catch((err) => {
      logger.warn({ err, approvalId: approval.id }, "risk compute failed on approval create");
    });

    // Combo-05 Phase 2a: attempt auto-approve. Best-effort — never blocks or fails the create.
    const auto = await autoPolicySvc.evaluateForApproval(approval.id).catch((err) => {
      logger.warn({ err, approvalId: approval.id }, "auto-approve evaluation failed");
      return { matched: null as null };
    });
    if (auto.matched) {
      const risk = await riskSvc.getSnapshot(approval.id);
      const gate = canDecide({
        band: auto.matched.maxBand,
        method: "auto_policy",
        autoDecisionMaxBand: AUTO_DECISION_MAX_BAND,
      });
      if (gate.allow) {
        try {
          const { approval: approvedApproval, applied } = await svc.approve(approval.id, "auto_policy", null);
          if (applied) {
            await applyApprovalApprovedEffects(approvedApproval, {
              actorType: "system",
              actorId: "auto_policy",
            });
            try {
              await recordDecision(db, {
                approvalId: approval.id,
                companyId: approval.companyId,
                actor: { actorType: "system", actorId: "auto_policy" },
                method: "auto_policy",
                outcome: "approved",
                risk: risk ? { score: risk.score, band: risk.band as any } : null,
                note: `auto-approved by policy ${auto.matched.id}`,
              });
            } catch (auditErr) {
              logger.warn({ err: auditErr, approvalId: approval.id }, "auto-approve recordDecision failed");
            }
          }
        } catch (err) {
          logger.warn({ err, approvalId: approval.id }, "auto-approve failed; leaving pending");
        }
      }
    }

    const finalApproval = (await svc.getById(approval.id)) ?? approval;
    res.status(201).json(redactApprovalPayload(finalApproval));
  });

  router.get("/approvals/:id/issues", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    if (!(await assertApprovalAccessAllowed(req, res, approval.companyId))) return;
    const issues = await issueApprovalsSvc.listIssuesForApproval(id);
    res.json(issues);
  });

  router.post("/approvals/:id/approve", validate(resolveApprovalSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    if (!(await requireApprovalAccess(req, id))) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    const decidedByUserId = req.actor.userId ?? "board";
    const approvalForGate = await svc.getById(id);
    const risk = approvalForGate ? await riskSvc.getSnapshot(id) : null;
    const gate = canDecide({ band: (risk?.band as any) ?? "low", method: "explicit_human" });
    if (!gate.allow) {
      res.status(422).json({ error: gate.deny });
      return;
    }
    const { approval, applied } = await svc.approve(id, decidedByUserId, req.body.decisionNote);

    if (applied) {
      await applyApprovalApprovedEffects(approval, {
        actorType: "user",
        actorId: req.actor.userId ?? "board",
      });

      try {
        await recordDecision(db, {
          approvalId: approval.id,
          companyId: approval.companyId,
          actor: { actorType: "user", actorId: req.actor.userId ?? "board" },
          method: "explicit_human",
          outcome: "approved",
          risk: risk ? { score: risk.score, band: risk.band as any } : null,
          note: req.body.decisionNote ?? null,
        });
      } catch (auditErr) {
        logger.warn({ err: auditErr, approvalId: approval.id }, "recordDecision failed");
      }
    }

    res.json(redactApprovalPayload(approval));
  });

  router.post("/approvals/:id/reject", validate(resolveApprovalSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    if (!(await requireApprovalAccess(req, id))) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    const decidedByUserId = req.actor.userId ?? "board";
    const approvalForGate = await svc.getById(id);
    const risk = approvalForGate ? await riskSvc.getSnapshot(id) : null;
    const gate = canDecide({ band: (risk?.band as any) ?? "low", method: "explicit_human" });
    if (!gate.allow) {
      res.status(422).json({ error: gate.deny });
      return;
    }
    const { approval, applied } = await svc.reject(id, decidedByUserId, req.body.decisionNote);

    if (applied) {
      await logActivity(db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.rejected",
        entityType: "approval",
        entityId: approval.id,
        details: { type: approval.type },
      });

      try {
        await recordDecision(db, {
          approvalId: approval.id,
          companyId: approval.companyId,
          actor: { actorType: "user", actorId: req.actor.userId ?? "board" },
          method: "explicit_human",
          outcome: "rejected",
          risk: risk ? { score: risk.score, band: risk.band as any } : null,
          note: req.body.decisionNote ?? null,
        });
      } catch (auditErr) {
        logger.warn({ err: auditErr, approvalId: approval.id }, "recordDecision failed");
      }
    }

    res.json(redactApprovalPayload(approval));
  });

  router.post(
    "/approvals/:id/request-revision",
    validate(requestApprovalRevisionSchema),
    async (req, res) => {
      assertBoard(req);
      const id = req.params.id as string;
      if (!(await requireApprovalAccess(req, id))) {
        res.status(404).json({ error: "Approval not found" });
        return;
      }
      const decidedByUserId = req.actor.userId ?? "board";
      const approvalForGate = await svc.getById(id);
      const risk = approvalForGate ? await riskSvc.getSnapshot(id) : null;
      const gate = canDecide({ band: (risk?.band as any) ?? "low", method: "explicit_human" });
      if (!gate.allow) {
        res.status(422).json({ error: gate.deny });
        return;
      }
      const approval = await svc.requestRevision(id, decidedByUserId, req.body.decisionNote);

      await logActivity(db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.revision_requested",
        entityType: "approval",
        entityId: approval.id,
        details: { type: approval.type },
      });

      try {
        await recordDecision(db, {
          approvalId: approval.id,
          companyId: approval.companyId,
          actor: { actorType: "user", actorId: req.actor.userId ?? "board" },
          method: "explicit_human",
          outcome: "revision_requested",
          risk: risk ? { score: risk.score, band: risk.band as any } : null,
          note: req.body.decisionNote ?? null,
        });
      } catch (auditErr) {
        logger.warn({ err: auditErr, approvalId: approval.id }, "recordDecision failed");
      }

      res.json(redactApprovalPayload(approval));
    },
  );

  router.post("/approvals/:id/resubmit", validate(resubmitApprovalSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    if (!(await assertApprovalMutationAllowedByRunContext(req, res, existing.companyId))) return;

    if (req.actor.type === "agent" && req.actor.agentId !== existing.requestedByAgentId) {
      res.status(403).json({ error: "Only requesting agent can resubmit this approval" });
      return;
    }

    const normalizedPayload = req.body.payload
      ? existing.type === "hire_agent"
        ? await secretsSvc.normalizeHireApprovalPayloadForPersistence(
            existing.companyId,
            req.body.payload,
            { strictMode: strictSecretsMode },
          )
        : req.body.payload
      : undefined;
    const approval = await svc.resubmit(id, normalizedPayload);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: approval.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.resubmitted",
      entityType: "approval",
      entityId: approval.id,
      details: { type: approval.type },
    });
    res.json(redactApprovalPayload(approval));
  });

  router.get("/approvals/:id/comments", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const comments = await svc.listComments(id);
    res.json(comments);
  });

  router.post("/approvals/:id/comments", validate(addApprovalCommentSchema), async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    if (!(await assertApprovalMutationAllowedByRunContext(req, res, approval.companyId))) return;
    const actor = getActorInfo(req);
    const comment = await svc.addComment(id, req.body.body, {
      agentId: actor.agentId ?? undefined,
      userId: actor.actorType === "user" ? actor.actorId : undefined,
    });

    await logActivity(db, {
      companyId: approval.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.comment_added",
      entityType: "approval",
      entityId: approval.id,
      details: { commentId: comment.id },
    });

    res.status(201).json(comment);
  });

  return router;
}
// [END: module]
