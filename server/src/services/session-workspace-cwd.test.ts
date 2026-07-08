/**
 * FILE: server/src/services/session-workspace-cwd.test.ts
 * ABOUT: session-workspace-cwd.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - session-workspace-cwd.test.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: session-workspace-cwd.test.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/session-workspace-cwd.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";

import { isUnsafeSessionWorkspaceCwd } from "./session-workspace-cwd.js";

describe("isUnsafeSessionWorkspaceCwd", () => {
  it("rejects system roots that can poison remote sandbox session resumes", () => {
    expect(isUnsafeSessionWorkspaceCwd("/")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/tmp")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/tmp/")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/private/tmp")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/var/tmp")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/var/run")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/proc")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/sys")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/dev")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/run")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/tmp/.")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/tmp/..")).toBe(true);
    expect(isUnsafeSessionWorkspaceCwd("/var/./run")).toBe(true);
  });

  it("allows concrete workspace descendants", () => {
    expect(isUnsafeSessionWorkspaceCwd("/tmp/paperclip-workspace")).toBe(false);
    expect(isUnsafeSessionWorkspaceCwd("/Users/dotta/paperclip")).toBe(false);
    expect(isUnsafeSessionWorkspaceCwd(null)).toBe(false);
  });
});
// [END: module]
