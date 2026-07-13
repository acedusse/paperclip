/**
 * FILE: server/src/routes/run-changesets.ts
 * ABOUT: run-changesets.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - run-changesets.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: run-changesets.ts (routes module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/routes/run-changesets.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { Router } from "express";
import { eq } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import { runChangesetService } from "../services/index.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function runChangesetRoutes(db: Db) {
  const router = Router();
  const svc = runChangesetService(db);

  async function loadRun(runId: string) {
    return db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((r) => r[0] ?? null);
  }

  router.get("/runs/:runId/changeset", async (req, res) => {
    const run = await loadRun(req.params.runId as string);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }
    assertCompanyAccess(req, run.companyId);
    const changeset = await svc.getForRun(run.id);
    if (!changeset) { res.status(404).json({ error: "No changeset recorded for this run" }); return; }
    res.json(changeset);
  });

  router.post("/runs/:runId/changeset/capture", async (req, res) => {
    assertBoard(req);
    const run = await loadRun(req.params.runId as string);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }
    assertCompanyAccess(req, run.companyId);
    const changeset = await svc.captureForRun(run.id);
    if (!changeset) { res.status(422).json({ error: "Run has no execution workspace to capture" }); return; }
    res.json(changeset);
  });

  return router;
}
// [END: module]
