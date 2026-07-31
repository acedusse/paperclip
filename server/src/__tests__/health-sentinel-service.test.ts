/**
 * FILE: server/src/__tests__/health-sentinel-service.test.ts
 * ABOUT: health-sentinel-service.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - health-sentinel-service.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: health-sentinel-service.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/health-sentinel-service.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  goals,
  heartbeatRuns,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { healthSentinelService } from "../services/health-sentinel/index.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres health sentinel tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("healthSentinelService", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  const now = new Date("2026-07-31T12:00:00.000Z");

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-health-sentinel-");
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
    const agentId = randomUUID();
    const issuePrefix = `HS${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Sentinel Co",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Coder",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return { companyId, agentId, issuePrefix };
  }

  async function addIssue(input: {
    companyId: string;
    issuePrefix: string;
    status?: string;
    goalId?: string | null;
    parentId?: string | null;
  }) {
    const issueId = randomUUID();
    seq += 1;
    await db.insert(issues).values({
      id: issueId,
      companyId: input.companyId,
      title: `Issue ${seq}`,
      status: input.status ?? "todo",
      priority: "medium",
      originKind: "manual",
      issueNumber: seq,
      identifier: `${input.issuePrefix}-${seq}`,
      goalId: input.goalId ?? null,
      parentId: input.parentId ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return issueId;
  }

  async function addGoal(companyId: string, overrides?: { status?: string; level?: string }) {
    const goalId = randomUUID();
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Ship v1",
      level: overrides?.level ?? "company",
      status: overrides?.status ?? "active",
    });
    return goalId;
  }

  it("reports healthy for a company with goal-linked work and no blockers", async () => {
    const { companyId, issuePrefix } = await seedCompany();
    const goalId = await addGoal(companyId);
    await addIssue({ companyId, issuePrefix, goalId });

    const report = await healthSentinelService(db).run(companyId, { now });

    expect(report.status).toBe("healthy");
    expect(report.findings).toEqual([]);
    expect(report.companyId).toBe(companyId);
  });

  it("detects a blocking cycle through the real relations table", async () => {
    const { companyId, issuePrefix } = await seedCompany();
    const goalId = await addGoal(companyId);
    const a = await addIssue({ companyId, issuePrefix, goalId });
    const b = await addIssue({ companyId, issuePrefix, goalId });
    await db.insert(issueRelations).values([
      { companyId, issueId: a, relatedIssueId: b, type: "blocks" },
      { companyId, issueId: b, relatedIssueId: a, type: "blocks" },
    ]);

    const report = await healthSentinelService(db).run(companyId, { now });

    const cycle = report.findings.find((f) => f.kind === "blocker_cycle");
    expect(cycle).toBeDefined();
    expect(cycle!.issueIds.sort()).toEqual([a, b].sort());
    expect(report.status).toBe("unhealthy");
  });

  it("detects an orphan issue with no goal", async () => {
    const { companyId, issuePrefix } = await seedCompany();
    const orphanId = await addIssue({ companyId, issuePrefix });

    const report = await healthSentinelService(db).run(companyId, { now });

    const orphan = report.findings.find((f) => f.kind === "orphan_issue");
    expect(orphan).toBeDefined();
    expect(orphan!.issueIds).toEqual([orphanId]);
  });

  it("does not flag a sub-issue that inherits its goal from its parent", async () => {
    const { companyId, issuePrefix } = await seedCompany();
    const goalId = await addGoal(companyId);
    const parentId = await addIssue({ companyId, issuePrefix, goalId });
    await addIssue({ companyId, issuePrefix, parentId });

    const report = await healthSentinelService(db).run(companyId, { now });

    expect(report.findings.filter((f) => f.kind === "orphan_issue")).toEqual([]);
  });

  it("flags an agent that has burned its error budget", async () => {
    const { companyId, agentId, issuePrefix } = await seedCompany();
    const goalId = await addGoal(companyId);
    await addIssue({ companyId, issuePrefix, goalId });

    const runs = Array.from({ length: 20 }, (_, i) => ({
      id: randomUUID(),
      companyId,
      agentId,
      status: i < 12 ? "failed" : "succeeded",
      invocationSource: "assignment" as const,
      startedAt: new Date(now.getTime() - 60_000),
      createdAt: new Date(now.getTime() - 60_000),
      updatedAt: new Date(now.getTime() - 60_000),
    }));
    await db.insert(heartbeatRuns).values(runs);

    const report = await healthSentinelService(db).run(companyId, { now });

    const breach = report.findings.find((f) => f.kind === "agent_error_budget_burned");
    expect(breach).toBeDefined();
    expect(breach!.agentIds).toEqual([agentId]);
  });

  it("ignores runs outside the reliability window", async () => {
    const { companyId, agentId, issuePrefix } = await seedCompany();
    const goalId = await addGoal(companyId);
    await addIssue({ companyId, issuePrefix, goalId });

    const longAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await db.insert(heartbeatRuns).values(
      Array.from({ length: 20 }, () => ({
        id: randomUUID(),
        companyId,
        agentId,
        status: "failed",
        invocationSource: "assignment" as const,
        startedAt: longAgo,
        createdAt: longAgo,
        updatedAt: longAgo,
      })),
    );

    const report = await healthSentinelService(db).run(companyId, { now });

    expect(report.findings.filter((f) => f.kind === "agent_error_budget_burned")).toEqual([]);
  });

  it("does not leak findings across companies", async () => {
    const mine = await seedCompany();
    const theirs = await seedCompany();
    await addGoal(mine.companyId);
    await addIssue({ companyId: theirs.companyId, issuePrefix: theirs.issuePrefix });

    const report = await healthSentinelService(db).run(mine.companyId, { now });

    // Their orphan must not appear in my report.
    expect(report.findings.filter((f) => f.kind === "orphan_issue")).toEqual([]);
  });

  it("orders findings most severe first", async () => {
    const { companyId, issuePrefix } = await seedCompany();
    const a = await addIssue({ companyId, issuePrefix });
    const b = await addIssue({ companyId, issuePrefix });
    await db.insert(issueRelations).values([
      { companyId, issueId: a, relatedIssueId: b, type: "blocks" },
      { companyId, issueId: b, relatedIssueId: a, type: "blocks" },
    ]);

    const report = await healthSentinelService(db).run(companyId, { now });

    expect(report.findings.length).toBeGreaterThan(1);
    expect(report.findings[0]!.level).toBe("error");
    expect(report.findings[report.findings.length - 1]!.level).toBe("warn");
  });
});
// [END: module]
