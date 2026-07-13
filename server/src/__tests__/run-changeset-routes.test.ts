/**
 * FILE: server/src/__tests__/run-changeset-routes.test.ts
 * ABOUT: run-changeset-routes.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - run-changeset-routes.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: run-changeset-routes.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/run-changeset-routes.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
import { runChangesetRoutes } from "../routes/run-changesets.js";

const run = promisify(execFile);

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping run changeset route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

type Db = ReturnType<typeof createDb>;

const boardActor: Express.Request["actor"] = {
  type: "board",
  source: "local_implicit",
  isInstanceAdmin: true,
};

function createApp(db: Db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = boardActor;
    next();
  });
  app.use("/api", runChangesetRoutes(db));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" });
  });
  return app;
}

describeEmbeddedPostgres("run changeset routes", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: Db;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("run-changeset-routes");
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
        name: "run-changeset-route-fixture",
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
    const wsPath = mkdtempSync(path.join(os.tmpdir(), "run-changeset-route-"));
    const git = (...a: string[]) => run("git", ["-C", wsPath, ...a]);
    await git("init", "-q");
    await git("config", "user.email", "t@t.dev");
    await git("config", "user.name", "t");
    writeFileSync(path.join(wsPath, "keep.txt"), "one\ntwo\n");
    await git("add", ".");
    await git("commit", "-qm", "base");
    const baseRef = (await git("rev-parse", "HEAD")).stdout.trim();
    writeFileSync(path.join(wsPath, "keep.txt"), "one\ntwo\nthree\n"); // modified
    writeFileSync(path.join(wsPath, "new.txt"), "brand new\n"); // added
    await git("add", "-A");
    await git("commit", "-qm", "work");
    return { wsPath, baseRef };
  }

  it("captures via POST and reads via GET; unknown run 404s", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId);
    const projectId = await seedProject(companyId);
    const { wsPath, baseRef } = await buildFixtureRepo();

    const runId = await seedRun(companyId, agentId);
    const executionWorkspaceId = await seedWorkspace(companyId, projectId, wsPath, baseRef);
    await seedWorkspaceOperation(companyId, executionWorkspaceId, runId);

    const app = createApp(db);

    const cap = await request(app).post(`/api/runs/${runId}/changeset/capture`);
    expect(cap.status, JSON.stringify(cap.body)).toBe(200);
    expect(cap.body.files.some((f: any) => f.path === "new.txt")).toBe(true);

    const got = await request(app).get(`/api/runs/${runId}/changeset`);
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(got.body.files.some((f: any) => f.path === "new.txt")).toBe(true);

    const missing = await request(app).get(`/api/runs/${randomUUID()}/changeset`);
    expect(missing.status).toBe(404);

    rmSync(wsPath, { recursive: true, force: true });
  });
});
// [END: module]
