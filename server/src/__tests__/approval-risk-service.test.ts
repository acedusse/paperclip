/**
 * FILE: server/src/__tests__/approval-risk-service.test.ts
 * ABOUT: approval-risk-service.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - approval-risk-service.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: approval-risk-service.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/approval-risk-service.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  approvalRisk,
  approvals,
  companies,
  createDb,
  heartbeatRuns,
  runChangesets,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { approvalRiskService } from "../services/approval-risk.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping approval risk service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("approvalRiskService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("approval-risk-service");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(approvalRisk);
    await db.delete(runChangesets);
    await db.delete(approvals);
    await db.delete(heartbeatRuns);
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

  async function seedAgent(companyId: string): Promise<string> {
    const [agent] = await db
      .insert(agents)
      .values({
        companyId,
        name: "CodexCoder",
        role: "engineer",
        adapterType: "codex_local",
        adapterConfig: {},
      })
      .returning();
    return agent!.id;
  }

  async function seedRun(companyId: string, agentId: string): Promise<string> {
    const [heartbeatRun] = await db
      .insert(heartbeatRuns)
      .values({
        companyId,
        agentId,
        status: "completed",
      })
      .returning();
    return heartbeatRun!.id;
  }

  async function seedApproval(
    companyId: string,
    payload: Record<string, unknown>,
    type = "work_product",
  ): Promise<string> {
    const [approval] = await db
      .insert(approvals)
      .values({
        companyId,
        type,
        payload,
      })
      .returning();
    return approval!.id;
  }

  it("computes and persists a risk snapshot, then re-scores higher (idempotently) once a large changeset is linked", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const runId = await seedRun(companyId, agentId);
    const approvalId = await seedApproval(companyId, { runId });

    const svc = approvalRiskService(db);
    const first = await svc.computeAndPersist(approvalId);

    const snapshot = await svc.getSnapshot(approvalId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.score).toBe(first.score);
    expect(snapshot!.band).toBe(first.band);
    expect(snapshot!.reasons).toEqual(first.reasons);

    // Link a large changeset to the run and recompute — score should rise.
    await db.insert(runChangesets).values({
      companyId,
      heartbeatRunId: runId,
      summaryStats: { filesChanged: 12, additions: 800, deletions: 400 },
    });

    const second = await svc.computeAndPersist(approvalId);
    expect(second.score).toBeGreaterThan(first.score);

    // Exactly one persisted row (upsert, not a second insert).
    const rows = await db.select().from(approvalRisk).where(eq(approvalRisk.approvalId, approvalId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(second.score);
    expect(rows[0]!.band).toBe(second.band);
  });
});
// [END: module]
