/**
 * FILE: server/src/storage/provider-registry.ts
 * ABOUT: provider-registry.ts (storage module).
 *
 * SECTIONS:
 *   [TAG: module] - provider-registry.ts (storage module).
 */
// ==========================================
// [META: module]
// INTENT: provider-registry.ts (storage module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/storage/provider-registry.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { Config } from "../config.js";
import type { StorageProvider } from "./types.js";
import { createLocalDiskStorageProvider } from "./local-disk-provider.js";
import { createS3StorageProvider } from "./s3-provider.js";

export function createStorageProviderFromConfig(config: Config): StorageProvider {
  if (config.storageProvider === "local_disk") {
    return createLocalDiskStorageProvider(config.storageLocalDiskBaseDir);
  }

  return createS3StorageProvider({
    bucket: config.storageS3Bucket,
    region: config.storageS3Region,
    endpoint: config.storageS3Endpoint,
    prefix: config.storageS3Prefix,
    forcePathStyle: config.storageS3ForcePathStyle,
  });
}
// [END: module]
