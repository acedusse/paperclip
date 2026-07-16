/**
 * FILE: server/src/routes/delegations.ts
 * ABOUT: delegations.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - delegations.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: delegations.ts (routes module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/routes/delegations.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createDelegationGrantSchema,
  coverageConfigSchema,
  outOfOfficeSchema,
  type CreateDelegationGrant,
  type OutOfOfficeUpdate,
} from "@paperclipai/shared";
import { delegationService } from "../services/index.js";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function delegationRoutes(db: Db) {
  const router = Router();
  const svc = delegationService(db);

  router.post("/companies/:companyId/delegations", validate(createDelegationGrantSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const grantor = req.actor.userId ?? "board";
    const b = req.body as CreateDelegationGrant;
    const grant = await svc.createGrant(companyId, grantor, {
      delegateUserId: b.delegateUserId,
      approvalTypes: b.approvalTypes,
      maxBand: b.maxBand,
      maxSpendCents: b.maxSpendCents,
      validFrom: b.validFrom ? new Date(b.validFrom) : undefined,
      validUntil: new Date(b.validUntil),
      source: "manual",
    });
    res.json(grant);
  });

  router.get("/companies/:companyId/delegations", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await svc.listGrants(companyId));
  });

  router.post("/delegations/:id/revoke", async (req, res) => {
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

  router.get("/companies/:companyId/coverage-config", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await svc.getCoverageConfig(companyId));
  });

  router.put("/companies/:companyId/coverage-config", validate(coverageConfigSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const cfg = await svc.upsertCoverageConfig(companyId, req.body);
    res.json(cfg);
  });

  router.post("/companies/:companyId/out-of-office", validate(outOfOfficeSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const grantor = req.actor.userId ?? "board";
    const b = req.body as OutOfOfficeUpdate;
    const result = await svc.setOutOfOffice(companyId, grantor, {
      enabled: b.enabled,
      backupUserId: b.backupUserId,
      maxBand: b.maxBand,
      until: b.until ? new Date(b.until) : undefined,
      now: new Date(),
    });
    res.json(result);
  });

  return router;
}
// [END: module]
