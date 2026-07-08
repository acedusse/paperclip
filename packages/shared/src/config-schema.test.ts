/**
 * FILE: packages/shared/src/config-schema.test.ts
 * ABOUT: config-schema.test.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - config-schema.test.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: config-schema.test.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/config-schema.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { paperclipConfigSchema } from "./config-schema.js";

describe("paperclip config schema", () => {
  it("defaults omitted runtime paths to legacy instance-root locations", () => {
    const parsed = paperclipConfigSchema.parse({
      $meta: {
        version: 1,
        updatedAt: "2026-05-10T00:00:00.000Z",
        source: "configure",
      },
      database: {
        mode: "embedded-postgres",
      },
      logging: {
        mode: "file",
      },
      server: {},
    });

    expect(parsed.database.embeddedPostgresDataDir).toBe("~/.paperclip/instances/default/db");
    expect(parsed.database.backup.dir).toBe("~/.paperclip/instances/default/data/backups");
    expect(parsed.logging.logDir).toBe("~/.paperclip/instances/default/logs");
    expect(parsed.storage.localDisk.baseDir).toBe("~/.paperclip/instances/default/data/storage");
    expect(parsed.secrets.localEncrypted.keyFilePath).toBe("~/.paperclip/instances/default/secrets/master.key");
  });
});
// [END: module]
