import { describe, expect, it } from "vitest";
import { gatherStakeholderSignals } from "./stakeholder-signals.js";
import type { StakeholderToggles } from "./stakeholder-share-policy.js";

const allOff: StakeholderToggles = {
  showGoalProgress: false,
  showShippedWork: false,
  showNarrative: false,
  showActivityTimeline: false,
};

/**
 * Minimal drizzle-shaped stub that counts `select()` calls and hands back a
 * queued result per call. Enough to assert *which* sections were queried —
 * the security property under test — without a database.
 */
function makeSpyDb(queue: unknown[][]) {
  let selectCalls = 0;
  const db = {
    select() {
      const rows = queue[selectCalls] ?? [];
      selectCalls += 1;
      const chain: Record<string, unknown> = {};
      for (const method of ["from", "where", "orderBy", "limit", "innerJoin", "leftJoin", "groupBy"]) {
        chain[method] = () => chain;
      }
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
      return chain;
    },
  };
  return { db: db as never, selectCalls: () => selectCalls };
}

const COMPANY_ROWS = [[{ name: "Acme" }]];

describe("gatherStakeholderSignals — no toggle, no query", () => {
  it("queries only the company identity when every toggle is off", async () => {
    const { db, selectCalls } = makeSpyDb(COMPANY_ROWS);

    const signals = await gatherStakeholderSignals(db, "company-1", allOff);

    expect(signals.companyName).toBe("Acme");
    expect("goalProgress" in signals).toBe(false);
    expect("shippedWork" in signals).toBe(false);
    expect("activityTimeline" in signals).toBe(false);
    // Exactly one query: the company name. No section was fetched.
    expect(selectCalls()).toBe(1);
  });

  it("issues one additional query when goal progress is enabled", async () => {
    const { db, selectCalls } = makeSpyDb([...COMPANY_ROWS, []]);
    await gatherStakeholderSignals(db, "company-1", { ...allOff, showGoalProgress: true });
    expect(selectCalls()).toBe(2);
  });

  it("issues one additional query when shipped work is enabled", async () => {
    const { db, selectCalls } = makeSpyDb([...COMPANY_ROWS, []]);
    await gatherStakeholderSignals(db, "company-1", { ...allOff, showShippedWork: true });
    expect(selectCalls()).toBe(2);
  });

  it("does not query anything extra for the narrative toggle alone", async () => {
    const { db, selectCalls } = makeSpyDb(COMPANY_ROWS);
    const signals = await gatherStakeholderSignals(db, "company-1", { ...allOff, showNarrative: true });
    // The narrative is derived from whatever else was gathered — it has no
    // data source of its own, so it must not widen the query surface.
    expect(selectCalls()).toBe(1);
    expect("goalProgress" in signals).toBe(false);
  });

  it("returns a null-safe company name when the company row is missing", async () => {
    const { db } = makeSpyDb([[]]);
    const signals = await gatherStakeholderSignals(db, "company-1", allOff);
    expect(typeof signals.companyName).toBe("string");
  });
});

describe("gatherStakeholderSignals — shaping", () => {
  it("summarises goal progress by status and keeps only title/status", async () => {
    const { db } = makeSpyDb([
      ...COMPANY_ROWS,
      [
        { title: "Reach 100 customers", status: "active", secret: "should not survive" },
        { title: "Ship v2", status: "achieved" },
      ],
    ]);

    const signals = await gatherStakeholderSignals(db, "company-1", {
      ...allOff,
      showGoalProgress: true,
    });

    expect(signals.goalProgress?.byStatus).toMatchObject({ active: 1, achieved: 1 });
    expect(signals.goalProgress?.goals).toEqual([
      { title: "Reach 100 customers", status: "active" },
      { title: "Ship v2", status: "achieved" },
    ]);
    // Any column that leaked into the row must not survive projection.
    expect(JSON.stringify(signals.goalProgress)).not.toContain("should not survive");
  });

  it("keeps only title/completedAt for shipped work", async () => {
    const completedAt = new Date("2026-07-30T00:00:00.000Z");
    const { db } = makeSpyDb([
      ...COMPANY_ROWS,
      [{ title: "Shipped billing v2", updatedAt: completedAt, description: "internal detail" }],
    ]);

    const signals = await gatherStakeholderSignals(db, "company-1", {
      ...allOff,
      showShippedWork: true,
    });

    expect(signals.shippedWork).toEqual([
      { title: "Shipped billing v2", completedAt: completedAt.toISOString() },
    ]);
    expect(JSON.stringify(signals.shippedWork)).not.toContain("internal detail");
  });
});
