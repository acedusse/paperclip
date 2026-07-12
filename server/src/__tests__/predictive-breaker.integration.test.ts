// Layer-1 integration proof for Combo-01 Phase 3a's predictive budget circuit
// breaker: driven through the REAL admission path
// (heartbeatService.startNextQueuedRunForAgent), against embedded Postgres, so
// the forecast (burn rate + remaining), ladder/hysteresis, cap writer, and
// wind-down all run through their real wiring — no hand-rolled BreakerEvalDeps.
//
// The DB bootstrap (adapter mock, describeEmbeddedPostgres, beforeAll/afterEach/
// afterAll, createCompany/createAgent) is mirrored verbatim from
// __tests__/panic-drain.integration.test.ts / __tests__/run-caps-stamp.integration.test.ts.
// Only the budget/cost-event seeding and breaker assertions are new.
//
// Ladder (see docs/superpowers/specs/2026-07-11-predictive-budget-circuit-breaker-design.md),
// H = breakerHorizonMinutes:
//   tt > 2H          -> normal   (cap: no opinion)
//   tt <= 2H         -> warn     (cap: no opinion)
//   tt <= H          -> throttle (cap: max(1, floor(configuredCap * 0.5)))
//   tt <= H/4 or remaining<=0 -> halt (cap: 0, wind down running runs)
// De-escalation requires BOTH minDwell (10 min) held AND tt past the gapped
// (x1.5) up-threshold for the CURRENT rung, one rung per evaluation.
//
// DWELL-TIMING NOTE: `evaluateBreakerForCompanyUncached` in heartbeat.ts calls
// evaluateCompanyBreaker(breakerDeps, companyId, horizon, new Date()) with the
// real wall clock — `now` is not injectable through the public heartbeat path.
// Scenarios 3 and 4 below control elapsed dwell by writing `company_breaker_state
// .since` directly (the same column the evaluator itself persists and reads via
// loadState/saveState) to simulate "this company has been at this rung for N
// minutes already" — exactly what the design says survives a restart. This does
// NOT bypass the evaluator: evaluateCompanyBreaker, the hysteresis function, and
// the cap writer all still run for real against genuinely-seeded cost_events /
// budget_policies on every tick.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  budgetPolicies,
  companies,
  companyBreakerState,
  companySkills,
  costEvents,
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
    summary: "Predictive-breaker integration test run.",
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
    `Skipping embedded Postgres predictive-breaker tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const MINUTE_MS = 60_000;

describeEmbeddedPostgres("predictive budget circuit breaker (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-predictive-breaker-");
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
      await db.delete(costEvents);
      await db.delete(companyBreakerState);
      await db.delete(budgetPolicies);
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

  async function seedQueuedRun(companyId: string, agentId: string): Promise<string> {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "queued",
    });
    return runId;
  }

  async function enableBreaker(companyId: string, horizonMinutes: number, maxConcurrentRuns?: number) {
    await db
      .update(companies)
      .set({
        predictiveBreakerEnabled: true,
        breakerHorizonMinutes: horizonMinutes,
        ...(maxConcurrentRuns !== undefined ? { maxConcurrentRuns } : {}),
      })
      .where(eq(companies.id, companyId));
  }

  async function seedCompanyBudgetPolicy(companyId: string, amountCents: number) {
    await db.insert(budgetPolicies).values({
      companyId,
      scopeType: "company",
      scopeId: companyId,
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      amount: amountCents,
      isActive: true,
    });
  }

  async function seedCostEvent(companyId: string, agentId: string, costCents: number, occurredAt: Date) {
    await db.insert(costEvents).values({
      id: randomUUID(),
      companyId,
      agentId,
      provider: "test",
      model: "test-model",
      costCents,
      occurredAt,
    });
  }

  it("HALT: spend meeting the budget forces an immediate halt, cap 0, and winds down running runs", async () => {
    const companyId = await createCompany();
    await enableBreaker(companyId, 60);
    await seedCompanyBudgetPolicy(companyId, 1000);

    // A running run to prove wind-down.
    const runningAgentId = await createAgent(companyId);
    const runningRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runningRunId,
      companyId,
      agentId: runningAgentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      startedAt: new Date(),
    });

    // remaining = amount - observed <= 0 forces HALT unconditionally, regardless
    // of burn rate (design: "remaining <= 0 is treated as an immediate HALT
    // trigger regardless of burn rate").
    await seedCostEvent(companyId, runningAgentId, 1000, new Date());

    // startNextQueuedRunForAgent only evaluates the company breaker when the
    // calling agent has a queued run to admit, so a second agent with a queued
    // run is the trigger for this tick's evaluation.
    const triggerAgentId = await createAgent(companyId);
    const queuedRunId = await seedQueuedRun(companyId, triggerAgentId);

    await heartbeat.startNextQueuedRunForAgent(triggerAgentId);

    const [state] = await db
      .select({ level: companyBreakerState.level })
      .from(companyBreakerState)
      .where(eq(companyBreakerState.companyId, companyId));
    expect(state.level).toBe("halt");

    const status = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(status.cap).toBe(0);
    expect(status.source).toBe("predictive-breaker");
    expect(status.breakerLevel).toBe("halt");

    const [runningRow] = await db
      .select({
        status: heartbeatRuns.status,
        reason: heartbeatRuns.windDownReason,
        resume: heartbeatRuns.resumePolicy,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId));
    expect(runningRow.status).toBe("wound_down");
    expect(runningRow.reason).toBe("predictive-breaker-halt");
    expect(runningRow.resume).toBe("when-allowed");

    // cap 0 holds the queued trigger run rather than starting it.
    const [queuedRow] = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, queuedRunId));
    expect(queuedRow.status).toBe("queued");
  });

  it("THROTTLE-before-wall: cap drops to half the configured cap while spend is still well under the budget", async () => {
    const companyId = await createCompany();
    // H = 60min, configuredMax = 10 -> throttle cap = floor(10 * 0.5) = 5.
    await enableBreaker(companyId, 60, 10);
    await seedCompanyBudgetPolicy(companyId, 10_000);

    const agentId = await createAgent(companyId);
    // Single recent cost event drives BOTH the 15-min burn window and the
    // calendar-month observed sum: costCents=3000 of a 10000 budget ->
    // remaining=7000 (>0, well before the wall) but burnRate = 3000/15 = 200
    // cents/min -> timeToLimit = 7000/200 = 35min, inside (H/4, H] = (15, 60]
    // for H=60 -> THROTTLE, asserted BEFORE observed spend reaches the budget.
    await seedCostEvent(companyId, agentId, 3000, new Date());

    const runId = await seedQueuedRun(companyId, agentId);

    const claimed = await heartbeat.startNextQueuedRunForAgent(agentId);

    const [state] = await db
      .select({ level: companyBreakerState.level })
      .from(companyBreakerState)
      .where(eq(companyBreakerState.companyId, companyId));
    expect(state.level).toBe("throttle");

    const status = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(status.source).toBe("predictive-breaker");
    expect(status.cap).toBe(5);
    expect(status.breakerLevel).toBe("throttle");

    // Throttle slows burn, it doesn't block a single run under the reduced cap.
    expect(claimed.map((r) => r.id)).toContain(runId);
  });

  it("NO-OSCILLATION: level holds at the escalated rung across ticks whose raw timeToLimit would otherwise relax it, until dwell elapses", async () => {
    const companyId = await createCompany();
    await enableBreaker(companyId, 60, 10);
    await seedCompanyBudgetPolicy(companyId, 10_000);

    // Tick 1: escalate to THROTTLE (same shape as the throttle-before-wall case).
    const agentA = await createAgent(companyId);
    await seedCostEvent(companyId, agentA, 3000, new Date());
    await seedQueuedRun(companyId, agentA);
    await heartbeat.startNextQueuedRunForAgent(agentA);

    const [afterTick1] = await db
      .select({ level: companyBreakerState.level, since: companyBreakerState.since })
      .from(companyBreakerState)
      .where(eq(companyBreakerState.companyId, companyId));
    expect(afterTick1.level).toBe("throttle");
    const sinceAfterTick1 = afterTick1.since.getTime();

    // Tick 2, moments later (well inside the 10-min minDwell): burn "subsides" to
    // zero (remove the cost event) -> raw classification is NORMAL (tt=Infinity).
    // Hysteresis must still hold THROTTLE because dwell hasn't elapsed.
    await db.delete(costEvents).where(eq(costEvents.companyId, companyId));
    const agentB = await createAgent(companyId);
    await seedQueuedRun(companyId, agentB);
    await heartbeat.startNextQueuedRunForAgent(agentB);

    const [afterTick2] = await db
      .select({ level: companyBreakerState.level, since: companyBreakerState.since })
      .from(companyBreakerState)
      .where(eq(companyBreakerState.companyId, companyId));
    expect(afterTick2.level).toBe("throttle");
    // `since` is untouched by a blocked de-escalation attempt -- the dwell
    // clock keeps counting from when THROTTLE was first entered.
    expect(afterTick2.since.getTime()).toBe(sinceAfterTick1);

    // Tick 3, still moments later: raw classification jitters to WARN this time
    // (tt=15*(10000-1400)/1400 ~= 92.1min, inside (60,120] for H=60) -- still a
    // lower severity than THROTTLE, still blocked by dwell.
    await db.delete(costEvents).where(eq(costEvents.companyId, companyId));
    await seedCostEvent(companyId, agentA, 1400, new Date());
    const agentC = await createAgent(companyId);
    await seedQueuedRun(companyId, agentC);
    await heartbeat.startNextQueuedRunForAgent(agentC);

    const [afterTick3] = await db
      .select({ level: companyBreakerState.level, since: companyBreakerState.since })
      .from(companyBreakerState)
      .where(eq(companyBreakerState.companyId, companyId));
    expect(afterTick3.level).toBe("throttle");
    expect(afterTick3.since.getTime()).toBe(sinceAfterTick1);

    const status = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(status.cap).toBe(5); // still the throttle cap, never relaxed back to 10.
  });

  it("AUTO-RELEASE: de-escalates one rung per tick (halt -> throttle -> warn -> normal) as dwell elapses and burn stays subsided, cap rising monotonically", async () => {
    const companyId = await createCompany();
    // H = 60min, configuredMax = 10.
    await enableBreaker(companyId, 60, 10);
    await seedCompanyBudgetPolicy(companyId, 10_000);
    // No cost events at any point in this scenario -> burn=0, remaining=10000 ->
    // tt=Infinity, i.e. raw classification is always "normal", clearing every
    // up-threshold. This isolates the thing under test: hysteresis releases
    // exactly one rung per tick, gated on dwell.

    // Pre-seed persisted state at HALT with `since` already 11 minutes in the
    // past (see file header: `now` inside evaluateCompanyBreaker is the real
    // wall clock, not injectable through the public heartbeat path, so we
    // control elapsed dwell via the same `since` column the evaluator itself
    // persists/reads).
    const dwellSatisfied = () => new Date(Date.now() - 11 * MINUTE_MS);
    await db.insert(companyBreakerState).values({
      companyId,
      level: "halt",
      since: dwellSatisfied(),
      lastBurnRateCpm: 500,
      lastTimeToLimitM: 5,
      updatedAt: new Date(),
    });

    // Tick A: HALT -> THROTTLE (up-threshold = (H*0.25)*1.5 = 22.5min; tt=Infinity clears it).
    const agentA = await createAgent(companyId);
    await seedQueuedRun(companyId, agentA);
    await heartbeat.startNextQueuedRunForAgent(agentA);

    const [afterA] = await db
      .select({ level: companyBreakerState.level })
      .from(companyBreakerState)
      .where(eq(companyBreakerState.companyId, companyId));
    expect(afterA.level).toBe("throttle");
    const statusA = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(statusA.cap).toBe(5); // floor(10 * 0.5)
    expect(statusA.source).toBe("predictive-breaker");

    // Re-satisfy dwell for the next release step.
    await db.update(companyBreakerState).set({ since: dwellSatisfied() }).where(eq(companyBreakerState.companyId, companyId));

    // Tick B: THROTTLE -> WARN (up-threshold = (H*1)*1.5 = 90min; tt=Infinity clears it).
    const agentB = await createAgent(companyId);
    await seedQueuedRun(companyId, agentB);
    await heartbeat.startNextQueuedRunForAgent(agentB);

    const [afterB] = await db
      .select({ level: companyBreakerState.level })
      .from(companyBreakerState)
      .where(eq(companyBreakerState.companyId, companyId));
    expect(afterB.level).toBe("warn");
    const statusB = await heartbeat.getCompanyAdmissionStatus(companyId);
    // WARN is "cap unchanged" (writer no-opinion) -> falls through to the
    // configured default. Cap rose from 5 to 10 (monotonic, never drops back).
    expect(statusB.cap).toBe(10);
    expect(statusB.source).toBe("configured-default");

    await db.update(companyBreakerState).set({ since: dwellSatisfied() }).where(eq(companyBreakerState.companyId, companyId));

    // Tick C: WARN -> normal (up-threshold = (H*2)*1.5 = 180min; tt=Infinity clears it).
    const agentC = await createAgent(companyId);
    await seedQueuedRun(companyId, agentC);
    await heartbeat.startNextQueuedRunForAgent(agentC);

    const [afterC] = await db
      .select({ level: companyBreakerState.level })
      .from(companyBreakerState)
      .where(eq(companyBreakerState.companyId, companyId));
    expect(afterC.level).toBe("normal");
    const statusC = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(statusC.cap).toBe(10);
    expect(statusC.breakerLevel).toBe("normal");
  });

  it("NO-QUEUE HALT: a saturated, fast-burning company with NO queued runs still escalates to halt and winds down its in-flight run via resumeQueuedRuns", async () => {
    // Regression proof for Task 10: the breaker was previously only evaluated
    // inside startNextQueuedRunForAgent, which early-returns when a company has
    // no queued work. A company saturated with a long-running, fast-burning run
    // and NOTHING queued would therefore never escalate and never auto-halt.
    // resumeQueuedRuns() now sweeps every company with a RUNNING run once per
    // tick. This scenario has ZERO queued runs, so the queued-admission loop is
    // a no-op and ONLY the new running-company pass can produce the halt --
    // i.e. it fails against the pre-fix code path.
    const companyId = await createCompany();
    await enableBreaker(companyId, 60);
    await seedCompanyBudgetPolicy(companyId, 1000);

    // In-flight run, no queued runs anywhere for this company.
    const runningAgentId = await createAgent(companyId);
    const runningRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runningRunId,
      companyId,
      agentId: runningAgentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      startedAt: new Date(),
    });

    // remaining = amount - observed <= 0 forces HALT unconditionally.
    await seedCostEvent(companyId, runningAgentId, 1000, new Date());

    // Drive the per-tick admission sweep (NOT startNextQueuedRunForAgent).
    await heartbeat.resumeQueuedRuns();

    const [state] = await db
      .select({ level: companyBreakerState.level })
      .from(companyBreakerState)
      .where(eq(companyBreakerState.companyId, companyId));
    expect(state.level).toBe("halt");

    const status = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(status.cap).toBe(0);
    expect(status.source).toBe("predictive-breaker");
    expect(status.breakerLevel).toBe("halt");

    const [runningRow] = await db
      .select({
        status: heartbeatRuns.status,
        reason: heartbeatRuns.windDownReason,
        resume: heartbeatRuns.resumePolicy,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId));
    expect(runningRow.status).toBe("wound_down");
    expect(runningRow.reason).toBe("predictive-breaker-halt");
    expect(runningRow.resume).toBe("when-allowed");
  });

  it("NO-QUEUE HEALTHY: a company with a running run but plenty of budget stays normal under the resumeQueuedRuns sweep", async () => {
    const companyId = await createCompany();
    await enableBreaker(companyId, 60, 10);
    await seedCompanyBudgetPolicy(companyId, 10_000);

    const runningAgentId = await createAgent(companyId);
    const runningRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runningRunId,
      companyId,
      agentId: runningAgentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      startedAt: new Date(),
    });

    // Tiny spend against a large budget -> remaining huge, burn negligible ->
    // timeToLimit far past 2H -> NORMAL. No queued runs.
    await seedCostEvent(companyId, runningAgentId, 10, new Date());

    await heartbeat.resumeQueuedRuns();

    const [state] = await db
      .select({ level: companyBreakerState.level })
      .from(companyBreakerState)
      .where(eq(companyBreakerState.companyId, companyId));
    expect(state.level).toBe("normal");

    const [runningRow] = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runningRunId));
    expect(runningRow.status).toBe("running");
  });
});
