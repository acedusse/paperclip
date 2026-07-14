/**
 * FILE: server/src/routes/digests.ts
 * ABOUT: digests.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - board-only read/generate routes for company digests.
 */
// ==========================================
// [META: module]
// INTENT: Board-only list/latest/generate of narration digests for a company.
// PSEUDOCODE: 1. GET list (optional limit). 2. GET latest (404 if none).
// 3. POST generate (404 if company not found).
// JSON_FLOW: {"file": "server/src/routes/digests.ts", "imports": "services, authz", "exports": "digestRoutes"}
// ==========================================
// [START: module]
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { digestService } from "../services/index.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function digestRoutes(db: Db) {
  const router = Router();
  const svc = digestService(db);

  router.get("/companies/:companyId/digests", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(await svc.list(companyId, Number.isFinite(limit) ? limit : undefined));
  });

  router.get("/companies/:companyId/digests/latest", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const digest = await svc.latest(companyId);
    if (!digest) {
      res.status(404).json({ error: "No digest yet" });
      return;
    }
    res.json(digest);
  });

  router.post("/companies/:companyId/digests/generate", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const digest = await svc.generateForCompany(companyId);
    if (!digest) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json(digest);
  });

  return router;
}
// [END: module]
