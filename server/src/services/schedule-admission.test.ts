// Layer-1 integration proof for Combo-01 Phase 3b's schedule cap + manual
// operator override wiring, driven through the REAL admission status read
// (heartbeatService.getCompanyAdmissionStatus) against embedded Postgres, so
// loadCompanyScheduleContext, the PHASE3B_COMPANY_WRITERS precedence, and the
// manual-override setter/clearer all run through their real wiring.
//
// The DB bootstrap (embedded postgres guard, beforeAll/afterEach/afterAll,
// createCompany) is mirrored from
// server/src/__tests__/predictive-breaker.integration.test.ts. Only the
// schedule/manual-override seeding and assertions are new.
//
// NOW-INJECTION NOTE: getCompanyAdmissionStatus / loadCompanyScheduleContext
// call `new Date()` internally -- `now` is not injectable through the public
// heartbeat path (same constraint documented in the predictive-breaker
// integration test). So "inside the window" / "outside the window" and
// "before expiry" / "after expiry" are driven by writing the same persisted
// columns the production code reads (schedule_windows, manual_cap_override,
// manual_cap_override_expires_at, company_breaker_state.level) rather than by
// mocking the wall clock -- exactly what the breaker test does with `since`.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  activityLog,
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  budgetPolicies,
  companies,
  companyBreakerState,
  companySkills,
  costEvents,
  createDb,
  environmentLeases,
  executionWorkspaces,
  heartbeatRunEvents,
  heartbeatRuns,
  workspaceOperations,
} from "@paperclipai/db";
import type { ScheduleWindow } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { heartbeatService } from "./heartbeat.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres schedule-admission tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("schedule + manual-override admission (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-schedule-admission-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    const teardown = async () => {
      await db.delete(environmentLeases);
      await db.delete(activityLog);
      await db.delete(costEvents);
      await db.delete(companyBreakerState);
      await db.delete(budgetPolicies);
      await db.delete(heartbeatRunEvents);
      await db.delete(agentWakeupRequests);
      await db.delete(workspaceOperations);
      await db.delete(executionWorkspaces);
      await db.delete(agentRuntimeState);
      await db.delete(heartbeatRuns);
      await db.delete(companySkills);
      await db.delete(agents);
      await db.delete(companies);
    };
    for (let attempt = 0; ; attempt += 1) {
      try {
        await teardown();
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createCompany(maxConcurrentRuns: number): Promise<string> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      maxConcurrentRuns,
    });
    return companyId;
  }

  // Active on every day, all day (start === end -> full 24h window per
  // schedule-cap.ts), so it is deterministically "inside the window"
  // regardless of the real wall-clock time the test happens to run at.
  const alwaysOnWindow = (cap: number): ScheduleWindow => ({
    id: "always-on",
    label: "Always on",
    days: [0, 1, 2, 3, 4, 5, 6],
    startMinute: 0,
    endMinute: 0,
    maxConcurrentRuns: cap,
  });

  // scheduleWindows is NOT NULL (default []) at the schema level -- "no
  // windows configured" is represented by an empty array, not a null column.
  async function setScheduleWindows(companyId: string, windows: ScheduleWindow[]) {
    await db
      .update(companies)
      .set({ scheduleWindows: windows, scheduleTimezone: windows.length > 0 ? "UTC" : null })
      .where(eq(companies.id, companyId));
  }

  async function setBreakerLevel(companyId: string, level: "normal" | "warn" | "throttle" | "halt") {
    await db
      .insert(companyBreakerState)
      .values({ companyId, level, since: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: companyBreakerState.companyId,
        set: { level, since: new Date(), updatedAt: new Date() },
      });
  }

  it("shifts the company cap at a schedule window boundary", async () => {
    const companyId = await createCompany(10);

    // Inside the window: cap throttles to 2, source "schedule".
    await setScheduleWindows(companyId, [alwaysOnWindow(2)]);
    const inside = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(inside.cap).toBe(2);
    expect(inside.source).toBe("schedule");

    // Crossing the boundary out of the window: no active window -> falls
    // back to the configured default.
    await setScheduleWindows(companyId, []);
    const outside = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(outside.cap).toBe(10);
    expect(outside.source).toBe("configured-default");
  });

  it("a manual boost supersedes the active schedule window and auto-reverts at expiry", async () => {
    const companyId = await createCompany(10);
    await setScheduleWindows(companyId, [alwaysOnWindow(2)]);

    const preBoost = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(preBoost.cap).toBe(2);
    expect(preBoost.source).toBe("schedule");

    await heartbeat.setCompanyManualCapOverride(companyId, 25, 120);

    const boosted = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(boosted.cap).toBe(25);
    expect(boosted.source).toBe("manual-override");

    // Activity log records the boost.
    const [logRow] = await db
      .select({ action: activityLog.action, details: activityLog.details })
      .from(activityLog)
      .where(eq(activityLog.companyId, companyId));
    expect(logRow?.action).toBe("company.manual_cap_override_set");

    // Simulate expiry the same way the breaker test simulates elapsed dwell:
    // write the persisted expiry column directly to a past timestamp (the
    // exact column activeManualOverride reads).
    await db
      .update(companies)
      .set({ manualCapOverrideExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(companies.id, companyId));

    const reverted = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(reverted.cap).toBe(2);
    expect(reverted.source).toBe("schedule");
  });

  it("clearCompanyManualCapOverride reverts immediately without waiting for expiry", async () => {
    const companyId = await createCompany(10);
    await heartbeat.setCompanyManualCapOverride(companyId, 25, 120);
    expect((await heartbeat.getCompanyAdmissionStatus(companyId)).source).toBe("manual-override");

    await heartbeat.clearCompanyManualCapOverride(companyId);

    const status = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(status.cap).toBe(10);
    expect(status.source).toBe("configured-default");

    const rows = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.companyId, companyId));
    expect(rows.map((r) => r.action)).toContain("company.manual_cap_override_cleared");
  });

  it("a breaker throttle still wins over a manual boost", async () => {
    const companyId = await createCompany(10);
    await setBreakerLevel(companyId, "throttle");
    await heartbeat.setCompanyManualCapOverride(companyId, 25, 120);

    const status = await heartbeat.getCompanyAdmissionStatus(companyId);
    expect(status.source).toBe("predictive-breaker");
    expect(status.cap).toBe(5); // floor(10 * 0.5)
    expect(status.breakerLevel).toBe("throttle");
  });
});
