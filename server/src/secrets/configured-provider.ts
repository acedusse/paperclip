/**
 * FILE: server/src/secrets/configured-provider.ts
 * ABOUT: configured-provider.ts (secrets module).
 *
 * SECTIONS:
 *   [TAG: module] - configured-provider.ts (secrets module).
 */
// ==========================================
// [META: module]
// INTENT: configured-provider.ts (secrets module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/secrets/configured-provider.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { SECRET_PROVIDERS, type SecretProvider } from "@paperclipai/shared";

export function getConfiguredSecretProvider(): SecretProvider {
  const configuredProvider = process.env.PAPERCLIP_SECRETS_PROVIDER;
  return configuredProvider && SECRET_PROVIDERS.includes(configuredProvider as SecretProvider)
    ? configuredProvider as SecretProvider
    : "local_encrypted";
}
// [END: module]
