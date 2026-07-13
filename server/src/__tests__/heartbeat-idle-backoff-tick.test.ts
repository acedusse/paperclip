/**
 * FILE: server/src/__tests__/heartbeat-idle-backoff-tick.test.ts
 * ABOUT: Combo-01 Phase 4A Task 6 - tickTimers gated on the idle-backoff effective interval.
 *
 * SECTIONS:
 *   [TAG: module] - heartbeat-idle-backoff-tick.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: Prove tickTimers uses effectiveIntervalSec(policy.intervalSec, agent.heartbeatIdleStreak,
//   policy.idleBackoff) as its due-gate instead of the raw policy.intervalSec, and that disabling
//   idle backoff preserves today's behavior byte-for-byte.
// JSON_FLOW: {"file": "server/src/__tests__/heartbeat-idle-backoff-tick.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

// tickTimers's enqueued wake fires executeRun(...) in the background (fire-and-forget). We only
// assert on the synchronous `enqueued` count returned by tickTimers itself, but we still stub the
// adapter so no real process ever spawns and no error logs are emitted from the async aftermath.
const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Idle-backoff tick test run.",
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
    `Skipping embedded Postgres heartbeat idle-backoff tick tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("tickTimers idle backoff", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  const now = new Date("2026-07-12T00:00:00.000Z");

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  const setup = async () => {
    if (!tempDb) {
      tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-idle-backoff-tick-");
      db = createDb(tempDb.connectionString);
      heartbeat = heartbeatService(db);
    }
  };

  const teardown = async () => {
    if (!db) return;
    // Drain any fire-and-forget executeRun(...) aftermath before deleting rows so a
    // still-running background write can't race a delete of its own parent row.
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
    // heartbeat_runs and agent_wakeup_requests reference each other (wakeup_request_id /
    // run_id), so a plain per-table DELETE order can never satisfy both FKs at once.
    // TRUNCATE ... CASCADE in a single statement sidesteps the cycle entirely. Retry to
    // absorb any last-moment child-row write from a fire-and-forget run still finishing.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await db.execute(sql.raw(`
          TRUNCATE TABLE
            "company_skills",
            "environment_leases",
            "activity_log",
            "heartbeat_run_events",
            "agent_wakeup_requests",
            "workspace_operations",
            "execution_workspaces",
            "agent_runtime_state",
            "heartbeat_runs",
            "agents",
            "companies"
          RESTART IDENTITY CASCADE
        `));
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };

  // Seeds exactly one active, invokable agent (active company, no manager => valid org
  // chain, heartbeat enabled) with the given base interval, idle streak, idle-backoff
  // config, and a lastHeartbeatAt set `lastHeartbeatAgoSec` seconds before `now`.
  async function seedIdleAgent(opts: {
    intervalSec: number;
    streak: number;
    lastHeartbeatAgoSec: number;
    enabled: boolean;
  }) {
    await setup();
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "IdleAgent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: opts.intervalSec,
          idleBackoff: {
            enabled: opts.enabled,
            multiplier: 2,
            maxIntervalSec: 3600,
          },
        },
      },
      permissions: {},
      heartbeatIdleStreak: opts.streak,
      lastHeartbeatAt: new Date(now.getTime() - opts.lastHeartbeatAgoSec * 1000),
    });
    return { heartbeat, companyId, agentId };
  }

  it("does not wake a backed-off idle agent before the effective interval elapses", async () => {
    // base 300s, streak 3, multiplier 2 -> effective 2400s; last heartbeat 1000s ago (>300, <2400)
    const { heartbeat } = await seedIdleAgent({ intervalSec: 300, streak: 3, lastHeartbeatAgoSec: 1000, enabled: true });
    try {
      const result = await heartbeat.tickTimers(now);
      expect(result.enqueued).toBe(0);
    } finally {
      await teardown();
    }
  });

  it("wakes the same agent once the effective interval has elapsed", async () => {
    const { heartbeat } = await seedIdleAgent({ intervalSec: 300, streak: 3, lastHeartbeatAgoSec: 3000, enabled: true });
    try {
      const result = await heartbeat.tickTimers(now);
      expect(result.enqueued).toBe(1);
    } finally {
      await teardown();
    }
  });

  it("with backoff disabled, wakes at the base interval regardless of streak", async () => {
    const { heartbeat } = await seedIdleAgent({ intervalSec: 300, streak: 9, lastHeartbeatAgoSec: 400, enabled: false });
    try {
      const result = await heartbeat.tickTimers(now);
      expect(result.enqueued).toBe(1);
    } finally {
      await teardown();
    }
  });
});
// [END: module]
