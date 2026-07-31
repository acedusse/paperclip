/**
 * FILE: server/src/routes/company-preflight.ts
 * ABOUT: Combo-10 Phase 1 — company preflight (dry-run estimator) endpoint.
 *
 * SECTIONS:
 *   [TAG: module] - company-preflight.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: Expose the launch-readiness report as a read-only endpoint.
// PSEUDOCODE: 1. Authorize company access. 2. Run checks. 3. Return report.
// JSON_FLOW: {"file": "server/src/routes/company-preflight.ts", "imports": "company-preflight service", "exports": "companyPreflightRoutes"}
// ==========================================
// [START: module]
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { companyPreflightService } from "../services/company-preflight/index.js";
import { assertCompanyAccess } from "./authz.js";

export function companyPreflightRoutes(db: Db) {
  const router = Router();
  const preflight = companyPreflightService(db);

  // Read-only and side-effect free — safe to poll before launch.
  router.get("/companies/:companyId/preflight", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await preflight.run(companyId));
  });

  return router;
}
// [END: module]
