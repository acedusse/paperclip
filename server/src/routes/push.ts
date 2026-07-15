/**
 * FILE: server/src/routes/push.ts
 * ABOUT: push.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - board-only web push subscription routes (vapid key, subscribe, unsubscribe).
 */
// ==========================================
// [META: module]
// INTENT: Serve the VAPID public key and let board actors register/remove web push subscriptions.
// PSEUDOCODE: 1. GET vapid key via pushVapidService. 2. POST upserts a subscription keyed by endpoint.
//   3. DELETE removes a subscription by (companyId, endpoint).
// JSON_FLOW: {"file": "server/src/routes/push.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { pushSubscriptions, type Db } from "@paperclipai/db";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@paperclipai/shared";
import { pushVapidService } from "../services/index.js";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function pushRoutes(db: Db) {
  const router = Router();
  const vapid = pushVapidService(db);

  router.get("/push/vapid-public-key", async (req, res) => {
    const init = await vapid.ensureInitialised();
    if (!init) { res.status(503).json({ error: "Push not available" }); return; }
    res.json({ publicKey: init.publicKey });
  });

  router.post("/companies/:companyId/push/subscriptions", validate(pushSubscriptionSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    await db
      .insert(pushSubscriptions)
      .values({
        companyId, userId: actor.actorId, endpoint: req.body.endpoint,
        p256dh: req.body.keys.p256dh, auth: req.body.keys.auth, userAgent: req.body.userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { companyId, userId: actor.actorId, p256dh: req.body.keys.p256dh, auth: req.body.keys.auth, userAgent: req.body.userAgent ?? null },
      });
    res.json({ ok: true });
  });

  router.delete("/companies/:companyId/push/subscriptions", validate(pushUnsubscribeSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.companyId, companyId), eq(pushSubscriptions.endpoint, req.body.endpoint)));
    res.json({ ok: true });
  });

  return router;
}
// [END: module]
