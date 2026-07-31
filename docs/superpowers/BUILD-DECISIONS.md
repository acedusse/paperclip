# Build Decisions Log

Standing record of product-build direction for the `.ideas/` combination roadmap.
Append new entries at the top. **Before starting any combo or phase, run the
[Pre-flight verification](#pre-flight-verification) checklist.**

Source build order: [`.ideas/combinations/README.md`](../../.ideas/combinations/README.md)
(suggested build order section).

---

## [2026-07-31] Completed — Combo 03 Phase 1 (run-signal read model)

**Outcome:** Shipped `server/src/services/run-signals/` — `scope.ts` (the run↔issue predicate and
run status sets), `issue-signals.ts` (batched per-issue aggregation), `index.ts` (facade).
`productivity-review.ts` now consumes it; its private `issueRunScopeSql`, `countIssueRunsSince` and
`countIssueCommentsSince` are gone.

**Branch:** `feat/combo03-phase1-run-signals` (off `master` @ `58eacd1`)

**Exit criteria met:** yes.

- Shared read model consumed by a real detector — yes.
- **The 11 existing `productivity-review-service.test.ts` tests pass unmodified** (verified via
  `git status` showing the test file untouched). This is the behaviour-preservation proof.
- 17 new tests on embedded-postgres (4 scope + 13 aggregation), covering all three `contextSnapshot`
  key variants, window boundaries, the queued-run `coalesce(startedAt, createdAt)` case, streak
  ordering, batch `Map` shape, per-issue cost, cross-agent isolation, cross-company isolation, and
  empty-input short-circuit.
- No new tables, no migration, no new runtime dependency, no route, no UI — as designed.

**Two corrections made during execution** (both now in the spec):

1. The scope is an **(issue, agent) pair**, not an issue. `productivity-review` counts runs and
   comments for an issue *by its assignee*; widening that would change which issues trip the
   detector. The batch bucketing has to re-check the pair, because the batched `or` predicate can
   match another scope's agent — caught by a test added beyond the plan.
2. Window and comment counts are computed over the **uncapped** run set; only the streak walk and
   the exposed `runIds` are capped at `MAX_RUNS_FOR_STREAK`. The original counted uncapped, and
   capping the counts would under-report an issue with >100 runs — precisely the thrashing case
   these signals exist to catch.

**Also dropped from the phase:** `AgentRunSignals`. Nothing consumes it until 044 in Phase 2, so its
interface would have been a guess — the same objection this phase raises against building detectors
on OTel spans. It lands with 044, which defines what "success" means.

**Next:** Phase 2 — deterministic detectors (010 global SCC/deadlock, 026 orphan walk, 059
decomposition checks, 044 SLOs) + the 006 heatmap overlay on `org-chart-svg.ts`.

---

## [2026-07-31] Started — Combo 03 Phase 1 (run-signal read model)

**Context:** Operator ordered the work "combo #3 then combo #10". Pre-flight run against `master`.

**Pre-flight outcome — Combo 03:** the status table's "Not started" was **wrong**. Per constituent
idea:

| Idea | State on `master` @ `58eacd1` | Implication |
|------|-------------------------------|-------------|
| **003** Diminishing-returns detector | **Built.** `server/src/services/productivity-review.ts` (929 lines) — `no_comment_streak` / `long_active_duration` / `high_churn` triggers, evidence gathering, escalation via the recovery/wakeup path. 11 tests in `productivity-review-service.test.ts`. | Do not rebuild. Phase 1 refactors it onto the shared read model. |
| **010** Blocker-graph deadlock | **Edge set exists** — `issue_relations` (`type: "blocks"`), plus per-issue `blocked_chain_stalled` attention in `issues.ts`. | No global cycle/SCC detection. Phase 2. |
| **059** Decomposition quality | **Substrate exists** — `issue_plan_decompositions` (requested vs actual children, fingerprint, owner run). | No quality checks over it. Phase 2. |
| **026** Goal drift | Goals + `issues.goalId` exist; no drift auditor. | Phase 2. |
| **044** Reliability SLOs | **Nothing** — no error budget, no success/recovery rate. | Phase 1 computes the substrate; Phase 2 thresholds it. |
| **006** Bottleneck heatmap | **Nothing**, but `server/src/routes/org-chart-svg.ts` (792 lines) + `ui/src/pages/OrgChart.tsx` are the renderer to overlay. | Phase 2. |

**Phase 1 redefined (operator-approved).** The combo doc's Phase 1 — "semantic run spans (031); ship
first, reuse the existing OTel exporter; this one layer becomes the clean data source every detector
reads" — **does not work in this codebase**. `server/src/instrumentation.ts` is opt-in and off by
default, the `@opentelemetry/*` packages are deliberately absent from the dependency graph, it is
auto-instrumentation only (no custom spans), and it **exports to an external collector** — spans
leave the process and nothing reads them back. Detectors built on spans would work only for
self-hosters running a collector, and would need the server to query Jaeger/Tempo at analysis time.

The data the detectors need is already in Postgres and richer than the proposed span set:
`heartbeat_runs`, `heartbeat_run_events`, `cost_events`. Phase 1 is therefore a **run-signal read
model** over those tables. Semantic span emission is deferred as a secondary export sink — an
observability feature, not the backbone.

**Key reuse finding:** `productivity-review.ts` privately owns `issueRunScopeSql`, the run↔issue join
— and it matches **three** `contextSnapshot` key variants (`issueId`, `taskId`, `taskKey`) because
run→issue attribution was never normalised. That correctness-critical predicate would otherwise be
copied into four more detectors plus the heatmap. Phase 1 makes it a single owned unit.

**Branch / PR:** `feat/combo03-phase1-run-signals` (off `master` @ `58eacd1`); no PR yet.
**Spec:** `docs/superpowers/specs/2026-07-31-combo03-phase1-run-signals-design.md`
**Exit criteria:** shared `run-signals` service consumed by `productivity-review.ts`, with its 11
existing tests green **unmodified** (the behaviour-preservation proof), plus aggregation tests on
embedded-postgres. No new tables, no migration, no new runtime dependency, no user-visible surface.
**Next:** operator reviews spec → implementation plan → build.

---

## [2026-07-31] Started — Combo 10 Phase 1 (Dry-Run Estimator static checks)

**Context:** Operator redirected from Combo 03 to Combo 10 ("drive real usage"). Pre-flight run
against `master` for both combos.

**Pre-flight outcome — Combo 03:** *Not started.* No `docs/superpowers/specs/*combo03*`, no plans,
no branch, no commits matching `combo-03`, no `Combo-03 Phase` markers in `server/`, `packages/`,
`ui/`. Genuinely greenfield whenever it is picked up.

**Pre-flight outcome — Combo 10:** *Partially started* — the combo is **not** uniformly greenfield,
which the status table above previously implied. Per constituent idea:

| Idea | State on `master` @ `58eacd1` | Implication |
|------|-------------------------------|-------------|
| **004** Dry-Run Estimator | **Nothing.** No preflight/estimator code. | Phase 1 is greenfield. |
| **018** Blueprint Library | **Substrate exists.** `packages/teams-catalog` (bundled/optional *team* packages, `generated/catalog.json` manifest, preview + install via `company-portability.ts`, `teamsCatalogService`). | Phase 2 extends this to *parameterized company* blueprints; `CatalogTeamKind` is only `bundled\|optional` and there are no declared variables (goal/budget/adapter). Do not rebuild the catalog. |
| **039** Guided onboarding | **Partial.** `ui/src/components/OnboardingWizard.tsx` (1705 lines, 6 steps) already creates a real company + lead agent. | Phase 3 adds the demo company + tour on top; expect rework of a large component. |
| **058** Work templates / DoD | **Thin.** `acceptanceCriteria` exists on issues (`packages/shared/src/validators/issue.ts`, `issues.ts`). No templates, no DoD checklist gate. | Phase 2 builds the template/DoD layer over the existing field. |
| **064** Data import | **Nothing.** No Jira/Linear/Asana/GitHub/Trello/CSV importer. | Phase 4 is greenfield and open-ended (source selection needs an operator decision). |

**Scope decision (operator):** Phase 1 only, then check in. Surface: API + company page panel.

**Reuse found (avoids new code):** `getAgentOrgChainHealth` in `packages/shared/src/agent-eligibility.ts`
already does reporting-cycle detection — the "circular reporting" static check reuses it rather than
adding a new graph walk. `AdapterEnvironmentCheck` / `AdapterEnvironmentTestResult` in
`packages/shared/src/types/agent.ts` already establish a `code`/`level`/`message`/`detail`/`hint`
finding vocabulary — the preflight report mirrors it.

**Branch / PR:** not yet cut.
**Exit criteria met:** no — design presented, awaiting operator approval before spec is written.
**Next:** approve design → `docs/superpowers/specs/2026-07-31-combo10-phase1-preflight-design.md`
→ plan → build. Remember to register the new route in **both** `openapi.ts` and the `apiPrefixes`
map in `openapi-routes.test.ts` (the omission that made `master` red during Combo 05).

---

## [2026-07-31] Decision — Path B: product implementation (build order)

**Decided:** Pursue **Path B** from the corpus status report — implement combos in the
recommended product build order rather than finishing documentation gaps first (xcombo-12..15,
llm-wiki re-ingest).

**Rationale:** The planning corpus is ~97% complete as documentation. Highest leverage now is
shipping the foundations that other combos compose onto.

**Gate (mandatory):** Do **not** start a combo or phase until [Pre-flight verification](#pre-flight-verification)
confirms it is not already done on the target branch.

### Status at decision time

| Combo | Importance | Build-order rank | Implementation status | Notes |
|-------|-----------|------------------|----------------------|-------|
| **01** Runtime Control Plane | 9 | 1 | **Complete** | All phases 1–4 (incl. 4A cadence/WIP + 4B workspace claims). See `docs/superpowers/specs/2026-07-13-claim-aware-run-selection-design.md` — "Combo 01 is functionally complete." Code: `effective-cap-resolver.ts`, `predictive-breaker.ts`, `run-execution-state.ts`, `run-caps.ts`, `wip-flow.ts`, `workspace-path-claims.ts`, etc. |
| **05** Review Cockpit | 9 | 2 | **Complete** | All phases 1–4c merged to `master` @ `58eacd1` (2026-07-31): PR #28 landed 4a+4b, PR #30 landed 4c (stakeholder transparency page / idea 033). One deferred deliverable: access-logging of stakeholder page views to the audit path. |
| **03** Health Sentinel | 9 | 3 | **Phase 1 complete** | Pre-flight run 2026-07-31. **"Not started" was wrong**: idea 003 is fully built (`productivity-review.ts`), 010/059 have substrate. Phase 1 redefined away from OTel spans and shipped as `server/src/services/run-signals/` — see log entry. Phases 2–3 pending. |
| **10** Day-One Adoption | 8 | 4 | Queued after Combo 03 | Pre-flight run 2026-07-31; **not uniformly greenfield** (see log entry). Phase 1 (Dry-Run Estimator static checks) designed, spec not yet written. |
| **04** CFO Suite | 8 | 5 | Partial / scattered | Ideas 013/019/030 have some substrate (`costs.ts`, budgets) but combo not built as unified feature. |
| **02** Model Economy | 8 | 5 | Partial | Idea 008 (local LLM) largely config; combo fabric not unified. |
| **08** Zero-Trust Governance | 8 | 6 | Not started | — |
| **06–07, 09, 11–13** | 6–7 | 7+ | Not started | Mature later. |

### Immediate next actions (corrected after verification)

1. ~~**Finish Combo 05**~~ — done. 4a+4b landed via PR #28; 4c built and open as PR #30.
   Landing #28 required repairing a long-red CI check: `openapi-routes.test.ts` had never been
   given seven route files (five of them already on `master`), so **`master` itself was red**.
   Register new route files in BOTH `openapi.ts` and that test's `apiPrefixes` map.
2. ~~**Merge PR #30**~~ — merged 2026-07-31. Optionally pick up the deferred 4c fast-follow
   (access logging of stakeholder page views to the audit path — the one Phase-4 deliverable
   not satisfied).
3. **Then Combo 03** (Health Sentinel) — first combo in build order that is genuinely greenfield.
4. Re-run pre-flight before each phase; update the status table in this file.

### Deferred (Path A — documentation)

- Write `xcombo-12..15` combo files
- Update `combinations/README.md` for ideas 065/066
- LLM-wiki re-ingest + human review of open questions

---

## Pre-flight verification

Run this checklist **before** opening a new combo or phase implementation plan.

### 1. Read the phasing contract

- [ ] `.ideas/combinations/combo-NN-*.md` — unified idea + ratings
- [ ] `.ideas/combinations/combo-NN-phasing-corrected.md` (if exists) — per-phase deliverables + **exit criteria**

### 2. Search for existing implementation

```sh
# Combo/phase markers in code
rg -n "Combo-0N Phase" server/ packages/ ui/

# Superpowers specs + plans already written
ls docs/superpowers/specs/*combo* docs/superpowers/plans/*combo*

# Design-declared completion
rg -n "functionally complete|exit criteria" docs/superpowers/
```

### 3. Verify on the target branch

```sh
git branch --show-current
git log master..HEAD --oneline   # commits not yet on master
git log --oneline --grep="combo-0N" -20
```

### 4. Run phase-relevant tests

```sh
pnpm test   # or narrow: cd server && pnpm exec vitest run <phase-test-file>
```

### 5. Record outcome

| Outcome | Action |
|---------|--------|
| **Complete** — exit criteria met, code on `master` | Skip; advance to next combo in build order. Update status table above. |
| **In progress** — branch exists, plan partially executed | Resume from plan checkboxes / last commit; do not restart from Phase 1. |
| **Planned only** — spec/plan exists, no code | Execute the existing plan in `docs/superpowers/plans/`. |
| **Not started** — no spec, no code | Write spec → plan → build (superpowers workflow). |

### 6. Log the start

Append a short entry below when work begins:

```
## [YYYY-MM-DD] Started — Combo NN Phase X
Branch: feat/...
Plan: docs/superpowers/plans/...
Exit criteria: (copy from phasing doc)
```

---

## Entry template

```markdown
## [YYYY-MM-DD] <Decision | Started | Completed> — Combo NN [Phase X]

**Context:** …
**Outcome:** …
**Branch / PR:** …
**Exit criteria met:** yes / no / partial — (list)
**Next:** …
```
