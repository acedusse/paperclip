/**
 * FILE: server/src/__tests__/combo10-demo-company.test.ts
 * ABOUT: combo10-demo-company.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - combo10-demo-company.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: combo10-demo-company.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/combo10-demo-company.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, budgetPolicies, companies, createDb, goals, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  DEMO_BLUEPRINT,
  DEMO_TEMPLATE,
  demoCompanyService,
  planDemoCompany,
} from "../services/demo-company/index.ts";
import { findUndeclaredPlaceholders } from "../services/blueprints/variables.ts";

describe("demo blueprint (pure)", () => {
  it("plans successfully with no operator input at all", () => {
    // The whole point of the demo is one click, so every variable must have a
    // usable default.
    const plan = planDemoCompany({});
    expect(plan.ok).toBe(true);
    expect(plan.issues).toEqual([]);
  });

  it("declares every placeholder the template uses", () => {
    expect(findUndeclaredPlaceholders(DEMO_TEMPLATE, DEMO_BLUEPRINT)).toEqual([]);
  });

  it("defaults to an adapter that needs no API key", () => {
    const adapter = DEMO_BLUEPRINT.variables.find((v) => v.key === "adapterType")!;
    expect(adapter.default).toBe("process");
  });

  it("defaults to a small budget ceiling so a broken demo cannot run away", () => {
    const budget = DEMO_BLUEPRINT.variables.find((v) => v.key === "budgetCents")!;
    expect(Number(budget.default)).toBeGreaterThan(0);
    expect(Number(budget.default)).toBeLessThanOrEqual(1000);
  });

  it("substitutes the goal into the issue titles", () => {
    const plan = planDemoCompany({ goal: "Write the launch post" });
    expect(plan.resolved!.issues[0]!.title).toContain("Write the launch post");
    expect(plan.resolved!.issues[0]!.title).not.toContain("{{");
  });

  it("rejects an adapter outside the declared options", () => {
    const plan = planDemoCompany({ adapterType: "gpt5" });
    expect(plan.ok).toBe(false);
    expect(plan.resolved).toBeNull();
    expect(plan.issues[0]!.variableKey).toBe("adapterType");
  });

  it("rejects a budget above the declared ceiling", () => {
    const plan = planDemoCompany({ budgetCents: 10_000_000 });
    expect(plan.ok).toBe(false);
  });

  it("leaves the org chart acyclic", () => {
    const plan = planDemoCompany({});
    const specs = plan.resolved!.agents;
    expect(specs[0]!.reportsToIndex).toBeNull();
    for (const [index, spec] of specs.entries()) {
      // Every manager must appear earlier in the list, which both guarantees
      // acyclicity and lets creation run in one pass.
      if (spec.reportsToIndex !== null) expect(spec.reportsToIndex).toBeLessThan(index);
    }
  });
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("demoCompanyService", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-demo-company-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql.raw(`TRUNCATE TABLE "companies" CASCADE`));
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("creates a complete, runnable demo company from defaults", async () => {
    const result = await demoCompanyService(db).create({});

    expect(result.ok).toBe(true);
    const companyId = result.companyId!;

    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    expect(company!.name).toBe("Demo Co");

    const agentRows = await db.select().from(agents).where(eq(agents.companyId, companyId));
    expect(agentRows).toHaveLength(2);

    const goalRows = await db.select().from(goals).where(eq(goals.companyId, companyId));
    expect(goalRows).toHaveLength(1);
    expect(goalRows[0]!.status).toBe("active");

    const issueRows = await db.select().from(issues).where(eq(issues.companyId, companyId));
    expect(issueRows).toHaveLength(2);
    // Every issue is assigned and goal-linked, so the demo has no orphan work.
    for (const issue of issueRows) {
      expect(issue.assigneeAgentId).not.toBeNull();
      expect(issue.goalId).toBe(goalRows[0]!.id);
    }

    const budgetRows = await db.select().from(budgetPolicies).where(eq(budgetPolicies.companyId, companyId));
    expect(budgetRows).toHaveLength(1);
    expect(budgetRows[0]!.isActive).toBe(true);
  });

  it("wires the reporting chain without leaving a dangling manager", async () => {
    const result = await demoCompanyService(db).create({});
    const agentRows = await db.select().from(agents).where(eq(agents.companyId, result.companyId!));

    const ids = new Set(agentRows.map((row) => row.id));
    const roots = agentRows.filter((row) => row.reportsTo === null);
    expect(roots).toHaveLength(1);
    for (const row of agentRows) {
      if (row.reportsTo !== null) expect(ids.has(row.reportsTo)).toBe(true);
    }
  });

  it("seeds acceptance criteria from the work template", async () => {
    const result = await demoCompanyService(db).create({});
    const issueRows = await db.select().from(issues).where(eq(issues.companyId, result.companyId!));

    // applyWorkTemplate folds criteria into the description on the way in.
    expect(issueRows.every((row) => (row.description ?? "").length > 0)).toBe(true);
  });

  it("honours operator overrides", async () => {
    const result = await demoCompanyService(db).create({
      companyName: "Acme Demo",
      goal: "Launch the newsletter",
      budgetCents: 250,
    });

    const [company] = await db.select().from(companies).where(eq(companies.id, result.companyId!));
    expect(company!.name).toBe("Acme Demo");

    const goalRows = await db.select().from(goals).where(eq(goals.companyId, result.companyId!));
    expect(goalRows[0]!.title).toBe("Launch the newsletter");

    const budgetRows = await db.select().from(budgetPolicies).where(eq(budgetPolicies.companyId, result.companyId!));
    expect(budgetRows[0]!.amount).toBe(250);
  });

  it("writes nothing when the plan is invalid", async () => {
    const before = await db.select().from(companies);

    const result = await demoCompanyService(db).create({ adapterType: "gpt5" });

    expect(result.ok).toBe(false);
    expect(result.companyId).toBeNull();
    const after = await db.select().from(companies);
    expect(after).toHaveLength(before.length);
  });

  it("produces a company that passes its own preflight org-chain check", async () => {
    // The demo must not ship the very misconfiguration combo-10 phase 1 warns
    // about, or the first thing a new operator sees is a red preflight.
    const result = await demoCompanyService(db).create({});
    const agentRows = await db.select().from(agents).where(eq(agents.companyId, result.companyId!));

    const byId = new Map(agentRows.map((row) => [row.id, row]));
    for (const row of agentRows) {
      const seen = new Set<string>([row.id]);
      let cursor = row.reportsTo;
      while (cursor) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = byId.get(cursor)?.reportsTo ?? null;
      }
    }
  });
});
// [END: module]
