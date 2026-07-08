/**
 * FILE: cli/src/config/schema.ts
 * ABOUT: schema.ts (config module).
 *
 * SECTIONS:
 *   [TAG: module] - schema.ts (config module).
 */
// ==========================================
// [META: module]
// INTENT: schema.ts (config module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/config/schema.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export {
  paperclipConfigSchema,
  configMetaSchema,
  llmConfigSchema,
  databaseBackupConfigSchema,
  databaseConfigSchema,
  loggingConfigSchema,
  serverConfigSchema,
  authConfigSchema,
  telemetryConfigSchema,
  storageConfigSchema,
  storageLocalDiskConfigSchema,
  storageS3ConfigSchema,
  secretsConfigSchema,
  secretsLocalEncryptedConfigSchema,
  type PaperclipConfig,
  type LlmConfig,
  type DatabaseBackupConfig,
  type DatabaseConfig,
  type LoggingConfig,
  type ServerConfig,
  type AuthConfig,
  type TelemetryConfig,
  type StorageConfig,
  type StorageLocalDiskConfig,
  type StorageS3Config,
  type SecretsConfig,
  type SecretsLocalEncryptedConfig,
  type ConfigMeta,
} from "../../../packages/shared/src/config-schema.js";
// [END: module]
