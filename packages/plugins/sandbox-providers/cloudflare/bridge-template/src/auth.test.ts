/**
 * FILE: packages/plugins/sandbox-providers/cloudflare/bridge-template/src/auth.test.ts
 * ABOUT: auth.test.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - auth.test.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: auth.test.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/cloudflare/bridge-template/src/auth.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { isAuthorizedRequest, readBearerToken } from "./auth.js";

describe("bridge auth", () => {
  it("extracts bearer tokens from Authorization headers", () => {
    const request = new Request("https://bridge.example.test", {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(readBearerToken(request)).toBe("secret-token");
  });

  it("rejects mismatched tokens", async () => {
    const request = new Request("https://bridge.example.test", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    await expect(isAuthorizedRequest(request, "expected-token")).resolves.toBe(false);
  });

  it("accepts matching tokens", async () => {
    const request = new Request("https://bridge.example.test", {
      headers: { Authorization: "Bearer expected-token" },
    });
    await expect(isAuthorizedRequest(request, "expected-token")).resolves.toBe(true);
  });

  it("rejects requests without an Authorization header", async () => {
    const request = new Request("https://bridge.example.test");
    await expect(isAuthorizedRequest(request, "expected-token")).resolves.toBe(false);
  });
});
// [END: module]
