/**
 * FILE: server/src/routes/bounded-agent-approvers.ts
 * ABOUT: bounded-agent-approvers.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - bounded-agent-approvers.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: Board-only CRUD for bounded manager-agent approver grants.
// PSEUDOCODE: 1. create (board). 2. list (board). 3. revoke (board).
// JSON_FLOW: {"file": "server/src/routes/bounded-agent-approvers.ts", "imports": "see code", "exports": "boundedAgentApproverRoutes"}
// ==========================================
// [START: module]
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createBoundedAgentApproverSchema, type CreateBoundedAgentApprover } from "@paperclipai/shared";
import { boundedAgentApproverService } from "../services/index.js";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function boundedAgentApproverRoutes(db: Db) {
  const router = Router();
  const svc = boundedAgentApproverService(db);

  router.post(
    "/companies/:companyId/bounded-agent-approvers",
    validate(createBoundedAgentApproverSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const grantor = req.actor.userId ?? "board";
      const b = req.body as CreateBoundedAgentApprover;
      const grant = await svc.createGrant(companyId, grantor, {
        delegateAgentId: b.delegateAgentId,
        approvalTypes: b.approvalTypes,
        maxBand: b.maxBand,
        maxSpendCents: b.maxSpendCents,
        validFrom: b.validFrom ? new Date(b.validFrom) : undefined,
        validUntil: new Date(b.validUntil),
      });
      res.json(grant);
    },
  );

  router.get("/companies/:companyId/bounded-agent-approvers", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await svc.listGrants(companyId));
  });

  router.post("/bounded-agent-approvers/:id/revoke", async (req, res) => {
    const id = req.params.id as string;
    const grant = await svc.getGrant(id);
    if (!grant) {
      res.status(404).json({ error: "Grant not found" });
      return;
    }
    assertBoard(req);
    assertCompanyAccess(req, grant.companyId);
    const revoked = await svc.revokeGrant(id, new Date());
    if (!revoked) {
      res.status(404).json({ error: "Grant not found or already revoked" });
      return;
    }
    res.json(revoked);
  });

  return router;
}
// [END: module]
