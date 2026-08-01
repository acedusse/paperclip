# Combo 02 Phase 1 — Local Inference Billing Truth

**Date:** 2026-07-31
**Combo:** 02 — Mixed-Economy Model & Provider Fabric
**Phase:** 1 of 4 (idea 008, reinterpreted after pre-flight)
**Status:** implemented — see `BUILD-DECISIONS.md` entry for the outcome record

---

## Pre-flight findings (what is actually in the repo)

The status table in `BUILD-DECISIONS.md` rates combo 02 "Partial — idea 008 largely config".
Verification refines that materially.

| Idea | Claimed | Verified |
|------|---------|----------|
| 008 local LLM | "largely config" | **Half true, and the untrue half is a live data-corruption bug.** See below. |
| 012 fallback chains | — | Not built. Zero hits on `fallbackChain`. Seams exist: `AdapterExecutionResult.errorFamily: "transient_upstream"`, `retryNotBefore`, `server/src/services/recovery/`. |
| 049 credential pooling | — | Not built. Zero hits on `credentialPool` / `fairShare`. |
| 041 host resource probe | — | Not built. Zero hits on `os.freemem` / `loadavg` / `nvidia-smi`. Matches the combo doc's "the one piece the repo entirely lacks". |

### The bug idea 008 actually describes

`pi_local`, `opencode_local`, `codex_local` and `cursor_local` all spawn CLIs that speak the
OpenAI-compatible wire protocol, and each reads `OPENAI_BASE_URL` from its agent's adapter-config
`env` map. So **pointing an agent at Ollama already works today** — that is the "largely config"
part, and it is true.

What does not work is the accounting. `inferOpenAiCompatibleBiller`
(`packages/adapter-utils/src/billing.ts:20`) knows exactly one non-default case, OpenRouter.
A `http://localhost:11434/v1` base URL falls through to the caller's fallback. Concretely, an
agent running entirely on a local GPU records:

```
biller: "openai"      # wrong — no money reached OpenAI
costUsd: null         # codex-local:956 always reports null
billingType: "unknown"
```

Those rows are what `GET /companies/:id/costs/by-biller` and `finance-by-biller`
(`server/src/routes/costs.ts:248,266`) group over. So local runs today are reported as OpenAI spend
of unknown size. **Combo 04 (CFO Suite) is next in build order and is built directly on those
endpoints**, so shipping it first would build a finance product on corrupt input.

Phase 1's deliverable is therefore *billing truth for local inference*, not a new adapter.

## Scope

### In scope

1. An endpoint classifier in `adapter-utils` — one place that answers "is this run local inference?"
2. Billing wiring: `biller: "local"`, `billingType: "local"`, `costUsd: 0`, **token counts preserved**.
3. Ledger plumbing so `"local"` survives `normalizeLedgerBillingType` instead of degrading to `"unknown"`.
4. All four OpenAI-compatible adapters honour the classification.

### Out of scope (deliberate, with reasons)

- **No new `local_llm` builtin adapter.** Idea 008 asks for one, but in this repo an adapter is an
  *agent session runner* — it spawns a CLI that owns tools, workspace and sessions. The `http`
  adapter (`server/src/adapters/http/execute.ts`) is a webhook-poker that reports no usage and no
  cost, so it is not a template either. A `local_llm` adapter would have to delegate to pi/opencode
  and would be a wrapper carrying registry, UI, docs, openapi-test and drift cost for no capability.
  A local endpoint is made first-class as *configuration* instead.
- **Phases 2–4** (fallback chains, credential fair-share, host resource probe) are separate specs.
- **No inference / prompt-completion API.** `BUILD-DECISIONS.md` records that combo 03's Phase 3
  semantic tier is "blocked on combo 02". That is a misattribution: a prompt-completion contract is
  orthogonal to all four of combo 02's ideas, and none of phases 1–4 produces one. Combo 03's model
  tier stays blocked, on a different thing than the log claims. This spec corrects that entry.

## Design

### The central correctness rule

The naive reading of idea 008 — "loopback/LAN ⇒ `local` ⇒ $0" — is **unsafe**. Gateways and proxies
routinely run on loopback and forward to paid providers. The repo already knows this:
`openclaw_gateway` carries its own `isLoopbackHost()` (`execute.ts:173`, duplicated at `test.ts:36`)
precisely because it is normally reached at `localhost`. LiteLLM on `:4000` is the same shape.
A blanket rule would silently zero out real spend — the same class of corruption this phase exists
to fix, in the opposite direction, and harder to notice.

> **Rule: $0 is never inferred. It is only ever declared.**

Classification is local **iff both** hold:

1. The operator opted in — `PAPERCLIP_LOCAL_INFERENCE` is truthy in the effective env, **and**
2. the resolved base-URL host is genuinely local (loopback / `.local` / RFC1918 / link-local / IPv6 ULA).

Requiring (2) as well as (1) means a stale opt-in flag pointed at `api.openai.com` does not grant
$0 either. Both directions of misconfiguration fail closed to "bill as before".

Port heuristics (Ollama `11434`, LM Studio `1234`, llama.cpp `8080`) **never grant $0**. They only
populate a `runtime` hint used to pre-select a UI preset and to phrase probe warnings. `8080` in
particular is at least as common a proxy port as a llama.cpp port, so it cannot be load-bearing.

### Where the opt-in lives

No new config plumbing. Each adapter builds
`effectiveEnv = { ...process.env, ...env }` (`codex-local/execute.ts:601`) where `env` already
merges the agent's adapter-config `env` map, and passes exactly that to the biller. So
`PAPERCLIP_LOCAL_INFERENCE=1` set next to `OPENAI_BASE_URL` in the agent's existing env map reaches
the classifier unchanged, in all four adapters, with no signature churn.

The variable is tri-state: truthy (`1`/`true`/`yes`/`on`) opts in; explicitly falsy
(`0`/`false`/`no`/`off`) force-disables, which is the escape hatch for an operator running a paid
proxy on port 11434; absent means not local.

### Components

**`packages/adapter-utils/src/local-inference.ts`** (new — the whole decision, one file)

```ts
export const LOCAL_INFERENCE_ENV_VAR = "PAPERCLIP_LOCAL_INFERENCE";
export const LOCAL_BILLER = "local";

export type LocalInferenceRuntime = "ollama" | "lm_studio" | "llama_cpp";

export interface LocalInferenceClassification {
  isLocal: boolean;              // the $0 decision
  optIn: boolean | null;         // true / false / absent
  baseUrl: string | null;
  host: string | null;
  port: number | null;
  hostIsLocal: boolean;
  runtime: LocalInferenceRuntime | null;   // hint only, never grants $0
  reason: string;                // observability: why this verdict
}

export function classifyLocalInference(env: NodeJS.ProcessEnv | Record<string, string>): LocalInferenceClassification;
export function isLocalInferenceEnv(env): boolean;
export function localBillingOverride(env): { biller: "local"; billingType: "local"; costUsd: 0 } | null;
```

`reason` is a short string — `"opt-in and local host localhost"`, `"PAPERCLIP_LOCAL_INFERENCE is set
but host api.openai.com is not local"`, `"local host but no opt-in — set PAPERCLIP_LOCAL_INFERENCE=1
to bill this endpoint as free"`, `"explicit opt-out via PAPERCLIP_LOCAL_INFERENCE"`, `"no
OpenAI-compatible base URL configured"`. It is what makes a wrong verdict diagnosable from a log
instead of requiring a repro, and it is asserted non-empty for every branch.

**`billing.ts`** — `inferOpenAiCompatibleBiller` gains a local branch **ahead of** the OpenRouter
checks, so a stale `OPENROUTER_API_KEY` in the environment cannot mislabel a genuinely local run.
Because the branch only fires when the opt-in flag is set, all three existing tests are unaffected.

**`types.ts`** — `AdapterBillingType` gains `"local"`. Safe: it is only ever used as an annotation,
and its one consumer (`normalizeLedgerBillingType`) is a non-exhaustive `switch` with a `default`
arm, so it cannot fail to compile — which is precisely why the ledger case below must be added by
hand rather than being caught by the type checker. The *ledger* `BillingType` is different: it has
an exhaustive `Record<BillingType, string>` in the UI, so that one does fail loudly.

**`packages/shared/src/constants.ts`** — `BILLING_TYPES` gains `"local"`. Required because
`packages/shared/src/validators/cost.ts:27` validates the ledger field with `z.enum(BILLING_TYPES)`.
`BILLING_TYPES` is already exported from the shared barrel (`index.ts:142`), so no new export.
**No migration:** `cost_events.billing_type` is `text(...).notNull().default("unknown")`
(`packages/db/src/schema/cost_events.ts:36`) — no enum, no check constraint.

**`server/src/services/run-billing-ledger.ts`** (new) — the ledger boundary, extracted from the
10k-line `heartbeat.ts` so it can be tested in isolation. Holds `normalizeLedgerBillingType`,
`normalizeBilledCostCents` and `resolveLedgerBiller`, previously private module functions.

- `normalizeLedgerBillingType` gains `case "local": return "local"`. Without this the new type hits
  `default:` and degrades to `"unknown"`, silently undoing the whole phase.
- `normalizeBilledCostCents` gains `if (billingType === "local") return 0;` — an explicit invariant
  so a local run cannot bill money even if an adapter reports a bogus `costUsd`.

**`ui/src/lib/utils.ts`** — three coupled spots the type checker surfaced: the
`Record<BillingType, string>` label map, the `coerceBillingType` allow-list, and `visibleRunCostUsd`,
which must return 0 for local runs the same way it does for subscription-included usage.

**The four adapters** — each `resolve*Biller` consults `localBillingOverride(effectiveEnv)` **first**.
This ordering matters and is not cosmetic: `codex-local:145` returns `"chatgpt"` whenever
`billingType === "subscription"`, and `cursor-local:96` returns `"cursor"` on the same condition.
A local run has no `OPENAI_API_KEY`, so it classifies as `subscription` and both adapters would
overwrite `"local"`. Checking the override first is what prevents that.

Result fields set on a local run: `biller: "local"`, `billingType: "local"`, `costUsd: 0`, and
`usage` untouched — token counts must survive so productivity metrics and the diminishing-returns
detector (idea 003, `productivity-review.ts`) keep working when spend is zero. This is the explicit
requirement in idea 008 §3.

### Why `costUsd: 0` and not `null`

Spend is genuinely zero, and a real `0` is distinguishable from "we don't know". `null` would break
budget rollups that sum `costUsd` and would read as a data gap in the CFO views — the exact
confusion this phase removes. Hardware/electricity amortisation is a different question from
provider spend and does not belong in `cost_events`.

### Data flow

```
agent adapter config env { OPENAI_BASE_URL, PAPERCLIP_LOCAL_INFERENCE }
  → effectiveEnv = { ...process.env, ...env }        (adapter execute)
  → classifyLocalInference(effectiveEnv)             (adapter-utils)
  → localBillingOverride → { biller, billingType, costUsd }
  → AdapterExecutionResult
  → normalizeLedgerBillingType / normalizeBilledCostCents   (heartbeat)
  → cost_events row                                  (biller="local", billed cents=0, tokens intact)
  → costs/by-biller, finance-by-biller               (local now its own line, not fake OpenAI spend)
```

### Error handling

Every failure mode falls back to current behaviour rather than to `$0`:

- Unparseable or absent base URL → `hostIsLocal: false` → not local. No throw; `classifyLocalInference`
  is total and never rejects a malformed URL, because it runs inside the billing path of a run that
  has already succeeded.
- Opt-in set, host public → not local, `reason` records the mismatch.
- Opt-in absent, host local → not local (heuristic never grants $0), `runtime` hint still populated.

## Testing

`packages/adapter-utils/src/local-inference.test.ts` (new) — pure, no DB:

- loopback forms: `localhost`, `127.0.0.1`, `127.0.0.53`, `[::1]`
- LAN forms: `10.x`, `172.16.x`–`172.31.x`, `192.168.x`, `169.254.x`, `*.local`, IPv6 ULA
- **`172.32.x` and `172.15.x` are NOT private** — the classic off-by-one in RFC1918 range checks
- opt-in truthy/falsy/absent × local/public host — the full matrix, including the two fail-closed
  cases (opt-in + public host; local host + no opt-in)
- explicit `PAPERCLIP_LOCAL_INFERENCE=0` on `localhost:11434` → not local (the paid-proxy escape hatch)
- runtime hints by port, and the assertion that a hint alone never yields `isLocal: true`
- malformed base URLs (`"not a url"`, empty, whitespace) → total, no throw
- all three base-URL env aliases (`OPENAI_BASE_URL`, `OPENAI_API_BASE`, `OPENAI_API_BASE_URL`)

`billing.test.ts` (extended) — the three existing cases must pass **unmodified** (that is the
regression proof), plus: local opt-in wins over `OPENROUTER_API_KEY`; local opt-in wins over an
OpenRouter base URL; no opt-in leaves OpenRouter inference exactly as it was.

Adapter-level: `local-inference-adapter-coverage.test.ts` asserts that every adapter calling
`inferOpenAiCompatibleBiller` also calls `localBillingOverride`. This is a source scan rather than a
behavioural test, chosen deliberately — the regression it guards is an *omission* in a fifth
OpenAI-compatible adapter added later, which no typecheck and no unit test can detect. It also
asserts it found sources at all, so a directory move cannot make it vacuously pass.

Behavioural coverage of the four adapters' result composition is bounded by what exists today: the
adapters have no billing-level execution tests, and adding a harness that spawns and mocks four
CLIs is out of proportion to this phase. The override itself is fully unit-tested, and the ordering
requirement it depends on is documented at each call site.

Ledger-level: `"local"` survives `normalizeLedgerBillingType`; `normalizeBilledCostCents` returns 0
for `billingType: "local"` even when handed a non-zero `costUsd`.

## Exit criteria

1. A run against a declared local endpoint records `biller: "local"`, billed cents `0`, and non-zero
   token counts.
2. A run against a *loopback proxy without* the opt-in flag bills exactly as it does on `master`.
3. The three pre-existing `billing.test.ts` cases pass unmodified.
4. Full server + package suites green, modulo the two pre-existing `paperclip-skill-utils.test.ts`
   cwd-sensitive failures documented in `BUILD-DECISIONS.md`.
5. `BUILD-DECISIONS.md` combo-02 row updated, and the combo-03 "blocked on combo 02" claim corrected.

## Follow-ups (not this phase)

- UI presets (Ollama / LM Studio / llama.cpp) writing base URL + opt-in together, and an endpoint
  reachability + model-list probe. Deferred: it touches four separate `config-fields.tsx` files and
  is UX, not correctness. The correctness fix should not wait behind it.
- Phase 2: quota-aware provider fallback chains.
