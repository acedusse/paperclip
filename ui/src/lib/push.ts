/**
 * FILE: ui/src/lib/push.ts
 * ABOUT: push.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - push.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: push.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/push.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pushApi } from "../api/push";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof Notification !== "undefined";
}

export async function subscribeToPush(companyId: string): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  const { publicKey } = await pushApi.vapidPublicKey();
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = sub.toJSON();
  await pushApi.subscribe(companyId, {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
    userAgent: navigator.userAgent,
  });
  return true;
}

export async function unsubscribeFromPush(companyId: string): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await pushApi.unsubscribe(companyId, sub.endpoint);
    // NOTE: intentionally NOT calling sub.unsubscribe() — the browser endpoint is shared
    // across companies; revoking it would kill push for every other company on this browser.
  }
}
// [END: module]
