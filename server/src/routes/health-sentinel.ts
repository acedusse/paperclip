/**
 * FILE: server/src/routes/health-sentinel.ts
 * ABOUT: Combo-03 Health Sentinel report endpoint.
 *
 * SECTIONS:
 *   [TAG: module] - health-sentinel.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: Expose the company health report as a read-only endpoint.
// PSEUDOCODE: 1. Authorize company access. 2. Run detectors. 3. Return report.
// JSON_FLOW: {"file": "server/src/routes/health-sentinel.ts", "imports": "health-sentinel service", "exports": "healthSentinelRoutes"}
// ==========================================
// [START: module]
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { healthSentinelService } from "../services/health-sentinel/index.js";
import { assertCompanyAccess } from "./authz.js";

export function healthSentinelRoutes(db: Db) {
  const router = Router();
  const sentinel = healthSentinelService(db);

  // Read-only and side-effect free, so it is safe to poll and safe to retry.
  router.get("/companies/:companyId/health-sentinel", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await sentinel.run(companyId));
  });

  return router;
}
// [END: module]
