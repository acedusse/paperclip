/**
 * FILE: server/src/__tests__/heartbeat-instance-admission.test.ts
 * ABOUT: heartbeat-instance-admission.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - heartbeat-instance-admission.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: heartbeat-instance-admission.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/heartbeat-instance-admission.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
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
import * as instanceSettingsModule from "../services/instance-settings.ts";
import * as instanceAdmissionLockModule from "../services/instance-admission-lock.ts";
import { runningProcesses } from "../adapters/index.ts";
import { companyService } from "../services/companies.js";

// Neutralize the fire-and-forget executeRun(...) that runs AFTER admission: replace
// the real adapter with a fast, side-effect-free success so background execution can
// never spawn a process or emit error logs. Admission itself (the claim decision) is
// asserted synchronously via the value returned from startNextQueuedRunForAgent, so
// these tests never depend on executeRun's async aftermath.
const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Instance admission test run.",
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
    `Skipping embedded Postgres heartbeat instance admission tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat instance-wide admission", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-instance-admission-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    // Restore the fail-open spy (if any) BEFORE draining so background executeRun(...)
    // calls resolve normally, then wait for those fire-and-forget runs to finish so we
    // never delete rows out from under an in-flight run. Require several *consecutive*
    // idle polls (plus a settle) because executeRun keeps writing child rows (run events)
    // for a short tail after a run leaves the "running" state.
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
    // Delete child tables (written by background executeRun) before their parents so
    // foreign-key constraints are satisfied. Retry to absorb any last-moment child-row
    // write from a fire-and-forget run that is still finishing.
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

  // ---- fixtures --------------------------------------------------------------

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

  // Insert `perAgent` queued runs for each agent (no issueId => no dependency gating).
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

  // Simulate leaked/orphaned running rows (e.g. from a crash) under a dedicated agent,
  // so the instance-wide running count is inflated without touching the tested agents'
  // per-agent budgets.
  async function seedOrphanRunningRows(companyId: string, count: number) {
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
    await db.insert(heartbeatRuns).values(
      Array.from({ length: count }, () => ({
        id: randomUUID(),
        companyId,
        agentId: orphanAgentId,
        invocationSource: "assignment" as const,
        triggerDetail: "system" as const,
        status: "running" as const,
      })),
    );
  }

  async function countRunning(): Promise<number> {
    return heartbeat.countRunningRunsInstanceWide();
  }

  async function countRunningForCompany(companyId: string): Promise<number> {
    return heartbeat.countRunningRunsForCompany(companyId);
  }

  // Run one admission tick for each agent and return the total number of runs ADMITTED
  // (claimed out of "queued") this tick. The returned claimedRuns count is the gate's
  // synchronous decision — it is fixed before executeRun(...) fires, so assertions on it
  // are deterministic regardless of executeRun's async aftermath.
  async function runTickForAllAgents(agentIds: string[]): Promise<number> {
    let admitted = 0;
    for (const agentId of agentIds) {
      const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);
      admitted += claimed.length;
    }
    return admitted;
  }

  // ---- Task 1 schema tests ---------------------------------------------------

  it("persists and clears a company maxConcurrentRuns via companiesService.update", async () => {
    const companyId = await createCompany();
    const svc = companyService(db);

    await svc.update(companyId, { maxConcurrentRuns: 5 } as any);
    let [row] = await db.select({ m: companies.maxConcurrentRuns }).from(companies).where(eq(companies.id, companyId));
    expect(row.m).toBe(5);

    await svc.update(companyId, { maxConcurrentRuns: null } as any);
    [row] = await db.select({ m: companies.maxConcurrentRuns }).from(companies).where(eq(companies.id, companyId));
    expect(row.m).toBeNull();
  });

  it("updateCompanySchema rejects non-positive / non-integer maxConcurrentRuns", async () => {
    const { updateCompanySchema } = await import("@paperclipai/shared");
    expect(updateCompanySchema.safeParse({ maxConcurrentRuns: 3 }).success).toBe(true);
    expect(updateCompanySchema.safeParse({ maxConcurrentRuns: null }).success).toBe(true);
    expect(updateCompanySchema.safeParse({ maxConcurrentRuns: 0 }).success).toBe(false);
    expect(updateCompanySchema.safeParse({ maxConcurrentRuns: -1 }).success).toBe(false);
    expect(updateCompanySchema.safeParse({ maxConcurrentRuns: 1.5 }).success).toBe(false);
  });

  // ---- Task 2 schema test -----------------------------------------------------

  it("persists a per-company maxConcurrentRuns (nullable, unset by default)", async () => {
    const companyId = await createCompany();
    const [before] = await db
      .select({ max: companies.maxConcurrentRuns })
      .from(companies)
      .where(eq(companies.id, companyId));
    expect(before.max).toBeNull();

    await db.update(companies).set({ maxConcurrentRuns: 3 }).where(eq(companies.id, companyId));
    const [after] = await db
      .select({ max: companies.maxConcurrentRuns })
      .from(companies)
      .where(eq(companies.id, companyId));
    expect(after.max).toBe(3);
  });

  // ---- Task 4 read-side test ---------------------------------------------------

  it("companyService.getById returns the configured maxConcurrentRuns", async () => {
    const companyId = await createCompany();
    const svc = companyService(db);

    const beforeSet = await svc.getById(companyId);
    expect(beforeSet?.maxConcurrentRuns ?? null).toBeNull();

    await svc.update(companyId, { maxConcurrentRuns: 5 } as any);
    const afterSet = await svc.getById(companyId);
    expect(afterSet?.maxConcurrentRuns).toBe(5);

    await svc.update(companyId, { maxConcurrentRuns: null } as any);
    const afterClear = await svc.getById(companyId);
    expect(afterClear?.maxConcurrentRuns ?? null).toBeNull();
  });

  // ---- Task 3 per-company count test -----------------------------------------

  async function createAgentInCompany(companyId: string): Promise<string> {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `Agent-${agentId.slice(0, 8)}`,
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return agentId;
  }

  async function insertRun(params: {
    companyId: string;
    agentId: string;
    status: "running" | "queued";
  }): Promise<void> {
    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      companyId: params.companyId,
      agentId: params.agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: params.status,
    });
  }

  it("counts running runs for one company, isolated from others", async () => {
    const companyA = await createCompany();
    const companyB = await createCompany();
    const agentA = await createAgentInCompany(companyA);
    const agentB = await createAgentInCompany(companyB);
    await insertRun({ companyId: companyA, agentId: agentA, status: "running" });
    await insertRun({ companyId: companyA, agentId: agentA, status: "running" });
    await insertRun({ companyId: companyA, agentId: agentA, status: "queued" });
    await insertRun({ companyId: companyB, agentId: agentB, status: "running" });

    expect(await heartbeat.countRunningRunsForCompany(companyA)).toBe(2);
    expect(await heartbeat.countRunningRunsForCompany(companyB)).toBe(1);
  });

  it("counts queued runs instance-wide and per-company, excluding running", async () => {
    const companyA = await createCompany();
    const companyB = await createCompany();
    const agentA = await createAgentInCompany(companyA);
    const agentB = await createAgentInCompany(companyB);
    await insertRun({ companyId: companyA, agentId: agentA, status: "queued" });
    await insertRun({ companyId: companyA, agentId: agentA, status: "queued" });
    await insertRun({ companyId: companyA, agentId: agentA, status: "running" });
    await insertRun({ companyId: companyB, agentId: agentB, status: "queued" });

    expect(await heartbeat.countQueuedRunsInstanceWide()).toBe(3);
    expect(await heartbeat.countQueuedRunsForCompany(companyA)).toBe(2);
    expect(await heartbeat.countQueuedRunsForCompany(companyB)).toBe(1);
  });

  // ---- Task 3 admission-status helpers ---------------------------------------

  it("reports instance admission status (cap/source/running/queued)", async () => {
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
    const company = await createCompany();
    const agent = await createAgentInCompany(company);
    await insertRun({ companyId: company, agentId: agent, status: "running" });
    await insertRun({ companyId: company, agentId: agent, status: "queued" });

    const s = await heartbeat.getInstanceAdmissionStatus();
    expect(s).toEqual({ cap: 10, source: "configured-default", running: 1, queued: 1 });
  });

  it("reports company admission status, unset cap => null/none, isolated per company", async () => {
    const companyA = await createCompany();
    const companyB = await createCompany();
    await db.update(companies).set({ maxConcurrentRuns: 3 }).where(eq(companies.id, companyA));
    const agentA = await createAgentInCompany(companyA);
    await insertRun({ companyId: companyA, agentId: agentA, status: "running" });

    expect(await heartbeat.getCompanyAdmissionStatus(companyA)).toEqual({
      cap: 3,
      source: "configured-default",
      running: 1,
      queued: 0,
    });
    expect(await heartbeat.getCompanyAdmissionStatus(companyB)).toEqual({
      cap: null,
      source: "none",
      running: 0,
      queued: 0,
    });
  });

  // ---- Task 4 count test (unchanged) ----------------------------------------

  it("counts running runs across all agents in the instance", async () => {
    const companyId = randomUUID();
    const firstAgentId = randomUUID();
    const secondAgentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: firstAgentId,
        companyId,
        name: "CodexCoder",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: secondAgentId,
        companyId,
        name: "QAChecker",
        role: "qa",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(heartbeatRuns).values([
      {
        id: randomUUID(),
        companyId,
        agentId: firstAgentId,
        invocationSource: "assignment",
        triggerDetail: "system",
        status: "running",
      },
      {
        id: randomUUID(),
        companyId,
        agentId: firstAgentId,
        invocationSource: "assignment",
        triggerDetail: "system",
        status: "running",
      },
      {
        id: randomUUID(),
        companyId,
        agentId: secondAgentId,
        invocationSource: "assignment",
        triggerDetail: "system",
        status: "running",
      },
      {
        id: randomUUID(),
        companyId,
        agentId: secondAgentId,
        invocationSource: "assignment",
        triggerDetail: "system",
        status: "queued",
      },
    ]);

    expect(await heartbeat.countRunningRunsInstanceWide()).toBe(3);
  });

  // ---- Task 5 admission gate cases ------------------------------------------

  it("never exceeds the instance cap under saturation (exit criterion)", async () => {
    const companyId = await createCompany();
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
    const agentIds = await createAgents(companyId, 30, { maxConcurrentRuns: 20 });
    await saturateQueue(companyId, agentIds, 20);
    for (let tick = 0; tick < 5; tick++) {
      await runTickForAllAgents(agentIds);
      // The gate counts real running rows inside the lock and only executeRun can
      // reduce that count, so the instance-wide running total is never above the cap.
      expect(await countRunning()).toBeLessThanOrEqual(10);
    }
  });

  it("is a no-op when the cap is unset (behavior identical to today)", async () => {
    // no updateGeneral call => unlimited
    const companyId = await createCompany();
    const agentIds = await createAgents(companyId, 3, { maxConcurrentRuns: 2 });
    await saturateQueue(companyId, agentIds, 5);
    // Each agent still claims exactly its per-agent cap (2), unbounded by any instance cap.
    expect(await runTickForAllAgents(agentIds)).toBe(6);
  });

  it("binds on the tighter of per-agent and instance caps", async () => {
    const companyId = await createCompany();
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
    const [agentId] = await createAgents(companyId, 1, { maxConcurrentRuns: 2 });
    await saturateQueue(companyId, [agentId], 5);
    // per-agent cap (2) still binds even though the instance cap (10) is looser.
    expect(await runTickForAllAgents([agentId])).toBe(2);
  });

  it("falls back to per-agent-only when the cap lookup throws (fail-open)", async () => {
    const companyId = await createCompany();
    // A cap that WOULD restrict admission: with the gate active the two agents could
    // only admit 1 run total (cap 1). If the lookup instead throws and we fail open,
    // each agent admits its full per-agent budget (2) => 4 total. Asserting 4 proves the
    // fail-open path actually fired (a plain unset-cap scenario would also yield 4 and
    // could pass by accident).
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 1 });
    const spy = vi
      .spyOn(instanceSettingsModule, "instanceSettingsService")
      .mockImplementation(() => {
        throw new Error("db blip");
      });
    const agentIds = await createAgents(companyId, 2, { maxConcurrentRuns: 2 });
    await saturateQueue(companyId, agentIds, 5);
    expect(await runTickForAllAgents(agentIds)).toBe(4); // runs still start
    spy.mockRestore();
  });

  it("does not acquire the instance admission lock when the cap is unset", async () => {
    // Explicitly clear any instance cap left over from a prior test (a falsy value
    // resets to "unlimited" per the settings service). Unlimited => must stay
    // byte-identical to today: no global lock and no instance-wide count query.
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 0 });
    const companyId = await createCompany();
    const agentIds = await createAgents(companyId, 3, { maxConcurrentRuns: 2 });
    await saturateQueue(companyId, agentIds, 5);
    const lockSpy = vi.spyOn(instanceAdmissionLockModule, "withInstanceAdmissionLock");
    expect(await runTickForAllAgents(agentIds)).toBe(6); // per-agent budget only
    expect(lockSpy).not.toHaveBeenCalled();
  });

  it("acquires the instance admission lock when a cap is configured", async () => {
    // Positive counterpart to the unset test above: guards against a mis-wired
    // spy silently passing the not.toHaveBeenCalled() assertion.
    const companyId = await createCompany();
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
    const [agentId] = await createAgents(companyId, 1, { maxConcurrentRuns: 2 });
    await saturateQueue(companyId, [agentId], 5);
    const lockSpy = vi.spyOn(instanceAdmissionLockModule, "withInstanceAdmissionLock");
    expect(await runTickForAllAgents([agentId])).toBe(2); // per-agent cap still binds
    expect(lockSpy).toHaveBeenCalled();
  });

  it("under-admits (never breaches) when running rows are leaked", async () => {
    const companyId = await createCompany();
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
    await seedOrphanRunningRows(companyId, 10); // simulate a crash leak
    const agentIds = await createAgents(companyId, 3, { maxConcurrentRuns: 20 });
    await saturateQueue(companyId, agentIds, 20);
    const admitted = await runTickForAllAgents(agentIds);
    expect(admitted).toBe(0); // 0 new admitted; never > cap
    expect(await countRunning()).toBe(10); // leaked rows untouched
  });

  // ---- Task 4 per-company cap cases ------------------------------------------
  //
  // Determinism note: these assert on the SYNCHRONOUS claimed count returned by a single
  // startNextQueuedRunForAgent(...) call. Within one call every claim (queued->running)
  // completes before the fire-and-forget executeRun(...) loop fires, so no background
  // run can drain a row mid-decision. DB running-count reads AFTER a tick are avoided
  // for exact assertions because executeRun's async aftermath makes them non-deterministic.

  it("caps a company's running runs and leaves other companies unaffected", async () => {
    // Instance cap unset so the ONLY ceiling is company A's. (Instance settings persist
    // across tests — a falsy value resets to "unlimited".)
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 0 });
    const companyA = await createCompany();
    const companyB = await createCompany();
    await db.update(companies).set({ maxConcurrentRuns: 3 }).where(eq(companies.id, companyA));
    const [agentA] = await createAgents(companyA, 1, { maxConcurrentRuns: 20 });
    const [agentB] = await createAgents(companyB, 1, { maxConcurrentRuns: 20 });
    await saturateQueue(companyA, [agentA], 20);
    await saturateQueue(companyB, [agentB], 20);
    // Company A: one admission call claims exactly the company cap (3). RED before the
    // company gate exists: instance unset => fast path claims the full per-agent budget (20).
    const claimedA = await heartbeat.startNextQueuedRunForAgent(agentA);
    expect(claimedA.length).toBe(3);
    // Company B (uncapped) is NOT throttled by A's ceiling: it claims its full per-agent budget.
    const claimedB = await heartbeat.startNextQueuedRunForAgent(agentB);
    expect(claimedB.length).toBe(20);
  });

  it("binds on the tighter of instance and company caps (company tighter)", async () => {
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 10 });
    const company = await createCompany();
    await db.update(companies).set({ maxConcurrentRuns: 3 }).where(eq(companies.id, company));
    const [agent] = await createAgents(company, 1, { maxConcurrentRuns: 20 });
    await saturateQueue(company, [agent], 20);
    // budget = min(perAgent 20, instance 10, company 3) => company (3) binds. RED before the
    // company gate: min(20, 10) => 10 claimed.
    const claimed = await heartbeat.startNextQueuedRunForAgent(agent);
    expect(claimed.length).toBe(3);
  });

  it("binds on the tighter of instance and company caps (instance tighter)", async () => {
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 3 });
    const company = await createCompany();
    await db.update(companies).set({ maxConcurrentRuns: 10 }).where(eq(companies.id, company));
    const [agent] = await createAgents(company, 1, { maxConcurrentRuns: 20 });
    await saturateQueue(company, [agent], 20);
    // budget = min(perAgent 20, instance 3, company 10) => instance (3) binds. The company
    // cap (10) must NOT loosen the tighter instance ceiling.
    const claimed = await heartbeat.startNextQueuedRunForAgent(agent);
    expect(claimed.length).toBe(3);
  });

  it("does not acquire the lock when neither instance nor company cap is set", async () => {
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 0 });
    const company = await createCompany(); // company cap null by default
    const agents = await createAgents(company, 3, { maxConcurrentRuns: 2 });
    await saturateQueue(company, agents, 5);
    const lockSpy = vi.spyOn(instanceAdmissionLockModule, "withInstanceAdmissionLock");
    expect(await runTickForAllAgents(agents)).toBe(6); // per-agent budget only (3 x 2)
    expect(lockSpy).not.toHaveBeenCalled();
  });

  it("falls back (fail-open) when the company cap lookup throws", async () => {
    // Instance cap unset; company cap = 1 WOULD restrict admission to 1 run total. If the
    // company-cap lookup fails open, both scopes are unset => per-agent only: 2 x 2 = 4.
    await instanceSettingsService(db).updateGeneral({ maxConcurrentRuns: 0 });
    const company = await createCompany();
    await db.update(companies).set({ maxConcurrentRuns: 1 }).where(eq(companies.id, company));
    const agents = await createAgents(company, 2, { maxConcurrentRuns: 2 });
    await saturateQueue(company, agents, 5);
    // Force the accessor's `SELECT max_concurrent_runs FROM companies` to throw by dropping
    // the column mid-test. This is the only path in admission that reads that column, so the
    // throw is isolated to getCompanyMaxConcurrentRuns' try/catch. If that catch were
    // removed the error would propagate out of startNextQueuedRunForAgent and this tick
    // would reject (admitted !== 4 => RED), so the test genuinely exercises the catch.
    let admitted: number;
    await db.execute(sql`ALTER TABLE companies DROP COLUMN max_concurrent_runs`);
    try {
      admitted = await runTickForAllAgents(agents);
    } finally {
      // Restore the exact DDL (nullable integer) before teardown / other tests.
      await db.execute(sql`ALTER TABLE companies ADD COLUMN max_concurrent_runs integer`);
    }
    expect(admitted).toBe(4); // company gate bypassed => per-agent only, runs still start
  });
});
// [END: module]
