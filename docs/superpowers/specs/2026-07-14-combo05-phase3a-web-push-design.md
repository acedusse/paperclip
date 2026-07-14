# Combo-05 Phase 3a — Web Push Plumbing + Risk-Gated Notification (Design)

> Companion to [`combo-05-phasing-corrected.md`](../../../.ideas/combinations/combo-05-phasing-corrected.md),
> [Phase 1](2026-07-13-combo05-phase1-review-cockpit-design.md),
> [Phase 2a](2026-07-13-combo05-phase2a-auto-approve-design.md),
> [Phase 2b](2026-07-14-combo05-phase2b-narration-digest-design.md).

## Context

Phase 3 of the phasing doc is Web Push / PWA: "only high-band events buzz; deep-link into the
single-item card and resolve in one tap." It is large and external-facing, so it is split into two
cycles:
- **Cycle 3a (this spec)** — the push *plumbing*: VAPID keys, subscriptions, a `webpush` delivery
  channel that actually sends over the Web Push protocol, the risk-gated trigger, the client subscribe
  flow, and a **minimal** service-worker `push` handler so a high-band approval produces a real
  notification end-to-end.
- **Cycle 3b (later)** — making it *actionable*: the SW `notificationclick` deep-link, one-tap
  approve/reject/request-changes action buttons, and per-user delivery prefs (min-band, quiet hours,
  device management).

3a is the first event-driven consumer of the Phase-1 delivery pipeline (2b's digest is scheduled; this
is per-approval). It reuses the pipeline's `getChannels()` fan-out and the `NotificationPayload` type.

## Substrate findings (from exploration)

- A **PWA shell already exists**: `ui/public/site.webmanifest`, `ui/public/sw.js` (currently
  **caching-only** — install/activate/fetch, no `push`/`notificationclick`), registered in
  `ui/src/main.tsx`. 3a adds a `push` handler to the existing `sw.js`.
- **No** `web-push` dependency, no VAPID, no subscription storage, no delivery-prefs tables today.
- `instance_settings` is a singleton row with `general`/`experimental` jsonb + `instanceSettingsService(db)`
  (`get`/`update`).
- The delivery pipeline (`notification-delivery.ts`) has `registerChannel`/`getChannels`; the inbox
  channel (2b) is db-bound and no-ops unless `payload.digest` is present.
- `bandRank` and `RiskBand` are exported from `server/src/services/approval-risk.ts`.

## Locked decisions (from brainstorming)

1. **Send via the `web-push` library** — add `web-push` (+ `@types/web-push`) to `server/package.json`.
   It handles VAPID JWT signing and RFC-8291 payload encryption. Also generates the VAPID keypair.
2. **VAPID keys auto-generated + persisted** in the `instance_settings` singleton under a `push` section
   (`{ vapid: { publicKey, privateKey }, subject }`), lazily on first use. Turnkey; the DB is already the
   trust boundary (company secrets live there). `GET /push/vapid-public-key` serves the public key.
3. **Subscriptions are company-scoped** — `push_subscriptions(companyId, userId, endpoint UNIQUE, p256dh,
   auth, userAgent, …)`. A company's high-band approval sends to that company's subscriptions (no
   user→company access lookup at send time).
4. **`NotificationPayload` gains an optional `push` field** (parallel to `digest`); the webpush channel
   no-ops when it is absent, the inbox channel no-ops when `digest` is absent — one `deliver()` fans out.
5. **Risk gate**: `PUSH_MIN_BAND = "high"` (locked constant; band ≥ high = high or critical). The trigger
   fires on approval create, **after** the 2a auto-approve attempt, only for items still needing a human
   (`status !== "approved"`) whose risk band ≥ `PUSH_MIN_BAND`. Low-band items never buzz — they wait for
   the digest.
6. **Prune dead subscriptions** on `410 Gone` / `404` from the push service.
7. **A shared `deliverThroughChannels(target, payload)` helper** fans out through `getChannels()` with
   per-channel try/catch; extracted from what the digest service open-codes, reused by trigger + digest.
8. **3a includes a minimal SW `push` handler** (`showNotification`); `notificationclick`, action buttons,
   and prefs are 3b.

## Governing principle

Everything is **best-effort** and never throws into approval-create or the tick loop. A missing/failed
VAPID, a rejected `sendNotification`, a dead endpoint, or zero subscriptions degrades or is isolated —
the approval is still created and auto-approve-evaluated. Push can only ever *add* a notification; it can
never affect the decision path.

---

## Section 1 — Data model + VAPID storage

New table `push_subscriptions` (migration `0114`):

```
push_subscriptions
  id            uuid pk default gen_random_uuid()
  company_id    uuid not null → companies(id) on delete cascade
  user_id       text not null                    -- the board user who subscribed this browser
  endpoint      text not null                     -- browser push endpoint (UNIQUE)
  p256dh        text not null                     -- subscription public key
  auth          text not null                     -- subscription auth secret
  user_agent    text                              -- for device listing/debug
  created_at    timestamptz not null default now()
  last_used_at  timestamptz                       -- bumped on successful send; prune candidate
```

Indexes: `unique(endpoint)`; `index(company_id)`.

**VAPID keys** live in the `instance_settings` singleton `general`-adjacent `push` section:
`push: { vapid: { publicKey, privateKey }, subject }`. Auto-generated on first use via
`web-push`'s `generateVAPIDKeys()`. No new column — stored inside the existing settings jsonb (a new
top-level `push` key on the settings row, read/written via `instanceSettingsService`).

Migration hand-written raw SQL + journal entry (drizzle baseline stale — see Phase 1). Next number is
**`0114`** (`0113` is the last).

---

## Section 2 — Send path: `webpush` delivery channel + VAPID service

### VAPID service — `server/src/services/push-vapid.ts`

```ts
pushVapidService(db): {
  getKeys(): Promise<{ publicKey: string; privateKey: string; subject: string }>;  // generate+persist on first call
  ensureInitialised(): Promise<{ publicKey: string } | null>;  // calls webpush.setVapidDetails once/process; null if unavailable
}
```
Lazy + memoised per process: reads `instance_settings.push.vapid`; if absent, `webpush.generateVAPIDKeys()`
and persist; then `webpush.setVapidDetails(subject, publicKey, privateKey)` (once). `subject` defaults to a
constant `mailto:` (overridable from settings). A generation/persist failure returns `null` (push disabled),
never throws.

### webpush channel — `server/src/services/push-notifications.ts`

```ts
export function buildApprovalPushBody(input: { approvalType: string; band: string; companyId: string; approvalId: string }):
  { title: string; body: string; url: string; tag: string; band: string };   // pure, deterministic
export function createWebPushChannel(db: Db): DeliveryChannel;   // name: "webpush"
```
`deliver(target, payload)`:
- If `!target.companyId` or `!payload.push` → no-op.
- `await pushVapidService(db).ensureInitialised()`; if null → no-op (logged once).
- Load `push_subscriptions` for `target.companyId`.
- For each: `webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(payload.push))`
  wrapped in try/catch:
  - success → bump `last_used_at`.
  - error with `statusCode` 404 or 410 → delete that subscription row (browser unsubscribed).
  - other error → log, continue.
- Never throws into the caller; one dead endpoint never blocks the others.

Registered at app startup (`app.ts`) via `registerChannel(createWebPushChannel(db))`, alongside the 2b
inbox channel.

### Shared payload type

Extend `NotificationPayload` (`notification-delivery.ts`) with:
```ts
push?: { title: string; body: string; url: string; tag?: string; band?: string };
```
The inbox channel already keys on `payload.digest`; the webpush channel keys on `payload.push`. One
`deliver()` fans out to whichever channel has relevant content.

---

## Section 3 — Risk-gated trigger + subscription API

### Shared fan-out helper — `notification-delivery.ts`

```ts
export async function deliverThroughChannels(target: DeliveryTarget, payload: NotificationPayload): Promise<void>;
// loops getChannels(); each channel.deliver wrapped in try/catch (logged, never aborts)
```
The digest service is refactored to call this instead of open-coding the loop.

### Trigger — `routes/approvals.ts`, `POST /companies/:companyId/approvals`

After the 2a auto-approve attempt and the `finalApproval` re-read, before responding:
```ts
// Phase 3a: high-band approvals buzz the phone. Best-effort; never blocks create.
if (finalApproval.status !== "approved") {
  const risk = await riskSvc.getSnapshot(approval.id);
  if (risk && bandRank(risk.band as RiskBand) >= bandRank(PUSH_MIN_BAND)) {
    void deliverThroughChannels(
      { companyId },
      {
        kind: "approval_high_risk",
        title: `${risk.band} risk approval needs you`,
        push: buildApprovalPushBody({ approvalType: approval.type, band: risk.band, companyId, approvalId: approval.id }),
      },
    ).catch((err) => logger.warn({ err, approvalId: approval.id }, "high-risk push failed"));
  }
}
```
`PUSH_MIN_BAND = "high"` (locked constant, colocated with the Phase-1 band constants). Auto-approved items
(`status === "approved"`) never buzz; low/medium items never buzz.

### Subscription + VAPID API — `routes/push.ts` (mounted in `app.ts`)

- `GET /push/vapid-public-key` — authenticated (any board user); returns `{ publicKey }`, generating/persisting
  the keypair on first call. **Not** company-scoped (a browser needs it before subscribing).
- `POST /companies/:companyId/push/subscriptions` — board-only; body `{ endpoint, keys: { p256dh, auth },
  userAgent? }`; upsert on `endpoint` (re-subscribe idempotent). Records `userId` from the actor.
- `DELETE /companies/:companyId/push/subscriptions` — board-only; body `{ endpoint }`; deletes it.

Board gating via `assertBoard` + `assertCompanyAccess`. New shared validators
`pushSubscriptionSchema` / `pushUnsubscribeSchema` in `packages/shared` (remember to re-export from the
top-level barrel, not only `validators/index.ts`).

---

## Section 4 — Client subscribe flow + minimal SW push handler

### Client — `ui/src/lib/push.ts` + `ui/src/api/push.ts`

- `pushApi`: `vapidPublicKey()`, `subscribe(companyId, body)`, `unsubscribe(companyId, endpoint)`.
- `subscribeToPush(companyId)`: `Notification.requestPermission()`; if granted, get the SW registration,
  `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <urlBase64ToUint8Array(publicKey)> })`,
  then POST the subscription's `endpoint` + `keys` (`p256dh`/`auth` from `subscription.toJSON().keys`).
- `unsubscribeFromPush(companyId)`: `subscription.unsubscribe()` + DELETE.
- A **"Enable push notifications"** toggle on the `/digest` page (the notifications surface), reflecting
  current `Notification.permission` + subscription state.

### Minimal SW push handler — `ui/public/sw.js`

Add (leaving the existing caching handlers intact):
```js
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Paperclip", {
      body: data.body || "",
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});
```
This makes 3a demonstrable end-to-end (high-band approval → notification appears). `data.url` is carried so
3b's `notificationclick` just reads it.

---

## Section 5 — Error handling & testing

**Failure modes (best-effort; nothing throws into approval-create):**
- VAPID missing/generation fails → `ensureInitialised` returns null → send skipped, logged; create unaffected.
- `sendNotification` rejects → per-subscription catch; `410/404` prunes the row; other errors logged; other
  subscriptions still sent.
- Zero subscriptions → channel no-ops.
- The trigger block is `void … .catch(...)` — the approval is created + auto-approve-evaluated regardless.

**Tests (TDD):**
- **Pure** (`push-notifications.test.ts` for `buildApprovalPushBody`): deterministic title/body/url/tag from
  approval + band.
- **VAPID service** (embedded-pg): first `getKeys` generates + persists; second reads the same keypair (no
  regen); `ensureInitialised` calls `setVapidDetails`.
- **webpush channel** (embedded-pg, `web-push` mocked): seed subscriptions → `deliver` calls
  `sendNotification` once per subscription with the sub's keys; a mocked `{ statusCode: 410 }` deletes that
  row; success bumps `last_used_at`; absent `push` field → no-op; zero subs → no send.
- **Subscription routes** (full app): board upsert (idempotent on `endpoint`) + delete; `GET /push/vapid-public-key`
  returns a key; non-board → 403.
- **Trigger** (full app, `deliverThroughChannels`/web-push mocked): a `high`/`critical` approval invokes the
  webpush send with the approval's link; a `low` approval does not; an auto-approved approval does not.
- **UI** (`push.ts`, jsdom): subscribe flow calls `requestPermission` + `pushManager.subscribe` + POST with
  the endpoint/keys (mock `navigator.serviceWorker`, `PushManager`, `Notification`); the `/digest` toggle
  reflects state.
- The SW `push` handler is **not** unit-tested (no SW harness in repo) — covered by the manual demo / 3b.

**Dependency:** `web-push` + `@types/web-push` added to `server/package.json`.
**Migration:** `0114_combo05_push_subscriptions.sql`.

## File inventory

**New:**
- `packages/db/src/schema/push_subscriptions.ts` + barrel export
- `packages/db/src/migrations/0114_combo05_push_subscriptions.sql` (+ journal)
- `server/src/services/push-vapid.ts` (+ test)
- `server/src/services/push-notifications.ts` (webpush channel + `buildApprovalPushBody`) (+ tests)
- `server/src/routes/push.ts` (+ test)
- `packages/shared/src/validators/push.ts` (subscribe/unsubscribe schemas) (+ test)
- `ui/src/api/push.ts`, `ui/src/lib/push.ts` (+ test)

**Modified:**
- `server/src/services/notification-delivery.ts` — `NotificationPayload.push`; `deliverThroughChannels` helper
- `server/src/services/digest.ts` — use `deliverThroughChannels`
- `server/src/services/index.ts` — exports (`pushVapidService`, `createWebPushChannel`, `buildApprovalPushBody`, `deliverThroughChannels`); also add `bandRank` (currently only exported from `approval-risk.ts`, and the trigger in `routes/approvals.ts` imports service symbols from this barrel)
- `server/src/routes/approvals.ts` — risk-gated trigger; `PUSH_MIN_BAND`
- `server/src/app.ts` — register the webpush channel; mount push routes
- `server/package.json` — `web-push` + `@types/web-push`
- `packages/shared/src/index.ts` — re-export the push validators (top-level barrel)
- `ui/public/sw.js` — minimal `push` handler
- `ui/src/pages/Digest.tsx` — "Enable push notifications" toggle

**Untouched (no-op for existing consumers):** Phase-1/2a/2b decision paths, digest generation (only its
fan-out helper is swapped), risk model.

## Exit criteria

- Subscribing a browser (permission → `pushManager.subscribe` → POST) persists a company-scoped
  `push_subscriptions` row; `GET /push/vapid-public-key` returns the instance key.
- Creating a `high`/`critical` approval sends a Web Push to that company's subscriptions and (with the SW
  `push` handler) a real notification appears; a `low`/`medium` or auto-approved approval sends nothing.
- A `410/404` from the push service prunes the dead subscription.
- All push paths are best-effort: approval-create and the digest tick are unaffected by any push failure.
- Board-only: non-board subscribe/unsubscribe → 403.

## Explicitly out of scope (deferred to 3b / later)

SW `notificationclick` deep-link + focus/navigate; one-tap approve/reject/request-changes action buttons on
the notification; per-user delivery prefs (min-band override, quiet hours); device/subscription management
UI; email channel; digest-as-push (only event-driven high-band approvals push in 3a); configurable
`PUSH_MIN_BAND`.
