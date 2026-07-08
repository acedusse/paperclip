/**
 * FILE: server/src/__tests__/admission-reconciler.test.ts
 * ABOUT: admission-reconciler.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - admission-reconciler.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: admission-reconciler.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/admission-reconciler.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// Layer-1 integration proof for the admission reconciler: with an instance cap
// fully consumed by orphaned `running` rows (post-crash DB state), one
// runReconcile pass reaps the dead rows and the gate re-admits up to the cap.
//
// The DB bootstrap (adapter mock, describeEmbeddedPostgres, beforeAll/afterEach/
// afterAll, createCompany/createAgents/saturateQueue/countRunning/
// runTickForAllAgents) is mirrored from heartbeat-instance-admission.test.ts.
// Only seedStaleOrphanRunningRows (backdates updatedAt past the staleness
// threshold) and the reconciler case are new.
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
import { phase1ReconcileSources, runReconcile } from "../services/admission-reconciler.ts";

// Neutralize the fire-and-forget executeRun(...) that runs AFTER admission (see
// heartbeat-instance-admission.test.ts for the rationale): admission itself is
// asserted synchronously via startNextQueuedRunForAgent's return value.
const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Admission reconciler test run.",
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
    `Skipping embedded Postgres admission reconciler tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("admission reconciler (cap reclaim)", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-admission-reconciler-");
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

  // ---- fixtures (mirrored) ---------------------------------------------------

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

  async function createAgents(
    companyId: string,
    count: number,
    opts: { maxConcurrentRuns: number },
  ): Promise<string[]> {
    const agentIds = Array.from({ length: count }, () => randomUUID());
    await db.insert(agents).values(
      agentIds.map((id, index) => ({
        id,
        companyId,
        name: `Agent-${index}-${id.slice(0, 8)}`,
        role: "engineer",
        status: "active" as const,
        adapterType: "codex_local" as const,
        adapterConfig: {},
        runtimeConfig: { heartbeat: { maxConcurrentRuns: opts.maxConcurrentRuns } },
        permissions: {},
      })),
    );
    return agentIds;
  }

  async function saturateQueue(companyId: string, agentIds: string[], perAgent: number) {
    const rows = agentIds.flatMap((agentId) =>
      Array.from({ length: perAgent }, () => ({
        id: randomUUID(),
        companyId,
        agentId,
        invocationSource: "assignment" as const,
        triggerDetail: "system" as const,
        status: "queued" as const,
      })),
    );
    if (rows.length > 0) await db.insert(heartbeatRuns).values(rows);
  }

  // Seed `count` orphaned running rows (no live process) whose updatedAt is old
  // enough that the reaper's 5-minute staleness gate lets them through.
  async function seedStaleOrphanRunningRows(companyId: string, count: number) {
    const orphanAgentId = randomUUID();
    await db.insert(agents).values({
      id: orphanAgentId,
      companyId,
      name: `Orphan-${orphanAgentId.slice(0, 8)}`,
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    const staleAt = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    const ids = Array.from({ length: count }, () => randomUUID());
    await db.insert(heartbeatRuns).values(
      ids.map((id) => ({
        id,
        companyId,
        agentId: orphanAgentId,
        invocationSource: "assignment" as const,
        triggerDetail: "system" as const,
        status: "running" as const,
      })),
    );
    // Backdate updatedAt past the staleness threshold.
    for (const id of ids) {
      await db.update(heartbeatRuns).set({ updatedAt: staleAt }).where(eq(heartbeatRuns.id, id));
    }
  }

  async function countRunning(): Promise<number> {
    return heartbeat.countRunningRunsInstanceWide();
  }

  async function runTickForAllAgents(agentIds: string[]): Promise<number> {
    let admitted = 0;
    for (const agentId of agentIds) {
      const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
      admitted += claimed.length;
    }
    return admitted;
  }

  // ---- the reconciler proof --------------------------------------------------

  it("reconciler reclaims slots leaked by orphaned running rows, gate re-admits to cap", async () => {
    const companyId = await createCompany();
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });

    // Cap fully consumed by crash-leaked running rows.
    await seedStaleOrphanRunningRows(companyId, 10);
    expect(await countRunning()).toBe(10);

    // Real agents with queued work waiting behind the full cap.
    const agentIds = await createAgents(companyId, 3, { maxConcurrentRuns: 20 });
    await saturateQueue(companyId, agentIds, 20);

    // Before reconcile: cap is full of orphans, nothing admits.
    expect(await runTickForAllAgents(agentIds)).toBe(0);

    // One reconcile pass reaps the dead rows and frees the slots.
    const results = await runReconcile(
      phase1ReconcileSources({ reapOrphanedRuns: heartbeat.reapOrphanedRuns }),
      new Date(),
    );
    expect(results).toEqual([{ source: "run-liveness", drifted: 10, repaired: 10 }]);
    expect(await countRunning()).toBe(0);

    // After reconcile: the gate re-admits up to the instance cap on the next tick.
    expect(await runTickForAllAgents(agentIds)).toBe(10);
  });
});
// [END: module]
