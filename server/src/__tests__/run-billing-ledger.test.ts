/**
 * FILE: server/src/__tests__/run-billing-ledger.test.ts
 * ABOUT: run-billing-ledger.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - run-billing-ledger.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: run-billing-ledger.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/run-billing-ledger.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  normalizeBilledCostCents,
  normalizeLedgerBillingType,
  resolveLedgerBiller,
} from "../services/run-billing-ledger.js";

function result(fields: Partial<AdapterExecutionResult>): AdapterExecutionResult {
  return { exitCode: 0, signal: null, timedOut: false, ...fields };
}

describe("resolveLedgerBiller", () => {
  it("prefers the reported biller", () => {
    expect(resolveLedgerBiller(result({ biller: "local", provider: "openai" }))).toBe("local");
  });

  it("falls back to the provider when no biller is reported", () => {
    expect(resolveLedgerBiller(result({ biller: null, provider: "anthropic" }))).toBe("anthropic");
    expect(resolveLedgerBiller(result({ biller: "  ", provider: "anthropic" }))).toBe("anthropic");
  });

  it("labels a run with neither as unknown rather than empty", () => {
    expect(resolveLedgerBiller(result({}))).toBe("unknown");
    expect(resolveLedgerBiller(result({ biller: "", provider: "" }))).toBe("unknown");
  });
});

describe("normalizeLedgerBillingType", () => {
  it("passes local through instead of degrading it to unknown", () => {
    // Without an explicit case this hits `default:` and the whole local-billing
    // phase silently reverts at the ledger boundary.
    expect(normalizeLedgerBillingType("local")).toBe("local");
  });

  it("preserves the pre-existing mappings", () => {
    expect(normalizeLedgerBillingType("api")).toBe("metered_api");
    expect(normalizeLedgerBillingType("metered_api")).toBe("metered_api");
    expect(normalizeLedgerBillingType("subscription")).toBe("subscription_included");
    expect(normalizeLedgerBillingType("subscription_included")).toBe("subscription_included");
    expect(normalizeLedgerBillingType("subscription_overage")).toBe("subscription_overage");
    expect(normalizeLedgerBillingType("credits")).toBe("credits");
    expect(normalizeLedgerBillingType("fixed")).toBe("fixed");
  });

  it("degrades unrecognised input to unknown without throwing", () => {
    for (const value of ["nonsense", "", "   ", null, undefined, 42, {}, []]) {
      expect(normalizeLedgerBillingType(value)).toBe("unknown");
    }
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeLedgerBillingType("  local  ")).toBe("local");
  });
});

describe("normalizeBilledCostCents", () => {
  it("bills zero for local inference even when a cost is reported", () => {
    // The CLIs behind the OpenAI-compatible adapters price from their own tables and
    // do not know the endpoint was a local model server.
    expect(normalizeBilledCostCents(4.21, "local")).toBe(0);
    expect(normalizeBilledCostCents(0, "local")).toBe(0);
    expect(normalizeBilledCostCents(null, "local")).toBe(0);
  });

  it("bills zero for subscription-included usage", () => {
    expect(normalizeBilledCostCents(9.99, "subscription_included")).toBe(0);
  });

  it("converts dollars to cents for metered usage", () => {
    expect(normalizeBilledCostCents(1.23, "metered_api")).toBe(123);
    expect(normalizeBilledCostCents(0.005, "metered_api")).toBe(1);
    expect(normalizeBilledCostCents(0.001, "metered_api")).toBe(0);
  });

  it("floors negative and non-finite costs at zero", () => {
    expect(normalizeBilledCostCents(-5, "metered_api")).toBe(0);
    expect(normalizeBilledCostCents(Number.NaN, "metered_api")).toBe(0);
    expect(normalizeBilledCostCents(Number.POSITIVE_INFINITY, "metered_api")).toBe(0);
    expect(normalizeBilledCostCents(undefined, "metered_api")).toBe(0);
  });
});
// [END: module]
