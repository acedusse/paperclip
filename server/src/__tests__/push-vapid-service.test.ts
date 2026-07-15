/**
 * FILE: server/src/__tests__/push-vapid-service.test.ts
 * ABOUT: push-vapid-service.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - DB-backed VAPID key service tests.
 */
// ==========================================
// [META: module]
// INTENT: Verify pushVapidService auto-generates + persists a singleton VAPID keypair and initialises web-push once.
// PSEUDOCODE: 1. Mock web-push. 2. getKeys() generates+persists on first call, reads on second. 3. ensureInitialised() calls setVapidDetails.
// JSON_FLOW: {"file": "server/src/__tests__/push-vapid-service.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { vi } from "vitest";

vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: vi.fn(() => ({ publicKey: "PUB", privateKey: "PRIV" })),
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(() => Promise.resolve({})),
  },
}));

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import webpush from "web-push";
import { createDb, pushVapidKeys } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { pushVapidService } from "../services/push-vapid.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping push vapid service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("pushVapidService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("push-vapid-service");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 30_000);

  afterAll(async () => {
    await stopDb?.();
  });

  it("auto-generates and persists the singleton VAPID keypair, then initialises web-push", async () => {
    const svc = pushVapidService(db);

    const a = await svc.getKeys();
    expect(a.publicKey).toBe("PUB");
    expect((webpush as any).generateVAPIDKeys).toHaveBeenCalledTimes(1);

    // second call reads the persisted row, does NOT regenerate
    const b = await svc.getKeys();
    expect(b.publicKey).toBe("PUB");
    expect((webpush as any).generateVAPIDKeys).toHaveBeenCalledTimes(1);

    // exactly one row persisted
    const rows = await db.select().from(pushVapidKeys);
    expect(rows).toHaveLength(1);

    // ensureInitialised calls setVapidDetails and returns the public key
    const init = await svc.ensureInitialised();
    expect(init?.publicKey).toBe("PUB");
    expect((webpush as any).setVapidDetails).toHaveBeenCalled();
  });
});
// [END: module]
