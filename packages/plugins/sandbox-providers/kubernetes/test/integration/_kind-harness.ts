/**
 * FILE: packages/plugins/sandbox-providers/kubernetes/test/integration/_kind-harness.ts
 * ABOUT: _kind-harness.ts (integration module).
 *
 * SECTIONS:
 *   [TAG: module] - _kind-harness.ts (integration module).
 */
// ==========================================
// [META: module]
// INTENT: _kind-harness.ts (integration module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/kubernetes/test/integration/_kind-harness.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const KIND_CONTEXT = "kind-paperclip";

export function readKindKubeconfig(): string {
  return readFileSync(join(homedir(), ".kube", "config"), "utf-8");
}

export function kubectl(args: string): string {
  return execSync(`kubectl --context ${KIND_CONTEXT} ${args}`, { encoding: "utf-8" });
}

export function deleteNamespaceIfExists(namespace: string): void {
  try {
    kubectl(`delete namespace ${namespace} --wait=true --timeout=60s --ignore-not-found`);
  } catch {
    // ignore
  }
}
// [END: module]
