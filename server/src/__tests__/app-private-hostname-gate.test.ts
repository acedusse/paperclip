/**
 * FILE: server/src/__tests__/app-private-hostname-gate.test.ts
 * ABOUT: app-private-hostname-gate.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - app-private-hostname-gate.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: app-private-hostname-gate.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/app-private-hostname-gate.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { shouldEnablePrivateHostnameGuard } from "../app.ts";

describe("shouldEnablePrivateHostnameGuard", () => {
  it("enables the hostname guard for local_trusted private deployments", () => {
    expect(shouldEnablePrivateHostnameGuard({
      deploymentMode: "local_trusted",
      deploymentExposure: "private",
    })).toBe(true);
  });

  it("does not enable the hostname guard for local_trusted public deployments", () => {
    expect(shouldEnablePrivateHostnameGuard({
      deploymentMode: "local_trusted",
      deploymentExposure: "public",
    })).toBe(false);
  });

  it("enables the hostname guard for authenticated private deployments", () => {
    expect(shouldEnablePrivateHostnameGuard({
      deploymentMode: "authenticated",
      deploymentExposure: "private",
    })).toBe(true);
  });

  it("does not enable the hostname guard for authenticated public deployments", () => {
    expect(shouldEnablePrivateHostnameGuard({
      deploymentMode: "authenticated",
      deploymentExposure: "public",
    })).toBe(false);
  });
});
// [END: module]
