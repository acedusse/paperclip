/**
 * FILE: server/src/__tests__/heartbeat-idle-streak.test.ts
 * ABOUT: heartbeat-idle-streak.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - heartbeat-idle-streak.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: heartbeat-idle-streak.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/heartbeat-idle-streak.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat idle streak tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat idle streak", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-idle-streak-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAgent(opts: {
    heartbeatIdleStreak: number;
  }): Promise<{ heartbeat: ReturnType<typeof heartbeatService>; db: ReturnType<typeof createDb>; agentId: string }> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
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
      heartbeatIdleStreak: opts.heartbeatIdleStreak,
    });
    return { heartbeat, db, agentId };
  }

  it("increments after an empty timer heartbeat", async () => {
    const { heartbeat, db, agentId } = await seedAgent({ heartbeatIdleStreak: 0 });
    const next = await heartbeat.applyIdleStreakUpdate(agentId, {
      wakeReason: "heartbeat_timer",
      outcome: "succeeded",
      livenessState: "empty_response",
    });
    expect(next).toBe(1);
    const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(row.heartbeatIdleStreak).toBe(1);
  });

  it("resets to 0 after a productive timer heartbeat", async () => {
    const { heartbeat, agentId } = await seedAgent({ heartbeatIdleStreak: 4 });
    expect(
      await heartbeat.applyIdleStreakUpdate(agentId, {
        wakeReason: "heartbeat_timer",
        outcome: "succeeded",
        livenessState: "advanced",
      }),
    ).toBe(0);
  });

  it("resets to 0 when an event wake completes", async () => {
    const { heartbeat, agentId } = await seedAgent({ heartbeatIdleStreak: 4 });
    expect(
      await heartbeat.applyIdleStreakUpdate(agentId, {
        wakeReason: "issue_monitor_due",
        outcome: "succeeded",
        livenessState: "empty_response",
      }),
    ).toBe(0);
  });

  it("resets to 0 on a failed timer heartbeat", async () => {
    const { heartbeat, agentId } = await seedAgent({ heartbeatIdleStreak: 4 });
    expect(
      await heartbeat.applyIdleStreakUpdate(agentId, {
        wakeReason: "heartbeat_timer",
        outcome: "failed",
        livenessState: "empty_response",
      }),
    ).toBe(0);
  });
});
// [END: module]
