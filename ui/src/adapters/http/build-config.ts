/**
 * FILE: ui/src/adapters/http/build-config.ts
 * ABOUT: build-config.ts (http module).
 *
 * SECTIONS:
 *   [TAG: module] - build-config.ts (http module).
 */
// ==========================================
// [META: module]
// INTENT: build-config.ts (http module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/http/build-config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { CreateConfigValues } from "../../components/AgentConfigForm";

export function buildHttpConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.url) ac.url = v.url;
  ac.method = "POST";
  ac.timeoutMs = 15000;
  return ac;
}
// [END: module]
