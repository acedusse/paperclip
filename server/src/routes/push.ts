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
import { pushSubscriptions, pushDeliveryPrefs, type Db } from "@paperclipai/db";
import { pushSubscriptionSchema, pushUnsubscribeSchema, pushPrefsSchema, pushDeviceRenameSchema } from "@paperclipai/shared";
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
        p256dh: req.body.keys.p256dh, auth: req.body.keys.auth,
        userAgent: req.body.userAgent ?? null, label: req.body.label ?? null,
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.companyId, pushSubscriptions.endpoint],
        set: { userId: actor.actorId, p256dh: req.body.keys.p256dh, auth: req.body.keys.auth, userAgent: req.body.userAgent ?? null, label: req.body.label ?? null },
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

  router.get("/companies/:companyId/push/prefs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const [row] = await db
      .select()
      .from(pushDeliveryPrefs)
      .where(and(eq(pushDeliveryPrefs.companyId, companyId), eq(pushDeliveryPrefs.userId, actor.actorId)));
    res.json(
      row
        ? { minBand: row.minBand, quietStart: row.quietStart, quietEnd: row.quietEnd, timezone: row.timezone }
        : { minBand: "high", quietStart: null, quietEnd: null, timezone: null },
    );
  });

  router.put("/companies/:companyId/push/prefs", validate(pushPrefsSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const { minBand, quietStart, quietEnd, timezone } = req.body;
    await db
      .insert(pushDeliveryPrefs)
      .values({ companyId, userId: actor.actorId, minBand, quietStart, quietEnd, timezone })
      .onConflictDoUpdate({
        target: [pushDeliveryPrefs.companyId, pushDeliveryPrefs.userId],
        set: { minBand, quietStart, quietEnd, timezone, updatedAt: new Date() },
      });
    res.json({ ok: true });
  });

  router.get("/companies/:companyId/push/subscriptions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.companyId, companyId), eq(pushSubscriptions.userId, actor.actorId)));
    res.json(
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        userAgent: r.userAgent,
        lastUsedAt: r.lastUsedAt,
        createdAt: r.createdAt,
        endpointTail: r.endpoint.slice(-8),
      })),
    );
  });

  router.patch("/companies/:companyId/push/subscriptions/:id", validate(pushDeviceRenameSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const updated = await db
      .update(pushSubscriptions)
      .set({ label: req.body.label })
      .where(
        and(
          eq(pushSubscriptions.id, id),
          eq(pushSubscriptions.companyId, companyId),
          eq(pushSubscriptions.userId, actor.actorId),
        ),
      )
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "Device not found" });
      return;
    }
    res.json({ ok: true });
  });

  router.delete("/companies/:companyId/push/subscriptions/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const removed = await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.id, id),
          eq(pushSubscriptions.companyId, companyId),
          eq(pushSubscriptions.userId, actor.actorId),
        ),
      )
      .returning();
    if (removed.length === 0) {
      res.status(404).json({ error: "Device not found" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
// [END: module]
