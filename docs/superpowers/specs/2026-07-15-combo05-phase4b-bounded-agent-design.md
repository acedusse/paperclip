# Combo-05 Phase 4b — Bounded manager-agent approver (`bounded_agent`)

**Date:** 2026-07-15
**Branch:** `feat/combo05-phase4b-bounded-agent` (stacked on `feat/combo05-phase4a-delegation-coverage`; PR #29 → #28, rebase to master once #28 lands)
**Phasing doc:** `.ideas/combinations/combo-05-phasing-corrected.md` (Phase 4, "bounded manager-agent approver last")

## Summary

Register the `bounded_agent` decision method into the authority resolver and build the tightly-scoped,
double-logged, **never-above-band** manager-agent approver. A human explicitly authorizes a specific
manager-agent as a bounded approver via a grant; that explicit grant **is** the trust decision —
mirroring Phase 2a (allowlist = trust) and Phase 4a (delegation grant = authority). The manager-agent
then decides approvals it did not itself request, within scope/band/spend/time, riding the same
`actingUnderGrantId` route seam that 4a introduced. Teeth are latent by the same mechanism as 2a/4a:
`bounded_agent` never reaches above the auto-decision band, so no real agent trust model is required.

## Motivation & the trust-model reconciliation

Phase 4b was deliberately sequenced last as the most sensitive tier and was tracked as "blocked on a
real agent trust model for above-band reach." That block applies **only to above-band reach**:

- `bounded_agent` is already a member of the resolver's `NON_HUMAN` set in
  `server/src/services/approval-authority.ts`. The Phase-1 hard rule therefore already **structurally
  forbids** it from deciding anything above `autoDecisionMaxBand` ("low"), and a test already asserts
  this even though the method is not yet enabled.
- The phasing doc specifies the bounded manager-agent is "never above-band" by design.

Above-band reach is thus explicitly **out of scope** for 4b. What remains is entirely buildable now in
the established latent-teeth pattern: a human grants a named manager-agent bounded approver authority,
and the agent can only ever auto-decide the low-risk tail it did not author.

## Authority model

- Precedence is unchanged:
  `explicit_human > delegated_human > coverage_escalation > bounded_agent > auto_policy`.
- `bounded_agent` is flipped from declared-but-inert to **enabled** by adding it to the `REGISTERED`
  set in `approval-authority.ts`. It remains in `NON_HUMAN`, so the existing above-band hard-rule test
  continues to pass.
- Authorization is explicit and human-granted, per company. No blanket or inferred agent authority.

## Data model

New additive migration `0121_combo05_bounded_agent_approvers` — hand-written raw SQL plus a matching
`meta/_journal.json` entry (idx = 121), mirroring the previous migration's idempotent `DO $$ ...
EXCEPTION WHEN duplicate_object` style. **Do not run `drizzle-kit generate`** (snapshot baseline is
stale at 0098). Additive only; no changes to existing tables.

Table `bounded_agent_approvers`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid fk | company-scoped |
| `grantor_user_id` | text | the human who authorized (the "on behalf of") |
| `delegate_agent_id` | text | the manager-agent granted approver authority |
| `approval_types` | text[] | scope; empty array = all types |
| `max_band` | text | must be ≤ auto-decision max ("low"); validated on create |
| `max_spend_cents` | integer null | nullable spend cap |
| `valid_from` | timestamptz | time-box start |
| `valid_until` | timestamptz | time-box end |
| `revoked_at` | timestamptz null | instant revoke |
| `created_by_user_id` | text null | audit |
| `updated_by_user_id` | text null | audit |
| `created_at` / `updated_at` | timestamptz | audit |

Drizzle schema file `packages/db/src/schema/bounded_agent_approvers.ts`, exported from the schema barrel
`packages/db/src/schema/index.ts` via a named `export { … } from "./bounded_agent_approvers.js"` before
the `// [END: module]` marker.

Service `boundedAgentApproverService(db: Db)` (factory function, mirroring `delegationService`) with:
`listActive(companyId)`, `create(companyId, input)`, `revoke(companyId, id)`, `getGrant(id)`.

## Pure gate

New pure function `canDecideAsBoundedAgent(...)` in `approval-authority.ts`, parallel to
`canDecideUnderDelegation`. Inputs: `approvalType`, `band`, `impliedSpendCents`, `deciderAgentId`,
`requestedByAgentId`, `grant` (approvalTypes, maxBand, maxSpendCents, validFrom, validUntil, revokedAt,
delegateAgentId), `now`. Denies (each with a distinct reason string) when:

1. `deciderAgentId !== grant.delegateAgentId` — actor is not this grant's delegate agent.
2. `grant.revokedAt !== null` — grant revoked.
3. `now < validFrom` — not yet active.
4. `now > validUntil` — expired.
5. `approvalTypes` non-empty and does not include `approvalType` — out of scope.
6. `bandRank(band) > bandRank(grant.maxBand)` — above the grant's band.
7. `maxSpendCents !== null && impliedSpendCents > maxSpendCents` — over spend cap.
8. **`deciderAgentId === requestedByAgentId`** — self-approval. A manager-agent may not approve its own
   work. This is the defining 4b guardrail (the "tightest limits, double-logged" tooth).

Otherwise `{ allow: true }`.

Note the above-band hard rule is *also* enforced independently by `canDecide` (via `NON_HUMAN`), so
even a mis-scoped grant with `max_band` above "low" cannot bypass it — the create route additionally
rejects such grants at authorization time.

## Decision flow

The approve / reject / request-revision routes in `server/src/routes/approvals.ts` already skip the
in-handler `assertBoard(req)` when `actingUnderGrantId` is present (the seam 4a built), and the router
is mounted under `actorMiddleware`, which admits agent actors (agent key / JWT). No new endpoint and no
new board-guard exception is required.

`resolveDecisionMethod` is extended so that when the supplied `actingUnderGrantId` resolves to a
**bounded-agent** grant (look up delegation grant first, then bounded-agent grant; unknown id → 404):

1. Run `canDecideAsBoundedAgent({ approvalType, band, impliedSpendCents, deciderAgentId:
   req.actor.agentId, requestedByAgentId: approval.requestedByAgentId, grant, now })`.
2. Deny → throw `{ status: 422, error: gate.deny }` (translated to a 422 response).
3. Allow → return
   `{ method: "bounded_agent", details: { grantId, onBehalfOf: grantorUserId, deciderAgentId } }`.

`resolveDecisionMethod`'s return type widens to include `"bounded_agent"`.

### Actor attribution (the double-log)

The approve/reject/request-revision handlers currently hardcode `actorType: "user"`, `actorId:
req.actor.userId ?? "board"`. Attribution is made method-aware: when the resolved method is
`bounded_agent`, both `recordDecision` and `applyApprovalApprovedEffects` (and the reject/revision
equivalents) receive `{ actorType: "agent", actorId: req.actor.agentId }`; all other methods are
unchanged. The audit row therefore names all three parties — the deciding agent (`actorId`), the grant
(`details.grantId`), and the authorizing human (`details.onBehalfOf`) — satisfying the "double-logged"
requirement. `decidedByUserId` passed into `svc.approve/reject/requestRevision` becomes the deciding
agentId for bounded-agent decisions so the approval's own `decidedBy` field stays coherent with the
audit (confirm the service signature tolerates an agent id during planning).

## Management surface

Mirrors Phase 4a's `/delegations`:

- **Board-only CRUD routes** (only a human authorizes an agent, so `assertBoard`):
  `GET /companies/:companyId/bounded-agent-approvers`,
  `POST /companies/:companyId/bounded-agent-approvers`,
  `POST /companies/:companyId/bounded-agent-approvers/:id/revoke`.
  `create` validates `max_band ≤ auto-decision max ("low")` server-side and rejects otherwise.
- **Shared validators** in `packages/shared/src/validators/*.ts`, exported from **both**
  `validators/index.ts` **and** the top-level `packages/shared/src/index.ts` barrel (the two-export
  requirement — a validator missing from the top-level barrel resolves to `undefined` at runtime and
  500s a `validate(undefined)` middleware).
- **Management page** listing active grants with a create form (agent picker, approval types, band
  capped at "low", spend cap, time-box) and a revoke button; company-scoped route under `boardRoutes()`
  and a sidebar entry in `ui/src/components/Sidebar.tsx`. UI test uses the jsdom + `createRoot` + `act`
  pattern (no `@testing-library/react`), mirroring `ui/src/pages/ApprovalDetail.autoApprove.test.tsx`.

## Testing

TDD, one commit per task, per-task and final whole-branch review.

- **Pure gate unit tests** (`approval-authority.test.ts`): self-approval denied; above-band denied;
  out-of-scope type denied; expired / not-yet-active / revoked / over-spend denied; wrong-agent denied;
  happy path allowed.
- **Resolver test**: `bounded_agent` now `REGISTERED` but still cannot exceed band (extends the
  existing hard-rule assertion).
- **Route integration tests** (embedded-postgres harness; register the notification channel per-file in
  `beforeAll`; `isolate: true, pool: "forks", maxWorkers: 1`): agent with a valid grant approves a
  low-band item it did not request → `bounded_agent` audit row naming agent + grant + onBehalfOf; agent
  approving its **own** requested approval → 422; agent without a grant → still board-gated (403); a
  grant pointed at an above-band item → 422; reject and request-revision parity.
- **UI page test**: renders the grant list and create form; asserts DOM.
- **web-push** stays mocked in every server test (unchanged; 4b does not touch push).

## Migration & branch mechanics

- Branch `feat/combo05-phase4b-bounded-agent` off `feat/combo05-phase4a-delegation-coverage` (stacked).
  PR #29 → #28. Rebase onto master once #28 lands; the migration number may need bumping if master has
  advanced past 0120 by then.
- Verify migrations with `pnpm --filter @paperclipai/db check:migrations`, plus typecheck and the
  embedded-postgres test suite.
- The known-flaky `ui/src/components/artifacts/ArtifactCard.test.tsx` date failures are unrelated —
  confirm the artifact files are unchanged vs base and move on.

## Explicitly out of scope (deferred)

- **Any above-band bounded-agent reach** — waits for a real agent trust model (idea 009). The hard rule
  keeps this impossible until then.
- **A dedicated agent-only decision endpoint** — unnecessary; the `actingUnderGrantId` grant seam plus
  `actorMiddleware` already admit an agent-authenticated decision.
- **A bounded-agent-initiated bulk triage path** — single-item decisions only for 4b.

## Exit criteria

A manager-agent holding a valid, in-scope, in-band, in-budget grant can approve/reject a low-band
approval it did not itself request; the decision writes one audit record naming the deciding agent, the
grant, and the authorizing human; the agent cannot approve its own work (422); no bounded-agent
decision can ever land above the auto-decision band; and a revoked or expired grant denies instantly.
