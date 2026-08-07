/**
 * FILE: server/src/__tests__/telegram-link-service.test.ts
 * ABOUT: telegram-link-service.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - DB-backed tests for one-time Telegram chat link codes and binding resolution.
 */
// ==========================================
// [META: module]
// INTENT: Prove that a Telegram chat can only act for a company after redeeming a one-time code issued
//   to a named user, that codes are single-use and expire, and that revocation takes effect immediately.
// PSEUDOCODE: 1. Seed a company. 2. Issue a code, redeem it, assert the binding names the issuing user.
//   3. Assert replay/expiry/unknown-code rejection, re-link supersedes, and revoke unbinds.
// JSON_FLOW: {"file": "server/src/__tests__/telegram-link-service.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, telegramChatBindings } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { telegramLinkService } from "../services/telegram-link.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping telegram link service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("telegramLinkService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof telegramLinkService>;

  const NOW = new Date("2026-08-06T12:00:00.000Z");

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("telegram-link-service");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
    svc = telegramLinkService(db);
  }, 30_000);

  afterEach(async () => {
    await db.delete(telegramChatBindings);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedCompany(): Promise<string> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Acme",
      issuePrefix: `T${companyId.slice(0, 7)}`.toUpperCase(),
      status: "active",
    });
    return companyId;
  }

  it("issues a code that is not guessable from the user id", async () => {
    const companyId = await seedCompany();
    const first = await svc.createLinkCode({ companyId, userId: "user-1", now: NOW });
    const second = await svc.createLinkCode({ companyId, userId: "user-1", now: NOW });
    expect(first.code).not.toEqual(second.code);
    expect(first.code.length).toBeGreaterThanOrEqual(12);
    expect(first.code).not.toContain("user-1");
  });

  // Telegram's deep-link contract: the ?start= payload allows only "A-Z, a-z, 0-9, _ and -" and is
  // "64 characters long" at most. A code outside that set silently breaks the t.me/<bot>?start=<code>
  // link, so pin it here rather than discovering it in a chat.
  it("issues a code that is a legal Telegram deep-link start payload", async () => {
    const companyId = await seedCompany();
    for (let i = 0; i < 20; i += 1) {
      const { code } = await svc.createLinkCode({ companyId, userId: `user-${i}`, now: NOW });
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(code.length).toBeLessThanOrEqual(64);
    }
  });

  it("binds the redeeming chat to the user the code was issued to", async () => {
    const companyId = await seedCompany();
    const { code } = await svc.createLinkCode({ companyId, userId: "user-1", now: NOW });

    const redeemed = await svc.redeemLinkCode({ code, chatId: "555", telegramUserId: "42", now: NOW });

    expect(redeemed.ok).toBe(true);
    expect(redeemed.ok && redeemed.binding.userId).toBe("user-1");
    expect(redeemed.ok && redeemed.binding.companyId).toBe(companyId);
    expect(redeemed.ok && redeemed.binding.chatId).toBe("555");
  });

  it("refuses to redeem the same code twice", async () => {
    const companyId = await seedCompany();
    const { code } = await svc.createLinkCode({ companyId, userId: "user-1", now: NOW });
    await svc.redeemLinkCode({ code, chatId: "555", telegramUserId: "42", now: NOW });

    const replay = await svc.redeemLinkCode({ code, chatId: "999", telegramUserId: "42", now: NOW });

    expect(replay).toEqual({ ok: false, reason: "unknown_code" });
  });

  it("refuses an expired code", async () => {
    const companyId = await seedCompany();
    const { code } = await svc.createLinkCode({ companyId, userId: "user-1", now: NOW, ttlMinutes: 15 });

    const late = new Date(NOW.getTime() + 16 * 60_000);
    expect(await svc.redeemLinkCode({ code, chatId: "555", telegramUserId: "42", now: late })).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a code it never issued", async () => {
    await seedCompany();
    expect(await svc.redeemLinkCode({ code: "not-a-real-code", chatId: "555", telegramUserId: "42", now: NOW })).toEqual({
      ok: false,
      reason: "unknown_code",
    });
  });

  it("resolves the live binding for a company and chat", async () => {
    const companyId = await seedCompany();
    const { code } = await svc.createLinkCode({ companyId, userId: "user-1", now: NOW });
    await svc.redeemLinkCode({ code, chatId: "555", telegramUserId: "42", now: NOW });

    const binding = await svc.resolveBinding({ companyId, chatId: "555" });
    expect(binding?.userId).toBe("user-1");
  });

  it("does not resolve a chat that was never linked to this company", async () => {
    const companyId = await seedCompany();
    expect(await svc.resolveBinding({ companyId, chatId: "555" })).toBeNull();
  });

  it("stops resolving a binding once it is revoked", async () => {
    const companyId = await seedCompany();
    const { code } = await svc.createLinkCode({ companyId, userId: "user-1", now: NOW });
    const redeemed = await svc.redeemLinkCode({ code, chatId: "555", telegramUserId: "42", now: NOW });

    const revoked = await svc.revokeBinding({ companyId, id: redeemed.ok ? redeemed.binding.id : "" });

    expect(revoked).toBe(true);
    expect(await svc.resolveBinding({ companyId, chatId: "555" })).toBeNull();
  });

  it("lets a revoked chat be re-linked to a different user", async () => {
    const companyId = await seedCompany();
    const first = await svc.createLinkCode({ companyId, userId: "user-1", now: NOW });
    const firstBinding = await svc.redeemLinkCode({ code: first.code, chatId: "555", telegramUserId: "42", now: NOW });
    await svc.revokeBinding({ companyId, id: firstBinding.ok ? firstBinding.binding.id : "" });

    const second = await svc.createLinkCode({ companyId, userId: "user-2", now: NOW });
    const redeemed = await svc.redeemLinkCode({ code: second.code, chatId: "555", telegramUserId: "42", now: NOW });

    expect(redeemed.ok).toBe(true);
    expect((await svc.resolveBinding({ companyId, chatId: "555" }))?.userId).toBe("user-2");
  });

  it("supersedes an existing live binding when the same chat redeems a new code", async () => {
    const companyId = await seedCompany();
    const first = await svc.createLinkCode({ companyId, userId: "user-1", now: NOW });
    await svc.redeemLinkCode({ code: first.code, chatId: "555", telegramUserId: "42", now: NOW });

    const second = await svc.createLinkCode({ companyId, userId: "user-2", now: NOW });
    const redeemed = await svc.redeemLinkCode({ code: second.code, chatId: "555", telegramUserId: "42", now: NOW });

    expect(redeemed.ok).toBe(true);
    expect((await svc.resolveBinding({ companyId, chatId: "555" }))?.userId).toBe("user-2");
  });

  it("lists only the live bindings for a company", async () => {
    const companyId = await seedCompany();
    const live = await svc.createLinkCode({ companyId, userId: "user-1", now: NOW });
    await svc.redeemLinkCode({ code: live.code, chatId: "555", telegramUserId: "42", now: NOW });
    const revoked = await svc.createLinkCode({ companyId, userId: "user-2", now: NOW });
    const revokedBinding = await svc.redeemLinkCode({ code: revoked.code, chatId: "777", telegramUserId: "42", now: NOW });
    await svc.revokeBinding({ companyId, id: revokedBinding.ok ? revokedBinding.binding.id : "" });
    await svc.createLinkCode({ companyId, userId: "user-3", now: NOW }); // never redeemed

    const rows = await svc.listBindings(companyId);

    expect(rows.map((r) => r.userId)).toEqual(["user-1"]);
  });
});
// [END: module]
