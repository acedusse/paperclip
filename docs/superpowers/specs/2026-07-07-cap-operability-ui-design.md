# Cap operability — UI (Slice B) design

**Date:** 2026-07-07
**Status:** Approved design, pre-implementation
**Builds on:** Slice A (backend cap operability — company-cap API + admission-status endpoints), branch `cap-operability-backend` / PR #2.
**Base:** branched off the Slice A tip (`30fe575`), NOT master (master lacks Slice A).

## Goal

Surface the concurrency caps in the UI: an operator can set/clear the instance and company
caps from the settings pages, and see live `running / cap / queued` per scope. Consumes the
Slice A endpoints; no live-events (react-query polling).

## Small backend prerequisite (folded into this slice)

Slice A's review noted the instance cap is **not clearable** (`instanceGeneralSettingsSchema`
uses `.positive().optional()` — no `null` — and `normalizeGeneralSettings` uses a truthy
check). A config UI needs "clear → unlimited", so this slice:
- Makes the instance `maxConcurrentRuns` validator `.positive().nullable().optional()`
  (`packages/shared/src/validators/instance.ts`).
- Updates `normalizeGeneralSettings` (`server/src/services/instance-settings.ts`) to carry
  `null` through (clear) rather than only a truthy value.
(The company cap is already nullable.)

## In scope

1. Backend fix: instance `maxConcurrentRuns` clearable via `null`.
2. UI API client: `getAdmissionStatus` (instance + company); `maxConcurrentRuns` in
   `companiesApi.update` whitelist; a UI `AdmissionStatus` type.
3. Instance cap input + live status on `InstanceGeneralSettings.tsx`.
4. Company cap input + live status on `CompanySettings.tsx`.
5. `AdmissionStatusLine` reusable status component.

## Out of scope

Live-event push of status over the websocket (polling suffices; a later optimization); any
new global dashboard widget (status is co-located with the cap inputs); enforcement changes.

## Components & data flow

### 1. Backend: make the instance cap clearable

- `packages/shared/src/validators/instance.ts`: `maxConcurrentRuns: z.number().int().positive().nullable().optional()`.
- `server/src/services/instance-settings.ts` `normalizeGeneralSettings`: replace the truthy
  carry-through with one that distinguishes "key present" from "absent" so `null` clears and a
  positive value sets (mirror how the company column treats `null`). Unset/`null` ⇒ field
  absent/undefined in the returned general settings (⇒ resolver `configuredMax: null`).

### 2. UI API client

`ui/src/api/instanceSettings.ts` and `ui/src/api/companies.ts`:
```ts
type AdmissionStatus = { cap: number | null; source: string; running: number; queued: number };
// instanceSettingsApi:
getAdmissionStatus: () => api.get<AdmissionStatus>("/instance/admission-status")
// companiesApi:
getAdmissionStatus: (companyId: string) => api.get<AdmissionStatus>(`/companies/${companyId}/admission-status`)
// companiesApi.update field whitelist: add `maxConcurrentRuns?: number | null`
```
`AdmissionStatus` lives in the UI api layer (the UI can't import the server-side type).

### 3. `AdmissionStatusLine` component (`ui/src/components/`)

Props: `{ status: AdmissionStatus | undefined; isError: boolean }`. Renders:
- normal: `running {running} / cap {cap} · {queued} queued`, with `cap === null` → "unlimited".
- error: "status unavailable".
Unit-tested in isolation.

### 4. Instance cap input + status (`InstanceGeneralSettings.tsx`)

- Numeric field mirroring the existing backup/attachment number fields, bound to
  `general.maxConcurrentRuns`, saving via `updateGeneralMutation.mutate({ maxConcurrentRuns: n })`.
  Empty ⇒ `mutate({ maxConcurrentRuns: null })` (clear). Client-side validity: positive integer
  or empty; disable save when invalid (mirror the attachment-field pattern).
- `AdmissionStatusLine` fed by `useQuery({ queryKey: ["instance-admission-status"], queryFn: instanceSettingsApi.getAdmissionStatus, refetchInterval: 10_000 })`.

### 5. Company cap input + status (`CompanySettings.tsx`)

- Numeric field mirroring `attachmentMaxMiB` (local state + validity), saving via
  `companiesApi.update(companyId, { maxConcurrentRuns })`; empty ⇒ `null` (company cap already
  nullable).
- `AdmissionStatusLine` fed by `useQuery({ queryKey: ["company-admission-status", companyId], queryFn: () => companiesApi.getAdmissionStatus(companyId), refetchInterval: 10_000 })`.

## Error handling

- **Cap inputs**: client-side validity (positive int or empty) disables save; server rejects
  invalid with `400` (surfaced via each page's existing `actionError`/mutation-error path).
  Empty ⇒ `null` clear.
- **Status query**: on error, `AdmissionStatusLine` shows "status unavailable" — never
  fabricated numbers (consistent with Slice A's non-fail-open 500). `cap === null` ⇒ "unlimited".
- **Backend fix**: `null` clears the instance cap; a cleared cap round-trips as unset.

## Testing

- **Backend fix (embedded pg, real behavior):** extend the instance-settings service test —
  instance `maxConcurrentRuns` sets to a value AND clears via `null` (the new capability).
- **UI component tests** (vitest + testing-library, mirroring existing `*.test.tsx`; mock the
  `instanceSettingsApi`/`companiesApi` clients — real backend behavior is covered by Slice A +
  the fix test):
  - `AdmissionStatusLine`: "running N / cap M · K queued"; `cap: null` → "unlimited"; error →
    "status unavailable".
  - `InstanceGeneralSettings`: entering a value calls `updateGeneral({ maxConcurrentRuns })`;
    clearing sends `null`; invalid disables save; status line renders from mocked
    `getAdmissionStatus`.
  - `CompanySettings`: the cap input calls `companiesApi.update({ maxConcurrentRuns })`; status
    line renders.

## Definition of done

- All tests pass (each red-first where behavior is added).
- Instance cap can be set AND cleared via the UI; company cap can be set AND cleared.
- Both settings pages show live `running / cap / queued` (cap `null` → "unlimited"), degrading
  to "status unavailable" on error.
- No enforcement change; no live-events; no new global widget.
