# Build Decisions Log

Standing record of product-build direction for the `.ideas/` combination roadmap.
Append new entries at the top. **Before starting any combo or phase, run the
[Pre-flight verification](#pre-flight-verification) checklist.**

Source build order: [`.ideas/combinations/README.md`](../../.ideas/combinations/README.md)
(suggested build order section).

---

## [2026-07-31] Completed — Combo 02 Phase 1 (local inference billing truth)

**Branch:** `feat/combo02-phase1-local-inference-billing` (off `master` @ `07a6813`)

**Spec:** `specs/2026-07-31-combo02-phase1-local-inference-billing-design.md`

**Pre-flight corrected the status table twice, in opposite directions.**

1. "Idea 008 largely config" **understated a live bug.** The four OpenAI-compatible adapters
   (`codex_local`, `pi_local`, `opencode_local`, `cursor`) already accept a local base URL, so
   running an agent on Ollama works today — that part is true. But `inferOpenAiCompatibleBiller`
   knew exactly one non-default case (OpenRouter), so a `localhost:11434` endpoint fell through to
   the caller's fallback. Local runs were recording `biller: "openai"` with unknown cost, landing
   in `costs/by-biller` and `finance-by-biller` as **fabricated OpenAI spend**. Combo 04 (CFO
   Suite) is next in build order and reads exactly those endpoints, so this was about to become
   load-bearing.
2. Ideas 012, 049 and 041 are **genuinely not started** — zero hits on `fallbackChain`,
   `credentialPool`/`fairShare`, and `os.freemem`/`loadavg`/`nvidia-smi` respectively.

**The design rejects idea 008's literal rule.** 008 §3 says map loopback/LAN to `local` @ $0.
That is unsafe: gateways run on loopback and forward to *paid* providers — the repo already knows
this, since `openclaw_gateway` carries its own `isLoopbackHost()` (`execute.ts:173`, duplicated at
`test.ts:36`) for exactly that reason, and LiteLLM on `:4000` is the same shape. A blanket rule
would silently zero out real spend: the same corruption this phase fixes, inverted and much harder
to notice. **$0 is never inferred, only declared** — classification requires an operator opt-in
(`PAPERCLIP_LOCAL_INFERENCE`) *and* a genuinely local host. Port heuristics (11434/1234/8080)
populate a runtime hint and never grant $0; `8080` is at least as common a proxy port.

**No new `local_llm` adapter, deliberately.** In this repo an adapter is an agent *session runner*
that spawns a CLI owning tools, workspace and sessions; the `http` adapter is a webhook-poker that
reports no usage or cost. A `local_llm` adapter would have to delegate to pi/opencode and would be
a pure wrapper carrying registry, UI, docs and drift cost for no capability. A local endpoint is
made first-class as *configuration* instead. The opt-in rides the existing adapter-config `env`
map, which already flows into `effectiveEnv` in all four adapters — no signature churn.

**Shipped:**

- `packages/adapter-utils/src/local-inference.ts` — the whole decision in one total function.
- `inferOpenAiCompatibleBiller` gains a local branch **ahead of** the OpenRouter checks, so a stale
  `OPENROUTER_API_KEY` cannot mislabel a local run.
- `AdapterBillingType` and `BILLING_TYPES` gain `"local"`. **No migration** —
  `cost_events.billing_type` is plain `text` with no enum or check constraint.
- `server/src/services/run-billing-ledger.ts` — `normalizeLedgerBillingType`,
  `normalizeBilledCostCents` and `resolveLedgerBiller` extracted out of the 10k-line
  `heartbeat.ts` so the ledger boundary is testable in isolation.
- All four adapters apply the override, plus `provider: "local"`.
- `docs/guides/local-inference.md`.

**Two things the type system caught that the design had not listed:** `normalizeLedgerBillingType`
has a `default: "unknown"` arm, so without an explicit `case "local"` the entire phase would have
silently reverted at the ledger boundary; and `ui/src/lib/utils.ts` holds a
`Record<BillingType, string>` label map plus a `coerceBillingType` allow-list and a
`visibleRunCostUsd` zeroing rule, all three of which needed the new type.

**Exit criteria met:** yes. The three pre-existing `billing.test.ts` cases pass **unmodified** —
that is the regression proof, since local classification only fires on explicit opt-in.

**Test note:** `local-inference-adapter-coverage.test.ts` asserts that every adapter calling
`inferOpenAiCompatibleBiller` also calls `localBillingOverride`. It is a source scan, chosen
deliberately: the regression it guards is an *omission* in a fifth adapter added later, which no
typecheck and no unit test can see.

**Not built this phase:** UI presets (Ollama/LM Studio/llama.cpp) writing both variables together,
and an endpoint reachability + model-list probe. Both are UX across four separate
`config-fields.tsx` files; the correctness fix should not wait behind them. Idea 008 §4 and §5
remain open.

**Correction to the combo 03 log below:** that entry says combo 02 will unblock its Phase 3
semantic tier by providing an inference API. **It will not.** A prompt-completion contract is
orthogonal to all four of combo 02's ideas (008/012/049/041), and none of phases 1–4 produces one.
Combo 03's model tier is still blocked — on a general inference contract that no combo currently
owns, not on combo 02.

**Next:** combo 02 Phase 2 (quota-aware provider fallback chains), which needs Phase 1's free
last-resort tier to be worth having.

---

## [2026-07-31] Completed — Combo 03 Phases 2 & 3 (detectors, heatmap, semantic seam)

**Branch:** `feat/combo03-phase2-detectors` (off `feat/combo03-phase1-run-signals`)

**Phase 2 — deterministic detectors + heatmap. Complete.**

| Idea | Delivered |
|------|-----------|
| 010 | `health-sentinel/deadlock.ts` — iterative Tarjan SCC over the `issue_relations` blocks graph + cancelled-blocker dead ends |
| 026 | `health-sentinel/goal-drift.ts` — parent-chain walk to a live goal; orphan work and empty company/team goals |
| 059 | `health-sentinel/decomposition.ts` — accepted plans that under-delivered children |
| 044 | `health-sentinel/reliability.ts` + `run-signals/agent-signals.ts` — rolling failure rate vs an error budget |
| 006 | `health-sentinel/heat.ts` + `ui/src/lib/org-heat.ts` + `OrgChart.tsx` overlay |
| — | `GET /api/companies/:companyId/health-sentinel`, registered in `app.ts`, `routes/index.ts`, `openapi.ts` **and** the `apiPrefixes` map |

Design decisions worth keeping:

- **Detectors are pure functions over plain graphs**, with a thin DB loader. They unit-test without
  a database, which is why the deadlock detector could be tested against a 20,000-node graph.
- **Tarjan is iterative, not recursive.** A stack overflow inside a health check would take out the
  thing meant to report problems.
- **Dead ends report only the direct victim.** Every transitive chain has one, so nothing is lost,
  and one fix produces one finding instead of one per affected issue.
- **`remediation` is a required field** on every finding. A detector that can only say "something is
  wrong here" is not actionable enough to escalate.
- **Heat keeps blocked and drift as separate channels.** A jammed agent and an adrift agent are
  opposite problems with opposite fixes; one summed score renders them identically.
- The end-to-end service tests caught a bug the pure tests could not: `getAgentRunSignals` bound a
  `Date` into a raw SQL comparison, which the driver rejects.

**Phase 3 — semantic tier. Seam shipped; model tier BLOCKED on combo 02.**

The combo asks for semantic tiers "on a free local model behind confidence thresholds". **There is
no inference API in this codebase.** `ServerAdapterModule.execute` (`packages/adapter-utils/src/types.ts`)
runs a whole agent session — spawns a CLI, manages a workspace, sessions, streaming — not a prompt
completion. Nothing else offers one; `routes/llms.ts` is `llms.txt`-style documentation, not
inference. A general inference contract across adapters is **combo 02's** job (Model Economy Fabric,
build-order rank 5, currently "Partial").

Precedent followed: Combo 05 hit the identical wall and solved it in `digest-narration.ts` by
injecting a narrator interface with a deterministic default. So `health-sentinel/semantic.ts` ships
the **seam** — `SemanticJudge`, confidence thresholds, `HealthSentinelOptions.semanticJudge` — with a
deterministic Jaccard-over-titles default. A model-backed judge drops in with no caller change.

What the deterministic judge honestly cannot do: it catches "Add login form" vs "Add the login form",
not "Add login form" vs "Build authentication UI". A test documents that limit rather than hiding it.
The 026 semantic drift tier is **not** built — unlike overlap, it has no useful deterministic
approximation, and shipping a keyword heuristic as "drift detection" would be worse than shipping
nothing.

**Exit criteria:** Phase 2 met in full. Phase 3 met structurally; the model tier is deferred to
combo 02 with the integration point built and tested.

**Next:** combo 02 (inference contract) unblocks the 026/059 model tiers. Combo 10 Phase 1 is
designed and awaiting its spec.

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
- Full server suite: **3577 passed, 1 skipped, 2 failed** (432 files). Both failures are in
  `paperclip-skill-utils.test.ts` and are **pre-existing on `master`** — verified by checking out
  `58eacd1` and reproducing them with the identical invocation. They are cwd-sensitive: the test
  does `path.resolve("skills/paperclip/SKILL.md")`, which resolves against `server/` when vitest is
  run from that directory instead of the repo root. Nothing on this branch touches the files it
  reads. Worth fixing separately — a test that only passes from one cwd is a latent CI trap.

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
| **03** Health Sentinel | 9 | 3 | **Complete** (phase 3 model tier blocked — *not* on combo 02; see 2026-07-31 combo 02 entry) | Pre-flight run 2026-07-31. **"Not started" was wrong**: idea 003 was already fully built (`productivity-review.ts`). Phase 1 redefined away from OTel spans → `run-signals/`; phase 2 detectors + heatmap → `health-sentinel/`; phase 3 semantic **seam** shipped, model tier blocked on combo 02 (no inference API exists). See log entries. |
| **10** Day-One Adoption | 8 | 4 | Queued after Combo 03 | Pre-flight run 2026-07-31; **not uniformly greenfield** (see log entry). Phase 1 (Dry-Run Estimator static checks) designed, spec not yet written. |
| **04** CFO Suite | 8 | 5 | Partial / scattered | Ideas 013/019/030 have some substrate (`costs.ts`, budgets) but combo not built as unified feature. |
| **02** Model Economy | 8 | 5 | **Phase 1 complete** (of 4) | Pre-flight found idea 008 half-built *and* actively corrupting cost data: local runs billed as OpenAI. Phase 1 shipped local billing truth (`local-inference.ts`, `run-billing-ledger.ts`, `BILLING_TYPES += "local"`). No `local_llm` adapter — a local endpoint is first-class *config*, not a wrapper adapter. Phases 2–4 (fallback chains, credential fair-share, host resource probe) verified not started. **Does not and will not provide an inference API** — see log entry. |
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
