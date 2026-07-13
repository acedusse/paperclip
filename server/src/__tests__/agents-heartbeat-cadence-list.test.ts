/**
 * FILE: server/src/__tests__/agents-heartbeat-cadence-list.test.ts
 * ABOUT: agents-heartbeat-cadence-list.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - agents-heartbeat-cadence-list.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: Prove agentService(db).list() (the path behind GET
// /companies/:companyId/agents, the list endpoint the UI reads from) exposes
// a computed effectiveHeartbeatIntervalSec alongside heartbeatIdleStreak, not
// just the single-agent detail path (buildAgentDetail / GET /agents/:id).
// JSON_FLOW: {"file": "server/src/__tests__/agents-heartbeat-cadence-list.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentService } from "../services/agents.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres agent service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("agent service list heartbeat cadence exposure", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-cadence-list-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("includes effectiveHeartbeatIntervalSec on the list response, derived from idle streak + idle-backoff config", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Builder",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          intervalSec: 300,
          idleBackoff: { enabled: true, multiplier: 2, maxIntervalSec: 3600 },
        },
      },
      permissions: {},
      heartbeatIdleStreak: 2,
    });

    const rows = await agentService(db).list(companyId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: agentId,
      heartbeatIdleStreak: 2,
      effectiveHeartbeatIntervalSec: 1200, // 300 * 2^2
    });
  }, 20_000);

  it("falls back to the plain configured interval when idle backoff is disabled", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Builder",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: { intervalSec: 300 },
      },
      permissions: {},
      heartbeatIdleStreak: 4,
    });

    const rows = await agentService(db).list(companyId);

    expect(rows[0]).toMatchObject({
      heartbeatIdleStreak: 4,
      effectiveHeartbeatIntervalSec: 300,
    });
  }, 20_000);
});
// [END: module]
