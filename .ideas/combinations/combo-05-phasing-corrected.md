# Combo 05 — Corrected Phase Scope

Companion to [`combo-05-review-cockpit.md`](combo-05-review-cockpit.md). That file lists five
ideas and a four-step phasing; this file is the detailed expansion — the **shared seams** the
five ideas all write through, the locked authority precedence, and per-phase exit criteria.

It exists for the same reason [`combo-01-phasing-corrected.md`](combo-01-phasing-corrected.md)
does: the original phasing schedules the *ideas* but not the *seams* they converge on. Built
naively, Phase 1 constructs the diff surface and inbox single-purpose, and Phases 2–4 (push,
digest, delegation, stakeholder page) each retrofit their own risk logic, their own delivery
channel, and their own audit — recreating the "five inconsistent approval experiences" the combo
exists to prevent.

## Governing principle

The value of fusing these five ideas is **compose-by-construction**. That only holds if Phase 1
builds five things as *extension points*, not as single-purpose code:

1. **The risk model** — one pure function `riskScore(approval, ctx) → {score, band, reasons[]}`
   over a **pluggable signal registry**. Phase 1 seeds a few signals (agent trust stage, implied
   spend, sensitive-boundary flags, changeset diff size); later phases add signals without
   touching consumers. *Consumers:* triage sort/group/auto-approve (016), what buzzes the phone
   (027), what may delegate (038). This is the combo's center of gravity — the analog of
   Combo 01's effective-cap resolver.

2. **The changeset model + diff renderer** — one per-run changeset keyed by run id, captured at
   run-finalize time and **persisted** (the worktree may be cleaned up before review), rendered by
   one component. *Consumers:* the inbox card (017/016) and the push card (027) share one payload
   and one renderer.

3. **The authority resolver** — one choke point, `canDecide(approval, actor, method) → allow|deny`,
   that every decision path funnels through, honoring a **locked precedence** (below). This is what
   stops auto-approve (016) and delegation (038) from each reimplementing authority checks and
   accidentally escalating privilege — the analog of Combo 01's admission seam.

4. **The delivery pipeline** — one channel abstraction (`inbox` seeded now; `webpush`, `email`
   register later) plus a per-user delivery-prefs seam. *Consumers:* digest (029), push (027),
   stakeholder page (033).

5. **The decision audit path** — one `recordDecision({approvalId, actor, method, outcome,
   riskSnapshot})` that writes *every* outcome — manual, auto-approved, delegated,
   coverage-escalated, external-page-view — to `activity-log.ts` (swappable for the tamper-evident
   log, idea 023, later). One record shape for all deciders.

A sixth shared substrate — **the narration engine** (029) — is built in Phase 2 and reused by the
stakeholder page (033) in Phase 4. It is not a Phase-1 seam, but it is called out here so it gets a
single owner rather than two copies.

### Locked authority precedence

Only the first writer exists in Phase 1; the rest register into the resolver in later phases
(mirrors Combo 01's cap-writer registry):

```
explicit human decision  >  delegated human  >  coverage escalation  >  bounded manager-agent  >  auto-approve policy
```

Hard rule, enforced at the resolver: **items above a configurable risk band can never be
auto-decided or agent-delegated** — they wait or escalate to a human. This rule is written in
Phase 1 (even though no auto/agent writer exists yet) so later writers cannot bypass it.

---

## Phase 1 — Legibility + triage (017 + 016)
**Target: ~2–3 weeks. Independently shippable. Builds all five seams, seeded minimally.**

Deliverables:

- **Risk model** with the signal registry, seeded with four signals (trust stage, implied spend,
  sensitive-boundary flags, changeset diff size). A persisted `approval_risk` snapshot
  (`score`, `band`, `reasons[]`, `computedAt`) so the inbox ordering is stable and the audit shows
  the score *at decision time*. Recomputable.
- **Changeset capture + diff surface (017).** A run-finalize hook computes `git diff
  <baseRef>...HEAD` + porcelain for untracked files, reusing the `runGit` helper in
  `execution-workspaces.ts`, and persists a `run_changesets` row (files with status/±lines/binary
  flag/diff ref, commands from `workspace_operations`, summary stats). `GET /runs/:id/changeset`
  read path + one React diff component. Large/binary files → metadata + download, not inline diff.
- **Authority resolver**, seeded with exactly one writer (`explicit_human`). Every existing
  approve/reject/requestRevision path routes through `canDecide`. The above-band hard rule is
  written now.
- **Delivery pipeline**, channel interface + `inbox` channel only (wraps today's
  sidebar-badge/inbox signal). Registry stubbed so 027/029 plug in without a rewrite.
- **Decision audit**, `recordDecision()` on every resolve; bulk actions emit one record per item.
- **Triage inbox (016), sort/group only.** `GET …/approvals/triage` returns risk-sorted items with
  server-computed groups by {agent, issue subtree, type}; bulk approve/reject/request-changes over
  a group loops existing per-item resolves through the resolver + audit. Keyboard-actionable UI,
  risk-band chips, group headers, diff inline per item.

**Explicitly out of Phase 1:** auto-approve policies, web push, digest, delegation, coverage,
stakeholder page, run-to-run comparison, AI change summary.

Exit criteria: an approval tied to a run shows a concrete, persisted PR-style diff that survives
workspace cleanup; the inbox is risk-sorted and groupable; a bulk action decides every item in the
group and writes one audit record each; the resolver denies every decision method other than
`explicit_human`; an above-band item cannot be decided by any non-human method (asserted by test,
even though no such method ships yet).

---

## Phase 2 — Auto-handle the tail + digest (016 auto-approve + 029)
**Depends on: Phase-1 resolver, risk model, audit path. Target: ~1–2 weeks.**

Deliverables:

- **Auto-approve policy writer**, registered as the *lowest*-precedence method in the resolver.
  Conservative, narrow, explicit rules ("work products from `trusted`+ agents under $X touching no
  secrets"), evaluated server-side, every auto-decision written to the audit path with the policy
  that fired. Blocked from ever deciding above-band items by the Phase-1 hard rule.
- **Narration engine** (built once here) + **scheduled digest (029)** on `routines.ts` — a
  low-cost first exercise of the Phase-1 delivery pipeline, led by "what needs the human."

Exit criteria: a low-risk item matching an explicit policy is auto-approved and fully audited; no
above-band item is ever auto-approved; a scheduled digest assembles from existing signals and
delivers through the inbox channel.

---

## Phase 3 — Reach the human (027)
**Depends on: Phase-1 risk model, diff renderer, delivery pipeline. Target: ~1–2 weeks.**

Deliverables:

- **Web Push / PWA** — service worker, VAPID keys, subscription management, per-user delivery
  prefs — registered as a new delivery channel in the Phase-1 pipeline.
- **Risk-gated notification** so only high-band events buzz; **deep-link** into the single-item
  card reusing the Phase-1 diff renderer with big approve / reject / request-changes actions.

Exit criteria: a high-band approval fires a push that deep-links to the inline diff and resolves in
one tap; low-band items never buzz (they wait for the digest).

---

## Phase 4 — Coverage + external (038 + 033)
**Depends on: Phase-1 resolver + audit; Phase-2 narration engine. Target: ~1–2 weeks.**

Deliverables:

- **Delegation + coverage writers** registered into the resolver: scoped, time-boxed,
  auto-reverting human-to-human delegation and SLA coverage routing first; **bounded
  manager-agent** approver last (tightest limits, double-logged, never above-band). Out-of-office
  switch. Every delegated/covered decision records who decided under whose authority.
- **Stakeholder transparency page (033)** on the narration engine + a tokenized, revocable,
  read-only path reusing the `publicShareToken` pattern; default-deny exposure; access logged to
  the audit path.

Exit criteria: an unactioned item past its SLA routes to the designated backup instead of rotting;
a delegate can decide only within scope/band/limit and every such decision names the delegation; a
stakeholder link renders only curated fields and revokes instantly.

---

## What changed vs. the original phasing

| Original | Correction | Why |
|----------|-----------|-----|
| Phase 1 = "diff surface + triage inbox" | Phase 1 also builds the **risk model, authority resolver, delivery pipeline, and audit path** as extension points | Otherwise P2–P4 each retrofit competing risk/delivery/audit logic |
| Risk score implied per-idea | **One risk model + pluggable signal registry**, seeded in P1 | It is read by 016, 027, and 038; three copies would drift |
| Auto-approve inside P1's 016 | Auto-approve **deferred to P2**, behind the resolver | Sorting/grouping is pure upside; auto-decisions need the resolver proven safe first |
| Delivery implied per-channel | **One delivery pipeline**, `inbox` in P1, `webpush`/`email` register later | 029/027/033 would otherwise build three notification stacks |
| Narration engine implied twice (029, 033) | **Built once in P2**, reused by 033 in P4 | Two summarizers would diverge |
| Delegation as one P4 item | 038 **split**: human-to-human + SLA first, **bounded agent-approver last** | The agent-as-approver tier is the most sensitive; ship it behind the proven human path |
| Changeset "diff live at review" | Changeset **captured at run-finalize and persisted** (`baseRef...HEAD`) | Worktrees are cleaned up (`cleanupReason`); live diff would 404 after cleanup |

Net effect on estimate: unchanged envelope (~4–6 engineer-weeks), honestly distributed — Phase 1
grows to absorb the four seams (it was underscoped), and the two sensitive tiers (auto-approve,
agent-as-approver) are surfaced as deliberately deferred rather than silent risk.
