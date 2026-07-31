/**
 * FILE: server/src/services/delegation.test.ts
 * ABOUT: delegation.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - delegation.test.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: delegation.test.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/delegation.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { delegationService } from "./delegation.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping delegation service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

describeEmbeddedPostgres("delegationService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("delegation-service");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 20_000);

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

  describe("grants", () => {
    it("creates and reads a grant", async () => {
      const companyId = await seedCompany();
      const svc = delegationService(db);
      const g = await svc.createGrant(companyId, "alice", {
        delegateUserId: "bob",
        approvalTypes: [],
        maxBand: "medium",
        maxSpendCents: 5000,
        validUntil: new Date("2026-12-31T00:00:00Z"),
      });
      expect(g.grantorUserId).toBe("alice");
      expect(await svc.getGrant(g.id)).toMatchObject({ id: g.id, delegateUserId: "bob" });
    });

    it("revokes a grant", async () => {
      const companyId = await seedCompany();
      const svc = delegationService(db);
      const g = await svc.createGrant(companyId, "alice", {
        delegateUserId: "bob",
        approvalTypes: [],
        maxBand: "low",
        maxSpendCents: null,
        validUntil: new Date("2026-12-31T00:00:00Z"),
      });
      const revoked = await svc.revokeGrant(g.id, new Date("2026-07-15T00:00:00Z"));
      expect(revoked?.revokedAt).not.toBeNull();
    });

    it("lists only active grants when activeAt is given", async () => {
      const companyId = await seedCompany();
      const svc = delegationService(db);
      await svc.createGrant(companyId, "alice", {
        delegateUserId: "dave",
        approvalTypes: [],
        maxBand: "low",
        maxSpendCents: null,
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: new Date("2026-06-01T00:00:00Z"),
      }); // expired
      const activeGrant = await svc.createGrant(companyId, "alice", {
        delegateUserId: "carol",
        approvalTypes: [],
        maxBand: "low",
        maxSpendCents: null,
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: new Date("2026-12-31T00:00:00Z"),
      });
      const active = await svc.listGrants(companyId, { activeAt: new Date("2026-07-15T00:00:00Z") });
      expect(active.length).toBeGreaterThan(0);
      expect(active.every((g) => g.revokedAt === null && g.validUntil > new Date("2026-07-15T00:00:00Z"))).toBe(true);
      expect(active.some((g) => g.id === activeGrant.id)).toBe(true);
    });
  });

  describe("coverage config", () => {
    it("returns null before any config, then upserts", async () => {
      const companyId = await seedCompany();
      const svc = delegationService(db);
      expect(await svc.getCoverageConfig(companyId)).toBeNull();
      const cfg = await svc.upsertCoverageConfig(companyId, { enabled: true, backupUserId: "carol", slaHighMinutes: 120 });
      expect(cfg).toMatchObject({ enabled: true, backupUserId: "carol", slaHighMinutes: 120 });
      const cfg2 = await svc.upsertCoverageConfig(companyId, { enabled: false });
      expect(cfg2.enabled).toBe(false);
      expect(cfg2.backupUserId).toBe("carol"); // patch leaves untouched fields
    });
  });

  describe("out-of-office", () => {
    it("enabling creates a broad preset grant; disabling revokes active presets", async () => {
      const companyId = await seedCompany();
      const svc = delegationService(db);
      const now = new Date("2026-07-15T00:00:00Z");
      const on = await svc.setOutOfOffice(companyId, "erin", {
        enabled: true,
        backupUserId: "frank",
        maxBand: "medium",
        until: new Date("2026-08-01T00:00:00Z"),
        now,
      });
      expect(on.grant?.source).toBe("out_of_office");
      expect(on.grant?.approvalTypes).toEqual([]);
      const off = await svc.setOutOfOffice(companyId, "erin", { enabled: false, now });
      expect(off.revokedIds).toContain(on.grant!.id);
    });
  });
});
// [END: module]
