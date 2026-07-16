/**
 * FILE: server/src/__tests__/coverage-sweep.test.ts
 * ABOUT: coverage-sweep.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - coverage-sweep.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: coverage-sweep.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/coverage-sweep.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("web-push"); // never send real push

import {
  approvalCoverageEscalations,
  approvalRisk,
  approvals,
  companies,
  companyCoverageConfig,
  createDb,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { coverageSweepService, slaMinutesForBand } from "../services/coverage-sweep.js";
import { getChannels, registerChannel } from "../services/notification-delivery.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping coverage sweep tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("slaMinutesForBand", () => {
  it("maps each band to its config threshold", () => {
    const cfg = { slaCriticalMinutes: 60, slaHighMinutes: 240, slaMediumMinutes: 1440, slaLowMinutes: 4320 } as any;
    expect(slaMinutesForBand(cfg, "critical")).toBe(60);
    expect(slaMinutesForBand(cfg, "high")).toBe(240);
    expect(slaMinutesForBand(cfg, "medium")).toBe(1440);
    expect(slaMinutesForBand(cfg, "low")).toBe(4320);
  });
});

describeEmbeddedPostgres("coverageSweepService.sweep", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("coverage-sweep");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(approvalCoverageEscalations);
    await db.delete(approvalRisk);
    await db.delete(approvals);
    await db.delete(companyCoverageConfig);
    await db.delete(companies);
    // Reset the delivery channel registry to avoid cross-test leakage.
    for (const c of getChannels()) registerChannel({ name: c.name, deliver: () => Promise.resolve() });
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedCompany(name = "Acme") {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `T${companyId.slice(0, 7)}`.toUpperCase(),
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return companyId;
  }

  async function seedApproval(companyId: string, createdAt: Date, band: string) {
    const [approval] = await db
      .insert(approvals)
      .values({
        companyId,
        type: "issue_promotion",
        status: "pending",
        payload: { note: "seed" },
        createdAt,
        updatedAt: createdAt,
      })
      .returning();
    const approvalId = approval!.id;
    await db.insert(approvalRisk).values({
      approvalId,
      companyId,
      score: 80,
      band,
      reasons: [],
    });
    return approvalId;
  }

  async function seedCoverageConfig(
    companyId: string,
    overrides: Partial<{ enabled: boolean; backupUserId: string | null }> = {},
  ) {
    await db.insert(companyCoverageConfig).values({
      companyId,
      enabled: overrides.enabled ?? true,
      backupUserId: overrides.backupUserId === undefined ? "user-backup-1" : overrides.backupUserId,
    });
  }

  it("escalates a pending approval past its band's SLA and records an idempotent marker", async () => {
    const companyId = await seedCompany();
    await seedCoverageConfig(companyId);
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000);
    const approvalId = await seedApproval(companyId, fiveHoursAgo, "high");

    const sweep = coverageSweepService(db);
    const now = new Date();

    const first = await sweep.sweep(now);
    expect(first.escalated).toContain(approvalId);

    const markers = await db
      .select()
      .from(approvalCoverageEscalations)
      .where(eq(approvalCoverageEscalations.approvalId, approvalId));
    expect(markers).toHaveLength(1);
    expect(markers[0]!.companyId).toBe(companyId);
    expect(markers[0]!.backupUserId).toBe("user-backup-1");

    // Second sweep must not re-escalate (idempotent marker).
    const second = await sweep.sweep(new Date());
    expect(second.escalated).not.toContain(approvalId);

    const markersAfterSecondSweep = await db
      .select()
      .from(approvalCoverageEscalations)
      .where(eq(approvalCoverageEscalations.approvalId, approvalId));
    expect(markersAfterSecondSweep).toHaveLength(1);
  });

  it("does not escalate a pending approval that is still within its band's SLA", async () => {
    const companyId = await seedCompany();
    await seedCoverageConfig(companyId);
    const oneHourAgo = new Date(Date.now() - 1 * 3600 * 1000);
    const approvalId = await seedApproval(companyId, oneHourAgo, "high");

    const sweep = coverageSweepService(db);
    const result = await sweep.sweep(new Date());

    expect(result.escalated).not.toContain(approvalId);
    const markers = await db
      .select()
      .from(approvalCoverageEscalations)
      .where(eq(approvalCoverageEscalations.approvalId, approvalId));
    expect(markers).toHaveLength(0);
  });

  it("escalates nothing for a company with coverage disabled", async () => {
    const companyId = await seedCompany();
    await seedCoverageConfig(companyId, { enabled: false });
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000);
    const approvalId = await seedApproval(companyId, fiveHoursAgo, "high");

    const sweep = coverageSweepService(db);
    const result = await sweep.sweep(new Date());

    expect(result.escalated).not.toContain(approvalId);
    const markers = await db
      .select()
      .from(approvalCoverageEscalations)
      .where(eq(approvalCoverageEscalations.approvalId, approvalId));
    expect(markers).toHaveLength(0);
  });

  it("escalates nothing for a company with a null backup user", async () => {
    const companyId = await seedCompany();
    await seedCoverageConfig(companyId, { backupUserId: null });
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000);
    const approvalId = await seedApproval(companyId, fiveHoursAgo, "high");

    const sweep = coverageSweepService(db);
    const result = await sweep.sweep(new Date());

    expect(result.escalated).not.toContain(approvalId);
    const markers = await db
      .select()
      .from(approvalCoverageEscalations)
      .where(eq(approvalCoverageEscalations.approvalId, approvalId));
    expect(markers).toHaveLength(0);
  });

  it("does not let a delivery-channel throw for one company abort escalation for another", async () => {
    registerChannel({
      name: "webpush",
      deliver: async () => {
        throw new Error("boom");
      },
    });

    const failingCompanyId = await seedCompany("Failing Co");
    await seedCoverageConfig(failingCompanyId);
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000);
    const failingApprovalId = await seedApproval(failingCompanyId, fiveHoursAgo, "high");

    const okCompanyId = await seedCompany("OK Co");
    await seedCoverageConfig(okCompanyId);
    const okApprovalId = await seedApproval(okCompanyId, fiveHoursAgo, "high");

    const sweep = coverageSweepService(db);
    const result = await sweep.sweep(new Date());

    expect(result.escalated).toContain(failingApprovalId);
    expect(result.escalated).toContain(okApprovalId);

    const markers = await db.select().from(approvalCoverageEscalations);
    const markerIds = markers.map((m) => m.approvalId);
    expect(markerIds).toContain(failingApprovalId);
    expect(markerIds).toContain(okApprovalId);
  });
});
// [END: module]
