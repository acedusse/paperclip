/**
 * FILE: server/src/services/run-billing-ledger.ts
 * ABOUT: run-billing-ledger.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - run-billing-ledger.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: run-billing-ledger.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/run-billing-ledger.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";
import type { BillingType } from "@paperclipai/shared";

/**
 * The boundary where an adapter's self-reported billing shape becomes a ledger row.
 *
 * Extracted from heartbeat.ts so the mapping is testable in isolation: it is the last
 * place a mislabelled run can be caught before it reaches cost_events and, from there,
 * the by-biller and finance-by-biller reports.
 */

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Who gets charged for a run. Falls back to the provider when an adapter reports no
 * distinct biller, and to "unknown" rather than an empty string so the by-biller
 * grouping always has a label.
 */
export function resolveLedgerBiller(result: AdapterExecutionResult): string {
  return readNonEmptyString(result.biller) ?? readNonEmptyString(result.provider) ?? "unknown";
}

/**
 * Maps an adapter's AdapterBillingType onto the ledger's BillingType.
 *
 * Unrecognised values deliberately degrade to "unknown" rather than throwing — an
 * adapter (including a third-party plugin) must not be able to fail a run by reporting
 * a billing type this server has never heard of.
 */
export function normalizeLedgerBillingType(value: unknown): BillingType {
  const raw = readNonEmptyString(value);
  switch (raw) {
    case "api":
    case "metered_api":
      return "metered_api";
    case "subscription":
    case "subscription_included":
      return "subscription_included";
    case "subscription_overage":
      return "subscription_overage";
    case "credits":
      return "credits";
    case "fixed":
      return "fixed";
    case "local":
      return "local";
    default:
      return "unknown";
  }
}

/**
 * Converts a reported dollar cost into billed cents.
 *
 * Two billing types are structurally free and are forced to zero regardless of what the
 * adapter reported: subscription-included usage (already paid for), and local inference
 * (runs on the operator's own hardware). The local guard matters because the CLIs behind
 * the OpenAI-compatible adapters price usage from their own built-in tables, which do not
 * know the endpoint was a local model server and will happily report a non-zero cost.
 */
export function normalizeBilledCostCents(
  costUsd: number | null | undefined,
  billingType: BillingType,
): number {
  if (billingType === "subscription_included") return 0;
  if (billingType === "local") return 0;
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd)) return 0;
  return Math.max(0, Math.round(costUsd * 100));
}
// [END: module]
