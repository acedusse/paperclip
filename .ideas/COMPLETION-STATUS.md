# Idea Completion Status

Point-in-time audit of the `.ideas/` backlog against the actual Paperclip codebase.

- **Audited:** 2026-07-11
- **Branch:** `fix/ci-review-verify`
- **Method:** Each idea was cross-checked against `server/src/`, `packages/db/`, `packages/shared/`, `ui/`, `cli/`, and `docs/` for the specific services, tables, settings, endpoints, and UI it proposes. A similarly-named file was not treated as proof — the code was opened and confirmed to do what the idea describes.
- **Update 2026-07-13:** All eight Combo-01 members re-audited against the current checkout (master + slice-3 PR #20), each by opening the code (not name-matching). Re-scored from ⬜ NOT STARTED: **002, 005, 014, 024, 061, 042** → ✅ DONE; **035** → 🟡 PARTIAL (idle-backoff shipped; speed-up-under-load deferred). 001 was already DONE. Combo-01 is now 7/8 DONE + 035 PARTIAL. Only Combo-01 members were re-verified this pass; the other 58 ideas retain their 2026-07-11 scores. Per-member gaps are noted inline (e.g. 005 has no burn-ceiling, 024 no tool-call/token caps).

## Legend

- ✅ **DONE** — substantially implemented (core seam + plumbing + surface present)
- 🟡 **PARTIAL** — some pieces exist, but the idea's defining feature is missing
- ⬜ **NOT STARTED** — no meaningful implementation; only the pre-existing substrate the idea proposed to extend

## Summary

| Status | Count | Ideas |
|--------|-------|-------|
| ✅ DONE | 7 | 001, 002, 005, 014, 024, 042, 061 |
| 🟡 PARTIAL | 6 | 021, 022, 030, 035, 039, 065 |
| ⬜ NOT STARTED | 53 | all others |

**Net (as of the 2026-07-13 update):** seven ideas are built to DONE — the entire Combo-01 runtime control plane except one: Fleet Concurrency Governor (001), Predictive Budget Circuit Breaker (002), Spend-Schedule/Quiet Hours (005), Emergency Stop & Drain (014), Per-Run Resource Caps (024), WIP Limits & Flow Control (061), and Workspace Conflict Coordination (042, all three 4B slices). Six ideas have real but incomplete substrate (035 among them — idle-backoff only). The remaining 53 are unbuilt per the 2026-07-11 audit (many name pre-existing primitives they would extend); only Combo-01 was re-audited on 2026-07-13.

## Individual ideas (001–066)

| # | Idea | Status | Evidence |
|---|------|--------|----------|
| 001 | Fleet Concurrency Governor | ✅ DONE | `companies.max_concurrent_runs` col, `instance-settings.maxConcurrentRuns`, `effective-cap-resolver.ts`, `instance-admission-lock.ts`, `admission-reconciler.ts` (crash-safe recompute), `heartbeat.ts` gates claims under `withInstanceAdmissionLock`, `/admission-status` routes + OpenAPI, UI `AdmissionStatusLine` + `CompanySettings`. Full acquire/gate/reconcile/UI loop. |
| 002 | Predictive Budget Circuit Breaker | ✅ DONE | `predictive-breaker.ts` computes `computeTimeToLimit` + a 4-rung `normal→warn→throttle→halt` ladder with min-dwell/up-gap hysteresis; `predictiveBreakerWriter` registered in `PHASE3B_COMPANY_WRITERS` (2nd precedence, below panic/drain) and consumed by `heartbeat.ts` admission — throttle halves the cap, halt zeroes it and `windDownRun(reason:"predictive-breaker-halt")`. Burn from `cost_events` 15-min window vs most-urgent remaining budget; state in `company_breaker_state` (0111 migration); `companies.predictiveBreakerEnabled`/`breakerHorizonMinutes` config; breaker badge in `AdmissionStatusLine`; `admission.breaker_transition` audit. Tests: `predictive-breaker.test.ts` + integration. Gap: halt winds down ALL runs (no protected-role allowlist). |
| 003 | Diminishing-Returns Detector | ⬜ NOT STARTED | No stall/no-progress fingerprinting; `recovery/` classifiers don't implement a per-issue unproductive-run rule. |
| 004 | Company Dry-Run Estimator | ⬜ NOT STARTED | No preflight/`planOnly`/`dryRun` product surface; validation stays piecemeal in `companies.ts`/`agents.ts`. |
| 005 | Spend-Schedule / Quiet Hours | ✅ DONE | `scheduleWriter` at the `schedule` precedence slot (below manual-override, above default) in `PHASE3B_COMPANY_WRITERS`; `companies.scheduleWindows`/`scheduleTimezone`/`manualCapOverride(ExpiresAt)` columns; `schedule-cap.ts` `activeScheduleCap`/`nextScheduleTransition` with DST-correct `zoned-time.ts`, most-restrictive-wins; fed into `resolveEffectiveCap` at company+instance sites in `heartbeat.ts`; four presets + window editor + Boost/Quiet-now overrides in `CompanySettings.tsx`; `scheduleNextTransition` in `AdmissionStatusLine`. Gap: only `maxConcurrentRuns` is time-windowed — the idea's `maxBurnPerHour` spend-ceiling dimension was never built. |
| 006 | Org Bottleneck Heatmap | ⬜ NOT STARTED | `org-chart-svg.ts` renders a plain chart; no pressure/queue-depth/critical-path overlay. |
| 007 | Holding Company (Meta-Orchestration) | ⬜ NOT STARTED | No `parentCompanyId`/company-group/portfolio-oversight; company schema stays flat. |
| 008 | First-Class Local LLM Adapter | ⬜ NOT STARTED | No `local_llm`/ollama/llama.cpp adapter; no $0 loopback billing rule. |
| 009 | Agent Probation & Trust Ramp | ⬜ NOT STARTED | No `trustStage`/probation/graduation; `trust-preset-resolver.ts` stays static presets. |
| 010 | Blocker-Graph Deadlock Detector | ⬜ NOT STARTED | No cycle/SCC detection; blockers handled as linear summaries only. |
| 011 | Eval-Gated Agent Config Deploys | ⬜ NOT STARTED | `evals/promptfoo/` is a dev tool, not wired to agent-config editing; no diff-triggered eval gate. |
| 012 | Quota-Aware Provider Fallback Chains | ⬜ NOT STARTED | Only agent-level `ordered_invokable_fallback` + same-provider retry; no cross-provider failover on 429. |
| 013 | Unit-Economics Dashboard | ⬜ NOT STARTED | Spend tracked but never divided by delivered outcomes; no cost-per-outcome/rework/idle-spend metrics. |
| 014 | Emergency Stop & Drain Mode | ✅ DONE | Tri-state `runExecutionState` (`companies` col + instance setting); `resolveEffectiveExecutionState`/`isQuiescing` (`run-execution-state.ts`) + `panicDrainWriter` at top of `CAP_WRITER_PRECEDENCE` force cap→0 at the claim loop; `claimQueuedRun`'s `isScopeQuiescing` holds (not cancels) queued runs while draining. Panic = `setCompany/InstanceRunExecutionState`→`panicStopRuns`→`windDownRun(mode:hard, resume:when-allowed)`; crash-safe `makePanicHaltSweepSource`; gradual resume via `reenqueueWoundDownOrphan` through the normal cap-governed loop. Board-only `POST /companies/:id/execution-state` + `/instance/execution-state`; Drain/Panic/Resume UI + `AdmissionStatusLine` on both settings pages; `panic-drain.integration.test.ts`. Note: the breaker's auto-halt zeroes the cap directly rather than flipping `runExecutionState=draining` (parallel auto-trigger). |
| 015 | Company Point-in-Time Rewind | ⬜ NOT STARTED | Only instance-wide DB backups + portability export; no per-company timestamped snapshot/restore. |
| 016 | Approval Triage & Policy Batching | ⬜ NOT STARTED | No risk score / grouping / auto-approve policy engine in `approvals.ts`/`issue-approvals.ts`. |
| 017 | Run Change-Review Surface | ⬜ NOT STARTED | `workspace-operation-log-store.ts` is a raw op log; no diff/changeset PR-style surface. |
| 018 | Company Blueprint Library | ⬜ NOT STARTED | No parameterized template/variable-substitution/instantiation wizard over `company-portability.ts`. |
| 019 | Token Budgets for Subscription Users | ⬜ NOT STARTED | `budgets.ts` still `if (policy.metric !== "billed_cents") return 0`; `BUDGET_METRICS=["billed_cents"]`, no token metric. |
| 020 | Outbound Secret-Leak Scanning | ⬜ NOT STARTED | Redaction only covers Paperclip's own logs (inbound); no scan of agent-generated persisted content. |
| 021 | Just-in-Time Secret Leasing | 🟡 PARTIAL | Per-acquisition audit built (`secret_access_events` + `recordAccessEvent`), but no `secret_leases` table / TTL / auto-expire / run-scoped materialization. |
| 022 | Per-Agent Network Egress Allowlist | 🟡 PARTIAL | Real allowlist enforced only in the k8s sandbox (`allowFqdns` → CiliumNetworkPolicy); no trust-tier defaults, learning mode, blocked-attempt logging, or local-runtime coverage. |
| 023 | Tamper-Evident Audit Log | ⬜ NOT STARTED | `activity_log` has no `prevHash`/`entryHash` columns; no hash-chain verifier. |
| 024 | Per-Run Resource Caps | ✅ DONE | `maxRunWallClockMs`/`maxRunCostCents`/`maxRunTurns` stamped on `heartbeat_runs` at claim; cost enforced reactively (every `cost_event`) + via sweep, wall-clock via the periodic sweep (`isWallClockExceeded`, `run-caps.ts`), terminating through the graceful `windDownRun` continuation-capturing primitive; crash-safe reconciler source registered in `index.ts`. Turns are audit + adapter-CLI-delegated (`--max-turns` for `claude_local`/`grok_local`). Gaps: `maxToolCalls`/token caps intentionally not built (idea deprioritized them); cap trips log a run-event but no dedicated operator/inbox escalation or "run stopped due to cap" UI. |
| 025 | Capability-Based Auto-Assignment | ⬜ NOT STARTED | `agent-assignability.ts` is pure eligibility; no scoring/ranking/suggested-assignee. |
| 026 | Goal-Drift Alignment Auditor | ⬜ NOT STARTED | No drift/orphaned-work/alignment routine walking the parent chain. |
| 027 | Mobile Push & Fast Approvals | ⬜ NOT STARTED | No service worker / Web Push / VAPID / push-subscription; no mobile approval card. |
| 028 | Agent Shift-Handoff Briefings | ⬜ NOT STARTED | Only same-agent `issue-continuation-summary.ts`; no new-owner briefing on reassignment. |
| 029 | Scheduled Operator Digest | ⬜ NOT STARTED | No standup/operator-digest assembler or scheduled summary routine. |
| 030 | Revenue & P&L Tracking | 🟡 PARTIAL | `finance_events` has debit/credit + net computation + manual entry endpoint/UI, but credit side models billing credits/refunds, not business revenue — no MRR/ARR, margin, burn multiple, or revenue input paths. |
| 031 | Agent-Run Distributed Tracing | ⬜ NOT STARTED | Only infra-level OTel (HTTP/Express/PG); no semantic run/tool-call/handoff spans. |
| 032 | A/B Model Bake-Off Harness | ⬜ NOT STARTED | Ingredients present (adapters, promptfoo, cost data) but no bake-off orchestration/reporting layer. |
| 033 | Stakeholder Transparency Page | ⬜ NOT STARTED | `publicShareToken` exists only on `company_skills`; no company-level read-only transparency page. |
| 034 | Data Retention & PII Governance | ⬜ NOT STARTED | Only backup/log retention; no company data-class TTLs, PII detection, or right-to-erasure. |
| 035 | Adaptive Heartbeat Cadence | 🟡 PARTIAL | Idle-backoff fully built: `agents.heartbeat_idle_streak` col (0113 migration), `runtimeConfig.heartbeat.idleBackoff` config (opt-in), pure `heartbeat-cadence.ts` (`effectiveIntervalSec` geometric growth capped at `maxIntervalSec`; `nextIdleStreak` increments on timer-sourced non-productive runs, resets on any productive/event wake), wired into `tickTimers`/`applyIdleStreakUpdate`, `AgentCadenceReadout` UI, tests; event-driven wakeup keeps instant reachability. Missing the idea's other half: speed-up-under-load is explicitly deferred (no queue-depth-driven shortening), and hysteresis is deliberately replaced by asymmetric monotone-growth/instant-snap-down. |
| 036 | Outbound Webhooks & Event Subscriptions | ⬜ NOT STARTED | `plugin_webhooks` is inbound-to-plugins; no per-company outbound HMAC-signed delivery worker. |
| 037 | Prompt-Cache-Aware Context Optimization | ⬜ NOT STARTED | `cachedInputTokens` measured (pre-existing), but no cache-hit metric or stable-prefix assembly. |
| 038 | Approval Delegation & Coverage | ⬜ NOT STARTED | No delegation/coverage-routing/backup-approver/out-of-office constructs. |
| 039 | Guided Onboarding & Demo Company | 🟡 PARTIAL | Onboarding wizard ships (`onboarding-launch.ts`, `onboarding-assets/`, e2e test) scaffolding goal+project+starter issue, but no runnable demo company, concept tour, or sandbox mode. |
| 040 | Operator-Owned Training Dataset | ⬜ NOT STARTED | Run logs are opaque blobs; no structured prompt/response records, outcome labels, or export. |
| 041 | Host Resource-Aware Local Scheduling | ⬜ NOT STARTED | `environment-probe.ts` only reports hostname; no CPU/mem/GPU sampling or capacity-based admission. |
| 042 | Workspace Conflict Coordination | ✅ DONE | Track 4B, three slices. Slice 1 (merged): `workspace-conflict.ts` `detectConcurrentSharedActivity` + run-start audit `workspace_concurrent_activity_detected`. Slice 2 (merged, PR #19): `workspace_path_claims` table, `workspace-path-claims.ts` acquire/release/list/expire, TTL-expiry reconciler source, agent-JWT acquire/release routes with overlap audit, run-end release. Slice 3 (PR #20): pure `decideClaimScheduling`, batched `activeClaimCountsForWorkspaces`, instance flag `workspaceClaimAwareScheduling` (default off), claim-aware defer wired into `startNextQueuedRunForAgent`/`claimUpTo` (composes with WIP, fault-isolated, bounded defer). |
| 043 | Policy-as-Code Governance Engine | ⬜ NOT STARTED | Governance stays siloed; no unified when→then rule store or central decision seam. |
| 044 | Agent Reliability SLOs & Error Budgets | ⬜ NOT STARTED | Recovery/liveness exists but no success-rate metric, SLO threshold, or graduated auto-constrain. |
| 045 | Plugin Versioning, Rollback & Health | ⬜ NOT STARTED | Single `version` stored; no history/pinning/staged-upgrade/health-gate/auto-rollback. |
| 046 | Skill Effectiveness Analytics | ⬜ NOT STARTED | Static `recommendedForRoles` + install tracking only; no outcome-join/scorecard. |
| 047 | Role-Based Skill Auto-Provisioning | ⬜ NOT STARTED | `hire-hook.ts` has no role→skill bundle model, reconciler, or auto-install on hire. |
| 048 | Competency-Gated Job Postings | ⬜ NOT STARTED | No posting/vacancy/candidate/acceptance-test object or test-to-hire state machine. |
| 049 | Shared-Credential Fair-Share Rate Limiting | ⬜ NOT STARTED | No credential pool, token-bucket, or fair-share/weighted queue. |
| 050 | Work-Product Security Scanning | ⬜ NOT STARTED | No CVE/OSV/dependency/SAST scanning at the review gate. |
| 051 | DR: Backup Verification & Restore Drills | ⬜ NOT STARTED | Create + low-level restore exist; no checksum/manifest, restore-drill routine, or RPO/RTO. |
| 052 | Org Restructuring Simulator | ⬜ NOT STARTED | No draft-org model, impact-diff, or simulator. |
| 053 | Inter-Company Shared Services | ⬜ NOT STARTED | Cross-company access still hard-denied; no published-service model/bridge/chargeback. |
| 054 | Company Mailbox | ⬜ NOT STARTED | No inter-company inbox/outbox, message envelope, or ticket state machine. |
| 055 | Estimate-vs-Actual Calibration | ⬜ NOT STARTED | No issue estimate field; actuals captured but no calibration/forecast-accuracy layer. |
| 056 | Business Experiment Framework | ⬜ NOT STARTED | No experiment/hypothesis/variants/metric/decision loop. |
| 057 | Incident Management & On-Call | ⬜ NOT STARTED | Only narrow `budget_incidents` (open/dismissed); no severity/responder/on-call/runbook/postmortem. |
| 058 | Work Templates & Definition-of-Done | ⬜ NOT STARTED | Issues are free-form; no per-type template, acceptance-criteria, or DoD gate. |
| 059 | Goal Decomposition Quality Assistant | ⬜ NOT STARTED | Decomposition mechanics tracked, but no quality analyzer/completeness check/score. |
| 060 | Knowledge System | ⬜ NOT STARTED | `plugin-llm-wiki` exists only as a plugin (the baseline); no core promotion, org/canonical scope, or semantic search. |
| 061 | WIP Limits & Flow Control | ✅ DONE | `wipLimitSchema` under `runtimeConfig.heartbeat.wipLimit` (opt-in, default maxInProgress 3); `wip-flow.ts` (`parseWipLimitConfig`, `wipStatus`, `isNewStartIssueStatus` gating todo/backlog/blocked, `newStartBudget`, `computeFlowMetrics` 7d throughput + median cycle). `heartbeat.ts` `startNextQueuedRunForAgent`/`claimUpTo` leaves new-start runs queued once `newStartsClaimed >= wipBudget` while continuations proceed — real pull-gating — with `auditWipDeferral` + fail-open. `buildAgentWipFlow` on agent read/list routes; `AgentWipReadout` (WIP current/limit + throughput + cycle) + `AgentConfigForm` toggle/field + `Agents` page. Gap: team/stage limits + start/finish-ratio alarms not built (per-agent only). |
| 062 | Inbound Intake Channels | ⬜ NOT STARTED | No email-to-issue, intake webhook, or public form endpoint. |
| 063 | Cost & Capacity Forecasting | ⬜ NOT STARTED | Historical cost events exist but no forward projection/runway/attainment. |
| 064 | Data Import / Migration | ⬜ NOT STARTED | Only imports Paperclip's own format; no Jira/Linear/Asana/CSV importers or mapping wizard. |
| 065 | Software-Building & Self-Hosting | 🟡 PARTIAL | Git-backed workspaces, workspace-diff plugin, work-products, eval harness, devon/pm-tdd skills exist, but not welded into a first-class build/test/CI-review loop; no self-hosting kernel. |
| 066 | Chat Channel (Telegram/WhatsApp) | ⬜ NOT STARTED | Zero telegram/whatsapp references; no chat-channel plugin, identity binding, or inline approvals. |

## Combinations rollup (`combinations/`)

Each combination is a bundle of individual ideas, so its status rolls up from its members. None is fully complete, but as of the 2026-07-13 re-audit Combo 01 is near-complete — 7 of its 8 members are DONE and only 035 is partial. The other combos are as originally audited.

| Combo | Merges | Status | Note |
|-------|--------|--------|------|
| 01 Unified Runtime Control Plane | 001, 002, 005, 014, 024, 035, 061, 042 | 🟡 PARTIAL (near-complete) | 2026-07-13 re-audit: 7/8 members DONE — 001 admission, 002 breaker, 005 quiet-hours/schedule caps, 014 panic/drain, 024 per-run wall-clock+cost caps, 061 WIP pull-gate, 042 workspace conflict coordination (all 3 slices). Only 035 adaptive heartbeat is 🟡 PARTIAL (idle-backoff shipped, speed-up-under-load deferred). The shared cap-plane seam — `effective-cap-resolver` precedence stack + `admission-reconciler` + the pluggable `claimUpTo`/`selectNextRun` hook — is fully realized. |
| 02 Mixed-Economy Model & Provider Fabric | 008, 012, 049, 041 | ⬜ NOT STARTED | All members not started. |
| 03 Autonomous Company Health Sentinel | 003, 010, 026, 059, 044, 006, 031 | ⬜ NOT STARTED | All members not started. |
| 04 Autonomous CFO Suite | 013, 019, 030, 037, 055, 063 | ⬜ NOT STARTED | Only 030 partial (billing-credit ledger); no CFO surface. |
| 05 Operator Review & Approval Cockpit | 016, 017, 027, 029, 038, (033) | ⬜ NOT STARTED | All members not started. |
| 06 Agent CI/CD & Evidence-Based Quality | 011, 032, 040, 046 | ⬜ NOT STARTED | All members not started. |
| 07 Self-Staffing & Self-Organizing Workforce | 048, 047, 025, 009, 052 | ⬜ NOT STARTED | All members not started. |
| 08 Zero-Trust Security, Governance & Compliance | 043, 020, 021, 022, 023, 034, 050 | ⬜ NOT STARTED | Only 021 & 022 partial (audit events; k8s egress); core governance not built. |
| 09 Resilience, DR & Incident Response | 015, 051, 057, 045, (014) | ⬜ NOT STARTED | All members not started. |
| 10 Day-One Adoption Kit | 039, 018, 004, 064, 058 | ⬜ NOT STARTED | Only 039 partial (onboarding wizard); no demo/blueprint/import/DoD. |
| 11 Institutional Memory & Continuous Learning | 060, 028, 056, (055, 057) | ⬜ NOT STARTED | All members not started. |
| 12 Two-Way External Integration Fabric | 062, 036, (030) | ⬜ NOT STARTED | Primary members not started. |
| 13 Governed Cross-Company Fabric | 054, 007, 053, (033) | ⬜ NOT STARTED | All members not started. |

`combo-01-phasing-corrected.md` is a planning refinement of Combo 01, not a separate feature.

## Cross-cutting combinations rollup (`combinations/cross-cutting/`)

The `xcombo-*` files are novel syntheses that recombine ideas across the thematic combos. None is implemented — each still depends on multiple not-started ideas. As of the 2026-07-13 re-audit, the Combo-01 admission/runtime primitives they draw on (001, 002, 005, 014, 024, 061; 035 partial) are now built, but every xcombo also depends on unbuilt non-Combo-01 ideas, so none is complete. Member statuses cited in the rows below were current at the 2026-07-11 audit except where a Combo-01 member is involved.

| xcombo | Status | Note |
|--------|--------|------|
| 01 The Autonomy Dial | ⬜ NOT STARTED | Composes admission (001 ✅) + breaker (002 ✅) + trust ramp (009) + auto-approve (016) + heartbeat (035 🟡); the Combo-01 inputs are built, but trust ramp (009) and auto-approve (016) remain unbuilt, so the dial as a whole is not. |
| 02 Closed-Loop Self-Improving Company | ⬜ NOT STARTED | Depends on 040/055/046/011/032/056/060 — all not started. |
| 03 Cost-Attribution Spine | ⬜ NOT STARTED | Depends on 031/013/037/019/053 — all not started. |
| 04 Trust as Universal Currency | ⬜ NOT STARTED | Depends on 009/016/021/022/024/025; only 021/022 partial. |
| 05 The Night-Shift Operator | ⬜ NOT STARTED | Depends on 005/002/024/008/012/035/022/038/057/029/021 — none built. |
| 06 Provenance & Replay | ⬜ NOT STARTED | Depends on 023/015 + planOnly replay — not built. |
| 07 The Self-Healing Org | ⬜ NOT STARTED | Depends on 044/009/025/048/052/057 — all not started. |
| 08 Capital Allocator | ⬜ NOT STARTED | Depends on 030/013/063/007 — only 030 partial. |
| 09 The Front Desk | ⬜ NOT STARTED | Depends on 062/016/025/058/036 — all not started. |
| 10 Pre-Flight Everything | ⬜ NOT STARTED | Depends on the 004 `simulate()` seam — not built. |
| 11 Bootstrap Ladder | ⬜ NOT STARTED | Depends on 065/011 + curriculum — 065 partial only. |
| Code-Knowledge Flywheel | ⬜ NOT STARTED | Depends on 060/065 — 060 not started, 065 partial. |

Backlog xcombos (12–15 in `_log.md`) are drafts of further syntheses; none implemented.

## Notes on borderline calls

- **001** varies slightly from its spec (runs stay in ordinary `queued` and are re-gated each tick rather than a distinct `queued_admission` state), but cap enforcement, the crash-safe reconciler, routes, and UI are all present — counted DONE.
- **021** could read as NOT STARTED if judged strictly on the leasing mechanism (TTL/auto-expiry); scored PARTIAL because the audit-trail component is fully built and secrets resolve fresh per-run.
- **022** is PARTIAL rather than DONE because enforcement covers exactly one runtime (k8s sandbox) and none of the cross-cutting pieces (trust-tier defaults, learning mode, observability, local runtime) exist.
- **030**, **039**, **065** each have genuine substrate but are missing the idea's defining feature (business revenue model / demo company + tour / welded build-and-self-host loop respectively).
- **005** is counted DONE on the strength of the quiet-hours/time-window concurrency seam (presets, DST, precedence, UI); it could read PARTIAL if the missing `maxBurnPerHour` spend-ceiling dimension is treated as co-defining rather than a second knob (2026-07-13 re-audit).
- **035** is PARTIAL rather than DONE because only the idle-backoff half of "adaptive cadence" shipped; speed-up-under-load is deferred and hysteresis was deliberately swapped for asymmetric snap-down. The companion design doc scopes this intentionally, but relative to idea 035's full text it is incomplete (2026-07-13 re-audit).
