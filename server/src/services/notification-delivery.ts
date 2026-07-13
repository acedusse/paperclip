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
export type DeliveryTarget = { userId?: string; companyId: string };
export type NotificationPayload = {
  kind: string;
  title: string;
  body?: string;
  link?: string;
  risk?: { band: string; score: number };
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

// Phase 1: inbox channel is a no-op seam — the inbox/sidebar-badge signal already reflects
// pending approvals. webpush/email register here in Phase 3.
registerChannel({
  name: "inbox",
  async deliver() {
    // existing inbox signal already covers this
  },
});
// [END: module]
