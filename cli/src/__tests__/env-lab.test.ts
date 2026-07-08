/**
 * FILE: cli/src/__tests__/env-lab.test.ts
 * ABOUT: env-lab.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - env-lab.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: env-lab.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/__tests__/env-lab.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectEnvLabDoctorStatus, resolveEnvLabSshStatePath } from "../commands/env-lab.js";

describe("env-lab command", () => {
  it("resolves the default SSH fixture state path under the instance root", () => {
    const statePath = resolveEnvLabSshStatePath("fixture-test");

    expect(statePath).toContain(
      path.join("instances", "fixture-test", "env-lab", "ssh-fixture", "state.json"),
    );
  });

  it("reports doctor status for an instance without a running fixture", async () => {
    const status = await collectEnvLabDoctorStatus({ instance: "fixture-test-missing" });

    expect(status.statePath).toContain(
      path.join("instances", "fixture-test-missing", "env-lab", "ssh-fixture", "state.json"),
    );
    expect(typeof status.ssh.supported).toBe("boolean");
    expect(status.ssh.running).toBe(false);
    expect(status.ssh.environment).toBeNull();
  });
});
// [END: module]
