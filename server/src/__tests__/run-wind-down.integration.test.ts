// Layer-1 integration proof for the Combo-01 Phase 2.0 wind-down primitive:
// a seeded `running` heartbeat run driven through heartbeat.windDownRun lands in
// the `wound_down` status with its reason + resume policy persisted.
//
// The DB bootstrap (adapter mock, describeEmbeddedPostgres, beforeAll/afterEach/
// afterAll, createCompany/createAgent) is mirrored from
// __tests__/admission-reconciler.test.ts. Only the running-run seed and the
// wind-down assertions are new.
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
import { runningProcesses } from "../adapters/index.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Wind-down integration test run.",
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
    `Skipping embedded Postgres wind-down tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("windDownRun (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-wind-down-");
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

  async function seedRunningRun(companyId: string, agentId: string): Promise<string> {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      startedAt: new Date(),
    });
    return runId;
  }

  it("hard wind-down with resume=when-allowed marks the run wound_down", async () => {
    const companyId = await createCompany();
    const agentId = await createAgent(companyId);
    const runId = await seedRunningRun(companyId, agentId);

    const result = await heartbeat.windDownRun(runId, {
      mode: "hard",
      resume: "when-allowed",
      reason: "cap-cost",
    });
    expect(result).toEqual({ outcome: "terminated" });

    const [row] = await db
      .select({
        status: heartbeatRuns.status,
        windDownReason: heartbeatRuns.windDownReason,
        resumePolicy: heartbeatRuns.resumePolicy,
        finishedAt: heartbeatRuns.finishedAt,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId));

    expect(row.status).toBe("wound_down");
    expect(row.windDownReason).toBe("cap-cost");
    expect(row.resumePolicy).toBe("when-allowed");
    expect(row.finishedAt).not.toBeNull();
  });

  it("hard wind-down with resume=no parks the work (wound_down, resumePolicy=no)", async () => {
    const companyId = await createCompany();
    const agentId = await createAgent(companyId);
    const runId = await seedRunningRun(companyId, agentId);

    const result = await heartbeat.windDownRun(runId, { mode: "hard", resume: "no", reason: "panic" });
    expect(result).toEqual({ outcome: "terminated" });

    const [row] = await db
      .select({ status: heartbeatRuns.status, resumePolicy: heartbeatRuns.resumePolicy })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId));
    expect(row.status).toBe("wound_down");
    expect(row.resumePolicy).toBe("no");
  });

  it("noops on an already-finished run", async () => {
    const companyId = await createCompany();
    const agentId = await createAgent(companyId);
    const runId = await seedRunningRun(companyId, agentId);
    await db.update(heartbeatRuns).set({ status: "finished" }).where(eq(heartbeatRuns.id, runId));

    const result = await heartbeat.windDownRun(runId, { mode: "hard", resume: "no", reason: "panic" });
    expect(result).toEqual({ outcome: "noop" });

    const [row] = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId));
    expect(row.status).toBe("finished");
  });
});
