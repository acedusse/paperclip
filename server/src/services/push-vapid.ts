/**
 * FILE: server/src/services/push-vapid.ts
 * ABOUT: push-vapid.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - VAPID keypair service: auto-generate + persist singleton, init web-push once per process.
 */
// ==========================================
// [META: module]
// INTENT: Provide the instance-level VAPID keypair for web push, generating and persisting it on first use.
// PSEUDOCODE: 1. getKeys() reads singleton row or generates+inserts (race-safe). 2. ensureInitialised() calls webpush.setVapidDetails once per process.
// JSON_FLOW: {"file": "server/src/services/push-vapid.ts", "imports": "web-push, @paperclipai/db", "exports": "pushVapidService"}
// ==========================================
// [START: module]
import { eq } from "drizzle-orm";
import webpush from "web-push";
import type { Db } from "@paperclipai/db";
import { pushVapidKeys } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const DEFAULT_SUBJECT = "mailto:push@paperclip.local";
let vapidInitialised = false; // setVapidDetails is process-global; call once

export function pushVapidService(db: Db) {
  async function getKeys(): Promise<{ publicKey: string; privateKey: string; subject: string }> {
    const existing = await db
      .select()
      .from(pushVapidKeys)
      .where(eq(pushVapidKeys.singleton, "default"))
      .then((r) => r[0] ?? null);
    if (existing) return { publicKey: existing.publicKey, privateKey: existing.privateKey, subject: existing.subject };
    const generated = webpush.generateVAPIDKeys();
    const [inserted] = await db
      .insert(pushVapidKeys)
      .values({ singleton: "default", publicKey: generated.publicKey, privateKey: generated.privateKey, subject: DEFAULT_SUBJECT })
      .onConflictDoNothing({ target: pushVapidKeys.singleton })
      .returning();
    if (inserted) return { publicKey: inserted.publicKey, privateKey: inserted.privateKey, subject: inserted.subject };
    // lost a race — read the winner
    const winner = await db.select().from(pushVapidKeys).where(eq(pushVapidKeys.singleton, "default")).then((r) => r[0]!);
    return { publicKey: winner.publicKey, privateKey: winner.privateKey, subject: winner.subject };
  }

  return {
    getKeys,
    async ensureInitialised(): Promise<{ publicKey: string } | null> {
      try {
        const keys = await getKeys();
        if (!vapidInitialised) {
          webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
          vapidInitialised = true;
        }
        return { publicKey: keys.publicKey };
      } catch (err) {
        logger.warn({ err }, "VAPID init failed; push disabled");
        return null;
      }
    },
  };
}
// [END: module]
