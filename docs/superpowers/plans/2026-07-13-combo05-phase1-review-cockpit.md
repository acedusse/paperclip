# Combo-05 Phase 1 — Review Cockpit (Legibility + Triage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every approval a concrete, persisted PR-style diff of what its run did, and a risk-scored, groupable, bulk-actionable triage inbox — with every decision routed through one authority resolver and one decision-audit record.

**Architecture:** Build the four Phase-1 shared seams (risk model, changeset/diff surface, authority resolver, decision audit + delivery-pipeline stub) as extension points, seeded minimally, then deliver the two operator surfaces (per-run diff view, triage inbox). Changesets are captured with `git diff <baseRef>...HEAD` at run-finalize and persisted so they survive workspace cleanup. The authority resolver registers only `explicit_human` in Phase 1; auto-approve, delegation, push, and the stakeholder page are later phases that plug into these same seams.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), drizzle-orm + PostgreSQL, Express, zod validators (`@paperclipai/shared`), vitest + embedded-postgres for server tests, React + React Testing Library for UI.

## Global Constraints

- Language/module: TypeScript, ESM; **all relative imports use `.js` extensions**.
- Services are factory functions: `export function xService(db: Db) { return { ... } }`.
- Server DB tests use the embedded-postgres harness: `getEmbeddedPostgresTestSupport()` / `startEmbeddedPostgresTestDatabase()` from `server/src/__tests__/helpers/embedded-postgres.js`; guard the suite with `describeEmbeddedPostgres`.
- Pure (no-DB) tests are plain vitest files colocated as `*.test.ts`.
- Run a single test file: `pnpm exec vitest run <path>`. Full suite: `pnpm test`.
- Migrations live in `packages/db/src/migrations/` numbered `NNNN_name.sql` (next free number is **0111**); generate them with `pnpm --filter @paperclipai/db generate` after editing schema TS — never hand-number.
- All decision audit goes through `logActivity(db, …)` (`server/src/services/activity-log.ts`).
- Changeset capture is **best-effort**: it must never throw into the heartbeat run loop and must never block run finalize.
- Only `explicit_human` decisions are exposed in Phase 1. No auto/delegated/agent decision path may be reachable.
- Risk bands (thresholds locked here, one constant): `low` = score < 25, `medium` = 25–49, `high` = 50–74, `critical` ≥ 75. `autoDecisionMaxBand` default = `low`.
- Per-file diff text cap: 200 000 chars; over-cap or binary → metadata only (`truncated: true` / `binary: true`, no `diff`).
- Follow the existing file-header comment block convention when creating new files (see any `server/src/services/*.ts`).
- **UI tests (Tasks 10–12):** `@testing-library/react` is **NOT installed** — do not import it. UI component/page tests in this repo start with a `// @vitest-environment jsdom` header comment, set `(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true`, render via `react-dom/client` `createRoot` wrapped in React's `act(...)`, and assert against the rendered DOM (`container.textContent`, `container.querySelector(...)`). Mirror `ui/src/components/ApprovalPayload.test.tsx` and `ui/src/pages/Inbox.test.tsx`. The RTL-style `render`/`screen` snippets shown in Tasks 10 and 12 are **illustrative of the assertions to make** — translate them to this convention.

---

### Task 1: DB schema — `run_changesets` and `approval_risk` tables + migration

**Files:**
- Create: `packages/db/src/schema/run_changesets.ts`
- Create: `packages/db/src/schema/approval_risk.ts`
- Modify: `packages/db/src/schema/index.ts` (export both)
- Generated: `packages/db/src/migrations/0111_combo05_review_cockpit.sql`
- Test: `packages/db/src/__tests__/schema-combo05.test.ts` (or nearest existing schema-test location)

**Interfaces:**
- Produces: `runChangesets`, `approvalRisk` drizzle tables; TS types `RunChangesetFile`, `RunChangesetCommand`.

- [ ] **Step 1: Write `run_changesets` schema**

`packages/db/src/schema/run_changesets.ts`:

```ts
import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export type RunChangesetFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  truncated: boolean;
  diff?: string; // unified diff text; omitted when binary or truncated
};

export type RunChangesetCommand = {
  command: string;
  status: string;
  exitCode: number | null;
};

export const runChangesets = pgTable(
  "run_changesets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    heartbeatRunId: uuid("heartbeat_run_id")
      .notNull()
      .unique() // one changeset per run — Task 3's onConflictDoNothing targets this
      .references(() => heartbeatRuns.id, { onDelete: "cascade" }),
    baseRef: text("base_ref"),
    headRef: text("head_ref"),
    files: jsonb("files").$type<RunChangesetFile[]>().notNull().default([]),
    commands: jsonb("commands").$type<RunChangesetCommand[]>().notNull().default([]),
    summaryStats: jsonb("summary_stats")
      .$type<{ filesChanged: number; additions: number; deletions: number }>()
      .notNull(),
    warning: text("warning"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
```

The `.unique()` on `heartbeatRunId` gives Task 3's `onConflictDoNothing` a target and enforces one changeset per run. Drop the now-unused `index` import if nothing else uses it.

- [ ] **Step 2: Write `approval_risk` schema**

`packages/db/src/schema/approval_risk.ts`:

```ts
import { pgTable, uuid, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { approvals } from "./approvals.js";

export const approvalRisk = pgTable("approval_risk", {
  approvalId: uuid("approval_id")
    .primaryKey()
    .references(() => approvals.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  band: text("band").notNull(), // low | medium | high | critical
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Export both from the schema barrel**

In `packages/db/src/schema/index.ts`, add (alongside the other `export * from` / `export {}` lines — match the file's existing style):

```ts
export * from "./run_changesets.js";
export * from "./approval_risk.js";
```

- [ ] **Step 4: Hand-write the migration + journal entry**

⚠️ Do **not** run `drizzle-kit generate` in this repo: the drizzle snapshot baseline is stale (last `meta/*_snapshot.json` is `0098`, but migrations `0099`–`0110` were hand-written without snapshots), so `generate` produces a destructive migration bundling all that drift. Migrations here are hand-written raw SQL registered in `meta/_journal.json` (the migrator applies via the journal + `.sql` files; snapshots are only used by `generate`). Match the style of `packages/db/src/migrations/0104_issue_watchdogs.sql`.

Create `packages/db/src/migrations/0111_combo05_review_cockpit.sql`:

```sql
CREATE TABLE IF NOT EXISTS "run_changesets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "heartbeat_run_id" uuid NOT NULL,
  "base_ref" text,
  "head_ref" text,
  "files" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "summary_stats" jsonb NOT NULL,
  "warning" text,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "run_changesets_heartbeat_run_id_unique" UNIQUE("heartbeat_run_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_risk" (
  "approval_id" uuid PRIMARY KEY NOT NULL,
  "company_id" uuid NOT NULL,
  "score" integer NOT NULL,
  "band" text NOT NULL,
  "reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_changesets" ADD CONSTRAINT "run_changesets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_changesets" ADD CONSTRAINT "run_changesets_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_risk" ADD CONSTRAINT "approval_risk_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_risk" ADD CONSTRAINT "approval_risk_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
```

Then append this entry to the `entries` array in `packages/db/src/migrations/meta/_journal.json` (immediately after the `idx: 110` entry):

```json
    {
      "idx": 111,
      "version": "7",
      "when": 1781902600000,
      "tag": "0111_combo05_review_cockpit",
      "breakpoints": true
    }
```

Verify numbering: `pnpm --filter @paperclipai/db run check:migrations` (or `pnpm --filter @paperclipai/db typecheck`, which runs it) should pass. The migration applies automatically when the embedded-postgres test harness spins up in later steps.

- [ ] **Step 5: Write a schema smoke test**

`packages/db/src/__tests__/schema-combo05.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runChangesets, approvalRisk } from "../schema/index.js";

describe("combo05 schema", () => {
  it("exposes run_changesets and approval_risk tables", () => {
    expect(runChangesets).toBeDefined();
    expect(approvalRisk).toBeDefined();
  });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm exec vitest run packages/db/src/__tests__/schema-combo05.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/run_changesets.ts packages/db/src/schema/approval_risk.ts \
  packages/db/src/schema/index.ts packages/db/src/migrations packages/db/src/__tests__/schema-combo05.test.ts
git commit -m "feat(combo-05): run_changesets + approval_risk schema and migration"
```

---

### Task 2: `git-changeset` — pure git diff runner + parser

**Files:**
- Create: `server/src/services/git-changeset.ts`
- Test: `server/src/services/git-changeset.test.ts`

**Interfaces:**
- Produces:
  ```ts
  computeGitChangeset(workspacePath: string, baseRef: string | null, opts?: { perFileDiffCap?: number }):
    Promise<{ files: RunChangesetFile[]; headRef: string | null; warning?: string }>
  ```
- Consumes: `RunChangesetFile` from `@paperclipai/db`.

This module is self-contained (spawns `git` via `execFile`), so it is unit-testable against a fixture repo with no database.

- [ ] **Step 1: Write the failing test (fixture git repo exercising every status)**

`server/src/services/git-changeset.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeGitChangeset } from "./git-changeset.js";

const run = promisify(execFile);
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "chgset-"));
  const git = (...a: string[]) => run("git", ["-C", dir, ...a]);
  await git("init", "-q");
  await git("config", "user.email", "t@t.dev");
  await git("config", "user.name", "t");
  writeFileSync(path.join(dir, "keep.txt"), "one\ntwo\n");
  writeFileSync(path.join(dir, "gone.txt"), "delete me\n");
  await git("add", "."); await git("commit", "-qm", "base");
  const base = (await git("rev-parse", "HEAD")).stdout.trim();
  writeFileSync(path.join(dir, "keep.txt"), "one\ntwo\nthree\n"); // modified
  writeFileSync(path.join(dir, "new.txt"), "brand new\n");         // added (committed)
  rmSync(path.join(dir, "gone.txt"));                              // deleted
  await git("add", "-A"); await git("commit", "-qm", "work");
  writeFileSync(path.join(dir, "untracked.txt"), "not staged\n");  // untracked
  (globalThis as any).__base = base;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("computeGitChangeset", () => {
  it("reports added/modified/deleted/untracked with line counts", async () => {
    const base = (globalThis as any).__base as string;
    const { files } = await computeGitChangeset(dir, base);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath["new.txt"].status).toBe("added");
    expect(byPath["keep.txt"].status).toBe("modified");
    expect(byPath["keep.txt"].additions).toBe(1);
    expect(byPath["gone.txt"].status).toBe("deleted");
    expect(byPath["untracked.txt"].status).toBe("untracked");
    expect(byPath["keep.txt"].diff).toContain("three");
  });

  it("truncates over-cap diffs to metadata only", async () => {
    const base = (globalThis as any).__base as string;
    const { files } = await computeGitChangeset(dir, base, { perFileDiffCap: 5 });
    expect(files.find((f) => f.path === "keep.txt")!.truncated).toBe(true);
    expect(files.find((f) => f.path === "keep.txt")!.diff).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/services/git-changeset.test.ts`
Expected: FAIL with "computeGitChangeset is not a function" / module not found.

- [ ] **Step 3: Implement `git-changeset.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunChangesetFile } from "@paperclipai/db";

const execFileAsync = promisify(execFile);
const DEFAULT_PER_FILE_DIFF_CAP = 200_000;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

function parseNumstat(out: string): Map<string, { additions: number; deletions: number; binary: boolean; oldPath?: string }> {
  const map = new Map();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [add, del, ...rest] = line.split("\t");
    const p = rest.join("\t");
    const binary = add === "-" && del === "-";
    map.set(p, { additions: binary ? 0 : Number(add), deletions: binary ? 0 : Number(del), binary });
  }
  return map;
}

export async function computeGitChangeset(
  workspacePath: string,
  baseRef: string | null,
  opts: { perFileDiffCap?: number } = {},
): Promise<{ files: RunChangesetFile[]; headRef: string | null; warning?: string }> {
  const cap = opts.perFileDiffCap ?? DEFAULT_PER_FILE_DIFF_CAP;
  let headRef: string | null = null;
  try {
    headRef = (await git(workspacePath, ["rev-parse", "HEAD"])).trim() || null;
  } catch (err) {
    return { files: [], headRef: null, warning: `git unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }

  const range = baseRef ? `${baseRef}...HEAD` : "HEAD";
  const files: RunChangesetFile[] = [];

  // Committed changes vs base
  const statusOut = await git(workspacePath, ["diff", "--name-status", "-M", range]).catch(() => "");
  const numstat = parseNumstat(await git(workspacePath, ["diff", "--numstat", "-M", range]).catch(() => ""));
  for (const line of statusOut.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0];
    const p = code.startsWith("R") ? parts[2] : parts[1];
    const oldPath = code.startsWith("R") ? parts[1] : undefined;
    const status: RunChangesetFile["status"] =
      code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : code.startsWith("R") ? "renamed" : "modified";
    const ns = numstat.get(p) ?? numstat.get(`${oldPath} => ${p}`) ?? { additions: 0, deletions: 0, binary: false };
    let diff: string | undefined;
    let truncated = false;
    if (!ns.binary && status !== "deleted") {
      const d = await git(workspacePath, ["diff", "-M", range, "--", p]).catch(() => "");
      if (d.length > cap) truncated = true;
      else diff = d;
    }
    files.push({ path: p, status, oldPath, additions: ns.additions, deletions: ns.deletions, binary: ns.binary, truncated, diff });
  }

  // Untracked / uncommitted working-tree files
  const porcelain = await git(workspacePath, ["status", "--porcelain=v1", "--untracked-files=all"]).catch(() => "");
  for (const line of porcelain.split("\n")) {
    if (!line.startsWith("?? ")) continue;
    const p = line.slice(3).trim();
    files.push({ path: p, status: "untracked", additions: 0, deletions: 0, binary: false, truncated: false });
  }

  return { files, headRef };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/services/git-changeset.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/git-changeset.ts server/src/services/git-changeset.test.ts
git commit -m "feat(combo-05): pure git changeset computation (baseRef...HEAD + untracked)"
```

---

### Task 3: `run-changeset` service — capture, persist, read

**Files:**
- Create: `server/src/services/run-changeset.ts`
- Test: `server/src/__tests__/run-changeset-service.test.ts`
- Modify: `server/src/services/index.ts` (export `runChangesetService`)

**Interfaces:**
- Consumes: `computeGitChangeset` (Task 2); `runChangesets`, `workspaceOperations`, `executionWorkspaces` tables.
- Produces:
  ```ts
  runChangesetService(db: Db): {
    captureForRun(runId: string): Promise<typeof runChangesets.$inferSelect | null>;
    getForRun(runId: string): Promise<typeof runChangesets.$inferSelect | null>;
  }
  ```

- [ ] **Step 1: Write the failing test**

`server/src/__tests__/run-changeset-service.test.ts` — using the embedded-postgres harness (mirror the header of `server/src/__tests__/secrets-service.test.ts`). Seed a company, a heartbeat run, an execution workspace pointing at a fixture git repo, and a `workspace_operations` row linking the run to that workspace. Assert:

```ts
// after setup that creates a real git worktree at `wsPath` with baseRef `base`:
const svc = runChangesetService(db);
const captured = await svc.captureForRun(runId);
expect(captured).not.toBeNull();
expect(captured!.files.some((f) => f.path === "new.txt")).toBe(true);
expect(captured!.summaryStats.filesChanged).toBeGreaterThan(0);

// survives workspace cleanup:
rmSync(wsPath, { recursive: true, force: true });
const readBack = await svc.getForRun(runId);
expect(readBack!.files.some((f) => f.path === "new.txt")).toBe(true);

// missing workspace → warning, empty files, no throw:
const captured2 = await svc.captureForRun(runIdWithNoWorkspace);
expect(captured2!.warning).toBeTruthy();
expect(captured2!.files).toEqual([]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/run-changeset-service.test.ts`
Expected: FAIL (module/function missing).

- [ ] **Step 3: Implement `run-changeset.ts`**

```ts
import { promises as fs } from "node:fs";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  runChangesets,
  workspaceOperations,
  executionWorkspaces,
  type RunChangesetFile,
  type RunChangesetCommand,
} from "@paperclipai/db";
import { computeGitChangeset } from "./git-changeset.js";

export function runChangesetService(db: Db) {
  async function resolveWorkspace(runId: string) {
    const op = await db
      .select({ wsId: workspaceOperations.executionWorkspaceId })
      .from(workspaceOperations)
      .where(and(eq(workspaceOperations.heartbeatRunId, runId), isNotNull(workspaceOperations.executionWorkspaceId)))
      .orderBy(desc(workspaceOperations.startedAt))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (!op?.wsId) return null;
    return db.select().from(executionWorkspaces).where(eq(executionWorkspaces.id, op.wsId)).then((r) => r[0] ?? null);
  }

  async function loadCommands(runId: string): Promise<RunChangesetCommand[]> {
    const rows = await db
      .select({ command: workspaceOperations.command, status: workspaceOperations.status, exitCode: workspaceOperations.exitCode })
      .from(workspaceOperations)
      .where(eq(workspaceOperations.heartbeatRunId, runId));
    return rows
      .filter((r) => r.command)
      .map((r) => ({ command: r.command as string, status: r.status, exitCode: r.exitCode ?? null }));
  }

  async function persist(input: {
    runId: string; companyId: string; baseRef: string | null; headRef: string | null;
    files: RunChangesetFile[]; commands: RunChangesetCommand[]; warning?: string;
  }) {
    const summaryStats = {
      filesChanged: input.files.length,
      additions: input.files.reduce((s, f) => s + f.additions, 0),
      deletions: input.files.reduce((s, f) => s + f.deletions, 0),
    };
    return db
      .insert(runChangesets)
      .values({
        companyId: input.companyId, heartbeatRunId: input.runId,
        baseRef: input.baseRef, headRef: input.headRef,
        files: input.files, commands: input.commands, summaryStats, warning: input.warning ?? null,
      })
      .onConflictDoNothing() // one changeset per run; first capture wins
      .returning()
      .then((r) => r[0] ?? null);
  }

  return {
    getForRun: (runId: string) =>
      db.select().from(runChangesets).where(eq(runChangesets.heartbeatRunId, runId)).then((r) => r[0] ?? null),

    async captureForRun(runId: string) {
      const existing = await db
        .select({ id: runChangesets.id })
        .from(runChangesets)
        .where(eq(runChangesets.heartbeatRunId, runId))
        .then((r) => r[0] ?? null);
      if (existing) return db.select().from(runChangesets).where(eq(runChangesets.id, existing.id)).then((r) => r[0]);

      const ws = await resolveWorkspace(runId);
      const commands = await loadCommands(runId);
      const companyId = ws?.companyId;
      if (!companyId) return null;

      const path = ws.providerRef ?? ws.cwd ?? null;
      const pathOk = path ? await fs.stat(path).then(() => true).catch(() => false) : false;
      if (!path || !pathOk) {
        return persist({ runId, companyId, baseRef: ws.baseRef ?? null, headRef: null, files: [], commands, warning: "workspace path unavailable at capture time" });
      }

      const { files, headRef, warning } = await computeGitChangeset(path, ws.baseRef ?? null);
      return persist({ runId, companyId, baseRef: ws.baseRef ?? null, headRef, files, commands, warning });
    },
  };
}
```

Add to `packages/db/src/schema/run_changesets.ts` a unique index on `heartbeatRunId` so `onConflictDoNothing` targets it — update Task 1's table with `.unique()` on `heartbeatRunId` if not already; if you reach here and it is not unique, add a follow-up migration. (Simplest: make `heartbeatRunId` unique in Task 1 — do that now if implementing in order.)

- [ ] **Step 4: Export from services barrel**

In `server/src/services/index.ts` add: `export { runChangesetService } from "./run-changeset.js";`

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/run-changeset-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/run-changeset.ts server/src/__tests__/run-changeset-service.test.ts server/src/services/index.ts packages/db/src/schema/run_changesets.ts
git commit -m "feat(combo-05): run changeset capture/persist/read service"
```

---

### Task 4: Capture hook at run finalize + manual capture endpoint

**Files:**
- Modify: `server/src/services/heartbeat.ts` (best-effort capture call in the finished-run handler)
- Create: `server/src/routes/run-changesets.ts`
- Modify: `server/src/app.ts` (register the route)
- Test: `server/src/__tests__/run-changeset-routes.test.ts`

**Interfaces:**
- Consumes: `runChangesetService` (Task 3), `assertCompanyAccess`, `assertBoard`, `getActorInfo` from `./authz.js`.
- Produces routes: `GET /runs/:runId/changeset`, `POST /runs/:runId/changeset/capture` (board-only).

- [ ] **Step 1: Add the best-effort capture call in heartbeat finalize**

In `server/src/services/heartbeat.ts`, locate the finished-run handler that loads `issue`/`agent` and evaluates run liveness/continuation (search for `decideRunLivenessContinuation(` — the block starting around the `productivityHold` check). At the **entry of that handler**, once `run` is known to have ended, add a best-effort capture that never throws into the loop:

```ts
// Combo-05: persist a PR-style changeset while the workspace still exists. Best-effort.
void runChangesetService(db).captureForRun(run.id).catch((err) => {
  logger.warn({ err, runId: run.id }, "run changeset capture failed");
});
```

Import `runChangesetService` at the top of the file (add to the existing `./run-changeset.js` import or a new import line). `logger` is already imported in this file.

- [ ] **Step 2: Write the failing route test**

`server/src/__tests__/run-changeset-routes.test.ts` (embedded-postgres harness). Build an express app with the new route mounted, seed a run + workspace (fixture git repo) + `workspace_operations` link, then:

```ts
// capture then read:
const cap = await request(app).post(`/api/runs/${runId}/changeset/capture`).set(boardAuthHeaders);
expect(cap.status).toBe(200);
const got = await request(app).get(`/api/runs/${runId}/changeset`).set(boardAuthHeaders);
expect(got.status).toBe(200);
expect(got.body.files.some((f: any) => f.path === "new.txt")).toBe(true);

// unknown run → 404
const missing = await request(app).get(`/api/runs/${randomUUID()}/changeset`).set(boardAuthHeaders);
expect(missing.status).toBe(404);
```

(Follow an existing route test for how the app + auth headers are assembled, e.g. `server/src/__tests__/permissions-upgrade-boundary-routes.test.ts`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/run-changeset-routes.test.ts`
Expected: FAIL (route not mounted).

- [ ] **Step 4: Implement the route**

`server/src/routes/run-changesets.ts`:

```ts
import { Router } from "express";
import { eq } from "drizzle-orm";
import { heartbeatRuns, type Db } from "@paperclipai/db";
import { runChangesetService } from "../services/index.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function runChangesetRoutes(db: Db) {
  const router = Router();
  const svc = runChangesetService(db);

  async function loadRun(runId: string) {
    return db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((r) => r[0] ?? null);
  }

  router.get("/runs/:runId/changeset", async (req, res) => {
    const run = await loadRun(req.params.runId as string);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }
    assertCompanyAccess(req, run.companyId);
    const changeset = await svc.getForRun(run.id);
    if (!changeset) { res.status(404).json({ error: "No changeset recorded for this run" }); return; }
    res.json(changeset);
  });

  router.post("/runs/:runId/changeset/capture", async (req, res) => {
    assertBoard(req);
    const run = await loadRun(req.params.runId as string);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }
    assertCompanyAccess(req, run.companyId);
    const changeset = await svc.captureForRun(run.id);
    if (!changeset) { res.status(422).json({ error: "Run has no execution workspace to capture" }); return; }
    res.json(changeset);
  });

  return router;
}
```

- [ ] **Step 5: Register the route in `app.ts`**

Add the import near the other route imports and mount it on the `api` router (mirror `api.use("/companies", …)` style):

```ts
import { runChangesetRoutes } from "./routes/run-changesets.js";
// ...
api.use(runChangesetRoutes(db));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/run-changeset-routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck heartbeat wiring**

Run: `pnpm --filter @paperclipai/server exec tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/routes/run-changesets.ts server/src/app.ts server/src/__tests__/run-changeset-routes.test.ts
git commit -m "feat(combo-05): capture changeset at run finalize + changeset read/capture routes"
```

---

### Task 5: Risk model — signal registry + score + persisted snapshot

**Files:**
- Create: `server/src/services/approval-risk.ts`
- Test: `server/src/services/approval-risk.test.ts` (pure), `server/src/__tests__/approval-risk-service.test.ts` (DB persist)
- Modify: `server/src/services/index.ts`

**Interfaces:**
- Produces:
  ```ts
  type RiskBand = "low" | "medium" | "high" | "critical";
  type RiskContext = {
    approval: { type: string; payload: Record<string, unknown> };
    agentTrustStage?: "trusted" | "probation" | "untrusted" | "unknown";
    impliedSpendCents?: number;
    changeset?: { additions: number; deletions: number; filesChanged: number } | null;
  };
  riskScore(ctx: RiskContext): { score: number; band: RiskBand; reasons: string[] };
  const RISK_BAND_ORDER: RiskBand[]; // ["low","medium","high","critical"]
  approvalRiskService(db).computeAndPersist(approvalId): Promise<{ score; band; reasons }>;
  approvalRiskService(db).getSnapshot(approvalId): Promise<typeof approvalRisk.$inferSelect | null>;
  ```

- [ ] **Step 1: Write the failing pure test**

`server/src/services/approval-risk.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { riskScore } from "./approval-risk.js";

describe("riskScore", () => {
  it("is deterministic and low for a trivial trusted doc edit", () => {
    const ctx = { approval: { type: "work_product", payload: {} }, agentTrustStage: "trusted" as const, impliedSpendCents: 10, changeset: { additions: 2, deletions: 0, filesChanged: 1 } };
    const a = riskScore(ctx); const b = riskScore(ctx);
    expect(a).toEqual(b);
    expect(a.band).toBe("low");
  });

  it("escalates for untrusted agent crossing a sensitive boundary with big spend", () => {
    const ctx = { approval: { type: "hire_agent", payload: { budgetMonthlyCents: 50000, secretRef: "x" } }, agentTrustStage: "untrusted" as const, impliedSpendCents: 50000, changeset: null };
    const r = riskScore(ctx);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.band).toBe("critical");
    expect(r.reasons.join(" ")).toMatch(/sensitive|spend|trust/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/services/approval-risk.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `approval-risk.ts` (pure part)**

```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvals, approvalRisk, runChangesets } from "@paperclipai/db";

export type RiskBand = "low" | "medium" | "high" | "critical";
export const RISK_BAND_ORDER: RiskBand[] = ["low", "medium", "high", "critical"];

export type RiskContext = {
  approval: { type: string; payload: Record<string, unknown> };
  agentTrustStage?: "trusted" | "probation" | "untrusted" | "unknown";
  impliedSpendCents?: number;
  changeset?: { additions: number; deletions: number; filesChanged: number } | null;
};

type Signal = { name: string; evaluate(ctx: RiskContext): { points: number; reason: string } | null };

const SENSITIVE_PAYLOAD_KEYS = ["secretRef", "secret", "externalUrl", "webhookUrl", "budgetMonthlyCents", "budgetCents"];
const SENSITIVE_TYPES = ["hire_agent", "secret_grant", "external_send", "budget_change"];

function detectSensitiveBoundaries(a: RiskContext["approval"]): string[] {
  const flags: string[] = [];
  if (SENSITIVE_TYPES.includes(a.type)) flags.push(`type:${a.type}`);
  for (const k of SENSITIVE_PAYLOAD_KEYS) if (k in a.payload) flags.push(`payload:${k}`);
  return flags;
}

const SIGNALS: Signal[] = [
  {
    name: "trust-stage",
    evaluate: (ctx) => {
      const stage = ctx.agentTrustStage ?? "unknown";
      const pts = { trusted: 0, probation: 25, untrusted: 40, unknown: 40 }[stage];
      return pts > 0 ? { points: pts, reason: `agent trust stage: ${stage}` } : null;
    },
  },
  {
    name: "implied-spend",
    evaluate: (ctx) => {
      const c = ctx.impliedSpendCents ?? 0;
      const pts = c >= 5000 ? 45 : c >= 500 ? 30 : c >= 50 ? 15 : 0;
      return pts > 0 ? { points: pts, reason: `implied spend ~$${(c / 100).toFixed(2)}` } : null;
    },
  },
  {
    name: "sensitive-boundary",
    evaluate: (ctx) => {
      const flags = detectSensitiveBoundaries(ctx.approval);
      return flags.length ? { points: 40, reason: `sensitive boundary: ${flags.join(", ")}` } : null;
    },
  },
  {
    name: "diff-size",
    evaluate: (ctx) => {
      const total = (ctx.changeset?.additions ?? 0) + (ctx.changeset?.deletions ?? 0);
      const pts = Math.min(30, Math.round(total / 20));
      return pts > 0 ? { points: pts, reason: `${total} changed lines across ${ctx.changeset?.filesChanged ?? 0} files` } : null;
    },
  },
];

function bandFor(score: number): RiskBand {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function riskScore(ctx: RiskContext): { score: number; band: RiskBand; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  for (const s of SIGNALS) {
    const r = s.evaluate(ctx);
    if (r) { score += r.points; reasons.push(r.reason); }
  }
  score = Math.min(100, score);
  return { score, band: bandFor(score), reasons };
}
```

- [ ] **Step 4: Add the DB-backed service (compute + persist)**

Append to `approval-risk.ts`:

```ts
export function approvalRiskService(db: Db) {
  return {
    getSnapshot: (approvalId: string) =>
      db.select().from(approvalRisk).where(eq(approvalRisk.approvalId, approvalId)).then((r) => r[0] ?? null),

    async computeAndPersist(approvalId: string) {
      const approval = await db.select().from(approvals).where(eq(approvals.id, approvalId)).then((r) => r[0] ?? null);
      if (!approval) throw new Error(`approval ${approvalId} not found`);

      // diff-size signal: pull the linked run's changeset if the payload references one.
      const runId = typeof approval.payload?.runId === "string" ? (approval.payload.runId as string) : null;
      const changeset = runId
        ? await db.select({ s: runChangesets.summaryStats }).from(runChangesets)
            .where(eq(runChangesets.heartbeatRunId, runId)).then((r) => r[0]?.s ?? null)
        : null;

      const impliedSpendCents = typeof approval.payload?.budgetMonthlyCents === "number"
        ? (approval.payload.budgetMonthlyCents as number) : undefined;

      const result = riskScore({
        approval: { type: approval.type, payload: approval.payload },
        agentTrustStage: "unknown", // idea 009 not yet built; degrade to lowest trust
        impliedSpendCents,
        changeset,
      });

      await db.insert(approvalRisk)
        .values({ approvalId, companyId: approval.companyId, score: result.score, band: result.band, reasons: result.reasons, computedAt: new Date() })
        .onConflictDoUpdate({ target: approvalRisk.approvalId, set: { score: result.score, band: result.band, reasons: result.reasons, computedAt: new Date() } });
      return result;
    },
  };
}
```

- [ ] **Step 5: Write the DB persist test**

`server/src/__tests__/approval-risk-service.test.ts` (embedded-postgres): seed a company + approval, call `computeAndPersist`, assert `getSnapshot` returns the stored band/score; recompute after linking a large changeset and assert the score rose (idempotent upsert, one row).

- [ ] **Step 6: Export + run tests**

Add `export { approvalRiskService, riskScore, RISK_BAND_ORDER, type RiskBand } from "./approval-risk.js";` to `server/src/services/index.ts`.
Run: `pnpm exec vitest run server/src/services/approval-risk.test.ts server/src/__tests__/approval-risk-service.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/approval-risk.ts server/src/services/approval-risk.test.ts server/src/__tests__/approval-risk-service.test.ts server/src/services/index.ts
git commit -m "feat(combo-05): approval risk model + persisted snapshot"
```

---

### Task 6: Authority resolver

**Files:**
- Create: `server/src/services/approval-authority.ts`
- Test: `server/src/services/approval-authority.test.ts`
- Modify: `server/src/services/index.ts`

**Interfaces:**
- Consumes: `RiskBand`, `RISK_BAND_ORDER` (Task 5).
- Produces:
  ```ts
  type DecisionMethod = "explicit_human" | "delegated_human" | "coverage_escalation" | "bounded_agent" | "auto_policy";
  const METHOD_PRECEDENCE: readonly DecisionMethod[];
  canDecide(input: { band: RiskBand; method: DecisionMethod; autoDecisionMaxBand?: RiskBand }): { allow: boolean; deny?: string };
  ```

- [ ] **Step 1: Write the failing test**

`server/src/services/approval-authority.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canDecide, METHOD_PRECEDENCE } from "./approval-authority.js";

describe("canDecide", () => {
  it("locks the precedence order", () => {
    expect(METHOD_PRECEDENCE).toEqual(["explicit_human", "delegated_human", "coverage_escalation", "bounded_agent", "auto_policy"]);
  });
  it("allows explicit_human at any band", () => {
    expect(canDecide({ band: "critical", method: "explicit_human" }).allow).toBe(true);
  });
  it("denies every non-registered method in phase 1", () => {
    for (const m of ["delegated_human", "coverage_escalation", "bounded_agent", "auto_policy"] as const) {
      expect(canDecide({ band: "low", method: m }).allow).toBe(false);
    }
  });
  it("denies non-human methods above autoDecisionMaxBand (guards the hard rule)", () => {
    const r = canDecide({ band: "high", method: "auto_policy", autoDecisionMaxBand: "low" });
    expect(r.allow).toBe(false);
    expect(r.deny).toMatch(/band/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/services/approval-authority.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `approval-authority.ts`**

```ts
import { RISK_BAND_ORDER, type RiskBand } from "./approval-risk.js";

export type DecisionMethod = "explicit_human" | "delegated_human" | "coverage_escalation" | "bounded_agent" | "auto_policy";
export const METHOD_PRECEDENCE: readonly DecisionMethod[] = ["explicit_human", "delegated_human", "coverage_escalation", "bounded_agent", "auto_policy"];

const REGISTERED: ReadonlySet<DecisionMethod> = new Set(["explicit_human"]); // phase 1
const NON_HUMAN: ReadonlySet<DecisionMethod> = new Set(["bounded_agent", "auto_policy"]);

function bandRank(b: RiskBand): number { return RISK_BAND_ORDER.indexOf(b); }

export function canDecide(input: { band: RiskBand; method: DecisionMethod; autoDecisionMaxBand?: RiskBand }): { allow: boolean; deny?: string } {
  const maxBand = input.autoDecisionMaxBand ?? "low";
  // Hard rule first, so it holds even for methods that later become registered.
  if (NON_HUMAN.has(input.method) && bandRank(input.band) > bandRank(maxBand)) {
    return { allow: false, deny: `method ${input.method} may not decide items above band ${maxBand}` };
  }
  if (!REGISTERED.has(input.method)) {
    return { allow: false, deny: `decision method ${input.method} is not enabled` };
  }
  return { allow: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/services/approval-authority.test.ts`
Expected: PASS.

- [ ] **Step 5: Export + commit**

Add `export { canDecide, METHOD_PRECEDENCE, type DecisionMethod } from "./approval-authority.js";` to `server/src/services/index.ts`.

```bash
git add server/src/services/approval-authority.ts server/src/services/approval-authority.test.ts server/src/services/index.ts
git commit -m "feat(combo-05): approval authority resolver (explicit_human only, above-band hard rule)"
```

---

### Task 7: Decision audit + delivery-pipeline inbox seam

**Files:**
- Create: `server/src/services/approval-decision-audit.ts`
- Create: `server/src/services/notification-delivery.ts`
- Test: `server/src/__tests__/approval-decision-audit.test.ts`
- Modify: `server/src/services/index.ts`

**Interfaces:**
- Consumes: `logActivity` (`./activity-log.js`), `RiskBand` (Task 5).
- Produces:
  ```ts
  recordDecision(db, { approvalId; companyId; actor: { actorType; actorId; agentId?: string|null }; method: DecisionMethod; outcome: "approved"|"rejected"|"revision_requested"; risk?: { score: number; band: RiskBand } | null; note?: string|null }): Promise<void>;
  // notification-delivery:
  registerChannel(channel: DeliveryChannel): void; getChannels(): DeliveryChannel[];
  type DeliveryChannel = { name: "inbox"|"webpush"|"email"; deliver(target, payload): Promise<void> };
  ```

- [ ] **Step 1: Write the failing test**

`server/src/__tests__/approval-decision-audit.test.ts` (embedded-postgres): seed a company + approval, call `recordDecision(...)`, then query `activityLog` and assert exactly one row with `action = "approval.decision"`, `entityId = approvalId`, and `details.method = "explicit_human"`, `details.outcome = "approved"`, `details.riskBand` present.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/approval-decision-audit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `approval-decision-audit.ts`**

```ts
import type { Db } from "@paperclipai/db";
import { logActivity } from "./activity-log.js";
import type { DecisionMethod } from "./approval-authority.js";
import type { RiskBand } from "./approval-risk.js";

export async function recordDecision(
  db: Db,
  input: {
    approvalId: string; companyId: string;
    actor: { actorType: "user" | "agent" | "system"; actorId: string; agentId?: string | null };
    method: DecisionMethod;
    outcome: "approved" | "rejected" | "revision_requested";
    risk?: { score: number; band: RiskBand } | null;
    note?: string | null;
  },
): Promise<void> {
  await logActivity(db, {
    companyId: input.companyId,
    actorType: input.actor.actorType,
    actorId: input.actor.actorId,
    agentId: input.actor.agentId ?? null,
    action: "approval.decision",
    entityType: "approval",
    entityId: input.approvalId,
    details: {
      method: input.method,
      outcome: input.outcome,
      riskBand: input.risk?.band ?? null,
      riskScore: input.risk?.score ?? null,
      note: input.note ?? null,
    },
  });
}
```

Note: this is **additive** — the existing `approval.approved` / `approval.rejected` activity entries and requester-wakeup logic in `routes/approvals.ts` stay untouched, so Phase 1 is a no-op for existing consumers. `approval.decision` is the new unified cockpit-audit record.

- [ ] **Step 4: Implement `notification-delivery.ts` (inbox seam only)**

```ts
export type DeliveryTarget = { userId?: string; companyId: string };
export type NotificationPayload = { kind: string; title: string; body?: string; link?: string; risk?: { band: string; score: number } };
export type DeliveryChannel = { name: "inbox" | "webpush" | "email"; deliver(target: DeliveryTarget, payload: NotificationPayload): Promise<void> };

const channels = new Map<string, DeliveryChannel>();
export function registerChannel(channel: DeliveryChannel): void { channels.set(channel.name, channel); }
export function getChannels(): DeliveryChannel[] { return [...channels.values()]; }

// Phase 1: inbox channel is a no-op seam — the inbox/sidebar-badge signal already reflects
// pending approvals. webpush/email register here in Phase 3.
registerChannel({ name: "inbox", async deliver() { /* existing inbox signal already covers this */ } });
```

- [ ] **Step 5: Export + run tests**

Add to `server/src/services/index.ts`:
```ts
export { recordDecision } from "./approval-decision-audit.js";
export { registerChannel, getChannels, type DeliveryChannel } from "./notification-delivery.js";
```
Run: `pnpm exec vitest run server/src/__tests__/approval-decision-audit.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/approval-decision-audit.ts server/src/services/notification-delivery.ts server/src/__tests__/approval-decision-audit.test.ts server/src/services/index.ts
git commit -m "feat(combo-05): unified decision audit + delivery-pipeline inbox seam"
```

---

### Task 8: Route existing resolves through resolver + audit; compute risk on create

**Files:**
- Modify: `server/src/routes/approvals.ts`
- Test: `server/src/__tests__/approvals-authority-audit-routes.test.ts`

**Interfaces:**
- Consumes: `canDecide` (Task 6), `recordDecision` (Task 7), `approvalRiskService` (Task 5).

- [ ] **Step 1: Write the failing test**

`server/src/__tests__/approvals-authority-audit-routes.test.ts` (embedded-postgres, full app): create an approval, assert an `approval_risk` snapshot exists after create; approve it as board, assert the response is unchanged (still 200 + approval JSON) AND an `approval.decision` activity row now exists with `method: "explicit_human"`, `outcome: "approved"`. Confirm the pre-existing `approval.approved` row also still exists (no-op preservation).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/approvals-authority-audit-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Compute risk on approval create**

In `server/src/routes/approvals.ts`, in the `POST /companies/:companyId/approvals` handler, after the existing `logActivity(... action: "approval.created" ...)` call, add:

```ts
await approvalRiskService(db).computeAndPersist(approval.id).catch((err) => {
  logger.warn({ err, approvalId: approval.id }, "risk compute failed on approval create");
});
```

Instantiate the service once near the top of `approvalRoutes` alongside `const svc = approvalService(db);`:
```ts
const riskSvc = approvalRiskService(db);
```
and import `approvalRiskService`, `canDecide`, `recordDecision` from `../services/index.js`.

- [ ] **Step 4: Gate + audit the approve path**

In the `POST /approvals/:id/approve` handler, immediately after `const decidedByUserId = req.actor.userId ?? "board";` and before calling `svc.approve(...)`, add the resolver gate + fetch the risk snapshot:

```ts
const approvalForGate = await svc.getById(id);
const risk = approvalForGate ? await riskSvc.getSnapshot(id) : null;
const gate = canDecide({ band: (risk?.band as any) ?? "low", method: "explicit_human" });
if (!gate.allow) { res.status(422).json({ error: gate.deny }); return; }
```

Then after `if (applied) { ... }` completes (still inside the handler, after the existing `logActivity` domain event), add:

```ts
if (applied) {
  await recordDecision(db, {
    approvalId: approval.id, companyId: approval.companyId,
    actor: { actorType: "user", actorId: req.actor.userId ?? "board" },
    method: "explicit_human", outcome: "approved",
    risk: risk ? { score: risk.score, band: risk.band as any } : null,
    note: req.body.decisionNote ?? null,
  });
}
```

- [ ] **Step 5: Apply the same gate + audit to reject and request-revision**

In `POST /approvals/:id/reject`: add the same `canDecide` gate before `svc.reject(...)`, and after `if (applied)` add a `recordDecision` with `outcome: "rejected"`.
In `POST /approvals/:id/request-revision`: add the same gate before `svc.requestRevision(...)`, and after it add a `recordDecision` with `outcome: "revision_requested"` (this path has no `applied` flag — always record on success).

Full reject audit block:
```ts
if (applied) {
  await recordDecision(db, {
    approvalId: approval.id, companyId: approval.companyId,
    actor: { actorType: "user", actorId: req.actor.userId ?? "board" },
    method: "explicit_human", outcome: "rejected",
    risk: risk ? { score: risk.score, band: risk.band as any } : null,
    note: req.body.decisionNote ?? null,
  });
}
```
(compute `risk` via `riskSvc.getSnapshot(id)` the same way as the approve path in each handler).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/approvals-authority-audit-routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Regression-check existing approval route tests**

Run: `pnpm exec vitest run server/src/__tests__/ -t approval`
Expected: existing approval tests still PASS (no behavior change for humans).

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/approvals.ts server/src/__tests__/approvals-authority-audit-routes.test.ts
git commit -m "feat(combo-05): route approvals through authority resolver + decision audit; risk on create"
```

---

### Task 9: Triage service + bulk validator + routes

**Files:**
- Create: `server/src/services/approval-triage.ts`
- Modify: `packages/shared/src/validators/approval.ts` (add `bulkResolveApprovalsSchema`)
- Modify: `packages/shared/src/validators/index.ts` (export it, if barrel exists)
- Modify: `server/src/routes/approvals.ts` (triage GET + bulk POST)
- Modify: `server/src/services/index.ts`
- Test: `server/src/__tests__/approval-triage-routes.test.ts`, `packages/shared/src/validators/approval.test.ts` (extend)

**Interfaces:**
- Consumes: `approvalService`, `approvalRiskService`, `canDecide`, `recordDecision`, `issueApprovalService`.
- Produces:
  ```ts
  approvalTriageService(db).listTriage(companyId): Promise<{ items: TriageItem[]; groups: TriageGroup[] }>;
  approvalTriageService(db).bulkResolve(companyId, { ids, action, note, actor }): Promise<{ results: { id: string; ok: boolean; error?: string }[] }>;
  ```

- [ ] **Step 1: Add the shared validator + test**

In `packages/shared/src/validators/approval.ts`:
```ts
export const bulkResolveApprovalsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(["approve", "reject", "request_changes"]),
  decisionNote: z.string().max(5000).optional().nullable(),
});
export type BulkResolveApprovals = z.infer<typeof bulkResolveApprovalsSchema>;
```
Add an assertion in `packages/shared/src/validators/approval.test.ts` that a valid payload parses and an empty `ids` array throws. Export `bulkResolveApprovalsSchema` from the validators barrel if one exists (match how `resolveApprovalSchema` is exported).

- [ ] **Step 2: Write the failing triage route test**

`server/src/__tests__/approval-triage-routes.test.ts` (embedded-postgres, full app): seed one company with several approvals of differing risk (e.g. one `hire_agent` with a big budget → high/critical, several `work_product` → low), each with a persisted risk snapshot. Assert:
- `GET /api/companies/:id/approvals/triage` returns `items` sorted by `score` descending, and `groups` clustering the low-risk items by type.
- `POST /api/companies/:id/approvals/bulk` with `{ ids: [three low ids], action: "approve" }` returns three `ok: true` results, all three approvals become `approved`, and exactly three `approval.decision` audit rows are written.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/approval-triage-routes.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `approval-triage.ts`**

```ts
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvals, approvalRisk } from "@paperclipai/db";
import { approvalService } from "./approvals.js";
import { approvalRiskService } from "./approval-risk.js";
import { canDecide } from "./approval-authority.js";
import { recordDecision } from "./approval-decision-audit.js";

const OPEN_STATUSES = ["pending", "revision_requested"];

export function approvalTriageService(db: Db) {
  const svc = approvalService(db);
  const riskSvc = approvalRiskService(db);

  return {
    async listTriage(companyId: string) {
      const rows = await db
        .select({
          approval: approvals,
          score: approvalRisk.score,
          band: approvalRisk.band,
          reasons: approvalRisk.reasons,
        })
        .from(approvals)
        .leftJoin(approvalRisk, eq(approvalRisk.approvalId, approvals.id))
        .where(and(eq(approvals.companyId, companyId), inArray(approvals.status, OPEN_STATUSES)));

      const items = rows
        .map((r) => ({ ...r.approval, risk: { score: r.score ?? 0, band: r.band ?? "low", reasons: r.reasons ?? [] } }))
        .sort((a, b) => b.risk.score - a.risk.score);

      const groupMap = new Map<string, { key: string; type: string; agentId: string | null; ids: string[] }>();
      for (const it of items) {
        const key = `${it.type}::${it.requestedByAgentId ?? "none"}`;
        const g = groupMap.get(key) ?? { key, type: it.type, agentId: it.requestedByAgentId ?? null, ids: [] };
        g.ids.push(it.id);
        groupMap.set(key, g);
      }
      return { items, groups: [...groupMap.values()] };
    },

    async bulkResolve(
      companyId: string,
      input: { ids: string[]; action: "approve" | "reject" | "request_changes"; note?: string | null; actor: { actorId: string } },
    ) {
      const results: { id: string; ok: boolean; error?: string }[] = [];
      for (const id of input.ids) {
        try {
          const approval = await svc.getById(id);
          if (!approval || approval.companyId !== companyId) { results.push({ id, ok: false, error: "not found" }); continue; }
          const risk = await riskSvc.getSnapshot(id);
          const gate = canDecide({ band: (risk?.band as any) ?? "low", method: "explicit_human" });
          if (!gate.allow) { results.push({ id, ok: false, error: gate.deny }); continue; }

          const outcome =
            input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "revision_requested";
          if (input.action === "approve") await svc.approve(id, input.actor.actorId, input.note);
          else if (input.action === "reject") await svc.reject(id, input.actor.actorId, input.note);
          else await svc.requestRevision(id, input.actor.actorId, input.note);

          await recordDecision(db, {
            approvalId: id, companyId,
            actor: { actorType: "user", actorId: input.actor.actorId },
            method: "explicit_human", outcome,
            risk: risk ? { score: risk.score, band: risk.band as any } : null,
            note: input.note ?? null,
          });
          results.push({ id, ok: true });
        } catch (err) {
          results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return { results };
    },
  };
}
```

- [ ] **Step 5: Add the routes**

In `server/src/routes/approvals.ts`, import `approvalTriageService` and `bulkResolveApprovalsSchema`, instantiate `const triageSvc = approvalTriageService(db);`, and add:

```ts
router.get("/companies/:companyId/approvals/triage", async (req, res) => {
  const companyId = req.params.companyId as string;
  assertCompanyAccess(req, companyId);
  if (!(await assertApprovalAccessAllowed(req, res, companyId))) return;
  res.json(await triageSvc.listTriage(companyId));
});

router.post("/companies/:companyId/approvals/bulk", validate(bulkResolveApprovalsSchema), async (req, res) => {
  assertBoard(req);
  const companyId = req.params.companyId as string;
  assertCompanyAccess(req, companyId);
  const actor = getActorInfo(req);
  const result = await triageSvc.bulkResolve(companyId, {
    ids: req.body.ids, action: req.body.action, note: req.body.decisionNote ?? null,
    actor: { actorId: req.actor.userId ?? "board" },
  });
  res.json(result);
});
```

Register `triageSvc` route ordering note: define the `/companies/:companyId/approvals/triage` route **before** any `/companies/:companyId/approvals/:something` param route so `triage` is not swallowed by a param match (the existing list route is exact `/approvals`, so ordering is safe, but keep triage above the bulk/param routes).

- [ ] **Step 6: Export + run tests**

Add `export { approvalTriageService } from "./approval-triage.js";` to `server/src/services/index.ts`.
Run: `pnpm exec vitest run server/src/__tests__/approval-triage-routes.test.ts packages/shared/src/validators/approval.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/approval-triage.ts server/src/routes/approvals.ts server/src/services/index.ts packages/shared/src/validators/approval.ts packages/shared/src/validators/approval.test.ts server/src/__tests__/approval-triage-routes.test.ts
git commit -m "feat(combo-05): risk-sorted triage inbox + grouped bulk resolve"
```

---

### Task 10: UI — API client additions + `RunChangesetView` component

**Files:**
- Modify: `ui/src/api/approvals.ts`
- Create: `ui/src/api/runChangesets.ts`
- Create: `ui/src/components/RunChangesetView.tsx`
- Test: `ui/src/components/RunChangesetView.test.tsx`

**Interfaces:**
- Produces: `runChangesetsApi.get(runId)`, `approvalsApi.triage(companyId)`, `approvalsApi.bulk(companyId, body)`; `<RunChangesetView changeset={...} />`.

- [ ] **Step 1: Add the API clients**

`ui/src/api/runChangesets.ts`:
```ts
import { api } from "./client";

export type RunChangesetFile = {
  path: string; status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  oldPath?: string; additions: number; deletions: number; binary: boolean; truncated: boolean; diff?: string;
};
export type RunChangeset = {
  id: string; heartbeatRunId: string; baseRef: string | null; headRef: string | null;
  files: RunChangesetFile[]; commands: { command: string; status: string; exitCode: number | null }[];
  summaryStats: { filesChanged: number; additions: number; deletions: number }; warning: string | null;
};

export const runChangesetsApi = {
  get: (runId: string) => api.get<RunChangeset>(`/runs/${runId}/changeset`),
};
```

In `ui/src/api/approvals.ts`, add to `approvalsApi`:
```ts
  triage: (companyId: string) =>
    api.get<{ items: any[]; groups: { key: string; type: string; agentId: string | null; ids: string[] }[] }>(
      `/companies/${companyId}/approvals/triage`,
    ),
  bulk: (companyId: string, body: { ids: string[]; action: "approve" | "reject" | "request_changes"; decisionNote?: string }) =>
    api.post<{ results: { id: string; ok: boolean; error?: string }[] }>(`/companies/${companyId}/approvals/bulk`, body),
```

- [ ] **Step 2: Write the failing component test**

`ui/src/components/RunChangesetView.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunChangesetView } from "./RunChangesetView";

const changeset = {
  id: "c1", heartbeatRunId: "r1", baseRef: "main", headRef: "abc",
  files: [
    { path: "src/a.ts", status: "modified", additions: 3, deletions: 1, binary: false, truncated: false, diff: "@@\n+added line\n" },
    { path: "img.png", status: "added", additions: 0, deletions: 0, binary: true, truncated: false },
  ],
  commands: [{ command: "pnpm test", status: "completed", exitCode: 0 }],
  summaryStats: { filesChanged: 2, additions: 3, deletions: 1 }, warning: null,
} as const;

describe("RunChangesetView", () => {
  it("lists files with status and shows a diff for text files", () => {
    render(<RunChangesetView changeset={changeset as any} />);
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText(/\+added line/)).toBeInTheDocument();
    expect(screen.getByText("img.png")).toBeInTheDocument();
    expect(screen.getByText(/binary/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run ui/src/components/RunChangesetView.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement `RunChangesetView.tsx`**

```tsx
import type { RunChangeset } from "../api/runChangesets";

const STATUS_LABEL: Record<string, string> = {
  added: "A", modified: "M", deleted: "D", renamed: "R", untracked: "?",
};

export function RunChangesetView({ changeset }: { changeset: RunChangeset }) {
  return (
    <div className="run-changeset">
      {changeset.warning ? <p className="run-changeset__warning">{changeset.warning}</p> : null}
      <p className="run-changeset__summary">
        {changeset.summaryStats.filesChanged} files · +{changeset.summaryStats.additions} −{changeset.summaryStats.deletions}
      </p>
      <ul className="run-changeset__files">
        {changeset.files.map((f) => (
          <li key={f.path} className="run-changeset__file">
            <span className="run-changeset__status" aria-label={f.status}>{STATUS_LABEL[f.status] ?? "?"}</span>
            <span className="run-changeset__path">{f.path}</span>
            <span className="run-changeset__counts">+{f.additions} −{f.deletions}</span>
            {f.binary ? <span className="run-changeset__note">binary — download to view</span> : null}
            {f.truncated ? <span className="run-changeset__note">diff too large — download to view</span> : null}
            {f.diff ? <pre className="run-changeset__diff">{f.diff}</pre> : null}
          </li>
        ))}
      </ul>
      {changeset.commands.length ? (
        <ul className="run-changeset__commands">
          {changeset.commands.map((c, i) => (
            <li key={i}>{c.command} — {c.status}{c.exitCode != null ? ` (exit ${c.exitCode})` : ""}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run ui/src/components/RunChangesetView.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/api/runChangesets.ts ui/src/api/approvals.ts ui/src/components/RunChangesetView.tsx ui/src/components/RunChangesetView.test.tsx
git commit -m "feat(combo-05): UI changeset view + triage/bulk/changeset api clients"
```

---

### Task 11: UI — triage inbox (risk-sorted, grouped, bulk actions)

**Files:**
- Create: `ui/src/pages/ApprovalTriage.tsx`
- Test: `ui/src/pages/ApprovalTriage.test.tsx`
- Modify: `ui/src/App.tsx` (route) and the nav/sidebar entry that lists Approvals (mirror the existing `Approvals` route registration)

**Interfaces:**
- Consumes: `approvalsApi.triage`, `approvalsApi.bulk` (Task 10).

- [ ] **Step 1: Write the failing test**

`ui/src/pages/ApprovalTriage.test.tsx`: mock `approvalsApi.triage` to return two low-risk `work_product` items in one group and one `critical` `hire_agent` item; render with a QueryClient provider (mirror `ui/src/pages/Inbox.test.tsx` for provider setup). Assert: items render highest-risk first; selecting a group and clicking "Approve selected" calls `approvalsApi.bulk` with the group's ids and `action: "approve"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run ui/src/pages/ApprovalTriage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ApprovalTriage.tsx`**

Build a page that:
- Loads triage via `useQuery` keyed on `["approval-triage", companyId]` calling `approvalsApi.triage(companyId)` (follow the query-key + hook pattern in `ui/src/pages/Approvals.tsx`).
- Renders `items` in the returned (risk-sorted) order, each with a risk-band chip (`item.risk.band`) and a checkbox.
- Renders `groups` with a group header ("{type} · {n} items") and a "select group" control that checks all ids in `group.ids`.
- Has "Approve selected" / "Reject selected" / "Request changes" buttons that call a `useMutation` wrapping `approvalsApi.bulk(companyId, { ids: selectedIds, action })` and invalidate the triage query on success.

Concrete skeleton:

```tsx
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";

export function ApprovalTriage({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["approval-triage", companyId], queryFn: () => approvalsApi.triage(companyId) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const items = data?.items ?? [];
  const groups = data?.groups ?? [];

  const bulk = useMutation({
    mutationFn: (action: "approve" | "reject" | "request_changes") =>
      approvalsApi.bulk(companyId, { ids: [...selected], action }),
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ["approval-triage", companyId] }); },
  });

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectGroup = (ids: string[]) => setSelected((s) => new Set([...s, ...ids]));

  return (
    <div className="approval-triage">
      <div className="approval-triage__actions">
        <button disabled={!selected.size || bulk.isPending} onClick={() => bulk.mutate("approve")}>Approve selected</button>
        <button disabled={!selected.size || bulk.isPending} onClick={() => bulk.mutate("reject")}>Reject selected</button>
        <button disabled={!selected.size || bulk.isPending} onClick={() => bulk.mutate("request_changes")}>Request changes</button>
      </div>
      <ul className="approval-triage__groups">
        {groups.map((g) => (
          <li key={g.key}>
            <button onClick={() => selectGroup(g.ids)}>{g.type} · {g.ids.length} items</button>
          </li>
        ))}
      </ul>
      <ul className="approval-triage__items">
        {items.map((it: any) => (
          <li key={it.id}>
            <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} aria-label={`select ${it.id}`} />
            <span className={`risk-chip risk-chip--${it.risk.band}`}>{it.risk.band}</span>
            <span>{it.type}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route**

In `ui/src/App.tsx`, register `ApprovalTriage` at a company-scoped path (mirror how `Approvals` is routed) and add a sidebar/nav link next to Approvals.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run ui/src/pages/ApprovalTriage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/pages/ApprovalTriage.tsx ui/src/pages/ApprovalTriage.test.tsx ui/src/App.tsx
git commit -m "feat(combo-05): triage inbox page (risk-sorted, grouped, bulk actions)"
```

---

### Task 12: Wire the changeset into the approval detail + full-suite verification

**Files:**
- Modify: `ui/src/pages/ApprovalDetail.tsx` (render `RunChangesetView` when the approval references a run)
- Test: extend `ui/src/pages/ApprovalDetail`-adjacent test or add `ui/src/pages/ApprovalDetail.changeset.test.tsx`

**Interfaces:**
- Consumes: `runChangesetsApi.get` (Task 10), `RunChangesetView` (Task 10).

- [ ] **Step 1: Write the failing test**

Add a test that, given an approval whose `payload.runId` is set, `ApprovalDetail` fetches `runChangesetsApi.get(runId)` and renders the diff (mock the api; assert a changed file path appears).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run ui/src/pages/ApprovalDetail.changeset.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Render the changeset in `ApprovalDetail.tsx`**

When `approval.payload.runId` is a string, add a `useQuery(["run-changeset", runId], () => runChangesetsApi.get(runId))` and render `<RunChangesetView changeset={data} />` in a "Changes" section (guard on `data` present; show nothing if the query 404s — no changeset recorded).

```tsx
const runId = typeof approval?.payload?.runId === "string" ? approval.payload.runId : null;
const { data: changeset } = useQuery({
  queryKey: ["run-changeset", runId], enabled: !!runId,
  queryFn: () => runChangesetsApi.get(runId as string),
  retry: false,
});
// ...in JSX:
{changeset ? <section><h3>Changes</h3><RunChangesetView changeset={changeset} /></section> : null}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run ui/src/pages/ApprovalDetail.changeset.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full-suite + typecheck gate**

Run: `pnpm test`
Expected: full suite PASS (embedded-postgres suites run where supported; skipped only on unsupported hosts).
Run: `pnpm --filter @paperclipai/server exec tsc --noEmit && pnpm --filter @paperclipai/ui exec tsc --noEmit`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add ui/src/pages/ApprovalDetail.tsx ui/src/pages/ApprovalDetail.changeset.test.tsx
git commit -m "feat(combo-05): show run changeset diff in approval detail"
```

---

## Self-Review

**Spec coverage:**
- Risk model + signal registry + persisted snapshot → Task 5. ✔
- Changeset capture (`baseRef...HEAD` + untracked, at finalize, persisted, survives cleanup) → Tasks 2–4. ✔
- Diff renderer / read path → Task 4 (route), Task 10 (`RunChangesetView`), Task 12 (approval detail). ✔
- Authority resolver seeded with `explicit_human` + above-band hard rule + locked precedence → Task 6, enforced in Tasks 8–9. ✔
- Delivery pipeline (`inbox` only, stubbed registry) → Task 7. ✔
- Decision audit (`recordDecision`, one per item incl. bulk) → Task 7, applied Tasks 8–9. ✔
- Triage inbox (risk-sorted + grouped + bulk) → Task 9 (API), Task 11 (UI). ✔
- Data model (`run_changesets`, `approval_risk`) → Task 1. ✔
- Error handling: capture never blocks finalize (Task 4 best-effort `void … .catch`); missing workspace → warning + empty files (Task 3); resolver deny → 422 per-id in bulk (Task 9); risk recompute failure → `.catch` keeps last snapshot (Task 8). ✔
- Explicitly out of scope (auto-approve, push, digest, delegation, stakeholder page, run-to-run comparison, AI summary) → not implemented; only the stub registries/precedence points exist. ✔

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". Two intentional implementer-judgement points are bounded and concrete: the heartbeat capture anchor (Task 4 Step 1 gives the exact search landmark `decideRunLivenessContinuation(`) and the UI route/nav registration (Task 11 Step 4 says mirror the existing `Approvals` route). A manual capture endpoint (Task 4) makes the changeset feature testable independent of the heartbeat wiring.

**Type consistency:** `RiskBand` (`low|medium|high|critical`) and `RISK_BAND_ORDER` defined in Task 5 and consumed in Tasks 6/8/9. `DecisionMethod` + `METHOD_PRECEDENCE` defined Task 6, consumed Tasks 7/8/9. `RunChangesetFile`/`RunChangesetCommand` defined in Task 1 (DB) and reused in Tasks 2/3 and mirrored in the UI type (Task 10). `canDecide` / `recordDecision` / `computeAndPersist` signatures match across service and route usage. `runChangesetService` methods `captureForRun`/`getForRun` consistent across Tasks 3/4.

**Task 1 unique index (resolved):** Task 3's `onConflictDoNothing` requires a unique constraint on `run_changesets.heartbeatRunId`. Task 1's schema marks it `.unique()`, so the migration generated in Task 1 Step 4 carries the constraint — no separate follow-up needed.
