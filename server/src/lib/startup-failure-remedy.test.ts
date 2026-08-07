/**
 * FILE: server/src/lib/startup-failure-remedy.test.ts
 * ABOUT: startup-failure-remedy.test.ts (server lib module).
 *
 * SECTIONS:
 *   [TAG: module] - startup-failure-remedy.test.ts (server lib module).
 */
// ==========================================
// [META: module]
// INTENT: Cover the operator-facing remedy text for fatal startup failures.
// PSEUDOCODE: 1. Build failure errors. 2. Assert remedy content.
// JSON_FLOW: {"file": "server/src/lib/startup-failure-remedy.test.ts", "imports": "startup-failure-remedy.ts", "exports": "tests"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { describeStartupFailureRemedy } from "./startup-failure-remedy.js";

function addressInUse(port: number): Error {
  return Object.assign(new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${port}`), {
    code: "EADDRINUSE",
    port,
  });
}

describe("describeStartupFailureRemedy", () => {
  it("tells the operator how to clear a port that is already in use", () => {
    const remedy = describeStartupFailureRemedy(addressInUse(3100));

    expect(remedy).toContain("3100");
    expect(remedy).toContain("./stop.sh --all");
  });

  it("surfaces the message when every candidate port was lost", () => {
    const remedy = describeStartupFailureRemedy(
      new Error("could not bind 127.0.0.1:3100 after 10 attempts — run ./stop.sh --all to clear them"),
    );

    expect(remedy).toContain("./stop.sh --all");
  });

  it("returns null for failures a port remedy would not fix", () => {
    expect(describeStartupFailureRemedy(new Error("migration 0042 failed"))).toBeNull();
  });

  it("returns null for non-error values", () => {
    expect(describeStartupFailureRemedy(undefined)).toBeNull();
  });
});
// [END: module]
