# Cap operability — backend (Slice A) design

**Date:** 2026-07-07
**Status:** Approved design, pre-implementation
**Builds on:** merged instance-admission + per-company cap slices
**Decomposition:** Slice A (this spec) = backend — make both caps settable and observable via API.
Slice B (next) = UI — cap inputs + live status badge, consuming Slice A.

## Goal

Make the already-built concurrency caps operable via API: settable (instance cap already is;
add the company cap) and observable (a status surface exposing running/cap/queued per scope).
No UI in this slice.

## Context (already in place)

- Instance cap is **already settable**: `PATCH /instance/settings/general` accepts
  `maxConcurrentRuns` (it is in `instanceGeneralSettingsSchema`).
- `companies.maxConcurrentRuns` column exists; `PATCH /:companyId` →
  `companiesService.update` spreads the validated body straight into the `companies` UPDATE.
- `heartbeat.ts` exposes `countRunningRunsInstanceWide()` and
  `countRunningRunsForCompany(companyId)`; the admission seam resolves caps via
  `resolveEffectiveCap` (the single cap-resolution path).

## In scope

1. **Company-cap API** — one line: add `maxConcurrentRuns` to `updateCompanySchema`.
2. **Queued-count helpers** — `countQueuedRunsInstanceWide`, `countQueuedRunsForCompany`.
3. **Admission-status helpers** — `getInstanceAdmissionStatus`, `getCompanyAdmissionStatus`.
4. **Two read endpoints** — instance + per-company admission status.

## Out of scope (Slice B / later)

Any UI (cap inputs, status badge); live-event push of status over the websocket (Slice B may
add it; Slice A ships a pollable REST endpoint); changing enforcement behavior.

## Components & data flow

### 1. Company-cap API (`packages/shared/src/validators/company.ts`)

Add to `updateCompanySchema.extend({...})`:
```ts
maxConcurrentRuns: z.number().int().positive().nullable().optional(),
```
- `positive int` = set cap; `null` = clear (unlimited); omit = leave unchanged.
- The existing `PATCH /:companyId` handler validates with `updateCompanySchema` and calls
  `companiesService.update(id, body, actor)`, which does `.set({ ...companyPatch, updatedAt })`
  — so the field persists with no handler/service change. (`companies.maxConcurrentRuns` is
  a real column, so it is in `typeof companies.$inferInsert`.)
- Mirrors the instance validation (`positive int`, nullable for clear).

### 2. Queued-count helpers (`heartbeat.ts`, beside the running-count helpers)

```ts
async function countQueuedRunsInstanceWide(): Promise<number>   // count(*) status="queued"
async function countQueuedRunsForCompany(companyId): Promise<number>  // + companyId filter
```
Exposed on the service object like the running-count helpers (plain names).

### 3. Admission-status helpers (`heartbeat.ts`)

```ts
type AdmissionStatus = { cap: number | null; source: string; running: number; queued: number };
async function getInstanceAdmissionStatus(): Promise<AdmissionStatus>
async function getCompanyAdmissionStatus(companyId: string): Promise<AdmissionStatus>
```
Each resolves the cap via `resolveEffectiveCap({ configuredMax }, PHASE1_WRITERS)` — the SAME
resolver the admission seam uses (single source of truth) — with `configuredMax` from the
instance general setting / `companies.maxConcurrentRuns`, and fills `running`/`queued` from the
count helpers. Unset ⇒ `{ cap: null, source: "none", running, queued }`.

### 4. Read endpoints

- `GET /instance/admission-status` → `getInstanceAdmissionStatus()` as JSON.
- `GET /companies/:companyId/admission-status` → `getCompanyAdmissionStatus(companyId)` as JSON.

Thin handlers. Auth mirrors sibling routes: the instance route uses the same guard as other
`/instance/*` routes; the company route uses the company-scoped guard like other
`/companies/:companyId/*` routes.

## Error handling

- **Company PATCH**: `validate(updateCompanySchema)` rejects `0`/negative/float ⇒ `400`; `null`
  clears; omit leaves. Reuses the existing PATCH path (no new error surface).
- **Status endpoints**: read-only. A DB error surfaces as a normal `500` — NOT fail-open. These
  are observability, not the admission path; the UI should render "unavailable" rather than
  fabricated numbers. (Contrast the admission seam, which fails open to keep runs executing.)
- **Cap resolution** is consistent with the seam: unset ⇒ `cap: null, source: "none"`.

## Testing (TDD, red-first; embedded-pg harness, real DB, no mocks)

- **Company PATCH**: `maxConcurrentRuns` set persists; `null` clears; invalid (`0`, negative,
  float) ⇒ `400`.
- **Queued-count helpers**: seed running + queued rows across two companies ⇒ counts include
  only `status="queued"` and isolate by scope (instance-wide vs per-company).
- **Admission-status helpers**: with caps set, return correct `{cap, source, running, queued}`;
  unset ⇒ `{cap: null, source: "none", ...}`; per-company isolates from other companies.
- **Endpoints**: `GET /instance/admission-status` and `GET /companies/:companyId/admission-status`
  return the correct shape/values against seeded data; company endpoint is scoped correctly.

## Definition of done

- All tests pass (each red-first).
- A company's `maxConcurrentRuns` can be set and cleared via `PATCH /:companyId`.
- Both status endpoints return accurate `cap`/`source`/`running`/`queued`, consistent with the
  admission seam's resolver.
- No enforcement behavior change; no UI (Slice B).
