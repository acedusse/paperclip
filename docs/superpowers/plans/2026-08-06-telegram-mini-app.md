# Telegram Mini App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the existing Paperclip board inside a Telegram Mini App, authenticated by Telegram's signed `initData`, with a six-item bottom nav (Dashboard · Tasks · Triage · Digest · Artifacts · Wikis).

**Architecture:** Telegram opens a webview at `{publicBaseUrl}/telegram/app?c={companyId}`. The page exchanges its signed `initData` for a short-lived bearer token: the server verifies the HMAC using that company's bot token, range-checks `auth_date`, resolves `initData.user.id` against `telegram_chat_bindings.telegram_user_id` (added in migration `0125`) to get a Paperclip user, and mints a session hashed at rest. `actorMiddleware` resolves that bearer to a board actor scoped to exactly one company. The UI is the same React build — only the bottom nav and theme differ when Telegram is detected.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Postgres), React + React Router + TanStack Query, Vitest (embedded-postgres for server integration, jsdom for UI), Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-06-telegram-mini-app-design.md`

## Global Constraints

- Branch: `feat/telegram-approval-channel`. Do not commit to `master`.
- Migrations are **hand-written SQL** in `packages/db/src/migrations/NNNN_name.sql` plus an appended entry in `meta/_journal.json`. Never run drizzle-kit generate. Next free index is **0126**.
- Every new db table is exported from `packages/db/src/schema/index.ts` as `export { table, type TableRow } from "./file.js";` — `packages/db/src/index.ts` re-exports the barrel with `export *`.
- Server test files under `server/src/__tests__/` are **excluded from `server/tsconfig.json`** and are NOT typechecked. Files at `server/src/services/*.test.ts` ARE typechecked. Put pure-function unit tests beside the source.
- Telegram ids are numbers on the wire and **strings** in our schema and comparisons.
- `MINIAPP_INITDATA_MAX_AGE_SECONDS` = 300. `MINIAPP_SESSION_TTL_HOURS` = 12.
- The bot token is the HMAC key. Never log it, never return it on a read path.
- Verify the platform claims in spec §7 against `core.telegram.org/bots/webapps` **before Task 2**, and record the outcome in `doc/TELEGRAM-CHANNEL.md`'s verification table.

---

## File Structure

**Create:**
- `packages/db/src/migrations/0126_telegram_miniapp_sessions.sql` — the sessions table.
- `packages/db/src/schema/telegram_miniapp_sessions.ts` — its Drizzle schema.
- `server/src/services/telegram-initdata.ts` — pure `initData` parsing + HMAC verification. No db, no I/O.
- `server/src/services/telegram-initdata.test.ts` — unit tests (typechecked, beside source).
- `server/src/services/telegram-miniapp-session.ts` — mint / resolve / revoke sessions.
- `server/src/__tests__/telegram-miniapp-session.test.ts` — integration tests on embedded postgres.
- `ui/src/telegram/webapp.ts` — the `window.Telegram.WebApp` adapter (detection, theme, expand).
- `ui/src/telegram/useTelegramSession.ts` — bootstraps the bearer token.
- `ui/src/components/TelegramBottomNav.tsx` — the six-item nav.
- `ui/src/components/TelegramBottomNav.test.tsx` — jsdom test.

**Modify:**
- `packages/db/src/schema/index.ts` — export the new table.
- `packages/db/src/migrations/meta/_journal.json` — append entry 126.
- `server/src/types/express.d.ts:36` — add `"telegram_miniapp"` to the `source` union.
- `server/src/middleware/auth.ts` — new bearer branch after the board-key branch (~line 144).
- `server/src/services/telegram-link.ts` — revoke sessions when a binding is revoked.
- `server/src/services/telegram-transport.ts` — add `setChatMenuButton`.
- `server/src/services/telegram-format.ts` — add the `web_app` "Review in full" button.
- `server/src/services/index.ts` — export the new services.
- `server/src/routes/telegram.ts` — the session endpoint; call `setChatMenuButton` on config save.
- `ui/src/context/SidebarContext.tsx` — add `isTelegram`.
- `ui/src/components/Layout.tsx:597` — branch to `TelegramBottomNav`.
- `ui/src/pages/ApprovalTriage.tsx` — findings X2 and X3.
- `ui/src/pages/ApprovalTriage.test.tsx` — cover them.
- `doc/TELEGRAM-CHANNEL.md` — Mini App section.

---

### Task 1: Sessions table

**Files:**
- Create: `packages/db/src/migrations/0126_telegram_miniapp_sessions.sql`
- Create: `packages/db/src/schema/telegram_miniapp_sessions.ts`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Modify: `packages/db/src/schema/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `telegramMiniappSessions` table and `TelegramMiniappSessionRow` type, importable from `@paperclipai/db`. Columns: `id`, `companyId`, `userId`, `tokenHash`, `expiresAt`, `createdAt`, `lastUsedAt`, `revokedAt`, `bindingId`.

- [ ] **Step 1: Write the migration**

Create `packages/db/src/migrations/0126_telegram_miniapp_sessions.sql`:

```sql
-- Short-lived board sessions minted from a verified Telegram Mini App initData.
--
-- The token is returned to the client once and stored only as a sha256 hash, the same way
-- agent_api_keys are held. binding_id is kept so revoking a chat binding can revoke every session
-- it produced -- the board's "unlink chat" control must stay a real kill switch.
CREATE TABLE IF NOT EXISTS "telegram_miniapp_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "binding_id" uuid,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_miniapp_sessions_token_hash_idx" ON "telegram_miniapp_sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_miniapp_sessions_binding_idx" ON "telegram_miniapp_sessions" ("binding_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "telegram_miniapp_sessions" ADD CONSTRAINT "telegram_miniapp_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "telegram_miniapp_sessions" ADD CONSTRAINT "telegram_miniapp_sessions_binding_id_telegram_chat_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."telegram_chat_bindings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
```

- [ ] **Step 2: Append the journal entry**

Run this exact command (hand-editing the JSON risks reformatting the whole file):

```bash
python3 -c "
import json
p='packages/db/src/migrations/meta/_journal.json'
j=json.load(open(p))
j['entries'].append({'idx':126,'version':'7','when':1785400000000,'tag':'0126_telegram_miniapp_sessions','breakpoints':True})
open(p,'w').write(json.dumps(j,indent=2)+'\n')
"
git diff --stat packages/db/src/migrations/meta/_journal.json
```

Expected: `1 file changed, 7 insertions(+)`. If deletions appear, revert and retry.

- [ ] **Step 3: Write the schema file**

Create `packages/db/src/schema/telegram_miniapp_sessions.ts`:

```ts
/**
 * FILE: packages/db/src/schema/telegram_miniapp_sessions.ts
 * ABOUT: telegram_miniapp_sessions.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - short-lived board sessions minted from a verified Mini App initData.
 */
// ==========================================
// [META: module]
// INTENT: Hold a Mini App's bearer session as a hash, scoped to exactly one company, so a Telegram
//   webview can call the board API as its bound user without a password and without a long-lived key.
// PSEUDOCODE: 1. Define telegram_miniapp_sessions. 2. Unique on token_hash, indexed by binding.
//   3. Export the row type.
// JSON_FLOW: {"file": "packages/db/src/schema/telegram_miniapp_sessions.ts", "imports": "drizzle-orm/pg-core, ./companies.js, ./telegram_chat_bindings.js", "exports": "telegramMiniappSessions, TelegramMiniappSessionRow"}
// ==========================================
// [START: module]
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { telegramChatBindings } from "./telegram_chat_bindings.js";

export const telegramMiniappSessions = pgTable(
  "telegram_miniapp_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    // Kept so revoking a chat binding revokes every session it produced.
    bindingId: uuid("binding_id").references(() => telegramChatBindings.id, { onDelete: "set null" }),
    // The token itself is returned to the client once and never stored.
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashIdx: index("telegram_miniapp_sessions_token_hash_idx").on(table.tokenHash),
    bindingIdx: index("telegram_miniapp_sessions_binding_idx").on(table.bindingId),
  }),
);
export type TelegramMiniappSessionRow = typeof telegramMiniappSessions.$inferSelect;
// [END: module]
```

- [ ] **Step 4: Export from the barrel**

In `packages/db/src/schema/index.ts`, directly after the `telegramChatBindings` line (currently line 111), add:

```ts
export { telegramMiniappSessions, type TelegramMiniappSessionRow } from "./telegram_miniapp_sessions.js";
```

- [ ] **Step 5: Verify it compiles and migrates**

```bash
npx tsc --noEmit -p packages/db/tsconfig.json
npx vitest run packages/db
```

Expected: tsc silent; all db tests pass. The embedded-postgres suites run every migration from scratch, so a broken `0126` fails here.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/0126_telegram_miniapp_sessions.sql packages/db/src/migrations/meta/_journal.json packages/db/src/schema/telegram_miniapp_sessions.ts packages/db/src/schema/index.ts
git commit -m "feat(db): telegram_miniapp_sessions for Mini App bearer sessions"
```

---

### Task 2: initData verification

**Files:**
- Create: `server/src/services/telegram-initdata.ts`
- Create: `server/src/services/telegram-initdata.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `verifyTelegramInitData(input: { initData: string; botToken: string; now?: Date; maxAgeSeconds?: number }): TelegramInitDataResult`
  - `type TelegramInitDataResult = { ok: true; telegramUserId: string; authDate: Date; user: { id: string; firstName: string | null; username: string | null } } | { ok: false; reason: "malformed" | "bad_signature" | "stale" | "no_user" }`
  - `const MINIAPP_INITDATA_MAX_AGE_SECONDS = 300`

**Before starting:** confirm against `core.telegram.org/bots/webapps` that the secret key is
`HMAC_SHA256(<bot_token>, "WebAppData")` — i.e. **the string `"WebAppData"` is the HMAC key and the
bot token is the message** — and that `auth_date` is a unix-seconds field. If the docs disagree,
stop and report rather than guessing; a wrong argument order here can validate everything.

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/telegram-initdata.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MINIAPP_INITDATA_MAX_AGE_SECONDS, verifyTelegramInitData } from "./telegram-initdata.js";

const BOT_TOKEN = "123456789:AAHk9Xy_ZqL0pQrStUvWxYz1234567890abc";
const NOW = new Date("2026-08-06T12:00:00.000Z");

/** Build a correctly-signed initData string, the way Telegram would. */
function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

function validFields(overrides: Record<string, string> = {}) {
  return {
    auth_date: String(Math.floor(NOW.getTime() / 1000)),
    query_id: "AAF_test",
    user: JSON.stringify({ id: 77, first_name: "Dana", username: "dana" }),
    ...overrides,
  };
}

describe("verifyTelegramInitData", () => {
  it("accepts a correctly signed payload and returns the Telegram user id as a string", () => {
    const result = verifyTelegramInitData({ initData: signInitData(validFields()), botToken: BOT_TOKEN, now: NOW });
    expect(result).toMatchObject({ ok: true, telegramUserId: "77" });
  });

  it("exposes the user's display fields", () => {
    const result = verifyTelegramInitData({ initData: signInitData(validFields()), botToken: BOT_TOKEN, now: NOW });
    if (!result.ok) throw new Error("expected ok");
    expect(result.user).toEqual({ id: "77", firstName: "Dana", username: "dana" });
  });

  // The failure mode of a broken HMAC check is silent acceptance, so this is the test that matters.
  it("rejects a payload whose fields were tampered with after signing", () => {
    const signed = signInitData(validFields());
    const params = new URLSearchParams(signed);
    params.set("user", JSON.stringify({ id: 999, first_name: "Mallory" }));
    const result = verifyTelegramInitData({ initData: params.toString(), botToken: BOT_TOKEN, now: NOW });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a payload signed with a different bot token", () => {
    const signed = signInitData(validFields(), "999:OTHERTOKEN");
    const result = verifyTelegramInitData({ initData: signed, botToken: BOT_TOKEN, now: NOW });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a payload with no hash at all", () => {
    const params = new URLSearchParams(validFields());
    const result = verifyTelegramInitData({ initData: params.toString(), botToken: BOT_TOKEN, now: NOW });
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a stale payload, since a signature does not expire on its own", () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - MINIAPP_INITDATA_MAX_AGE_SECONDS - 1);
    const result = verifyTelegramInitData({
      initData: signInitData(validFields({ auth_date: old })),
      botToken: BOT_TOKEN,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts a payload right at the freshness boundary", () => {
    const edge = String(Math.floor(NOW.getTime() / 1000) - MINIAPP_INITDATA_MAX_AGE_SECONDS);
    const result = verifyTelegramInitData({
      initData: signInitData(validFields({ auth_date: edge })),
      botToken: BOT_TOKEN,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a correctly signed payload that names no user", () => {
    const fields = validFields();
    delete (fields as Record<string, string>).user;
    const result = verifyTelegramInitData({ initData: signInitData(fields), botToken: BOT_TOKEN, now: NOW });
    expect(result).toEqual({ ok: false, reason: "no_user" });
  });

  it("rejects a non-numeric auth_date", () => {
    const result = verifyTelegramInitData({
      initData: signInitData(validFields({ auth_date: "not-a-date" })),
      botToken: BOT_TOKEN,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run server/src/services/telegram-initdata.test.ts
```

Expected: FAIL — cannot resolve `./telegram-initdata.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/services/telegram-initdata.ts`:

```ts
/**
 * FILE: server/src/services/telegram-initdata.ts
 * ABOUT: telegram-initdata.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - verify the signed initData a Telegram Mini App presents.
 */
// ==========================================
// [META: module]
// INTENT: Turn the opaque signed blob Telegram hands a webview into a trusted Telegram user id, or
//   into a refusal. This is the whole authentication boundary for the Mini App, so it is pure: no db,
//   no clock of its own, no I/O -- everything it decides is a function of its arguments.
// PSEUDOCODE: 1. Parse the query string; pull out and remove `hash`. 2. Rebuild the documented
//   data_check_string: remaining fields sorted by key, joined "k=v" with newlines. 3. secret =
//   HMAC(key "WebAppData", bot token); expected = HMAC(key secret, data_check_string). 4. Compare in
//   constant time. 5. Range-check auth_date. 6. Parse the user object.
// JSON_FLOW: {"file": "server/src/services/telegram-initdata.ts", "imports": "node:crypto", "exports": "verifyTelegramInitData, TelegramInitDataResult, MINIAPP_INITDATA_MAX_AGE_SECONDS"}
// ==========================================
// [START: module]
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A signature does not expire by itself, so a captured initData would otherwise be a permanent
 * credential. Five minutes is long enough for a slow webview boot and short enough that a leaked
 * blob is worthless by the time it is replayed.
 */
export const MINIAPP_INITDATA_MAX_AGE_SECONDS = 300;

export type TelegramInitDataResult =
  | {
      ok: true;
      telegramUserId: string;
      authDate: Date;
      user: { id: string; firstName: string | null; username: string | null };
    }
  | { ok: false; reason: "malformed" | "bad_signature" | "stale" | "no_user" };

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch {
    return false;
  }
}

export function verifyTelegramInitData(input: {
  initData: string;
  botToken: string;
  now?: Date;
  maxAgeSeconds?: number;
}): TelegramInitDataResult {
  const now = input.now ?? new Date();
  const maxAge = input.maxAgeSeconds ?? MINIAPP_INITDATA_MAX_AGE_SECONDS;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(input.initData);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const presentedHash = params.get("hash");
  if (!presentedHash) return { ok: false, reason: "malformed" };
  params.delete("hash");

  // The documented data_check_string: every remaining field as "key=value", sorted by key,
  // newline-joined. Values are the already-decoded ones, not the percent-encoded originals.
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  // Note the argument order: "WebAppData" is the KEY and the bot token is the MESSAGE. Reversing
  // these produces a stable-looking hash that verifies nothing.
  const secret = createHmac("sha256", "WebAppData").update(input.botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest("hex");
  if (!constantTimeHexEqual(presentedHash, expected)) return { ok: false, reason: "bad_signature" };

  const authDateRaw = params.get("auth_date");
  const authDateSeconds = Number(authDateRaw);
  if (!authDateRaw || !Number.isFinite(authDateSeconds)) return { ok: false, reason: "malformed" };
  const authDate = new Date(authDateSeconds * 1000);
  if ((now.getTime() - authDate.getTime()) / 1000 > maxAge) return { ok: false, reason: "stale" };

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "no_user" };
  let parsed: { id?: number | string; first_name?: string; username?: string };
  try {
    parsed = JSON.parse(userRaw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (parsed.id === undefined || parsed.id === null) return { ok: false, reason: "no_user" };

  return {
    ok: true,
    telegramUserId: String(parsed.id),
    authDate,
    user: { id: String(parsed.id), firstName: parsed.first_name ?? null, username: parsed.username ?? null },
  };
}
// [END: module]
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run server/src/services/telegram-initdata.test.ts
npx tsc --noEmit -p server/tsconfig.json
```

Expected: 9 passed; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/telegram-initdata.ts server/src/services/telegram-initdata.test.ts
git commit -m "feat(telegram): verify Mini App initData signatures"
```

---

### Task 3: Session service

**Files:**
- Create: `server/src/services/telegram-miniapp-session.ts`
- Create: `server/src/__tests__/telegram-miniapp-session.test.ts`
- Modify: `server/src/services/telegram-link.ts`
- Modify: `server/src/services/index.ts`

**Interfaces:**
- Consumes: `telegramMiniappSessions` (Task 1); `verifyTelegramInitData`, `MINIAPP_INITDATA_MAX_AGE_SECONDS` (Task 2); existing `telegramBotConfigs`, `telegramChatBindings`.
- Produces: `telegramMiniappSessionService(db)` with:
  - `mint(input: { companyId: string; initData: string; now?: Date }): Promise<MintResult>` where `MintResult = { ok: true; token: string; expiresAt: Date; userId: string; companyId: string; user: {...} } | { ok: false; reason: "no_bot" | "bad_signature" | "stale" | "malformed" | "not_bound" }`
  - `resolve(token: string, now?: Date): Promise<TelegramMiniappSessionRow | null>`
  - `revokeForBinding(bindingId: string): Promise<void>`
  - `MINIAPP_SESSION_TTL_HOURS: number` exported as a const from the module.

- [ ] **Step 1: Write the failing tests**

Create `server/src/__tests__/telegram-miniapp-session.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { companies, createDb, telegramBotConfigs } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { telegramLinkService } from "../services/telegram-link.js";
import { telegramMiniappSessionService } from "../services/telegram-miniapp-session.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping Mini App session tests: ${embeddedPostgresSupport.reason ?? "unsupported"}`);
}

const BOT_TOKEN = "123456789:AAHk9Xy_ZqL0pQrStUvWxYz1234567890abc";
const TG_USER = "77";
const NOW = new Date("2026-08-06T12:00:00.000Z");

function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const checkString = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

function initDataFor(telegramUserId: string, at = NOW, botToken = BOT_TOKEN): string {
  return signInitData(
    {
      auth_date: String(Math.floor(at.getTime() / 1000)),
      user: JSON.stringify({ id: Number(telegramUserId), first_name: "Dana" }),
    },
    botToken,
  );
}

describeEmbeddedPostgres("telegramMiniappSessionService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-miniapp-session-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE companies CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name = "Acme") {
    return db
      .insert(companies)
      .values({ name, issuePrefix: `TG${Math.random().toString(36).slice(2, 6).toUpperCase()}` })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function seedBot(companyId: string) {
    await db.insert(telegramBotConfigs).values({
      companyId,
      botToken: BOT_TOKEN,
      botUsername: "acme_ops_bot",
      webhookSecret: "hook-secret",
      enabled: true,
    });
  }

  async function seedBinding(companyId: string, userId: string, telegramUserId = TG_USER, chatId = "555") {
    const links = telegramLinkService(db);
    const { code } = await links.createLinkCode({ companyId, userId });
    const redeemed = await links.redeemLinkCode({ code, chatId, telegramUserId });
    if (!redeemed.ok) throw new Error("seed failed");
    return redeemed.binding;
  }

  it("mints a session for a bound Telegram user", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBe("user-board-1");
    expect(result.companyId).toBe(company.id);
    expect(result.token.length).toBeGreaterThanOrEqual(32);
    expect(result.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("resolves a minted token back to its session", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");

    const session = await svc.resolve(minted.token, NOW);

    expect(session?.userId).toBe("user-board-1");
    expect(session?.companyId).toBe(company.id);
  });

  it("never stores the token itself", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");

    const rows = await db.execute(sql`SELECT token_hash FROM telegram_miniapp_sessions`);
    const stored = (rows as unknown as { rows: { token_hash: string }[] }).rows ?? rows;
    expect(JSON.stringify(stored)).not.toContain(minted.token);
  });

  it("refuses a Telegram user with no binding for the company", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor("999"), now: NOW });

    expect(result).toEqual({ ok: false, reason: "not_bound" });
  });

  it("refuses a binding that predates the recorded Telegram user id", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    const binding = await seedBinding(company.id, "user-board-1");
    await db.execute(sql`UPDATE telegram_chat_bindings SET telegram_user_id = NULL WHERE id = ${binding.id}`);
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });

    expect(result).toEqual({ ok: false, reason: "not_bound" });
  });

  it("refuses a tampered initData", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const params = new URLSearchParams(initDataFor(TG_USER));
    params.set("user", JSON.stringify({ id: 999, first_name: "Mallory" }));
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: params.toString(), now: NOW });

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a stale initData", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const old = new Date(NOW.getTime() - 10 * 60_000);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER, old), now: NOW });

    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("refuses when the company has no bot configured", async () => {
    const company = await seedCompany();
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });

    expect(result).toEqual({ ok: false, reason: "no_bot" });
  });

  // The binding is per company, so a Telegram user bound to A must not reach B even though the
  // same person is behind both.
  it("cannot mint a session for a company the Telegram user is not bound to", async () => {
    const companyA = await seedCompany("A");
    const companyB = await seedCompany("B");
    await seedBot(companyA.id);
    await seedBot(companyB.id);
    await seedBinding(companyA.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);

    const result = await svc.mint({ companyId: companyB.id, initData: initDataFor(TG_USER), now: NOW });

    expect(result).toEqual({ ok: false, reason: "not_bound" });
  });

  it("does not resolve an expired session", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");

    const later = new Date(minted.expiresAt.getTime() + 1000);
    expect(await svc.resolve(minted.token, later)).toBeNull();
  });

  // "Unlink chat" on the board must remain a real kill switch.
  it("revokes live sessions when their binding is revoked", async () => {
    const company = await seedCompany();
    await seedBot(company.id);
    const binding = await seedBinding(company.id, "user-board-1");
    const svc = telegramMiniappSessionService(db);
    const minted = await svc.mint({ companyId: company.id, initData: initDataFor(TG_USER), now: NOW });
    if (!minted.ok) throw new Error("expected mint");
    expect(await svc.resolve(minted.token, NOW)).not.toBeNull();

    await telegramLinkService(db).revokeBinding({ companyId: company.id, id: binding.id });

    expect(await svc.resolve(minted.token, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run server/src/__tests__/telegram-miniapp-session.test.ts
```

Expected: FAIL — cannot resolve `../services/telegram-miniapp-session.js`.

- [ ] **Step 3: Write the session service**

Create `server/src/services/telegram-miniapp-session.ts`:

```ts
/**
 * FILE: server/src/services/telegram-miniapp-session.ts
 * ABOUT: telegram-miniapp-session.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - mint and resolve the bearer sessions a Telegram Mini App runs on.
 */
// ==========================================
// [META: module]
// INTENT: Trade a verified initData for a short-lived board session scoped to exactly one company.
//   This is a far larger grant than an inline button ever was -- a button decided one approval, this
//   is the board API as that user -- so the identity it rests on is re-derived here from the binding
//   and never taken from the request.
// PSEUDOCODE: 1. Load the company's enabled bot config; its token is the HMAC key. 2. Verify the
//   initData. 3. Resolve a live binding for (company, telegram user). 4. Mint a random token, store
//   only its sha256. 5. resolve() looks up by hash, rejecting revoked and expired rows.
// JSON_FLOW: {"file": "server/src/services/telegram-miniapp-session.ts", "imports": "node:crypto, drizzle-orm, @paperclipai/db, ./telegram-initdata.js", "exports": "telegramMiniappSessionService, MINIAPP_SESSION_TTL_HOURS, TelegramMiniappMintResult"}
// ==========================================
// [START: module]
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import {
  telegramBotConfigs,
  telegramChatBindings,
  telegramMiniappSessions,
  type Db,
  type TelegramMiniappSessionRow,
} from "@paperclipai/db";
import { verifyTelegramInitData } from "./telegram-initdata.js";

/**
 * Short, because the webview holds its initData for as long as it is open and can mint a replacement
 * silently on a 401 -- the operator never sees an expiry, so there is no reason to be generous.
 */
export const MINIAPP_SESSION_TTL_HOURS = 12;
const TOKEN_BYTES = 32;

export type TelegramMiniappMintResult =
  | {
      ok: true;
      token: string;
      expiresAt: Date;
      userId: string;
      companyId: string;
      user: { id: string; firstName: string | null; username: string | null };
    }
  | { ok: false; reason: "no_bot" | "bad_signature" | "stale" | "malformed" | "not_bound" };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function telegramMiniappSessionService(db: Db) {
  return {
    async mint(input: { companyId: string; initData: string; now?: Date }): Promise<TelegramMiniappMintResult> {
      const now = input.now ?? new Date();

      const [config] = await db
        .select()
        .from(telegramBotConfigs)
        .where(and(eq(telegramBotConfigs.companyId, input.companyId), eq(telegramBotConfigs.enabled, true)));
      if (!config) return { ok: false, reason: "no_bot" };

      const verified = verifyTelegramInitData({
        initData: input.initData,
        botToken: config.botToken,
        now,
      });
      if (!verified.ok) {
        // "no_user" is a malformed payload from our side of the boundary: correctly signed, but
        // carrying nothing we can act as.
        return { ok: false, reason: verified.reason === "no_user" ? "malformed" : verified.reason };
      }

      const [binding] = await db
        .select()
        .from(telegramChatBindings)
        .where(
          and(
            eq(telegramChatBindings.companyId, input.companyId),
            eq(telegramChatBindings.telegramUserId, verified.telegramUserId),
            isNull(telegramChatBindings.revokedAt),
            isNotNull(telegramChatBindings.linkedAt),
          ),
        );
      // A pre-0125 binding has a null telegram_user_id and simply does not match here -- the same
      // fail-closed outcome the decision path reaches, by the same mechanism rather than a second rule.
      if (!binding) return { ok: false, reason: "not_bound" };

      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const expiresAt = new Date(now.getTime() + MINIAPP_SESSION_TTL_HOURS * 3_600_000);
      await db.insert(telegramMiniappSessions).values({
        companyId: input.companyId,
        userId: binding.userId,
        bindingId: binding.id,
        tokenHash: hashToken(token),
        expiresAt,
      });

      return {
        ok: true,
        token,
        expiresAt,
        userId: binding.userId,
        companyId: input.companyId,
        user: verified.user,
      };
    },

    async resolve(token: string, now?: Date): Promise<TelegramMiniappSessionRow | null> {
      const at = now ?? new Date();
      const [row] = await db
        .select()
        .from(telegramMiniappSessions)
        .where(
          and(
            eq(telegramMiniappSessions.tokenHash, hashToken(token)),
            isNull(telegramMiniappSessions.revokedAt),
            gt(telegramMiniappSessions.expiresAt, at),
          ),
        );
      return row ?? null;
    },

    async touch(id: string): Promise<void> {
      await db
        .update(telegramMiniappSessions)
        .set({ lastUsedAt: new Date() })
        .where(eq(telegramMiniappSessions.id, id));
    },

    async revokeForBinding(bindingId: string): Promise<void> {
      await db
        .update(telegramMiniappSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(telegramMiniappSessions.bindingId, bindingId), isNull(telegramMiniappSessions.revokedAt)));
    },
  };
}
// [END: module]
```

- [ ] **Step 4: Revoke sessions when a binding is revoked**

In `server/src/services/telegram-link.ts`, add the import at the top of the import block:

```ts
import { telegramMiniappSessionService } from "./telegram-miniapp-session.js";
```

Inside `telegramLinkService(db)`, immediately after the `resolveBinding` function declaration, add:

```ts
  const miniappSessions = telegramMiniappSessionService(db);
```

Then replace the body of `revokeBinding` with:

```ts
    async revokeBinding(input: { companyId: string; id: string }): Promise<boolean> {
      const revoked = await db
        .update(telegramChatBindings)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(telegramChatBindings.id, input.id),
            eq(telegramChatBindings.companyId, input.companyId),
            isNull(telegramChatBindings.revokedAt),
          ),
        )
        .returning();
      if (revoked.length === 0) return false;
      // Unlinking a chat must also end every Mini App session it produced, or the board's kill
      // switch would only stop the buttons and leave the webview holding a working board session.
      await miniappSessions.revokeForBinding(input.id);
      return true;
    },
```

- [ ] **Step 5: Export from the services barrel**

In `server/src/services/index.ts`, directly after the `telegramLinkService` export line, add:

```ts
export {
  telegramMiniappSessionService,
  MINIAPP_SESSION_TTL_HOURS,
  type TelegramMiniappMintResult,
} from "./telegram-miniapp-session.js";
export { verifyTelegramInitData, MINIAPP_INITDATA_MAX_AGE_SECONDS } from "./telegram-initdata.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run server/src/__tests__/telegram-miniapp-session.test.ts server/src/__tests__/telegram-link-service.test.ts
npx tsc --noEmit -p server/tsconfig.json
```

Expected: all pass; tsc silent. If `telegram-link-service.test.ts` fails on a missing table, the migration from Task 1 has not been applied — re-run Task 1 Step 5.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/telegram-miniapp-session.ts server/src/__tests__/telegram-miniapp-session.test.ts server/src/services/telegram-link.ts server/src/services/index.ts
git commit -m "feat(telegram): mint and revoke Mini App bearer sessions"
```

---

### Task 4: Actor middleware branch

**Files:**
- Modify: `server/src/types/express.d.ts:36`
- Modify: `server/src/middleware/auth.ts:144`

**Interfaces:**
- Consumes: `telegramMiniappSessionService` (Task 3).
- Produces: a request with `req.actor.source === "telegram_miniapp"`, `type: "board"`, `userId` from the session, and `companyIds` narrowed to the session's single company.

- [ ] **Step 1: Widen the source union**

In `server/src/types/express.d.ts`, line 36, add `"telegram_miniapp"` to the union:

```ts
        source?: "local_implicit" | "session" | "board_key" | "agent_key" | "agent_jwt" | "cloud_tenant" | "telegram_miniapp" | "none";
```

- [ ] **Step 2: Write the failing test**

Append to `server/src/__tests__/telegram-miniapp-session.test.ts`, inside the existing `describeEmbeddedPostgres` block, after the last test:

```ts
  it("resolves a minted token to a board actor scoped to one company", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { actorMiddleware } = await import("../middleware/auth.js");

    const company = await seedCompany();
    await seedBot(company.id);
    await seedBinding(company.id, "user-board-1");
    const minted = await telegramMiniappSessionService(db).mint({
      companyId: company.id,
      initData: initDataFor(TG_USER),
      now: NOW,
    });
    if (!minted.ok) throw new Error("expected mint");

    const app = express();
    app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    app.get("/whoami", (req, res) => res.json(req.actor));

    const res = await request(app).get("/whoami").set("authorization", `Bearer ${minted.token}`);

    expect(res.body.type).toBe("board");
    expect(res.body.userId).toBe("user-board-1");
    expect(res.body.source).toBe("telegram_miniapp");
    expect(res.body.companyIds).toEqual([company.id]);
  });

  it("does not authenticate a revoked session", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { actorMiddleware } = await import("../middleware/auth.js");

    const company = await seedCompany();
    await seedBot(company.id);
    const binding = await seedBinding(company.id, "user-board-1");
    const minted = await telegramMiniappSessionService(db).mint({
      companyId: company.id,
      initData: initDataFor(TG_USER),
      now: NOW,
    });
    if (!minted.ok) throw new Error("expected mint");
    await telegramLinkService(db).revokeBinding({ companyId: company.id, id: binding.id });

    const app = express();
    app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    app.get("/whoami", (req, res) => res.json(req.actor));

    const res = await request(app).get("/whoami").set("authorization", `Bearer ${minted.token}`);

    expect(res.body.type).toBe("none");
  });
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run server/src/__tests__/telegram-miniapp-session.test.ts -t "board actor scoped"
```

Expected: FAIL — `res.body.type` is `"none"`, because nothing resolves the token yet.

- [ ] **Step 4: Add the middleware branch**

In `server/src/middleware/auth.ts`, add to the import block:

```ts
import { telegramMiniappSessionService } from "../services/telegram-miniapp-session.js";
```

Inside `actorMiddleware`, beside the existing `const boardAuth = boardAuthService(db);`, add:

```ts
  const miniappSessions = telegramMiniappSessionService(db);
```

Then insert this block immediately after the board-key branch's closing `}` (currently line 144, directly before `const tokenHash = hashToken(token);`):

```ts
    // A Mini App session is a board session for exactly one company. It resolves through the user's
    // real access rather than around it: the session narrows what that user can already reach, and
    // never widens it.
    const miniappSession = await miniappSessions.resolve(token);
    if (miniappSession) {
      const access = await boardAuth.resolveBoardAccess(miniappSession.userId);
      if (access.user && access.companyIds.includes(miniappSession.companyId)) {
        await miniappSessions.touch(miniappSession.id);
        req.actor = {
          type: "board",
          userId: miniappSession.userId,
          userName: access.user.name ?? null,
          userEmail: access.user.email ?? null,
          companyId: miniappSession.companyId,
          companyIds: [miniappSession.companyId],
          memberships: access.memberships.filter((m) => m.companyId === miniappSession.companyId),
          isInstanceAdmin: false,
          runId: runIdHeader || undefined,
          source: "telegram_miniapp",
        };
        next();
        return;
      }
    }
```

Note `isInstanceAdmin: false` — a phone session should never carry instance-admin powers even if the
underlying user has them.

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run server/src/__tests__/telegram-miniapp-session.test.ts
npx tsc --noEmit -p server/tsconfig.json
```

Expected: all pass; tsc silent.

- [ ] **Step 6: Commit**

```bash
git add server/src/types/express.d.ts server/src/middleware/auth.ts server/src/__tests__/telegram-miniapp-session.test.ts
git commit -m "feat(auth): resolve a Mini App bearer to a single-company board actor"
```

---

### Task 5: Session endpoint

**Files:**
- Modify: `server/src/routes/telegram.ts`
- Modify: `server/src/__tests__/telegram-routes.test.ts`

**Interfaces:**
- Consumes: `telegramMiniappSessionService` (Task 3).
- Produces: `POST /api/telegram/miniapp/session` with body `{ companyId: string; initData: string }`, answering `200 { token, expiresAt, userId, companyId, user }` or `401 { error }` / `404 { error }`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("inbound webhook", …)` block's parent describe in `server/src/__tests__/telegram-routes.test.ts` — i.e. as a new sibling `describe` before the file's final `});`:

```ts
  describe("mini app session", () => {
    function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
      const checkString = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
      const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
      const hash = createHmac("sha256", secret).update(checkString).digest("hex");
      return new URLSearchParams({ ...fields, hash }).toString();
    }

    function freshInitData(telegramUserId = BOUND_TG_USER): string {
      return signInitData({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: Number(telegramUserId), first_name: "Dana" }),
      });
    }

    it("mints a session for a bound Telegram user", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(null);

      const res = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: freshInitData() });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.userId).toBe("user-board-1");
      expect(res.body.companyId).toBe(company.id);
      expect(typeof res.body.token).toBe("string");
    });

    it("refuses an unbound Telegram user", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const app = await createApp(null);

      const res = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: freshInitData("99999") });

      expect(res.status).toBe(401);
    });

    it("refuses a tampered initData", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const params = new URLSearchParams(freshInitData());
      params.set("user", JSON.stringify({ id: 999, first_name: "Mallory" }));
      const app = await createApp(null);

      const res = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: params.toString() });

      expect(res.status).toBe(401);
    });

    it("404s for a company with no bot", async () => {
      const company = await seedCompany();
      const app = await createApp(null);

      const res = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: freshInitData() });

      expect(res.status).toBe(404);
    });

    it("never echoes the bot token", async () => {
      const company = await seedCompany();
      await seedConfig(company.id);
      const links = telegramLinkService(db);
      const { code } = await links.createLinkCode({ companyId: company.id, userId: "user-board-1" });
      await links.redeemLinkCode({ code, chatId: "555", telegramUserId: BOUND_TG_USER });
      const app = await createApp(null);

      const res = await request(app)
        .post("/api/telegram/miniapp/session")
        .send({ companyId: company.id, initData: freshInitData() });

      expect(JSON.stringify(res.body)).not.toContain(BOT_TOKEN);
    });
  });
```

Add `import { createHmac } from "node:crypto";` to the top of that test file.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run server/src/__tests__/telegram-routes.test.ts -t "mini app session"
```

Expected: FAIL with 404s from Express — the route does not exist.

- [ ] **Step 3: Add the route**

In `server/src/routes/telegram.ts`, add `telegramMiniappSessionService` to the existing import from `../services/index.js`. Inside `telegramRoutes`, beside `const links = …`, add:

```ts
  const miniappSessions = telegramMiniappSessionService(db);
```

Then add this route immediately before the `// ---- inbound webhook (untrusted) ----` comment:

```ts
  // ---- mini app session (untrusted; the signature is the whole gate) ---------

  router.post("/telegram/miniapp/session", async (req, res) => {
    const { companyId, initData } = (req.body ?? {}) as { companyId?: unknown; initData?: unknown };
    if (typeof companyId !== "string" || typeof initData !== "string") {
      res.status(400).json({ error: "companyId and initData are required" });
      return;
    }

    const result = await miniappSessions.mint({ companyId, initData });
    if (!result.ok) {
      if (result.reason === "no_bot") {
        res.status(404).json({ error: "No Telegram bot for this company" });
        return;
      }
      // Everything else is an authentication failure, and the reason is deliberately not echoed:
      // an unauthenticated caller learns nothing about which part of their payload was wrong.
      logger.warn({ companyId, reason: result.reason }, "telegram mini app session refused");
      res.status(401).json({ error: "Could not authenticate this Telegram session" });
      return;
    }

    res.json({
      token: result.token,
      expiresAt: result.expiresAt,
      userId: result.userId,
      companyId: result.companyId,
      user: result.user,
    });
  });
```

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run server/src/__tests__/telegram-routes.test.ts
npx tsc --noEmit -p server/tsconfig.json
```

Expected: all pass; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/telegram.ts server/src/__tests__/telegram-routes.test.ts
git commit -m "feat(telegram): POST /telegram/miniapp/session exchanges initData for a session"
```

---

### Task 6: Entry points — menu button and card button

**Files:**
- Modify: `server/src/services/telegram-transport.ts`
- Modify: `server/src/services/telegram-format.ts`
- Modify: `server/src/services/telegram-format.test.ts`
- Modify: `server/src/routes/telegram.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TelegramTransport.setChatMenuButton(input: { botToken: string; text: string; url: string }): Promise<void>`; `buildApprovalMessage` gains an optional `miniAppUrl?: string | null` that renders a `web_app` button.

- [ ] **Step 1: Write the failing formatter tests**

In `server/src/services/telegram-format.test.ts`, inside `describe("buildApprovalMessage", …)`, add:

```ts
  it("adds a Review in full web_app button when a mini app url is given", () => {
    const msg = buildApprovalMessage({
      title: "Critical risk approval",
      body: "Increase the cap",
      url: `/approvals/${APPROVAL_ID}`,
      approvalId: APPROVAL_ID,
      band: "critical",
      baseUrl: "https://paperclip.example",
      miniAppUrl: "https://paperclip.example/telegram/app?c=abc",
    });
    const flat = msg.replyMarkup!.inline_keyboard.flat();
    const webApp = flat.find((b) => b.web_app);
    expect(webApp?.web_app?.url).toBe("https://paperclip.example/telegram/app?c=abc");
    expect(webApp?.text).toMatch(/review in full/i);
  });

  it("keeps the Approve and Reject controls alongside the web_app button", () => {
    const msg = buildApprovalMessage({
      title: "Critical risk approval",
      body: "Increase the cap",
      url: `/approvals/${APPROVAL_ID}`,
      approvalId: APPROVAL_ID,
      miniAppUrl: "https://paperclip.example/telegram/app?c=abc",
    });
    const flat = msg.replyMarkup!.inline_keyboard.flat();
    expect(flat.filter((b) => b.callback_data)).toHaveLength(2);
  });

  it("omits the web_app button when no mini app url is given", () => {
    const msg = buildApprovalMessage({
      title: "Critical risk approval",
      body: "Increase the cap",
      url: `/approvals/${APPROVAL_ID}`,
      approvalId: APPROVAL_ID,
    });
    expect(JSON.stringify(msg.replyMarkup)).not.toContain("web_app");
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run server/src/services/telegram-format.test.ts -t "web_app"
```

Expected: FAIL — `miniAppUrl` is not a known property.

- [ ] **Step 3: Extend the formatter**

In `server/src/services/telegram-format.ts`, extend the button type:

```ts
/** InlineKeyboardButton: `text` plus exactly one action field — callback_data, url, or web_app. */
export type TelegramInlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
};
```

Add `miniAppUrl?: string | null;` to `buildApprovalMessage`'s input type, and replace the block that
appends the link control with:

```ts
  // A url button is a plain deep link, so the board is one tap away without spending the message body
  // on a raw URL. Only offered when the company told us its public base URL.
  if (input.miniAppUrl) {
    // Opens the board inside Telegram, already authenticated — the escape hatch for an approval two
    // buttons cannot settle.
    controls.push([{ text: "🔎 Review in full", web_app: { url: input.miniAppUrl } }]);
  } else if (link) {
    controls.push([{ text: "🔗 Open in Paperclip", url: link }]);
  }
```

- [ ] **Step 4: Add the transport method**

In `server/src/services/telegram-transport.ts`, add to the `TelegramTransport` type:

```ts
  /** Put a persistent "open the board" button on the bot's chat. Best-effort; never blocks a save. */
  setChatMenuButton(input: { botToken: string; text: string; url: string }): Promise<void>;
```

And in `createFetchTelegramTransport`'s returned object, add:

```ts
    async setChatMenuButton(input) {
      await callBotApi(input.botToken, "setChatMenuButton", {
        menu_button: { type: "web_app", text: input.text, web_app: { url: input.url } },
      });
    },
```

- [ ] **Step 5: Call it on config save**

In `server/src/routes/telegram.ts`, inside the `PUT /companies/:companyId/telegram/config` handler,
immediately before the closing `res.json({...})`, add:

```ts
    // Give the chat a persistent way into the board. Best-effort: the registration is saved either
    // way, and a transport failure here must not look like a failed save.
    if (publicBaseUrl) {
      await transport
        .setChatMenuButton({
          botToken,
          text: "Open Paperclip",
          url: `${publicBaseUrl.replace(/\/$/, "")}/telegram/app?c=${companyId}`,
        })
        .catch((err) => logger.warn({ err, companyId }, "failed to set telegram chat menu button"));
    }
```

- [ ] **Step 6: Update the test transports**

Every hand-rolled `TelegramTransport` in the test suite must gain the new method or TypeScript-free
runtime calls will throw. Add `async setChatMenuButton() {},` to the transport literals in:
`server/src/__tests__/telegram-routes.test.ts`, `server/src/__tests__/telegram-channel.test.ts`.

- [ ] **Step 7: Run the suites**

```bash
npx vitest run server/src/services/telegram-format.test.ts server/src/__tests__/telegram-routes.test.ts server/src/__tests__/telegram-channel.test.ts
npx tsc --noEmit -p server/tsconfig.json
```

Expected: all pass; tsc silent.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/telegram-transport.ts server/src/services/telegram-format.ts server/src/services/telegram-format.test.ts server/src/routes/telegram.ts server/src/__tests__/telegram-routes.test.ts server/src/__tests__/telegram-channel.test.ts
git commit -m "feat(telegram): menu button and Review in full web_app entry points"
```

---

### Task 7: Telegram detection and bottom nav

**Files:**
- Create: `ui/src/telegram/webapp.ts`
- Create: `ui/src/components/TelegramBottomNav.tsx`
- Create: `ui/src/components/TelegramBottomNav.test.tsx`
- Modify: `ui/src/context/SidebarContext.tsx`
- Modify: `ui/src/components/Layout.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isTelegramWebApp(): boolean`, `getTelegramWebApp(): TelegramWebApp | null` from `ui/src/telegram/webapp.ts`; `isTelegram: boolean` on the sidebar context; `<TelegramBottomNav />`.

- [ ] **Step 1: Write the webapp adapter**

Create `ui/src/telegram/webapp.ts`:

```ts
/**
 * FILE: ui/src/telegram/webapp.ts
 * ABOUT: webapp.ts (telegram module).
 *
 * SECTIONS:
 *   [TAG: module] - the window.Telegram.WebApp adapter.
 */
// ==========================================
// [META: module]
// INTENT: One place that knows what Telegram injects, so nothing else in the UI reaches into a global
//   that may not exist. Detection, theme and expand all read through here.
// PSEUDOCODE: 1. Type the slice of the WebApp API we use. 2. getTelegramWebApp reads the global.
//   3. isTelegramWebApp is a boolean over it. 4. applyTelegramTheme maps themeParams onto our CSS vars.
// JSON_FLOW: {"file": "ui/src/telegram/webapp.ts", "imports": "none", "exports": "getTelegramWebApp, isTelegramWebApp, applyTelegramTheme, TelegramWebApp"}
// ==========================================
// [START: module]

/** Only the slice of the Mini App API this build uses. */
export type TelegramWebApp = {
  initData: string;
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  expand?: () => void;
  ready?: () => void;
  onEvent?: (event: string, handler: () => void) => void;
};

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  // An empty initData means the page was opened outside Telegram (or by something imitating it with
  // nothing to prove), and there is nothing we could authenticate with.
  return candidate && typeof candidate.initData === "string" && candidate.initData.length > 0
    ? candidate
    : null;
}

export function isTelegramWebApp(): boolean {
  return getTelegramWebApp() !== null;
}

/**
 * Telegram's themeParams are snake_case colour strings. Map the ones the board actually uses onto its
 * existing custom properties, and set the light/dark attribute from colorScheme, so the webview reads
 * as native rather than as a website in a box.
 */
export function applyTelegramTheme(app: TelegramWebApp, root: HTMLElement): void {
  const params = app.themeParams ?? {};
  const assign = (cssVar: string, key: string) => {
    const value = params[key];
    if (value) root.style.setProperty(cssVar, value);
  };
  assign("--background", "bg_color");
  assign("--foreground", "text_color");
  assign("--muted-foreground", "hint_color");
  assign("--primary", "button_color");
  assign("--primary-foreground", "button_text_color");
  if (app.colorScheme) root.setAttribute("data-theme", app.colorScheme);
}
// [END: module]
```

- [ ] **Step 2: Write the failing nav test**

Create `ui/src/components/TelegramBottomNav.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramBottomNav, TELEGRAM_NAV_ITEMS } from "./TelegramBottomNav";

const uiContributions = vi.fn();
vi.mock("@/api/plugins", () => ({ pluginsApi: { uiContributions: () => uiContributions() } }));

function renderNav() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TelegramBottomNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TelegramBottomNav", () => {
  beforeEach(() => {
    uiContributions.mockReset().mockResolvedValue([]);
  });

  it("renders the five core surfaces", async () => {
    renderNav();
    for (const label of ["Dashboard", "Tasks", "Triage", "Digest", "Artifacts"]) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
  });

  it("points each core item at its route", () => {
    expect(TELEGRAM_NAV_ITEMS.map((i) => i.to)).toEqual([
      "/dashboard",
      "/issues",
      "/approvals/triage",
      "/digest",
      "/artifacts",
    ]);
  });

  // There is no /wikis route — the entry is resolved from the installed plugin, or omitted.
  it("adds Wikis pointing at the installed wiki plugin", async () => {
    uiContributions.mockResolvedValue([{ pluginId: "llm-wiki", routePath: "wiki" }]);
    renderNav();
    const link = await screen.findByText("Wikis");
    expect(link.closest("a")?.getAttribute("href")).toBe("/plugins/llm-wiki");
  });

  it("omits Wikis entirely when no wiki plugin is installed", async () => {
    renderNav();
    await waitFor(() => expect(screen.getByText("Dashboard")).toBeTruthy());
    expect(screen.queryByText("Wikis")).toBeNull();
  });

  it("is labelled for assistive technology", () => {
    renderNav();
    expect(screen.getByLabelText("Telegram navigation")).toBeTruthy();
  });
});
```

Before writing this, confirm the real shape of a UI contribution and the right query key:

```bash
grep -n "uiContributions\|PluginUiContribution" ui/src/api/plugins.ts | head
grep -n "plugins" ui/src/lib/queryKeys.ts | head
```

Adjust the mock and `queryKeys.plugins.*` call to match what you find — the names above are the
expected shape, not a verified one.

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run ui/src/components/TelegramBottomNav.test.tsx
```

Expected: FAIL — cannot resolve `./TelegramBottomNav`.

- [ ] **Step 4: Write the nav component**

Create `ui/src/components/TelegramBottomNav.tsx`:

```tsx
/**
 * FILE: ui/src/components/TelegramBottomNav.tsx
 * ABOUT: TelegramBottomNav.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - the six-surface bottom nav shown inside a Telegram Mini App.
 */
// ==========================================
// [META: module]
// INTENT: Give the Mini App the six surfaces the operator asked Telegram to expose. Deliberately a
//   separate component from MobileBottomNav: that one answers "what does a phone user reach for",
//   this one answers "what did the operator ask Telegram to expose", and merging them makes both worse.
// PSEUDOCODE: 1. Declare the six items. 2. Render a fixed bottom bar of NavLinks with active styling.
// JSON_FLOW: {"file": "ui/src/components/TelegramBottomNav.tsx", "imports": "react-router-dom, lucide-react, ../lib/utils", "exports": "TelegramBottomNav, TELEGRAM_NAV_ITEMS"}
// ==========================================
// [START: module]
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, CircleDot, FileText, House, LayoutGrid, ShieldCheck } from "lucide-react";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "../lib/utils";

/**
 * Five fixed routes. Wikis is deliberately absent: it is a *plugin* surface, not a core route, and
 * its path depends on which plugin is installed — see WIKI_NAV below.
 */
export const TELEGRAM_NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: House },
  { to: "/issues", label: "Tasks", icon: CircleDot },
  { to: "/approvals/triage", label: "Triage", icon: ShieldCheck },
  { to: "/digest", label: "Digest", icon: FileText },
  { to: "/artifacts", label: "Artifacts", icon: LayoutGrid },
] as const;

/**
 * There is no `/wikis` route. Plugin UIs mount at `/plugins/:pluginId` (App.tsx:125) and plugins may
 * also declare their own `:pluginRoutePath/*` (App.tsx:198), so the wiki entry has to be resolved from
 * the installed-plugin list at runtime rather than hardcoded. When no wiki plugin is installed the
 * slot renders nothing and the nav is five items wide.
 */
export const WIKI_PLUGIN_MATCH = /wiki/i;

export function TelegramBottomNav() {
  // The wiki plugin's route is discovered, never assumed. `pluginsApi` is the same source the sidebar's
  // launcher outlet reads (ui/src/plugins/launchers.tsx) — read that file before changing this, since
  // the contribution shape is owned there.
  const { data: contributions } = useQuery({
    queryKey: queryKeys.plugins.uiContributions(),
    queryFn: () => pluginsApi.uiContributions(),
  });
  const wiki = contributions?.find(
    (c) => WIKI_PLUGIN_MATCH.test(c.pluginId ?? "") || WIKI_PLUGIN_MATCH.test(c.routePath ?? ""),
  );
  const items = [
    ...TELEGRAM_NAV_ITEMS,
    ...(wiki
      ? [{ to: `/plugins/${wiki.pluginId}`, label: "Wikis", icon: BookOpen } as const]
      : []),
  ];

  return (
    <nav
      aria-label="Telegram navigation"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      className="telegram-bottom-nav fixed inset-x-0 bottom-0 z-40 grid border-t border-border bg-background"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium",
                isActive ? "text-primary" : "text-muted-foreground",
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
// [END: module]
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run ui/src/components/TelegramBottomNav.test.tsx
```

Expected: 3 passed.

- [ ] **Step 6: Add `isTelegram` to the sidebar context**

In `ui/src/context/SidebarContext.tsx`, add to the context type (beside `isMobile: boolean;`):

```ts
  isTelegram: boolean;
```

Beside the `isMobile` state, add:

```ts
  // Constant for the life of the page: Telegram injects its WebApp object before our bundle runs, and
  // a page cannot move into or out of a Mini App without reloading.
  const [isTelegram] = useState(() => isTelegramWebApp());
```

Import it: `import { isTelegramWebApp } from "../telegram/webapp";`. Add `isTelegram` to the context
provider's value object.

- [ ] **Step 7: Branch in Layout**

In `ui/src/components/Layout.tsx`, add `isTelegram` to the existing `useSidebar()` destructure (beside
`isMobile`), import the component, and replace line 597:

```tsx
      {isTelegram ? <TelegramBottomNav /> : isMobile && <MobileBottomNav visible={mobileNavVisible} />}
```

- [ ] **Step 8: Route `/telegram/app` somewhere**

The server's SPA fallback (`app.ts:427`) serves `index.html` for any non-asset path, so
`/telegram/app?c=X` reaches the bundle — but **React Router has no route for it** and would render the
404 page. Add a redirect inside the app's route table in `ui/src/App.tsx`, beside the other top-level
routes:

```tsx
      {/* Telegram opens the Mini App at a stable, company-carrying URL. The board itself has no such
          page — land on the dashboard, preserving the query so the session bootstrap can read ?c=. */}
      <Route
        path="telegram/app"
        element={<Navigate to={{ pathname: "/dashboard", search: window.location.search }} replace />}
      />
```

Import `Navigate` from the router module `App.tsx` already uses (check whether the file imports from
`react-router-dom` or the local `@/lib/router` shim, and match it).

- [ ] **Step 9: Run the UI suite**

```bash
npx vitest run ui/src/components/TelegramBottomNav.test.tsx ui/src/components/Layout.test.tsx
npx tsc --noEmit -p ui/tsconfig.json
```

Expected: all pass; tsc silent. `Layout.test.tsx` already mocks `MobileBottomNav`; if it fails on the
new import, add a matching `vi.mock("./TelegramBottomNav", () => ({ TelegramBottomNav: () => null }));`.

- [ ] **Step 10: Commit**

```bash
git add ui/src/telegram/webapp.ts ui/src/components/TelegramBottomNav.tsx ui/src/components/TelegramBottomNav.test.tsx ui/src/context/SidebarContext.tsx ui/src/components/Layout.tsx ui/src/App.tsx
git commit -m "feat(ui): Telegram Mini App detection, bottom nav and entry route"
```

---

### Task 8: Session bootstrap and theme

**Files:**
- Create: `ui/src/telegram/useTelegramSession.ts`
- Modify: `ui/src/api/client.ts` (or the module exporting the shared fetch wrapper — confirm the path with `grep -rn "authorization" ui/src/api/ | head`)
- Modify: `ui/src/main.tsx`

**Interfaces:**
- Consumes: `getTelegramWebApp`, `applyTelegramTheme` (Task 7); `POST /api/telegram/miniapp/session` (Task 5).
- Produces: `useTelegramSession(): { status: "idle" | "authenticating" | "ready" | "failed"; error: string | null }`, and a module-level `getTelegramBearer(): string | null` the API client reads.

- [ ] **Step 1: Write the bootstrap module**

Create `ui/src/telegram/useTelegramSession.ts`:

```ts
/**
 * FILE: ui/src/telegram/useTelegramSession.ts
 * ABOUT: useTelegramSession.ts (telegram module).
 *
 * SECTIONS:
 *   [TAG: module] - exchange Telegram's initData for a board bearer token.
 */
// ==========================================
// [META: module]
// INTENT: Get the Mini App authenticated before the board renders, and keep it that way. The token is
//   held in memory only -- persisting it would outlive the webview for no benefit, since initData can
//   always mint another.
// PSEUDOCODE: 1. Read companyId from ?c= and initData from the WebApp object. 2. POST them for a
//   token. 3. Stash it where the API client can read it. 4. Expose status for the shell to render.
// JSON_FLOW: {"file": "ui/src/telegram/useTelegramSession.ts", "imports": "react, ./webapp", "exports": "useTelegramSession, getTelegramBearer, clearTelegramBearer"}
// ==========================================
// [START: module]
import { useEffect, useState } from "react";
import { getTelegramWebApp } from "./webapp";

let bearer: string | null = null;

/** Read by the API client on every request. Null outside Telegram. */
export function getTelegramBearer(): string | null {
  return bearer;
}

/** Called on a 401 so the next render re-mints rather than looping on a dead token. */
export function clearTelegramBearer(): void {
  bearer = null;
}

export type TelegramSessionStatus = "idle" | "authenticating" | "ready" | "failed";

export function useTelegramSession(): { status: TelegramSessionStatus; error: string | null } {
  const [status, setStatus] = useState<TelegramSessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const app = getTelegramWebApp();
    if (!app) return;

    const companyId = new URLSearchParams(window.location.search).get("c");
    if (!companyId) {
      setStatus("failed");
      setError("This link is missing its company. Open Paperclip from the bot's menu button.");
      return;
    }

    let cancelled = false;
    setStatus("authenticating");
    void (async () => {
      try {
        const res = await fetch("/api/telegram/miniapp/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ companyId, initData: app.initData }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("failed");
          setError(
            res.status === 401
              ? "This Telegram account is not linked to Paperclip. Link it from the board, then reopen."
              : "Could not start a Paperclip session.",
          );
          return;
        }
        const body = (await res.json()) as { token: string };
        bearer = body.token;
        setStatus("ready");
      } catch {
        if (cancelled) return;
        setStatus("failed");
        setError("Could not reach Paperclip.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { status, error };
}
// [END: module]
```

- [ ] **Step 2: Send the bearer on API requests**

Find the shared request helper:

```bash
grep -rn "authorization\|Authorization" ui/src/api/*.ts | head
```

In whichever module builds request headers, add the import and set the header when present:

```ts
import { getTelegramBearer } from "../telegram/useTelegramSession";
```

```ts
  const telegramBearer = getTelegramBearer();
  if (telegramBearer) headers["authorization"] = `Bearer ${telegramBearer}`;
```

- [ ] **Step 3: Gate the app on the session**

In `ui/src/main.tsx`, wrap the router with a small gate. Add:

```tsx
import { getTelegramWebApp, applyTelegramTheme } from "./telegram/webapp";
import { useTelegramSession } from "./telegram/useTelegramSession";

function TelegramGate({ children }: { children: React.ReactNode }) {
  const { status, error } = useTelegramSession();

  useEffect(() => {
    const app = getTelegramWebApp();
    if (!app) return;
    app.ready?.();
    app.expand?.();
    applyTelegramTheme(app, document.documentElement);
    app.onEvent?.("themeChanged", () => applyTelegramTheme(app, document.documentElement));
  }, []);

  // Outside Telegram this is a pass-through, so the ordinary board is untouched.
  if (!getTelegramWebApp()) return <>{children}</>;
  if (status === "failed") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }
  if (status !== "ready") {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Connecting…</div>;
  }
  return <>{children}</>;
}
```

Wrap the existing root element's children in `<TelegramGate>…</TelegramGate>`, inside any providers the
gate needs but outside the router.

- [ ] **Step 4: Verify the ordinary board is unaffected**

```bash
npx vitest run ui/src
npx tsc --noEmit -p ui/tsconfig.json
```

Expected: the full UI suite passes unchanged — outside Telegram, `getTelegramWebApp()` is null and the
gate is a pass-through. Any failure here means the gate is not transparent and must be fixed before
committing.

- [ ] **Step 5: Commit**

```bash
git add ui/src/telegram/useTelegramSession.ts ui/src/main.tsx ui/src/api
git commit -m "feat(ui): exchange Telegram initData for a session and theme the Mini App"
```

---

### Task 9: Triage rendering (findings X2 and X3)

**Files:**
- Modify: `ui/src/pages/ApprovalTriage.tsx`
- Modify: `ui/src/pages/ApprovalTriage.test.tsx`

**Interfaces:**
- Consumes: the existing `approvalsApi.triage` response — `{ items: Array<{ id, type, payload, createdAt, requestedByAgentId, risk: { score, band, reasons } }>, groups: Array<{ key, type, agentId, ids }> }`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

This file drives React directly with `createRoot` + `act` rather than Testing Library, and mocks
`../api/approvals` through a hoisted `apiMocks.triage`. Follow that. Add a fixture builder beside the
existing `lowRiskItem`, then the four tests.

```tsx
/** An item carrying everything listTriage actually returns — the point of finding X2. */
function richItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ...lowRiskItem(id),
    type: "budget_increase",
    requestedByAgentId: "Atlas",
    payload: { title: "Increase the monthly cap to $4,000" },
    risk: { score: 88, band: "critical", reasons: ["budget over cap", "no prior approval"] },
    ...overrides,
  };
}
```

```tsx
  it("shows the approval's title, not just its type", async () => {
    apiMocks.triage.mockResolvedValue({ items: [richItem("a1")], groups: [] });
    const { container } = await renderTriage();
    expect(container.textContent).toContain("Increase the monthly cap to $4,000");
  });

  it("shows the requesting agent on the row", async () => {
    apiMocks.triage.mockResolvedValue({ items: [richItem("a1")], groups: [] });
    const { container } = await renderTriage();
    expect(container.textContent).toContain("Atlas");
  });

  // The list is sorted by risk score, so the reasons behind that score have to be visible.
  it("shows the risk reasons behind the score it sorts by", async () => {
    apiMocks.triage.mockResolvedValue({ items: [richItem("a1")], groups: [] });
    const { container } = await renderTriage();
    expect(container.textContent).toContain("budget over cap");
  });

  it("distinguishes two groups of the same type from different agents", async () => {
    apiMocks.triage.mockResolvedValue({
      items: [richItem("a1"), richItem("a2", { requestedByAgentId: "Borealis" })],
      groups: [
        { key: "budget_increase::Atlas", type: "budget_increase", agentId: "Atlas", ids: ["a1"] },
        { key: "budget_increase::Borealis", type: "budget_increase", agentId: "Borealis", ids: ["a2"] },
      ],
    });
    const { container } = await renderTriage();
    const chips = [...container.querySelectorAll(".approval-triage__groups button")].map(
      (b) => b.textContent ?? "",
    );
    expect(chips).toHaveLength(2);
    expect(new Set(chips).size).toBe(2);
  });
```

Reuse the file's existing render helper. If it is inlined in each test rather than extracted, extract
it first as `renderTriage()` returning `{ container }` — that refactor is part of this step.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run ui/src/pages/ApprovalTriage.test.tsx
```

Expected: FAIL — the row renders only the band pill and `it.type`.

- [ ] **Step 3: Render what the server already sends**

In `ui/src/pages/ApprovalTriage.tsx`, replace the `<li>` body inside `items.map(...)` with:

```tsx
            <li
              key={it.id}
              data-approval-triage-item={it.id}
              className="flex items-start gap-3 px-3 py-2"
            >
              <input
                type="checkbox"
                checked={selected.has(it.id)}
                onChange={() => toggle(it.id)}
                aria-label={`select ${it.id}`}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
                      RISK_BAND_CLASSES[it.risk?.band] ?? RISK_BAND_CLASSES.low,
                    )}
                  >
                    {it.risk?.band ?? "low"}
                  </span>
                  <span className="truncate text-sm font-medium">{approvalTitle(it)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[it.type, it.requestedByAgentId ? `by ${it.requestedByAgentId}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {it.risk?.reasons?.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {it.risk.reasons.slice(0, 3).map((reason: string) => (
                      <li
                        key={reason}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
```

Add this helper above the component — the payload shape varies by approval type, so fall back rather
than render nothing:

```tsx
/** Approvals carry a type-specific payload, so take the first human-looking field we recognise. */
function approvalTitle(item: any): string {
  const payload = item?.payload ?? {};
  return payload.title ?? payload.summary ?? payload.name ?? item.type ?? "Approval";
}
```

And fix the group chip label (X3):

```tsx
                  {g.type}
                  {g.agentId ? ` · ${g.agentId}` : ""} · {g.ids.length} items
```

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run ui/src/pages/ApprovalTriage.test.tsx
npx tsc --noEmit -p ui/tsconfig.json
```

Expected: all pass; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/ApprovalTriage.tsx ui/src/pages/ApprovalTriage.test.tsx
git commit -m "fix(ui): render the triage data the server already sends (X2, X3)"
```

---

### Task 10: Documentation

**Files:**
- Modify: `doc/TELEGRAM-CHANNEL.md`

- [ ] **Step 1: Add the Mini App section**

Insert after the existing "Security model" section:

```markdown
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

**The bot token now forges sessions.** It is the HMAC key for `initData`, so the plaintext-at-rest note
above is stronger than it was: database access no longer merely impersonates the bot and reads approval
traffic, it mints board sessions. Rotate with **Replace bot**, which should be followed by revoking
live bindings if a leak is suspected.
```

- [ ] **Step 2: Update the verification table**

Add the rows for the claims verified in Task 2 (the `initData` key derivation, `auth_date` semantics,
`web_app` button chat-type restrictions, `setChatMenuButton` semantics, and the Mini App HTTPS/port
requirement), each marked ✅ or ⚠️ with what was actually found.

- [ ] **Step 3: Update the known gaps**

Replace the "No command grammar beyond `/start <code>`" bullet with:

```markdown
- No command grammar beyond `/start <code>` — **superseded**, not fixed: the Mini App answers the same
  questions with more room. See `docs/superpowers/specs/2026-08-06-telegram-command-grammar-design.md`.
- Proposals — the pick-one-of-N gate for choosing between agent-produced candidates — does not exist in
  core yet, so the Mini App ships with six surfaces rather than seven.
```

- [ ] **Step 4: Full verification sweep**

```bash
npx tsc --noEmit -p server/tsconfig.json
npx tsc --noEmit -p packages/db/tsconfig.json
npx tsc --noEmit -p ui/tsconfig.json
npx vitest run server/src/__tests__/telegram server/src/services/telegram-initdata.test.ts server/src/services/telegram-format.test.ts server/src/services/telegram-transport.test.ts
npx vitest run server/src/__tests__/approval
npx vitest run ui/src
npx vitest run packages/db
```

Expected: every suite green, all three typechecks silent.

- [ ] **Step 5: Commit**

```bash
git add doc/TELEGRAM-CHANNEL.md
git commit -m "docs(telegram): document the Mini App, its session model and its enlarged grant"
```

---

## Manual verification

None of the automated tests perform a live round trip against Telegram. Before calling this done:

1. Register a bot via BotFather, put a tunnel on 443 in front of the server, and set the webhook.
2. Save the config with a `publicBaseUrl`; confirm the bot's chat gains an **Open Paperclip** menu button.
3. Send `/start <code>` and confirm the binding records a `telegram_user_id`.
4. Tap the menu button; confirm the board opens inside Telegram, themed, with the six-item nav and no
   login prompt.
5. Confirm each of the six surfaces loads, including a wiki page from the plugin UI.
6. Unlink the chat from the board and confirm the open Mini App stops working on its next request.
