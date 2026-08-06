# Telegram Channel

Two-way Telegram bot for a company: high-risk approvals arrive in a chat with inline **Approve** /
**Reject** buttons, and a tap becomes a governed decision in the control plane.

This is idea `066` (Telegram half). WhatsApp is not built.

## What it does

- **Outbound.** A `telegram` delivery channel sits beside `inbox` and `webpush` in
  `notification-delivery.ts`. It receives the same notifications web push does, and applies the
  same floor — system minimum band `high`, plus each user's `push_delivery_prefs` (`minBand`, quiet
  hours). Configure once; no separate preference surface.
  - An **approval** arrives as a card with inline Approve/Reject controls and its evidence attached.
  - **Anything else** — an SLA breach from the coverage sweep, a budget incident — arrives as a plain
    card with a link back to the board. There is no decision to encode, so no button pretends there is.
  - A notification **addressed to a user** (`target.userId`) reaches only that user's bound chats; one
    with no user is company-wide. The coverage escalation names a single backup, and it stays theirs.
- **Inbound.** Telegram POSTs updates to `/api/telegram/webhook/:companyId`. A tapped button is decoded,
  attributed to the chat's bound user, and run through the same authority gate, side effects, and audit
  as a decision made in the UI.

## Setup

1. **Create a bot.** Talk to [@BotFather](https://t.me/BotFather), `/newbot`, keep the token.
2. **Register it.** Board → Digest page → *Telegram* → paste the token and the bot's username, then
   **Connect bot**. The panel then shows the generated `webhookSecret`. No read endpoint returns it, but
   the secret is *stable* across saves — re-entering the token and pressing **Replace bot** reveals the
   same value again, so a missed copy is recoverable. The bot token is write-only: it never comes back
   out of the API. Set **Public base URL** here too (your public HTTPS origin) so approval cards can
   carry an "Open in Paperclip" deep link.
3. **Point Telegram at Paperclip.** The server must be reachable over HTTPS **on port 443, 80, 88 or
   8443** — the webhook guide is explicit that *"Other ports are not supported and will not work"*, so
   Paperclip's own `:3100` can never be exposed directly. Put a tunnel or reverse proxy on 443 in front
   of it. TLS 1.2+ is required and the certificate's CN/SAN must match the webhook hostname (a
   Cloudflare-terminated hostname satisfies both).

   ```sh
   curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
     -H 'content-type: application/json' \
     -d '{"url":"https://your-paperclip/api/telegram/webhook/<COMPANY_ID>",
          "secret_token":"<WEBHOOK_SECRET>",
          "allowed_updates":["message","callback_query"]}'
   ```

4. **Link a chat.** Click **Link a chat** to mint a one-time code, then open the deep link (or send
   `/start <code>` to the bot). The chat is now bound to *you* — specifically to the Telegram account
   that sent the `/start`, which is the only account that can decide from it. This works in a group too
   (`/start@yourbot <code>`); the whole group sees the cards, but only you can act on them.
5. **Optional deep links.** Set `publicBaseUrl` on the config so approval messages carry a clickable link
   back into the board.

## What a message looks like

Approvals render as an HTML card, not a wall of text:

```
🔴 Critical risk approval
Requested by Atlas · PAP-14, PAP-15

> Increase the monthly cap to $4,000

[ ✅ Approve ]  [ ❌ Reject ]
[ 🔗 Open in Paperclip     ]
```

- **Risk chip** — 🟢 low, 🟡 medium, 🟠 high, 🔴 critical, so the band reads at a glance.
- **Controls** — `callback_data` buttons for the decision, plus a `url` button straight to the board
  (only when `publicBaseUrl` is set). Link previews are suppressed so the card stays compact.
- **Images and diagrams** — attachments on the approval's linked issues ride along:

  | What the approval carries | How it arrives |
  | --- | --- |
  | One PNG/JPEG/WebP/GIF | `sendPhoto`, card as the caption, controls attached |
  | Two or more photos | `sendMediaGroup` album, then the card + controls (the Bot API accepts no `reply_markup` on an album) |
  | SVG or other non-renderable image | `sendDocument`, card as the caption, controls attached |
  | Nothing | Plain `sendMessage` card |

  Bytes are uploaded as `multipart/form-data` — Telegram cannot fetch a Paperclip asset URL, because
  asset routes require board auth. Photos over 10 MB and documents over 50 MB are skipped rather than
  attempted. Media resolution is best-effort throughout: a storage failure degrades the message to text
  and never drops the approval.

All interpolated text is HTML-escaped (`&`, `<`, `>`) before rendering, so an agent-authored approval
title cannot inject markup or break the parse.

## Verified against the Bot API

Checked against [core.telegram.org/bots/api](https://core.telegram.org/bots/api) on 2026-08-06:

| Assumption | Status |
| --- | --- |
| Base URL `https://api.telegram.org/bot<token>/METHOD_NAME` | ✅ confirmed |
| Response envelope always has `ok`, optionally `description` — 200 can still mean failure | ✅ confirmed |
| Webhook header is exactly `X-Telegram-Bot-Api-Secret-Token` | ✅ confirmed |
| `secret_token` allows only `A-Z a-z 0-9 _ -`, 1–256 chars — our `base64url` secret fits | ✅ confirmed |
| Non-2xx from the webhook causes Telegram to retry, so we always answer 200 after auth | ✅ confirmed |
| `callback_data` is "1-64 bytes" — our token is 42 | ✅ confirmed |
| `InlineKeyboardButton` supports `url` alongside `callback_data` | ✅ confirmed |
| HTML parse_mode escapes exactly `<`, `>`, `&`; supports `b/i/code/pre/blockquote/a` | ✅ confirmed |
| `sendMediaGroup` takes 2–10 items and no `reply_markup` | ✅ confirmed |
| `sendMessage.text` limit 4096 | ✅ confirmed |
| Webhook ports restricted to 443 / 80 / 88 / 8443 | ✅ confirmed |
| Webhook requires TLS 1.2+, cert CN/SAN must match the hostname | ✅ confirmed |
| Deep-link `?start=` payload: only `A-Z a-z 0-9 _ -`, max 64 chars — our base64url code fits, pinned by a test | ✅ confirmed |
| `setWebhook` with an empty `url` clears the webhook | ✅ confirmed |
| `caption` limit 1024, `answerCallbackQuery.text` limit 200 | ⚠️ not found in the docs page; we truncate to these conservatively, which is safe even if the real limits are higher |
| Photo ≤10 MB / document ≤50 MB upload caps | ⚠️ not restated in the fetched sections; treated as conservative caps |

No test performs a live round trip against api.telegram.org — the transport is unit-tested against a
stubbed `fetch`. Connecting a real bot in dev is still the only way to prove the end-to-end path.

Checked against [core.telegram.org/bots/webapps](https://core.telegram.org/bots/webapps) and
[core.telegram.org/bots/api](https://core.telegram.org/bots/api) on 2026-08-06 for the Mini App:

| Assumption | Status |
| --- | --- |
| `initData` HMAC key derivation: `secret = HMAC_SHA256(key="WebAppData", message=botToken)`, `data_check_string` is remaining fields as `key=value`, sorted by key, newline-joined | ✅ confirmed — "the HMAC-SHA-256 signature of the bot's token with the constant string `WebAppData` used as a key" and "Data-check-string is a chain of all received fields, sorted alphabetically, in the format `key=<value>` with a line feed character... used as separator" |
| `auth_date` is a Unix timestamp the server must range-check itself (Telegram does not expire it) | ✅ confirmed — "_auth_date_ field, which contains a Unix timestamp of when it was received by the Mini App" |
| `web_app` inline-keyboard buttons work in group chats | ⚠️ **the opposite is documented.** The Bot API's `InlineKeyboardButton.web_app` field description (mirrored verbatim by aiogram and python-telegram-bot, since `core.telegram.org/bots/api` is too large for automated fetch to reach that section directly): *"Description of the Web App that will be launched when the user presses the button... **Available only in private chats between a user and the bot.**"* A `web_app` button on a group card would silently fail to open. This is why the "Review in full" button is currently `url`, not `web_app` — see Known gaps. |
| `setChatMenuButton` is set once per bot vs. per chat | ✅ confirmed as **per-chat with a global fallback**, not "once per bot": *"Use this method to change the bot's menu button in a private chat, or the default menu button."* Its `chat_id` parameter: *"Unique identifier for the target private chat. If not specified, default bot's menu button will be changed."* |
| Mini Apps are restricted to the same ports as webhooks (443/80/88/8443) | ⚠️ **not stated either way.** The docs require HTTPS for a Mini App URL but state no port restriction anywhere on the Mini Apps page — the 443/80/88/8443 restriction appears only in the webhook section. Absence of a stated restriction is not proof none exists; treat "any HTTPS port works for Mini Apps" as likely but unconfirmed, not as a verified fact. |

## Security model

The webhook is unauthenticated as far as Paperclip's actor middleware is concerned — it must be, because
Telegram calls it. Everything therefore rests on these properties:

| Control | Where |
| --- | --- |
| Per-company `webhookSecret`, compared in constant time against `X-Telegram-Bot-Api-Secret-Token` | `routes/telegram.ts` |
| A chat may only act as the user whose one-time code it redeemed | `telegram-link.ts` |
| **Only the Telegram account that redeemed the code may decide** — `callback_query.from.id` must match the binding's `telegram_user_id` | `telegram-decisions.ts` |
| A binding with no recorded `telegram_user_id` (pre-`0125`) cannot decide at all — it fails closed until the chat re-links | `telegram-decisions.ts` |
| `/start` in a chat with no sender (e.g. a channel post) cannot create a binding | `routes/telegram.ts` |
| Codes are single-use, expiring (default 60 min), and cleared on redemption | `telegram-link.ts` |
| One *live* binding per chat per company (partial unique index); revoked rows stay for audit | migration `0124` |
| A binding for company A can never decide company B's approval | `telegram-decisions.ts` |
| Decisions pass the same `canDecide(band, "explicit_human")` gate as the HTTP route | `telegram-decisions.ts` |
| Every decision writes `approval.decision` with `details.channel = "telegram"` plus the chat id | `telegram-decisions.ts` |
| Disconnecting the bot revokes every binding | `routes/telegram.ts` |
| Every interpolated value is HTML-escaped before rendering, so agent-supplied text cannot inject markup | `telegram-format.ts` |

Nothing in a webhook body is trusted to name the actor or the company: the actor is re-derived from the
binding, and the company comes from the URL that the secret authenticated.

**Chat vs. user.** The chat proves only *where* a card is, never *who* tapped it. That distinction
matters the moment the bot is added to a group: a bound group chat is readable and tappable by every
member, so authority is pinned to `telegram_user_id` — the account that redeemed the link code — rather
than to the chat. Binding a group is therefore safe and useful: everyone sees the approval, one person
decides, and the audit row names that person truthfully. What a group still means is that the card's
contents — the approval title, body and any attached screenshots — are visible to the whole room, so
bind a group only when that is intended.

**Upgrading past `0125`.** Bindings created before the `telegram_user_id` column existed have nothing to
compare a tap against. They fail closed rather than fall back to chat-only authority: a tap answers
"This link is out of date — re-link the chat from the Paperclip board to decide here". Re-linking from
the board records the identity and restores the binding. There is no backfill, because no existing row
names a Telegram user.

**Rotating a compromised bot token:** BotFather's `/token` command issues a new one — *"Everyone who has
your token will have full control over your bot."* Paste the new token into the Telegram panel and press
**Replace bot**; the webhook secret is preserved, so no `setWebhook` change is needed.

**At rest:** the bot token and webhook secret are stored in plaintext in `telegram_bot_configs`, the same
way `push_vapid_keys` stores the VAPID private key. Anyone with database access can impersonate the bot
and read approval traffic — treat the row as a credential and rotate via **Replace bot** if exposed.

## Mini App

The bot's menu button and an approval card's **🔎 Review in full** button open Paperclip *inside*
Telegram, at `{publicBaseUrl}/telegram/app?c=<COMPANY_ID>`. It is the board itself — same build, same
API — with a six-item bottom nav: Dashboard, Tasks, Triage, Digest, Artifacts, Wikis.

**How it authenticates.** Telegram hands the webview a signed `initData` blob. The page posts it to
`POST /api/telegram/miniapp/session` with the company id from the URL. The server verifies the HMAC
using that company's bot token, rejects anything whose `auth_date` is more than 5 minutes old, resolves
`initData.user.id` against `telegram_chat_bindings.telegram_user_id`, and returns a bearer token valid
for 12 hours. Only the token's sha256 is stored.

**The grant is larger than the buttons'.** An inline button decides one approval. A Mini App session is
the board API as that user, for one company. Two consequences:

| Control | Where |
| --- | --- |
| A session is scoped to exactly one company and never widens the user's real access | `middleware/auth.ts` |
| A session never carries instance-admin, even if the user has it | `middleware/auth.ts` |
| Revoking a chat binding revokes every session it minted | `telegram-link.ts` |
| A tampered or stale `initData` is refused without saying which | `routes/telegram.ts` |
| A binding predating migration `0125` has no `telegram_user_id` and cannot mint a session | `telegram-miniapp-session.ts` |

A session is minted with `type: "board"`, `companyIds: [session.companyId]` — a hardcoded single-company
list, not the user's real `access.companyIds` — and `isInstanceAdmin: false` hardcoded, never the user's
real value. `resolveBoardAccess` still runs against the user's genuine membership first, so a bearer only
authenticates at all if the user still has active access to that company; the hardcoding narrows what the
session is *allowed to claim*, it never widens it. Revocation is atomic: `telegram-link.ts`'s
`revokeBinding` wraps the binding's `UPDATE` and the call to `revokeForBinding` in one `db.transaction`,
so a chat binding and every Mini App session it minted go dark together — there is no window where the
binding is revoked but a session it produced is still live.

**The bearer travels through three modules, not one.** `ui/src/api/client.ts` (the shared fetch helper
behind `api.get/post/...`) carries the bearer on every board API call, but two more modules make their
own `fetch()` calls outside that helper: `ui/src/api/health.ts` and `ui/src/api/auth.ts`. Both matter
because every routed page — including all six Telegram surfaces — renders under `<CloudAccessGate>`,
which calls `healthApi.get()` unconditionally and, on an `authenticated`-mode deployment,
`authApi.getSession()`. Inside the Telegram webview there is no session cookie, so without the bearer on these
two paths as well, `CloudAccessGate` would 401 and redirect every Mini App visitor to a login page that
does not work in a webview — the board would look broken even though the Mini App session itself was
fine. All three modules now build their `Authorization` header through one shared function,
`applyTelegramAuthHeader`, exported from `ui/src/telegram/useTelegramSession.ts`, so the bearer logic
exists in exactly one place. `client.ts` additionally retries once on a 401: it clears the dead bearer,
re-mints a fresh one against the `initData` the webview still holds, and replays the same request — a
session that outlives its 12-hour TTL mid-visit recovers without the user noticing.

**The bot token now forges sessions.** It is the HMAC key for `initData`, so the plaintext-at-rest note
above is stronger than it was: database access no longer merely impersonates the bot and reads approval
traffic, it mints board sessions. Rotate with **Replace bot**, which should be followed by revoking
live bindings if a leak is suspected.

## Files

| Layer | File |
| --- | --- |
| Schema | `packages/db/src/schema/telegram_bot_configs.ts`, `telegram_chat_bindings.ts`, migrations `0124_telegram_channel.sql`, `0125_telegram_binding_user_identity.sql` |
| Validators | `packages/shared/src/validators/telegram.ts` |
| Outbound channel | `server/src/services/telegram-channel.ts` |
| Message/callback codec | `server/src/services/telegram-format.ts` |
| Bot API transport | `server/src/services/telegram-transport.ts` |
| Identity binding | `server/src/services/telegram-link.ts` |
| Decision path | `server/src/services/telegram-decisions.ts` |
| Shared approval effects | `server/src/services/approval-effects.ts` |
| Routes | `server/src/routes/telegram.ts` |
| UI | `ui/src/components/telegram/TelegramChannel.tsx`, `ui/src/api/telegram.ts` |

## Known gaps

- The channel now carries any `push` payload, but only approvals and the coverage/SLA escalation
  actually produce one today. Budget incidents, SEV1 alerts and the digest still need their own
  `deliverThroughChannels` call before they will appear.
- Media comes from attachments on the approval's *linked issues*. An approval with no linked issues, or
  whose evidence lives in a work product rather than an issue attachment, still sends as a text card.
- No command grammar beyond `/start <code>` — **superseded**, not fixed: the Mini App answers the same
  questions with more room. See `docs/superpowers/specs/2026-08-06-telegram-command-grammar-design.md`.
- Proposals — the pick-one-of-N gate for choosing between agent-produced candidates — does not exist in
  core yet, so the Mini App ships with six surfaces rather than seven.
- No inbound intake (a forwarded message does not become an issue).
- `setWebhook` is a manual step; Paperclip does not register the webhook for you.
- WhatsApp is not implemented; its opt-in and 24-hour template rules make it a separate slice.
