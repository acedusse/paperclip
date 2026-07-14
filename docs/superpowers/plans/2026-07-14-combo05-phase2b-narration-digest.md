# Combo-05 Phase 2b — Narration Engine + Scheduled Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a schedule, assemble "what needs the human" for each active company into a narrated, persisted digest, delivered through the Phase-1 inbox channel and rendered on a `/digest` page.

**Architecture:** Pure signal collection (`digest-signals.ts`) + a pure, pluggable narration engine (`digest-narration.ts`) feed a `digestService` that persists a `digests` row **through** the Phase-1 delivery pipeline — whose `inbox` channel is upgraded from a no-op to a db-bound channel. A per-company 24h-gated `sweep()` runs on the existing `server/src/index.ts` tick; a board-only `generate` endpoint triggers it on demand. A `/digest` page renders the latest digest.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), drizzle-orm + PostgreSQL, Express, vitest + embedded-postgres for server tests, React + `react-dom/act` for UI tests.

## Global Constraints

- Language/module: TypeScript, ESM; **all relative imports use `.js` extensions**.
- Services are factory functions: `export function xService(db: Db) { return { ... } }`.
- Server DB tests use the embedded-postgres harness: `getEmbeddedPostgresTestSupport()` / `startEmbeddedPostgresTestDatabase()` from `server/src/__tests__/helpers/embedded-postgres.js`; guard with `describeEmbeddedPostgres`.
- Pure (no-DB) tests are plain vitest files colocated as `*.test.ts`.
- Run a single test file: `pnpm exec vitest run <path>`. Full suite: `pnpm test`.
- Migrations: hand-write raw SQL + a `meta/_journal.json` entry — **never `drizzle-kit generate`** (snapshot baseline stale at 0098). Next free number is **`0113`**. Mirror `0112_combo05_auto_approve_policies.sql`.
- Delivery is best-effort: **digest generation must never throw into the tick loop.** A signal collector that throws degrades that signal to empty; a channel that throws is logged and skipped; `sweep`'s per-company loop isolates failures.
- Risk bands: `RiskBand = "low"|"medium"|"high"|"critical"` (exported from `server/src/services/approval-risk.ts`).
- Stale-run threshold: `STALE_RUN_HOURS = 6`. Live run statuses: `["queued","running","scheduled_retry"]`.
- Digest cadence gate: `DIGEST_MIN_INTERVAL_HOURS = 24`.
- **`new Date()` is allowed** in server runtime code here (the Workflow-script restriction does not apply).
- Follow the existing file-header comment block convention when creating new files (see any `server/src/services/*.ts`).
- The delivery channel registry (`registerChannel`/`getChannels`) is a global singleton. Server test files are process-isolated (`isolate: true, pool: "forks"`), so registering a channel in a test's setup does not leak across files. Register the db-bound inbox channel with the **same** `db` the service under test uses.

---

## File Structure

**New:**
- `packages/db/src/schema/digests.ts` — the `digests` table + inferred type.
- `packages/db/src/migrations/0113_combo05_digests.sql` — hand-written migration.
- `server/src/services/digest-signals.ts` — `collectDigestSignals` + `DigestSignals` type.
- `server/src/services/digest-narration.ts` — pure narrator + `DigestPayload`/`DigestNarrator` types.
- `server/src/services/digest.ts` — `digestService` (generate/latest/list/sweep).
- `server/src/routes/digests.ts` — board-only read + generate routes.
- `ui/src/api/digests.ts`, `ui/src/pages/Digest.tsx` — API client + page/panel.

**Modified:**
- `packages/db/src/schema/index.ts` — export `digests`.
- `server/src/services/notification-delivery.ts` — db-bound inbox channel factory; drop the no-op; extend `NotificationPayload`.
- `server/src/services/index.ts` — export `digestService`, `collectDigestSignals`, `narrateDigest`, `deterministicNarrator`, `createInboxDigestChannel`.
- `server/src/app.ts` — register the inbox channel with db; mount `digests` routes.
- `server/src/index.ts` — `digestService(db).sweep(...)` on the tick.
- `ui/src/App.tsx` + nav — `/digest` route + link.

---

### Task 1: DB schema — `digests` table + migration

**Files:**
- Create: `packages/db/src/schema/digests.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/migrations/0113_combo05_digests.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Test: `packages/db/src/__tests__/schema-digests.test.ts`

**Interfaces:**
- Produces: `digests` table; type `DigestRow = typeof digests.$inferSelect`.

- [ ] **Step 1: Write the schema**

`packages/db/src/schema/digests.ts`:

```ts
import { index, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const digests = pgTable(
  "digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyGeneratedIdx: index("digests_company_generated_idx").on(table.companyId, table.generatedAt),
  }),
);

export type DigestRow = typeof digests.$inferSelect;
```

- [ ] **Step 2: Export from the schema barrel**

In `packages/db/src/schema/index.ts`, add before the `// [END: module]` line (match the existing `export { … } from "./file.js"` style):

```ts
export { digests, type DigestRow } from "./digests.js";
```

- [ ] **Step 3: Hand-write the migration**

Create `packages/db/src/migrations/0113_combo05_digests.sql`:

```sql
CREATE TABLE IF NOT EXISTS "digests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "period_start" timestamp with time zone,
  "period_end" timestamp with time zone,
  "payload" jsonb NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "digests_company_generated_idx" ON "digests" ("company_id","generated_at");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "digests" ADD CONSTRAINT "digests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
```

- [ ] **Step 4: Register the journal entry**

Append to the `entries` array in `packages/db/src/migrations/meta/_journal.json`, immediately after the `idx: 112` entry (copy the 112 entry's shape; only `idx`, `when`, `tag` change):

```json
    {
      "idx": 113,
      "version": "7",
      "when": 1784200000000,
      "tag": "0113_combo05_digests",
      "breakpoints": true
    }
```

- [ ] **Step 5: Write a schema smoke test**

`packages/db/src/__tests__/schema-digests.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { digests } from "../schema/index.js";

describe("digests schema", () => {
  it("exposes the digests table", () => {
    expect(digests).toBeDefined();
  });
});
```

- [ ] **Step 6: Verify numbering + run test**

Run: `pnpm --filter @paperclipai/db run check:migrations`
Expected: PASS.
Run: `pnpm exec vitest run packages/db/src/__tests__/schema-digests.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/digests.ts packages/db/src/schema/index.ts \
  packages/db/src/migrations/0113_combo05_digests.sql packages/db/src/migrations/meta/_journal.json \
  packages/db/src/__tests__/schema-digests.test.ts
git commit -m "feat(combo-05): digests schema and migration"
```

---

### Task 2: Signal collection — `collectDigestSignals`

**Files:**
- Create: `server/src/services/digest-signals.ts`
- Test: `server/src/__tests__/digest-signals.test.ts`

**Interfaces:**
- Consumes: `approvalTriageService` (Phase 1), `activityLog`, `heartbeatRuns`, `RiskBand`.
- Produces:
  ```ts
  export type DigestSignals = {
    openApprovals: { total: number; byBand: Record<RiskBand, number>; top: { id: string; type: string; band: RiskBand; score: number }[] };
    autoApprovedSince: number;
    staleRuns: { total: number; top: { runId: string; agentId: string | null; status: string; staleForMinutes: number }[] };
  };
  export function collectDigestSignals(db: Db, companyId: string, since: Date): Promise<DigestSignals>;
  ```

- [ ] **Step 1: Write the failing test**

`server/src/__tests__/digest-signals.test.ts` (embedded-postgres — mirror the header of `server/src/__tests__/auto-approve-policy-service.test.ts`). Seed a company + agent. Seed: two open `request_board_approval` approvals with `approval_risk` rows (`band: "low"` score 5, `band: "high"` score 60); one `activity_log` row `action="approval.decision"`, `details: { method: "auto_policy" }`, `createdAt = now` (after `since`); one `activity_log` row same shape but `createdAt` **before** `since`; one `heartbeat_runs` row `status: "running"`, `updatedAt` = 7h ago (stale); one `heartbeat_runs` row `status: "running"`, `updatedAt = now` (fresh). Then:

```ts
const since = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
const s = await collectDigestSignals(db, companyId, since);

expect(s.openApprovals.total).toBe(2);
expect(s.openApprovals.byBand.low).toBe(1);
expect(s.openApprovals.byBand.high).toBe(1);
expect(s.openApprovals.top[0]!.band).toBe("high"); // sorted by score desc

expect(s.autoApprovedSince).toBe(1); // only the row after `since`

expect(s.staleRuns.total).toBe(1); // only the 7h-old running run
expect(s.staleRuns.top[0]!.staleForMinutes).toBeGreaterThanOrEqual(360);
```

Seed timestamps with explicit `new Date(Date.now() - N)` values. For the stale run, set `updatedAt` to `new Date(Date.now() - 7 * 60 * 60 * 1000)` via the insert values.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/digest-signals.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `digest-signals.ts`**

```ts
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityLog, heartbeatRuns } from "@paperclipai/db";
import { approvalTriageService } from "./approval-triage.js";
import type { RiskBand } from "./approval-risk.js";

const LIVE_RUN_STATUSES = ["queued", "running", "scheduled_retry"];
const STALE_RUN_HOURS = 6;
const BANDS: RiskBand[] = ["low", "medium", "high", "critical"];

export type DigestSignals = {
  openApprovals: {
    total: number;
    byBand: Record<RiskBand, number>;
    top: { id: string; type: string; band: RiskBand; score: number }[];
  };
  autoApprovedSince: number;
  staleRuns: {
    total: number;
    top: { runId: string; agentId: string | null; status: string; staleForMinutes: number }[];
  };
};

export async function collectDigestSignals(db: Db, companyId: string, since: Date): Promise<DigestSignals> {
  const now = Date.now();

  // Open approvals — reuse the Phase-1 triage service (already risk-sorted).
  const { items } = await approvalTriageService(db).listTriage(companyId);
  const byBand: Record<RiskBand, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const it of items) {
    const band = (it.risk.band as RiskBand) ?? "low";
    if (BANDS.includes(band)) byBand[band] += 1;
  }
  const openApprovals = {
    total: items.length,
    byBand,
    top: items.slice(0, 3).map((it) => ({
      id: it.id,
      type: it.type,
      band: (it.risk.band as RiskBand) ?? "low",
      score: it.risk.score ?? 0,
    })),
  };

  // Auto-approved since `since` — approval.decision audit rows with method=auto_policy.
  const autoRows = await db
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.companyId, companyId),
        eq(activityLog.action, "approval.decision"),
        sql`${activityLog.details} ->> 'method' = 'auto_policy'`,
        sql`${activityLog.createdAt} >= ${since}`,
      ),
    );
  const autoApprovedSince = autoRows.length;

  // Stale runs — live-status runs not updated in > STALE_RUN_HOURS.
  const staleThreshold = new Date(now - STALE_RUN_HOURS * 60 * 60 * 1000);
  const staleRows = await db
    .select({
      id: heartbeatRuns.id,
      agentId: heartbeatRuns.agentId,
      status: heartbeatRuns.status,
      updatedAt: heartbeatRuns.updatedAt,
    })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, companyId),
        inArray(heartbeatRuns.status, LIVE_RUN_STATUSES),
        lt(heartbeatRuns.updatedAt, staleThreshold),
      ),
    );
  const staleSorted = staleRows
    .map((r) => ({
      runId: r.id,
      agentId: r.agentId ?? null,
      status: r.status,
      staleForMinutes: Math.floor((now - r.updatedAt.getTime()) / 60000),
    }))
    .sort((a, b) => b.staleForMinutes - a.staleForMinutes);

  return {
    openApprovals,
    autoApprovedSince,
    staleRuns: { total: staleSorted.length, top: staleSorted.slice(0, 3) },
  };
}
```

If `heartbeatRuns.agentId` is non-nullable in the schema, drop the `?? null`. If `listTriage` items expose `risk.band`/`risk.score` under different names, adjust the two `it.risk.*` reads (confirm against `server/src/services/approval-triage.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/digest-signals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/digest-signals.ts server/src/__tests__/digest-signals.test.ts
git commit -m "feat(combo-05): digest signal collection (approvals, auto-approved, stale runs)"
```

---

### Task 3: Narration engine (pure)

**Files:**
- Create: `server/src/services/digest-narration.ts`
- Test: `server/src/services/digest-narration.test.ts`

**Interfaces:**
- Consumes: `DigestSignals` (Task 2).
- Produces:
  ```ts
  export type DigestSection = { key: string; title: string; lines: string[] };
  export type DigestPayload = { headline: string; sections: DigestSection[]; text: string; signals: DigestSignals };
  export type DigestNarrator = (signals: DigestSignals) => DigestPayload;
  export const deterministicNarrator: DigestNarrator;
  export function narrateDigest(signals: DigestSignals, narrator?: DigestNarrator): DigestPayload;
  ```

- [ ] **Step 1: Write the failing test**

`server/src/services/digest-narration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { narrateDigest, deterministicNarrator } from "./digest-narration.js";
import type { DigestSignals } from "./digest-signals.js";

const empty: DigestSignals = {
  openApprovals: { total: 0, byBand: { low: 0, medium: 0, high: 0, critical: 0 }, top: [] },
  autoApprovedSince: 0,
  staleRuns: { total: 0, top: [] },
};

describe("narrateDigest", () => {
  it("produces a calm headline and no sections when nothing needs the human", () => {
    const p = narrateDigest(empty);
    expect(p.headline.toLowerCase()).toContain("nothing");
    expect(p.sections).toEqual([]);
  });

  it("leads with the approval ask and includes a section per non-empty signal", () => {
    const signals: DigestSignals = {
      openApprovals: {
        total: 3,
        byBand: { low: 2, medium: 0, high: 0, critical: 1 },
        top: [{ id: "a1", type: "hire_agent", band: "critical", score: 90 }],
      },
      autoApprovedSince: 7,
      staleRuns: { total: 1, top: [{ runId: "r1", agentId: "ag1", status: "running", staleForMinutes: 400 }] },
    };
    const p = narrateDigest(signals);
    expect(p.headline).toContain("3 approvals");
    const keys = p.sections.map((s) => s.key);
    expect(keys).toEqual(["approvals", "auto-handled", "stale-runs"]);
    expect(p.text).toContain("hire_agent");
    expect(p.text).toContain("7");
  });

  it("is deterministic", () => {
    expect(narrateDigest(empty)).toEqual(narrateDigest(empty));
  });

  it("exposes the deterministic narrator as the default", () => {
    expect(narrateDigest(empty, deterministicNarrator)).toEqual(narrateDigest(empty));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/services/digest-narration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `digest-narration.ts`**

```ts
import type { DigestSignals } from "./digest-signals.js";

export type DigestSection = { key: string; title: string; lines: string[] };
export type DigestPayload = { headline: string; sections: DigestSection[]; text: string; signals: DigestSignals };
export type DigestNarrator = (signals: DigestSignals) => DigestPayload;

function approvalsSection(s: DigestSignals): DigestSection | null {
  const a = s.openApprovals;
  if (a.total === 0) return null;
  const bandParts = (["critical", "high", "medium", "low"] as const)
    .filter((b) => a.byBand[b] > 0)
    .map((b) => `${a.byBand[b]} ${b}`);
  const lines = [bandParts.join(", ")];
  for (const t of a.top) lines.push(`top: ${t.type} (score ${t.score}, ${t.band})`);
  return { key: "approvals", title: "Approvals waiting", lines };
}

function autoHandledSection(s: DigestSignals): DigestSection | null {
  if (s.autoApprovedSince === 0) return null;
  return {
    key: "auto-handled",
    title: "Handled for you",
    lines: [`${s.autoApprovedSince} approval${s.autoApprovedSince === 1 ? "" : "s"} auto-approved by policy since the last digest`],
  };
}

function staleRunsSection(s: DigestSignals): DigestSection | null {
  if (s.staleRuns.total === 0) return null;
  const lines = [`${s.staleRuns.total} run${s.staleRuns.total === 1 ? "" : "s"} idle`];
  for (const r of s.staleRuns.top) {
    lines.push(`${r.status} run idle ${Math.floor(r.staleForMinutes / 60)}h${r.agentId ? ` (agent ${r.agentId})` : ""}`);
  }
  return { key: "stale-runs", title: "Stuck runs", lines };
}

export const deterministicNarrator: DigestNarrator = (signals) => {
  const sections = [approvalsSection(signals), autoHandledSection(signals), staleRunsSection(signals)].filter(
    (x): x is DigestSection => x !== null,
  );

  const n = signals.openApprovals.total;
  const headline =
    n > 0 ? `${n} approval${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you` : "Nothing needs you right now";

  const text = [headline, ...sections.flatMap((sec) => [sec.title, ...sec.lines.map((l) => `  ${l}`)])].join("\n");

  return { headline, sections, text, signals };
};

export function narrateDigest(signals: DigestSignals, narrator: DigestNarrator = deterministicNarrator): DigestPayload {
  return narrator(signals);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/services/digest-narration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/digest-narration.ts server/src/services/digest-narration.test.ts
git commit -m "feat(combo-05): deterministic pluggable digest narration engine"
```

---

### Task 4: Upgrade the inbox delivery channel (db-bound; persists digests)

**Files:**
- Modify: `server/src/services/notification-delivery.ts`
- Test: `server/src/__tests__/inbox-digest-channel.test.ts`

**Interfaces:**
- Consumes: `digests` table, `DigestPayload` (Task 3).
- Produces:
  ```ts
  // NotificationPayload gains:
  //   digest?: { payload: DigestPayload; periodStart: Date | null; periodEnd: Date };
  export function createInboxDigestChannel(db: Db): DeliveryChannel;
  ```

- [ ] **Step 1: Write the failing test**

`server/src/__tests__/inbox-digest-channel.test.ts` (embedded-postgres). Seed a company. Then:

```ts
const channel = createInboxDigestChannel(db);
const periodEnd = new Date();
await channel.deliver(
  { companyId },
  { kind: "digest", title: "3 approvals need you", digest: { payload: samplePayload, periodStart: null, periodEnd } },
);
const rows = await db.select().from(digests).where(eq(digests.companyId, companyId));
expect(rows).toHaveLength(1);
expect((rows[0]!.payload as any).headline).toBe("3 approvals need you");
expect(rows[0]!.generatedAt.getTime()).toBe(periodEnd.getTime());

// a payload without a digest field is a no-op (no throw, no row)
await channel.deliver({ companyId }, { kind: "other", title: "x" });
expect(await db.select().from(digests).where(eq(digests.companyId, companyId))).toHaveLength(1);
```

`samplePayload` is any object with a `headline` field, e.g. `{ headline: "3 approvals need you", sections: [], text: "…", signals: {} }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/inbox-digest-channel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit `notification-delivery.ts`**

Add imports at the top of the module body:
```ts
import type { Db } from "@paperclipai/db";
import { digests } from "@paperclipai/db";
import type { DigestPayload } from "./digest-narration.js";
```

Extend `NotificationPayload` — add the optional `digest` field:
```ts
export type NotificationPayload = {
  kind: string;
  title: string;
  body?: string;
  link?: string;
  risk?: { band: string; score: number };
  digest?: { payload: DigestPayload; periodStart: Date | null; periodEnd: Date };
};
```

**Remove** the Phase-1 module-load no-op registration block:
```ts
// DELETE THIS:
registerChannel({
  name: "inbox",
  async deliver() {
    // existing inbox signal already covers this
  },
});
```

Add the db-bound factory (before `// [END: module]`):
```ts
/** Phase 2b: the inbox channel persists a digest row. Registered at app startup with a db handle. */
export function createInboxDigestChannel(db: Db): DeliveryChannel {
  return {
    name: "inbox",
    async deliver(target, payload) {
      if (!payload.digest) return; // only digest payloads land in the digests table
      await db.insert(digests).values({
        companyId: target.companyId,
        periodStart: payload.digest.periodStart,
        periodEnd: payload.digest.periodEnd,
        payload: payload.digest.payload as unknown as Record<string, unknown>,
        generatedAt: payload.digest.periodEnd,
      });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/inbox-digest-channel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/notification-delivery.ts server/src/__tests__/inbox-digest-channel.test.ts
git commit -m "feat(combo-05): db-bound inbox delivery channel persists digests"
```

---

### Task 5: `digestService` — generate / latest / list / sweep

**Files:**
- Create: `server/src/services/digest.ts`
- Modify: `server/src/services/index.ts`
- Test: `server/src/__tests__/digest-service.test.ts`

**Interfaces:**
- Consumes: `collectDigestSignals` (Task 2), `narrateDigest` (Task 3), `getChannels` (`notification-delivery`), `companies`, `digests`.
- Produces:
  ```ts
  export function digestService(db: Db): {
    generateForCompany(companyId: string): Promise<DigestRow | null>;
    latest(companyId: string): Promise<DigestRow | null>;
    list(companyId: string, limit?: number): Promise<DigestRow[]>;
    sweep(now: Date, opts?: { minIntervalHours?: number }): Promise<{ generated: string[] }>;
  };
  ```

- [ ] **Step 1: Write the failing test**

`server/src/__tests__/digest-service.test.ts` (embedded-postgres). **Register the inbox channel with the test db in `beforeAll`** so `getChannels()` persists:

```ts
import { registerChannel } from "../services/notification-delivery.js";
import { createInboxDigestChannel } from "../services/notification-delivery.js";
// in beforeAll, after db is created:
registerChannel(createInboxDigestChannel(db));
```

Seed two active companies (A, B) and one inactive company (C). Seed an open approval + risk for A. Then:

```ts
const svc = digestService(db);

// generate for A → persists a digest with the approval reflected
const d = await svc.generateForCompany(companyA);
expect(d).not.toBeNull();
expect((d!.payload as any).headline).toContain("approval");
expect(await svc.latest(companyA)).not.toBeNull();

// sweep: A already has a recent digest → skipped; B has none → generated; C inactive → never
const res = await svc.sweep(new Date());
expect(res.generated).toContain(companyB);
expect(res.generated).not.toContain(companyA);
expect(res.generated).not.toContain(companyC);

// forcing a 0h interval regenerates A
const res2 = await svc.sweep(new Date(), { minIntervalHours: 0 });
expect(res2.generated).toContain(companyA);

// period continuity: A's second digest periodStart == first periodEnd
const list = await svc.list(companyA, 10);
const [newest, older] = list; // most-recent first
expect(newest!.periodStart!.getTime()).toBe(older!.periodEnd!.getTime());
```

Create an inactive company by inserting with `status: "archived"` (any non-`"active"` value).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/digest-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `digest.ts`**

```ts
import { and, desc, eq } from "drizzle-orm";
import type { Db, DigestRow } from "@paperclipai/db";
import { companies, digests } from "@paperclipai/db";
import { collectDigestSignals } from "./digest-signals.js";
import { narrateDigest } from "./digest-narration.js";
import { getChannels } from "./notification-delivery.js";
import { logger } from "../middleware/logger.js";

export const DIGEST_MIN_INTERVAL_HOURS = 24;

export function digestService(db: Db) {
  const latest = (companyId: string): Promise<DigestRow | null> =>
    db
      .select()
      .from(digests)
      .where(eq(digests.companyId, companyId))
      .orderBy(desc(digests.generatedAt))
      .limit(1)
      .then((r) => r[0] ?? null);

  async function generateForCompany(companyId: string): Promise<DigestRow | null> {
    const company = await db.select().from(companies).where(eq(companies.id, companyId)).then((r) => r[0] ?? null);
    if (!company) return null;

    const last = await latest(companyId);
    const since = last?.periodEnd ?? company.createdAt;
    const now = new Date();

    const signals = await collectDigestSignals(db, companyId, since).catch((err) => {
      logger.warn({ err, companyId }, "digest signal collection failed; using empty signals");
      return {
        openApprovals: { total: 0, byBand: { low: 0, medium: 0, high: 0, critical: 0 }, top: [] },
        autoApprovedSince: 0,
        staleRuns: { total: 0, top: [] },
      };
    });
    const payload = narrateDigest(signals);

    for (const channel of getChannels()) {
      try {
        await channel.deliver(
          { companyId },
          { kind: "digest", title: payload.headline, digest: { payload, periodStart: since, periodEnd: now } },
        );
      } catch (err) {
        logger.warn({ err, companyId, channel: channel.name }, "digest delivery channel failed");
      }
    }

    return latest(companyId);
  }

  return {
    latest,
    generateForCompany,
    list: (companyId: string, limit = 20): Promise<DigestRow[]> =>
      db
        .select()
        .from(digests)
        .where(eq(digests.companyId, companyId))
        .orderBy(desc(digests.generatedAt))
        .limit(limit),

    async sweep(now: Date, opts: { minIntervalHours?: number } = {}): Promise<{ generated: string[] }> {
      const minHours = opts.minIntervalHours ?? DIGEST_MIN_INTERVAL_HOURS;
      const active = await db.select({ id: companies.id }).from(companies).where(eq(companies.status, "active"));
      const generated: string[] = [];
      for (const c of active) {
        try {
          const last = await latest(c.id);
          if (last && now.getTime() - last.generatedAt.getTime() < minHours * 60 * 60 * 1000) continue;
          const d = await generateForCompany(c.id);
          if (d) generated.push(c.id);
        } catch (err) {
          logger.warn({ err, companyId: c.id }, "digest sweep failed for company");
        }
      }
      return { generated };
    },
  };
}
```

- [ ] **Step 4: Export from the services barrel**

In `server/src/services/index.ts` add:
```ts
export { digestService, DIGEST_MIN_INTERVAL_HOURS } from "./digest.js";
export { collectDigestSignals, type DigestSignals } from "./digest-signals.js";
export { narrateDigest, deterministicNarrator, type DigestPayload } from "./digest-narration.js";
export { createInboxDigestChannel } from "./notification-delivery.js";
```
(Keep the existing `registerChannel`/`getChannels`/`DeliveryChannel` export line as-is.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/digest-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/digest.ts server/src/services/index.ts server/src/__tests__/digest-service.test.ts
git commit -m "feat(combo-05): digest service (generate/latest/list/sweep)"
```

---

### Task 6: Read + generate routes + register the channel + mount

**Files:**
- Create: `server/src/routes/digests.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/__tests__/digest-routes.test.ts`

**Interfaces:**
- Consumes: `digestService` (Task 5), `createInboxDigestChannel`, `registerChannel`, `assertBoard`, `assertCompanyAccess`.
- Produces routes: `GET /companies/:companyId/digests`, `GET …/digests/latest`, `POST …/digests/generate`.

- [ ] **Step 1: Write the failing route test**

`server/src/__tests__/digest-routes.test.ts` (embedded-postgres, full app — mirror the app+auth assembly of `server/src/__tests__/auto-approve-policy-routes.test.ts`). In `beforeAll`, after `db` is created, register the channel: `registerChannel(createInboxDigestChannel(db))`. Build the app mounting `digestRoutes(db)`. Seed a company. Then:

```ts
// latest before any digest → 404
const empty = await request(boardApp).get(`/api/companies/${companyId}/digests/latest`);
expect(empty.status).toBe(404);

// generate as board → 200 + a digest
const gen = await request(boardApp).post(`/api/companies/${companyId}/digests/generate`);
expect(gen.status, JSON.stringify(gen.body)).toBe(200);
expect(gen.body.payload.headline).toBeTruthy();

// latest now returns it
const latest = await request(boardApp).get(`/api/companies/${companyId}/digests/latest`);
expect(latest.status).toBe(200);

// list returns at least one
const list = await request(boardApp).get(`/api/companies/${companyId}/digests`);
expect(Array.isArray(list.body)).toBe(true);
expect(list.body.length).toBeGreaterThanOrEqual(1);

// non-board generate → 403
const forbidden = await request(agentApp).post(`/api/companies/${companyId}/digests/generate`);
expect(forbidden.status).toBe(403);
```

Use the same `boardActor` / `agentActor` middleware pattern as the auto-approve route test (`type: "board"` with `source: "local_implicit"`, `isInstanceAdmin: true`; and a `type: "agent"` actor for the 403).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/digest-routes.test.ts`
Expected: FAIL (route not defined).

- [ ] **Step 3: Implement `routes/digests.ts`**

```ts
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { digestService } from "../services/index.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function digestRoutes(db: Db) {
  const router = Router();
  const svc = digestService(db);

  router.get("/companies/:companyId/digests", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(await svc.list(companyId, Number.isFinite(limit) ? limit : undefined));
  });

  router.get("/companies/:companyId/digests/latest", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const digest = await svc.latest(companyId);
    if (!digest) { res.status(404).json({ error: "No digest yet" }); return; }
    res.json(digest);
  });

  router.post("/companies/:companyId/digests/generate", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const digest = await svc.generateForCompany(companyId);
    if (!digest) { res.status(404).json({ error: "Company not found" }); return; }
    res.json(digest);
  });

  return router;
}
```

Route ordering: register `/companies/:companyId/digests/latest` (and `/generate`) — Express matches them fine alongside `/companies/:companyId/digests` because the path segments differ. Keep `latest` and `generate` as distinct static suffixes (no `:param` collision).

- [ ] **Step 4: Register the channel + mount the route in `app.ts`**

Add near the top with the other route imports:
```ts
import { digestRoutes } from "./routes/digests.js";
import { createInboxDigestChannel, registerChannel } from "./services/index.js";
```
Inside `createApp`, after `db` is available (near where other services are constructed, before/near the `api.use(...)` block), register the channel once:
```ts
registerChannel(createInboxDigestChannel(db));
```
Mount the route on the `api` router (mirror `api.use(autoApprovePolicyRoutes(db))`):
```ts
api.use(digestRoutes(db));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/digest-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/digests.ts server/src/app.ts server/src/__tests__/digest-routes.test.ts
git commit -m "feat(combo-05): digest read/generate routes + register inbox channel"
```

---

### Task 7: Run the digest sweep on the server tick

**Files:**
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `digestService` (Task 5). Sweep behavior itself is covered by Task 5's tests; this task is wiring + typecheck.

- [ ] **Step 1: Add the sweep to the existing `setInterval` tick**

In `server/src/index.ts`, locate the `setInterval(() => { … })` block that calls `heartbeat.tickTimers(...)` and `routines.tickScheduledTriggers(...)`. Inside that callback, after the `routines.tickScheduledTriggers` block, add:

```ts
      void digestService(db)
        .sweep(new Date())
        .then((result) => {
          if (result.generated.length > 0) {
            logger.info({ generated: result.generated.length }, "digest sweep generated digests");
          }
        })
        .catch((err) => {
          logger.error({ err }, "digest sweep failed");
        });
```

Import `digestService` at the top of `server/src/index.ts` from `./services/index.js` (add to the existing services import, alongside `heartbeatService`). `db` and `logger` are already in scope in this block.

- [ ] **Step 2: Typecheck the wiring**

Run: `pnpm --filter @paperclipai/server exec tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(combo-05): run digest sweep on the server tick"
```

---

### Task 8: UI — `/digest` page + panel + API client + nav

**Files:**
- Create: `ui/src/api/digests.ts`
- Create: `ui/src/pages/Digest.tsx`
- Modify: `ui/src/App.tsx` (route + nav)
- Test: `ui/src/pages/Digest.test.tsx`

**Interfaces:**
- Consumes: `digestsApi.latest`, `digestsApi.generate`.

- [ ] **Step 1: Add the API client**

`ui/src/api/digests.ts`:
```ts
import { api } from "./client";

export type DigestSection = { key: string; title: string; lines: string[] };
export type DigestPayload = { headline: string; sections: DigestSection[]; text: string };
export type Digest = {
  id: string;
  companyId: string;
  periodStart: string | null;
  periodEnd: string | null;
  payload: DigestPayload;
  generatedAt: string;
};

export const digestsApi = {
  latest: (companyId: string) => api.get<Digest>(`/companies/${companyId}/digests/latest`),
  list: (companyId: string) => api.get<Digest[]>(`/companies/${companyId}/digests`),
  generate: (companyId: string) => api.post<Digest>(`/companies/${companyId}/digests/generate`, {}),
};
```
Confirm `api.get`/`api.post` signatures against `ui/src/api/client` (mirror `ui/src/api/runChangesets.ts` and `ui/src/api/approvals.ts`); adjust if `post` takes no second arg.

- [ ] **Step 2: Write the failing test**

`ui/src/pages/Digest.test.tsx` — follow the repo UI-test convention (mirror `ui/src/pages/ApprovalDetail.autoApprove.test.tsx`: `// @vitest-environment jsdom` header, `IS_REACT_ACT_ENVIRONMENT = true`, render via `react-dom/client` `createRoot` inside `act`, assert on the DOM). Mock `../api/digests`, `../context/CompanyContext` (`selectedCompanyId: "company-1"`), and `@/lib/router`. Assert:
- With `latest` resolving a digest whose payload has `headline: "3 approvals need you"` and one section titled "Approvals waiting", `container.textContent` contains both.
- Clicking the "Generate now" button (find it in the DOM and dispatch a click within `act`) calls `digestsApi.generate`.

Mirror the mock/render structure from `ApprovalDetail.autoApprove.test.tsx`; for the click, query the button via `container.querySelector("button")` and call `.click()` inside `act`.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run ui/src/pages/Digest.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement `Digest.tsx`**

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { digestsApi } from "../api/digests";
import { useCompany } from "../context/CompanyContext";

export function Digest() {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? "";
  const qc = useQueryClient();
  const { data: digest } = useQuery({
    queryKey: ["digest-latest", companyId],
    queryFn: () => digestsApi.latest(companyId),
    enabled: !!companyId,
    retry: false,
  });

  const generate = useMutation({
    mutationFn: () => digestsApi.generate(companyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["digest-latest", companyId] }),
  });

  return (
    <div className="digest-page space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Digest</h1>
        <button onClick={() => generate.mutate()} disabled={!companyId || generate.isPending}>
          {generate.isPending ? "Generating…" : "Generate now"}
        </button>
      </div>
      {digest ? (
        <div className="digest">
          <h2 className="text-lg font-medium">{digest.payload.headline}</h2>
          <p className="text-xs text-muted-foreground">
            generated {new Date(digest.generatedAt).toLocaleString()}
          </p>
          {digest.payload.sections.map((section) => (
            <section key={section.key} className="mt-3">
              <h3 className="font-medium">{section.title}</h3>
              <ul className="list-disc pl-5">
                {section.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">No digest yet.</p>
      )}
    </div>
  );
}
```

Use the existing button styling convention from a sibling page (e.g. how `ApprovalTriage.tsx` styles its action buttons) if there is a shared `Button` component; a plain `<button>` is sufficient for the test.

- [ ] **Step 5: Wire the route + nav in `App.tsx`**

In `ui/src/App.tsx`, register `Digest` at a company-scoped path (mirror how `ApprovalTriage`/`Approvals` are routed) and add a nav/sidebar link labeled "Digest" next to the Approvals/Triage entries. Follow the exact route + nav-link registration pattern already used for those pages.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run ui/src/pages/Digest.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/api/digests.ts ui/src/pages/Digest.tsx ui/src/App.tsx ui/src/pages/Digest.test.tsx
git commit -m "feat(combo-05): /digest page + panel + api client"
```

---

### Task 9: Full-suite + typecheck gate

**Files:** none (verification only).

- [ ] **Step 1: Run the Phase-2b suites together**

Run:
```bash
pnpm exec vitest run \
  packages/db/src/__tests__/schema-digests.test.ts \
  server/src/__tests__/digest-signals.test.ts \
  server/src/services/digest-narration.test.ts \
  server/src/__tests__/inbox-digest-channel.test.ts \
  server/src/__tests__/digest-service.test.ts \
  server/src/__tests__/digest-routes.test.ts \
  ui/src/pages/Digest.test.tsx
```
Expected: all PASS.

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm --filter @paperclipai/db typecheck && \
pnpm --filter @paperclipai/shared exec tsc --noEmit && \
pnpm --filter @paperclipai/server exec tsc --noEmit && \
pnpm --filter @paperclipai/ui exec tsc --noEmit
```
Expected: no type errors.

- [ ] **Step 3: Regression-check delivery-pipeline consumers**

Run: `pnpm exec vitest run server/src/__tests__/ -t "approval"`
Expected: existing approval tests still PASS (removing the no-op inbox channel touched shared delivery code; confirm nothing depended on it).

- [ ] **Step 4: Full suite**

Run: `pnpm test`
Expected: full suite PASS. (Two pre-existing date-flaky `ui/src/components/artifacts/ArtifactCard.test.tsx` failures are unrelated to this work — see the Phase-2a notes.)

- [ ] **Step 5: Commit (if any snapshot/lockfile churn)**

```bash
git add -A
git commit -m "test(combo-05): Phase 2b full-suite + typecheck green" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- `digests` table (payload jsonb, `0113`) → Task 1. ✔
- Signal collection (open approvals risk-sorted, auto-approved-since, stale runs >6h) → Task 2. ✔
- Deterministic pluggable narration (headline/sections/text; empty → calm; deterministic) → Task 3. ✔
- Inbox channel upgraded to db-bound persisting digests; `NotificationPayload.digest`; no-op removed → Task 4. ✔
- Digest service generate/latest/list/sweep (24h gate, active-only, period continuity, failure isolation) → Task 5. ✔
- Board-only read + generate routes; 404 before first digest; 403 non-board → Task 6. ✔
- Sweep on the existing tick → Task 7. ✔
- `/digest` page + panel + API client + nav → Task 8. ✔
- Best-effort error handling (signal degrade, channel isolate, sweep `.catch`) → Tasks 2/5 (empty-signal fallback), 5 (channel + per-company try/catch), 7 (tick `.catch`). ✔
- Full-suite + typecheck + delivery-consumer regression → Task 9. ✔
- Out of scope (LLM narration, budgets, per-company cadence, push/email, dismissal) → not implemented. ✔

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Bounded implementer-judgement points, each with a resolution command: the `listTriage` item field names (Task 2 `it.risk.*` — confirm against `approval-triage.ts`), `heartbeatRuns.agentId` nullability (Task 2), `api.get/post` signatures (Task 8 — mirror existing api clients), and the `App.tsx` route/nav pattern (Task 8 — mirror Approvals/Triage).

**Type consistency:** `DigestSignals` defined Task 2, consumed by narrator (Task 3) and service fallback (Task 5). `DigestPayload`/`DigestNarrator` defined Task 3, consumed by the channel payload (Task 4) and service (Task 5) and UI type (Task 8). `DigestRow` (Task 1) is the service return + route response + UI `Digest` shape (dates serialize to strings over HTTP — Task 8 types them as `string`). `createInboxDigestChannel(db)` produced Task 4, registered Task 6, used via `getChannels()` in Task 5. `digestService` methods (`generateForCompany`/`latest`/`list`/`sweep`) consistent across Tasks 5/6/7. `DIGEST_MIN_INTERVAL_HOURS = 24` and `STALE_RUN_HOURS = 6` are the only cadence/threshold constants.

**Delivery-pipeline note (resolved):** Task 4 removes the Phase-1 module-load no-op inbox channel; Task 6 registers the db-bound replacement at app startup; service/route tests register it explicitly in setup (global registry, process-isolated test files). Task 9 Step 3 regression-checks that no existing consumer depended on the removed no-op (none found during design — `getChannels`/`.deliver` had zero consumers).
