/**
 * FILE: scripts/dev-service-profile.ts
 * ABOUT: dev-service-profile.ts (scripts module).
 *
 * SECTIONS:
 *   [TAG: module] - dev-service-profile.ts (scripts module).
 */
// ==========================================
// [META: module]
// INTENT: dev-service-profile.ts (scripts module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "scripts/dev-service-profile.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalServiceKey } from "../server/src/services/local-service-supervisor.ts";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createDevServiceIdentity(input: {
  mode: "watch" | "dev";
  forwardedArgs: string[];
  networkProfile: string;
  port: number;
}) {
  const envFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        mode: input.mode,
        forwardedArgs: input.forwardedArgs,
        networkProfile: input.networkProfile,
        port: input.port,
      }),
    )
    .digest("hex");

  const serviceName = input.mode === "watch" ? "paperclip-dev-watch" : "paperclip-dev-once";
  const serviceKey = createLocalServiceKey({
    profileKind: "paperclip-dev",
    serviceName,
    cwd: repoRoot,
    command: "dev-runner.ts",
    envFingerprint,
    port: input.port,
    scope: {
      repoRoot,
      mode: input.mode,
    },
  });

  return {
    serviceKey,
    serviceName,
    envFingerprint,
  };
}
// [END: module]
