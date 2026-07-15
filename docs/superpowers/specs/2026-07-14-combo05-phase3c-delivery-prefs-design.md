# Combo-05 Phase 3c — Delivery Prefs, Device Management & Multi-Company Subscriptions

**Date:** 2026-07-14
**Branch:** `feat/combo05-phase3c-delivery-prefs` (stacks on `feat/combo05-phase3b-actionable-push`, PR #26 → the 2a umbrella branch)
**Depends on:** Phase 3a (web-push plumbing, `push_subscriptions`, `push_vapid_keys`, `webpush` channel) and 3b (actionable push). No dependency on 3b schema (3b added none).

## Problem

Phase 3a/3b deliver push, but bluntly:

1. **One browser can subscribe to only one company.** `push_subscriptions.endpoint` is globally unique and the subscribe upsert reassigns `company_id` on conflict, so a multi-company operator only ever gets pushes for the company they most recently subscribed from. (Spec-sanctioned in 3a, deferred to here — it is a data-model limit, **not** a cross-tenant leak; every upsert is `assertCompanyAccess`-gated.)
2. **No per-user control.** The send path (`createWebPushChannel`) fans a high-band push out to *every* subscription for the company. A user cannot say "only critical" or "not between 22:00 and 08:00" — they get everything at/above the global `PUSH_MIN_BAND` (`high`) or nothing.
3. **No device management.** A user cannot see, name, or remove the individual devices they have registered.

## Scope

**In:** the multi-company data-model fix, per-user delivery prefs (min-band override + quiet hours) consulted by the webpush send path, and a device/prefs management surface on `/digest`.

**Deferred (→ 3d / Phase 4):** request-changes as a push action (requires a new request-changes *decision* endpoint that does not exist today — only `/approve` and `/reject`).

## Decisions (locked during brainstorming)

- **Prefs granularity:** per `(user_id, company_id)`. Applies to all of that user's devices in that company. Device rows carry only presentation (`label`), no prefs.
- **Quiet hours:** suppress push during the window **except** `critical`, which always breaks through. Suppressed items still surface in the digest.
- **Min-band direction:** raise-only. `effectiveFloor = max(system PUSH_MIN_BAND, user min_band)`. A user may pick `high` or `critical`; never below the system floor. Preserves the global "low/medium never buzz" guarantee.
- **Quiet-hours time model:** local `HH:MM` `quiet_start`/`quiet_end` + IANA `timezone` captured from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`) at save time. Evaluated as wall-clock in that tz (DST-correct). A window that wraps midnight (start > end) is supported.
- **UI home:** a "Notifications" section on the existing `/digest` page (which already owns the enable/disable toggle). No new route.

## Architecture

Four units, bottom-up. Each is independently testable.

### A. Data model — migration `0115`

Hand-written raw SQL + `meta/_journal.json` entry (never `drizzle-kit generate`; snapshot baseline stale at 0098). See repo conventions.

**`push_subscriptions` changes**
- Drop unique index `push_subscriptions_endpoint_unique_idx`.
- Add unique index `push_subscriptions_company_endpoint_unique_idx` on `(company_id, endpoint)`. *This is the multi-company fix* — the same browser endpoint may now hold one row per company.
- Add column `label text` (nullable) — user-facing device name.

No existing rows violate the new constraint (the old constraint was strictly tighter), so the migration is data-safe.

**New table `push_delivery_prefs`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk `defaultRandom()` | |
| `company_id` | uuid notNull → `companies(id)` ON DELETE CASCADE | |
| `user_id` | text notNull | actor id (matches `push_subscriptions.user_id`) |
| `min_band` | text notNull default `'high'` | app-constrained to `high`\|`critical` |
| `quiet_start` | text nullable | local `HH:MM` |
| `quiet_end` | text nullable | local `HH:MM` |
| `timezone` | text nullable | IANA tz id |
| `created_at` | timestamptz notNull `defaultNow()` | |
| `updated_at` | timestamptz notNull `defaultNow()` | bumped on upsert |
| unique | `(company_id, user_id)` | one prefs row per user per company |

Drizzle schema file `packages/db/src/schema/push_delivery_prefs.ts`; exported from the schema barrel and the shared re-export barrel (dual-export convention).

### B. Send-path pref consultation (server)

**Pure decision fn** — `shouldPushToUser({ prefs, band, now }): boolean` (new `push-prefs.ts` service, fully unit-tested, no I/O):

```
effectiveFloor = max('high', prefs?.min_band ?? 'high')     // raise-only
if bandRank(band) < bandRank(effectiveFloor): return false
if band === 'critical': return true                          // always breaks quiet hours
if prefs has quiet window AND now (in prefs.timezone) is inside [quiet_start, quiet_end): return false
return true
```

- Wrapping windows (start > end, e.g. 22:00–08:00) are handled.
- "now in tz" derived with `Intl.DateTimeFormat(undefined, { timeZone, hour, minute, hourCycle:'h23' })` on the injected `now: Date` — no wall-clock read inside the pure fn, keeping it deterministic under test.
- Missing/blank quiet fields or an unparseable timezone ⇒ quiet check is skipped (fail-open to "deliver"); an invalid tz never throws in the send path.

**Channel change** — `createWebPushChannel(db).deliver(target, payload)`:
- Load the company's subscriptions (unchanged).
- Load all `push_delivery_prefs` for the company in one query; index by `user_id`.
- For each subscription, evaluate `shouldPushToUser({ prefs: byUser[sub.userId], band: payload.push.band, now: new Date() })`; skip the send when false. Dead-subscription prune and `last_used_at` bump behavior are unchanged for sends that do go out.
- `band` is already carried on `payload.push.band` (built by `buildApprovalPushBody`); if absent, treat as `high` (current trigger only fires ≥ high).

The system-floor gate at the trigger site (`approvals.ts`, `band >= PUSH_MIN_BAND`) stays — per-user prefs only *further* restrict.

### C. Routes (server) — `server/src/routes/push.ts`

All actor-scoped: `assertBoard` + `assertCompanyAccess`, and reads/writes filtered to `getActorInfo(req).actorId`.

- `GET /companies/:companyId/push/prefs` → the actor's prefs, or defaults (`{ minBand: 'high', quietStart: null, quietEnd: null, timezone: null }`) when no row.
- `PUT /companies/:companyId/push/prefs` → upsert on `(company_id, user_id)`, `updated_at = now`. Validated by a new `pushPrefsSchema` (shared): `minBand ∈ {high, critical}`; `quietStart`/`quietEnd` either both `HH:MM` or both null; `timezone` a non-empty string or null. Quiet fields validated as a set (both-or-neither).
- `GET /companies/:companyId/push/subscriptions` → the actor's devices for this company: `{ id, label, userAgent, lastUsedAt, createdAt, endpointTail }` (last ~8 chars of endpoint for display; full endpoint not returned).
- `PATCH /companies/:companyId/push/subscriptions/:id` → rename `label` (validated, actor-owned row only).
- Subscribe (`POST …/subscriptions`): change `onConflictDoUpdate` target from `endpoint` to the composite `(companyId, endpoint)`; accept optional `label` in the body/validator.
- `DELETE …/subscriptions` (by endpoint) stays; delete is already `(company_id, endpoint)`-scoped, correct under the new model.

### D. Client (ui)

**Multi-company unsubscribe fix** — `ui/src/lib/push.ts`:
- `unsubscribeFromPush(companyId)` **must not** call the browser `sub.unsubscribe()` — that revokes the endpoint for *every* company on the browser. It now only calls `pushApi.unsubscribe(companyId, endpoint)` to delete the one server row. The browser `PushSubscription` persists (harmless with zero server rows).
- `subscribeToPush` is unchanged in shape (`pushManager.subscribe` is idempotent for the same VAPID key, so re-subscribing for a second company reuses the same endpoint) — optionally forwards a `label`.

**API** — `ui/src/api/push.ts`: add `getPrefs`, `putPrefs`, `listDevices`, `renameDevice`, `removeDevice`.

**UI** — a "Notifications" section on `/digest` (`ui/src/pages/Digest.tsx`), rendered when `pushSupported()`:
- Prefs panel: min-band select (High / Critical), quiet-hours start/end time inputs, timezone shown read-only (auto-captured on save via `Intl.DateTimeFormat().resolvedOptions().timeZone`). Save → `putPrefs`.
- Device list: label (falls back to a userAgent-derived name or "Unknown device"), last-used, rename, and remove per row. Backed by React Query, invalidated on mutate.

## Testing

- **db:** extend `schema-push.test.ts` — composite unique on `(company_id, endpoint)`, `label` column, `push_delivery_prefs` shape + unique. Migration applies cleanly on embedded-postgres.
- **server unit:** `shouldPushToUser` — band floor (high vs critical prefs), quiet window inside/outside in a non-UTC tz, midnight-wrapping window, critical overrides quiet hours, missing prefs = deliver, invalid tz = deliver (no throw).
- **server integration:** prefs GET default + PUT upsert + validation rejects (min_band `medium`, half-set quiet window, bad tz); device list actor-scoped + rename; **same endpoint subscribed to two companies yields two rows** (multi-company); webpush channel skips a user whose prefs suppress and sends to one who doesn't (web-push mocked — never send real push).
- **ui (jsdom):** `unsubscribeFromPush` calls the API but **not** `sub.unsubscribe()`; prefs save posts the captured timezone; device list renders and remove calls the API.

## Non-goals / follow-ups

- **Request-changes push action** — deferred; needs a new decision endpoint. (3d / Phase 4.)
- **2b digest channel-db coupling** — unrelated latent issue, tracked separately.
- Per-device (vs per-user) prefs — explicitly out; revisit only if a real need appears.

## Task breakdown (one commit each; detailed in the plan)

1. Migration `0115` + `push_delivery_prefs` schema + `push_subscriptions` composite unique + `label` (+ schema test).
2. `shouldPushToUser` pure fn + `createWebPushChannel` prefs consultation (+ unit tests, channel test).
3. Prefs routes (GET/PUT) + `pushPrefsSchema` validator (+ integration).
4. Device routes (list/rename) + composite-conflict subscribe + optional label (+ integration incl. multi-company).
5. Client unsubscribe fix + API methods + `/digest` Notifications UI (+ jsdom tests).
