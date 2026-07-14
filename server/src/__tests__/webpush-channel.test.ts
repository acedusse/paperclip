/**
 * FILE: server/src/__tests__/webpush-channel.test.ts
 * ABOUT: webpush-channel.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - DB-backed webpush delivery channel tests (mocked web-push).
 */
// ==========================================
// [META: module]
// INTENT: Verify createWebPushChannel no-ops without a companyId/push payload, sends to every subscription for the
//   company, bumps last_used_at on success, and prunes subscriptions whose send fails with a 404/410 statusCode.
// PSEUDOCODE: 1. Mock web-push. 2. Seed a company + two subscriptions. 3. deliver() without push -> no send.
//   4. deliver() with push -> one send per subscription, last_used_at bumped. 5. A 410 rejection prunes that row.
// JSON_FLOW: {"file": "server/src/__tests__/webpush-channel.test.ts", "imports": "see code", "exports": "see code"}
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

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { companies, createDb, pushSubscriptions } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { createWebPushChannel } from "../services/push-notifications.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping webpush channel tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("createWebPushChannel", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("webpush-channel");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);

    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Acme",
      issuePrefix: `T${companyId.slice(0, 7)}`.toUpperCase(),
      status: "active",
    });

    await db.insert(pushSubscriptions).values([
      {
        companyId,
        userId: "user-1",
        endpoint: "https://push.example.com/sub-1",
        p256dh: "p256dh-1",
        auth: "auth-1",
      },
      {
        companyId,
        userId: "user-2",
        endpoint: "https://push.example.com/sub-2",
        p256dh: "p256dh-2",
        auth: "auth-2",
      },
    ]);
  }, 30_000);

  afterAll(async () => {
    await stopDb?.();
  });

  it("no-ops without a companyId or a push payload", async () => {
    const channel = createWebPushChannel(db);
    (webpush as any).sendNotification.mockClear();

    await channel.deliver({ companyId: "" } as any, { kind: "k", title: "t" });
    await channel.deliver({ companyId }, { kind: "k", title: "t" });

    expect((webpush as any).sendNotification).not.toHaveBeenCalled();
  });

  it("sends one push per subscription and bumps last_used_at on success", async () => {
    const channel = createWebPushChannel(db);
    (webpush as any).sendNotification.mockClear();

    await channel.deliver(
      { companyId },
      { kind: "k", title: "t", push: { title: "T", body: "B", url: "/u", tag: "x", band: "high" } },
    );

    expect((webpush as any).sendNotification).toHaveBeenCalledTimes(2);

    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.companyId, companyId));
    expect(subs).toHaveLength(2);
    for (const sub of subs) {
      expect(sub.lastUsedAt).not.toBeNull();
    }
  });

  it("prunes a subscription whose send fails with a 404/410 statusCode", async () => {
    const channel = createWebPushChannel(db);
    (webpush as any).sendNotification.mockClear();
    (webpush as any).sendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));

    await channel.deliver(
      { companyId },
      { kind: "k", title: "t", push: { title: "T", body: "B", url: "/u", tag: "x", band: "high" } },
    );

    expect((webpush as any).sendNotification).toHaveBeenCalledTimes(2);

    const remaining = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.companyId, companyId));
    expect(remaining).toHaveLength(1);
  });
});
// [END: module]
