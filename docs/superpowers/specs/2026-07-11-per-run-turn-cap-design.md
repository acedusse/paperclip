# Design: Per-Run Turn Cap (Combo 01, Phase 2b)

- **Date:** 2026-07-11
- **Combo:** 01 — Unified Runtime Control Plane
- **Phase:** 2b — per-run step ceiling (idea 024, second sub-phase).
- **Depends on:** Phase 2a per-run caps (merged on this branch — `run-caps.ts`,
  `resolveStampedRunCaps`, stamp-at-claim, config-surface parity).
- **Status:** Approved design, pre-implementation.

## Problem

Phase 2a bounds a single run's **wall-clock** and **cost**. It does not bound how many
agent **steps** a run takes — a run can loop through hundreds of cheap, fast tool calls
without tripping either ceiling. Idea 024 calls for a `maxToolCalls` / step cap to close
this gap.

## Framing decision (locked): turns, not literal tool calls

The runtime has **no server-side per-tool-call signal**. One heartbeat run is exactly one
`adapter.execute()` call whose agent loop runs entirely inside a CLI subprocess; the only
streaming hook the server receives is `onLog(stream, chunk)` — raw, redacted text.
Structured `tool_call` parsing exists **only in the browser/UI layer**
(`packages/adapters/*/src/ui/parse-stdout.ts`), in heterogeneous per-adapter formats, and
is never run server-side.

The one step-like limit the runtime **can** enforce mid-run is the agent-**turn** count,
which some CLIs accept as `--max-turns` and enforce in-process. Phase 2b therefore ships an
honestly-named **`maxRunTurns`** — the enforceable proxy for "steps" — rather than a
tool-call count the runtime cannot observe. This is precisely the "gated on each adapter
surfacing step events" sub-phase the corrected phasing describes; per that guidance it does
**not** block on adapters that lack the signal.

## Scope

**In scope:** the `maxRunTurns` field on instance + company config; extending the 2a
resolver + stamp-at-claim to carry it; injecting the effective limit into the adapter
`execute()` config for adapters that support a turn flag; full operator config surface
(API + OpenAPI + UI); tests.

**Out of scope:** literal per-tool-call counting / server-side log parsing (no adapter
surfaces the signal — deliberately deferred, may never be built). No new reconcile source.
No Panic/Drain (that is Phase 2c). No new `--max-turns` wiring for adapters that lack it
today (follow-on as those adapters gain the flag).

## What already exists (2b is mostly a *promotion*)

`maxTurnsPerRun` is today a **per-agent adapter-config** field, not a governance cap:

- Config field `maxTurnsPerRun: number` on the adapter config
  (`packages/adapter-utils/src/types.ts:514`); seeded to `1000` for `claude_local` by the
  portability defaults (`server/src/services/company-portability.ts:709`).
- **claude-local** reads `config.maxTurnsPerRun` and, when `> 0`, passes
  `--max-turns <n>` to the CLI (`packages/adapters/claude-local/src/server/execute.ts:396,741`).
- **grok-local** reads a differently-named `config.maxTurns` and passes `--max-turns`
  the same way (`packages/adapters/grok-local/src/server/execute.ts:221,452`).
- When a CLI hits its turn limit it self-terminates; heartbeat's existing
  `MAX_TURN_CONTINUATION_*` machinery detects the stop reason and checkpoints + resumes the
  run. **This is already 2a Design-Decision-4 behavior** ("wind down with `resume:
  when-allowed`, continuation gets a fresh per-run budget") — no new termination path
  needed.

So 2b promotes this per-agent value into the **stamped per-run cap plane**: an
instance/company ceiling that is resolved, stamped at claim, and injected into the adapter
config — tightening (never raising) whatever the agent's own `maxTurnsPerRun` already is.

## Design decisions (locked)

1. **Enforcement is delegated to the CLI**, not swept server-side. Turns are enforced
   in-process by the adapter subprocess via `--max-turns`. Consequently **2b adds no
   `ReconcileSource` and no `windDownRun` path** — it is strictly smaller than 2a, which
   needed a sweep for wall-clock.
2. **Resolution precedence:** `company ?? instance ?? null` (null = unlimited), reusing the
   2a `resolveRunCaps` reduction extended with the new field.
3. **Effective limit = tightest-wins (`min`).** The value actually passed to the CLI is
   `min(perAgentConfigValue ?? ∞, stampedCap ?? ∞)`. A governance cap can only **lower** an
   agent's own configured limit, never raise it. When no governance cap is set the injected
   value is byte-for-byte identical to today — **backwards compatible**.
4. **Silent no-op for unsupported adapters.** The cap resolves and stamps for every run, but
   is only injected for adapters that consume a turn flag (**`claude_local`, `grok_local`**
   today). Every other adapter — including `gemini_local`, which *detects* the max-turns
   stop reason but has no flag to pass — silently ignores the cap. No config-time error, no
   per-adapter warning surface in this phase (matches the null=unlimited convention).
5. **Stamp for audit, not enforcement.** `heartbeat_runs.max_run_turns` records the resolved
   governance ceiling (`company ?? instance`) at claim, for observability/parity with 2a. It
   is not read by any sweep; the effective `min` is computed at injection time.
6. **Full config parity** with the 2a fields: instance-settings + company settings API,
   OpenAPI, and UI inputs.

## Config storage (mirrors the 2a fields exactly)

- **Company:** real integer column `maxRunTurns` on `companies`, beside the 2a columns
  (`packages/db/src/schema/companies.ts`). Nullable = unset.
- **Instance:** a key inside the `general` JSONB blob — added to
  `instanceGeneralSettingsSchema` (`packages/shared/src/validators/instance.ts`) and carried
  through `normalizeGeneralSettings` (`server/src/services/instance-settings.ts`); the
  `.strip()` schema drops any field not listed there.
- **Validators/types:** `updateCompanySchema` (`validators/company.ts`) + `types/company.ts`;
  `instanceGeneralSettingsSchema` + `types/instance.ts`. All use
  `z.number().int().positive().nullable().optional()`.
- **Routes/OpenAPI:** company PATCH spreads the patch (flows automatically); instance PATCH
  validates the schema; OpenAPI references the shared Zod schemas → auto-updates.

## Resolver + stamp-at-claim (extend 2a, do not fork)

`run-caps.ts`:

- Extend `type RunCaps` to `{ maxRunWallClockMs, maxRunCostCents, maxRunTurns }` (all
  `number | null`).
- Extend `resolveRunCaps` with `maxRunTurns: input.company.maxRunTurns ??
  input.instance.maxRunTurns`.

`heartbeat.ts`:

- `resolveStampedRunCaps` (`heartbeat.ts:7314`) — read `general.maxRunTurns` and
  `companies.maxRunTurns` alongside the existing two, fail-open to null.
- Stamp UPDATE at claim (`heartbeat.ts:7487`) — add `maxRunTurns: stampedCaps.maxRunTurns`
  to the `.set({...})`.
- New stamped column `heartbeat_runs.max_run_turns` (nullable integer).

The 2a `findRunningRunsWithCaps` / `RunningRunCapRow` / sweep are **not** touched — turns
have no sweep.

## Injection at execute (the one genuinely new wiring)

At the `runtimeConfig` assembly (`heartbeat.ts:9055`, `{ ...effectiveResolvedConfig,
paperclipRuntimeSkills }`), apply the effective turn limit before it reaches
`adapter.execute({ config: runtimeConfig })` (`heartbeat.ts:9781`):

- A tiny per-adapter field map names the config key each adapter reads/writes for its turn
  limit: `claude_local` → `maxTurnsPerRun`, `grok_local` → `maxTurns`. Unknown adapters are
  absent from the map → the helper returns the config untouched (silent no-op).
- For a mapped adapter, read the current value from *that* field, then compute
  `effectiveTurns = min(currentFieldValue ?? Infinity, run.maxRunTurns ?? Infinity)`. If
  `effectiveTurns` is `Infinity` (both unset) leave the config untouched; otherwise write
  `effectiveTurns` back to the same field.
- Read `run.maxRunTurns` from the stamped run row (available in scope as `run`).

A small pure helper, e.g. `applyRunTurnCap(config, stampedTurns, adapterType): config` in
`run-caps.ts`, keeps the `min` + field-mapping logic unit-testable and out of the heartbeat
mega-function. It returns a shallow-merged config (or the input unchanged when there is
nothing to cap).

## Coverage matrix (this phase)

| Adapter | Consumes turn flag today | 2b enforces `maxRunTurns` |
|---|---|---|
| `claude_local` | `--max-turns` from `maxTurnsPerRun` | **Yes** |
| `grok_local` | `--max-turns` from `maxTurns` | **Yes** |
| `gemini_local` | detects stop, no flag | No (silent no-op) |
| all others | no | No (silent no-op) |

## Operator surface (full parity)

- `ui/src/pages/CompanySettings.tsx` — `maxRunTurns` input (state seed, dirty check,
  `handleSaveGeneral` payload), mirroring the 2a wall-clock/cost fields.
- `ui/src/pages/InstanceGeneralSettings.tsx` — same.
- `ui/src/api/companies.ts` — extend the update payload type.
- Empty input → `null` (unlimited), matching the 2a fields. Label copy should say
  "turns" and note it applies only to adapters that support turn limits.

## Schema changes

One hand-written migration (`0109_per_run_turn_cap`, following the repo's post-`0098`
hand-authored convention; next number after `0108`):

- `companies`: `max_run_turns integer`.
- `heartbeat_runs`: `max_run_turns integer` (stamped).
- Instance value lives in the existing `general` JSONB — no column.

## Testing

- **Unit (`run-caps.test.ts`, extend):** `resolveRunCaps` carries `maxRunTurns` with the
  same `company ?? instance` precedence (company wins / instance fallback / both null).
- **Unit (`applyRunTurnCap`):** `min` semantics (stamped tighter → stamped wins; agent
  tighter → agent wins; one side null → other wins; both null → config untouched);
  field mapping (`claude_local` → `maxTurnsPerRun`, `grok_local` → `maxTurns`, unknown
  adapter → untouched).
- **Integration (embedded Postgres):** stamp — claiming a run under a configured
  `maxRunTurns` freezes the resolved value onto `heartbeat_runs.max_run_turns`; resolution —
  company override beats instance default.
- **Config plumbing:** instance `updateGeneral` round-trips `maxRunTurns` (guards against the
  `.strip()` drop) and company PATCH persists it.

## Files touched

- `packages/db/src/schema/companies.ts`, `heartbeat_runs.ts` + migration `0109`.
- `packages/shared/src/validators/instance.ts`, `types/instance.ts`, `validators/company.ts`,
  `types/company.ts`.
- `server/src/services/instance-settings.ts` (normalize carry-through).
- `server/src/services/run-caps.ts` (extend `RunCaps`/`resolveRunCaps`; add
  `applyRunTurnCap`).
- `server/src/services/heartbeat.ts` (resolve + stamp `maxRunTurns` at claim; apply
  `applyRunTurnCap` at `runtimeConfig` assembly).
- `ui/src/pages/CompanySettings.tsx`, `InstanceGeneralSettings.tsx`, `ui/src/api/companies.ts`.
- Tests colocated with the above.
