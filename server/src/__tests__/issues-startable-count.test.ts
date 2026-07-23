import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { createDb, companies, agents, projects, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(`Skipping embedded Postgres issues-startable-count tests: ${support.reason ?? "unsupported"}`);
}

describeEmbeddedPostgres("issueService.startableIssueCountForAgent", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-startable-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => { await tempDb?.cleanup(); });

  async function seed() {
    const companyId = randomUUID();
    const agentA = randomUUID();
    const agentB = randomUUID();
    const projectId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "P", issuePrefix: "STB", requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values([{ id: agentA, companyId, name: "A" }, { id: agentB, companyId, name: "B" }]);
    await db.insert(projects).values({ id: projectId, companyId, name: "Proj" });
    return { companyId, agentA, agentB, projectId };
  }

  it("counts only the agent's own issues in a startable status", async () => {
    const { companyId, agentA, agentB, projectId } = await seed();
    const mk = (assignee: string, status: string) =>
      db.insert(issues).values({ id: randomUUID(), companyId, projectId, title: "t", status, assigneeAgentId: assignee });
    await mk(agentA, "todo");
    await mk(agentA, "backlog");
    await mk(agentA, "blocked");
    await mk(agentA, "in_progress"); // excluded: not startable
    await mk(agentA, "done");        // excluded
    await mk(agentB, "todo");        // excluded: other agent

    expect(await svc.startableIssueCountForAgent(companyId, agentA)).toBe(3);
    expect(await svc.startableIssueCountForAgent(companyId, agentB)).toBe(1);
  });

  it("returns 0 for an agent with no startable work", async () => {
    const { companyId, agentB } = await seed();
    expect(await svc.startableIssueCountForAgent(companyId, agentB)).toBe(0);
  });
});
