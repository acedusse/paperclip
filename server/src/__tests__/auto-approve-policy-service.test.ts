/**
 * FILE: server/src/__tests__/auto-approve-policy-service.test.ts
 * ABOUT: auto-approve-policy-service.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - DB-backed auto-approve policy service tests.
 */
// ==========================================
// [META: module]
// INTENT: Verify autoApprovePolicyService CRUD + evaluateForApproval against embedded postgres.
// PSEUDOCODE: 1. Seed company/agent/approval/risk. 2. Exercise create/list/deactivate/evaluate.
// JSON_FLOW: {"file": "server/src/__tests__/auto-approve-policy-service.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, approvalRisk, approvals, autoApprovePolicies, companies, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { autoApprovePolicyService } from "../services/auto-approve-policy.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping auto-approve policy service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("autoApprovePolicyService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("auto-approve-policy-service");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(autoApprovePolicies);
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

  async function seedApproval(companyId: string, agentId: string): Promise<string> {
    const [approval] = await db
      .insert(approvals)
      .values({ companyId, type: "work_product", payload: {}, requestedByAgentId: agentId })
      .returning();
    return approval!.id;
  }

  async function seedLowRisk(companyId: string, approvalId: string): Promise<void> {
    await db.insert(approvalRisk).values({ approvalId, companyId, score: 5, band: "low", reasons: [] });
  }

  it("matches only an active policy for the right agent, and honors deactivation", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const otherAgentId = await seedAgent(companyId, "OtherAgent");
    const approvalId = await seedApproval(companyId, agentId);
    await seedLowRisk(companyId, approvalId);

    const svc = autoApprovePolicyService(db);

    // no policy → no match
    expect((await svc.evaluateForApproval(approvalId)).matched).toBeNull();

    // active matching policy → match
    const p = await svc.create(companyId, {
      agentId, approvalType: "work_product", maxBand: "low", maxSpendCents: 100, requireNoSecrets: true,
    });
    expect((await svc.evaluateForApproval(approvalId)).matched?.id).toBe(p.id);

    // listActive returns it
    expect((await svc.listActive(companyId)).some((x) => x.id === p.id)).toBe(true);

    // deactivate → no match, not listed
    await svc.deactivate(companyId, p.id);
    expect((await svc.evaluateForApproval(approvalId)).matched).toBeNull();
    expect((await svc.listActive(companyId)).some((x) => x.id === p.id)).toBe(false);

    // wrong agent policy → no match
    await svc.create(companyId, {
      agentId: otherAgentId, approvalType: "work_product", maxBand: "low", maxSpendCents: 100, requireNoSecrets: true,
    });
    expect((await svc.evaluateForApproval(approvalId)).matched).toBeNull();
  });
});
// [END: module]
