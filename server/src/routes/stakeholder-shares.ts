/**
 * FILE: server/src/routes/stakeholder-shares.ts
 * ABOUT: Combo-05 Phase 4c stakeholder transparency share routes.
 *
 * SECTIONS:
 *   [TAG: module] - stakeholder-shares.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: Board-only management of stakeholder shares plus the single public,
//         unauthenticated read-only render path.
// PSEUDOCODE: 1. list/create/update/revoke/rotate (board). 2. public GET by token.
// JSON_FLOW: {"file": "server/src/routes/stakeholder-shares.ts", "imports": "see code", "exports": "stakeholderShareRoutes"}
// ==========================================
// [START: module]
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createStakeholderShareSchema,
  updateStakeholderShareSchema,
  type CreateStakeholderShare,
  type UpdateStakeholderShare,
} from "@paperclipai/shared";
import { stakeholderShareService, toShareSummary } from "../services/index.js";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function stakeholderShareRoutes(db: Db) {
  const router = Router();
  const svc = stakeholderShareService(db);

  router.get("/companies/:companyId/stakeholder-shares", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const rows = await svc.list(companyId);
    res.json(rows.map(toShareSummary));
  });

  router.post(
    "/companies/:companyId/stakeholder-shares",
    validate(createStakeholderShareSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const b = req.body as CreateStakeholderShare;
      const row = await svc.create(
        companyId,
        {
          label: b.label,
          expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
          showGoalProgress: b.showGoalProgress,
          showShippedWork: b.showShippedWork,
          showNarrative: b.showNarrative,
          showActivityTimeline: b.showActivityTimeline,
        },
        req.actor.userId ?? null,
      );
      // Create is one of the two moments the operator needs the full token.
      res.json({ ...toShareSummary(row), token: row.token });
    },
  );

  router.patch("/stakeholder-shares/:id", validate(updateStakeholderShareSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Share not found" });
      return;
    }
    assertBoard(req);
    assertCompanyAccess(req, existing.companyId);

    const b = req.body as UpdateStakeholderShare;
    const updated = await svc.update(existing.companyId, id, {
      ...(b.label !== undefined ? { label: b.label } : {}),
      ...(b.expiresAt !== undefined ? { expiresAt: b.expiresAt ? new Date(b.expiresAt) : null } : {}),
      ...(b.showGoalProgress !== undefined ? { showGoalProgress: b.showGoalProgress } : {}),
      ...(b.showShippedWork !== undefined ? { showShippedWork: b.showShippedWork } : {}),
      ...(b.showNarrative !== undefined ? { showNarrative: b.showNarrative } : {}),
      ...(b.showActivityTimeline !== undefined ? { showActivityTimeline: b.showActivityTimeline } : {}),
    });
    if (!updated) {
      res.status(404).json({ error: "Share not found" });
      return;
    }
    res.json(toShareSummary(updated));
  });

  router.post("/stakeholder-shares/:id/revoke", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Share not found" });
      return;
    }
    assertBoard(req);
    assertCompanyAccess(req, existing.companyId);
    const revoked = await svc.revoke(existing.companyId, id, new Date());
    if (!revoked) {
      res.status(404).json({ error: "Share not found" });
      return;
    }
    res.json(toShareSummary(revoked));
  });

  router.post("/stakeholder-shares/:id/rotate", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Share not found" });
      return;
    }
    assertBoard(req);
    assertCompanyAccess(req, existing.companyId);
    const rotated = await svc.rotate(existing.companyId, id, new Date());
    if (!rotated) {
      res.status(404).json({ error: "Share not found" });
      return;
    }
    // Rotate is the other moment the operator needs the full token.
    res.json({ ...toShareSummary(rotated), token: rotated.token });
  });

  /**
   * Public, unauthenticated, read-only. Unknown, revoked and expired tokens all
   * yield an identical 404 so the endpoint cannot confirm that a token exists.
   */
  router.get("/stakeholder/:token", async (req, res) => {
    const payload = await svc.resolvePublic(req.params.token as string, new Date());
    if (!payload) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(payload);
  });

  return router;
}
// [END: module]
