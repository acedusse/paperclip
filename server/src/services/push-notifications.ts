/**
 * FILE: server/src/services/push-notifications.ts
 * ABOUT: push-notifications.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - Approval push payload builder + webpush delivery channel (real Web Push via web-push lib).
 */
// ==========================================
// [META: module]
// INTENT: Build the deterministic push body for an approval notification, and deliver it via Web Push to every
//   subscription registered for the target company, pruning subscriptions the push service reports as gone.
// PSEUDOCODE: 1. buildApprovalPushBody() is a pure mapping from approval fields to a push payload.
//   2. createWebPushChannel(db) returns a DeliveryChannel named "webpush" whose deliver(): no-ops without a
//   companyId or a payload.push; ensures VAPID is initialised (no-op if disabled); loads the company's
//   subscriptions; sends to each, bumping last_used_at on success or deleting the row on a 404/410, else logging.
// JSON_FLOW: {"file": "server/src/services/push-notifications.ts", "imports": "drizzle-orm, web-push, @paperclipai/db", "exports": "buildApprovalPushBody, createWebPushChannel"}
// ==========================================
// [START: module]
import { eq } from "drizzle-orm";
import webpush from "web-push";
import type { Db } from "@paperclipai/db";
import { pushSubscriptions, pushDeliveryPrefs } from "@paperclipai/db";
import type { DeliveryChannel } from "./notification-delivery.js";
import { pushVapidService } from "./push-vapid.js";
import { shouldPushToUser } from "./push-prefs.js";
import type { RiskBand } from "./approval-risk.js";
import { logger } from "../middleware/logger.js";

export function buildApprovalPushBody(input: { approvalType: string; band: string; companyId: string; approvalId: string }) {
  return {
    title: `${input.band} risk approval`,
    body: `${input.approvalType} — tap to review`,
    url: `/approvals/${input.approvalId}`,
    tag: `approval-${input.approvalId}`,
    band: input.band,
    approvalId: input.approvalId,
  };
}

export function createWebPushChannel(db: Db): DeliveryChannel {
  const vapid = pushVapidService(db);
  return {
    name: "webpush",
    async deliver(target, payload) {
      if (!target.companyId || !payload.push) return;
      const init = await vapid.ensureInitialised();
      if (!init) return; // push disabled

      const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.companyId, target.companyId));
      const prefRows = await db
        .select()
        .from(pushDeliveryPrefs)
        .where(eq(pushDeliveryPrefs.companyId, target.companyId));
      const prefsByUser = new Map(
        prefRows.map((r) => [
          r.userId,
          { minBand: r.minBand as RiskBand, quietStart: r.quietStart, quietEnd: r.quietEnd, timezone: r.timezone },
        ]),
      );
      const band = (payload.push.band as RiskBand | undefined) ?? "high";
      const now = new Date();
      const body = JSON.stringify(payload.push);
      for (const sub of subs) {
        if (!shouldPushToUser({ prefs: prefsByUser.get(sub.userId) ?? null, band, now })) continue;
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.id, sub.id))
              .catch((delErr) =>
                logger.warn({ err: delErr, subscriptionId: sub.id }, "failed to prune dead push subscription"),
              );
          } else {
            logger.warn({ err, subscriptionId: sub.id }, "web push send failed");
          }
        }
        await db
          .update(pushSubscriptions)
          .set({ lastUsedAt: new Date() })
          .where(eq(pushSubscriptions.id, sub.id))
          .catch((err) => logger.warn({ err, subscriptionId: sub.id }, "failed to bump push subscription lastUsedAt"));
      }
    },
  };
}
// [END: module]
