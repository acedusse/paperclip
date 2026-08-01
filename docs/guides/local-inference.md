# Running agents on your own GPU (local inference)

Paperclip's OpenAI-compatible adapters — `codex_local`, `pi_local`, `opencode_local` and
`cursor` — can be pointed at a local model server instead of a paid API. Ollama, LM Studio and
llama.cpp all expose an OpenAI-compatible `/v1` endpoint, so no special adapter is needed: this is
a configuration of the adapter you already use.

Runs served this way cost **$0**, and Paperclip records them that way — while still recording token
counts, so productivity metrics keep working when spend is zero.

## Setup

Set two variables in the agent's adapter-config `env` map:

| Variable | Value |
|----------|-------|
| `OPENAI_BASE_URL` | your local endpoint, e.g. `http://localhost:11434/v1` |
| `PAPERCLIP_LOCAL_INFERENCE` | `1` |

Conventional endpoints:

| Runtime | Base URL |
|---------|----------|
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp server | `http://localhost:8080/v1` |

Set the model the same way you would for any other endpoint (for Ollama, the model must already be
pulled — `ollama pull <model>`).

## Why the second variable is required

`PAPERCLIP_LOCAL_INFERENCE` is not redundant with a loopback URL, and Paperclip will **not** infer
$0 from the URL alone.

Gateways and proxies routinely listen on loopback and forward to paid providers — LiteLLM, and
Paperclip's own `openclaw_gateway`, are normally reached at `localhost`. If a loopback address were
enough to mean "free", those setups would silently report zero spend while real money was being
charged. Under-reporting spend is the same class of bug as over-reporting it, and considerably
harder to notice.

So the rule is: **$0 is never inferred, only declared.** Billing is marked local only when the
opt-in is set *and* the host is genuinely local (loopback, `.local`, or a private/link-local
range). Either one on its own leaves billing exactly as it was.

### Forcing normal billing back on

If you run a *paid* proxy on one of the ports above, set `PAPERCLIP_LOCAL_INFERENCE=0`. An explicit
`0`, `false`, `no` or `off` disables local billing regardless of the host.

## What gets recorded

A run served by a declared local endpoint records:

- `provider: "local"`, `biller: "local"`, `billingType: "local"`
- billed cost `0`
- prompt/completion token counts, unchanged

Local runs therefore appear as their own line in the cost reports
(`/companies/:companyId/costs/by-biller`) rather than being attributed to whichever paid provider
the adapter would otherwise have assumed.

Note that the CLIs behind these adapters price usage from their own built-in tables and do not know
the endpoint was a local model server, so they may report a non-zero cost. Paperclip overrides it to
zero for local runs, at both the adapter and the ledger boundary.

## Troubleshooting

**Runs still show up under `openai` / `chatgpt` / `cursor`.** `PAPERCLIP_LOCAL_INFERENCE` is not
reaching the adapter, or the base URL host is not local. Both must hold. Check the variable is in
the *agent's adapter-config* `env` map, not only in your shell.

**A LAN endpoint is not treated as local.** Private ranges are `10.0.0.0/8`,
`172.16.0.0/12` (which spans `172.16`–`172.31` only — `172.32.x` is public), `192.168.0.0/16`,
and `169.254.0.0/16`. Hostnames ending in `.local` also count; `.localdomain` does not.
