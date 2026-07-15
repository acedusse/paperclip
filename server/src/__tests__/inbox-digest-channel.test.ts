/**
 * FILE: server/src/__tests__/inbox-digest-channel.test.ts
 * ABOUT: inbox-digest-channel.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - DB-backed inbox digest delivery channel tests.
 */
// ==========================================
// [META: module]
// INTENT: Verify createInboxDigestChannel persists a digest row when payload.digest is
// present, and is a no-op (no throw, no row) when payload.digest is absent.
// PSEUDOCODE: 1. Seed company. 2. Deliver a digest payload, assert row persisted. 3. Deliver
// a non-digest payload, assert no additional row.
// JSON_FLOW: {"file": "server/src/__tests__/inbox-digest-channel.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, createDb, digests } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { createInboxDigestChannel } from "../services/notification-delivery.js";
import type { DigestPayload } from "../services/digest-narration.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping inbox digest channel tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("createInboxDigestChannel", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("inbox-digest-channel");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(digests);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedCompany(): Promise<string> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Acme",
      issuePrefix: `T${companyId.slice(0, 7)}`.toUpperCase(),
      status: "active",
    });
    return companyId;
  }

  it("persists a digest row when payload.digest is present, and no-ops otherwise", async () => {
    const companyId = await seedCompany();
    const samplePayload: DigestPayload = {
      headline: "3 approvals need you",
      sections: [],
      text: "3 approvals need you",
      signals: {} as DigestPayload["signals"],
    };

    const channel = createInboxDigestChannel(db);
    const periodEnd = new Date();
    await channel.deliver(
      { companyId },
      { kind: "digest", title: "3 approvals need you", digest: { payload: samplePayload, periodStart: null, periodEnd } },
    );

    const rows = await db.select().from(digests).where(eq(digests.companyId, companyId));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as any).headline).toBe("3 approvals need you");
    expect(rows[0]!.generatedAt.getTime()).toBe(periodEnd.getTime());

    // a payload without a digest field is a no-op (no throw, no row)
    await channel.deliver({ companyId }, { kind: "other", title: "x" });
    expect(await db.select().from(digests).where(eq(digests.companyId, companyId))).toHaveLength(1);
  });
});
// [END: module]
