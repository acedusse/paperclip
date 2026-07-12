/**
 * FILE: server/src/__tests__/instance-settings-service.test.ts
 * ABOUT: instance-settings-service.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - instance-settings-service.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: instance-settings-service.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/instance-settings-service.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, instanceSettings } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  instanceSettingsService,
  normalizeExperimentalSettings,
  normalizeGeneralSettings,
} from "../services/instance-settings.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres instance settings service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("instance settings service", () => {
  it("ignores retired experimental flags without resetting current settings", () => {
    expect(normalizeExperimentalSettings({
      enableEnvironments: true,
      enableIsolatedWorkspaces: true,
      enableIssuePlanDecompositions: true,
      enableExperimentalFileViewer: true,
      enableTaskWatchdogs: true,
      enableCloudSync: true,
      autoRestartDevServerWhenIdle: true,
      enableIssueGraphLivenessAutoRecovery: true,
      issueGraphLivenessAutoRecoveryLookbackHours: 48,
      enableNewestFirstIssueThread: true,
    })).toEqual({
      enableEnvironments: true,
      enableIsolatedWorkspaces: true,
      enableStreamlinedLeftNavigation: false,
      enableConferenceRoomChat: false,
      enableTaskWatchdogs: false,
      enableIssuePlanDecompositions: true,
      enableExperimentalFileViewer: true,
      enableTaskWatchdogs: true,
      enableCloudSync: true,
      autoRestartDevServerWhenIdle: true,
      enableIssueGraphLivenessAutoRecovery: true,
      issueGraphLivenessAutoRecoveryLookbackHours: 48,
    });
  });

  it("defaults enableConferenceRoomChat to false for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableConferenceRoomChat).toBe(false);
    expect(normalizeExperimentalSettings({}).enableConferenceRoomChat).toBe(false);
    // Rows persisted before the flag existed (PAP-137) must normalize to off.
    expect(
      normalizeExperimentalSettings({ enableStreamlinedLeftNavigation: true }).enableConferenceRoomChat,
    ).toBe(false);
  });

  it("defaults enableTaskWatchdogs to false for empty and legacy stored settings", () => {
    expect(normalizeExperimentalSettings(undefined).enableTaskWatchdogs).toBe(false);
    expect(normalizeExperimentalSettings({}).enableTaskWatchdogs).toBe(false);
    expect(
      normalizeExperimentalSettings({ enableExperimentalFileViewer: true }).enableTaskWatchdogs,
    ).toBe(false);
  });

  it("round-trips an enableConferenceRoomChat patch through the update merge", () => {
    // updateExperimental merges `{ ...normalize(current), ...patch }` and
    // re-normalizes; emulate that to prove the flag survives the roundtrip
    // without disturbing other settings.
    const current = normalizeExperimentalSettings({});
    const enabled = normalizeExperimentalSettings({ ...current, enableConferenceRoomChat: true });
    expect(enabled.enableConferenceRoomChat).toBe(true);
    expect(enabled.enableStreamlinedLeftNavigation).toBe(false);

    const disabled = normalizeExperimentalSettings({ ...enabled, enableConferenceRoomChat: false });
    expect(disabled).toEqual(current);
  });

  it("rejects non-boolean enableConferenceRoomChat values back to the default", () => {
    expect(
      normalizeExperimentalSettings({ enableConferenceRoomChat: "yes" }).enableConferenceRoomChat,
    ).toBe(false);
  });

  it("carries predictive-breaker config through normalize", () => {
    const out = normalizeGeneralSettings({
      predictiveBreakerEnabled: true,
      breakerHorizonMinutes: 30,
    });
    expect(out.predictiveBreakerEnabled).toBe(true);
    expect(out.breakerHorizonMinutes).toBe(30);
  });

  it("defaults predictiveBreakerEnabled to false when unset", () => {
    const out = normalizeGeneralSettings({});
    expect(out.predictiveBreakerEnabled).toBe(false);
    expect(out.breakerHorizonMinutes).toBeUndefined();
  });

  it("preserves explicit predictiveBreakerEnabled=false", () => {
    expect(normalizeGeneralSettings({ predictiveBreakerEnabled: false }).predictiveBreakerEnabled).toBe(
      false,
    );
  });
});

describeEmbeddedPostgres("instanceSettingsService.getGeneral maxConcurrentRuns", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-instance-settings-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(instanceSettings);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("persists and reads back maxConcurrentRuns", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ maxConcurrentRuns: 10 });
    expect((await svc.getGeneral()).maxConcurrentRuns).toBe(10);
  });

  it("omits maxConcurrentRuns when unset (unlimited)", async () => {
    const svc = instanceSettingsService(db);
    expect((await svc.getGeneral()).maxConcurrentRuns).toBeUndefined();
  });

  it("clears instance maxConcurrentRuns when set to null", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ maxConcurrentRuns: 8 });
    expect((await svc.getGeneral()).maxConcurrentRuns).toBe(8);

    await svc.updateGeneral({ maxConcurrentRuns: null });
    expect((await svc.getGeneral()).maxConcurrentRuns).toBeUndefined();
  });

  it("persists and reads back maxRunWallClockMs", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ maxRunWallClockMs: 600000 });
    expect((await svc.getGeneral()).maxRunWallClockMs).toBe(600000);
  });

  it("persists and reads back maxRunCostCents", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ maxRunCostCents: 500 });
    expect((await svc.getGeneral()).maxRunCostCents).toBe(500);
  });

  it("preserves both per-run cap fields through normalize round-trip", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ maxRunWallClockMs: 300000, maxRunCostCents: 250 });
    const general = await svc.getGeneral();
    expect(general.maxRunWallClockMs).toBe(300000);
    expect(general.maxRunCostCents).toBe(250);
  });

  it("omits per-run caps when unset (unlimited)", async () => {
    const svc = instanceSettingsService(db);
    const general = await svc.getGeneral();
    expect(general.maxRunWallClockMs).toBeUndefined();
    expect(general.maxRunCostCents).toBeUndefined();
  });

  it("clears per-run caps when set to null", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ maxRunWallClockMs: 60000, maxRunCostCents: 100 });
    expect((await svc.getGeneral()).maxRunWallClockMs).toBe(60000);
    expect((await svc.getGeneral()).maxRunCostCents).toBe(100);

    await svc.updateGeneral({ maxRunWallClockMs: null, maxRunCostCents: null });
    const cleared = await svc.getGeneral();
    expect(cleared.maxRunWallClockMs).toBeUndefined();
    expect(cleared.maxRunCostCents).toBeUndefined();
  });

  it("persists and reads back maxRunTurns", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ maxRunTurns: 42 });
    expect((await svc.getGeneral()).maxRunTurns).toBe(42);
  });

  it("omits maxRunTurns when unset (unlimited)", async () => {
    const svc = instanceSettingsService(db);
    expect((await svc.getGeneral()).maxRunTurns).toBeUndefined();
  });

  it("clears maxRunTurns when set to null", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ maxRunTurns: 42 });
    expect((await svc.getGeneral()).maxRunTurns).toBe(42);

    await svc.updateGeneral({ maxRunTurns: null });
    expect((await svc.getGeneral()).maxRunTurns).toBeUndefined();
  });

  it("persists and reads back runExecutionState", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ runExecutionState: "halted" });
    expect((await svc.getGeneral()).runExecutionState).toBe("halted");
  });

  it("omits runExecutionState when unset (defaults to running at read sites)", async () => {
    const svc = instanceSettingsService(db);
    expect((await svc.getGeneral()).runExecutionState).toBeUndefined();
  });

  it("clears runExecutionState back to running", async () => {
    const svc = instanceSettingsService(db);
    await svc.updateGeneral({ runExecutionState: "draining" });
    expect((await svc.getGeneral()).runExecutionState).toBe("draining");

    await svc.updateGeneral({ runExecutionState: "running" });
    // "running" is the default; normalize only carries through a non-running state (see Step 3).
    expect((await svc.getGeneral()).runExecutionState).toBeUndefined();
  });
});
// [END: module]
