# Telegram Phase A — Command Grammar

**Date:** 2026-08-06
**Idea:** 066 — built-in chat channel (Telegram half)
**Phase:** A of C (A: console · B: Mini App · C: the company as a Telegram org)
**Depends on:** `f501374` (user-identity binding + channel widening) — on `feat/telegram-approval-channel`, unpushed
**Status:** design, approved

---

## Why

The channel shipped in `aa40939` is push-only in practice: the bot tells you about an approval and
you tap it. There is no way to *ask* it anything. An operator who wants to know what is waiting must
open the board, which is the friction the whole idea was meant to remove.

Phase A adds a small read-only grammar so the bot answers questions as well as asking them. It adds
no new way to change anything: every write still goes through the inline-button callback path built
in `aa40939` and hardened in `f501374`.

---

## Pre-flight findings

Verified on `feat/telegram-approval-channel` @ `f501374`.

| Claim | Verified |
|-------|----------|
| A command parser already exists | **Yes.** `parseTelegramCommand` in `routes/telegram.ts`, added in `f501374` — splits on whitespace, strips `@botname`, lowercases. Currently only `/start` is dispatched from it. |
| An identity check already exists | **Yes**, but **inline in `telegram-decisions.ts`** (`binding.telegramUserId` present, and equal to `from.id`). Commands need the identical rule — see §1. |
| Approvals can be named by a human-readable id | **No.** `approvals` has `id: uuid` and no identifier column. `PAP-142`-style identifiers belong to `issues` (`issues.identifier`). This is why no command addresses an approval — see §2. |
| `listTriage` returns what a card needs | **Yes.** `approvalTriageService.listTriage(companyId)` returns full approval rows plus `{score, band, reasons}`, already sorted highest-score-first. |
| A card builder can be reused verbatim | **Yes.** `buildApprovalPushBody({approvalType, band, companyId, approvalId})` → `{title, body, url, band, approvalId}`, which is exactly `buildApprovalMessage`'s input. Reusing it makes a `/triage` card word-identical to a pushed one. |
| `/status` data exists | **Yes.** `dashboardService.summary(companyId)` returns agent counts by state, task counts (`open`/`inProgress`/`blocked`/`done`), and `pendingApprovals`. It also returns `monthSpend`, which this spec deliberately does not use — see §3. |
| `/digest` data exists | **Yes.** `digestService.latest(companyId)` → `DigestRow` whose `payload` is `DigestPayload = {headline, sections: [{key, title, lines}], text, signals}`. Renders directly. |
| The transport can register commands | **No.** `TelegramTransport` has `sendMessage`, `answerCallbackQuery`, `editMessageReplyMarkup`, `sendPhoto`, `sendDocument`, `sendMediaGroup`. `setMyCommands` must be added — see §5. |

---

## Scope

**In:** `/help`, `/triage`, `/status`, `/digest`; a command service that owns their semantics; one
authority rule shared with the decision path; `setMyCommands` registration.

**Out**, each deferred deliberately:

| Deferred | Why |
|----------|-----|
| `/approve <id>`, `/reject <id>` | There is no human-readable approval id to type (pre-flight). `/triage` returns live buttons instead, so no second write path is invented. |
| `/pause`, `/resume`, emergency stop | A destructive control deserves more than a chat line. Revisit once the Mini App can show what is about to stop. |
| Inbound intake (a forwarded message becomes an issue) | Idea 062's surface. Different shape, different authority question. |
| Generating a digest on demand | `digestService.generateForCompany` fans out through `deliverThroughChannels`, so one person typing `/digest` would push a digest to every channel and every operator. `/digest` reads the stored latest instead. |
| Per-command rate limiting | The `/triage` cap (§2) is the only real flood risk. A bound user spamming their own chat is self-limiting. |
| Anything Mini App | Phase B. |

---

## 1. One authority rule, one copy

`f501374` put the "is this the bound user" check inline in `telegram-decisions.ts`. Commands need the
same predicate, and two copies of an authority rule drifting apart is exactly the failure that
produced the bulk-triage effects bug (`43b3ee6`).

Extract it to `telegram-link.ts`:

```ts
resolveActingBinding(input: { companyId: string; chatId: string; fromTelegramUserId: string | null })
  : Promise<
      | { ok: true; binding: TelegramBinding }
      | { ok: false; reason: "not_bound" | "not_the_bound_user" | "binding_predates_user_identity" }
    >
```

The three refusal reasons are the ones `TelegramDecisionResult` already carries, so
`telegram-decisions.ts` switches to calling this and drops its inline copy with no change to its
public result type or to any existing test.

**The rule for commands is the same rule, with no exceptions.** All four commands are read-only, but
`/triage` and `/digest` still disclose approval titles and digest narration, and a bound group chat
is readable by everyone in it. The chat says *where*; the Telegram account says *who*. A refusal
replies "Only the person who linked this chat can use commands here."

## 2. `/triage`

The core of the phase. Reads `listTriage`, then sends:

1. **A header**, exactly one of three forms:
   - `0` open: `Nothing to triage.` — and no cards and no footer.
   - `1..5` open: `3 open approvals.`
   - `>5` open: `23 open approvals — showing the 5 highest risk.`
2. **Up to `TRIAGE_CARD_LIMIT = 5` cards**, in the order `listTriage` already sorts them, each built
   by `buildApprovalMessage` fed from `buildApprovalPushBody` — so a `/triage` card and a pushed card
   are byte-identical, including their Approve/Reject `callback_data`.
3. **A footer** when anything was omitted: `18 more · Open in Paperclip →`, the link present only
   when `publicBaseUrl` is set, matching every other link in this channel.

The cap exists because Telegram rate-limits a chat to roughly 20 messages per minute, and because a
wall of 23 cards is not triage. Five plus header plus footer is seven messages — comfortably inside
the limit with room for the approval pushes that may arrive alongside.

**No media.** The push path attaches an approval's screenshots and diagrams; `/triage` does not.
Attaching media to five cards turns one command into up to fifty uploads. The card links to the
board for the full picture.

**Cards are live, not snapshots.** The buttons carry the same `callback_data` as the original push,
so tapping one goes through `decideFromChat` and hits the already-decided guard if it was settled
elsewhere. A stale `/triage` listing is therefore safe by construction — it cannot double-decide.

## 3. `/status`

One message from `dashboardService.summary(companyId)`:

```
📊 Acme
3 approvals waiting
8 agents · 6 active, 1 paused, 1 error
14 tasks open · 2 blocked
```

**No money.** `summary()` returns `monthSpend`, and an earlier draft of this design included it.
It is dropped: spend is the one figure here that no notification ever pushes, and a status line is
not where a budget conversation should start. The Costs page owns that.

A consequence worth recording: with spend gone, nothing `/status` reports is unavailable to anyone
already receiving approval cards in the chat. That makes it *possible* to relax the §1 rule for
`/status` later without disclosing anything new. This spec does not relax it — one rule for all four
commands is easier to hold and easier to document — but the option is now open, which it was not
before.

## 4. `/digest` and `/help`

`/digest` renders `digestService.latest(companyId)`: the payload's `headline` in bold, then each
section's `title` in bold with its `lines` beneath. When no digest exists yet:
`No digest yet — one is generated on the company's schedule.`

`/help` is static text listing the four commands and one line each. It names no company data, so it
is the one command whose output is identical for every caller — but it is still gated by §1, because
replying to an unbound tapper at all confirms the bot is bound to *something* in that chat.

## 5. `setMyCommands`

Add to `TelegramTransport`:

```ts
setMyCommands(input: { botToken: string; commands: { command: string; description: string }[] }): Promise<void>
```

Called from `PUT /companies/:companyId/telegram/config` after a successful save, so the client
autocompletes the grammar the moment the bot is registered or replaced. Best-effort: a failure is
logged and does not fail the save, matching how every other transport call in this channel is
treated. `/start` is excluded from the registered list — it takes a code, is reached by deep link,
and offering it in an autocomplete menu invites a bare `/start` that can only fail.

## 6. Architecture

```
routes/telegram.ts          transport, dispatch, always-200
      │
      │ parseTelegramCommand (exists)
      ▼
telegram-commands.ts        run({companyId, chatId, fromTelegramUserId, command, arg})
      │                       → Promise<TelegramMessage[]>
      ├── telegram-link.ts       resolveActingBinding   ← shared with telegram-decisions.ts
      ├── approval-triage.ts     listTriage
      ├── dashboard.ts           summary
      ├── digest.ts              latest
      └── telegram-format.ts     buildHelpMessage, buildStatusMessage, buildTriageHeader,
                                 buildTriageFooter, buildDigestMessage, buildCommandDeniedMessage
```

`telegramCommandService` takes no transport and sends nothing — it returns the messages to send. That
keeps every command testable without HTTP or a fake transport, and mirrors the existing split where
`telegram-decisions.ts` owns semantics and the route owns transport.

The route sends the returned messages in order, logging and continuing on a per-message failure, as
`telegram-channel.ts` does per chat.

**Dispatch.** `/start` keeps its current branch, ahead of the service, because it is the one command
that must work *before* a binding exists. Everything else goes to the service. An unrecognised
command replies `Unknown command. Try /help.`; a message that is not a command is ignored silently,
as today.

## 7. Error handling

The webhook already answers 200 after authentication and swallows-and-logs, because a non-2xx makes
Telegram retry. Commands sit inside that envelope. Two additions:

- A command whose data source throws logs the error and returns a single generic failure message
  rather than silence, so the operator learns the bot heard them.
- Message text is truncated with the existing `truncateForTelegram` at the documented 4096 limit.
  `/digest` is the realistic overflow risk, since section lines are narration.

## 8. Testing

| File | Covers |
|------|--------|
| `telegram-commands.test.ts` (new, embedded pg) | Each command's output against seeded data; the §1 refusal for a non-bound tapper, an unbound chat, and a pre-0125 binding; the `/triage` cap, header wording either side of it, and footer; empty states for `/triage` and `/digest`. |
| `telegram-format.test.ts` (extend) | New builders: escaping of agent-authored text, the 4096 limit, and that no non-approval builder emits `callback_data`. |
| `telegram-routes.test.ts` (extend) | Dispatch reaches the service; unknown command replies; a non-command message stays silent; `/start` still handled ahead of the service. |
| `telegram-decisions.test.ts` (unchanged) | Must keep passing after the §1 extraction — that is the point of keeping the result type identical. |

A `/triage` test seeding more than the cap, asserting exactly `2 + TRIAGE_CARD_LIMIT` messages and
the omission count in the footer, is the one that pins §2's contract.

## 9. Documentation

`doc/TELEGRAM-CHANNEL.md` gains a "Commands" section: the grammar, the one authority rule, the
`/triage` cap and why it exists, and the note that commands never write. The known-gaps list loses
"No command grammar beyond `/start <code>`" and gains the deferred items from Scope.
