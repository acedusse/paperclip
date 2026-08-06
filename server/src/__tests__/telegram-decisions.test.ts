/**
 * FILE: server/src/__tests__/telegram-decisions.test.ts
 * ABOUT: telegram-decisions.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - DB-backed tests for approvals decided from a Telegram inline button.
 */
// ==========================================
// [META: module]
// INTENT: Prove a tapped button only decides an approval when the chat is bound to a user of that exact
//   company, that the decision is attributed to that user and audited as telegram-originated, and that a
//   second tap cannot decide twice.
// PSEUDOCODE: 1. Seed company/approval/binding. 2. Decide from the chat. 3. Assert approval status,
//   decided_by, activity + audit rows. 4. Assert unbound chat, cross-company chat and replay are refused.
// JSON_FLOW: {"file": "server/src/__tests__/telegram-decisions.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { activityLog, approvals, companies, createDb, telegramChatBindings } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { telegramDecisionService } from "../services/telegram-decisions.js";
import { telegramLinkService } from "../services/telegram-link.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping telegram decision tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("telegramDecisionService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof telegramDecisionService>;
  let links!: ReturnType<typeof telegramLinkService>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("telegram-decisions");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
    svc = telegramDecisionService(db);
    links = telegramLinkService(db);
  }, 30_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(approvals);
    await db.delete(telegramChatBindings);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedCompany(name = "Acme"): Promise<string> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `T${companyId.slice(0, 7)}`.toUpperCase(),
      status: "active",
    });
    return companyId;
  }

  async function seedApproval(companyId: string): Promise<string> {
    const [row] = await db
      .insert(approvals)
      .values({ companyId, type: "request_board_approval", status: "pending", payload: {} })
      .returning();
    return row!.id;
  }

  async function bindChat(companyId: string, chatId: string, userId: string) {
    const { code } = await links.createLinkCode({ companyId, userId });
    await links.redeemLinkCode({ code, chatId });
  }

  async function activityActions(companyId: string, entityId: string): Promise<string[]> {
    const rows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, companyId), eq(activityLog.entityId, entityId)));
    return rows.map((r) => r.action);
  }

  it("approves the approval when a bound chat taps Approve", async () => {
    const companyId = await seedCompany();
    const approvalId = await seedApproval(companyId);
    await bindChat(companyId, "555", "user-1");

    const result = await svc.decideFromChat({ companyId, chatId: "555", approvalId, outcome: "approve" });

    expect(result).toMatchObject({ ok: true, applied: true, status: "approved" });
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.status).toBe("approved");
  });

  it("attributes the decision to the user the chat is bound to", async () => {
    const companyId = await seedCompany();
    const approvalId = await seedApproval(companyId);
    await bindChat(companyId, "555", "user-1");

    await svc.decideFromChat({ companyId, chatId: "555", approvalId, outcome: "approve" });

    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.decidedByUserId).toBe("user-1");
  });

  it("audits the decision as telegram-originated", async () => {
    const companyId = await seedCompany();
    const approvalId = await seedApproval(companyId);
    await bindChat(companyId, "555", "user-1");

    await svc.decideFromChat({ companyId, chatId: "555", approvalId, outcome: "approve" });

    const [decision] = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, approvalId), eq(activityLog.action, "approval.decision")));
    expect(decision!.details).toMatchObject({ method: "explicit_human", outcome: "approved", channel: "telegram" });
    expect(decision!.actorId).toBe("user-1");
  });

  it("emits the same approval.approved event as the HTTP route", async () => {
    const companyId = await seedCompany();
    const approvalId = await seedApproval(companyId);
    await bindChat(companyId, "555", "user-1");

    await svc.decideFromChat({ companyId, chatId: "555", approvalId, outcome: "approve" });

    expect(await activityActions(companyId, approvalId)).toContain("approval.approved");
  });

  it("rejects the approval when a bound chat taps Reject", async () => {
    const companyId = await seedCompany();
    const approvalId = await seedApproval(companyId);
    await bindChat(companyId, "555", "user-1");

    const result = await svc.decideFromChat({ companyId, chatId: "555", approvalId, outcome: "reject" });

    expect(result).toMatchObject({ ok: true, status: "rejected" });
    expect(await activityActions(companyId, approvalId)).toContain("approval.rejected");
  });

  it("refuses a chat that is not bound to the company", async () => {
    const companyId = await seedCompany();
    const approvalId = await seedApproval(companyId);

    const result = await svc.decideFromChat({ companyId, chatId: "555", approvalId, outcome: "approve" });

    expect(result).toEqual({ ok: false, reason: "not_bound" });
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.status).toBe("pending");
  });

  it("refuses a chat whose binding was revoked", async () => {
    const companyId = await seedCompany();
    const approvalId = await seedApproval(companyId);
    await bindChat(companyId, "555", "user-1");
    const [binding] = await links.listBindings(companyId);
    await links.revokeBinding({ companyId, id: binding!.id });

    const result = await svc.decideFromChat({ companyId, chatId: "555", approvalId, outcome: "approve" });

    expect(result).toEqual({ ok: false, reason: "not_bound" });
  });

  it("refuses to decide an approval belonging to another company", async () => {
    const companyA = await seedCompany("A");
    const companyB = await seedCompany("B");
    await bindChat(companyA, "555", "user-1");
    const approvalId = await seedApproval(companyB);

    const result = await svc.decideFromChat({ companyId: companyA, chatId: "555", approvalId, outcome: "approve" });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.status).toBe("pending");
  });

  it("reports an unknown approval as not found", async () => {
    const companyId = await seedCompany();
    await bindChat(companyId, "555", "user-1");

    const result = await svc.decideFromChat({
      companyId,
      chatId: "555",
      approvalId: randomUUID(),
      outcome: "approve",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("does not decide twice when the same button is tapped again", async () => {
    const companyId = await seedCompany();
    const approvalId = await seedApproval(companyId);
    await bindChat(companyId, "555", "user-1");
    await svc.decideFromChat({ companyId, chatId: "555", approvalId, outcome: "approve" });

    const second = await svc.decideFromChat({ companyId, chatId: "555", approvalId, outcome: "approve" });

    expect(second).toMatchObject({ ok: true, applied: false });
    const decisions = (await activityActions(companyId, approvalId)).filter((a) => a === "approval.decision");
    expect(decisions).toHaveLength(1);
  });

  it("refuses to flip a decided approval to the opposite outcome", async () => {
    const companyId = await seedCompany();
    const approvalId = await seedApproval(companyId);
    await bindChat(companyId, "555", "user-1");
    await svc.decideFromChat({ companyId, chatId: "555", approvalId, outcome: "approve" });

    const flip = await svc.decideFromChat({ companyId, chatId: "555", approvalId, outcome: "reject" });

    expect(flip).toEqual({ ok: false, reason: "already_decided", status: "approved" });
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row!.status).toBe("approved");
  });
});
// [END: module]
