/**
 * FILE: server/src/__tests__/run-changeset-service.test.ts
 * ABOUT: run-changeset-service.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - run-changeset-service.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: run-changeset-service.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/run-changeset-service.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  companies,
  createDb,
  executionWorkspaces,
  heartbeatRuns,
  projects,
  runChangesets,
  workspaceOperations,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { runChangesetService } from "../services/run-changeset.js";

const run = promisify(execFile);

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping run changeset service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("runChangesetService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("run-changeset-service");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(runChangesets);
    await db.delete(workspaceOperations);
    await db.delete(executionWorkspaces);
    await db.delete(heartbeatRuns);
    await db.delete(projects);
    await db.delete(agents);
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

  async function seedAgent(companyId: string): Promise<string> {
    const [agent] = await db
      .insert(agents)
      .values({
        companyId,
        name: "CodexCoder",
        role: "engineer",
        adapterType: "codex_local",
        adapterConfig: {},
      })
      .returning();
    return agent!.id;
  }

  async function seedProject(companyId: string): Promise<string> {
    const [project] = await db
      .insert(projects)
      .values({
        companyId,
        name: "Review Cockpit",
      })
      .returning();
    return project!.id;
  }

  async function seedRun(companyId: string, agentId: string): Promise<string> {
    const [heartbeatRun] = await db
      .insert(heartbeatRuns)
      .values({
        companyId,
        agentId,
        status: "completed",
      })
      .returning();
    return heartbeatRun!.id;
  }

  async function seedWorkspace(companyId: string, projectId: string, wsPath: string, baseRef: string): Promise<string> {
    const [ws] = await db
      .insert(executionWorkspaces)
      .values({
        companyId,
        projectId,
        mode: "worktree",
        strategyType: "local_fs",
        name: "run-changeset-fixture",
        providerRef: wsPath,
        baseRef,
      })
      .returning();
    return ws!.id;
  }

  async function seedWorkspaceOperation(companyId: string, executionWorkspaceId: string, runId: string): Promise<void> {
    await db.insert(workspaceOperations).values({
      companyId,
      executionWorkspaceId,
      heartbeatRunId: runId,
      phase: "execute",
      command: "pnpm test",
      status: "completed",
      exitCode: 0,
    });
  }

  async function buildFixtureRepo(): Promise<{ wsPath: string; baseRef: string }> {
    const wsPath = mkdtempSync(path.join(os.tmpdir(), "run-changeset-"));
    const git = (...a: string[]) => run("git", ["-C", wsPath, ...a]);
    await git("init", "-q");
    await git("config", "user.email", "t@t.dev");
    await git("config", "user.name", "t");
    writeFileSync(path.join(wsPath, "keep.txt"), "one\ntwo\n");
    writeFileSync(path.join(wsPath, "gone.txt"), "delete me\n");
    await git("add", ".");
    await git("commit", "-qm", "base");
    const baseRef = (await git("rev-parse", "HEAD")).stdout.trim();
    writeFileSync(path.join(wsPath, "keep.txt"), "one\ntwo\nthree\n"); // modified
    writeFileSync(path.join(wsPath, "new.txt"), "brand new\n"); // added
    rmSync(path.join(wsPath, "gone.txt")); // deleted
    await git("add", "-A");
    await git("commit", "-qm", "work");
    return { wsPath, baseRef };
  }

  it("captures, persists, and survives workspace cleanup; missing workspace warns without throwing", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const projectId = await seedProject(companyId);
    const { wsPath, baseRef } = await buildFixtureRepo();

    const runId = await seedRun(companyId, agentId);
    const executionWorkspaceId = await seedWorkspace(companyId, projectId, wsPath, baseRef);
    await seedWorkspaceOperation(companyId, executionWorkspaceId, runId);

    const svc = runChangesetService(db);
    const captured = await svc.captureForRun(runId);
    expect(captured).not.toBeNull();
    expect(captured!.files.some((f) => f.path === "new.txt")).toBe(true);
    expect(captured!.summaryStats.filesChanged).toBeGreaterThan(0);

    // idempotent: second capture returns the same persisted row, not a new insert
    const capturedAgain = await svc.captureForRun(runId);
    expect(capturedAgain).not.toBeNull();
    expect(capturedAgain!.id).toBe(captured!.id);

    // survives workspace cleanup
    rmSync(wsPath, { recursive: true, force: true });
    const readBack = await svc.getForRun(runId);
    expect(readBack).not.toBeNull();
    expect(readBack!.files.some((f) => f.path === "new.txt")).toBe(true);

    // missing workspace → warning, empty files, no throw
    const runIdWithNoWorkspace = await seedRun(companyId, agentId);
    const anotherWsId = await seedWorkspace(companyId, projectId, "/nonexistent/path/does-not-exist", baseRef);
    await seedWorkspaceOperation(companyId, anotherWsId, runIdWithNoWorkspace);

    const captured2 = await svc.captureForRun(runIdWithNoWorkspace);
    expect(captured2).not.toBeNull();
    expect(captured2!.warning).toBeTruthy();
    expect(captured2!.files).toEqual([]);
  });

  it("returns the winner's row (never null) when a concurrent capture loses the insert race", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const projectId = await seedProject(companyId);
    const { wsPath, baseRef } = await buildFixtureRepo();

    const runId = await seedRun(companyId, agentId);
    const executionWorkspaceId = await seedWorkspace(companyId, projectId, wsPath, baseRef);
    await seedWorkspaceOperation(companyId, executionWorkspaceId, runId);

    const svc = runChangesetService(db);
    // Fire two captures concurrently: both pass the pre-insert "existing" check,
    // both attempt the insert, one wins the unique(heartbeatRunId) conflict and
    // the loser must fall back to re-selecting the winner's row (not return null).
    const [a, b] = await Promise.all([svc.captureForRun(runId), svc.captureForRun(runId)]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).toBe(b!.id);

    // exactly one changeset row persisted for the run
    const rows = await db.select().from(runChangesets).where(eq(runChangesets.heartbeatRunId, runId));
    expect(rows).toHaveLength(1);

    rmSync(wsPath, { recursive: true, force: true });
  });

  it("returns null when a run has no linked workspace at all", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const runId = await seedRun(companyId, agentId);

    const svc = runChangesetService(db);
    const captured = await svc.captureForRun(runId);
    expect(captured).toBeNull();
    expect(await svc.getForRun(runId)).toBeNull();
  });
});
// [END: module]
