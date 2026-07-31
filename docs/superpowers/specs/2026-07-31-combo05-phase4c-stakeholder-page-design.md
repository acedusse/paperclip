# Combo-05 Phase 4c — Stakeholder transparency page (idea 033)

Status: design
Branch: `feat/combo05-phase4c-stakeholder-page` (off `master` @ `bc9ae2b`)
Source: `.ideas/033-stakeholder-transparency-page.md`, `.ideas/combinations/combo-05-phasing-corrected.md` (Phase 4)

## Summary

A tokenized, revocable, expiring, **read-only** page that an operator can hand to an
investor/partner/parent-org so they can see how a company is doing without being given board
access. Exposure is **default-deny and operator-curated**: a share renders only the sections its
owner explicitly switched on.

This is the last phase of Combo-05. Phases 1–4b are on `master`.

## Motivation

Today the choice is binary — full board access (mutations, costs, secrets, transcripts, agent
internals) or nothing. Stakeholders who only want "how's it going?" have no safe surface.

## The security boundary (the part that matters)

The whole feature is a privacy boundary, so the design is built around one rule:

> **No toggle, no query.** A section that is switched off is never fetched from the database, not
> merely hidden at render time.

That makes accidental leakage a two-step failure rather than a one-step one: a renderer bug alone
cannot expose a field whose data was never loaded. Concretely:

- `gatherStakeholderSignals(db, companyId, toggles)` issues a query **per enabled toggle only**.
- `projectStakeholderPayload(share, signals)` then omits any section whose toggle is false.
- Both layers are driven by the same `StakeholderToggles` record, so they cannot drift apart
  silently — a new toggle that is added to one and not the other fails the projection tests.

Everything defaults to `false` at the schema level. A freshly created share renders an empty
company card: name + "nothing shared yet".

### What is exposed, at most

| Section | Toggle | Fields |
|---|---|---|
| Goal progress | `showGoalProgress` | company/team-level goals only: `title`, `status`. Counts by status. |
| Shipped work | `showShippedWork` | issues with status `done`: `title`, `completedAt`. Capped, most-recent-first. |
| Narrative | `showNarrative` | one generated paragraph (see below) |
| Activity timeline | `showActivityTimeline` | date + short label, high level only |

### What is never exposed, regardless of toggles

Spend/costs, secrets, raw transcripts, agent names/ids/configs, approval internals, run internals,
stale-run counts, member identities, issue bodies, work-product contents. `agent`- and `task`-level
goals are excluded even when goal progress is on — they are internal decomposition.

## Narration

Phase 2b's narrator (`digest-narration.ts`) is **operator-facing** — it reports approvals waiting
and stuck runs. Piping that to an external stakeholder would leak exactly the operational internals
this feature exists to withhold.

So 4c reuses the *engine shape*, not the operator payload: a new pure
`narrateStakeholder(signals) → { headline, sections, text }` over stakeholder-safe signals,
mirroring `deterministicNarrator`'s pure-function contract (deterministic, no db, no clock beyond
an injected `now`). One narrator per audience; neither can drift into the other's data.

## Data model

One additive table, `stakeholder_shares` (migration `0122_combo05_stakeholder_shares`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null → `companies.id` | |
| `token` | text not null | unique; 32-byte base64url from `crypto.randomBytes` |
| `label` | text not null | operator's name for the link ("Acme investors") |
| `status` | text not null default `'active'` | `active` \| `revoked` |
| `show_goal_progress` | boolean not null default `false` | |
| `show_shipped_work` | boolean not null default `false` | |
| `show_narrative` | boolean not null default `false` | |
| `show_activity_timeline` | boolean not null default `false` | |
| `expires_at` | timestamptz null | null = no expiry |
| `created_by_user_id` | text null | |
| `revoked_at` | timestamptz null | |
| `rotated_at` | timestamptz null | |
| `created_at` / `updated_at` | timestamptz not null default now() | |

Indexes: unique on `token`; `(company_id, created_at)`.

Revocation is a status flip **plus** the token stops resolving on the next request — no cache, no
signed self-describing token, so "revokes instantly" holds by construction. Rotation issues a new
token and invalidates the old one in the same write.

## Pure gate

```ts
type ShareViewability =
  | { ok: true }
  | { ok: false; reason: "revoked" | "expired" };

function assertShareViewable(share, now): ShareViewability
```

Default-deny: anything not explicitly `active` and unexpired is denied. Expiry is `expires_at <= now`
(inclusive), so an expired-at-this-instant link is already dead.

## Routes

Board-only management (all `assertBoard` + `assertCompanyAccess`):

- `GET  /api/companies/:companyId/stakeholder-shares`
- `POST /api/companies/:companyId/stakeholder-shares`
- `PATCH /api/stakeholder-shares/:id`
- `POST /api/stakeholder-shares/:id/revoke`
- `POST /api/stakeholder-shares/:id/rotate`

List/create responses return the token **only on create and rotate** (the moments the operator needs
to copy it); list returns a `tokenTail` (last 6 chars) so the UI can identify a link without
re-displaying the full secret — mirroring 3c's `endpointTail` precedent.

Public, unauthenticated:

- `GET /api/stakeholder/:token`

Registered in `PUBLIC_OPERATIONS` in `openapi.ts`. It is the only public route added and it is
read-only. It must 404 (not 403) for revoked/expired/unknown tokens — an existence oracle on a
share token is itself a leak.

## UI

- **Public page** `/s/:token` — unauthenticated route registered outside `boardRoutes()`. Renders
  only the sections present in the payload. No board chrome, no sidebar, no links back into the app.
- **Management** — a "Stakeholder sharing" section folded into the existing `/digest` page (the
  narration surface), following 4b's precedent of not adding a sidebar entry per phase.

## Testing

- Pure unit tests for `assertShareViewable` (active / revoked / expired / expires-exactly-now) and
  `projectStakeholderPayload` (each toggle off ⇒ key absent; all off ⇒ empty sections).
- A **no-toggle-no-query** test: `gatherStakeholderSignals` with all toggles false performs zero
  section queries (spy on the db).
- Service tests (embedded postgres): create/list/update/revoke/rotate, token uniqueness, rotate
  invalidates the previous token, cross-company isolation.
- Route tests: board guards on all management routes; public route 404s for unknown/revoked/expired;
  public route returns only enabled sections; public route requires no auth.
- UI test for the public page (jsdom + `createRoot`, per repo convention).
- `openapi-routes.test.ts` must stay green — new route file registered in `apiPrefixes` and all six
  operations registered in the spec.

## Explicitly out of scope (deferred)

- **Access logging to the audit path.** Named in the Phase-4 deliverable ("access logged to the audit
  path") and idea 033 point 4; deliberately deselected for this slice by the operator on 2026-07-31.
  This is the one phasing deliverable 4c does not satisfy — tracked as a fast-follow.
- **Optional passphrase** (idea 033 point 4) — deferred.
- **Portfolio roll-up** (idea 033 point 5) — depends on Holding Company (idea 007), unbuilt.
- MRR/P&L fields — depend on revenue tracking (idea 030), unbuilt.

## Exit criteria

- A stakeholder link renders only the fields its owner curated; every section defaults off.
- Revocation and expiry take effect on the very next request.
- Rotation invalidates the old token.
- The public path exposes no auth, no mutation, and nothing from the never-exposed list above.
