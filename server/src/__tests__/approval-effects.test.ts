/**
 * FILE: server/src/__tests__/approval-effects.test.ts
 * ABOUT: approval-effects.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - DB-backed tests for the shared post-decision approval side effects.
 */
// ==========================================
// [META: module]
// INTENT: Pin the behaviour every decision path depends on — the approval.approved/rejected domain
//   events and the requester wakeup — now that it is owned by approvalEffectsService rather than
//   routes/approvals.ts. Only the heavyweight heartbeat is stubbed; activity rows are asserted for real.
// PSEUDOCODE: 1. Stub heartbeat. 2. Seed company/agent. 3. Apply effects. 4. Assert the activity rows.
// JSON_FLOW: {"file": "server/src/__tests__/approval-effects.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { activityLog, agents, approvals, companies, createDb } from "@paperclipai/db";

// The real wakeup spins up an execution environment; the contract under test is what this service
// asks it for and what it logs either way, so inject a stand-in through the service's own seam.
const wakeup = vi.fn();

import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { approvalEffectsService } from "../services/approval-effects.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping approval effects tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("approvalEffectsService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof approvalEffectsService>;

  const ACTOR = { actorType: "user" as const, actorId: "user-1" };

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("approval-effects");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
    svc = approvalEffectsService(db, { heartbeat: { wakeup } as never });
  }, 30_000);

  beforeEach(() => {
    wakeup.mockReset();
    wakeup.mockResolvedValue({ id: "wake-1" });
  });

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(approvals);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedCompany(): Promise<string> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Effects Co",
      issuePrefix: `E${companyId.slice(0, 7)}`.toUpperCase(),
      status: "active",
    });
    return companyId;
  }

  async function seedAgent(companyId: string): Promise<string> {
    const [row] = await db
      .insert(agents)
      .values({ companyId, name: "Requester", role: "engineer", adapterType: "codex_local", adapterConfig: {} })
      .returning();
    return row!.id;
  }

  // listIssuesForApproval reads the real row, so the approval has to exist.
  async function seedApproval(companyId: string, requestedByAgentId: string | null, status = "approved") {
    const [row] = await db
      .insert(approvals)
      .values({ companyId, type: "hire_agent", status, payload: {}, requestedByAgentId })
      .returning();
    return {
      id: row!.id,
      companyId,
      type: row!.type,
      status: row!.status,
      requestedByAgentId: row!.requestedByAgentId,
    };
  }

  async function actionsFor(entityId: string): Promise<string[]> {
    const rows = await db.select().from(activityLog).where(eq(activityLog.entityId, entityId));
    return rows.map((r) => r.action);
  }

  it("emits the approval.approved event", async () => {
    const companyId = await seedCompany();
    const a = await seedApproval(companyId, null);

    await svc.applyApprovalApprovedEffects(a, ACTOR);

    expect(await actionsFor(a.id)).toContain("approval.approved");
  });

  it("wakes the requesting agent with the approval as context", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const a = await seedApproval(companyId, agentId);

    await svc.applyApprovalApprovedEffects(a, ACTOR);

    expect(wakeup).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        reason: "approval_approved",
        contextSnapshot: expect.objectContaining({ approvalId: a.id, wakeReason: "approval_approved" }),
      }),
    );
    expect(await actionsFor(a.id)).toContain("approval.requester_wakeup_queued");
  });

  it("does not wake anyone when no agent requested the approval", async () => {
    const companyId = await seedCompany();

    await svc.applyApprovalApprovedEffects(await seedApproval(companyId, null), ACTOR);

    expect(wakeup).not.toHaveBeenCalled();
  });

  it("records a failed wakeup instead of failing the decision", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const a = await seedApproval(companyId, agentId);
    wakeup.mockRejectedValue(new Error("no runner"));

    await expect(svc.applyApprovalApprovedEffects(a, ACTOR)).resolves.toBeTruthy();

    const actions = await actionsFor(a.id);
    expect(actions).toContain("approval.requester_wakeup_failed");
    expect(actions).not.toContain("approval.requester_wakeup_queued");
  });

  it("emits the approval.rejected event", async () => {
    const companyId = await seedCompany();
    const a = await seedApproval(companyId, null, "rejected");

    await svc.applyApprovalRejectedEffects(a, ACTOR);

    expect(await actionsFor(a.id)).toEqual(["approval.rejected"]);
  });
});
// [END: module]
