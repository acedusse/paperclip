import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { companies, createDb, goals, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

vi.hoisted(() => {
  process.env.PAPERCLIP_HOME = "/tmp/paperclip-test-home";
  process.env.PAPERCLIP_INSTANCE_ID = "vitest";
  process.env.PAPERCLIP_LOG_DIR = "/tmp/paperclip-test-home/logs";
  process.env.PAPERCLIP_IN_WORKTREE = "false";
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping stakeholder share service tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

type Db = ReturnType<typeof createDb>;

describeEmbeddedPostgres("stakeholderShareService", () => {
  let db: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let svc: ReturnType<typeof import("../services/stakeholder-share.js").stakeholderShareService>;
  let companyId: string;
  let otherCompanyId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-stakeholder-share-");
    db = createDb(tempDb.connectionString);

    const { stakeholderShareService } = await import("../services/stakeholder-share.js");
    svc = stakeholderShareService(db);

    // issue_prefix is uniquely indexed, so distinct prefixes are required.
    const [company] = await db
      .insert(companies)
      .values({ name: "Acme", issuePrefix: "ACM" })
      .returning();
    companyId = company!.id;
    const [other] = await db
      .insert(companies)
      .values({ name: "Other", issuePrefix: "OTH" })
      .returning();
    otherCompanyId = other!.id;

    await db.insert(goals).values([
      { companyId, title: "Reach 100 customers", level: "company", status: "active" },
      { companyId, title: "Ship v2", level: "company", status: "achieved" },
      // Internal decomposition — must never reach a stakeholder page.
      { companyId, title: "Refactor the parser", level: "task", status: "active" },
    ]);

    await db.insert(issues).values([
      { companyId, title: "Shipped billing v2", status: "done" },
      { companyId, title: "Still cooking", status: "in_progress" },
    ]);
  }, 180_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("creates a share with every exposure toggle off by default", async () => {
    const row = await svc.create(companyId, { label: "Investors" }, "user-1");
    expect(row.status).toBe("active");
    expect(row.showGoalProgress).toBe(false);
    expect(row.showShippedWork).toBe(false);
    expect(row.showNarrative).toBe(false);
    expect(row.showActivityTimeline).toBe(false);
    expect(row.token.length).toBeGreaterThan(20);
  });

  it("mints a distinct token per share", async () => {
    const a = await svc.create(companyId, { label: "A" }, "user-1");
    const b = await svc.create(companyId, { label: "B" }, "user-1");
    expect(a.token).not.toBe(b.token);
  });

  it("renders nothing but the company name for a freshly created share", async () => {
    const row = await svc.create(companyId, { label: "Fresh" }, "user-1");
    const payload = await svc.resolvePublic(row.token, new Date());
    expect(payload).toMatchObject({ companyName: "Acme" });
    expect("goalProgress" in payload!).toBe(false);
    expect("shippedWork" in payload!).toBe(false);
    expect("narrative" in payload!).toBe(false);
  });

  it("exposes only company/team-level goals when goal progress is enabled", async () => {
    const row = await svc.create(companyId, { label: "Goals", showGoalProgress: true }, "user-1");
    const payload = await svc.resolvePublic(row.token, new Date());
    const titles = payload!.goalProgress!.goals.map((g) => g.title);
    expect(titles).toContain("Reach 100 customers");
    expect(titles).toContain("Ship v2");
    expect(titles).not.toContain("Refactor the parser");
  });

  it("exposes only completed issues as shipped work", async () => {
    const row = await svc.create(companyId, { label: "Shipped", showShippedWork: true }, "user-1");
    const payload = await svc.resolvePublic(row.token, new Date());
    const titles = payload!.shippedWork!.map((w) => w.title);
    expect(titles).toContain("Shipped billing v2");
    expect(titles).not.toContain("Still cooking");
  });

  it("stops resolving the moment a share is revoked", async () => {
    const row = await svc.create(companyId, { label: "Revoke me" }, "user-1");
    expect(await svc.resolvePublic(row.token, new Date())).not.toBeNull();

    await svc.revoke(companyId, row.id, new Date());
    expect(await svc.resolvePublic(row.token, new Date())).toBeNull();
  });

  it("stops resolving once expired", async () => {
    const past = new Date(Date.now() - 60_000);
    const row = await svc.create(companyId, { label: "Expired", expiresAt: past }, "user-1");
    expect(await svc.resolvePublic(row.token, new Date())).toBeNull();
  });

  it("still resolves before the expiry instant", async () => {
    const future = new Date(Date.now() + 600_000);
    const row = await svc.create(companyId, { label: "Live", expiresAt: future }, "user-1");
    expect(await svc.resolvePublic(row.token, new Date())).not.toBeNull();
  });

  it("invalidates the old token on rotate", async () => {
    const row = await svc.create(companyId, { label: "Rotate" }, "user-1");
    const oldToken = row.token;

    const rotated = await svc.rotate(companyId, row.id, new Date());
    expect(rotated!.token).not.toBe(oldToken);
    expect(await svc.resolvePublic(oldToken, new Date())).toBeNull();
    expect(await svc.resolvePublic(rotated!.token, new Date())).not.toBeNull();
  });

  it("applies toggle updates to what the public payload renders", async () => {
    const row = await svc.create(companyId, { label: "Toggle" }, "user-1");
    expect("goalProgress" in (await svc.resolvePublic(row.token, new Date()))!).toBe(false);

    await svc.update(companyId, row.id, { showGoalProgress: true });
    expect("goalProgress" in (await svc.resolvePublic(row.token, new Date()))!).toBe(true);

    await svc.update(companyId, row.id, { showGoalProgress: false });
    expect("goalProgress" in (await svc.resolvePublic(row.token, new Date()))!).toBe(false);
  });

  it("refuses to mutate a share through the wrong company", async () => {
    const row = await svc.create(companyId, { label: "Scoped" }, "user-1");
    expect(await svc.get(otherCompanyId, row.id)).toBeNull();
    expect(await svc.update(otherCompanyId, row.id, { label: "hijacked" })).toBeNull();
    expect(await svc.revoke(otherCompanyId, row.id, new Date())).toBeNull();
    expect(await svc.rotate(otherCompanyId, row.id, new Date())).toBeNull();
    // Untouched by the cross-company attempts.
    expect((await svc.get(companyId, row.id))!.label).toBe("Scoped");
  });

  it("returns null for an unknown token", async () => {
    expect(await svc.resolvePublic("not-a-real-token", new Date())).toBeNull();
  });

  it("never exposes the full token in the operator summary", async () => {
    const { toShareSummary } = await import("../services/stakeholder-share.js");
    const row = await svc.create(companyId, { label: "Summary" }, "user-1");
    const summary = toShareSummary(row);
    expect(JSON.stringify(summary)).not.toContain(row.token);
    expect(summary.tokenTail).toBe(row.token.slice(-6));
  });
});
