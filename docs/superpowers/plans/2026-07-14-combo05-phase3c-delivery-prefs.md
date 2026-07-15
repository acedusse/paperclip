# Combo-05 Phase 3c — Delivery Prefs, Device Management & Multi-Company Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one browser subscribe to many companies, give each user per-company push prefs (raise-only min-band + quiet hours) that the send path honors, and add a device/prefs surface to `/digest`.

**Architecture:** A migration widens `push_subscriptions` uniqueness to `(company_id, endpoint)` and adds a `label`; a new `push_delivery_prefs` table holds per-`(company,user)` prefs. A pure `shouldPushToUser` fn gates each send in `createWebPushChannel`. Actor-scoped prefs + device routes back a Notifications section on `/digest`. The client stops calling the browser's `sub.unsubscribe()`.

**Tech Stack:** TypeScript, Drizzle ORM + hand-written raw-SQL migrations, embedded-postgres for server/db tests, Express + supertest, Zod validators (shared package), React + TanStack Query + Vitest/jsdom on the UI.

## Global Constraints

- **Migrations are hand-written raw SQL** + a `meta/_journal.json` entry. NEVER run `drizzle-kit generate` (snapshot baseline stale at 0098). Next migration index is **0115**.
- **`web-push` is MOCKED in every server test** — never send real push. Copy the `vi.mock("web-push", …)` block from existing push tests.
- **Bands:** `RiskBand = "low" | "medium" | "high" | "critical"`, `RISK_BAND_ORDER` in that order; `bandRank(b)` = index. System push floor `PUSH_MIN_BAND = "high"`.
- **Min-band is raise-only:** `effectiveFloor = max(system "high", user minBand)`. Users may only choose `high` or `critical`.
- **Quiet hours:** suppress unless `band === "critical"` (always breaks through). Local `HH:MM` + IANA `timezone`; wrapping windows (start > end) supported; any missing/invalid field ⇒ skip quiet check (deliver).
- **Actor scoping:** prefs and device rows are keyed to `getActorInfo(req).actorId`. All push routes are `assertBoard(req)` + `assertCompanyAccess(req, companyId)` gated.
- **Dual-barrel export:** new schema tables are exported from `packages/db/src/schema/index.ts` (propagates to `@paperclipai/db`); new validators from `packages/shared/src/validators/push.ts` + re-exported in `packages/shared/src/index.ts`.
- **Commit style:** end messages with the repo's `Co-Authored-By` / `Claude-Session` trailers.

---

### Task 1: DB — migration 0115, `push_delivery_prefs`, composite unique + `label`

**Files:**
- Create: `packages/db/src/schema/push_delivery_prefs.ts`
- Modify: `packages/db/src/schema/push_subscriptions.ts`
- Modify: `packages/db/src/schema/index.ts` (add export)
- Create: `packages/db/src/migrations/0115_combo05_push_delivery_prefs.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Test: `packages/db/src/__tests__/schema-push.test.ts`

**Interfaces:**
- Produces: `pushDeliveryPrefs` table + `PushDeliveryPrefsRow` type (cols `id, companyId, userId, minBand, quietStart, quietEnd, timezone, createdAt, updatedAt`); `pushSubscriptions.label` column; composite unique index `push_subscriptions_company_endpoint_unique_idx`.

- [ ] **Step 1: Write the failing schema test**

Append to `packages/db/src/__tests__/schema-push.test.ts` (inside the existing `describe`, after the current `it`):

```ts
  it("exposes push_delivery_prefs and a label column on push_subscriptions", async () => {
    const { pushDeliveryPrefs } = await import("../schema/index.js");
    expect(pushDeliveryPrefs).toBeDefined();
    expect(pushSubscriptions.label).toBeDefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/db test -- schema-push`
Expected: FAIL — `pushDeliveryPrefs` is not exported / `pushSubscriptions.label` undefined.

- [ ] **Step 3: Add the `label` column and composite unique to `push_subscriptions`**

Edit `packages/db/src/schema/push_subscriptions.ts` — add `label` after `userAgent`, and replace the endpoint unique index with the composite one:

```ts
    userAgent: text("user_agent"),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => ({
    companyEndpointUniqueIdx: uniqueIndex("push_subscriptions_company_endpoint_unique_idx").on(
      table.companyId,
      table.endpoint,
    ),
    companyIdx: index("push_subscriptions_company_idx").on(table.companyId),
  }),
```

- [ ] **Step 4: Create the `push_delivery_prefs` schema file**

Create `packages/db/src/schema/push_delivery_prefs.ts`:

```ts
// [START: module]
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const pushDeliveryPrefs = pgTable(
  "push_delivery_prefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    minBand: text("min_band").notNull().default("high"),
    quietStart: text("quiet_start"),
    quietEnd: text("quiet_end"),
    timezone: text("timezone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUserUniqueIdx: uniqueIndex("push_delivery_prefs_company_user_unique_idx").on(
      table.companyId,
      table.userId,
    ),
  }),
);
export type PushDeliveryPrefsRow = typeof pushDeliveryPrefs.$inferSelect;
// [END: module]
```

- [ ] **Step 5: Export the new table from the schema barrel**

Edit `packages/db/src/schema/index.ts` — add after the `pushVapidKeys` export (line ~106):

```ts
export { pushDeliveryPrefs, type PushDeliveryPrefsRow } from "./push_delivery_prefs.js";
```

- [ ] **Step 6: Write the raw-SQL migration**

Create `packages/db/src/migrations/0115_combo05_push_delivery_prefs.sql`:

```sql
DROP INDEX IF EXISTS "push_subscriptions_endpoint_unique_idx";
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "label" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_company_endpoint_unique_idx" ON "push_subscriptions" ("company_id","endpoint");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_delivery_prefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "min_band" text DEFAULT 'high' NOT NULL,
  "quiet_start" text,
  "quiet_end" text,
  "timezone" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_delivery_prefs_company_user_unique_idx" ON "push_delivery_prefs" ("company_id","user_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_delivery_prefs" ADD CONSTRAINT "push_delivery_prefs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
```

- [ ] **Step 7: Register the migration in the journal**

Edit `packages/db/src/migrations/meta/_journal.json` — append to the `entries` array (after idx 114):

```json
  {
   "idx": 115,
   "version": "7",
   "when": 1784400000000,
   "tag": "0115_combo05_push_delivery_prefs",
   "breakpoints": true
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/db test -- schema-push`
Expected: PASS (both `it`s).

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema/push_delivery_prefs.ts packages/db/src/schema/push_subscriptions.ts packages/db/src/schema/index.ts packages/db/src/migrations/0115_combo05_push_delivery_prefs.sql packages/db/src/migrations/meta/_journal.json packages/db/src/__tests__/schema-push.test.ts
git commit -m "feat(combo-05): 3c migration 0115 — push_delivery_prefs + multi-company subscriptions"
```

---

### Task 2: Server — `shouldPushToUser` pure fn + channel consults prefs

**Files:**
- Create: `server/src/services/push-prefs.ts`
- Create: `server/src/services/push-prefs.test.ts`
- Modify: `server/src/services/push-notifications.ts`
- Modify: `server/src/services/index.ts` (export)
- Test: `server/src/__tests__/webpush-channel.test.ts` (add prefs cases)

**Interfaces:**
- Consumes: `bandRank`, `RiskBand` from `./approval-risk.js`; `pushDeliveryPrefs` from Task 1.
- Produces: `type DeliveryPrefs = { minBand: RiskBand; quietStart: string | null; quietEnd: string | null; timezone: string | null }`; `shouldPushToUser(input: { prefs: DeliveryPrefs | null; band: RiskBand; now: Date }): boolean`.

- [ ] **Step 1: Write the failing unit test**

Create `server/src/services/push-prefs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldPushToUser } from "./push-prefs.js";

const at = (iso: string) => new Date(iso);

describe("shouldPushToUser", () => {
  it("delivers high band with no prefs (system floor)", () => {
    expect(shouldPushToUser({ prefs: null, band: "high", now: at("2026-07-14T12:00:00Z") })).toBe(true);
  });

  it("suppresses high when user floor is critical", () => {
    const prefs = { minBand: "critical" as const, quietStart: null, quietEnd: null, timezone: null };
    expect(shouldPushToUser({ prefs, band: "high", now: at("2026-07-14T12:00:00Z") })).toBe(false);
    expect(shouldPushToUser({ prefs, band: "critical", now: at("2026-07-14T12:00:00Z") })).toBe(true);
  });

  it("suppresses non-critical inside a quiet window evaluated in the user's tz", () => {
    // 04:00 UTC == 00:00 America/New_York (EDT, UTC-4) → inside 22:00–08:00
    const prefs = { minBand: "high" as const, quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" };
    expect(shouldPushToUser({ prefs, band: "high", now: at("2026-07-14T04:00:00Z") })).toBe(false);
  });

  it("lets critical break through quiet hours", () => {
    const prefs = { minBand: "high" as const, quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" };
    expect(shouldPushToUser({ prefs, band: "critical", now: at("2026-07-14T04:00:00Z") })).toBe(true);
  });

  it("delivers outside the quiet window", () => {
    // 18:00 UTC == 14:00 America/New_York → outside 22:00–08:00
    const prefs = { minBand: "high" as const, quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" };
    expect(shouldPushToUser({ prefs, band: "high", now: at("2026-07-14T18:00:00Z") })).toBe(true);
  });

  it("fails open (delivers) on an invalid timezone", () => {
    const prefs = { minBand: "high" as const, quietStart: "22:00", quietEnd: "08:00", timezone: "Not/AZone" };
    expect(shouldPushToUser({ prefs, band: "high", now: at("2026-07-14T04:00:00Z") })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- push-prefs`
Expected: FAIL — cannot find `./push-prefs.js`.

- [ ] **Step 3: Implement the pure fn**

Create `server/src/services/push-prefs.ts`:

```ts
// [START: module]
import { bandRank, type RiskBand } from "./approval-risk.js";

const SYSTEM_PUSH_MIN_BAND: RiskBand = "high";

export type DeliveryPrefs = {
  minBand: RiskBand;
  quietStart: string | null;
  quietEnd: string | null;
  timezone: string | null;
};

function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesInTz(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  } catch {
    return null;
  }
}

function inQuietWindow(prefs: DeliveryPrefs, now: Date): boolean {
  if (!prefs.quietStart || !prefs.quietEnd || !prefs.timezone) return false;
  const start = parseHHMM(prefs.quietStart);
  const end = parseHHMM(prefs.quietEnd);
  const mins = minutesInTz(now, prefs.timezone);
  if (start === null || end === null || mins === null || start === end) return false;
  return start < end ? mins >= start && mins < end : mins >= start || mins < end;
}

/** Decide whether one user should receive a push for `band` at `now`, given their prefs. Pure. */
export function shouldPushToUser({
  prefs,
  band,
  now,
}: {
  prefs: DeliveryPrefs | null;
  band: RiskBand;
  now: Date;
}): boolean {
  const userFloor = prefs?.minBand ?? SYSTEM_PUSH_MIN_BAND;
  const floor = bandRank(userFloor) > bandRank(SYSTEM_PUSH_MIN_BAND) ? userFloor : SYSTEM_PUSH_MIN_BAND;
  if (bandRank(band) < bandRank(floor)) return false;
  if (band === "critical") return true;
  if (prefs && inQuietWindow(prefs, now)) return false;
  return true;
}
// [END: module]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/server test -- push-prefs`
Expected: PASS (6 assertions across cases).

- [ ] **Step 5: Wire pref consultation into the webpush channel**

Edit `server/src/services/push-notifications.ts`. Update imports:

```ts
import { eq } from "drizzle-orm";
import webpush from "web-push";
import type { Db } from "@paperclipai/db";
import { pushSubscriptions, pushDeliveryPrefs } from "@paperclipai/db";
import type { DeliveryChannel } from "./notification-delivery.js";
import { pushVapidService } from "./push-vapid.js";
import { shouldPushToUser } from "./push-prefs.js";
import type { RiskBand } from "./approval-risk.js";
import { logger } from "../middleware/logger.js";
```

Inside `deliver`, after loading `subs` (the `const subs = …` line), add the prefs lookup and per-sub gate. Replace the `for (const sub of subs)` loop opening so the first statement is the gate:

```ts
      const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.companyId, target.companyId));
      const prefRows = await db
        .select()
        .from(pushDeliveryPrefs)
        .where(eq(pushDeliveryPrefs.companyId, target.companyId));
      const prefsByUser = new Map(
        prefRows.map((r) => [
          r.userId,
          { minBand: r.minBand as RiskBand, quietStart: r.quietStart, quietEnd: r.quietEnd, timezone: r.timezone },
        ]),
      );
      const band = (payload.push.band as RiskBand | undefined) ?? "high";
      const now = new Date();
      const body = JSON.stringify(payload.push);
      for (const sub of subs) {
        if (!shouldPushToUser({ prefs: prefsByUser.get(sub.userId) ?? null, band, now })) continue;
        try {
```

(The rest of the loop body — send, prune-on-404/410, `lastUsedAt` bump — is unchanged. Remove the now-duplicated `const body = JSON.stringify(payload.push);` that previously sat above the loop.)

- [ ] **Step 6: Export the fn from the service barrel**

Edit `server/src/services/index.ts` — after the `createWebPushChannel` export (line ~64):

```ts
export { shouldPushToUser, type DeliveryPrefs } from "./push-prefs.js";
```

- [ ] **Step 7: Add a channel integration test for prefs suppression**

Append a test to `server/src/__tests__/webpush-channel.test.ts` (inside the `describeEmbeddedPostgres` block; it already seeds `user-1`/`user-2` subs and mocks `web-push`). Import `pushDeliveryPrefs` at the top alongside the existing db imports, then:

```ts
  it("suppresses a user whose prefs raise the floor to critical, still sends to others", async () => {
    vi.mocked(webpush.sendNotification).mockClear();
    await db.insert(pushDeliveryPrefs).values({
      companyId,
      userId: "user-1",
      minBand: "critical",
    });
    const channel = createWebPushChannel(db);
    await channel.deliver(
      { companyId },
      { kind: "approval_high_risk", title: "t", push: buildApprovalPushBody({ approvalType: "x", band: "high", companyId, approvalId: "a1" }) },
    );
    // user-1 suppressed (floor=critical, band=high); user-2 has no prefs → delivered
    expect(vi.mocked(webpush.sendNotification)).toHaveBeenCalledTimes(1);
    await db.delete(pushDeliveryPrefs);
  });
```

- [ ] **Step 8: Run the channel + unit tests**

Run: `pnpm --filter @paperclipai/server test -- push-prefs webpush-channel`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/services/push-prefs.ts server/src/services/push-prefs.test.ts server/src/services/push-notifications.ts server/src/services/index.ts server/src/__tests__/webpush-channel.test.ts
git commit -m "feat(combo-05): 3c send path consults per-user delivery prefs (shouldPushToUser)"
```

---

### Task 3: Server — prefs routes (GET/PUT) + `pushPrefsSchema`

**Files:**
- Modify: `packages/shared/src/validators/push.ts`
- Modify: `packages/shared/src/index.ts` (re-export)
- Modify: `packages/shared/src/validators/push.test.ts`
- Modify: `server/src/routes/push.ts`
- Test: `server/src/__tests__/push-routes.test.ts`

**Interfaces:**
- Consumes: `pushDeliveryPrefs` (Task 1); `getActorInfo`, `assertBoard`, `assertCompanyAccess`, `validate`.
- Produces: `pushPrefsSchema` / `PushPrefsInput` (`{ minBand: "high"|"critical"; quietStart: string|null; quietEnd: string|null; timezone: string|null }`); routes `GET`/`PUT /companies/:companyId/push/prefs`. GET response shape = `PushPrefsInput`.

- [ ] **Step 1: Write the failing validator test**

Append to `packages/shared/src/validators/push.test.ts`:

```ts
import { pushPrefsSchema } from "./push.js";

describe("pushPrefsSchema", () => {
  const base = { minBand: "high", quietStart: null, quietEnd: null, timezone: null };
  it("accepts a minimal prefs object", () => {
    expect(pushPrefsSchema.parse(base).minBand).toBe("high");
  });
  it("accepts a full quiet window with tz", () => {
    expect(pushPrefsSchema.parse({ minBand: "critical", quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" }).quietStart).toBe("22:00");
  });
  it("rejects a below-floor min band", () => {
    expect(() => pushPrefsSchema.parse({ ...base, minBand: "medium" })).toThrow();
  });
  it("rejects a half-set quiet window", () => {
    expect(() => pushPrefsSchema.parse({ ...base, quietStart: "22:00", quietEnd: null, timezone: "America/New_York" })).toThrow();
  });
  it("rejects quiet hours without a timezone", () => {
    expect(() => pushPrefsSchema.parse({ minBand: "high", quietStart: "22:00", quietEnd: "08:00", timezone: null })).toThrow();
  });
  it("rejects a malformed HH:MM", () => {
    expect(() => pushPrefsSchema.parse({ minBand: "high", quietStart: "9:00", quietEnd: "08:00", timezone: "UTC" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/shared test -- push`
Expected: FAIL — `pushPrefsSchema` not exported.

- [ ] **Step 3: Add the validator**

Append to `packages/shared/src/validators/push.ts`:

```ts
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const pushPrefsSchema = z
  .object({
    minBand: z.enum(["high", "critical"]),
    quietStart: hhmm.nullable(),
    quietEnd: hhmm.nullable(),
    timezone: z.string().min(1).max(64).nullable(),
  })
  .refine((v) => (v.quietStart === null) === (v.quietEnd === null), {
    message: "quietStart and quietEnd must both be set or both null",
  })
  .refine((v) => v.quietStart === null || v.timezone !== null, {
    message: "timezone is required when quiet hours are set",
  });
export type PushPrefsInput = z.infer<typeof pushPrefsSchema>;
```

- [ ] **Step 4: Re-export from the shared barrel**

Edit `packages/shared/src/index.ts` — add `pushPrefsSchema` next to `pushSubscriptionSchema`/`pushUnsubscribeSchema` (line ~1160):

```ts
  pushPrefsSchema,
```

(If the file also re-exports the inferred types, add `PushPrefsInput` there too, following the existing pattern for `PushSubscriptionInput`.)

- [ ] **Step 5: Run validator test to verify it passes**

Run: `pnpm --filter @paperclipai/shared test -- push`
Expected: PASS.

- [ ] **Step 6: Write the failing route test**

Append inside the `describeEmbeddedPostgres("push subscription routes", …)` block in `server/src/__tests__/push-routes.test.ts`. First import the prefs table at the top (with the other `@paperclipai/db` imports): add `pushDeliveryPrefs`. Add `afterEach` cleanup for it too: `await db.delete(pushDeliveryPrefs);` (before the companies delete). Then:

```ts
  it("returns default prefs, upserts them, and rejects a below-floor band", async () => {
    const company = await seedCompany("Prefs");
    const companyId = company.id;
    const boardApp = await createApp(db, boardActor(companyId));

    // default when no row
    const def = await request(boardApp).get(`/api/companies/${companyId}/push/prefs`);
    expect(def.status).toBe(200);
    expect(def.body).toEqual({ minBand: "high", quietStart: null, quietEnd: null, timezone: null });

    // upsert
    const put = await request(boardApp)
      .put(`/api/companies/${companyId}/push/prefs`)
      .send({ minBand: "critical", quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" });
    expect(put.status).toBe(200);

    const got = await request(boardApp).get(`/api/companies/${companyId}/push/prefs`);
    expect(got.body).toEqual({ minBand: "critical", quietStart: "22:00", quietEnd: "08:00", timezone: "America/New_York" });

    // idempotent upsert (still one row)
    await request(boardApp).put(`/api/companies/${companyId}/push/prefs`).send({ minBand: "high", quietStart: null, quietEnd: null, timezone: null });
    const rows = await db.select().from(pushDeliveryPrefs).where(eq(pushDeliveryPrefs.companyId, companyId));
    expect(rows).toHaveLength(1);

    // below-floor rejected by validator
    expect((await request(boardApp).put(`/api/companies/${companyId}/push/prefs`).send({ minBand: "medium", quietStart: null, quietEnd: null, timezone: null })).status).toBe(400);
  });
```

- [ ] **Step 7: Run route test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- push-routes`
Expected: FAIL — prefs routes 404.

- [ ] **Step 8: Implement the prefs routes**

Edit `server/src/routes/push.ts`. Extend imports:

```ts
import { and, eq } from "drizzle-orm";
import { pushSubscriptions, pushDeliveryPrefs, type Db } from "@paperclipai/db";
import { pushSubscriptionSchema, pushUnsubscribeSchema, pushPrefsSchema } from "@paperclipai/shared";
```

Add these two routes inside `pushRoutes` (before `return router;`):

```ts
  router.get("/companies/:companyId/push/prefs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const [row] = await db
      .select()
      .from(pushDeliveryPrefs)
      .where(and(eq(pushDeliveryPrefs.companyId, companyId), eq(pushDeliveryPrefs.userId, actor.actorId)));
    res.json(
      row
        ? { minBand: row.minBand, quietStart: row.quietStart, quietEnd: row.quietEnd, timezone: row.timezone }
        : { minBand: "high", quietStart: null, quietEnd: null, timezone: null },
    );
  });

  router.put("/companies/:companyId/push/prefs", validate(pushPrefsSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const { minBand, quietStart, quietEnd, timezone } = req.body;
    await db
      .insert(pushDeliveryPrefs)
      .values({ companyId, userId: actor.actorId, minBand, quietStart, quietEnd, timezone })
      .onConflictDoUpdate({
        target: [pushDeliveryPrefs.companyId, pushDeliveryPrefs.userId],
        set: { minBand, quietStart, quietEnd, timezone, updatedAt: new Date() },
      });
    res.json({ ok: true });
  });
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/server test -- push-routes && pnpm --filter @paperclipai/shared test -- push`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/validators/push.ts packages/shared/src/validators/push.test.ts packages/shared/src/index.ts server/src/routes/push.ts server/src/__tests__/push-routes.test.ts
git commit -m "feat(combo-05): 3c per-user push prefs routes + pushPrefsSchema"
```

---

### Task 4: Server — device routes (list/rename) + composite-conflict subscribe + `label`

**Files:**
- Modify: `packages/shared/src/validators/push.ts`
- Modify: `packages/shared/src/index.ts` (re-export)
- Modify: `packages/shared/src/validators/push.test.ts`
- Modify: `server/src/routes/push.ts`
- Test: `server/src/__tests__/push-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 schema; `getActorInfo`, `assertBoard`, `assertCompanyAccess`, `validate`.
- Produces: `pushDeviceRenameSchema` (`{ label: string }`); `pushSubscriptionSchema` gains optional `label`; routes `GET /companies/:companyId/push/subscriptions` (returns `{ id, label, userAgent, lastUsedAt, createdAt, endpointTail }[]`, actor-scoped), `PATCH /companies/:companyId/push/subscriptions/:id` (rename), and `DELETE /companies/:companyId/push/subscriptions/:id` (remove by id). Subscribe upsert conflict target becomes `(companyId, endpoint)`.

- [ ] **Step 1: Write the failing tests (validator + routes)**

Append to `packages/shared/src/validators/push.test.ts`:

```ts
import { pushDeviceRenameSchema } from "./push.js";

describe("push device schemas", () => {
  it("subscription schema accepts an optional label", () => {
    expect(pushSubscriptionSchema.parse({ endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" }, label: "My phone" }).label).toBe("My phone");
  });
  it("rename schema requires a non-empty label", () => {
    expect(pushDeviceRenameSchema.parse({ label: "Laptop" }).label).toBe("Laptop");
    expect(() => pushDeviceRenameSchema.parse({ label: "" })).toThrow();
  });
});
```

Append to `server/src/__tests__/push-routes.test.ts` (inside the describe block):

```ts
  it("allows one endpoint across two companies and lists/renames the actor's devices", async () => {
    const a = await seedCompany("Mca");
    const b = await seedCompany("Mcb");
    const endpoint = "https://push.example/shared";
    const body = { endpoint, keys: { p256dh: "p", auth: "a" }, userAgent: "UA", label: "Phone" };

    const appA = await createApp(db, boardActor(a.id));
    const appB = await createApp(db, boardActor(b.id));
    expect((await request(appA).post(`/api/companies/${a.id}/push/subscriptions`).send(body)).status).toBe(200);
    expect((await request(appB).post(`/api/companies/${b.id}/push/subscriptions`).send(body)).status).toBe(200);

    // multi-company: same endpoint → one row per company
    const all = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(all).toHaveLength(2);

    // list is actor+company scoped
    const list = await request(appA).get(`/api/companies/${a.id}/push/subscriptions`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ label: "Phone", endpointTail: endpoint.slice(-8) });
    expect(list.body[0].id).toBeTruthy();

    // rename
    const id = list.body[0].id;
    expect((await request(appA).patch(`/api/companies/${a.id}/push/subscriptions/${id}`).send({ label: "Work phone" })).status).toBe(200);
    const renamed = await request(appA).get(`/api/companies/${a.id}/push/subscriptions`);
    expect(renamed.body[0].label).toBe("Work phone");

    // remove-by-id drops company A's row but leaves company B's (shared endpoint)
    expect((await request(appA).delete(`/api/companies/${a.id}/push/subscriptions/${id}`)).status).toBe(200);
    expect((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))).length).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @paperclipai/shared test -- push && pnpm --filter @paperclipai/server test -- push-routes`
Expected: FAIL — `pushDeviceRenameSchema` missing; second company subscribe collides on the old unique / device routes 404.

- [ ] **Step 3: Extend the validators**

Edit `packages/shared/src/validators/push.ts` — add `label` to `pushSubscriptionSchema` and add the rename schema:

```ts
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(500).optional(),
  label: z.string().min(1).max(100).optional(),
});
```

```ts
export const pushDeviceRenameSchema = z.object({
  label: z.string().min(1).max(100),
});
export type PushDeviceRenameInput = z.infer<typeof pushDeviceRenameSchema>;
```

Re-export `pushDeviceRenameSchema` from `packages/shared/src/index.ts` (next to the other push schemas).

- [ ] **Step 4: Update subscribe conflict target + add device routes**

Edit `server/src/routes/push.ts`. Import the rename schema:

```ts
import { pushSubscriptionSchema, pushUnsubscribeSchema, pushPrefsSchema, pushDeviceRenameSchema } from "@paperclipai/shared";
```

In the existing `POST …/subscriptions` handler, add `label` to `values` and change the conflict target to the composite index columns:

```ts
      .values({
        companyId, userId: actor.actorId, endpoint: req.body.endpoint,
        p256dh: req.body.keys.p256dh, auth: req.body.keys.auth,
        userAgent: req.body.userAgent ?? null, label: req.body.label ?? null,
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.companyId, pushSubscriptions.endpoint],
        set: { userId: actor.actorId, p256dh: req.body.keys.p256dh, auth: req.body.keys.auth, userAgent: req.body.userAgent ?? null, label: req.body.label ?? null },
      });
```

Add the two device routes (before `return router;`):

```ts
  router.get("/companies/:companyId/push/subscriptions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.companyId, companyId), eq(pushSubscriptions.userId, actor.actorId)));
    res.json(
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        userAgent: r.userAgent,
        lastUsedAt: r.lastUsedAt,
        createdAt: r.createdAt,
        endpointTail: r.endpoint.slice(-8),
      })),
    );
  });

  router.patch("/companies/:companyId/push/subscriptions/:id", validate(pushDeviceRenameSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const updated = await db
      .update(pushSubscriptions)
      .set({ label: req.body.label })
      .where(
        and(
          eq(pushSubscriptions.id, id),
          eq(pushSubscriptions.companyId, companyId),
          eq(pushSubscriptions.userId, actor.actorId),
        ),
      )
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "Device not found" });
      return;
    }
    res.json({ ok: true });
  });

  router.delete("/companies/:companyId/push/subscriptions/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const removed = await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.id, id),
          eq(pushSubscriptions.companyId, companyId),
          eq(pushSubscriptions.userId, actor.actorId),
        ),
      )
      .returning();
    if (removed.length === 0) {
      res.status(404).json({ error: "Device not found" });
      return;
    }
    res.json({ ok: true });
  });
```

> **Route ordering:** the existing `DELETE …/push/subscriptions` (body `{ endpoint }`, used by the client toggle) and this new `DELETE …/push/subscriptions/:id` are distinct paths — Express matches the more specific `/:id` only when an id segment is present, so both coexist. Keep the endpoint-body DELETE for `unsubscribeFromPush`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/shared test -- push && pnpm --filter @paperclipai/server test -- push-routes`
Expected: PASS (including the original idempotency test — a repeat subscribe to the *same* company still upserts to one row via the composite target).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/validators/push.ts packages/shared/src/validators/push.test.ts packages/shared/src/index.ts server/src/routes/push.ts server/src/__tests__/push-routes.test.ts
git commit -m "feat(combo-05): 3c device list/rename routes + multi-company subscribe"
```

---

### Task 5: Client — unsubscribe fix + API methods + `/digest` Notifications UI

**Files:**
- Modify: `ui/src/lib/push.ts`
- Modify: `ui/src/lib/push.test.ts`
- Modify: `ui/src/api/push.ts`
- Modify: `ui/src/pages/Digest.tsx`
- Test: `ui/src/pages/Digest.test.tsx`

**Interfaces:**
- Consumes: server routes from Tasks 3–4.
- Produces: `pushApi.getPrefs/putPrefs/listDevices/renameDevice/removeDevice`; `unsubscribeFromPush` that does not call the browser `sub.unsubscribe()`; a Notifications section on `/digest`.

- [ ] **Step 1: Write the failing lib test**

Add to `ui/src/lib/push.test.ts` — a `describe("unsubscribeFromPush")` block asserting the browser subscription is NOT revoked:

```ts
describe("unsubscribeFromPush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("deletes the server row but does NOT call the browser sub.unsubscribe()", async () => {
    const unsubscribe = vi.fn(() => Promise.resolve(true));
    const sub = { endpoint: "https://push.example/e", unsubscribe };
    vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(sub) } }) },
    });
    vi.mocked(pushApi.unsubscribe).mockResolvedValue({ ok: true });

    await unsubscribeFromPush("company-1");

    expect(pushApi.unsubscribe).toHaveBeenCalledWith("company-1", "https://push.example/e");
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/ui test -- push.test`
Expected: FAIL — current code calls `sub.unsubscribe()`.

- [ ] **Step 3: Fix `unsubscribeFromPush`**

Edit `ui/src/lib/push.ts` — replace the `unsubscribeFromPush` body so it never revokes the shared browser endpoint:

```ts
export async function unsubscribeFromPush(companyId: string): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await pushApi.unsubscribe(companyId, sub.endpoint);
    // NOTE: intentionally NOT calling sub.unsubscribe() — the browser endpoint is shared
    // across companies; revoking it would kill push for every other company on this browser.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/ui test -- push.test`
Expected: PASS.

- [ ] **Step 5: Add the API client methods**

Edit `ui/src/api/push.ts` — extend `pushApi` and add types:

```ts
export type PushPrefs = { minBand: "high" | "critical"; quietStart: string | null; quietEnd: string | null; timezone: string | null };
export type PushDevice = { id: string; label: string | null; userAgent: string | null; lastUsedAt: string | null; createdAt: string; endpointTail: string };

export const pushApi = {
  vapidPublicKey: () => api.get<{ publicKey: string }>(`/push/vapid-public-key`),
  subscribe: (
    companyId: string,
    body: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string; label?: string },
  ) => api.post<{ ok: true }>(`/companies/${companyId}/push/subscriptions`, body),
  unsubscribe: (companyId: string, endpoint: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/push/subscriptions`, { endpoint }),
  getPrefs: (companyId: string) => api.get<PushPrefs>(`/companies/${companyId}/push/prefs`),
  putPrefs: (companyId: string, body: PushPrefs) => api.put<{ ok: true }>(`/companies/${companyId}/push/prefs`, body),
  listDevices: (companyId: string) => api.get<PushDevice[]>(`/companies/${companyId}/push/subscriptions`),
  renameDevice: (companyId: string, id: string, label: string) =>
    api.patch<{ ok: true }>(`/companies/${companyId}/push/subscriptions/${id}`, { label }),
  removeDevice: (companyId: string, id: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/push/subscriptions/${id}`),
};
```

`removeDevice` targets the by-id DELETE route added in Task 4 — the device list exposes only `endpointTail` (never the full endpoint), so removal must go by `id`.

- [ ] **Step 6: Write the failing Digest UI test**

Add to `ui/src/pages/Digest.test.tsx`. Extend the `apiMocks` hoisted block and the `../api/push` mock so push methods are stubbed (the page imports from `../lib/push` and, after this task, `../api/push`). Mock `../lib/push` to report supported + granted, and `../api/push` with the new methods. Then a test that renders, waits for devices, and asserts a prefs save posts the captured timezone:

```ts
// in the vi.hoisted apiMocks: add getPrefs, putPrefs, listDevices, renameDevice, removeDevice fns
vi.mock("../lib/push", () => ({
  pushSupported: () => true,
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));
vi.mock("../api/push", () => ({
  pushApi: {
    getPrefs: apiMocks.getPrefs,
    putPrefs: apiMocks.putPrefs,
    listDevices: apiMocks.listDevices,
    renameDevice: apiMocks.renameDevice,
    removeDevice: apiMocks.removeDevice,
  },
}));
```

```ts
  it("saves prefs with the browser-captured timezone and lists devices", async () => {
    apiMocks.digestLatest.mockResolvedValue(null);
    apiMocks.getPrefs.mockResolvedValue({ minBand: "high", quietStart: null, quietEnd: null, timezone: null });
    apiMocks.putPrefs.mockResolvedValue({ ok: true });
    apiMocks.listDevices.mockResolvedValue([{ id: "d1", label: "Phone", userAgent: "UA", lastUsedAt: null, createdAt: "2026-07-14T00:00:00Z", endpointTail: "abc12345" }]);
    vi.stubGlobal("Notification", { permission: "granted", requestPermission: vi.fn() });

    // render (use the file's existing render helper / createRoot+act pattern)
    // … render <Digest /> …
    // wait a tick for queries, then click "Save notification settings"
    // assert:
    expect(apiMocks.listDevices).toHaveBeenCalledWith("company-1");
    // after clicking save:
    expect(apiMocks.putPrefs).toHaveBeenCalledWith("company-1", expect.objectContaining({ minBand: "high", timezone: expect.any(String) }));
  });
```

(Follow the existing render/act structure already in this file for mounting `<Digest />` and flushing queries; reuse its `flush`/`act` helpers rather than inventing new ones.)

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/ui test -- Digest.test`
Expected: FAIL — no Notifications UI / `putPrefs` never called.

- [ ] **Step 8: Build the Notifications section**

Edit `ui/src/pages/Digest.tsx`. Add imports:

```ts
import { pushApi, type PushPrefs } from "../api/push";
```

Inside the component, add prefs + devices queries and a save mutation (guarded by `pushEnabledSupported`), capturing the timezone at save time:

```ts
  const { data: prefs } = useQuery({
    queryKey: ["push-prefs", companyId],
    queryFn: () => pushApi.getPrefs(companyId),
    enabled: !!companyId && pushEnabledSupported,
    retry: false,
  });
  const { data: devices } = useQuery({
    queryKey: ["push-devices", companyId],
    queryFn: () => pushApi.listDevices(companyId),
    enabled: !!companyId && pushEnabledSupported,
    retry: false,
  });
  const [form, setForm] = useState<PushPrefs | null>(null);
  const current = form ?? prefs ?? { minBand: "high" as const, quietStart: null, quietEnd: null, timezone: null };
  const savePrefs = useMutation({
    mutationFn: (p: PushPrefs) =>
      pushApi.putPrefs(companyId, { ...p, timezone: p.quietStart ? Intl.DateTimeFormat().resolvedOptions().timeZone : null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push-prefs", companyId] }),
  });
  const removeDevice = useMutation({
    mutationFn: (id: string) => pushApi.removeDevice(companyId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push-devices", companyId] }),
  });
```

Then render a section (after the digest body) when `pushEnabledSupported`:

```tsx
      {pushEnabledSupported && (
        <section className="notifications mt-6 border-t pt-4">
          <h2 className="text-lg font-medium">Notifications</h2>
          <label className="block mt-2">
            Minimum band
            <select
              value={current.minBand}
              onChange={(e) => setForm({ ...current, minBand: e.target.value as PushPrefs["minBand"] })}
            >
              <option value="high">High and above</option>
              <option value="critical">Critical only</option>
            </select>
          </label>
          <label className="block mt-2">
            Quiet hours
            <input type="time" value={current.quietStart ?? ""} onChange={(e) => setForm({ ...current, quietStart: e.target.value || null })} />
            <input type="time" value={current.quietEnd ?? ""} onChange={(e) => setForm({ ...current, quietEnd: e.target.value || null })} />
          </label>
          <button className="mt-2" onClick={() => savePrefs.mutate(current)} disabled={savePrefs.isPending}>
            {savePrefs.isPending ? "Saving…" : "Save notification settings"}
          </button>

          <h3 className="font-medium mt-4">Your devices</h3>
          <ul className="list-disc pl-5">
            {(devices ?? []).map((d) => (
              <li key={d.id}>
                {d.label ?? d.userAgent ?? "Unknown device"} <span className="text-xs text-muted-foreground">…{d.endpointTail}</span>{" "}
                <button onClick={() => removeDevice.mutate(d.id)}>Remove</button>
              </li>
            ))}
          </ul>
        </section>
      )}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/ui test -- Digest.test push.test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add ui/src/lib/push.ts ui/src/lib/push.test.ts ui/src/api/push.ts ui/src/pages/Digest.tsx ui/src/pages/Digest.test.tsx
git commit -m "feat(combo-05): 3c client multi-company unsubscribe fix + /digest notifications UI"
```

---

### Task 6: Whole-branch verification

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck + test sweep**

Run: `pnpm typecheck && pnpm test` (or the repo's root equivalents).
Expected: PASS. Investigate any failure before proceeding; the known-flaky `ArtifactCard` UI test may need a re-run (see repo conventions) — a single retry that then passes is acceptable, anything else is a real failure.

- [ ] **Step 2: Drive the change end-to-end (verify skill)**

Invoke the `verify` skill (or the project verify skill) to exercise the prefs + multi-company flow against the running app — not just tests. Confirm: enabling push on a second company adds a row without dropping the first; setting min-band=critical suppresses a high-band push; a quiet-hours window suppresses non-critical and lets critical through.

- [ ] **Step 3: Request code review**

Invoke `superpowers:requesting-code-review` for the whole 3c branch before opening/merging the PR (per the repo's per-task + whole-branch review convention).

- [ ] **Step 4: Commit any review fixes, then open the PR**

Target the PR at `feat/combo05-phase3b-actionable-push` (the 3c branch stacks on 3b). Update the combo-05 phasing memory once merged.

---

## Self-Review Notes

- **Spec coverage:** multi-company fix → Tasks 1 (schema) + 4 (subscribe/routes) + 5 (client unsubscribe); per-user prefs → Tasks 1 (table) + 2 (send path) + 3 (routes); device management → Tasks 4 (routes) + 5 (UI); quiet-hours semantics (critical override, tz, wrapping) → Task 2 unit tests. Deferred request-changes explicitly out of scope.
- **Type consistency:** `DeliveryPrefs`/`PushPrefs` fields (`minBand`, `quietStart`, `quietEnd`, `timezone`) match across service, validator, routes, and client; `shouldPushToUser` signature identical in Task 2 definition and Task 2 channel call; `pushDeliveryPrefs` column names match the schema in Task 1.
- **Device removal:** the list exposes only `endpointTail`, so removal goes through the by-id DELETE route (Task 4) — `pushApi.removeDevice(companyId, id)`. The endpoint-body DELETE stays for the client's `unsubscribeFromPush` toggle; the two DELETE paths coexist.
