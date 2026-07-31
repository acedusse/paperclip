/**
 * FILE: server/src/__tests__/company-preflight-service.test.ts
 * ABOUT: company-preflight-service.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - company-preflight-service.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: company-preflight-service.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/company-preflight-service.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, budgetPolicies, companies, createDb, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companyPreflightService, loadPreflightContext } from "../services/company-preflight/index.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres preflight tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("companyPreflightService", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  const now = new Date("2026-07-31T12:00:00.000Z");

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-preflight-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql.raw(`TRUNCATE TABLE "companies" CASCADE`));
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  let seq = 0;

  async function seedCompany() {
    const companyId = randomUUID();
    const issuePrefix = `PF${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Preflight Co",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });
    return { companyId, issuePrefix };
  }

  async function addAgent(companyId: string, overrides?: { status?: string; reportsTo?: string; adapterType?: string }) {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `Agent ${(seq += 1)}`,
      role: "engineer",
      status: overrides?.status ?? "idle",
      reportsTo: overrides?.reportsTo ?? null,
      adapterType: overrides?.adapterType ?? "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return agentId;
  }

  async function addIssue(companyId: string, issuePrefix: string, assigneeAgentId: string) {
    seq += 1;
    await db.insert(issues).values({
      id: randomUUID(),
      companyId,
      title: `Issue ${seq}`,
      status: "todo",
      priority: "medium",
      originKind: "manual",
      issueNumber: seq,
      identifier: `${issuePrefix}-${seq}`,
      assigneeAgentId,
      createdAt: now,
      updatedAt: now,
    });
  }

  it("loads a context that reflects the stored company", async () => {
    const { companyId, issuePrefix } = await seedCompany();
    const agentId = await addAgent(companyId);
    await addIssue(companyId, issuePrefix, agentId);

    const ctx = await loadPreflightContext(db, companyId);

    expect(ctx.companyId).toBe(companyId);
    expect(ctx.agents).toHaveLength(1);
    expect(ctx.agents[0]!.openIssueCount).toBe(1);
    expect(ctx.costEventCount).toBe(0);
    expect(ctx.medianRunCostCents).toBeNull();
  });

  it("fails a company with no agents", async () => {
    const { companyId } = await seedCompany();

    const report = await companyPreflightService(db).run(companyId, now);

    expect(report.status).toBe("fail");
    expect(report.findings.map((f) => f.code)).toContain("no_invokable_agents");
  });

  it("detects a reporting cycle through the real agents table", async () => {
    const { companyId } = await seedCompany();
    const a = await addAgent(companyId);
    const b = await addAgent(companyId, { reportsTo: a });
    await db.execute(sql`update agents set reports_to = ${b} where id = ${a}`);

    const report = await companyPreflightService(db).run(companyId, now);

    expect(report.findings.map((f) => f.code)).toContain("org_chain_invalid");
    expect(report.status).toBe("fail");
  });

  it("warns when no budget policy is configured", async () => {
    const { companyId, issuePrefix } = await seedCompany();
    const agentId = await addAgent(companyId);
    await addIssue(companyId, issuePrefix, agentId);

    const report = await companyPreflightService(db).run(companyId, now);

    expect(report.findings.map((f) => f.code)).toContain("no_budget_policy");
  });

  it("stops warning once an active budget policy exists", async () => {
    const { companyId, issuePrefix } = await seedCompany();
    const agentId = await addAgent(companyId);
    await addIssue(companyId, issuePrefix, agentId);
    await db.insert(budgetPolicies).values({
      companyId,
      scopeType: "company",
      scopeId: companyId,
      metric: "billed_cents",
      windowKind: "monthly",
      amount: 50_000,
      isActive: true,
    });

    const report = await companyPreflightService(db).run(companyId, now);

    expect(report.findings.map((f) => f.code)).not.toContain("no_budget_policy");
  });

  it("warns about an agent with nothing assigned", async () => {
    const { companyId } = await seedCompany();
    await addAgent(companyId);

    const report = await companyPreflightService(db).run(companyId, now);

    expect(report.findings.map((f) => f.code)).toContain("agent_without_work");
  });

  it("orders findings most severe first", async () => {
    const { companyId } = await seedCompany();
    await addAgent(companyId, { adapterType: "definitely-not-registered" });

    const report = await companyPreflightService(db).run(companyId, now);

    expect(report.findings.length).toBeGreaterThan(1);
    expect(report.findings[0]!.level).toBe("error");
  });

  it("does not leak another company's agents into the report", async () => {
    const mine = await seedCompany();
    const theirs = await seedCompany();
    await addAgent(mine.companyId);
    await addAgent(theirs.companyId, { adapterType: "definitely-not-registered" });

    const report = await companyPreflightService(db).run(mine.companyId, now);

    expect(report.findings.map((f) => f.code)).not.toContain("adapter_unavailable");
  });

  it("reports missing cost history as info without failing the launch", async () => {
    const { companyId, issuePrefix } = await seedCompany();
    const agentId = await addAgent(companyId);
    await addIssue(companyId, issuePrefix, agentId);
    await db.insert(budgetPolicies).values({
      companyId,
      scopeType: "company",
      scopeId: companyId,
      metric: "billed_cents",
      windowKind: "monthly",
      amount: 50_000,
      isActive: true,
    });

    const report = await companyPreflightService(db).run(companyId, now);

    const finding = report.findings.find((f) => f.code === "no_cost_history");
    expect(finding?.level).toBe("info");
    expect(report.status).toBe("pass");
  });
});
// [END: module]
