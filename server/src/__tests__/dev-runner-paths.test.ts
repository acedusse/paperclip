/**
 * FILE: server/src/__tests__/dev-runner-paths.test.ts
 * ABOUT: dev-runner-paths.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - dev-runner-paths.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: dev-runner-paths.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/dev-runner-paths.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { shouldTrackDevServerPath } from "../../../scripts/dev-runner-paths.mjs";

describe("shouldTrackDevServerPath", () => {
  it("ignores generated state, diagnostic reports, and common test file paths", () => {
    expect(
      shouldTrackDevServerPath(
        ".paperclip/worktrees/PAP-712-for-project-configuration-get-rid-of-the-overview-tab-for-now/.agents/skills/paperclip",
      ),
    ).toBe(false);
    expect(shouldTrackDevServerPath("server/report.20260416.154629.4965.0.001.json")).toBe(false);
    expect(shouldTrackDevServerPath("server/report.20260416.154636.4725.0.001.json")).toBe(false);
    expect(shouldTrackDevServerPath("server/report.20260416.154636.4965.0.002.json")).toBe(false);
    expect(shouldTrackDevServerPath("server/src/__tests__/health.test.ts")).toBe(false);
    expect(shouldTrackDevServerPath("packages/shared/src/lib/foo.test.ts")).toBe(false);
    expect(shouldTrackDevServerPath("packages/shared/src/lib/foo.spec.tsx")).toBe(false);
    expect(shouldTrackDevServerPath("packages/shared/_tests/helpers.ts")).toBe(false);
    expect(shouldTrackDevServerPath("packages/shared/tests/helpers.ts")).toBe(false);
    expect(shouldTrackDevServerPath("packages/shared/test/helpers.ts")).toBe(false);
    expect(shouldTrackDevServerPath("vitest.config.ts")).toBe(false);
  });

  it("keeps runtime paths restart-relevant", () => {
    expect(shouldTrackDevServerPath("server/src/routes/health.ts")).toBe(true);
    expect(shouldTrackDevServerPath("packages/shared/src/index.ts")).toBe(true);
    expect(shouldTrackDevServerPath("server/src/testing/runtime.ts")).toBe(true);
  });
});
// [END: module]
