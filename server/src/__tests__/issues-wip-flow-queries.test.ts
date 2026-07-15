import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { createDb, companies, agents, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

describeEmbeddedPostgres("issueService WIP/flow queries", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-wip-flow-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const agentA = randomUUID();
    const agentB = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: "TWIP01",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      { id: agentA, companyId, name: "A", urlKey: "a", adapterType: "process" },
      { id: agentB, companyId, name: "B", urlKey: "b", adapterType: "process" },
    ]);
    return { companyId, agentA, agentB };
  }

  it("counts in-progress issues grouped by agent", async () => {
    const { companyId, agentA, agentB } = await seed();
    await db.insert(issues).values([
      { companyId, title: "1", status: "in_progress", assigneeAgentId: agentA },
      { companyId, title: "2", status: "in_progress", assigneeAgentId: agentA },
      { companyId, title: "3", status: "todo", assigneeAgentId: agentA },
      { companyId, title: "4", status: "in_progress", assigneeAgentId: agentB },
      { companyId, title: "5", status: "done", assigneeAgentId: agentB },
    ]);
    const counts = await svc.inProgressIssueCountsByAgent(companyId);
    expect(counts.get(agentA)).toBe(2);
    expect(counts.get(agentB)).toBe(1);
  });

  it("filters counts to a single agent when agentId is given", async () => {
    const { companyId, agentA, agentB } = await seed();
    await db.insert(issues).values([
      { companyId, title: "1", status: "in_progress", assigneeAgentId: agentA },
      { companyId, title: "2", status: "in_progress", assigneeAgentId: agentB },
    ]);
    const counts = await svc.inProgressIssueCountsByAgent(companyId, agentA);
    expect(counts.get(agentA)).toBe(1);
    expect(counts.has(agentB)).toBe(false);
  });

  it("returns recent completions within the window grouped by agent", async () => {
    const { companyId, agentA } = await seed();
    const now = new Date("2026-07-12T00:00:00.000Z");
    const sinceIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const recentDone = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const oldDone = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await db.insert(issues).values([
      { companyId, title: "recent", status: "done", assigneeAgentId: agentA, startedAt: recentStart, completedAt: recentDone },
      { companyId, title: "old", status: "done", assigneeAgentId: agentA, startedAt: oldDone, completedAt: oldDone },
    ]);
    const completions = await svc.recentCompletionsByAgent(companyId, sinceIso);
    expect(completions.get(agentA)).toHaveLength(1);
    expect(completions.get(agentA)![0].completedAt.getTime()).toBe(recentDone.getTime());
  });
});
