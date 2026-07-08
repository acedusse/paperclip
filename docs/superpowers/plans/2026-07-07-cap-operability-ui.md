# Cap Operability UI (Slice B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the concurrency caps in the UI — set/clear the instance and company caps from the settings pages and show live `running / cap / queued` per scope.

**Architecture:** A one-line backend fix makes the instance cap clearable (`nullable`; normalize already drops falsy). The UI adds `getAdmissionStatus` API-client methods, a reusable `AdmissionStatusLine` presentational component, and a numeric cap input + status line on the instance and company settings pages — consuming the Slice A REST endpoints via react-query polling.

**Tech Stack:** React, TypeScript, @tanstack/react-query, Vitest + @testing-library/react (UI); Zod + embedded Postgres (backend fix).

## Global Constraints

- Instance cap validator becomes `z.number().int().positive().nullable().optional()`; `null` clears (unlimited). Company cap is already nullable.
- Status is read via react-query polling of the Slice A endpoints (`GET /instance/admission-status`, `GET /companies/:id/admission-status`) — NO live-events, NO new backend.
- `AdmissionStatus = { cap: number | null; source: string; running: number; queued: number }` — defined in the UI api layer (UI cannot import the server type).
- Status display: normal → `running {running} / cap {cap} · {queued} queued`; `cap === null` → "unlimited"; query error → "status unavailable". Never fabricate numbers.
- Cap inputs: positive integer or empty; empty ⇒ send `null` (clear). Client-side validity disables save on invalid.
- Status co-located with each cap input; no global dashboard widget. No enforcement change.
- Source files keep their `// [START: module]` / `// [END: module]` nav tags.

## File Structure

- Modify `packages/shared/src/validators/instance.ts` — instance `maxConcurrentRuns` → nullable.
- Modify `ui/src/api/instanceSettings.ts`, `ui/src/api/companies.ts` — `getAdmissionStatus` + `AdmissionStatus` type + `maxConcurrentRuns` in the company update whitelist.
- Create `ui/src/components/AdmissionStatusLine.tsx` (+ `.test.tsx`) — presentational status line.
- Modify `ui/src/pages/InstanceGeneralSettings.tsx` (+ its test) — instance cap input + status.
- Modify `ui/src/pages/CompanySettings.tsx` (+ `CompanySettings.test.tsx`) — company cap input + status.

---

### Task 1: Backend — make the instance cap clearable

**Files:**
- Modify: `packages/shared/src/validators/instance.ts` (the `maxConcurrentRuns` line in `instanceGeneralSettingsSchema`)
- Test: `server/src/__tests__/instance-settings-service.test.ts`

**Interfaces:**
- Consumes: existing `instanceSettingsService(db).updateGeneral` / `getGeneral`.
- Produces: instance `maxConcurrentRuns` accepts `null` (clears).

- [ ] **Step 1: Write the failing test** (append to the existing describe block)

```typescript
it("clears instance maxConcurrentRuns when set to null", async () => {
  const svc = instanceSettingsService(db);
  await svc.updateGeneral({ maxConcurrentRuns: 8 });
  expect((await svc.getGeneral()).maxConcurrentRuns).toBe(8);

  await svc.updateGeneral({ maxConcurrentRuns: null });
  expect((await svc.getGeneral()).maxConcurrentRuns).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run src/__tests__/instance-settings-service.test.ts -t "clears instance maxConcurrentRuns"`
Expected: FAIL — `updateGeneral({ maxConcurrentRuns: null })` throws / is rejected because the current validator (`.positive().optional()`, no `null`) rejects `null`.

- [ ] **Step 3: Make the field nullable**

In `packages/shared/src/validators/instance.ts`, change the `maxConcurrentRuns` line in `instanceGeneralSettingsSchema` from:
```typescript
  maxConcurrentRuns: z.number().int().positive().optional(),
```
to:
```typescript
  maxConcurrentRuns: z.number().int().positive().nullable().optional(),
```
(No `normalizeGeneralSettings` change needed: it already carries the value through only when truthy — `...(parsed.data.maxConcurrentRuns ? {...} : {})` — so `null` drops the field, i.e. clears. Verify this holds.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run src/__tests__/instance-settings-service.test.ts -t maxConcurrentRuns`
Expected: PASS (set, clear, and the pre-existing persistence/omit tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/validators/instance.ts server/src/__tests__/instance-settings-service.test.ts
git commit -m "fix(admission): make instance maxConcurrentRuns clearable (nullable)"
```

---

### Task 2: UI API client + AdmissionStatusLine component

**Files:**
- Modify: `ui/src/api/instanceSettings.ts`, `ui/src/api/companies.ts`
- Create: `ui/src/components/AdmissionStatusLine.tsx`, `ui/src/components/AdmissionStatusLine.test.tsx`

**Interfaces:**
- Consumes: the `api` client (`api.get`); Slice A endpoints.
- Produces:
  - `type AdmissionStatus = { cap: number | null; source: string; running: number; queued: number }` (exported from `ui/src/api/instanceSettings.ts`)
  - `instanceSettingsApi.getAdmissionStatus(): Promise<AdmissionStatus>`
  - `companiesApi.getAdmissionStatus(companyId: string): Promise<AdmissionStatus>`
  - `companiesApi.update` accepts `maxConcurrentRuns?: number | null`
  - `<AdmissionStatusLine status={AdmissionStatus | undefined} isError={boolean} />`

- [ ] **Step 1: Write the failing component test**

```tsx
// ui/src/components/AdmissionStatusLine.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdmissionStatusLine } from "./AdmissionStatusLine";

describe("AdmissionStatusLine", () => {
  it("renders running / cap / queued", () => {
    render(<AdmissionStatusLine status={{ cap: 10, source: "configured-default", running: 3, queued: 2 }} isError={false} />);
    expect(screen.getByText(/running 3 \/ cap 10 · 2 queued/i)).toBeInTheDocument();
  });
  it("shows 'unlimited' when cap is null", () => {
    render(<AdmissionStatusLine status={{ cap: null, source: "none", running: 1, queued: 0 }} isError={false} />);
    expect(screen.getByText(/running 1 \/ cap unlimited · 0 queued/i)).toBeInTheDocument();
  });
  it("shows 'status unavailable' on error", () => {
    render(<AdmissionStatusLine status={undefined} isError={true} />);
    expect(screen.getByText(/status unavailable/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && npx vitest run src/components/AdmissionStatusLine.test.tsx`
Expected: FAIL — cannot find module `./AdmissionStatusLine`.

- [ ] **Step 3: Create the component**

```tsx
// ui/src/components/AdmissionStatusLine.tsx
import type { AdmissionStatus } from "../api/instanceSettings";

export function AdmissionStatusLine({
  status,
  isError,
}: {
  status: AdmissionStatus | undefined;
  isError: boolean;
}) {
  if (isError || !status) {
    return <span className="text-xs text-muted-foreground">status unavailable</span>;
  }
  const cap = status.cap === null ? "unlimited" : String(status.cap);
  return (
    <span className="text-xs text-muted-foreground">
      running {status.running} / cap {cap} · {status.queued} queued
    </span>
  );
}
```
(Match the surrounding files' nav-tag convention if the linter/repo adds `[START: module]` headers to new `.tsx` files; otherwise a plain component file is fine — follow what other `ui/src/components/*.tsx` do.)

- [ ] **Step 4: Add the API-client methods + type**

In `ui/src/api/instanceSettings.ts`:
```typescript
export type AdmissionStatus = { cap: number | null; source: string; running: number; queued: number };
```
and inside `instanceSettingsApi`:
```typescript
  getAdmissionStatus: () => api.get<AdmissionStatus>("/instance/admission-status"),
```
In `ui/src/api/companies.ts`: import `AdmissionStatus` from `./instanceSettings`, add to `companiesApi`:
```typescript
  getAdmissionStatus: (companyId: string) =>
    api.get<AdmissionStatus>(`/companies/${companyId}/admission-status`),
```
and add `maxConcurrentRuns?: number | null;` to the field-whitelist type of `companiesApi.update`'s `data` parameter.

- [ ] **Step 5: Run to verify it passes**

Run: `cd ui && npx vitest run src/components/AdmissionStatusLine.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add ui/src/api/instanceSettings.ts ui/src/api/companies.ts ui/src/components/AdmissionStatusLine.tsx ui/src/components/AdmissionStatusLine.test.tsx
git commit -m "feat(admission): admission-status API client + AdmissionStatusLine component"
```

---

### Task 3: Instance cap input + status on InstanceGeneralSettings

**Files:**
- Modify: `ui/src/pages/InstanceGeneralSettings.tsx`
- Test: `ui/src/pages/InstanceGeneralSettings.test.tsx` (create if absent; mirror an existing page test's harness — mock `instanceSettingsApi`)

**Interfaces:**
- Consumes: `instanceSettingsApi.updateGeneral`, `instanceSettingsApi.getAdmissionStatus`, `AdmissionStatusLine`, the existing `general.maxConcurrentRuns`.
- Produces: (UI only.)

- [ ] **Step 1: Write the failing test**

Mock `instanceSettingsApi` (mirror how existing page tests mock their api module). Render the page inside a `QueryClientProvider`. Assert:
```tsx
it("saves a new instance cap and clears it", async () => {
  const updateGeneral = vi.fn().mockResolvedValue({});
  // (spy/mock instanceSettingsApi.updateGeneral and getAdmissionStatus per the file's mock setup)
  render(<InstanceGeneralSettings />, { wrapper: QueryWrapper });
  const input = await screen.findByLabelText(/max concurrent runs/i);
  await userEvent.clear(input); await userEvent.type(input, "10");
  await userEvent.click(screen.getByRole("button", { name: /save/i })); // or the field's save affordance
  expect(updateGeneral).toHaveBeenCalledWith({ maxConcurrentRuns: 10 });

  await userEvent.clear(input);
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(updateGeneral).toHaveBeenLastCalledWith({ maxConcurrentRuns: null });
});

it("renders the live status line", async () => {
  // mock getAdmissionStatus → { cap: 10, source: "configured-default", running: 2, queued: 1 }
  render(<InstanceGeneralSettings />, { wrapper: QueryWrapper });
  expect(await screen.findByText(/running 2 \/ cap 10 · 1 queued/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && npx vitest run src/pages/InstanceGeneralSettings.test.tsx`
Expected: FAIL — no "max concurrent runs" input / no status line yet.

- [ ] **Step 3: Add the input + status**

In `InstanceGeneralSettings.tsx`:
- Add local state seeded from `general.maxConcurrentRuns`: `const [maxRuns, setMaxRuns] = useState("")` and an effect syncing it from the loaded general settings (`String(general.maxConcurrentRuns ?? "")`).
- Add a `<Field label="Max concurrent runs" hint="Instance-wide cap on running agent runs. Empty = unlimited.">` containing `<Input type="number" min={1} value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} />` (import `Field`/`Input` as the company page does).
- Validity: `const trimmed = maxRuns.trim(); const maxRunsValid = trimmed === "" || (Number.isInteger(Number(trimmed)) && Number(trimmed) > 0);`
- Save affordance (button or the page's existing save pattern) → `updateGeneralMutation.mutate({ maxConcurrentRuns: trimmed === "" ? null : Number(trimmed) })`, disabled when `!maxRunsValid || updateGeneralMutation.isPending`.
- Add the status query + line:
```tsx
const admissionStatus = useQuery({
  queryKey: ["instance-admission-status"],
  queryFn: instanceSettingsApi.getAdmissionStatus,
  refetchInterval: 10_000,
});
// near the input:
<AdmissionStatusLine status={admissionStatus.data} isError={admissionStatus.isError} />
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ui && npx vitest run src/pages/InstanceGeneralSettings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/InstanceGeneralSettings.tsx ui/src/pages/InstanceGeneralSettings.test.tsx
git commit -m "feat(admission): instance cap input + live status on instance settings"
```

---

### Task 4: Company cap input + status on CompanySettings

**Files:**
- Modify: `ui/src/pages/CompanySettings.tsx`
- Test: `ui/src/pages/CompanySettings.test.tsx` (extend existing)

**Interfaces:**
- Consumes: `companiesApi.update`, `companiesApi.getAdmissionStatus`, `AdmissionStatusLine`, `selectedCompany.maxConcurrentRuns`, `selectedCompanyId`.
- Produces: (UI only.)

- [ ] **Step 1: Write the failing test** (extend `CompanySettings.test.tsx`, mocking `companiesApi`)

```tsx
it("saves and clears the company cap", async () => {
  // mock companiesApi.update (vi.fn) + getAdmissionStatus per the file's setup; selectedCompany present
  render(<CompanySettings />, { wrapper: QueryWrapper });
  const input = await screen.findByLabelText(/max concurrent runs/i);
  await userEvent.clear(input); await userEvent.type(input, "4");
  await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
  expect(companiesApi.update).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ maxConcurrentRuns: 4 }));

  await userEvent.clear(input);
  await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
  expect(companiesApi.update).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ maxConcurrentRuns: null }));
});

it("renders the company status line", async () => {
  // mock getAdmissionStatus → { cap: 4, source: "configured-default", running: 1, queued: 0 }
  render(<CompanySettings />, { wrapper: QueryWrapper });
  expect(await screen.findByText(/running 1 \/ cap 4 · 0 queued/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ui && npx vitest run src/pages/CompanySettings.test.tsx -t "company cap"`
Expected: FAIL — no "max concurrent runs" input / status line.

- [ ] **Step 3: Add the input + status**

In `CompanySettings.tsx`, mirroring the existing `attachmentMaxMiB` field:
- Add `const [maxRuns, setMaxRuns] = useState("")` seeded in the same effect that seeds `attachmentMaxMiB` (from `selectedCompany.maxConcurrentRuns`: `String(selectedCompany.maxConcurrentRuns ?? "")`).
- Validity: `const trimmed = maxRuns.trim(); const maxRunsValid = trimmed === "" || (Number.isInteger(Number(trimmed)) && Number(trimmed) > 0);`
- Add a `<Field label="Max concurrent runs" hint="Cap on this company's running agent runs. Empty = unlimited.">` with `<Input type="number" min={1} value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} />` near the attachment field.
- In `handleSaveGeneral`, add to the `generalMutation.mutate({...})` payload: `maxConcurrentRuns: maxRuns.trim() === "" ? null : Number(maxRuns.trim())`. Extend the mutation's `data` type accordingly.
- Include `maxRunsValid` in the Save button's `disabled` expression.
- Status: `useQuery({ queryKey: ["company-admission-status", selectedCompanyId], queryFn: () => companiesApi.getAdmissionStatus(selectedCompanyId!), enabled: !!selectedCompanyId, refetchInterval: 10_000 })` and render `<AdmissionStatusLine .../>` near the input.

- [ ] **Step 4: Run to verify it passes**

Run: `cd ui && npx vitest run src/pages/CompanySettings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + nav sync + commit**

Run: `cd ui && npx tsc --noEmit` — Expected: clean on the changed files.
Run: `python3 scripts/nav/nav_endhook.py --no-inject` (the `--no-inject` flag is REQUIRED).

```bash
git add ui/src/pages/CompanySettings.tsx ui/src/pages/CompanySettings.test.tsx
git commit -m "feat(admission): company cap input + live status on company settings"
```

---

## Self-review notes

- **Spec coverage:** clearable instance cap (Task 1), API client + type + `AdmissionStatusLine` (Task 2), instance page input+status (Task 3), company page input+status (Task 4). Error/empty→null handling and "unlimited"/"status unavailable" rendering all covered.
- **Type consistency:** `AdmissionStatus` defined in `instanceSettings.ts`, imported by `companies.ts`, `AdmissionStatusLine`, and both pages — one definition. `getAdmissionStatus` signatures consistent (instance: no arg; company: `companyId`). Cap payload is always `number | null` (empty→null) across both pages.
- **Frontend-test caveat:** the page tests (Tasks 3–4) mock the api clients and mirror an existing page test's harness (`QueryClientProvider` wrapper, api-module mock); the exact save affordance/label selectors may need adjusting to the real rendered markup — the implementer aligns selectors to what they render. Real backend behavior is covered by Slice A + Task 1.
- **Nav:** Task 4 runs `nav_endhook.py --no-inject` (repo files are untagged; bare `--inject` mass-modifies them).
