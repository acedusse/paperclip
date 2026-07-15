# Combo-05 Phase 3b — Actionable Push (deep-link + one-tap resolve) (Design)

> Companion to [`combo-05-phasing-corrected.md`](../../../.ideas/combinations/combo-05-phasing-corrected.md)
> and Phases [1](2026-07-13-combo05-phase1-review-cockpit-design.md),
> [2a](2026-07-13-combo05-phase2a-auto-approve-design.md),
> [2b](2026-07-14-combo05-phase2b-narration-digest-design.md),
> [3a](2026-07-14-combo05-phase3a-web-push-design.md).

## Context

Phase 3a shipped the push *plumbing*: a high-band approval fires a real Web Push to a subscribed
browser, and a minimal service-worker `push` handler renders the notification. **Cycle 3b makes it
actionable** — the phasing doc's Phase-3 exit criterion: *"a high-band approval fires a push that
deep-links to the inline diff and resolves in one tap."*

The Phase-1 approval card (`ApprovalDetail` at `/approvals/:approvalId`) already renders the changeset
diff (Phase 1/2a) and the approve / reject / request-revision buttons. So 3b is small: fix the
deep-link, add notification action buttons, and add a `notificationclick` handler — no schema, no
migration, no new routes (it reuses the Phase-1 decision endpoints).

## Substrate findings (from exploration)

- 3a's `push` handler shows the notification but there is **no `notificationclick` handler** yet.
- The app uses **cookie-session auth** (`credentials: "include"` in `ui/src/api/client.ts`) and has **no
  CSRF middleware** — so a service-worker `fetch` to `/api/approvals/:id/approve` carries the board
  session and succeeds. One-tap resolve from the SW is feasible.
- The board routes are **not** under `/companies/:id/`; the approval detail is `/approvals/:approvalId`
  (company comes from context, and `ApprovalDetail` fetches the approval company-agnostically via
  `approvalsApi.get(id)`). **3a's push `url` (`/companies/{companyId}/approvals/{approvalId}`) is wrong
  and would not resolve** — 3b fixes it.
- Single-item decision endpoints exist: `POST /approvals/:id/approve`, `/reject`,
  `/request-revision` (Phase 1). Approve reuses the shared `applyApprovalApprovedEffects`
  (audit + requester-wakeup), so a one-tap approve through the real endpoint gets full correctness for free.

## Locked decisions (from brainstorming)

1. **Split:** 3b = the actionable notification. Per-user delivery prefs (min-band, quiet hours),
   device-management UI, and the multi-company subscription-model fix are **Cycle 3c**.
2. **Deep-link URL fixed** to `/approvals/{approvalId}`; the `push` payload gains **`approvalId`**.
3. **Notification action buttons** = Approve + Reject (rendered only when the payload carries an
   `approvalId`). One-tap posts the decision from the SW; the notification body-click deep-links to the
   card (where request-changes — which usually wants a note — lives).
4. **Every failure path** (non-OK response, offline, missing `approvalId`, dropped `actions` on
   unsupported platforms) **falls back to opening the approval card**.
5. **Success feedback:** a brief "Approved."/"Rejected." confirmation notification on a successful
   one-tap decision.
6. **One-tap POST sends no `decisionNote`** (`body: "{}"`; the endpoint's note is optional).
7. **No schema, no migration, no new routes** — reuse the Phase-1 decision endpoints and the 3a push
   pipeline.

## Governing principle

The notification degrades gracefully at every layer. Platforms that drop `actions` still show the
notification and still deep-link on body-click. Any one-tap failure lands the operator on the approval
card. The one-tap actions call the *real* Phase-1 decision routes, so audit, requester-wakeup, and the
authority resolver all apply identically to a click in the app — the SW is just another client.

---

## Section 1 — Payload + deep-link fix

In `server/src/services/push-notifications.ts`, `buildApprovalPushBody`:
- Change `url` from `/companies/${companyId}/approvals/${approvalId}` → **`/approvals/${approvalId}`**.
- Add **`approvalId: input.approvalId`** to the returned object.

In `server/src/services/notification-delivery.ts`, extend the `push` field of `NotificationPayload`:
```ts
push?: { title: string; body: string; url: string; tag?: string; band?: string; approvalId?: string };
```
`approvalId` is optional on the type (other future push kinds may omit it), but `buildApprovalPushBody`
always sets it. No new tables, no migration.

The risk-gated trigger (`routes/approvals.ts`) already calls `buildApprovalPushBody(...)`, so it emits
the corrected url + `approvalId` with no change to the trigger itself.

---

## Section 2 — Service-worker `push` handler: action buttons

Extend the 3a handler in `ui/public/sw.js`:
```js
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const isApproval = typeof data.approvalId === "string";
  event.waitUntil(
    self.registration.showNotification(data.title || "Paperclip", {
      body: data.body || "",
      tag: data.tag,
      data: { url: data.url, approvalId: data.approvalId ?? null },
      actions: isApproval
        ? [
            { action: "approve", title: "Approve" },
            { action: "reject", title: "Reject" },
          ]
        : [],
    }),
  );
});
```
- Actions appear only when `data.approvalId` is present (non-approval pushes degrade to no actions).
- `data.url` + `data.approvalId` are stashed on the notification for `notificationclick`.
- Platforms that drop `actions` (iOS Safari; desktop past the action limit) still show the notification;
  body-click still deep-links.

---

## Section 3 — Service-worker `notificationclick` handler

New in `ui/public/sw.js`:
```js
self.addEventListener("notificationclick", (event) => {
  const { url, approvalId } = event.notification.data || {};
  event.notification.close();

  if ((event.action === "approve" || event.action === "reject") && approvalId) {
    event.waitUntil(
      fetch(`/api/approvals/${approvalId}/${event.action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
        .then((res) => {
          if (res.ok) {
            return self.registration.showNotification("Paperclip", {
              body: event.action === "approve" ? "Approved." : "Rejected.",
              tag: `approval-${approvalId}-done`,
            });
          }
          return openApproval(url);
        })
        .catch(() => openApproval(url)),
    );
    return;
  }

  event.waitUntil(openApproval(url));
});

function openApproval(url) {
  const target = url || "/";
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (client.url.endsWith(target) && "focus" in client) return client.focus();
    }
    return self.clients.openWindow(target);
  });
}
```
- One-tap Approve/Reject POST the real Phase-1 decision endpoint (`credentials:"include"` → board
  session; no CSRF gate). Success → confirmation notification. Any non-OK / offline → open the card.
- Body-click (or unknown action) focuses an existing tab at the card if open, else opens a new one.

---

## Section 4 — Testing & error handling

**Automated test surface is thin** — `ui/public/sw.js` is a classic service worker with no test harness
in this repo (same limitation as the 3a push handler). Coverage:
- **Pure** (`server/src/services/push-notifications.test.ts`, extended): `buildApprovalPushBody` returns
  `url === "/approvals/{id}"` and `approvalId === {id}` (and no longer the `/companies/...` form).
- **Integration** (`server/src/__tests__/webpush-channel.test.ts`, extended): assert the JSON string
  handed to the mocked `webpush.sendNotification` parses to an object containing `approvalId` and
  `url: "/approvals/{id}"` — end-to-end payload coverage from build → channel send.
- **Manual-demo verified (checklist in this spec):** the SW action buttons + `notificationclick`. There
  is no SW unit harness; the handler is written defensively and verified by demo.

**Manual verification checklist** (documented for the implementer / reviewer):
1. Subscribe a browser (3a `/digest` toggle), create a `high`/`critical` approval → a notification with
   Approve/Reject buttons appears.
2. Tap **Approve** → the approval becomes `approved` (verify in the app / activity log) and a "Approved."
   confirmation shows.
3. Tap the notification **body** → a tab opens/focuses at `/approvals/{id}` showing the diff + buttons.
4. Approve the same item twice (or approve an already-resolved one) → the second one-tap falls back to
   opening the card (no crash).

**Error handling** (all in the SW, all degrade to "open the card"): non-OK decision response
(already-resolved / 403 / 422), offline fetch rejection, missing `approvalId`, dropped `actions`.

## File inventory

**Modified:**
- `server/src/services/push-notifications.ts` — `buildApprovalPushBody` (url → `/approvals/:id`, add `approvalId`)
- `server/src/services/notification-delivery.ts` — `NotificationPayload.push` gains optional `approvalId`
- `ui/public/sw.js` — `push` handler action buttons + `notificationclick` handler + `openApproval` helper
- Tests: `server/src/services/push-notifications.test.ts`, `server/src/__tests__/webpush-channel.test.ts`

**New:** none.

**Untouched (no behavior change):** the risk-gated trigger (emits the corrected payload for free), all
decision/audit/wakeup paths, the webpush channel send loop, schema.

## Exit criteria

- A high-band push shows Approve/Reject buttons; tapping one POSTs the real decision endpoint, the
  approval resolves (with full audit + requester-wakeup), the notification closes, and a confirmation
  shows.
- Tapping the notification body opens/focuses the approval card at `/approvals/{id}` (the diff + buttons).
- Every one-tap failure (already-resolved, 403/422, offline) falls back to opening the card.
- Non-approval pushes and platforms without `actions` degrade to the body-click deep-link.
- `buildApprovalPushBody` emits `/approvals/{id}` + `approvalId`; the sent push JSON carries both.

## Explicitly out of scope (deferred to 3c / later)

Per-user delivery prefs (min-band override, quiet hours); device/subscription-management UI; the
multi-company subscription-model fix (one browser → many companies); request-changes as a notification
action; rich notification payloads (images, inline diff preview); an in-repo service-worker test harness.
