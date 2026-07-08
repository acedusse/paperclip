/**
 * FILE: server/src/routes/dashboard.ts
 * ABOUT: dashboard.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - dashboard.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: dashboard.ts (routes module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/routes/dashboard.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { dashboardService } from "../services/dashboard.js";
import { assertCompanyAccess } from "./authz.js";

export function dashboardRoutes(db: Db) {
  const router = Router();
  const svc = dashboardService(db);

  router.get("/companies/:companyId/dashboard", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const summary = await svc.summary(companyId);
    res.json(summary);
  });

  return router;
}
// [END: module]
