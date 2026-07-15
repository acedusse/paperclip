# Combo-05 Phase 3b — Actionable Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A high-band push shows Approve/Reject buttons that resolve the approval in one tap (SW POST to the real Phase-1 decision endpoints), and the notification body deep-links to the approval card; every failure falls back to opening the card.

**Architecture:** Fix `buildApprovalPushBody` to emit the correct deep-link (`/approvals/:id`) plus an `approvalId`, widen `NotificationPayload.push` to carry it, and add a service-worker `push` action-button config + a `notificationclick` handler. No schema, no migration, no new routes — the one-tap actions call the existing `POST /approvals/:id/approve|reject` endpoints (cookie session, no CSRF), so audit + requester-wakeup apply for free.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest + embedded-postgres for the channel test, a classic service worker (`ui/public/sw.js`, plain JS, no test harness).

## Global Constraints

- Language/module: TypeScript, ESM; **all relative imports use `.js` extensions** (server/shared). `ui/public/sw.js` is plain classic-worker JS — no imports, no `.js`-specifier rules; match its existing style.
- Server DB tests use the embedded-postgres harness (`describeEmbeddedPostgres`); `web-push` is **mocked** in every server test (never send a real push) — the existing `server/src/__tests__/webpush-channel.test.ts` already sets up the mock; reuse it.
- Pure (no-DB) tests are plain vitest files colocated as `*.test.ts`.
- **No schema, no migration, no new routes** this cycle.
- The deep-link URL MUST be `/approvals/{approvalId}` (the real board route; `ApprovalDetail` fetches the approval company-agnostically). NOT `/companies/{companyId}/...` (3a's bug).
- One-tap actions POST `/api/approvals/{approvalId}/{approve|reject}` with `credentials: "include"`, `Content-Type: application/json`, `body: "{}"` (no `decisionNote`).
- Every SW failure path (non-OK response, offline, missing `approvalId`, dropped `actions`) degrades to opening the approval card.
- `ui/public/sw.js` has **no test harness** — validate it with `node --check ui/public/sw.js` (syntax only) and the manual checklist in the spec; do not fabricate a passing SW unit test.
- Follow the file-header comment block convention for existing files (do not strip `sw.js`'s header).

---

## File Structure

**Modified:**
- `server/src/services/push-notifications.ts` — `buildApprovalPushBody` (url → `/approvals/:id`, add `approvalId`).
- `server/src/services/notification-delivery.ts` — `NotificationPayload.push` gains optional `approvalId`.
- `server/src/services/push-notifications.test.ts` — update the url assertion, add an `approvalId` assertion.
- `server/src/__tests__/webpush-channel.test.ts` — add an end-to-end payload assertion (built payload → sent JSON).
- `ui/public/sw.js` — `push` handler action buttons + `notificationclick` handler + `openApproval` helper.

**New:** none.

---

### Task 1: Payload — fix deep-link, add `approvalId` (server, tested)

**Files:**
- Modify: `server/src/services/push-notifications.ts`
- Modify: `server/src/services/notification-delivery.ts`
- Modify: `server/src/services/push-notifications.test.ts`
- Modify: `server/src/__tests__/webpush-channel.test.ts`

**Interfaces:**
- Produces: `buildApprovalPushBody(...)` now returns `{ title, body, url: "/approvals/{id}", tag, band, approvalId }`. `NotificationPayload.push` gains optional `approvalId: string`.

- [ ] **Step 1: Update the pure test (RED)**

In `server/src/services/push-notifications.test.ts`, change the url assertion and add an approvalId assertion:
```ts
expect(a.url).toBe("/approvals/ap1");
expect(a.approvalId).toBe("ap1");
```
(Replace the existing `expect(a.url).toBe("/companies/c1/approvals/ap1");` line. Keep the determinism assertion and the other field assertions.)

- [ ] **Step 2: Run the pure test to verify it fails**

Run: `pnpm exec vitest run server/src/services/push-notifications.test.ts`
Expected: FAIL (url is still `/companies/...`, `approvalId` undefined).

- [ ] **Step 3: Fix `buildApprovalPushBody`**

In `server/src/services/push-notifications.ts`, change the returned object:
```ts
export function buildApprovalPushBody(input: { approvalType: string; band: string; companyId: string; approvalId: string }) {
  return {
    title: `${input.band} risk approval`,
    body: `${input.approvalType} — tap to review`,
    url: `/approvals/${input.approvalId}`,
    tag: `approval-${input.approvalId}`,
    band: input.band,
    approvalId: input.approvalId,
  };
}
```
(`companyId` stays in the input signature — the trigger passes it — it's just no longer used in the url. Leave the param to avoid churning the caller.)

- [ ] **Step 4: Widen the payload type**

In `server/src/services/notification-delivery.ts`, extend the `push` field of `NotificationPayload`:
```ts
push?: { title: string; body: string; url: string; tag?: string; band?: string; approvalId?: string };
```

- [ ] **Step 5: Run the pure test to verify it passes**

Run: `pnpm exec vitest run server/src/services/push-notifications.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the end-to-end channel payload assertion**

In `server/src/__tests__/webpush-channel.test.ts`, add a new test case within the existing `describeEmbeddedPostgres` block (mirror the seeding of the existing fan-out test — a company + one subscription; `web-push` is already mocked at the top of the file). Import `buildApprovalPushBody` from `../services/push-notifications.js` at the top. Then:
```ts
it("sends a payload built by buildApprovalPushBody carrying approvalId and the /approvals url", async () => {
  const channel = createWebPushChannel(db);
  (webpush as any).sendNotification.mockClear();
  const push = buildApprovalPushBody({ approvalType: "hire_agent", band: "critical", companyId, approvalId: "ap-xyz" });
  await channel.deliver({ companyId }, { kind: "approval_high_risk", title: "t", push });
  expect((webpush as any).sendNotification).toHaveBeenCalledTimes(1);
  const sentBody = (webpush as any).sendNotification.mock.calls[0][1] as string;
  const parsed = JSON.parse(sentBody);
  expect(parsed.approvalId).toBe("ap-xyz");
  expect(parsed.url).toBe("/approvals/ap-xyz");
});
```
(Seed the company + one subscription the same way the existing "fan-out" test does; if the file's setup already seeds them per-test in `beforeEach`/the test body, reuse that. The mocked `sendNotification` receives `(subscription, JSON.stringify(payload.push))` — index `[1]` is the JSON string.)

- [ ] **Step 7: Run the channel test to verify it passes**

Run: `pnpm exec vitest run server/src/__tests__/webpush-channel.test.ts`
Expected: PASS (existing cases + the new payload assertion).

- [ ] **Step 8: Commit**

```bash
git add server/src/services/push-notifications.ts server/src/services/notification-delivery.ts server/src/services/push-notifications.test.ts server/src/__tests__/webpush-channel.test.ts
git commit -m "feat(combo-05): fix push deep-link to /approvals/:id + carry approvalId"
```

---

### Task 2: Service-worker action buttons + `notificationclick` handler

**Files:**
- Modify: `ui/public/sw.js`

**Interfaces:**
- Consumes: the push payload's `approvalId` + `url` (Task 1). Calls `POST /api/approvals/:id/{approve|reject}`.

There is no SW test harness — this task is careful, defensive code plus a syntax check and the manual checklist from the spec. Do not write a fabricated SW unit test.

- [ ] **Step 1: Add action buttons to the `push` handler**

In `ui/public/sw.js`, replace the existing `push` listener body so an approval push renders action buttons and stashes `approvalId`:
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

- [ ] **Step 2: Add the `notificationclick` handler + `openApproval` helper**

Immediately after the `push` listener (before `// [END: module]`), add:
```js
self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const url = data.url;
  const approvalId = data.approvalId;
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
Keep the existing `install`/`activate`/`fetch` handlers and the file header/`// [END: module]` marker intact.

- [ ] **Step 3: Syntax-check the service worker**

Run: `node --check ui/public/sw.js`
Expected: exits 0, no output (valid syntax). (This validates parse only — SW globals like `self`/`clients` are not resolved by `--check`, which is correct.)

- [ ] **Step 4: Manual verification note**

The SW behavior is not unit-testable in this repo. Record in the task report that the spec's manual checklist (subscribe → high-band approval → Approve/Reject one-tap resolves + confirmation; body-click opens `/approvals/:id`; double-approve falls back to opening the card) is the acceptance path, to be run against a real browser during QA.

- [ ] **Step 5: Commit**

```bash
git add ui/public/sw.js
git commit -m "feat(combo-05): SW approve/reject action buttons + notificationclick deep-link"
```

---

### Task 3: Full-suite + typecheck gate

**Files:** none (verification only).

- [ ] **Step 1: Run the touched suites**

Run:
```bash
pnpm exec vitest run \
  server/src/services/push-notifications.test.ts \
  server/src/__tests__/webpush-channel.test.ts \
  server/src/__tests__/approvals-high-risk-push.test.ts
```
Expected: all PASS (the trigger test still passes — it doesn't assert the url, and the corrected payload flows through unchanged).

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm --filter @paperclipai/server exec tsc --noEmit
```
Expected: no type errors. (The `push` type widened additively; no consumer breaks. UI/db/shared untouched, but run `pnpm --filter @paperclipai/ui exec tsc --noEmit` too if any UI file was touched — none should be this cycle.)

- [ ] **Step 3: Syntax-check the SW once more**

Run: `node --check ui/public/sw.js`
Expected: exits 0.

- [ ] **Step 4: Full suite**

Run: `pnpm test`
Expected: full suite PASS. (The 2 pre-existing date-flaky `ui/src/components/artifacts/ArtifactCard.test.tsx` failures are unrelated — see prior phases.)

- [ ] **Step 5: Commit (if any churn)**

```bash
git add -A
git commit -m "test(combo-05): Phase 3b full-suite + typecheck green" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- Deep-link URL fixed to `/approvals/:id` + `approvalId` added → Task 1. ✔
- `NotificationPayload.push` widened → Task 1. ✔
- End-to-end payload coverage (built payload → sent JSON) → Task 1 Step 6. ✔
- SW action buttons (Approve/Reject, only when `approvalId` present) → Task 2 Step 1. ✔
- SW `notificationclick`: one-tap POST → confirmation; failure/offline → open card; body → focus-or-open → Task 2 Step 2. ✔
- No schema/migration/routes → confirmed (none in the plan). ✔
- Best-effort/degrade-to-card at every failure → Task 2's `.then(res.ok?…:openApproval).catch(openApproval)` and the missing-`approvalId` fallthrough. ✔
- Manual-demo acceptance (no SW harness) → Task 2 Step 4 + spec checklist. ✔
- Full-suite + typecheck + SW syntax → Task 3. ✔
- Out of scope (prefs, device mgmt, multi-company, request-changes action) → not implemented. ✔

**Placeholder scan:** No "TBD"/"handle edge cases". The one bounded judgement point — reusing the existing webpush-channel test's company/subscription seeding for the new assertion (Task 1 Step 6) — names the concrete pattern to mirror.

**Type consistency:** `buildApprovalPushBody` return shape (now with `approvalId`) is assignable to the widened `NotificationPayload.push` (Task 1). The SW reads `data.approvalId`/`data.url` set by the push handler from the same payload. The one-tap POST path `/api/approvals/{approvalId}/{approve|reject}` matches the Phase-1 routes (`POST /approvals/:id/approve|reject`, mounted under `/api`). `companyId` remains in `buildApprovalPushBody`'s input (unused in the url now) so the trigger caller is unchanged.
