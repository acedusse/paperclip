/**
 * FILE: server/src/services/notification-delivery.ts
 * ABOUT: notification-delivery.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - notification-delivery.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: notification-delivery.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/notification-delivery.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { Db } from "@paperclipai/db";
import { digests } from "@paperclipai/db";
import type { DigestPayload } from "./digest-narration.js";
import { logger } from "../middleware/logger.js";

export type DeliveryTarget = { userId?: string; companyId: string };
export type NotificationPayload = {
  kind: string;
  title: string;
  body?: string;
  link?: string;
  risk?: { band: string; score: number };
  digest?: { payload: DigestPayload; periodStart: Date | null; periodEnd: Date };
  push?: { title: string; body: string; url: string; tag?: string; band?: string; approvalId?: string };
};
export type DeliveryChannel = {
  name: "inbox" | "webpush" | "email";
  deliver(target: DeliveryTarget, payload: NotificationPayload): Promise<void>;
};

const channels = new Map<string, DeliveryChannel>();

/** Register (or replace) a delivery channel by name. */
export function registerChannel(channel: DeliveryChannel): void {
  channels.set(channel.name, channel);
}

/** All currently registered delivery channels. */
export function getChannels(): DeliveryChannel[] {
  return [...channels.values()];
}

/** Phase 2b: the inbox channel persists a digest row. Registered at app startup with a db handle. */
export function createInboxDigestChannel(db: Db): DeliveryChannel {
  return {
    name: "inbox",
    async deliver(target, payload) {
      if (!payload.digest) return; // only digest payloads land in the digests table
      await db.insert(digests).values({
        companyId: target.companyId,
        periodStart: payload.digest.periodStart,
        periodEnd: payload.digest.periodEnd,
        payload: payload.digest.payload as unknown as Record<string, unknown>,
        generatedAt: payload.digest.periodEnd,
      });
    },
  };
}

/** Fan a notification out through every registered channel; one channel's throw never aborts the rest. */
export async function deliverThroughChannels(target: DeliveryTarget, payload: NotificationPayload): Promise<void> {
  for (const channel of getChannels()) {
    try {
      await channel.deliver(target, payload);
    } catch (err) {
      logger.warn({ err, channel: channel.name, companyId: target.companyId }, "delivery channel failed");
    }
  }
}
// [END: module]
