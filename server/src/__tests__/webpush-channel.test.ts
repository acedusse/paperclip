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
import { companies, createDb, pushDeliveryPrefs, pushSubscriptions } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { buildApprovalPushBody, createWebPushChannel } from "../services/push-notifications.js";

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

  it("still resolves deliver() when pruning a dead subscription itself fails (db.delete rejects)", async () => {
    // Reseed: the previous test already pruned one subscription down to a single remaining row.
    // Add a second subscription so this test has two independent sends again, one of which will 410.
    await db.insert(pushSubscriptions).values({
      companyId,
      userId: "user-3",
      endpoint: "https://push.example.com/sub-3",
      p256dh: "p256dh-3",
      auth: "auth-3",
    });

    const channel = createWebPushChannel(db);
    (webpush as any).sendNotification.mockClear();
    (webpush as any).sendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));

    // Force the prune delete to reject once (simulating a transient DB error while pruning),
    // without touching the delete used for any other purpose.
    const originalDelete = db.delete.bind(db);
    const deleteSpy = vi.spyOn(db, "delete").mockImplementationOnce(
      () =>
        ({
          where: () => Promise.reject(new Error("transient db error during prune")),
        }) as any,
    );

    try {
      // Pre-fix, the unguarded `await db.delete(...).where(...)` throws out of the catch block,
      // out of the for-loop, and out of deliver() itself — this assertion fails against that code.
      await expect(
        channel.deliver(
          { companyId },
          { kind: "k", title: "t", push: { title: "T", body: "B", url: "/u", tag: "x", band: "high" } },
        ),
      ).resolves.toBeUndefined();
    } finally {
      deleteSpy.mockRestore();
      void originalDelete;
    }

    expect((webpush as any).sendNotification).toHaveBeenCalledTimes(2);
  });

  it("sends a payload built by buildApprovalPushBody carrying approvalId and the /approvals url", async () => {
    // Seed an independent company + single subscription (the shared `companyId` from beforeAll has
    // accumulated subscriptions from earlier tests in this file), mirroring the fan-out test's pattern.
    const otherCompanyId = randomUUID();
    await db.insert(companies).values({
      id: otherCompanyId,
      name: "Acme Payload Co",
      issuePrefix: `T${otherCompanyId.slice(0, 7)}`.toUpperCase(),
      status: "active",
    });
    await db.insert(pushSubscriptions).values({
      companyId: otherCompanyId,
      userId: "user-payload",
      endpoint: "https://push.example.com/sub-payload",
      p256dh: "p256dh-payload",
      auth: "auth-payload",
    });

    const channel = createWebPushChannel(db);
    (webpush as any).sendNotification.mockClear();
    const push = buildApprovalPushBody({
      approvalType: "hire_agent",
      band: "critical",
      companyId: otherCompanyId,
      approvalId: "ap-xyz",
    });
    await channel.deliver({ companyId: otherCompanyId }, { kind: "approval_high_risk", title: "t", push });
    expect((webpush as any).sendNotification).toHaveBeenCalledTimes(1);
    const sentBody = (webpush as any).sendNotification.mock.calls[0][1] as string;
    const parsed = JSON.parse(sentBody);
    expect(parsed.approvalId).toBe("ap-xyz");
    expect(parsed.url).toBe("/approvals/ap-xyz");
  });

  it("suppresses a user whose prefs raise the floor to critical, still sends to others", async () => {
    // Isolated company + subs: the shared `companyId` fixture has already had user-1's
    // subscription pruned by the earlier 404/410 tests in this file, so reusing it here
    // would make the suppression assertion depend on prior-test ordering/state.
    const prefsCompanyId = randomUUID();
    await db.insert(companies).values({
      id: prefsCompanyId,
      name: "Acme Prefs Co",
      issuePrefix: `T${prefsCompanyId.slice(0, 7)}`.toUpperCase(),
      status: "active",
    });
    await db.insert(pushSubscriptions).values([
      {
        companyId: prefsCompanyId,
        userId: "user-1",
        endpoint: "https://push.example.com/sub-prefs-1",
        p256dh: "p256dh-prefs-1",
        auth: "auth-prefs-1",
      },
      {
        companyId: prefsCompanyId,
        userId: "user-2",
        endpoint: "https://push.example.com/sub-prefs-2",
        p256dh: "p256dh-prefs-2",
        auth: "auth-prefs-2",
      },
    ]);

    vi.mocked(webpush.sendNotification).mockClear();
    await db.insert(pushDeliveryPrefs).values({
      companyId: prefsCompanyId,
      userId: "user-1",
      minBand: "critical",
    });
    const channel = createWebPushChannel(db);
    await channel.deliver(
      { companyId: prefsCompanyId },
      {
        kind: "approval_high_risk",
        title: "t",
        push: buildApprovalPushBody({ approvalType: "x", band: "high", companyId: prefsCompanyId, approvalId: "a1" }),
      },
    );
    // user-1 suppressed (floor=critical, band=high); user-2 has no prefs → delivered
    expect(vi.mocked(webpush.sendNotification)).toHaveBeenCalledTimes(1);
    await db.delete(pushDeliveryPrefs).where(eq(pushDeliveryPrefs.companyId, prefsCompanyId));
  });
});
// [END: module]
