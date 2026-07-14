# Combo-05 Phase 2a — Auto-Approve Policy Writer (Design)

> Companion to [`combo-05-phasing-corrected.md`](../../../.ideas/combinations/combo-05-phasing-corrected.md)
> and the Phase 1 design [`2026-07-13-combo05-phase1-review-cockpit-design.md`](2026-07-13-combo05-phase1-review-cockpit-design.md).

## Context

Phase 1 shipped and merged (PR #22): the risk model, changeset surface, authority resolver
(seeded with `explicit_human` only), decision audit, delivery-pipeline stub, and the triage inbox.
The resolver already reserves `auto_policy` as a **non-human** decision method and already enforces
the above-band hard rule against it — it is simply not yet *registered*, so every `auto_policy`
decision is currently denied.

The phasing doc's Phase 2 bundles two independent subsystems: the **auto-approve policy writer** and
the **narration engine + scheduled digest**. This spec covers **only the auto-approve policy writer
(Cycle 2a)**. The narration engine + digest is a separate spec→plan→implement cycle (2b).

**Goal:** let an operator explicitly opt specific agents' low-risk work into being cleared without a
human, safely, with every auto-decision routed through the same authority resolver and decision-audit
record that human decisions use — proving the resolver can host a non-human writer before any richer
auto/delegated method (Phases 2b–4) plugs in.

## Locked decisions (from brainstorming)

1. **Trust basis = explicit per-company allowlist.** No computed trust-stage model (idea 009 is not
   built). An agent auto-clears an item only if a human previously created an active policy row for
   that agent × approval-type. Trust becomes just another signal later, without reopening this design.
2. **Scope = auto-approve only.** Narration engine + digest deferred to Cycle 2b.
3. **Evaluation timing = on approval create, synchronous, after the risk snapshot is computed.** No
   background sweep. Items created before a policy existed, or before an agent was allowlisted, are
   **not** retroactively cleared — they wait for a human (correct-by-default: nothing clears without a
   prior explicit opt-in).
4. **Config surface = full backend + minimal UI legibility.** Schema, board-only CRUD API, resolver
   registration, on-create evaluation, and audit. UI is read-only: an "Auto-approved" badge on the
   triage item and approval detail. Policy editing is via API/seed this cycle; a full policy-editor UI
   is a deferred follow-up.
5. **`AUTO_DECISION_MAX_BAND` stays a locked constant** (`"low"`), not yet per-company configurable. A
   policy's `maxBand` may never exceed it (validated at create; also enforced by the resolver at
   decision time).

## Governing principle

Auto-approve is a **real approval decided by policy**, not a separate code path. It reuses the existing
`approvalService.approve(...)` resolve path (so all approve side-effects fire identically) and the
existing `recordDecision(...)` audit (Phase 1), tagged `method: "auto_policy"`, `actorType: "system"`.
Every failure mode is **fail-safe**: absence of confidence (no risk snapshot, any thrown error, any
band doubt) means the item stays pending for a human. Auto-approve can only ever *reduce* the human's
queue for items an operator explicitly pre-authorized; it can never decide something a human hasn't
opted in, and never anything above band.

---

## Section 1 — Data model

New table `auto_approve_policies`, mirroring `budget_policies` conventions (per-company policy table,
`is_active` toggle, created/updated-by, indexed).

```
auto_approve_policies
  id                  uuid pk default gen_random_uuid()
  company_id          uuid not null → companies(id) on delete cascade
  agent_id            uuid not null → agents(id) on delete cascade   -- required; no wildcard "any agent"
  approval_type       text not null                                  -- e.g. "work_product"
  max_band            text not null                                  -- must be ≤ AUTO_DECISION_MAX_BAND
  max_spend_cents     integer not null default 0
  require_no_secrets  boolean not null default true
  is_active           boolean not null default true
  created_by_user_id  text
  updated_by_user_id  text
  created_at          timestamptz not null default now()
  updated_at          timestamptz not null default now()
```

Indexes:
- `unique (company_id, agent_id, approval_type, is_active)` — one active rule per agent × type.
- `index (company_id, is_active)` — the `listActive` lookup on the create hot path.

**No changes** to `approvals` or `approval_risk`. The auto-decision is recorded through the existing
`approval.decision` activity record (Phase 1's `recordDecision`), with `method: "auto_policy"`,
`actorType: "system"`, `actorId: "auto_policy"`, and the firing policy id carried in `details`.

Migration: hand-written raw SQL registered in `meta/_journal.json` (the drizzle snapshot baseline is
stale — see Phase 1 design). Next free migration number is **`0112`** (`0111` is the last, journal idx
111) — file `0112_combo05_auto_approve_policies.sql` with journal idx 112.

---

## Section 2 — Policy matcher (pure) + service

Two units, mirroring the Phase-1 risk-model split (pure scorer + DB service).

### Pure matcher — `server/src/services/auto-approve-policy.ts`

Unit-testable with no DB.

```ts
type AutoApprovePolicy = {
  id: string; agentId: string; approvalType: string;
  maxBand: RiskBand; maxSpendCents: number; requireNoSecrets: boolean;
};
type AutoApproveContext = {
  approval: { type: string; requestedByAgentId: string | null; payload: Record<string, unknown> };
  risk: { band: RiskBand; reasons: string[] } | null;   // null => never auto-approve
  impliedSpendCents: number;
  hasSecretsOrSensitive: boolean;                        // reuse Phase-1 sensitive-boundary detection
};

evaluateAutoApprove(ctx: AutoApproveContext, policies: AutoApprovePolicy[]):
  { matched: AutoApprovePolicy | null; reasons: string[] }
```

A policy matches only when **all** hold:
- `ctx.risk` is present **and** `bandRank(ctx.risk.band) ≤ bandRank(policy.maxBand)` — absent risk → no match, always (fail-safe);
- `ctx.approval.type === policy.approvalType`;
- `ctx.approval.requestedByAgentId === policy.agentId`;
- `ctx.impliedSpendCents ≤ policy.maxSpendCents`;
- if `policy.requireNoSecrets`, then `ctx.hasSecretsOrSensitive === false`.

First matching policy wins, evaluated in deterministic order (caller passes policies ordered by
`created_at`). `reasons` explains the match (or the first blocking condition, for observability).

### DB-backed service — `autoApprovePolicyService(db)`

```ts
autoApprovePolicyService(db): {
  listActive(companyId): Promise<AutoApprovePolicy[]>;
  create(companyId, input): Promise<Policy>;
  update(companyId, id, patch): Promise<Policy>;
  deactivate(companyId, id): Promise<void>;
  evaluateForApproval(approvalId): Promise<{ matched: AutoApprovePolicy | null; reasons: string[] }>;
}
```

`evaluateForApproval` loads the approval, its `approval_risk` snapshot, and the company's active
policies; computes `impliedSpendCents` and `hasSecretsOrSensitive` **the same way `approval-risk.ts`
does**; then runs the pure matcher.

### Reuse (no duplication)

Export from `approval-risk.ts` and consume here: `RISK_BAND_ORDER` / `bandRank`, `SENSITIVE_TYPES`,
`SENSITIVE_PAYLOAD_KEYS`, and the sensitive-boundary detector. The spend derivation (`payload
.budgetMonthlyCents`, etc.) is factored out of `approval-risk.ts` into a small exported helper so both
the risk scorer and this matcher read spend identically.

---

## Section 3 — Resolver registration + evaluation on create

### Resolver change — `server/src/services/approval-authority.ts`

Add `"auto_policy"` to the `REGISTERED` set. `auto_policy` is already in `NON_HUMAN`, so the above-band
hard rule (`bandRank(band) > bandRank(autoDecisionMaxBand)` → deny) continues to guard it. The auto
path calls `canDecide` as a **backstop** on top of the matcher's own band check — so the hard rule
holds even if the matcher has a bug.

### Wiring — `server/src/routes/approvals.ts`, `POST /companies/:companyId/approvals`

After the existing awaited `approvalRiskService(db).computeAndPersist(approval.id)`:

```ts
// Phase 2a: attempt auto-approve. Best-effort — never blocks or fails the create.
const auto = await autoPolicySvc.evaluateForApproval(approval.id).catch(() => ({ matched: null }));
if (auto.matched) {
  const risk = await riskSvc.getSnapshot(approval.id);
  const gate = canDecide({
    band: auto.matched.maxBand, method: "auto_policy", autoDecisionMaxBand: AUTO_DECISION_MAX_BAND,
  });
  if (gate.allow) {
    try {
      await svc.approve(approval.id, "auto_policy", null);         // reuse existing resolve path
      await recordDecision(db, {
        approvalId: approval.id, companyId: approval.companyId,
        actor: { actorType: "system", actorId: "auto_policy" },
        method: "auto_policy", outcome: "approved",
        risk: risk ? { score: risk.score, band: risk.band as RiskBand } : null,
        note: `auto-approved by policy ${auto.matched.id}`,
      });
    } catch (err) {
      logger.warn({ err, approvalId: approval.id }, "auto-approve failed; leaving pending");
    }
  }
}
```

- Runs **after** risk compute, so the snapshot exists when a match occurs. If risk compute failed,
  `evaluateForApproval` returns `matched: null` and the item stays pending.
- The create response returns the approval object unchanged; when a policy fired, the client sees it
  already `approved`.
- Instantiate `autoPolicySvc = autoApprovePolicyService(db)` once near the existing
  `riskSvc = approvalRiskService(db)`.

`svc.approve(approval.id, "auto_policy", null)` uses the sentinel `"auto_policy"` as the acting user
id. Auto-approve is a genuine approval: all `approvalService.approve` side-effects fire identically to
a human approval — only the decider differs.

`AUTO_DECISION_MAX_BAND` is a locked constant (`"low"`), colocated with the Phase-1 risk-band
constants.

---

## Section 4 — CRUD API + UI legibility

### API — `server/src/routes/auto-approve-policies.ts` (new route file)

A dedicated route file keeps `approvals.ts` from growing further (it already carries triage + bulk).
All board-only (`assertBoard` + `assertCompanyAccess`):

- `GET   /companies/:companyId/auto-approve-policies` — list.
- `POST  /companies/:companyId/auto-approve-policies` — create, zod-validated.
- `PATCH /companies/:companyId/auto-approve-policies/:id` — toggle `isActive` / edit caps.

New shared validator `autoApprovePolicySchema` in `packages/shared/src/validators/`:
- `agentId` uuid, `approvalType` non-empty, `maxBand` ∈ risk bands **and** `≤ AUTO_DECISION_MAX_BAND`,
  `maxSpendCents ≥ 0`, `requireNoSecrets` boolean.
- Create additionally validates the agent belongs to the company (route-level).

### UI legibility (no editor this cycle)

Surface that an approval was auto-decided, so an auto-approved item does not look identical to a
human-approved one:

- Expose the deciding **method** as a `decidedVia` field on the single-approval read
  (`GET /approvals/:id`) — derived by reading the latest `approval.decision` activity record (already
  keyed by `entityId`), returning `details.method` (e.g. `"auto_policy"`) and the firing policy id.
- Render a small **"Auto-approved"** chip on `ApprovalDetail` when `decidedVia === "auto_policy"`, with
  the firing policy id in a tooltip.

Auto-approved items become `approved` on create and therefore **never appear in the open-only triage
queue** — so there is no triage-item badge and no change to the triage read path. `ApprovalDetail` is
the surface where a decision is inspected.

**Badge-only** — no allowlist-preview affordance this cycle (that belongs to the deferred editor UI).

---

## Section 5 — Error handling & testing

### Failure modes (all fail-safe: absence of confidence → human decides)

- Risk snapshot missing/failed → matcher returns `matched: null` → item stays pending.
- `evaluateForApproval` throws → `.catch` → treated as no match → create still succeeds, item pending.
- `svc.approve` throws mid-auto → create response still returns; no audit row is written (no phantom
  decision); item stays pending; warning logged.
- Policy `maxBand` exceeds the locked constant → rejected at create-validate; and even a stale/forced
  row is denied by `canDecide` at decision time.
- Above-band item + matching policy → matcher's band check fails first; `canDecide` denies as a
  backstop → pending.

### Tests (TDD, mirroring Phase 1 structure)

- **Pure** (`auto-approve-policy.test.ts`): full match; each condition independently blocks a match;
  null risk → never matches; above-band → never matches; deterministic first-match ordering.
- **Service** (embedded-postgres): seed company + agent + approval + risk snapshot + active policy →
  `evaluateForApproval` matches; deactivated policy → no match; wrong agent / wrong type → no match.
- **Route/integration** (full app): create an approval matching an active policy → response is
  `approved`, exactly one `approval.decision` audit row with `method: "auto_policy"`, and the existing
  `approval.approved` domain event still fires (Phase-1 no-regression). Create a `high`-band item with
  a forced above-band policy row → stays pending. CRUD: board can create/list/toggle; non-board → 403;
  `maxBand` above the constant → 422.
- **Resolver** (`approval-authority.test.ts` extension): `auto_policy` allowed at/below band; still
  denied above `AUTO_DECISION_MAX_BAND`; `explicit_human` unaffected.
- **UI**: `ApprovalDetail` renders the "Auto-approved" badge when `decidedVia === "auto_policy"`; a
  human-approved item does not.
- **Read path**: `GET /approvals/:id` returns `decidedVia: "auto_policy"` for an auto-approved item and
  `"explicit_human"` (or null) otherwise.

---

## File inventory

**New:**
- `packages/db/src/schema/auto_approve_policies.ts` + barrel export
- `packages/db/src/migrations/0112_combo05_auto_approve_policies.sql` (+ journal entry)
- `server/src/services/auto-approve-policy.ts` (pure matcher + service) + tests
- `server/src/routes/auto-approve-policies.ts` (board CRUD) + test
- `packages/shared/src/validators/` — `autoApprovePolicySchema` + test
- UI "Auto-approved" badge (`ApprovalDetail`) + test

**Modified:**
- `server/src/services/approval-authority.ts` — register `auto_policy`
- `server/src/services/approval-risk.ts` — export sensitive-boundary helper, `bandRank`, spend helper
- `server/src/routes/approvals.ts` — evaluate-on-create wiring; `AUTO_DECISION_MAX_BAND` constant; `decidedVia` on `GET /approvals/:id`
- `server/src/services/index.ts`, `server/src/app.ts` — export/mount new service + route
- `ui/src/api/approvals.ts` — `decidedVia` on the `Approval` type

**Untouched (no-op for existing consumers):** Phase-1 human decision path, risk scoring, changeset
surface.

## Exit criteria

- A low-risk `work_product` from an explicitly allowlisted agent, under the spend cap and touching no
  secrets, is auto-approved at create time and produces exactly one `approval.decision` audit row with
  `method: "auto_policy"`.
- No above-band item is ever auto-approved — asserted by test at both the matcher and resolver layers.
- An item with no matching active policy, or with a missing risk snapshot, stays pending for a human.
- Auto-approved items are visibly distinguished from human-approved items in the operator UI.
- Phase-1 human decision behavior is unchanged (existing approval tests still pass).

## Explicitly out of scope (deferred)

Narration engine + scheduled digest (Cycle 2b); background re-evaluation sweep; per-company
configurable `AUTO_DECISION_MAX_BAND`; wildcard "any agent" policies; a policy-editor UI; computed
agent trust-stage (idea 009); web push, delegation, coverage, stakeholder page (Phases 3–4).
