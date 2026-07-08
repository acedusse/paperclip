/**
 * FILE: server/src/__tests__/app-hmr-port.test.ts
 * ABOUT: app-hmr-port.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - app-hmr-port.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: app-hmr-port.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/app-hmr-port.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { resolveViteHmrHost, resolveViteHmrPort } from "../app.ts";

describe("resolveViteHmrPort", () => {
  it("uses serverPort + 10000 when the result stays in range", () => {
    expect(resolveViteHmrPort(3100)).toBe(13_100);
    expect(resolveViteHmrPort(55_535)).toBe(65_535);
  });

  it("falls back below the server port when adding 10000 would overflow", () => {
    expect(resolveViteHmrPort(55_536)).toBe(45_536);
    expect(resolveViteHmrPort(63_000)).toBe(53_000);
  });

  it("never returns a privileged or invalid port", () => {
    expect(resolveViteHmrPort(65_535)).toBe(55_535);
    expect(resolveViteHmrPort(9_000)).toBe(19_000);
  });
});

describe("resolveViteHmrHost", () => {
  it("omits wildcard bind hosts so Vite uses the browser hostname", () => {
    expect(resolveViteHmrHost("0.0.0.0")).toBeUndefined();
    expect(resolveViteHmrHost("::")).toBeUndefined();
  });

  it("keeps concrete bind hosts", () => {
    expect(resolveViteHmrHost("127.0.0.1")).toBe("127.0.0.1");
    expect(resolveViteHmrHost("paperclip-dev")).toBe("paperclip-dev");
  });
});
// [END: module]
