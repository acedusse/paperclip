// Layer-1 integration proof for Combo-01 Phase 2a per-run caps: the periodic
// run-cap-sweep reconcile source finds a `running` heartbeat run whose
// wall-clock cap has already elapsed and winds it down via
// heartbeat.windDownRun, feeding through the same runReconcile loop wired
// into server/src/index.ts.
//
// The DB bootstrap (adapter mock, describeEmbeddedPostgres, beforeAll/afterEach/
// afterAll, createCompany/createAgent) is mirrored from
// __tests__/run-caps-stamp.integration.test.ts and
// __tests__/run-wind-down.integration.test.ts. Only the running-run seed
// (with a stamped, already-elapsed wall-clock cap) and the sweep assertions
// are new.
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
import { makeRunCapSweepSource } from "../services/run-caps.ts";
import { runReconcile } from "../services/admission-reconciler.ts";
import { costService } from "../services/costs.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Run-caps sweep integration test run.",
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
    `Skipping embedded Postgres run-caps sweep tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("run-cap-sweep reconcile source (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-run-caps-sweep-");
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

  it("wall-clock sweep winds down a run older than its stamped cap", async () => {
    const companyId = await createCompany();
    const agentId = await createAgent(companyId);
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      startedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
      maxRunWallClockMs: 60000, // 1 min cap
    });

    const results = await runReconcile(
      [
        makeRunCapSweepSource({
          findRunningRunsWithCaps: heartbeat.findRunningRunsWithCaps,
          sumRunCostCents: (id) => costService(db).sumRunCostCents(id),
          windDownRun: heartbeat.windDownRun,
        }),
      ],
      new Date(),
    );
    expect(results).toContainEqual({ source: "run-cap-sweep", drifted: 1, repaired: 1 });

    const [row] = await db
      .select({ status: heartbeatRuns.status, reason: heartbeatRuns.windDownReason })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId));
    expect(row.status).toBe("wound_down");
    expect(row.reason).toBe("cap-wallclock");
  });
});
