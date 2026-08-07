# Telegram Phase B — Mini App

**Date:** 2026-08-06
**Idea:** 066 — built-in chat channel (Telegram half)
**Phase:** B of C (A: console — *superseded* · B: Mini App · C: the company as a Telegram org)
**Depends on:** `f501374` (migration `0125`, `telegram_user_id`) — on `feat/telegram-approval-channel`, unpushed
**Supersedes:** `2026-08-06-telegram-command-grammar-design.md`
**Status:** design, approved

---

## Why

The requirement is that Telegram be a **UI version of Paperclip, per company** — Dashboard, Tasks,
Triage, Digest, Artifacts and Wikis reachable on a phone without opening a browser.

That is not a chat feature. Four of those six render acceptably as messages; Artifacts and Wikis are
documents, and the wiki plugin ships its own React UI (`packages/plugins/plugin-llm-wiki/src/ui`)
served through `plugin-ui-static.ts`. Rendering a wiki page as HTML message bubbles would produce a
worse copy of a UI that already exists.

This is what Telegram's own platform pitch calls replacing an entire website: a Mini App is a webview
we host, that Telegram opens with the user already authenticated. Because it is a webview, serving
**the board itself** delivers all six surfaces at once — including plugin UIs — rather than
reimplementing six views in a second form that then drifts.

---

## Pre-flight findings

Verified on `feat/telegram-approval-channel` @ `f501374`.

| Claim | Verified |
|-------|----------|
| A Telegram *user* id is recorded and joinable | **Yes.** `telegram_chat_bindings.telegram_user_id`, added in migration `0125`, indexed by `telegram_chat_bindings_telegram_user_idx`. This was the blocker; it is already gone. |
| The board runs on a phone | **Yes.** `SidebarContext` sets `isMobile` from `window.innerWidth < MOBILE_BREAKPOINT`, and `Layout.tsx:597` renders `MobileBottomNav` when it is true. |
| The existing mobile nav matches the six surfaces | **No.** It is Home, Tasks, Create, Agents, Inbox. Triage, Digest, Artifacts and Wikis are not in it — see §3. |
| The UI is served by the same server as the API | **Yes.** `app.ts:389` serves `ui-dist/` (or `../../ui/dist` in the monorepo) under `uiMode: "static"`. |
| Plugin UIs are served from the same origin | **Yes.** `pluginUiStaticRoutes` (`app.ts:81`). A webview pointed at that origin gets the wiki UI for free. |
| A hashed-bearer auth path already exists to model on | **Yes.** `agent_api_keys` are resolved in `actorMiddleware` by `hashToken(token)` → `keyHash` lookup with a `revokedAt IS NULL` filter (`auth.ts:146`). |
| Approvals are addressable by a human id | **No.** Only `id: uuid`. Irrelevant here — the Mini App links by id — but it is why Phase A could not offer `/approve PAP-142`. |
| Triage renders enough to act on | **No.** `ApprovalTriage.tsx:165` renders a checkbox, the band pill and `it.type`, discarding the title, requester and risk reasons the server already returns. Review finding **X2**. Blocking for this phase — see §5. |

---

## Scope

**In:** an `initData`-authenticated session endpoint; a Telegram-aware shell in the existing board;
a six-item bottom nav; theme mapping; the menu-button and card-button entry points; the X2 Triage fix.

**Out**, each deferred deliberately:

| Deferred | Why |
|----------|-----|
| **Proposals** | The pick-one-of-N gate does not exist in core — `approvals.status` cannot express "option B wins". It is real schema work and lands as a seventh nav item afterwards. See §8. |
| Chat command grammar (`/triage`, `/status`, …) | Phase A, superseded. The Mini App answers the same questions with more room. Revisit only if a command proves faster than opening the webview. |
| A separate phone-first frontend | A second frontend to keep in step with the board forever, and plugin UIs would not render in it. |
| Writing from Telegram beyond what the board already does | The Mini App is the board; it inherits the board's write surface and adds none. |

---

## 1. Authentication

Telegram opens the webview with an `initData` query string signed by the bot's token. The exchange:

```
POST /api/telegram/miniapp/session
  { companyId, initData }
  → { token, expiresAt, user: { id, name }, companyId }
```

1. **Load the company's bot config.** `companyId` comes from the URL the menu button was built with,
   and selects which bot token verifies the signature. No config, or disabled → 404.
2. **Verify the signature.** HMAC-SHA256 over the sorted `data_check_string`, keyed by a secret
   derived from the bot token. The exact derivation is pinned in §7 as a claim to verify against the
   live docs before implementing — getting the key-derivation argument order wrong either rejects
   every login or, worse, validates nothing.
3. **Range-check `auth_date`.** Signatures do not expire on their own. A captured `initData` is a
   replayable credential without a freshness window; reject anything older than
   `MINIAPP_INITDATA_MAX_AGE_SECONDS` (default 300).
4. **Resolve the binding.** `telegram_chat_bindings` where `telegram_user_id = initData.user.id`,
   `company_id = companyId`, `revoked_at IS NULL`, `linked_at IS NOT NULL`. No binding → 403 with a
   message telling the operator to link from the board. Pre-`0125` bindings have a null
   `telegram_user_id` and therefore simply do not match — the same fail-closed posture the decision
   path takes, arrived at by the same mechanism.
5. **Mint a session.** A random token returned once, stored only as `sha256` in a new
   `telegram_miniapp_sessions` table `(id, company_id, user_id, token_hash, expires_at, created_at,
   revoked_at)`, modelled on `agent_api_keys`. `actorMiddleware` gains a branch that resolves it to a
   board actor scoped to that one company.

**Lifetime.** `MINIAPP_SESSION_TTL_HOURS`, default 12. **Expiry is terminal — there is no silent
renewal.** An earlier draft of this section claimed the webview could mint a replacement on a 401 from
the `initData` it still holds; that is wrong, and the code that implemented it was dead. Telegram hands
the webview one `initData` blob at launch, with a fixed `auth_date`, and step 3 above rejects anything
older than 300 seconds. A re-mint from the held blob can therefore only succeed inside the first five
minutes of the webview's life — never the twelve-hour case it would exist for — and Telegram exposes no
API to re-source `initData` while the Mini App is open. So a 401 on a bearer-carrying request ends the
session and the shell tells the operator to reopen Paperclip from Telegram, which issues fresh
`initData`. Twelve hours is chosen to make that rare, not invisible.

Every path that revokes a binding — "unlink chat", "Disconnect bot", and re-linking a chat to a
different user — revokes that binding's live sessions in the same transaction, so the board's kill
switch is real on all three. Disabling or deleting the bot config does the same by a different route:
`resolve()` requires the company's bot to still exist and be enabled.

**This is a far larger grant than the chat ever had.** An inline button could approve or reject one
approval. A Mini App session is the board API as that user. That is the point of the phase, but it
means `initData` verification and the token's lifetime are now the entire security story, where
before the blast radius of a mistake was a single tap. Two consequences worth stating plainly:

- The bot token is the HMAC key, so **a leaked bot token forges sessions**. It is stored in plaintext
  in `telegram_bot_configs`, as `doc/TELEGRAM-CHANNEL.md` already documents. That row was previously
  "can read approval traffic and impersonate the bot"; it is now also "can mint board sessions".
  Rotating via **Replace bot** must therefore also revoke live sessions.
- The session is scoped to one company by construction. A user bound to three companies through
  three bots gets three sessions and cannot cross between them.

## 2. Entry points

The Mini App URL is per-company: `{publicBaseUrl}/telegram/app?c={companyId}`.

| Entry | Set by | When |
|-------|--------|------|
| Chat menu button | `setChatMenuButton` | On config save, alongside the bot registration |
| "Review in full" on an approval card | `web_app` inline-keyboard button | Added to `buildApprovalMessage` when `publicBaseUrl` is set |

The card's Approve/Reject buttons stay exactly as they are. "Review in full" is the escape hatch for
when two buttons are not enough — the changeset, the attachments, the risk reasons — which is the
case the original idea flagged as needing the full UI.

`web_app` buttons carry a chat-type restriction (§7). Where they are not permitted, the card falls
back to today's `url` button, which already works everywhere.

## 3. The shell

`SidebarContext` already computes `isMobile`. It gains a sibling signal, `isTelegram`, true when
Telegram's injected `WebApp` object is present on `window`. `Layout.tsx:597` becomes:

```
isTelegram  → <TelegramBottomNav />
isMobile    → <MobileBottomNav />
otherwise   → desktop sidebar
```

`TelegramBottomNav` lists the six: **Dashboard · Tasks · Triage · Digest · Artifacts · Wikis**. It is
a new component beside `MobileBottomNav`, not a modification of it — the two answer different
questions ("what does a phone user reach for" vs "what did the operator ask Telegram to expose") and
conflating them would make each worse.

Everything else is untouched: routing, pages, API client, and the plugin UI mount. That is what keeps
this one build.

**Chrome to suppress in Telegram mode.** The company switcher (the session is single-company), and
any desktop-only affordance the webview cannot honour. `Layout` already branches for mobile; this
adds cases rather than a parallel tree.

## 4. Theme

Telegram exposes `themeParams` and a `colorScheme` of `light` or `dark`, and the user can change it
while the app is open. On load and on Telegram's theme-changed event, map `themeParams` onto the
board's existing CSS custom properties and set the board's own light/dark attribute from
`colorScheme`. The board's theming is already token-based, so this is an assignment, not a restyle.

Also call `expand()` on load so the webview opens full height rather than as a half sheet.

## 5. The six surfaces

Five are existing routes and need no work:

| Nav item | Route | State |
|----------|-------|-------|
| Dashboard | `/dashboard` | ships as-is |
| Tasks | `/issues` | ships as-is |
| Digest | `/digest` | ships as-is |
| Artifacts | `/artifacts` | ships as-is |
| Wikis | plugin UI via `pluginUiStaticRoutes` | ships as-is |
| **Triage** | `/approvals/triage` | **needs X2 first** |

**X2 is in scope for this phase.** `ApprovalTriage.tsx` renders a checkbox, a band pill and the
approval `type` — no title, no requester, no age, none of the risk reasons the list is sorted by,
all of which `listTriage` already returns. On a desktop surface that was a papercut you could work
around by opening each item. As one of six primary phone surfaces it is a blocker: the only safe
action from that list is to open every row individually, which defeats the bulk controls above it.
The fix is rendering, not fetching — the data is already on the wire.

Review finding **X3** (group chips show `type` but are keyed `type::agentId`, so two agents' groups
render identically) is small and adjacent; fold it in while the file is open.

## 6. Testing

| Layer | Covers |
|-------|--------|
| `telegram-miniapp-session.test.ts` (new, embedded pg) | A valid `initData` mints a session; a tampered one is rejected; a stale `auth_date` is rejected; an unknown Telegram user is 403; a pre-`0125` (null `telegram_user_id`) binding does not match; a binding for company A cannot mint a session for company B; revoking the binding kills live sessions. |
| `auth.test.ts` (extend) | The new bearer branch resolves to a board actor scoped to one company, and a revoked or expired session does not. |
| `TelegramBottomNav.test.tsx` (new, jsdom) | Renders the six items; `Layout` picks it over `MobileBottomNav` when the Telegram signal is present, and over the sidebar regardless of width. |
| `ApprovalTriage.test.tsx` (extend) | Rows show title, requester and risk reasons; group chips distinguish two agents with the same approval type. |

The signature tests are the ones that matter. A test that a *tampered* `initData` is rejected is
worth more than any number asserting the happy path, because the failure mode of a broken HMAC check
is silent acceptance.

## 7. Bot API claims to verify before implementing

`doc/TELEGRAM-CHANNEL.md` carries a verification table against `core.telegram.org/bots/api`; these
are this phase's additions, **none of which were checked against the live docs during design**.

| Claim | Why it matters |
|-------|----------------|
| `initData` auth is HMAC-SHA256 over a sorted `data_check_string`, keyed by `HMAC-SHA256(bot_token, "WebAppData")` | The entire session mint. Wrong argument order either rejects every login or validates nothing. |
| `auth_date` is present and is a unix timestamp the server must range-check itself | Freshness is not enforced by the platform. |
| `web_app` inline-keyboard buttons are restricted by chat type | Decides whether "Review in full" can appear on cards sent to a group, or only in private chats. |
| `setChatMenuButton` scope and per-chat override semantics | Whether the menu button is set once per bot or per bound chat. |
| Mini Apps require HTTPS on the same restricted port set as the webhook | Confirms the existing tunnel/reverse-proxy requirement covers this phase rather than needing a second origin. |
| `themeParams` keys and the theme-changed event name | §4's mapping. |

## 8. What comes after: Proposals

The seventh surface is deferred because it does not exist to render.

**The requirement:** a human gate where agents present several candidates — mockups, designs, plans —
and the Board picks which proceeds. A web-development company producing three homepage directions
needs the Board to choose one before implementation starts.

**Why it is not an approval.** `approvals.status` is one field with
`pending / approved / rejected / revision_requested`. It is binary on one thing. There is no way to
say "B wins over A and C", and nothing would stop all three being approved.

**The agreed shape:** a `proposal` holding N `candidates`, each pointing at an
`issue_work_products` row and its attachments, resolved by a single decision naming the winner. One
gate, one choice, the model enforcing that exactly one wins — and the audit recording what it was
chosen *over*, which is the part that matters six months later.

The pieces it can reuse already exist: `issue_work_products` lets one issue carry several outputs,
and `issue_attachments` → `assets` carries the images. What is new is the gate and its decision
semantics.

This gets its own spec. It is sequenced after the Mini App deliberately: it is the riskiest piece
(a new decision primitive next to a governed one), and it should land into a shell whose auth and
rendering are already proven — and it is the surface that most needs a real viewport, so it wants the
Mini App to exist first regardless.

## 9. Documentation

`doc/TELEGRAM-CHANNEL.md` gains a Mini App section: the entry points, the session exchange and its
lifetime, the enlarged grant relative to inline buttons, and the bot-token-forges-sessions
consequence for the at-rest note already there.

The known-gaps entry "No command grammar beyond `/start <code>`" stays, with a note that it is
superseded by the Mini App rather than fixed. A reader should be able to tell the difference between
a gap we closed and one we decided not to.
