/**
 * FILE: server/src/__tests__/heartbeat-cadence-transition-observability.test.ts
 * ABOUT: Integration proof for the cadence-transition audit emitted from
 * applyIdleStreakUpdate (idea 035 follow-up). On a real effective-interval
 * change (backoff or reset) the seam writes an
 * `agent.heartbeat_cadence_transition` activity-log row carrying a startable
 * backlog snapshot; it stays silent when the streak moves but the effective
 * interval doesn't (already pinned at the cap), and it fails open (the
 * streak write still happens, no throw) when the backlog-count query errors.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { activityLog, agents, companies, createDb, issues, projects } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";

// Fault-isolation seam: heartbeat.ts calls issueService(db) exactly once, inside
// heartbeatService(db)'s closure (not per-tick and not exposed on the returned
// heartbeat object), so a test can't vi.spyOn the live instance directly. Instead we
// wrap the module's factory export so the resulting service delegates to the REAL
// implementation for every call/method -- preserving byte-identical behavior for the
// other cases -- except startableIssueCountForAgent, which rejects on demand when
// startableCountFault.shouldThrow is flipped on for the duration of a single test. This
// lets the fail-open test below force exactly the throw the cadence-transition audit's
// try/catch (heartbeat.ts's applyIdleStreakUpdate) is meant to catch, without touching
// any production file. Mirrors the pattern used for activeClaimCountsForWorkspaces in
// heartbeat-claim-aware-selection-tick.test.ts.
const startableCountFault = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock("../services/issues.ts", async () => {
  const actual = await vi.importActual<typeof import("../services/issues.ts")>("../services/issues.ts");
  return {
    ...actual,
    issueService: (db: Parameters<typeof actual.issueService>[0]) => {
      const real = actual.issueService(db);
      return {
        ...real,
        startableIssueCountForAgent: async (
          ...args: Parameters<typeof real.startableIssueCountForAgent>
        ) => {
          if (startableCountFault.shouldThrow) {
            throw new Error("simulated startableIssueCountForAgent failure (test fault injection)");
          }
          return real.startableIssueCountForAgent(...args);
        },
      };
    },
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres cadence-transition observability tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat cadence-transition observability", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-cadence-transition-obs-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    startableCountFault.shouldThrow = false;
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // Seeds a company + agent with idle-backoff enabled (base interval 60s,
  // multiplier 2, cap 480s) and `startableCount` startable ("todo") issues
  // assigned to it, at the given initial heartbeatIdleStreak.
  async function seedBackoffAgentWithBacklog(
    startableCount: number,
    initialStreak = 0,
  ): Promise<{ agentId: string }> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const projectId = randomUUID();
    await db.insert(projects).values({ id: projectId, companyId, name: "Proj" });
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `Agent-${agentId.slice(0, 8)}`,
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          intervalSec: 60,
          idleBackoff: { enabled: true, multiplier: 2, maxIntervalSec: 480 },
        },
      },
      permissions: {},
      heartbeatIdleStreak: initialStreak,
    });
    for (let i = 0; i < startableCount; i++) {
      await db.insert(issues).values({
        id: randomUUID(),
        companyId,
        projectId,
        title: `Issue ${i}`,
        status: "todo",
        assigneeAgentId: agentId,
      });
    }
    return { agentId };
  }

  function forceStartableCountToThrow(): () => void {
    startableCountFault.shouldThrow = true;
    return () => {
      startableCountFault.shouldThrow = false;
    };
  }

  it("logs a backoff transition with a backlog snapshot on the first empty heartbeat", async () => {
    const { agentId } = await seedBackoffAgentWithBacklog(3); // 3 startable issues
    await heartbeat.applyIdleStreakUpdate(agentId, {
      wakeReason: "heartbeat_timer",
      outcome: "succeeded",
      livenessState: null,
    });
    const rows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, "agent.heartbeat_cadence_transition"), eq(activityLog.entityId, agentId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({
      direction: "backoff",
      oldStreak: 0,
      newStreak: 1,
      oldIntervalSec: 60,
      newIntervalSec: 120,
      actionableBacklogCount: 3,
    });
  });

  it("logs a reset transition when a productive/event wake collapses the streak", async () => {
    const { agentId } = await seedBackoffAgentWithBacklog(0, /*initialStreak*/ 2);
    await heartbeat.applyIdleStreakUpdate(agentId, {
      wakeReason: "assignment",
      outcome: "succeeded",
      livenessState: null,
    });
    const rows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, "agent.heartbeat_cadence_transition"), eq(activityLog.entityId, agentId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({ direction: "reset", newStreak: 0, actionableBacklogCount: 0 });
  });

  it("writes no entry when the interval is unchanged (already at cap)", async () => {
    // maxIntervalSec 480, base 60, multiplier 2 => cap reached at streak 3; 3 -> 4 pins.
    const { agentId } = await seedBackoffAgentWithBacklog(1, /*initialStreak*/ 3);
    await heartbeat.applyIdleStreakUpdate(agentId, {
      wakeReason: "heartbeat_timer",
      outcome: "succeeded",
      livenessState: null,
    });
    const rows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "agent.heartbeat_cadence_transition"));
    expect(rows).toHaveLength(0);
  });

  it("fails open: a backlog-count error does not break the streak update or throw", async () => {
    const { agentId } = await seedBackoffAgentWithBacklog(1);
    // Force the count query to throw (spy on the heartbeat's issue service seam).
    const restore = forceStartableCountToThrow();
    await expect(
      heartbeat.applyIdleStreakUpdate(agentId, {
        wakeReason: "heartbeat_timer",
        outcome: "succeeded",
        livenessState: null,
      }),
    ).resolves.toBe(1); // streak still advanced to 1
    restore();
    const rows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "agent.heartbeat_cadence_transition"));
    expect(rows).toHaveLength(0); // audit skipped, but no throw
  });
});
