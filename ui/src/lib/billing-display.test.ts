/**
 * FILE: ui/src/lib/billing-display.test.ts
 * ABOUT: billing-display.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - billing-display.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: billing-display.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/billing-display.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { BILLING_TYPES } from "@paperclipai/shared";
import { billingTypeDisplayName, visibleRunCostUsd } from "./utils";

describe("billingTypeDisplayName", () => {
  it("labels local inference", () => {
    expect(billingTypeDisplayName("local")).toBe("Local");
  });

  it("has a non-empty label for every billing type", () => {
    // The map is a Record<BillingType, string>, so a missing entry is a type error —
    // this guards the other direction, an entry present but blank.
    for (const billingType of BILLING_TYPES) {
      expect(billingTypeDisplayName(billingType).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("visibleRunCostUsd", () => {
  it("shows no cost for local inference runs", () => {
    // The CLIs behind the OpenAI-compatible adapters price from their own tables and do
    // not know the endpoint was a local model server, so a non-zero cost can be reported.
    expect(visibleRunCostUsd({ billingType: "local", costUsd: 3.5 })).toBe(0);
  });

  it("shows no cost for subscription-included runs", () => {
    expect(visibleRunCostUsd({ billingType: "subscription_included", costUsd: 3.5 })).toBe(0);
  });

  it("shows the reported cost for metered runs", () => {
    expect(visibleRunCostUsd({ billingType: "metered_api", costUsd: 3.5 })).toBe(3.5);
  });

  it("reads the billing type from the result when usage omits it", () => {
    expect(visibleRunCostUsd({ costUsd: 3.5 }, { billingType: "local" })).toBe(0);
  });

  it("falls back to the reported cost when the billing type is unrecognised", () => {
    expect(visibleRunCostUsd({ billingType: "nonsense", costUsd: 2 })).toBe(2);
  });

  it("returns zero when there is nothing to read", () => {
    expect(visibleRunCostUsd(null)).toBe(0);
    expect(visibleRunCostUsd(null, null)).toBe(0);
  });
});
// [END: module]
