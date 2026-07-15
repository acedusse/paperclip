/**
 * FILE: server/src/routes/auto-approve-policies.ts
 * ABOUT: auto-approve-policies.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - board-only CRUD for per-company auto-approve allowlist policies.
 */
// ==========================================
// [META: module]
// INTENT: Board-only list/create/update of auto_approve_policies for a company.
// PSEUDOCODE: 1. GET list active. 2. POST create (validated). 3. PATCH update/toggle.
// JSON_FLOW: {"file": "server/src/routes/auto-approve-policies.ts", "imports": "shared validators, services, authz", "exports": "autoApprovePolicyRoutes"}
// ==========================================
// [START: module]
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createAutoApprovePolicySchema, updateAutoApprovePolicySchema } from "@paperclipai/shared";
import { autoApprovePolicyService } from "../services/index.js";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function autoApprovePolicyRoutes(db: Db) {
  const router = Router();
  const svc = autoApprovePolicyService(db);

  router.get("/companies/:companyId/auto-approve-policies", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await svc.listActive(companyId));
  });

  router.post(
    "/companies/:companyId/auto-approve-policies",
    validate(createAutoApprovePolicySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const created = await svc.create(companyId, {
        agentId: req.body.agentId,
        approvalType: req.body.approvalType,
        maxBand: req.body.maxBand,
        maxSpendCents: req.body.maxSpendCents,
        requireNoSecrets: req.body.requireNoSecrets,
        createdByUserId: req.actor?.userId ?? null,
      });
      res.json(created);
    },
  );

  router.patch(
    "/companies/:companyId/auto-approve-policies/:id",
    validate(updateAutoApprovePolicySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const updated = await svc.update(companyId, req.params.id as string, {
        ...req.body,
        updatedByUserId: req.actor?.userId ?? null,
      });
      if (!updated) {
        res.status(404).json({ error: "Policy not found" });
        return;
      }
      res.json(updated);
    },
  );

  return router;
}
// [END: module]
