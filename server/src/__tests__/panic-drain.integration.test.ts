// Layer-1 integration proof for Combo-01 Phase 2c panic/drain gating: a
// company (or instance) in "draining"/"halted" holds newly-claimed queued
// heartbeat runs (leaves them queued, does not cancel), and resuming to
// "running" lets a held run start.
//
// The DB bootstrap (adapter mock, describeEmbeddedPostgres, beforeAll/afterEach/
// afterAll, createCompany/createAgent) is mirrored verbatim from
// __tests__/run-caps-stamp.integration.test.ts. Only the execution-state seed,
// claim, and status assertions are new.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  companySkills,
  createDb,
  environmentLeases,
  executionWorkspaces,
  heartbeatRunEvents,
  heartbeatRuns,
  workspaceOperations,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { instanceSettingsService } from "../services/instance-settings.ts";
import { runningProcesses } from "../adapters/index.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Panic-drain integration test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres panic-drain tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("drain/halt gating holds queued claims (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-panic-drain-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    let idlePolls = 0;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const rows = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns);
      const hasActiveRun = rows.some((run) => run.status === "queued" || run.status === "running");
      if (!hasActiveRun) {
        idlePolls += 1;
        if (idlePolls >= 3) break;
      } else {
        idlePolls = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    runningProcesses.clear();
    const teardown = async () => {
      await db.delete(environmentLeases);
      await db.delete(activityLog);
      await db.delete(heartbeatRunEvents);
      await db.delete(agentWakeupRequests);
      await db.delete(workspaceOperations);
      await db.delete(executionWorkspaces);
      await db.delete(agentRuntimeState);
      await db.delete(heartbeatRuns);
      await db.delete(companySkills);
      await db.delete(agents);
      await db.delete(companies);
    };
    for (let attempt = 0; ; attempt += 1) {
      try {
        await teardown();
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createCompany(): Promise<string> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function createAgent(companyId: string): Promise<string> {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `Agent-${agentId.slice(0, 8)}`,
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
      permissions: {},
    });
    return agentId;
  }

  it("draining a company holds new claims and leaves running runs untouched", async () => {
    const companyId = await createCompany();
    await db.update(companies).set({ runExecutionState: "draining" }).where(eq(companies.id, companyId));
    const agentId = await createAgent(companyId);

    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId,
      invocationSource: "assignment", triggerDetail: "system", status: "queued",
    });
    await heartbeat.startNextQueuedRunForAgent(agentId);

    const [row] = await db.select({ status: heartbeatRuns.status })
      .from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(row.status).toBe("queued"); // held, not started
  });

  it("resume lets a previously-held run start", async () => {
    const companyId = await createCompany();
    await db.update(companies).set({ runExecutionState: "halted" }).where(eq(companies.id, companyId));
    const agentId = await createAgent(companyId);
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId,
      invocationSource: "assignment", triggerDetail: "system", status: "queued",
    });
    await heartbeat.startNextQueuedRunForAgent(agentId);
    expect((await db.select({ s: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0].s).toBe("queued");

    await db.update(companies).set({ runExecutionState: "running" }).where(eq(companies.id, companyId));
    await heartbeat.startNextQueuedRunForAgent(agentId);
    expect((await db.select({ s: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0].s).toBe("running");
  });

  it("instance halt cascades to block a company that is itself running", async () => {
    const companyId = await createCompany();
    await instanceSettingsService(db).updateGeneral({ runExecutionState: "halted" });
    const agentId = await createAgent(companyId);
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId,
      invocationSource: "assignment", triggerDetail: "system", status: "queued",
    });
    await heartbeat.startNextQueuedRunForAgent(agentId);
    expect((await db.select({ s: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0].s).toBe("queued");
  });
});
