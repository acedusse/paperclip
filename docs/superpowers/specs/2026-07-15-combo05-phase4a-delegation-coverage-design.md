# Combo-05 Phase 4a — Human Delegation & SLA Coverage

**Date:** 2026-07-15
**Branch:** `feat/combo05-phase4a-delegation-coverage` (off `master` — the umbrella-branch model is retired now that Phases 1–3c have landed).
**Depends on:** Phase 1 (authority resolver `approval-authority.ts`, decision-audit `recordDecision`, risk model `approval-risk.ts`), Phase 2a (auto-approve resolver seam), Phase 2b (narration engine `digest-narration.ts`), Phase 3a (delivery pipeline `notification-delivery.ts` + `webpush` channel).

## Problem

Phase 4 of the phasing doc bundles three subsystems: (A) human delegation + SLA coverage, (B) a bounded manager-agent approver, (C) a stakeholder transparency page. This spec covers **only 4a** — human-to-human delegation and SLA coverage routing. 4b (bounded agent, most sensitive) and 4c (external stakeholder page) are separate spec → plan → build cycles, matching the phasing doc's directive to ship the human path first and the agent tier last.

Today the approval cockpit has two gaps 4a closes:

1. **No way to delegate decision authority.** Every decision is `explicit_human` under `assertBoard`; any board member can decide anything, and there is no mechanism to authorize *someone else* — bounded — to decide on your behalf while you are out or overloaded. The resolver (`approval-authority.ts`) already declares `delegated_human` and `coverage_escalation` as `DecisionMethod`s with a precedence order, but neither is `REGISTERED`; they are pre-wired seams awaiting this phase.
2. **Items rot silently.** A `pending` approval nobody actions just sits there. There is no SLA and no backstop that routes an aging item to a designated backup.

## Scope

**In:** a bounded delegation-grant model (scope/band/limit/time-box) enforced by the resolver; a delegated decision path usable by any authorized delegate (not only board members); an out-of-office switch implemented as a delegation preset; per-company SLA coverage config; an interval sweep that escalates past-SLA pending approvals to the designated backup via the existing delivery pipeline; `coverage_escalation` attribution when the backup decides an escalated item; and a focused management UI.

**Out (later phases/cycles):**
- **4b** — bounded manager-agent approver (`bounded_agent`). Deliberately last.
- **4c** — stakeholder transparency page + tokenized public link.
- **Per-person authority ceilings for board members.** 4a gives *delegates* bounded authority; it does not cap what a board member can do as themselves via `explicit_human`. That unlimited-board-member gap is the same class of known gap as the auto-approve trust-model stub (see Constraints).

## Decisions (locked during brainstorming)

- **Delegation = a bounded grant of authority**, not mere attribution. When a delegate decides *under a grant* (`method: delegated_human`), the resolver **enforces** the grant's limits. This is a **correct-but-latent enforcement seam**, mirroring how Phase 2a shipped auto-approve behind the resolver while the agent trust model stayed a stub — see the Teeth note below. Its 4a value is attribution + out-of-office ergonomics + a proven enforcement path; its full teeth arrive once a per-person decide-permission model exists.
- **Grant carries the full `scope / band / limit` from the exit criterion + a time-box:** optional approval-type filter (empty = all types), a `max_band` ceiling, a `max_spend_cents` limit (reusing the risk model's `impliedSpend`), and `valid_from` / `valid_until` (expiry auto-reverts).
- **A delegate may be any company member.** The delegated decision route authorizes on "actor **is** this grant's valid delegate" rather than `assertBoard` — the correct future-proof shape for the seam. Note it does not *expand* power today: every authenticated human is already a `board` actor who can decide anything in their company (there is no per-user decide-permission — see the Teeth note), so authorizing on the grant is, for now, an equivalent-or-tighter gate whose enforcement becomes load-bearing the day human authority is individualized.
- **Coverage = notify-only reroute.** An interval sweep finds past-SLA `pending` approvals and notifies the company's designated backup through the existing pipeline (narration → inbox + webpush). No ownership reassignment, no new authority — the backup is a board member who decides normally; deciding an escalated item records `coverage_escalation` for attribution.
- **SLA is per-band, configurable per company, with defaults** (critical 60m / high 240m / medium 1440m / low 4320m). Deadline = `approval.createdAt + slaMinutes(band)`.
- **Escalate once** per item (idempotent marker table); no repeat reminders in 4a.
- **Out-of-office = a delegation preset**, not a separate subsystem. ON creates a broad (`source: out_of_office`, all-types), time-boxed grant to a chosen backup with a picked band ceiling; OFF sets `revoked_at`. One enforcement path; "who decided under whose authority" falls out for free.
- **Focused management UI** in-phase (grants + coverage config + OOO), plus wiring `actingUnderGrantId` into the existing approvals decision UI.

## Architecture

Units bottom-up, each independently testable.

### A. Data model — migration `0120_combo05_delegation_coverage`

Hand-written raw SQL + `meta/_journal.json` entry (never `drizzle-kit generate`; snapshot baseline stale at 0098). Three additive tables; `approvals` is left untouched. Drizzle schema files under `packages/db/src/schema/`, each dual-exported from the schema barrel and the shared re-export barrel.

**`delegation_grants`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk `defaultRandom()` | |
| `company_id` | uuid notNull → `companies(id)` ON DELETE CASCADE | |
| `grantor_user_id` | text notNull | board user delegating authority |
| `delegate_user_id` | text notNull | any company member receiving it |
| `approval_types` | jsonb notNull default `'[]'` | empty = all types (**scope**) |
| `max_band` | text notNull | `low\|medium\|high\|critical` (**band**) |
| `max_spend_cents` | integer nullable | null = uncapped (**limit**) |
| `valid_from` | timestamptz notNull default `now()` | |
| `valid_until` | timestamptz notNull | expiry auto-reverts (no sweep needed — checked at decision time) |
| `revoked_at` | timestamptz nullable | early revoke (OOO-off / manual) |
| `source` | text notNull default `'manual'` | `manual \| out_of_office` |
| `created_at` | timestamptz notNull `defaultNow()` | |
| index | `(company_id, delegate_user_id)` | grant lookup by delegate |

An "active" grant = `revoked_at IS NULL AND now ∈ [valid_from, valid_until]`. Enforced in the pure resolver, not the DB.

**`company_coverage_config`** (one row per company)

| column | type | notes |
|---|---|---|
| `company_id` | uuid pk → `companies(id)` ON DELETE CASCADE | |
| `enabled` | boolean notNull default `false` | |
| `backup_user_id` | text nullable | designated backup (a board user) |
| `sla_critical_minutes` | integer notNull default `60` | |
| `sla_high_minutes` | integer notNull default `240` | |
| `sla_medium_minutes` | integer notNull default `1440` | |
| `sla_low_minutes` | integer notNull default `4320` | |
| `updated_at` | timestamptz notNull `defaultNow()` | |

The sweep no-ops for a company unless `enabled AND backup_user_id IS NOT NULL`.

**`approval_coverage_escalations`** (idempotent escalation marker)

| column | type | notes |
|---|---|---|
| `approval_id` | uuid pk → `approvals(id)` ON DELETE CASCADE | one escalation per item |
| `company_id` | uuid notNull | |
| `backup_user_id` | text notNull | who it was escalated to |
| `escalated_at` | timestamptz notNull `defaultNow()` | |

### B. Resolver — `approval-authority.ts`

- Add `delegated_human` and `coverage_escalation` to `REGISTERED`. (`delegated_human` and `coverage_escalation` are human methods, so the existing `NON_HUMAN` above-band hard rule does not apply to them — their bounds come from the grant, below.)
- New **pure** function:

```ts
export function canDecideUnderDelegation(input: {
  approvalType: string;
  band: RiskBand;
  impliedSpendCents: number;
  grant: {
    approvalTypes: string[];
    maxBand: RiskBand;
    maxSpendCents: number | null;
    validFrom: Date; validUntil: Date; revokedAt: Date | null;
    delegateUserId: string;
  };
  actorUserId: string;
  now: Date;
}): { allow: boolean; deny?: string }
```

Denies (in order, specific message each) when: actor ≠ `grant.delegateUserId`; grant revoked; `now` outside `[validFrom, validUntil]`; `approvalType` not in `approvalTypes` (when non-empty); `bandRank(band) > bandRank(maxBand)`; `maxSpendCents != null && impliedSpendCents > maxSpendCents`. Pure and unit-tested alongside the existing `canDecide` tests.

### C. Decision routes — `approvals.ts`

The three human decision routes (`/approve`, `/reject`, `/request-revision`) gain an optional `actingUnderGrantId` in their validated bodies (`resolveApprovalSchema`, `requestApprovalRevisionSchema`).

- **`actingUnderGrantId` present → delegated path.** Authorize on the grant (skip `assertBoard`): load the grant, require `req.actor.userId === grant.delegate_user_id`, load the approval's type + risk snapshot + implied spend, gate via `canDecideUnderDelegation` (422 on deny), then run the same `svc.approve/reject/requestRevision` + effects, and `recordDecision({ method: "delegated_human", actor:{actorType:"user", actorId: delegate}, details:{ grantId, onBehalfOf: grantorUserId }, ... })`. `requireApprovalAccess` (company-scoped) still applies.
- **`actingUnderGrantId` absent → existing path, unchanged**, except: after confirming the board decision, if an `approval_coverage_escalations` row exists for the approval **and** `req.actor.userId === coverageConfig.backup_user_id`, record `method: coverage_escalation` instead of `explicit_human`. Server-derived; the client cannot assert this method.

### D. SLA coverage sweep — new `coverage-sweep.ts`

A service modeled on the digest sweep (`digest.ts`), started from `app.ts` on a `setInterval` (env-gated interval + `unref()`, matching the existing digest/feedback-export timers; guarded for test env). Per tick, for each company with `enabled AND backup_user_id`:

1. Select `pending` approvals whose `createdAt + slaMinutes(band)` (band from the risk snapshot; default `low` when unscored) is `< now` and which have **no** `approval_coverage_escalations` row.
2. For each, insert the marker (unique pk makes this idempotent under concurrent ticks — `ON CONFLICT DO NOTHING`), then `deliverThroughChannels({ companyId, userId: backupUserId }, payload)`.
3. Payload reuses the 2b narrator to summarize the escalated set ("N approvals past SLA — you're the backup"), with `push` fields deep-linking to the triage inbox (`/approvals/triage`). Best-effort: a delivery throw is caught and logged, never aborts the sweep (same posture as `deliverThroughChannels`).

### E. Routes + shared contracts

New `server/src/routes/delegations.ts`, mounted in `app.ts`:
- `POST /companies/:companyId/delegations` — create a grant (`assertBoard`; grantor = actor). Validated by `createDelegationGrantSchema`.
- `GET /companies/:companyId/delegations` — list active + recent grants (board sees all; a member sees grants where they are grantor or delegate).
- `POST /delegations/:id/revoke` — set `revoked_at` (grantor or board).
- `GET /companies/:companyId/coverage-config` / `PUT …` — read/update coverage config (`assertBoard`), validated by `coverageConfigSchema`.
- `POST /companies/:companyId/out-of-office` `{ enabled, backupUserId, maxBand, until }` — creates (ON) or revokes (OFF) the `source: out_of_office` preset grant for the actor.

Shared validators/types (`delegationGrantSchema`, `coverageConfigSchema`, `DecisionMethod` already present) live in `packages/shared` and are dual-barrel-exported.

### F. UI

A focused delegations management surface (new route or a section — follow the `/digest` precedent):
- Create/list/revoke delegation grants (grantor picks delegate, types, band ceiling, spend cap, window).
- Coverage config: toggle enabled, pick backup, edit the four SLA thresholds.
- Out-of-office toggle (backup + band ceiling + return date) → the preset grant.
- In the existing approvals decision UI, when the current user holds an active grant covering an item, offer "decide as delegate" which sends `actingUnderGrantId`.

## Data flow

**Delegated decision:** delegate opens an approval → UI detects an active covering grant → POST `/approvals/:id/approve` with `actingUnderGrantId` → route loads grant + risk, `canDecideUnderDelegation` passes → decision applied → `recordDecision(delegated_human, {grantId, onBehalfOf})` → `GET /approvals/:id` now returns `decidedVia: "delegated_human"`.

**Coverage escalation:** sweep tick → past-SLA pending item with no marker → insert marker + `deliverThroughChannels` to backup (inbox + webpush) → backup opens triage, decides → route sees marker + actor==backup → `recordDecision(coverage_escalation)`.

**OOO:** toggle ON → preset grant created → delegate can now act within bounds and the sweep is unaffected (coverage is independent); toggle OFF → `revoked_at` set → delegated path 422s thereafter.

## Error handling

- Grant enforcement failures return **422** with the specific `deny` reason (parity with the existing `canDecide` 422s).
- Delegated route with an actor who is not the grant's delegate, or a revoked/expired grant → 422 (not 403) so the reason surfaces; a non-existent grant → 404.
- Sweep failures are per-item best-effort; a marker is only written when its notification is attempted, and the unique pk plus `ON CONFLICT DO NOTHING` makes concurrent ticks safe.
- Coverage config with `enabled: true` but no `backup_user_id` is rejected at the schema/route layer (mirrors 3c's half-set quiet-hours guard).

## Testing

Conventions: server route tests in `server/src/__tests__/*.test.ts` on **embedded-postgres**; pure-unit tests next to services; `web-push` is mocked (never send real push); jsdom for any UI component tests.

- **`approval-authority.test.ts`** — extend: `delegated_human`/`coverage_escalation` now registered; full `canDecideUnderDelegation` truth table (each deny branch + the allow case; band/spend boundaries; window edges; revoked; wrong actor).
- **`coverage-sweep.test.ts`** — past-SLA item escalates once; second tick does not re-escalate; per-band threshold honored; disabled/no-backup company no-ops; delivery throw does not abort the sweep.
- **delegated-decision route test** — non-board delegate approves within bounds (200, `decidedVia: delegated_human`, audit names the grant); above-band/over-spend/out-of-scope/expired/revoked → 422; wrong actor → 422; missing grant → 404.
- **coverage-attribution route test** — backup deciding an escalated item records `coverage_escalation`; a non-backup board member deciding the same item records `explicit_human`.
- **delegations routes test** — grant CRUD, coverage-config get/update guard, OOO toggle creates then revokes the preset grant.
- Full server suite + typecheck green; `pnpm --filter @paperclipai/db check:migrations` across `0115–0120`.

## Constraints / known gaps (carried, not fixed here)

- **Teeth are latent, by design (the 2a parallel).** Every authenticated human is a `board` actor, and the decision routes gate only on `assertBoard` + `assertCompanyAccess` (company scope) — there is **no per-user decide-permission**, so any company member can already decide anything in their company. A delegation grant therefore does not *expand* a delegate's power today; it *constrains* an already-empowered user and *attributes* the decision, and its `canDecideUnderDelegation` enforcement becomes load-bearing only once human authority is individualized. This is deliberately the same posture as Phase 2a, which built the auto-approve resolver seam correctly while the agent trust model (idea 009) remained a stub. A delegate can still bypass their own grant's bounds by deciding as `explicit_human` until that individualization lands. We build the seam now so it is proven and ready; we do not oversell its current reach.
- **No agent trust model** (idea 009) — unchanged; `bounded_agent` remains unregistered until 4b, and above-band non-human decisions stay hard-blocked by `canDecide`.
- Migrations are hand-written raw SQL + journal entry; latest becomes `0120_combo05_delegation_coverage`.

## Execution style

Brainstorm → this spec → plan (`writing-plans`) → TDD, one commit per task, per-task + final whole-branch review. Target `master` directly.
