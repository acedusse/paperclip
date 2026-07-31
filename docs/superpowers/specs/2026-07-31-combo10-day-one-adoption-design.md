# Combo-10 — Day-One Adoption Kit (phases 1–4)

Status: implemented
Branch: `feat/combo10-phase1-preflight` (off `master` @ `58eacd1`)
Source: `.ideas/combinations/combo-10-day-one-adoption.md` (ideas 004, 018, 039, 058, 064)

> The Combo-03 log lives in `docs/superpowers/BUILD-DECISIONS.md` on PR #31. This branch is based on
> `master`, so Combo-10's record is kept here to avoid a merge conflict in that file. Fold this
> summary into the status table when both land.

## Pre-flight verification (2026-07-31)

Combo 10 was **not** uniformly greenfield, contrary to the status table's "Not started":

| Idea | State on `master` @ `58eacd1` |
|------|-------------------------------|
| **004** Dry-run estimator | Nothing. Genuinely greenfield. |
| **018** Blueprint library | Substrate existed — `packages/teams-catalog` (bundled/optional *team* packages, manifest, preview + install via `company-portability.ts`). Not parameterized, and teams rather than companies. |
| **039** Guided onboarding | Partial — `ui/src/components/OnboardingWizard.tsx` (1705 lines) already creates a real company + lead agent. No demo, no tour. |
| **058** Work templates / DoD | Thin — `acceptanceCriteria` existed on issues; no templates, no DoD. |
| **064** Data import | Nothing. |

## What shipped

| Phase | Files |
|-------|-------|
| 1 | `server/src/services/company-preflight/{checks,index}.ts`, `server/src/routes/company-preflight.ts`, `ui/src/pages/CompanyPreflight.tsx`, `ui/src/lib/preflight-display.ts` |
| 2 | `server/src/services/blueprints/variables.ts`, `server/src/services/work-templates/index.ts`, `packages/shared/src/types/blueprint.ts` |
| 3 | `server/src/services/demo-company/{blueprint,index}.ts` |
| 4 | `server/src/services/issue-import/csv.ts`, `server/src/services/company-preflight/projection.ts` |

### Phase 1 — preflight (004 static tier)

Eight checks, each a pure function over a loaded snapshot so they test without a database:
`no_invokable_agents`, `org_chain_invalid`, `adapter_unavailable`, `required_secret_unbound`,
`no_budget_policy`, `budget_below_one_run`, `no_cost_history`, `agent_without_work`.

**Scope correction against the approved design.** The design included `goal_without_work` and
`orphan_issues`. Those were dropped: Combo-03's `detectGoalDrift` was built in the interim and
already owns them. Two systems reporting the same problem in different words is worse than one
reporting it well. Preflight's scope is launch-blocking *configuration*; a test asserts the
goal checks do not creep back.

**Reuse.** `getAgentOrgChainHealth` supplies cycle detection *and* operator-facing repair guidance;
`computeObservedAmount` supplies budget spend so preflight and enforcement cannot disagree about
"spent"; the finding shape mirrors `AdapterEnvironmentCheck`, a vocabulary operators already read.

`budget_below_one_run` stays silent without cost history — guessing a per-run figure and failing a
launch on it would be worse than saying nothing.

### Phase 2 — blueprints (018) + work templates (058)

Declared variables (`string` / `number` / `choice`, defaults, bounds, options) over the portability
format, with `{{key}}` substitution through nested objects, arrays and object *keys*.

- `resolveBlueprintVariables` returns **every** issue rather than throwing on the first. An operator
  filling six fields should not submit six times to discover six mistakes.
- An unresolved placeholder is left **verbatim**, not blanked. A visible `{{typo}}` in the created
  company is far easier to diagnose than a silently empty field. `findUndeclaredPlaceholders`
  catches them before instantiation.

Work templates cover `feature` / `bug` / `content` / `research`, each with acceptance criteria and a
DoD split into **required** and **advisory** items — which keeps the checklist honest instead of
training operators to wave through mandatory items that do not always apply.
`evaluateDefinitionOfDone` is what Combo-05's review gate consumes as its concrete bar.
`applyWorkTemplate` never overwrites operator-written criteria: the template is a starting point,
not an override.

### Phase 3 — demo company (039)

The demo is the first entry in the blueprint library, not a special case: it goes through the same
resolution and substitution path a real company takes, so the demo exercises the path the operator's
own company will follow.

Properties, each covered by a test: plans successfully with **zero** operator input (the point is one
click); defaults to the `process` adapter, which needs no API key; defaults to a 500¢ ceiling so a
misconfigured demo cannot run away; every issue assigned and goal-linked and the org chart acyclic,
so the demo does not ship the very misconfigurations Phase 1 and Combo-03 exist to catch — a new
operator's first preflight should be green.

`planDemoCompany()` resolves and substitutes **without writing** — the dry-run preview the combo's
"launch with eyes open" philosophy asks for. Creation runs in one transaction: a half-built demo is a
worse first impression than a clear failure.

### Phase 4 — import (064) + cost projection (004)

Hand-written RFC-4180 parser (quoted fields, embedded commas and newlines, doubled-quote escaping,
CRLF, UTF-8 BOM) rather than a dependency — the import surface should not add a supply-chain edge for
~60 lines of well-specified parsing. Column aliases per source tool (Jira `Summary`, GitHub `Body`,
Linear `Assigned To`) and status aliases across vocabularies.

**Nothing is silently coerced.** Unrecognised statuses fall back to `backlog` *and are reported*;
unmapped foreign assignees are surfaced as the human→agent gap rather than dropped. A status quietly
mapped to the wrong bucket is how an import looks successful and is wrong. `mapImportRows` is pure
and non-committing — the dry run the operator inspects. Rows are numbered from 2 so they match what
the operator sees in a spreadsheet.

Cost projection bands p10/median/p90 observed run cost × invokable agents × cycles. Confidence never
exceeds `medium`: this is a projection, not a quote.

## Deliberate non-implementations

1. **Seeded cold-start price table** (idea 004). With no history the projection returns an honest
   "unknown". Inventing per-model prices produces a confident-looking number derived from nothing —
   worse for the operator than admitting ignorance.

2. **Shadow-heartbeat / `planOnly` tier — not built, and not merely for effort.** It would mean
   extending `AdapterExecutionContext` and having all 8+ adapter implementations honour it. The real
   blocker is idea 004's own requirement — "guarantees that dry-run truly performs no side effects."
   Every adapter spawns an *external* agent CLI (claude, codex, cursor) with filesystem and network
   access. Paperclip cannot guarantee such a process writes nothing by passing it a flag it may not
   honour. A partial implementation would claim a safety property it cannot deliver, which is worse
   than not shipping it. This needs a sandboxed execution target before it can be honest.

## Known gap

The demo defaults to the `process` adapter. The combo asks for "a free local model or a stubbed
adapter"; no stub adapter exists in this codebase, and `process` is the closest genuinely zero-cost,
no-API-key option.

## Verification

124 tests across 7 new suites, all green.

Full server suite: 3355 passed, 1 skipped, 2 failed. Full UI suite: 1740 passed, 2 failed. **All four
failures are the pre-existing cwd- and timezone-dependence bugs fixed on PR #31**, which this branch
does not carry because it is based on `master`. They disappear once #31 lands.
