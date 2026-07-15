# Combo-05 Phase 3a — Web Push Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A high-band approval fires a real Web Push notification to a subscribed browser, sent through the Phase-1 delivery pipeline via a new `webpush` channel; low-band and auto-approved items never buzz.

**Architecture:** VAPID keys auto-generate into a server-only `push_vapid_keys` singleton; browsers register company-scoped `push_subscriptions`; a db-bound `webpush` delivery channel sends via the `web-push` library, pruning dead endpoints. The approval-create handler, after the 2a auto-approve attempt, fans a high-band notification through `deliverThroughChannels` (a shared helper extracted from the digest service). A minimal service-worker `push` handler renders the notification. Everything is best-effort — no push failure touches approval-create or the tick.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), drizzle-orm + PostgreSQL, Express, `web-push`, vitest + embedded-postgres for server tests, React + `react-dom/act` for UI tests.

## Global Constraints

- Language/module: TypeScript, ESM; **all relative imports use `.js` extensions**.
- Services are factory functions: `export function xService(db: Db) { return { ... } }`.
- Server DB tests use the embedded-postgres harness (`getEmbeddedPostgresTestSupport` / `startEmbeddedPostgresTestDatabase` from `server/src/__tests__/helpers/embedded-postgres.js`), guarded with `describeEmbeddedPostgres`. Mirror `server/src/__tests__/auto-approve-policy-service.test.ts`.
- Pure (no-DB) tests are plain vitest files colocated as `*.test.ts`.
- Run a single test file: `pnpm exec vitest run <path>`. Full suite: `pnpm test`.
- Migrations: hand-written raw SQL + a `meta/_journal.json` entry — **never `drizzle-kit generate`** (baseline stale at 0098). Next number is **`0114`**. Mirror `0113_combo05_digests.sql`.
- **`web-push` is mocked in every server test** — never send a real push. Mock shape: `vi.mock("web-push", () => ({ default: { generateVAPIDKeys: vi.fn(() => ({ publicKey: "PUB", privateKey: "PRIV" })), setVapidDetails: vi.fn(), sendNotification: vi.fn(() => Promise.resolve({})) } }))`. Import in source as `import webpush from "web-push";`.
- Risk bands + `bandRank(b)` are exported from `server/src/services/approval-risk.ts`. `RiskBand = "low"|"medium"|"high"|"critical"`.
- `PUSH_MIN_BAND = "high"` (locked constant). The trigger fires only for non-auto-approved (`status !== "approved"`) approvals with `bandRank(band) >= bandRank(PUSH_MIN_BAND)`.
- **Best-effort rule:** no VAPID / send failure / dead endpoint / zero subscriptions must never throw into approval-create or the digest tick. Prune a subscription on push error `statusCode` 404 or 410.
- New shared validators must be re-exported from the **`@paperclipai/shared` top-level `src/index.ts`** barrel, not only `validators/index.ts` (else route imports resolve to `undefined`).
- Follow the file-header comment block convention when creating new files.

---

## File Structure

**New:**
- `packages/db/src/schema/push_subscriptions.ts`, `packages/db/src/schema/push_vapid_keys.ts`
- `packages/db/src/migrations/0114_combo05_push_subscriptions.sql`
- `server/src/services/push-vapid.ts` — `pushVapidService` (VAPID keypair + `setVapidDetails`)
- `server/src/services/push-notifications.ts` — `buildApprovalPushBody` (pure) + `createWebPushChannel`
- `server/src/routes/push.ts` — vapid-public-key + subscribe/unsubscribe
- `packages/shared/src/validators/push.ts` — subscribe/unsubscribe schemas
- `ui/src/api/push.ts`, `ui/src/lib/push.ts`

**Modified:**
- `packages/db/src/schema/index.ts` — export both tables
- `server/src/services/notification-delivery.ts` — `NotificationPayload.push`; `deliverThroughChannels`
- `server/src/services/digest.ts` — use `deliverThroughChannels`
- `server/src/services/index.ts` — new exports + `bandRank`
- `server/src/routes/approvals.ts` — risk-gated trigger; `PUSH_MIN_BAND`
- `server/src/app.ts` — register webpush channel; mount push routes
- `server/package.json` — `web-push` + `@types/web-push`
- `packages/shared/src/index.ts` — re-export push validators
- `ui/public/sw.js` — minimal `push` handler
- `ui/src/pages/Digest.tsx` — "Enable push notifications" toggle

---

### Task 1: DB schema — `push_subscriptions` + `push_vapid_keys` + migration

**Files:**
- Create: `packages/db/src/schema/push_subscriptions.ts`, `packages/db/src/schema/push_vapid_keys.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/migrations/0114_combo05_push_subscriptions.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Test: `packages/db/src/__tests__/schema-push.test.ts`

**Interfaces:**
- Produces: `pushSubscriptions`, `pushVapidKeys` tables; types `PushSubscriptionRow`, `PushVapidKeyRow`.

- [ ] **Step 1: Write the schemas**

`packages/db/src/schema/push_subscriptions.ts`:
```ts
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => ({
    endpointUniqueIdx: uniqueIndex("push_subscriptions_endpoint_unique_idx").on(table.endpoint),
    companyIdx: index("push_subscriptions_company_idx").on(table.companyId),
  }),
);
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
```

`packages/db/src/schema/push_vapid_keys.ts`:
```ts
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const pushVapidKeys = pgTable(
  "push_vapid_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    singleton: text("singleton").notNull().default("default"),
    publicKey: text("public_key").notNull(),
    privateKey: text("private_key").notNull(),
    subject: text("subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    singletonUniqueIdx: uniqueIndex("push_vapid_keys_singleton_unique_idx").on(table.singleton),
  }),
);
export type PushVapidKeyRow = typeof pushVapidKeys.$inferSelect;
```

- [ ] **Step 2: Export from the schema barrel**

In `packages/db/src/schema/index.ts`, add before `// [END: module]`:
```ts
export { pushSubscriptions, type PushSubscriptionRow } from "./push_subscriptions.js";
export { pushVapidKeys, type PushVapidKeyRow } from "./push_vapid_keys.js";
```

- [ ] **Step 3: Hand-write the migration**

Create `packages/db/src/migrations/0114_combo05_push_subscriptions.sql`:
```sql
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_unique_idx" ON "push_subscriptions" ("endpoint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_company_idx" ON "push_subscriptions" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_vapid_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "singleton" text DEFAULT 'default' NOT NULL,
  "public_key" text NOT NULL,
  "private_key" text NOT NULL,
  "subject" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_vapid_keys_singleton_unique_idx" ON "push_vapid_keys" ("singleton");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
```

- [ ] **Step 4: Register the journal entry**

Append after the `idx: 113` entry in `packages/db/src/migrations/meta/_journal.json` (copy the 113 shape; change `idx`/`when`/`tag`):
```json
    {
      "idx": 114,
      "version": "7",
      "when": 1784300000000,
      "tag": "0114_combo05_push_subscriptions",
      "breakpoints": true
    }
```

- [ ] **Step 5: Write a schema smoke test**

`packages/db/src/__tests__/schema-push.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { pushSubscriptions, pushVapidKeys } from "../schema/index.js";

describe("push schema", () => {
  it("exposes push_subscriptions and push_vapid_keys tables", () => {
    expect(pushSubscriptions).toBeDefined();
    expect(pushVapidKeys).toBeDefined();
  });
});
```

- [ ] **Step 6: Verify + run**

Run: `pnpm --filter @paperclipai/db run check:migrations` → PASS.
Run: `pnpm exec vitest run packages/db/src/__tests__/schema-push.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/push_subscriptions.ts packages/db/src/schema/push_vapid_keys.ts \
  packages/db/src/schema/index.ts packages/db/src/migrations/0114_combo05_push_subscriptions.sql \
  packages/db/src/migrations/meta/_journal.json packages/db/src/__tests__/schema-push.test.ts
git commit -m "feat(combo-05): push_subscriptions + push_vapid_keys schema and migration"
```

---

### Task 2: `deliverThroughChannels` helper + `NotificationPayload.push`; refactor digest

**Files:**
- Modify: `server/src/services/notification-delivery.ts`
- Modify: `server/src/services/digest.ts`
- Modify: `server/src/services/index.ts`
- Test: `server/src/__tests__/deliver-through-channels.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // NotificationPayload gains: push?: { title: string; body: string; url: string; tag?: string; band?: string };
  export async function deliverThroughChannels(target: DeliveryTarget, payload: NotificationPayload): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

`server/src/__tests__/deliver-through-channels.test.ts` (pure — no DB; register fake channels):
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { registerChannel, getChannels, deliverThroughChannels } from "../services/notification-delivery.js";

function clearChannels() {
  // Register no-op replacements is awkward; instead assert behavior via spies on fresh fake channels.
}

describe("deliverThroughChannels", () => {
  it("invokes every registered channel and isolates a throwing one", async () => {
    const good = vi.fn(() => Promise.resolve());
    const bad = vi.fn(() => Promise.reject(new Error("boom")));
    registerChannel({ name: "inbox", deliver: good });
    registerChannel({ name: "webpush", deliver: bad });
    await expect(deliverThroughChannels({ companyId: "c1" }, { kind: "k", title: "t" })).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  // reset the registry to avoid cross-test leakage within this file
  for (const c of getChannels()) registerChannel({ name: c.name, deliver: () => Promise.resolve() });
});
```
(The registry is a module singleton; server test files are process-isolated. Registering fakes here is safe.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/deliver-through-channels.test.ts`
Expected: FAIL (`deliverThroughChannels` not exported).

- [ ] **Step 3: Edit `notification-delivery.ts`**

Add `logger` import at the top of the module body: `import { logger } from "../middleware/logger.js";`

Extend `NotificationPayload`:
```ts
export type NotificationPayload = {
  kind: string;
  title: string;
  body?: string;
  link?: string;
  risk?: { band: string; score: number };
  digest?: { payload: DigestPayload; periodStart: Date | null; periodEnd: Date };
  push?: { title: string; body: string; url: string; tag?: string; band?: string };
};
```

Add the helper (before `// [END: module]`):
```ts
/** Fan a notification out through every registered channel; one channel's throw never aborts the rest. */
export async function deliverThroughChannels(target: DeliveryTarget, payload: NotificationPayload): Promise<void> {
  for (const channel of getChannels()) {
    try {
      await channel.deliver(target, payload);
    } catch (err) {
      logger.warn({ err, channel: channel.name }, "delivery channel failed");
    }
  }
}
```

- [ ] **Step 4: Refactor the digest service to use it**

In `server/src/services/digest.ts`, replace the open-coded channel loop in `generateForCompany`:
```ts
for (const channel of getChannels()) {
  try {
    await channel.deliver({ companyId }, { kind: "digest", title: payload.headline, digest: { payload, periodStart: since, periodEnd: now } });
  } catch (err) {
    logger.warn({ err, companyId, channel: channel.name }, "digest delivery channel failed");
  }
}
```
with:
```ts
await deliverThroughChannels(
  { companyId },
  { kind: "digest", title: payload.headline, digest: { payload, periodStart: since, periodEnd: now } },
);
```
Update the import: replace `getChannels` with `deliverThroughChannels` from `./notification-delivery.js` (drop the now-unused `getChannels` import if nothing else in the file uses it).

- [ ] **Step 5: Export from the services barrel**

In `server/src/services/index.ts`, extend the notification-delivery export line to add `deliverThroughChannels`:
```ts
export { registerChannel, getChannels, deliverThroughChannels, type DeliveryChannel } from "./notification-delivery.js";
```

- [ ] **Step 6: Run tests + digest regression**

Run: `pnpm exec vitest run server/src/__tests__/deliver-through-channels.test.ts server/src/__tests__/digest-service.test.ts`
Expected: both PASS (digest still generates through the helper).

- [ ] **Step 7: Commit**

```bash
git add server/src/services/notification-delivery.ts server/src/services/digest.ts server/src/services/index.ts server/src/__tests__/deliver-through-channels.test.ts
git commit -m "feat(combo-05): deliverThroughChannels helper + NotificationPayload.push"
```

---

### Task 3: `pushVapidService` + the `web-push` dependency

**Files:**
- Modify: `server/package.json`
- Create: `server/src/services/push-vapid.ts`
- Test: `server/src/__tests__/push-vapid-service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function pushVapidService(db: Db): {
    getKeys(): Promise<{ publicKey: string; privateKey: string; subject: string }>;
    ensureInitialised(): Promise<{ publicKey: string } | null>;
  };
  ```

- [ ] **Step 1: Add the dependency**

Add to `server/package.json` `dependencies`: `"web-push": "^3.6.7"`, and to `devDependencies`: `"@types/web-push": "^3.6.3"`. Then run `pnpm install` (from the repo root). Verify it resolves: `pnpm --filter @paperclipai/server exec node -e "require('web-push')"` prints nothing and exits 0.

- [ ] **Step 2: Write the failing test**

`server/src/__tests__/push-vapid-service.test.ts` (embedded-pg; mock `web-push`). At the top:
```ts
import { vi } from "vitest";
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: vi.fn(() => ({ publicKey: "PUB", privateKey: "PRIV" })),
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(() => Promise.resolve({})),
  },
}));
import webpush from "web-push";
```
Seed nothing (no company needed — VAPID is instance-level). Then:
```ts
const svc = pushVapidService(db);
const a = await svc.getKeys();
expect(a.publicKey).toBe("PUB");
expect((webpush as any).generateVAPIDKeys).toHaveBeenCalledTimes(1);

// second call reads the persisted row, does NOT regenerate
const b = await svc.getKeys();
expect(b.publicKey).toBe("PUB");
expect((webpush as any).generateVAPIDKeys).toHaveBeenCalledTimes(1);

// exactly one row persisted
const rows = await db.select().from(pushVapidKeys);
expect(rows).toHaveLength(1);

// ensureInitialised calls setVapidDetails and returns the public key
const init = await svc.ensureInitialised();
expect(init?.publicKey).toBe("PUB");
expect((webpush as any).setVapidDetails).toHaveBeenCalled();
```
Note: `generateVAPIDKeys` is called once **per process**; because the row persists, later `getKeys` reads it. If the module memoises `setVapidDetails`, `ensureInitialised` may call it 0 or 1 times depending on prior calls in the same file — assert `toHaveBeenCalled()` (at least once across the test), not an exact count.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/push-vapid-service.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `push-vapid.ts`**

```ts
import { eq } from "drizzle-orm";
import webpush from "web-push";
import type { Db } from "@paperclipai/db";
import { pushVapidKeys } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const DEFAULT_SUBJECT = "mailto:push@paperclip.local";
let vapidInitialised = false; // setVapidDetails is process-global; call once

export function pushVapidService(db: Db) {
  async function getKeys(): Promise<{ publicKey: string; privateKey: string; subject: string }> {
    const existing = await db.select().from(pushVapidKeys).where(eq(pushVapidKeys.singleton, "default")).then((r) => r[0] ?? null);
    if (existing) return { publicKey: existing.publicKey, privateKey: existing.privateKey, subject: existing.subject };
    const generated = webpush.generateVAPIDKeys();
    const [inserted] = await db
      .insert(pushVapidKeys)
      .values({ singleton: "default", publicKey: generated.publicKey, privateKey: generated.privateKey, subject: DEFAULT_SUBJECT })
      .onConflictDoNothing({ target: pushVapidKeys.singleton })
      .returning();
    if (inserted) return { publicKey: inserted.publicKey, privateKey: inserted.privateKey, subject: inserted.subject };
    // lost a race — read the winner
    const winner = await db.select().from(pushVapidKeys).where(eq(pushVapidKeys.singleton, "default")).then((r) => r[0]!);
    return { publicKey: winner.publicKey, privateKey: winner.privateKey, subject: winner.subject };
  }

  return {
    getKeys,
    async ensureInitialised(): Promise<{ publicKey: string } | null> {
      try {
        const keys = await getKeys();
        if (!vapidInitialised) {
          webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
          vapidInitialised = true;
        }
        return { publicKey: keys.publicKey };
      } catch (err) {
        logger.warn({ err }, "VAPID init failed; push disabled");
        return null;
      }
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/push-vapid-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/package.json pnpm-lock.yaml server/src/services/push-vapid.ts server/src/__tests__/push-vapid-service.test.ts
git commit -m "feat(combo-05): VAPID service (auto-generate + persist) + web-push dep"
```

---

### Task 4: `buildApprovalPushBody` (pure) + `createWebPushChannel`

**Files:**
- Create: `server/src/services/push-notifications.ts`
- Modify: `server/src/services/index.ts`
- Test: `server/src/services/push-notifications.test.ts` (pure), `server/src/__tests__/webpush-channel.test.ts` (DB)

**Interfaces:**
- Consumes: `pushVapidService` (Task 3), `pushSubscriptions`, `web-push`.
- Produces:
  ```ts
  export function buildApprovalPushBody(input: { approvalType: string; band: string; companyId: string; approvalId: string }):
    { title: string; body: string; url: string; tag: string; band: string };
  export function createWebPushChannel(db: Db): DeliveryChannel;
  ```

- [ ] **Step 1: Write the failing pure test**

`server/src/services/push-notifications.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildApprovalPushBody } from "./push-notifications.js";

describe("buildApprovalPushBody", () => {
  it("builds a deterministic title/body/url/tag", () => {
    const a = buildApprovalPushBody({ approvalType: "hire_agent", band: "critical", companyId: "c1", approvalId: "ap1" });
    expect(a).toEqual(buildApprovalPushBody({ approvalType: "hire_agent", band: "critical", companyId: "c1", approvalId: "ap1" }));
    expect(a.url).toBe("/companies/c1/approvals/ap1");
    expect(a.tag).toBe("approval-ap1");
    expect(a.band).toBe("critical");
    expect(a.body).toContain("hire_agent");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/services/push-notifications.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `push-notifications.ts`**

```ts
import { eq } from "drizzle-orm";
import webpush from "web-push";
import type { Db } from "@paperclipai/db";
import { pushSubscriptions } from "@paperclipai/db";
import type { DeliveryChannel } from "./notification-delivery.js";
import { pushVapidService } from "./push-vapid.js";
import { logger } from "../middleware/logger.js";

export function buildApprovalPushBody(input: { approvalType: string; band: string; companyId: string; approvalId: string }) {
  return {
    title: `${input.band} risk approval`,
    body: `${input.approvalType} — tap to review`,
    url: `/companies/${input.companyId}/approvals/${input.approvalId}`,
    tag: `approval-${input.approvalId}`,
    band: input.band,
  };
}

export function createWebPushChannel(db: Db): DeliveryChannel {
  const vapid = pushVapidService(db);
  return {
    name: "webpush",
    async deliver(target, payload) {
      if (!target.companyId || !payload.push) return;
      const init = await vapid.ensureInitialised();
      if (!init) return; // push disabled

      const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.companyId, target.companyId));
      const body = JSON.stringify(payload.push);
      for (const sub of subs) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
          await db.update(pushSubscriptions).set({ lastUsedAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          } else {
            logger.warn({ err, subscriptionId: sub.id }, "web push send failed");
          }
        }
      }
    },
  };
}
```

- [ ] **Step 4: Write the DB channel test**

`server/src/__tests__/webpush-channel.test.ts` (embedded-pg; mock `web-push` with the Global-Constraints shape). Seed a company + a VAPID row (or let `ensureInitialised` generate it) + two `push_subscriptions` for the company. Then:
```ts
const channel = createWebPushChannel(db);

// absent push field → no-op
await channel.deliver({ companyId }, { kind: "k", title: "t" });
expect((webpush as any).sendNotification).not.toHaveBeenCalled();

// with push → one send per subscription; last_used_at bumped
await channel.deliver({ companyId }, { kind: "k", title: "t", push: { title: "T", body: "B", url: "/u", tag: "x", band: "high" } });
expect((webpush as any).sendNotification).toHaveBeenCalledTimes(2);

// a 410 prunes that subscription
(webpush as any).sendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
await channel.deliver({ companyId }, { kind: "k", title: "t", push: { title: "T", body: "B", url: "/u", tag: "x", band: "high" } });
const remaining = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.companyId, companyId));
expect(remaining.length).toBe(1);
```
(Reset the `sendNotification` mock between assertions with `mockClear()` where counts matter.)

- [ ] **Step 5: Export + run tests**

In `server/src/services/index.ts` add:
```ts
export { pushVapidService } from "./push-vapid.js";
export { createWebPushChannel, buildApprovalPushBody } from "./push-notifications.js";
```
Run: `pnpm exec vitest run server/src/services/push-notifications.test.ts server/src/__tests__/webpush-channel.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/push-notifications.ts server/src/services/index.ts server/src/services/push-notifications.test.ts server/src/__tests__/webpush-channel.test.ts
git commit -m "feat(combo-05): webpush delivery channel + approval push payload builder"
```

---

### Task 5: Shared push validators

**Files:**
- Create: `packages/shared/src/validators/push.ts`
- Modify: `packages/shared/src/validators/index.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/validators/push.test.ts`

**Interfaces:**
- Produces: `pushSubscriptionSchema`, `pushUnsubscribeSchema`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/validators/push.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "./push.js";

describe("push validators", () => {
  const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" }, userAgent: "UA" };
  it("accepts a valid subscription", () => {
    expect(pushSubscriptionSchema.parse(sub).endpoint).toBe(sub.endpoint);
  });
  it("rejects a missing endpoint", () => {
    expect(() => pushSubscriptionSchema.parse({ ...sub, endpoint: "" })).toThrow();
  });
  it("rejects missing keys", () => {
    expect(() => pushSubscriptionSchema.parse({ endpoint: sub.endpoint })).toThrow();
  });
  it("accepts an unsubscribe by endpoint", () => {
    expect(pushUnsubscribeSchema.parse({ endpoint: sub.endpoint }).endpoint).toBe(sub.endpoint);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/validators/push.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `push.ts`**

```ts
import { z } from "zod";

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(500).optional(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;
```

- [ ] **Step 4: Export from BOTH barrels**

In `packages/shared/src/validators/index.ts` add: `export * from "./push.js";`
In `packages/shared/src/index.ts`, add to the approval-adjacent re-export block (mirror how `createAutoApprovePolicySchema` was added):
```ts
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  type PushSubscriptionInput,
  type PushUnsubscribeInput,
```
(place these names inside an existing `export { … } from "./validators/index.js";` block).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/shared/src/validators/push.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/validators/push.ts packages/shared/src/validators/index.ts packages/shared/src/index.ts packages/shared/src/validators/push.test.ts
git commit -m "feat(combo-05): push subscription validators"
```

---

### Task 6: Push routes + register the webpush channel + mount

**Files:**
- Create: `server/src/routes/push.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/__tests__/push-routes.test.ts`

**Interfaces:**
- Consumes: `pushVapidService`, `createWebPushChannel`, `registerChannel`, `pushSubscriptionSchema`, `pushUnsubscribeSchema`, `assertBoard`, `assertCompanyAccess`, `getActorInfo`.
- Produces routes: `GET /push/vapid-public-key`, `POST/DELETE /companies/:companyId/push/subscriptions`.

- [ ] **Step 1: Write the failing test**

`server/src/__tests__/push-routes.test.ts` (embedded-pg, full app; mock `web-push` per Global Constraints; mirror app+auth assembly of `server/src/__tests__/auto-approve-policy-routes.test.ts`). Seed a company. Then:
```ts
// vapid public key (any board actor)
const vapid = await request(boardApp).get(`/api/push/vapid-public-key`);
expect(vapid.status).toBe(200);
expect(vapid.body.publicKey).toBe("PUB");

// subscribe (board) then a duplicate endpoint upserts (idempotent — still one row)
const body = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" }, userAgent: "UA" };
expect((await request(boardApp).post(`/api/companies/${companyId}/push/subscriptions`).send(body)).status).toBe(200);
expect((await request(boardApp).post(`/api/companies/${companyId}/push/subscriptions`).send(body)).status).toBe(200);
const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.companyId, companyId));
expect(rows).toHaveLength(1);

// non-board subscribe → 403
expect((await request(agentApp).post(`/api/companies/${companyId}/push/subscriptions`).send(body)).status).toBe(403);

// unsubscribe removes it
expect((await request(boardApp).delete(`/api/companies/${companyId}/push/subscriptions`).send({ endpoint: body.endpoint })).status).toBe(200);
expect((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.companyId, companyId))).length).toBe(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/push-routes.test.ts`
Expected: FAIL (routes not defined).

- [ ] **Step 3: Implement `routes/push.ts`**

```ts
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { pushSubscriptions, type Db } from "@paperclipai/db";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@paperclipai/shared";
import { pushVapidService } from "../services/index.js";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function pushRoutes(db: Db) {
  const router = Router();
  const vapid = pushVapidService(db);

  router.get("/push/vapid-public-key", async (req, res) => {
    const init = await vapid.ensureInitialised();
    if (!init) { res.status(503).json({ error: "Push not available" }); return; }
    res.json({ publicKey: init.publicKey });
  });

  router.post("/companies/:companyId/push/subscriptions", validate(pushSubscriptionSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    await db
      .insert(pushSubscriptions)
      .values({
        companyId, userId: actor.actorId, endpoint: req.body.endpoint,
        p256dh: req.body.keys.p256dh, auth: req.body.keys.auth, userAgent: req.body.userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { companyId, userId: actor.actorId, p256dh: req.body.keys.p256dh, auth: req.body.keys.auth, userAgent: req.body.userAgent ?? null },
      });
    res.json({ ok: true });
  });

  router.delete("/companies/:companyId/push/subscriptions", validate(pushUnsubscribeSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.companyId, companyId), eq(pushSubscriptions.endpoint, req.body.endpoint)));
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: Register the channel + mount in `app.ts`**

Add imports near the other route/service imports:
```ts
import { pushRoutes } from "./routes/push.js";
import { createWebPushChannel } from "./services/index.js";
```
Where the inbox channel is registered inside `createApp` (`registerChannel(createInboxDigestChannel(db))`), add alongside:
```ts
registerChannel(createWebPushChannel(db));
```
Mount the route with the other `api.use(...)` calls:
```ts
api.use(pushRoutes(db));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/push-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/push.ts server/src/app.ts server/src/__tests__/push-routes.test.ts
git commit -m "feat(combo-05): push subscription routes + register webpush channel"
```

---

### Task 7: Risk-gated trigger on approval create

**Files:**
- Modify: `server/src/routes/approvals.ts`
- Modify: `server/src/services/index.ts` (export `bandRank`)
- Test: `server/src/__tests__/approvals-high-risk-push.test.ts`

**Interfaces:**
- Consumes: `deliverThroughChannels` (Task 2), `buildApprovalPushBody` (Task 4), `bandRank`/`RiskBand` (approval-risk), `riskSvc.getSnapshot`.

- [ ] **Step 1: Export `bandRank` from the services barrel**

In `server/src/services/index.ts`, extend the approval-risk export line to include `bandRank`:
```ts
export { approvalRiskService, riskScore, RISK_BAND_ORDER, bandRank, type RiskBand } from "./approval-risk.js";
```

- [ ] **Step 2: Write the failing test**

`server/src/__tests__/approvals-high-risk-push.test.ts` (embedded-pg, full app). Mock `web-push` per Global Constraints. **Register the webpush channel in `beforeAll`** (`registerChannel(createWebPushChannel(db))`) and seed a company, an agent, and a `push_subscriptions` row for the company. To force risk bands deterministically, seed the `approval_risk` snapshot directly after create is unavailable (risk is computed on create) — instead, drive band via payload: a `hire_agent` approval with a large `budgetMonthlyCents` scores `critical` (sensitive type + spend); a plain `request_board_approval` with empty payload from a NON-allowlisted agent scores `medium` (below `high`). Assert:
```ts
// high/critical approval → a push send happened
await request(app).post(`/api/companies/${companyId}/approvals`).send({ type: "hire_agent", requestedByAgentId: agentId, payload: { budgetMonthlyCents: 900000, name: "X", role: "eng" } });
expect((webpush as any).sendNotification).toHaveBeenCalled();

// reset, then a below-high approval → no push
(webpush as any).sendNotification.mockClear();
await request(app).post(`/api/companies/${companyId}/approvals`).send({ type: "request_board_approval", requestedByAgentId: agentId, payload: {} });
expect((webpush as any).sendNotification).not.toHaveBeenCalled();
```
Confirm the `hire_agent` create path doesn't require secret config in the test env (Phase 2a's tests created hire_agent via direct insert; through the route, `secretsSvc.normalizeHireApprovalPayloadForPersistence` runs — if it throws without secret config, use a different high-band route: seed the approval, then directly `computeAndPersist` won't help since the trigger reads on create). **If `hire_agent` normalization is problematic in tests, instead** register a webpush channel and unit-test the trigger by asserting `deliverThroughChannels` is invoked for a stubbed high-band snapshot — but prefer the full-route path; adjust the high-band trigger by choosing an approval type whose payload pushes band ≥ high without secret normalization (e.g. `budget_override_required` with a sensitive payload key like `budgetMonthlyCents`, which adds sensitive-boundary + spend points → high). Verify the resulting band with a quick check against `riskScore` semantics before finalizing the seed.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/approvals-high-risk-push.test.ts`
Expected: FAIL (no trigger yet).

- [ ] **Step 4: Add the trigger**

In `server/src/routes/approvals.ts`:
- Add imports from `../services/index.js`: `deliverThroughChannels`, `buildApprovalPushBody`, `bandRank` (and `RiskBand` type from the same barrel if not already imported).
- Add the module-scope constant near `AUTO_DECISION_MAX_BAND`:
  ```ts
  const PUSH_MIN_BAND = "high" as const;
  ```
- In `POST /companies/:companyId/approvals`, replace the response tail:
  ```ts
  const finalApproval = (await svc.getById(approval.id)) ?? approval;
  res.status(201).json(redactApprovalPayload(finalApproval));
  ```
  with:
  ```ts
  const finalApproval = (await svc.getById(approval.id)) ?? approval;

  // Phase 3a: high-band approvals buzz the phone. Best-effort; never blocks create.
  if (finalApproval.status !== "approved") {
    const pushRisk = await riskSvc.getSnapshot(approval.id);
    if (pushRisk && bandRank(pushRisk.band as RiskBand) >= bandRank(PUSH_MIN_BAND)) {
      void deliverThroughChannels(
        { companyId },
        {
          kind: "approval_high_risk",
          title: `${pushRisk.band} risk approval needs you`,
          push: buildApprovalPushBody({ approvalType: approval.type, band: pushRisk.band, companyId, approvalId: approval.id }),
        },
      ).catch((err) => logger.warn({ err, approvalId: approval.id }, "high-risk push failed"));
    }
  }

  res.status(201).json(redactApprovalPayload(finalApproval));
  ```

- [ ] **Step 5: Run tests + regression**

Run: `pnpm exec vitest run server/src/__tests__/approvals-high-risk-push.test.ts`
Expected: PASS.
Run: `pnpm exec vitest run server/src/__tests__/ -t "approval"`
Expected: existing approval tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/approvals.ts server/src/services/index.ts server/src/__tests__/approvals-high-risk-push.test.ts
git commit -m "feat(combo-05): push high-band approvals on create (risk-gated)"
```

---

### Task 8: UI — subscribe flow, `/digest` toggle, SW push handler

**Files:**
- Create: `ui/src/api/push.ts`, `ui/src/lib/push.ts`
- Modify: `ui/public/sw.js`, `ui/src/pages/Digest.tsx`
- Test: `ui/src/lib/push.test.ts`

**Interfaces:**
- Consumes: `pushApi` (vapid-public-key / subscribe / unsubscribe).

- [ ] **Step 1: Add the API client**

`ui/src/api/push.ts`:
```ts
import { api } from "./client";

export const pushApi = {
  vapidPublicKey: () => api.get<{ publicKey: string }>(`/push/vapid-public-key`),
  subscribe: (companyId: string, body: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }) =>
    api.post<{ ok: true }>(`/companies/${companyId}/push/subscriptions`, body),
  unsubscribe: (companyId: string, endpoint: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/push/subscriptions`, { endpoint }),
};
```
Confirm `api.get/post/delete` signatures against `ui/src/api/client` (mirror `ui/src/api/approvals.ts`; if `api.delete` doesn't accept a body, send the endpoint as a query param and read `req.query` in the route instead — adjust Task 6 accordingly, or use POST for unsubscribe).

- [ ] **Step 2: Write the failing test**

`ui/src/lib/push.test.ts` (`// @vitest-environment jsdom`). Mock `../api/push` (`vapidPublicKey` → `{ publicKey: "<base64url>" }`, `subscribe` → `{ ok: true }`) and stub `navigator.serviceWorker.ready` / `PushManager` / `Notification`. Assert `subscribeToPush("company-1")` calls `Notification.requestPermission`, `pushManager.subscribe` with `applicationServerKey`, and `pushApi.subscribe` with the endpoint + keys. Structure the globals with `vi.stubGlobal`:
```ts
vi.stubGlobal("Notification", { requestPermission: vi.fn(() => Promise.resolve("granted")), permission: "granted" });
const subscribe = vi.fn(() => Promise.resolve({ endpoint: "https://p/x", toJSON: () => ({ keys: { p256dh: "p", auth: "a" } }) }));
vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe } }) } });
```
Assert `subscribe` was called and `pushApi.subscribe` received `{ endpoint: "https://p/x", keys: { p256dh: "p", auth: "a" } , ... }`.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run ui/src/lib/push.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `ui/src/lib/push.ts`**

```ts
import { pushApi } from "../api/push";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof Notification !== "undefined";
}

export async function subscribeToPush(companyId: string): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  const { publicKey } = await pushApi.vapidPublicKey();
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  const json = sub.toJSON();
  await pushApi.subscribe(companyId, { endpoint: sub.endpoint, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth }, userAgent: navigator.userAgent });
  return true;
}

export async function unsubscribeFromPush(companyId: string): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await pushApi.unsubscribe(companyId, sub.endpoint);
    await sub.unsubscribe();
  }
}
```

- [ ] **Step 5: Add the SW push handler**

In `ui/public/sw.js`, add before `// [END: module]` (leave existing handlers intact):
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

- [ ] **Step 6: Add the `/digest` toggle**

In `ui/src/pages/Digest.tsx`, add an "Enable push notifications" button that calls `subscribeToPush(companyId)` (and shows "Enabled" / a disable action calling `unsubscribeFromPush`). Gate on `pushSupported()`. Keep it minimal — a `useState` for the enabled flag seeded from `Notification.permission === "granted"` is sufficient. Do not block the existing digest UI.

- [ ] **Step 7: Run tests + ui typecheck**

Run: `pnpm exec vitest run ui/src/lib/push.test.ts`
Expected: PASS.
Run: `pnpm --filter @paperclipai/ui exec tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add ui/src/api/push.ts ui/src/lib/push.ts ui/public/sw.js ui/src/pages/Digest.tsx ui/src/lib/push.test.ts
git commit -m "feat(combo-05): client push subscribe flow + SW push handler + digest toggle"
```

---

### Task 9: Full-suite + typecheck gate

**Files:** none (verification only).

- [ ] **Step 1: Run the Phase-3a suites together**

Run:
```bash
pnpm exec vitest run \
  packages/db/src/__tests__/schema-push.test.ts \
  server/src/__tests__/deliver-through-channels.test.ts \
  server/src/__tests__/push-vapid-service.test.ts \
  server/src/services/push-notifications.test.ts \
  server/src/__tests__/webpush-channel.test.ts \
  packages/shared/src/validators/push.test.ts \
  server/src/__tests__/push-routes.test.ts \
  server/src/__tests__/approvals-high-risk-push.test.ts \
  server/src/__tests__/digest-service.test.ts \
  ui/src/lib/push.test.ts
```
Expected: all PASS (digest-service included to confirm the Task 2 refactor didn't regress).

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm --filter @paperclipai/db typecheck && \
pnpm --filter @paperclipai/shared exec tsc --noEmit && \
pnpm --filter @paperclipai/server exec tsc --noEmit && \
pnpm --filter @paperclipai/ui exec tsc --noEmit
```
Expected: no type errors.

- [ ] **Step 3: Regression-check delivery + approval consumers**

Run: `pnpm exec vitest run server/src/__tests__/ -t "approval"`
Expected: existing approval + triage + auto-approve tests still PASS.

- [ ] **Step 4: Full suite**

Run: `pnpm test`
Expected: full suite PASS. (The 2 pre-existing date-flaky `ui/src/components/artifacts/ArtifactCard.test.tsx` failures are unrelated — see prior phases.)

- [ ] **Step 5: Commit (if any lockfile/snapshot churn)**

```bash
git add -A
git commit -m "test(combo-05): Phase 3a full-suite + typecheck green" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- `push_subscriptions` + `push_vapid_keys` (migration `0114`) → Task 1. ✔
- `deliverThroughChannels` + `NotificationPayload.push` + digest refactor → Task 2. ✔
- VAPID auto-generate + persist (dedicated table, server-only) + `web-push` dep → Task 3. ✔
- `webpush` channel (send per subscription, prune 410/404, bump last_used) + pure payload builder → Task 4. ✔
- Subscribe/unsubscribe validators → Task 5. ✔
- Board-only routes (vapid-public-key, subscribe idempotent, unsubscribe) + register channel + mount → Task 6. ✔
- Risk-gated trigger (band ≥ high, non-auto-approved, best-effort) + `bandRank` export → Task 7. ✔
- Client subscribe flow + SW push handler + `/digest` toggle → Task 8. ✔
- Best-effort discipline (VAPID null → skip; per-sub catch; trigger `void … .catch`) → Tasks 3/4/7. ✔
- Full-suite + typecheck + regression → Task 9. ✔
- Out of scope (notificationclick, one-tap actions, prefs, email) → not implemented. ✔

**Placeholder scan:** No "TBD"/"handle edge cases". Bounded implementer-judgement points, each with a concrete resolution: the high-band test-seed approval type (Task 7 — verify band ≥ high against `riskScore` before finalizing; avoid `hire_agent` if secret normalization throws in tests), `api.delete` body support (Task 8 — mirror existing client; fall back to POST/query if unsupported, adjusting Task 6), and the `/digest` toggle styling (Task 8 — minimal button is sufficient).

**Type consistency:** `NotificationPayload.push` (Task 2) is read by the webpush channel (Task 4) and written by the trigger (Task 7) and the payload builder (Task 4). `DeliveryChannel.name` already includes `"webpush"` (no type change). `pushVapidService` (Task 3) consumed by the channel (Task 4) and routes (Task 6). `buildApprovalPushBody` return shape === `NotificationPayload.push` shape. `pushSubscriptionSchema`/`pushUnsubscribeSchema` (Task 5) consumed by routes (Task 6). `bandRank`/`RiskBand` (approval-risk) used in the trigger (Task 7). `deliverThroughChannels` (Task 2) used by digest (Task 2) and trigger (Task 7). `PUSH_MIN_BAND = "high"`.

**web-push mocking (resolved):** every server test that imports a module which transitively imports `web-push` mocks it with the Global-Constraints shape (Tasks 3/4/6/7). No test sends a real push. `web-push`'s `setVapidDetails` is process-global; the VAPID service memoises it with a module-level flag, so tests assert `toHaveBeenCalled()` (not exact counts) for it.

**Delivery-pipeline note:** Task 6 registers the webpush channel at app startup alongside 2b's inbox channel; both are keyed by distinct `name`s in the registry, so `deliverThroughChannels` fans out to both and each no-ops on payloads lacking its field (`digest` vs `push`). Service/route tests register the needed channel(s) explicitly in setup (process-isolated files).
