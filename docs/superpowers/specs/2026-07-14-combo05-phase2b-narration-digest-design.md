# Combo-05 Phase 2b — Narration Engine + Scheduled Digest (Design)

> Companion to [`combo-05-phasing-corrected.md`](../../../.ideas/combinations/combo-05-phasing-corrected.md),
> [Phase 1](2026-07-13-combo05-phase1-review-cockpit-design.md), and
> [Phase 2a](2026-07-13-combo05-phase2a-auto-approve-design.md).

## Context

Phase 2 in the phasing doc bundles two independent subsystems: the auto-approve policy writer
(**Cycle 2a**, shipped — PR #23) and the **narration engine + scheduled digest** (**Cycle 2b**, this
spec). 2b is the first real consumer of the Phase-1 **delivery pipeline** (`registerChannel` /
`getChannels` in `notification-delivery.ts`), which shipped as a pure stub — nobody calls `.deliver()`
yet. The narration engine built here is reused by the Phase-4 stakeholder page.

**Goal:** on a schedule, assemble "what needs the human" for each active company into a narrated,
persisted digest, delivered through the Phase-1 inbox channel and rendered on a `/digest` page —
proving the delivery pipeline end-to-end with a low-cost, deterministic first exercise.

## Substrate findings (from exploration)

- The **delivery pipeline has zero consumers**; the Phase-1 `inbox` channel is a no-op registered at
  module load in `notification-delivery.ts`.
- There is **no `notifications` table**; "inbox" today = the issue inbox + sidebar badges.
- `server/src/index.ts` already runs a global `setInterval` tick that calls `tickTimers` and
  `tickScheduledTriggers` — a lightweight home for a digest sweep, distinct from the heavier
  agent-dispatching **routines** system (routines create execution issues; wrong shape for a
  server-side digest job).
- `heartbeat_runs` has `status` + `updatedAt`; live statuses are `queued | running | scheduled_retry`.

## Locked decisions (from brainstorming)

1. **Narration engine = deterministic + pluggable.** A pure function `narrateDigest(signals, narrator)`
   behind a `DigestNarrator` strategy interface. Only the deterministic narrator is registered this
   cycle; an LLM narrator can register later. No LLM, no cost, fully testable. (Keeps Phase-1's
   "no AI summary" line.)
2. **Delivery target = new `digests` table + read API + `/digest` page.** The inbox channel is
   **upgraded** from a no-op to a db-bound channel whose `deliver()` inserts a `digests` row. The
   digest is exercised *through* the delivery pipeline (its stated purpose), then read from the table.
3. **Scheduling = piggyback the existing `index.ts` tick + per-company 24h gate + manual endpoint.**
   No new interval, no routines. A board-only `POST …/digests/generate` makes the flow testable and
   on-demand.
4. **Signals (MVP) = open approvals (risk-sorted) + auto-approved-since-last-digest + stale/blocked
   runs.** Budgets are **out** this cycle.
5. **Sweep scope = active companies only** (`status = 'active'`).
6. **Digest UI = its own company-scoped `/digest` nav page** (deep-link target for Phase-3 push).

## Governing principle

Digest generation is **best-effort and never throws into the tick loop**. A signal collector that
throws degrades that signal to empty; a delivery channel that throws is logged and skipped; the
per-company loop isolates failures. An empty state is legitimate and still produces a calm "nothing
needs you right now" digest, so "the digest runs" is always observable.

---

## Section 1 — Data model

New table `digests` (migration `0113`):

```
digests
  id            uuid pk default gen_random_uuid()
  company_id    uuid not null → companies(id) on delete cascade
  period_start  timestamptz                 -- previous digest's period_end (or company.created_at for the first)
  period_end    timestamptz                 -- generated_at of this digest (the "since" boundary for the next)
  payload       jsonb not null              -- the full narration payload (headline, sections[], text, signals)
  generated_at  timestamptz not null default now()
```

Index on `(company_id, generated_at desc)` — powers "latest digest" and list. No changes to existing
tables. The whole narration payload is stored as `jsonb` so the read path renders straight from the
row with no recomputation, and the record shows exactly what the operator was told at the time.

Migration is hand-written raw SQL + a `meta/_journal.json` entry (drizzle snapshot baseline is stale —
see Phase 1). Next free number is **`0113`** (`0112` is the last).

---

## Section 2 — Signals + narration engine (both pure/testable)

Collection (DB) and narration (pure) stay separate units.

### Signal collection — `server/src/services/digest-signals.ts`

```ts
type DigestSignals = {
  openApprovals: {
    total: number;
    byBand: Record<RiskBand, number>;
    top: { id: string; type: string; band: RiskBand; score: number }[];   // top 3 by score
  };
  autoApprovedSince: number;   // approval.decision rows with details.method='auto_policy' since `since`
  staleRuns: {
    total: number;
    top: { runId: string; agentId: string | null; status: string; staleForMinutes: number }[]; // top 3
  };
};

collectDigestSignals(db, companyId: string, since: Date): Promise<DigestSignals>
```

- **Open approvals**: reuse the Phase-1 triage service (`approvalTriageService(db).listTriage(companyId)`)
  — already risk-sorted and grouped; derive `total`, `byBand`, and `top` from its `items`.
- **Auto-approved**: `count(activity_log where action='approval.decision' and details->>'method'='auto_policy'
  and created_at >= since and company_id = companyId)`.
- **Stale runs**: `heartbeat_runs where company_id = companyId and status in ('queued','running','scheduled_retry')
  and updated_at < now - STALE_RUN_HOURS(6h)`; `staleForMinutes` from `updatedAt`.

### Narration engine — `server/src/services/digest-narration.ts` (pure)

```ts
type DigestSection = { key: string; title: string; lines: string[] };
type DigestPayload = { headline: string; sections: DigestSection[]; text: string; signals: DigestSignals };
type DigestNarrator = (signals: DigestSignals) => DigestPayload;

export const deterministicNarrator: DigestNarrator;                 // only narrator registered this cycle
export function narrateDigest(signals: DigestSignals, narrator?: DigestNarrator): DigestPayload;
```

The deterministic narrator:
- **headline**: leads with the human ask — e.g. `"3 approvals need you"`; when everything is clear,
  `"Nothing needs you right now"`.
- **sections**: one per **non-empty** signal (`approvals`, `auto-handled`, `stale-runs`), each with
  templated `lines` (e.g. `"1 critical, 1 high, 2 low"`, `"top: hire_agent — Big Spender (score 90)"`).
- **text**: a flat plain-text rendering (headline + section lines) for plain-text / Phase-3 push reuse.
- Empty signals omit their section; all-empty → the calm headline with an empty `sections` array.

`narrateDigest` defaults `narrator = deterministicNarrator`.

---

## Section 3 — Delivery pipeline, digest service, scheduling

### Upgraded inbox channel — `server/src/services/notification-delivery.ts`

Replace the Phase-1 module-load no-op `registerChannel({name:"inbox", …})` with a **db-bound factory**:

```ts
export function createInboxDigestChannel(db: Db): DeliveryChannel;
// deliver(target, payload): inserts a `digests` row using target.companyId, payload.digest
//   (payload carries { digest: DigestPayload, periodStart, periodEnd })
```

The channel is registered **once at app startup** (`app.ts`) via `registerChannel(createInboxDigestChannel(db))`,
so the global registry now holds a real inbox channel. The `NotificationPayload` type gains an optional
`digest?: { payload: DigestPayload; periodStart: Date | null; periodEnd: Date }` field the channel reads.

### Digest service — `server/src/services/digest.ts`

```ts
digestService(db): {
  generateForCompany(companyId): Promise<Digest | null>;   // collect → narrate → deliver via channels → return persisted row
  latest(companyId): Promise<Digest | null>;
  list(companyId, limit): Promise<Digest[]>;
  sweep(now: Date, opts?: { minIntervalHours?: number }): Promise<{ generated: string[] }>;
}
```

- `generateForCompany`: `const last = await latest(companyId)`; `since = last?.periodEnd ?? company.createdAt`;
  `signals = collectDigestSignals(db, companyId, since)`; `payload = narrateDigest(signals)`; deliver
  `{ companyId }`, `{ kind:"digest", title: payload.headline, digest: { payload, periodStart: since, periodEnd: now } }`
  through `getChannels()` (inbox channel persists); re-read and return `latest(companyId)`. Each
  `channel.deliver` is wrapped so one channel's throw is logged and does not abort.
- `sweep`: for each **active** company, if `latest.generatedAt` is null or older than
  `minIntervalHours` (default `DIGEST_MIN_INTERVAL_HOURS = 24`), call `generateForCompany`. Per-company
  try/catch isolates failures. Returns the list of company ids generated.

### Scheduling — `server/src/index.ts`

Extend the existing `setInterval` tick (alongside `tickTimers` / `tickScheduledTriggers`):
```ts
digestService(db).sweep(new Date()).catch((err) => logger.error({ err }, "digest sweep failed"));
```
The frequent tick is safe because `sweep`'s 24h per-company gate no-ops until a company is due — at most
one digest/day/company.

---

## Section 4 — Read API + UI

### API — `server/src/routes/digests.ts` (board-only, mounted in `app.ts`)

- `GET  /companies/:companyId/digests` — list, most recent first, capped (optional `?limit=`).
- `GET  /companies/:companyId/digests/latest` — latest digest; **404** if none yet.
- `POST /companies/:companyId/digests/generate` — generate now (board); returns the new digest.

All guarded by `assertBoard` + `assertCompanyAccess`. No new shared validators (generate takes no body).

### UI — `ui/src/pages/Digest.tsx` + `DigestPanel`

- `digestsApi` (`ui/src/api/digests.ts`): `latest(companyId)`, `list(companyId)`, `generate(companyId)`.
- `DigestPanel` renders the latest digest: headline, each section (title + lines), and a relative
  "generated Xh ago". A **"Generate now"** button calls `generate` and invalidates the query.
- Its own company-scoped **`/digest`** route + nav entry, mirroring how Approvals/Triage are routed
  (deep-link target for Phase-3 push).

---

## Section 5 — Error handling & testing

**Failure modes (best-effort, never throws into the tick loop):**
- A signal collector throws → that signal degrades to empty (`total: 0`); the digest still generates
  from the others; logged.
- A delivery channel throws → logged; generation continues; other channels still run.
- `sweep` per-company loop isolates failures (one company can't block others); the tick call site wraps
  `sweep` in `.catch`.
- No signals → a valid "nothing needs you" digest is still produced (empty is a legitimate, observable
  state).

**Tests (TDD):**
- **Pure narration** (`digest-narration.test.ts`): headline/section/line rendering per signal; empty
  signals omit sections; all-empty → calm headline; deterministic (same input → same output).
- **Signal collection** (embedded-postgres): seed approvals + risk, `auto_policy` audit rows before/after
  `since`, live + stale runs → assert `total`/`byBand`/`top`/`autoApprovedSince`/`staleRuns`.
- **Digest service** (embedded-postgres): `generateForCompany` persists via the inbox channel with correct
  `periodStart`(= prior `periodEnd`)/`periodEnd`; `latest`/`list`; `sweep` generates for a due company and
  skips one with a recent digest; per-company failure isolation.
- **Routes** (full app): board list/latest/generate; non-board → 403; latest before any digest → 404.
- **UI** (`DigestPanel.test.tsx`): renders headline + sections from a mocked `latest`; "Generate now"
  calls `generate` and refetches.

## File inventory

**New:**
- `packages/db/src/schema/digests.ts` + barrel export
- `packages/db/src/migrations/0113_combo05_digests.sql` (+ journal entry)
- `server/src/services/digest-signals.ts` (+ test)
- `server/src/services/digest-narration.ts` (+ test)
- `server/src/services/digest.ts` (+ test)
- `server/src/routes/digests.ts` (+ test)
- `ui/src/api/digests.ts`, `ui/src/pages/Digest.tsx` (+ `DigestPanel` test)

**Modified:**
- `server/src/services/notification-delivery.ts` — db-bound inbox channel factory; drop the no-op; extend `NotificationPayload`
- `server/src/services/index.ts` — export `digestService`, `createInboxDigestChannel`, narration/signals
- `server/src/app.ts` — register the inbox channel with db; mount `digests` routes
- `server/src/index.ts` — `digestService(db).sweep(...)` on the tick
- `ui/src/App.tsx` + nav — `/digest` route + link

**Untouched (no-op for existing consumers):** Phase-1/2a decision paths, risk model, auto-approve.

## Exit criteria

- A scheduled sweep (or `POST …/digests/generate`) produces a **persisted** digest for an active company
  that assembles open-approvals (risk-sorted) + auto-approved-since + stale-runs into a narrated payload,
  **delivered through the inbox channel**, and rendered on `/digest`.
- The 24h per-company gate prevents duplicate generation on the frequent tick.
- An empty state produces a calm "nothing needs you right now" digest.
- Board-only: non-board reads/generates get 403; `latest` before any digest → 404.
- Phase-1/2a behavior unchanged.

## Explicitly out of scope (deferred)

LLM-backed narration; budget/stale-run signals beyond the MVP set (budgets deferred); per-company
configurable cadence or cron; web push / email channels (Phase 3); delegation, coverage, stakeholder
page (Phase 4); digest dismissal/read-state.
