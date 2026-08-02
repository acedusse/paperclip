/**
 * FILE: server/src/services/budgets.token-metric.test.ts
 * ABOUT: budgets.token-metric.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - budgets.token-metric.test.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: budgets.token-metric.test.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/budgets.token-metric.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, budgetPolicies, companies, costEvents, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { computeObservedAmount } from "./budgets.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping token-metric budget tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

describeEmbeddedPostgres("budget token metric", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId!: string;
  let agentId!: string;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("budgets-token-metric");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);

    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Token Metric Co",
      issuePrefix: "TKM",
    });

    agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Token Agent",
    });

    // Two events so the assertion cannot pass by reading a single row.
    await db.insert(costEvents).values([
      {
        companyId,
        agentId,
        provider: "anthropic",
        biller: "anthropic",
        billingType: "subscription_included",
        model: "claude-opus-5",
        inputTokens: 1_000,
        cachedInputTokens: 4_000,
        outputTokens: 500,
        costCents: 0,
        occurredAt: new Date(),
      },
      {
        companyId,
        agentId,
        provider: "anthropic",
        biller: "anthropic",
        billingType: "subscription_included",
        model: "claude-opus-5",
        inputTokens: 2_000,
        cachedInputTokens: 0,
        outputTokens: 100,
        costCents: 0,
        occurredAt: new Date(),
      },
    ]);
  }, 20_000);

  afterAll(async () => {
    await stopDb?.();
  });

  it("sums input, cached and output tokens for a total_tokens policy", async () => {
    const observed = await computeObservedAmount(db, {
      companyId,
      scopeType: "company",
      scopeId: companyId,
      windowKind: "calendar_month_utc",
      metric: "total_tokens",
    });

    // (1000 + 4000 + 500) + (2000 + 0 + 100)
    expect(observed).toBe(7_600);
  });

  it("still sums cents for a billed_cents policy, ignoring tokens", async () => {
    const observed = await computeObservedAmount(db, {
      companyId,
      scopeType: "company",
      scopeId: companyId,
      windowKind: "calendar_month_utc",
      metric: "billed_cents",
    });

    expect(observed).toBe(0);
  });

  it("returns 0 for an unrecognised metric rather than throwing", async () => {
    const observed = await computeObservedAmount(db, {
      companyId,
      scopeType: "company",
      scopeId: companyId,
      windowKind: "calendar_month_utc",
      metric: "not_a_real_metric",
    });

    expect(observed).toBe(0);
  });

  it("round-trips a budget amount above the old int4 ceiling", async () => {
    const hugeAmount = 5_000_000_000;
    const policyId = randomUUID();
    await db.insert(budgetPolicies).values({
      id: policyId,
      companyId,
      scopeType: "agent",
      scopeId: agentId,
      metric: "total_tokens",
      windowKind: "calendar_month_utc",
      amount: hugeAmount,
    });

    const [row] = await db.select().from(budgetPolicies).where(eq(budgetPolicies.id, policyId));
    expect(row?.amount).toBe(hugeAmount);
  });
});
// [END: module]
