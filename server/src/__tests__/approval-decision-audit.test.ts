/**
 * FILE: server/src/__tests__/approval-decision-audit.test.ts
 * ABOUT: approval-decision-audit.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - approval-decision-audit.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: approval-decision-audit.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/approval-decision-audit.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { activityLog, approvals, companies, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { recordDecision } from "../services/approval-decision-audit.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping approval decision audit tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("recordDecision", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("approval-decision-audit");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(approvals);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedCompany(name = "Acme") {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `T${companyId.slice(0, 7)}`.toUpperCase(),
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return companyId;
  }

  async function seedApproval(companyId: string) {
    const [approval] = await db
      .insert(approvals)
      .values({
        companyId,
        type: "issue_promotion",
        status: "pending",
        payload: { note: "seed" },
      })
      .returning();
    return approval!.id;
  }

  it("writes exactly one unified approval.decision activity row with method/outcome/risk details", async () => {
    const companyId = await seedCompany();
    const approvalId = await seedApproval(companyId);

    await recordDecision(db, {
      approvalId,
      companyId,
      actor: { actorType: "user", actorId: "user-1" },
      method: "explicit_human",
      outcome: "approved",
      risk: { score: 42, band: "high" },
      note: "looks good",
    });

    const rows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "approval.decision"));

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.entityType).toBe("approval");
    expect(row.entityId).toBe(approvalId);
    expect(row.companyId).toBe(companyId);
    expect(row.actorType).toBe("user");
    expect(row.actorId).toBe("user-1");
    expect(row.details).toMatchObject({
      method: "explicit_human",
      outcome: "approved",
      riskBand: "high",
      riskScore: 42,
      note: "looks good",
    });
  });

  it("does not populate risk/note details when omitted", async () => {
    const companyId = await seedCompany();
    const approvalId = await seedApproval(companyId);

    await recordDecision(db, {
      approvalId,
      companyId,
      actor: { actorType: "agent", actorId: "agent-1", agentId: null },
      method: "bounded_agent",
      outcome: "rejected",
    });

    const rows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "approval.decision"));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).toMatchObject({
      method: "bounded_agent",
      outcome: "rejected",
      riskBand: null,
      riskScore: null,
      note: null,
    });
  });
});
// [END: module]
