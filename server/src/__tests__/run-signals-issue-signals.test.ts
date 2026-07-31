/**
 * FILE: server/src/__tests__/run-signals-issue-signals.test.ts
 * ABOUT: run-signals-issue-signals.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - run-signals-issue-signals.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: run-signals-issue-signals.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/run-signals-issue-signals.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  costEvents,
  createDb,
  heartbeatRuns,
  issueComments,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { getIssueRunSignals } from "../services/run-signals/issue-signals.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres run-signals tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("getIssueRunSignals", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  const now = new Date("2026-07-31T12:00:00.000Z");
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-run-signals-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql.raw(`TRUNCATE TABLE "companies" CASCADE`));
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  let issueSeq = 0;

  async function seedCompanyAgentIssue() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `RS${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    issueSeq += 1;

    await db.insert(companies).values({
      id: companyId,
      name: "Run Signals Co",
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
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Ship it",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      originKind: "manual",
      issueNumber: issueSeq,
      identifier: `${issuePrefix}-${issueSeq}`,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { companyId, agentId, issueId, issuePrefix };
  }

  async function addIssue(companyId: string, agentId: string, issuePrefix: string) {
    const issueId = randomUUID();
    issueSeq += 1;
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Second",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      originKind: "manual",
      issueNumber: issueSeq,
      identifier: `${issuePrefix}-${issueSeq}`,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return issueId;
  }

  async function insertRun(input: {
    companyId: string;
    agentId: string;
    issueId: string;
    status: string;
    contextKey: "issueId" | "taskId" | "taskKey";
    startedAt: Date;
  }) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: input.companyId,
      agentId: input.agentId,
      status: input.status,
      invocationSource: "assignment",
      triggerDetail: "system",
      startedAt: input.startedAt,
      contextSnapshot: { [input.contextKey]: input.issueId },
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
    });
    return runId;
  }

  it.each(["issueId", "taskId", "taskKey"] as const)(
    "attributes a run to its issue via the %s context key",
    async (contextKey) => {
      const { companyId, agentId, issueId } = await seedCompanyAgentIssue();
      await insertRun({ companyId, agentId, issueId, status: "succeeded", contextKey, startedAt: now });

      const signals = await getIssueRunSignals(db, companyId, [{ issueId, agentId }], now);

      expect(signals.get(issueId)?.terminalRunCount).toBe(1);
    },
  );

  it("separates terminal from active runs", async () => {
    const { companyId, agentId, issueId } = await seedCompanyAgentIssue();
    await insertRun({ companyId, agentId, issueId, status: "succeeded", contextKey: "issueId", startedAt: now });
    await insertRun({ companyId, agentId, issueId, status: "failed", contextKey: "issueId", startedAt: now });
    await insertRun({ companyId, agentId, issueId, status: "running", contextKey: "issueId", startedAt: now });

    const signals = await getIssueRunSignals(db, companyId, [{ issueId, agentId }], now);

    expect(signals.get(issueId)?.terminalRunCount).toBe(2);
    expect(signals.get(issueId)?.activeRunCount).toBe(1);
  });

  it("counts runs inside the 1h and 6h windows only", async () => {
    const { companyId, agentId, issueId } = await seedCompanyAgentIssue();
    await insertRun({ companyId, agentId, issueId, status: "succeeded", contextKey: "issueId", startedAt: minutesAgo(30) });
    await insertRun({ companyId, agentId, issueId, status: "succeeded", contextKey: "issueId", startedAt: minutesAgo(180) });
    await insertRun({ companyId, agentId, issueId, status: "succeeded", contextKey: "issueId", startedAt: minutesAgo(600) });

    const signals = await getIssueRunSignals(db, companyId, [{ issueId, agentId }], now);

    expect(signals.get(issueId)?.runCountLastHour).toBe(1);
    expect(signals.get(issueId)?.runCountLastSixHours).toBe(2);
  });

  it("counts a queued run with no startedAt via its createdAt", async () => {
    const { companyId, agentId, issueId } = await seedCompanyAgentIssue();
    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      companyId,
      agentId,
      status: "queued",
      invocationSource: "assignment",
      triggerDetail: "system",
      startedAt: null,
      contextSnapshot: { issueId },
      createdAt: minutesAgo(10),
      updatedAt: minutesAgo(10),
    });

    const signals = await getIssueRunSignals(db, companyId, [{ issueId, agentId }], now);

    expect(signals.get(issueId)?.activeRunCount).toBe(1);
    expect(signals.get(issueId)?.runCountLastHour).toBe(1);
  });

  it("stops the no-comment streak at the newest run that produced a comment", async () => {
    const { companyId, agentId, issueId } = await seedCompanyAgentIssue();
    // Newest first: two silent runs, then one that commented.
    await insertRun({ companyId, agentId, issueId, status: "succeeded", contextKey: "issueId", startedAt: minutesAgo(10) });
    await insertRun({ companyId, agentId, issueId, status: "succeeded", contextKey: "issueId", startedAt: minutesAgo(20) });
    const commentingRunId = await insertRun({
      companyId, agentId, issueId, status: "succeeded", contextKey: "issueId", startedAt: minutesAgo(30),
    });
    await db.insert(issueComments).values({
      companyId,
      issueId,
      authorAgentId: agentId,
      createdByRunId: commentingRunId,
      body: "progress",
      createdAt: minutesAgo(30),
      updatedAt: minutesAgo(30),
    });

    const signals = await getIssueRunSignals(db, companyId, [{ issueId, agentId }], now);

    expect(signals.get(issueId)?.noCommentStreak).toBe(2);
    expect(signals.get(issueId)?.commentCount).toBe(1);
  });

  it("returns one entry per scope in a single batch", async () => {
    const first = await seedCompanyAgentIssue();
    const secondIssueId = await addIssue(first.companyId, first.agentId, first.issuePrefix);
    await insertRun({
      companyId: first.companyId, agentId: first.agentId, issueId: first.issueId,
      status: "succeeded", contextKey: "issueId", startedAt: now,
    });
    await insertRun({
      companyId: first.companyId, agentId: first.agentId, issueId: secondIssueId,
      status: "failed", contextKey: "issueId", startedAt: now,
    });

    const signals = await getIssueRunSignals(
      db,
      first.companyId,
      [
        { issueId: first.issueId, agentId: first.agentId },
        { issueId: secondIssueId, agentId: first.agentId },
      ],
      now,
    );

    expect(signals.size).toBe(2);
    expect(signals.get(first.issueId)?.terminalRunCount).toBe(1);
    expect(signals.get(secondIssueId)?.terminalRunCount).toBe(1);
  });

  it("sums cost per issue", async () => {
    const { companyId, agentId, issueId } = await seedCompanyAgentIssue();
    const runId = await insertRun({
      companyId, agentId, issueId, status: "succeeded", contextKey: "issueId", startedAt: now,
    });
    await db.insert(costEvents).values([
      {
        companyId, agentId, issueId, heartbeatRunId: runId,
        provider: "anthropic", model: "claude-opus-5", costCents: 120, occurredAt: now,
      },
      {
        companyId, agentId, issueId, heartbeatRunId: runId,
        provider: "anthropic", model: "claude-opus-5", costCents: 30, occurredAt: now,
      },
    ]);

    const signals = await getIssueRunSignals(db, companyId, [{ issueId, agentId }], now);

    expect(signals.get(issueId)?.costCents).toBe(150);
  });

  it("omits scopes with no matching runs rather than throwing", async () => {
    const { companyId, agentId } = await seedCompanyAgentIssue();

    const signals = await getIssueRunSignals(db, companyId, [{ issueId: randomUUID(), agentId }], now);

    expect(signals.size).toBe(0);
  });

  it("does not count another agent's runs on the same issue", async () => {
    const { companyId, agentId, issueId } = await seedCompanyAgentIssue();
    const otherAgentId = randomUUID();
    await db.insert(agents).values({
      id: otherAgentId, companyId, name: "Other", role: "engineer", status: "idle",
      adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {}, permissions: {},
    });
    await insertRun({
      companyId, agentId: otherAgentId, issueId, status: "succeeded", contextKey: "issueId", startedAt: now,
    });

    const signals = await getIssueRunSignals(db, companyId, [{ issueId, agentId }], now);

    expect(signals.size).toBe(0);
  });

  it("does not leak runs across companies", async () => {
    const mine = await seedCompanyAgentIssue();
    const theirs = await seedCompanyAgentIssue();
    await insertRun({
      companyId: theirs.companyId, agentId: theirs.agentId, issueId: mine.issueId,
      status: "succeeded", contextKey: "issueId", startedAt: now,
    });

    const signals = await getIssueRunSignals(
      db, mine.companyId, [{ issueId: mine.issueId, agentId: mine.agentId }], now,
    );

    expect(signals.size).toBe(0);
  });

  it("short-circuits on empty input without querying", async () => {
    const signals = await getIssueRunSignals(db, randomUUID(), [], now);
    expect(signals.size).toBe(0);
  });
});
// [END: module]
