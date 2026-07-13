/**
 * FILE: server/src/routes/workspace-path-claims.ts
 * ABOUT: workspace-path-claims.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace-path-claims.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: workspace-path-claims.ts (routes module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/routes/workspace-path-claims.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { executionWorkspaces, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { workspacePathClaimService } from "../services/workspace-path-claims.js";
import { detectClaimOverlap } from "../services/workspace-path-overlap.js";
import { logActivity } from "../services/index.js";
import { assertCompanyAccess } from "./authz.js";
import { parseObject } from "../adapters/utils.js";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Verify the requesting actor is an agent run scoped to this company, and
 * load the run. Writes a 403 response and returns null when the actor isn't
 * an agent run belonging to this company/agent.
 */
async function resolveAgentRun(
  db: Db,
  req: Request,
  res: Response,
  companyId: string,
): Promise<typeof heartbeatRuns.$inferSelect | null> {
  if (req.actor.type !== "agent" || !req.actor.runId) {
    res.status(403).json({ error: "Agent run authentication required" });
    return null;
  }

  const run = await db
    .select()
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, req.actor.runId))
    .then((rows) => rows[0] ?? null);

  if (!run || run.companyId !== companyId || run.agentId !== req.actor.agentId) {
    res.status(403).json({ error: "Run does not belong to this agent or company" });
    return null;
  }

  return run;
}

/**
 * Resolve the run's shared workspace via issueId -> issues.executionWorkspaceId
 * -> execution_workspaces.mode. Writes a 400 response and returns null when
 * the run has no shared workspace.
 */
async function resolveSharedWorkspaceForRun(
  db: Db,
  res: Response,
  run: typeof heartbeatRuns.$inferSelect,
): Promise<string | null> {
  const issueId = readNonEmptyString(parseObject(run.contextSnapshot).issueId);
  const issue = issueId
    ? await db
        .select({ executionWorkspaceId: issues.executionWorkspaceId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null)
    : null;

  const executionWorkspaceId = issue?.executionWorkspaceId ?? null;
  const workspace = executionWorkspaceId
    ? await db
        .select({ mode: executionWorkspaces.mode })
        .from(executionWorkspaces)
        .where(eq(executionWorkspaces.id, executionWorkspaceId))
        .then((rows) => rows[0] ?? null)
    : null;

  if (!executionWorkspaceId || !workspace || workspace.mode !== "shared_workspace") {
    res.status(400).json({ error: "path claims require a shared workspace" });
    return null;
  }

  return executionWorkspaceId;
}

export function workspacePathClaimRoutes(db: Db) {
  const router = Router();
  const svc = workspacePathClaimService(db);

  router.post("/companies/:companyId/workspace-path-claims", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const run = await resolveAgentRun(db, req, res, companyId);
    if (!run) return;
    const executionWorkspaceId = await resolveSharedWorkspaceForRun(db, res, run);
    if (!executionWorkspaceId) return;

    const claim = await svc.acquireClaim({
      companyId,
      executionWorkspaceId,
      heartbeatRunId: run.id,
      agentId: run.agentId,
      path: req.body?.path ?? "",
      ttlMs: req.body?.ttlMs,
    });

    const others = await svc.listActiveClaimsOnWorkspace(executionWorkspaceId, run.id);
    const conflicts = detectClaimOverlap(claim.path, others, run.id);

    if (conflicts.length > 0) {
      await logActivity(db, {
        companyId,
        actorType: "agent",
        actorId: run.agentId ?? "unknown-agent",
        agentId: run.agentId,
        runId: run.id,
        action: "workspace_path_claim_conflict",
        entityType: "execution_workspace",
        entityId: executionWorkspaceId,
        details: { path: claim.path, conflictingRunIds: conflicts.map((c) => c.heartbeatRunId) },
      });
    }

    res.status(201).json({ claim, conflicts });
  });

  router.post("/companies/:companyId/workspace-path-claims/release", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const run = await resolveAgentRun(db, req, res, companyId);
    if (!run) return;

    await svc.releaseClaimsForRun(run.id);
    res.status(200).json({ released: true });
  });

  return router;
}
// [END: module]
