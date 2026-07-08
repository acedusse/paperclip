/**
 * FILE: server/src/routes/issues-checkout-wakeup.ts
 * ABOUT: issues-checkout-wakeup.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - issues-checkout-wakeup.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: issues-checkout-wakeup.ts (routes module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/routes/issues-checkout-wakeup.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
type CheckoutWakeInput = {
  actorType: "board" | "agent" | "none";
  actorAgentId: string | null;
  checkoutAgentId: string;
  checkoutRunId: string | null;
};

export function shouldWakeAssigneeOnCheckout(input: CheckoutWakeInput): boolean {
  if (input.actorType !== "agent") return true;
  if (!input.actorAgentId) return true;
  if (input.actorAgentId !== input.checkoutAgentId) return true;
  if (!input.checkoutRunId) return true;
  return false;
}
// [END: module]
