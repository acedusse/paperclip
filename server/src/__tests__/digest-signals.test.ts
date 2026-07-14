/**
 * FILE: server/src/__tests__/digest-signals.test.ts
 * ABOUT: digest-signals.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - DB-backed digest signal collection tests.
 */
// ==========================================
// [META: module]
// INTENT: Verify collectDigestSignals aggregates open approvals, auto-approved
// decisions since a timestamp, and stale heartbeat runs against embedded postgres.
// PSEUDOCODE: 1. Seed company/agent/approvals/risk/activity_log/heartbeat_runs.
// 2. Call collectDigestSignals. 3. Assert aggregation matches seeded data.
// JSON_FLOW: {"file": "server/src/__tests__/digest-signals.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, approvalRisk, approvals, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { collectDigestSignals } from "../services/digest-signals.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping digest signals tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("collectDigestSignals", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("digest-signals");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(approvalRisk);
    await db.delete(approvals);
    await db.delete(agents);
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

  async function seedAgent(companyId: string, name = "CodexCoder"): Promise<string> {
    const [agent] = await db
      .insert(agents)
      .values({ companyId, name, role: "engineer", adapterType: "codex_local", adapterConfig: {} })
      .returning();
    return agent!.id;
  }

  async function seedApproval(companyId: string, agentId: string, band: string, score: number): Promise<string> {
    const [approval] = await db
      .insert(approvals)
      .values({ companyId, type: "work_product", payload: {}, requestedByAgentId: agentId })
      .returning();
    await db.insert(approvalRisk).values({ approvalId: approval!.id, companyId, score, band, reasons: [] });
    return approval!.id;
  }

  it("aggregates open approvals, auto-approved decisions since a timestamp, and stale runs", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);

    // Two open approvals with distinct risk bands.
    await seedApproval(companyId, agentId, "low", 5);
    await seedApproval(companyId, agentId, "high", 60);

    const since = new Date(Date.now() - 60 * 60 * 1000); // 1h ago

    // One auto-approved decision after `since`, one before.
    await db.insert(activityLog).values({
      companyId,
      actorType: "system",
      actorId: "auto_policy",
      action: "approval.decision",
      entityType: "approval",
      entityId: randomUUID(),
      details: { method: "auto_policy" },
      createdAt: new Date(),
    });
    await db.insert(activityLog).values({
      companyId,
      actorType: "system",
      actorId: "auto_policy",
      action: "approval.decision",
      entityType: "approval",
      entityId: randomUUID(),
      details: { method: "auto_policy" },
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // before `since`
    });

    // One stale (7h old) running run, one fresh running run.
    await db.insert(heartbeatRuns).values({
      companyId,
      agentId,
      status: "running",
      updatedAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
    });
    await db.insert(heartbeatRuns).values({
      companyId,
      agentId,
      status: "running",
      updatedAt: new Date(),
    });

    const s = await collectDigestSignals(db, companyId, since);

    expect(s.openApprovals.total).toBe(2);
    expect(s.openApprovals.byBand.low).toBe(1);
    expect(s.openApprovals.byBand.high).toBe(1);
    expect(s.openApprovals.top[0]!.band).toBe("high"); // sorted by score desc

    expect(s.autoApprovedSince).toBe(1); // only the row after `since`

    expect(s.staleRuns.total).toBe(1); // only the 7h-old running run
    expect(s.staleRuns.top[0]!.staleForMinutes).toBeGreaterThanOrEqual(360);
  });
});
// [END: module]
