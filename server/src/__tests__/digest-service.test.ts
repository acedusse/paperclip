/**
 * FILE: server/src/__tests__/digest-service.test.ts
 * ABOUT: digest-service.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - DB-backed digestService tests (generate/latest/list/sweep).
 */
// ==========================================
// [META: module]
// INTENT: Verify digestService composes signals + narration into a persisted
// digest through the delivery pipeline, and that sweep respects company
// status + minimum interval while preserving period continuity across runs.
// PSEUDOCODE: 1. Seed active companies A, B and archived company C, plus an
// open approval+risk for A. 2. Generate for A directly and assert persistence
// + headline. 3. Sweep and assert B generated, A/C skipped. 4. Force sweep
// with minIntervalHours:0 and assert A regenerates. 5. Assert period
// continuity between A's two digests.
// JSON_FLOW: {"file": "server/src/__tests__/digest-service.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { approvalRisk, approvals, companies, createDb, digests } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { digestService } from "../services/digest.js";
import { createInboxDigestChannel, registerChannel } from "../services/notification-delivery.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping digest service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

describeEmbeddedPostgres("digestService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("digest-service");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
    // Phase-1 no-op inbox channel was removed; without registering here,
    // getChannels() is empty and generation would persist nothing.
    registerChannel(createInboxDigestChannel(db));
  }, 30_000);

  afterEach(async () => {
    await db.delete(digests);
    await db.delete(approvalRisk);
    await db.delete(approvals);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedCompany(status: "active" | "archived" = "active"): Promise<string> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Acme",
      issuePrefix: `T${companyId.slice(0, 7)}`.toUpperCase(),
      status,
    });
    return companyId;
  }

  async function seedOpenApproval(companyId: string): Promise<string> {
    const [approval] = await db.insert(approvals).values({ companyId, type: "work_product", payload: {} }).returning();
    await db.insert(approvalRisk).values({ approvalId: approval!.id, companyId, score: 42, band: "high", reasons: [] });
    return approval!.id;
  }

  it("generates, lists, and sweeps digests with period continuity", async () => {
    const companyA = await seedCompany("active");
    const companyB = await seedCompany("active");
    const companyC = await seedCompany("archived");
    await seedOpenApproval(companyA);

    const svc = digestService(db);

    // generate for A → persists a digest with the approval reflected
    const d = await svc.generateForCompany(companyA);
    expect(d).not.toBeNull();
    expect((d!.payload as any).headline).toContain("approval");
    expect(await svc.latest(companyA)).not.toBeNull();

    // sweep: A already has a recent digest → skipped; B has none → generated; C inactive → never
    const res = await svc.sweep(new Date());
    expect(res.generated).toContain(companyB);
    expect(res.generated).not.toContain(companyA);
    expect(res.generated).not.toContain(companyC);

    // forcing a 0h interval regenerates A
    const res2 = await svc.sweep(new Date(), { minIntervalHours: 0 });
    expect(res2.generated).toContain(companyA);

    // period continuity: A's second digest periodStart == first periodEnd
    const list = await svc.list(companyA, 10);
    const [newest, older] = list; // most-recent first
    expect(newest!.periodStart!.getTime()).toBe(older!.periodEnd!.getTime());
  });
});
// [END: module]
