/**
 * FILE: server/src/services/bounded-agent-approver.test.ts
 * ABOUT: bounded-agent-approver.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - bounded-agent-approver.test.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: bounded-agent-approver.test.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/bounded-agent-approver.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { boundedAgentApproverService } from "./bounded-agent-approver.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping bounded-agent service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

describeEmbeddedPostgres("boundedAgentApproverService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("bounded-agent-service");
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

  it("creates, lists active, gets, and revokes a bounded-agent grant", async () => {
    const companyId = await seedCompany();
    const svc = boundedAgentApproverService(db);
    const now = new Date();
    const grant = await svc.createGrant(companyId, "human-1", {
      delegateAgentId: "mgr-agent",
      approvalTypes: ["work_product"],
      maxBand: "low",
      maxSpendCents: 1000,
      validUntil: new Date(now.getTime() + 86_400_000),
    });
    expect(grant.delegateAgentId).toBe("mgr-agent");

    expect(await svc.getGrant(grant.id)).not.toBeNull();

    const active = await svc.listGrants(companyId, { activeAt: now });
    expect(active.map((g) => g.id)).toContain(grant.id);

    const revoked = await svc.revokeGrant(grant.id, new Date());
    expect(revoked?.revokedAt).not.toBeNull();
    const activeAfter = await svc.listGrants(companyId, { activeAt: new Date() });
    expect(activeAfter.map((g) => g.id)).not.toContain(grant.id);
  });
});
// [END: module]
