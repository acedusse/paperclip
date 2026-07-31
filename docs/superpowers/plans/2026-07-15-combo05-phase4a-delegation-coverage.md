# Combo-05 Phase 4a — Human Delegation & SLA Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded human delegation grants (scope/band/limit/time-box) enforced by the approval authority resolver, plus notify-only SLA coverage routing that escalates aging pending approvals to a designated backup.

**Architecture:** Three additive DB tables (`delegation_grants`, `company_coverage_config`, `approval_coverage_escalations`); a pure resolver function `canDecideUnderDelegation`; a `delegated_human` decision path on the existing approval routes keyed by `actingUnderGrantId`; `coverage_escalation` attribution when the backup decides an escalated item; and an interval `coverage-sweep` service that reuses the Phase-2b narrator and Phase-3a delivery pipeline. Out-of-office is a delegation-grant preset, not a separate subsystem.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Express, Zod, Vitest + embedded-postgres, React (jsdom component tests). `web-push` is mocked in all server tests.

## Global Constraints

- Migrations are **hand-written raw SQL** + a `meta/_journal.json` entry — never `drizzle-kit generate` (snapshot baseline is stale at 0098). New migration is `0120_combo05_delegation_coverage`.
- Every new schema table gets a Drizzle file under `packages/db/src/schema/`, dual-exported from `packages/db/src/schema/index.ts` (the `db` package barrel re-exports `./schema/index.js` via `export *`).
- Shared Zod validators/types live in `packages/shared/src/validators/` and are re-exported from `packages/shared/src/validators/index.ts` **and** `packages/shared/src/index.ts` (dual-barrel).
- `web-push` is a server dep and is **mocked in every server test** — never send real push.
- Server route tests: `server/src/__tests__/*.test.ts` on embedded-postgres (`startEmbeddedPostgresTestDatabase` from `./helpers/embedded-postgres.js`). Pure-unit tests sit next to the service as `server/src/services/*.test.ts`, `environment: "node"`.
- Risk helpers come from `server/src/services/approval-risk.js`: `type RiskBand = "low"|"medium"|"high"|"critical"`, `RISK_BAND_ORDER`, `bandRank(b)`, `impliedSpendFromApproval(payload)`. Risk snapshot via `riskSvc.getSnapshot(approvalId)` → `{ score, band }`.
- Decision methods live in `server/src/services/approval-authority.ts`: `DecisionMethod` already includes `delegated_human` and `coverage_escalation`; only `explicit_human` + `auto_policy` are currently in `REGISTERED`.
- Teeth are latent by design (see spec Constraints): every authenticated human is a `board` actor, so grants attribute + constrain rather than expand power. Build the seam correctly; do not add per-person authority here.
- One commit per task. Run `pnpm --filter @paperclipai/db check:migrations` after the migration task and again at the end.

**Spec:** `docs/superpowers/specs/2026-07-15-combo05-phase4a-delegation-coverage-design.md`

---

### Task 1: Data model — migration `0120` + three schema files

**Files:**
- Create: `packages/db/src/schema/delegation_grants.ts`
- Create: `packages/db/src/schema/company_coverage_config.ts`
- Create: `packages/db/src/schema/approval_coverage_escalations.ts`
- Modify: `packages/db/src/schema/index.ts` (add three barrel exports)
- Create: `packages/db/src/migrations/0120_combo05_delegation_coverage.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json` (append idx 120)

**Interfaces:**
- Produces: `delegationGrants` / `DelegationGrantRow`, `companyCoverageConfig` / `CompanyCoverageConfigRow`, `approvalCoverageEscalations` / `ApprovalCoverageEscalationRow`.

- [ ] **Step 1: Write `delegation_grants.ts`**

```ts
import { pgTable, text, integer, jsonb, timestamp, index, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const delegationGrants = pgTable(
  "delegation_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    grantorUserId: text("grantor_user_id").notNull(),
    delegateUserId: text("delegate_user_id").notNull(),
    approvalTypes: jsonb("approval_types").notNull().default([]).$type<string[]>(),
    maxBand: text("max_band").notNull(),
    maxSpendCents: integer("max_spend_cents"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyDelegateIdx: index("delegation_grants_company_delegate_idx").on(table.companyId, table.delegateUserId),
  }),
);
export type DelegationGrantRow = typeof delegationGrants.$inferSelect;
```

- [ ] **Step 2: Write `company_coverage_config.ts`**

```ts
import { pgTable, text, integer, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyCoverageConfig = pgTable("company_coverage_config", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  backupUserId: text("backup_user_id"),
  slaCriticalMinutes: integer("sla_critical_minutes").notNull().default(60),
  slaHighMinutes: integer("sla_high_minutes").notNull().default(240),
  slaMediumMinutes: integer("sla_medium_minutes").notNull().default(1440),
  slaLowMinutes: integer("sla_low_minutes").notNull().default(4320),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type CompanyCoverageConfigRow = typeof companyCoverageConfig.$inferSelect;
```

- [ ] **Step 3: Write `approval_coverage_escalations.ts`**

```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { approvals } from "./approvals.js";

export const approvalCoverageEscalations = pgTable("approval_coverage_escalations", {
  approvalId: uuid("approval_id").primaryKey().references(() => approvals.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  backupUserId: text("backup_user_id").notNull(),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ApprovalCoverageEscalationRow = typeof approvalCoverageEscalations.$inferSelect;
```

- [ ] **Step 4: Add barrel exports to `packages/db/src/schema/index.ts`**

Add near the other combo-05 exports (after line 109):

```ts
export { delegationGrants, type DelegationGrantRow } from "./delegation_grants.js";
export { companyCoverageConfig, type CompanyCoverageConfigRow } from "./company_coverage_config.js";
export { approvalCoverageEscalations, type ApprovalCoverageEscalationRow } from "./approval_coverage_escalations.js";
```

- [ ] **Step 5: Write `0120_combo05_delegation_coverage.sql`**

```sql
CREATE TABLE IF NOT EXISTS "delegation_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "grantor_user_id" text NOT NULL,
  "delegate_user_id" text NOT NULL,
  "approval_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "max_band" text NOT NULL,
  "max_spend_cents" integer,
  "valid_from" timestamp with time zone DEFAULT now() NOT NULL,
  "valid_until" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "source" text DEFAULT 'manual' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delegation_grants_company_delegate_idx" ON "delegation_grants" ("company_id","delegate_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_coverage_config" (
  "company_id" uuid PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "backup_user_id" text,
  "sla_critical_minutes" integer DEFAULT 60 NOT NULL,
  "sla_high_minutes" integer DEFAULT 240 NOT NULL,
  "sla_medium_minutes" integer DEFAULT 1440 NOT NULL,
  "sla_low_minutes" integer DEFAULT 4320 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_coverage_escalations" (
  "approval_id" uuid PRIMARY KEY NOT NULL,
  "company_id" uuid NOT NULL,
  "backup_user_id" text NOT NULL,
  "escalated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delegation_grants" ADD CONSTRAINT "delegation_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_coverage_config" ADD CONSTRAINT "company_coverage_config_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_coverage_escalations" ADD CONSTRAINT "approval_coverage_escalations_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_coverage_escalations" ADD CONSTRAINT "approval_coverage_escalations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
```

- [ ] **Step 6: Append journal entry to `meta/_journal.json`**

Add as the last element of the `entries` array (comma after the `0119` object):

```json
    {
      "idx": 120,
      "version": "7",
      "when": 1784236800000,
      "tag": "0120_combo05_delegation_coverage",
      "breakpoints": true
    }
```

- [ ] **Step 7: Verify migrations + typecheck**

Run: `pnpm --filter @paperclipai/db check:migrations`
Expected: PASS (journal and SQL files consistent through 0120).

Run: `pnpm --filter @paperclipai/db typecheck` (or the repo's `pnpm -w typecheck`)
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/delegation_grants.ts packages/db/src/schema/company_coverage_config.ts packages/db/src/schema/approval_coverage_escalations.ts packages/db/src/schema/index.ts packages/db/src/migrations/0120_combo05_delegation_coverage.sql packages/db/src/migrations/meta/_journal.json
git commit -m "feat(combo-05): 4a migration 0120 — delegation grants + coverage config + escalations"
```

---

### Task 2: Resolver — register methods + `canDecideUnderDelegation`

**Files:**
- Modify: `server/src/services/approval-authority.ts`
- Test: `server/src/services/approval-authority.test.ts`

**Interfaces:**
- Consumes: `RiskBand`, `RISK_BAND_ORDER` from `./approval-risk.js` (already imported).
- Produces: `canDecideUnderDelegation(input) → { allow: boolean; deny?: string }` with the input shape below; `delegated_human` + `coverage_escalation` now in `REGISTERED`.

- [ ] **Step 1: Write the failing tests** (append to `approval-authority.test.ts`)

```ts
import { canDecide, canDecideUnderDelegation } from "./approval-authority.js";

const baseGrant = {
  approvalTypes: [] as string[],
  maxBand: "medium" as const,
  maxSpendCents: 50_000 as number | null,
  validFrom: new Date("2026-01-01T00:00:00Z"),
  validUntil: new Date("2026-12-31T00:00:00Z"),
  revokedAt: null as Date | null,
  delegateUserId: "bob",
};
const now = new Date("2026-07-15T00:00:00Z");
const baseInput = { approvalType: "budget", band: "low" as const, impliedSpendCents: 100, grant: baseGrant, actorUserId: "bob", now };

describe("delegated_human / coverage_escalation registration", () => {
  it("registers delegated_human", () => {
    expect(canDecide({ band: "low", method: "delegated_human" }).allow).toBe(true);
  });
  it("registers coverage_escalation", () => {
    expect(canDecide({ band: "low", method: "coverage_escalation" }).allow).toBe(true);
  });
});

describe("canDecideUnderDelegation", () => {
  it("allows a delegate acting within scope/band/limit/window", () => {
    expect(canDecideUnderDelegation(baseInput)).toEqual({ allow: true });
  });
  it("denies when actor is not the delegate", () => {
    expect(canDecideUnderDelegation({ ...baseInput, actorUserId: "carol" }).allow).toBe(false);
  });
  it("denies a revoked grant", () => {
    expect(canDecideUnderDelegation({ ...baseInput, grant: { ...baseGrant, revokedAt: now } }).allow).toBe(false);
  });
  it("denies before the window opens", () => {
    expect(canDecideUnderDelegation({ ...baseInput, now: new Date("2025-12-31T00:00:00Z") }).allow).toBe(false);
  });
  it("denies after the window closes", () => {
    expect(canDecideUnderDelegation({ ...baseInput, now: new Date("2027-01-01T00:00:00Z") }).allow).toBe(false);
  });
  it("denies an approval type outside a non-empty scope", () => {
    const grant = { ...baseGrant, approvalTypes: ["expense"] };
    expect(canDecideUnderDelegation({ ...baseInput, grant }).allow).toBe(false);
  });
  it("allows any type when scope is empty", () => {
    expect(canDecideUnderDelegation({ ...baseInput, approvalType: "anything" }).allow).toBe(true);
  });
  it("denies a band above the ceiling", () => {
    expect(canDecideUnderDelegation({ ...baseInput, band: "high" }).allow).toBe(false);
  });
  it("allows a band at the ceiling", () => {
    expect(canDecideUnderDelegation({ ...baseInput, band: "medium" }).allow).toBe(true);
  });
  it("denies spend over the limit", () => {
    expect(canDecideUnderDelegation({ ...baseInput, impliedSpendCents: 50_001 }).allow).toBe(false);
  });
  it("ignores spend when maxSpendCents is null", () => {
    const grant = { ...baseGrant, maxSpendCents: null };
    expect(canDecideUnderDelegation({ ...baseInput, impliedSpendCents: 999_999, grant }).allow).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @paperclipai/server test approval-authority`
Expected: FAIL — `canDecideUnderDelegation is not a function` / method-not-registered assertions fail.

- [ ] **Step 3: Implement in `approval-authority.ts`**

Change the `REGISTERED` set and add the function:

```ts
const REGISTERED: ReadonlySet<DecisionMethod> = new Set([
  "explicit_human",
  "delegated_human",
  "coverage_escalation",
  "auto_policy",
]); // phase 2a + 4a
```

Append:

```ts
export function canDecideUnderDelegation(input: {
  approvalType: string;
  band: RiskBand;
  impliedSpendCents: number;
  grant: {
    approvalTypes: string[];
    maxBand: RiskBand;
    maxSpendCents: number | null;
    validFrom: Date;
    validUntil: Date;
    revokedAt: Date | null;
    delegateUserId: string;
  };
  actorUserId: string;
  now: Date;
}): { allow: boolean; deny?: string } {
  const g = input.grant;
  if (input.actorUserId !== g.delegateUserId) return { allow: false, deny: "actor is not this grant's delegate" };
  if (g.revokedAt !== null) return { allow: false, deny: "delegation grant is revoked" };
  if (input.now < g.validFrom) return { allow: false, deny: "delegation grant is not yet active" };
  if (input.now > g.validUntil) return { allow: false, deny: "delegation grant has expired" };
  if (g.approvalTypes.length > 0 && !g.approvalTypes.includes(input.approvalType)) {
    return { allow: false, deny: `approval type ${input.approvalType} is outside the delegation scope` };
  }
  if (bandRank(input.band) > bandRank(g.maxBand)) {
    return { allow: false, deny: `delegation may not decide items above band ${g.maxBand}` };
  }
  if (g.maxSpendCents !== null && input.impliedSpendCents > g.maxSpendCents) {
    return { allow: false, deny: `implied spend ${input.impliedSpendCents} exceeds delegation limit ${g.maxSpendCents}` };
  }
  return { allow: true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @paperclipai/server test approval-authority`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/approval-authority.ts server/src/services/approval-authority.test.ts
git commit -m "feat(combo-05): 4a register delegated_human/coverage_escalation + canDecideUnderDelegation"
```

---

### Task 3: Shared validators + `actingUnderGrantId`

**Files:**
- Create: `packages/shared/src/validators/delegation.ts`
- Modify: `packages/shared/src/validators/approval.ts` (add `actingUnderGrantId`)
- Modify: `packages/shared/src/validators/index.ts` (re-export new schemas)
- Modify: `packages/shared/src/index.ts` (re-export new schemas + types)
- Test: `packages/shared/src/validators/delegation.test.ts`

**Interfaces:**
- Produces: `createDelegationGrantSchema`, `coverageConfigSchema`, `outOfOfficeSchema`, and types `CreateDelegationGrant`, `CoverageConfigUpdate`, `OutOfOfficeUpdate`. Adds optional `actingUnderGrantId: string (uuid)` to `resolveApprovalSchema` and `requestApprovalRevisionSchema`.

- [ ] **Step 1: Write the failing tests** (`delegation.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { createDelegationGrantSchema, coverageConfigSchema, outOfOfficeSchema } from "./delegation.js";
import { resolveApprovalSchema } from "./approval.js";

describe("createDelegationGrantSchema", () => {
  it("accepts a full grant", () => {
    const r = createDelegationGrantSchema.safeParse({
      delegateUserId: "bob", approvalTypes: [], maxBand: "medium",
      maxSpendCents: 50000, validUntil: "2026-12-31T00:00:00Z",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an invalid band", () => {
    const r = createDelegationGrantSchema.safeParse({ delegateUserId: "bob", maxBand: "nope", validUntil: "2026-12-31T00:00:00Z" });
    expect(r.success).toBe(false);
  });
  it("defaults approvalTypes to empty and maxSpendCents to null", () => {
    const r = createDelegationGrantSchema.parse({ delegateUserId: "bob", maxBand: "low", validUntil: "2026-12-31T00:00:00Z" });
    expect(r.approvalTypes).toEqual([]);
    expect(r.maxSpendCents).toBeNull();
  });
});

describe("coverageConfigSchema", () => {
  it("rejects enabled without a backup", () => {
    expect(coverageConfigSchema.safeParse({ enabled: true }).success).toBe(false);
  });
  it("accepts enabled with a backup", () => {
    expect(coverageConfigSchema.safeParse({ enabled: true, backupUserId: "carol" }).success).toBe(true);
  });
  it("accepts disabled with no backup", () => {
    expect(coverageConfigSchema.safeParse({ enabled: false }).success).toBe(true);
  });
});

describe("outOfOfficeSchema", () => {
  it("requires backup + until when enabled", () => {
    expect(outOfOfficeSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(outOfOfficeSchema.safeParse({ enabled: true, backupUserId: "bob", maxBand: "medium", until: "2026-08-01T00:00:00Z" }).success).toBe(true);
  });
});

describe("resolveApprovalSchema actingUnderGrantId", () => {
  it("accepts an optional grant id", () => {
    expect(resolveApprovalSchema.safeParse({ actingUnderGrantId: "6f9619ff-8b86-d011-b42d-00cf4fc964ff" }).success).toBe(true);
  });
  it("rejects a non-uuid grant id", () => {
    expect(resolveApprovalSchema.safeParse({ actingUnderGrantId: "nope" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @paperclipai/shared test delegation`
Expected: FAIL — cannot resolve `./delegation.js`.

- [ ] **Step 3: Write `delegation.ts`**

```ts
import { z } from "zod";
import { APPROVAL_TYPES } from "../constants.js";

const bandSchema = z.enum(["low", "medium", "high", "critical"]);

export const createDelegationGrantSchema = z.object({
  delegateUserId: z.string().min(1),
  approvalTypes: z.array(z.enum(APPROVAL_TYPES)).default([]),
  maxBand: bandSchema,
  maxSpendCents: z.number().int().nonnegative().nullable().default(null),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime(),
});
export type CreateDelegationGrant = z.infer<typeof createDelegationGrantSchema>;

export const coverageConfigSchema = z
  .object({
    enabled: z.boolean(),
    backupUserId: z.string().min(1).nullable().optional(),
    slaCriticalMinutes: z.number().int().positive().optional(),
    slaHighMinutes: z.number().int().positive().optional(),
    slaMediumMinutes: z.number().int().positive().optional(),
    slaLowMinutes: z.number().int().positive().optional(),
  })
  .refine((c) => !c.enabled || (typeof c.backupUserId === "string" && c.backupUserId.length > 0), {
    message: "backupUserId is required when coverage is enabled",
    path: ["backupUserId"],
  });
export type CoverageConfigUpdate = z.infer<typeof coverageConfigSchema>;

export const outOfOfficeSchema = z
  .object({
    enabled: z.boolean(),
    backupUserId: z.string().min(1).optional(),
    maxBand: bandSchema.optional(),
    until: z.string().datetime().optional(),
  })
  .refine((o) => !o.enabled || (o.backupUserId && o.maxBand && o.until), {
    message: "backupUserId, maxBand and until are required when enabling out-of-office",
    path: ["enabled"],
  });
export type OutOfOfficeUpdate = z.infer<typeof outOfOfficeSchema>;
```

- [ ] **Step 4: Add `actingUnderGrantId` to `approval.ts`**

Replace the two schemas:

```ts
export const resolveApprovalSchema = z.object({
  decisionNote: multilineTextSchema.optional().nullable(),
  actingUnderGrantId: z.string().uuid().optional(),
});

export type ResolveApproval = z.infer<typeof resolveApprovalSchema>;

export const requestApprovalRevisionSchema = z.object({
  decisionNote: multilineTextSchema.optional().nullable(),
  actingUnderGrantId: z.string().uuid().optional(),
});
```

- [ ] **Step 5: Re-export from both barrels**

In `packages/shared/src/validators/index.ts`, add:

```ts
export {
  createDelegationGrantSchema,
  coverageConfigSchema,
  outOfOfficeSchema,
  type CreateDelegationGrant,
  type CoverageConfigUpdate,
  type OutOfOfficeUpdate,
} from "./delegation.js";
```

In `packages/shared/src/index.ts`, add the same names to the existing validators re-export block (mirror how `resolveApprovalSchema` / `pushPrefsSchema` are surfaced).

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @paperclipai/shared test delegation`
Expected: PASS.

Run: `pnpm --filter @paperclipai/shared typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/validators/delegation.ts packages/shared/src/validators/delegation.test.ts packages/shared/src/validators/approval.ts packages/shared/src/validators/index.ts packages/shared/src/index.ts
git commit -m "feat(combo-05): 4a shared delegation/coverage validators + actingUnderGrantId"
```

---

### Task 4: Delegation service (grants + coverage config + OOO preset)

**Files:**
- Create: `server/src/services/delegation.ts`
- Modify: `server/src/services/index.ts` (export the factory)
- Test: `server/src/services/delegation.test.ts` (embedded-postgres)

**Interfaces:**
- Consumes: `delegationGrants`, `companyCoverageConfig` (Task 1); `RiskBand` from `./approval-risk.js`.
- Produces: `delegationService(db)` with:
  - `createGrant(companyId, grantorUserId, input: { delegateUserId; approvalTypes: string[]; maxBand: RiskBand; maxSpendCents: number | null; validFrom?: Date; validUntil: Date; source?: "manual" | "out_of_office" }) → DelegationGrantRow`
  - `getGrant(id) → DelegationGrantRow | null`
  - `listGrants(companyId, opts?: { activeAt?: Date }) → DelegationGrantRow[]`
  - `revokeGrant(id, at: Date) → DelegationGrantRow | null`
  - `getCoverageConfig(companyId) → CompanyCoverageConfigRow | null`
  - `upsertCoverageConfig(companyId, patch) → CompanyCoverageConfigRow`
  - `setOutOfOffice(companyId, grantorUserId, input: { enabled; backupUserId?; maxBand?; until?; now: Date }) → { grant: DelegationGrantRow | null; revokedIds: string[] }`

- [ ] **Step 1: Write the failing tests** (`delegation.test.ts`)

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEmbeddedPostgresTestDatabase, type EmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { delegationService } from "./delegation.js";

let h: EmbeddedPostgresTestDatabase;
let companyId: string;
beforeAll(async () => {
  h = await startEmbeddedPostgresTestDatabase();
  companyId = await h.seedCompany(); // helper that inserts a company row and returns its id
});
afterAll(async () => { await h.stop(); });

describe("delegationService grants", () => {
  it("creates and reads a grant", async () => {
    const svc = delegationService(h.db);
    const g = await svc.createGrant(companyId, "alice", {
      delegateUserId: "bob", approvalTypes: [], maxBand: "medium", maxSpendCents: 5000,
      validUntil: new Date("2026-12-31T00:00:00Z"),
    });
    expect(g.grantorUserId).toBe("alice");
    expect(await svc.getGrant(g.id)).toMatchObject({ id: g.id, delegateUserId: "bob" });
  });

  it("revokes a grant", async () => {
    const svc = delegationService(h.db);
    const g = await svc.createGrant(companyId, "alice", { delegateUserId: "bob", approvalTypes: [], maxBand: "low", maxSpendCents: null, validUntil: new Date("2026-12-31T00:00:00Z") });
    const revoked = await svc.revokeGrant(g.id, new Date("2026-07-15T00:00:00Z"));
    expect(revoked?.revokedAt).not.toBeNull();
  });

  it("lists only active grants when activeAt is given", async () => {
    const svc = delegationService(h.db);
    await svc.createGrant(companyId, "alice", { delegateUserId: "dave", approvalTypes: [], maxBand: "low", maxSpendCents: null, validFrom: new Date("2026-01-01T00:00:00Z"), validUntil: new Date("2026-06-01T00:00:00Z") }); // expired
    const active = await svc.listGrants(companyId, { activeAt: new Date("2026-07-15T00:00:00Z") });
    expect(active.every((g) => g.revokedAt === null && g.validUntil > new Date("2026-07-15T00:00:00Z"))).toBe(true);
  });
});

describe("delegationService coverage config", () => {
  it("returns null before any config, then upserts", async () => {
    const svc = delegationService(h.db);
    const c2 = await h.seedCompany();
    expect(await svc.getCoverageConfig(c2)).toBeNull();
    const cfg = await svc.upsertCoverageConfig(c2, { enabled: true, backupUserId: "carol", slaHighMinutes: 120 });
    expect(cfg).toMatchObject({ enabled: true, backupUserId: "carol", slaHighMinutes: 120 });
    const cfg2 = await svc.upsertCoverageConfig(c2, { enabled: false });
    expect(cfg2.enabled).toBe(false);
    expect(cfg2.backupUserId).toBe("carol"); // patch leaves untouched fields
  });
});

describe("delegationService out-of-office", () => {
  it("enabling creates a broad preset grant; disabling revokes active presets", async () => {
    const svc = delegationService(h.db);
    const c3 = await h.seedCompany();
    const now = new Date("2026-07-15T00:00:00Z");
    const on = await svc.setOutOfOffice(c3, "erin", { enabled: true, backupUserId: "frank", maxBand: "medium", until: new Date("2026-08-01T00:00:00Z"), now });
    expect(on.grant?.source).toBe("out_of_office");
    expect(on.grant?.approvalTypes).toEqual([]);
    const off = await svc.setOutOfOffice(c3, "erin", { enabled: false, now });
    expect(off.revokedIds).toContain(on.grant!.id);
  });
});
```

> If `h.seedCompany()` does not exist on the embedded-postgres helper, insert a company inline with `h.db.insert(companies).values({ name: "t" }).returning()` and use its `id`; adapt to the helper's actual API observed in a neighboring test such as `approval-decision-audit.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @paperclipai/server test services/delegation`
Expected: FAIL — cannot resolve `./delegation.js`.

- [ ] **Step 3: Implement `delegation.ts`**

```ts
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { delegationGrants, companyCoverageConfig, type DelegationGrantRow, type CompanyCoverageConfigRow } from "@paperclipai/db";
import type { RiskBand } from "./approval-risk.js";

export function delegationService(db: Db) {
  return {
    async createGrant(
      companyId: string,
      grantorUserId: string,
      input: {
        delegateUserId: string;
        approvalTypes: string[];
        maxBand: RiskBand;
        maxSpendCents: number | null;
        validFrom?: Date;
        validUntil: Date;
        source?: "manual" | "out_of_office";
      },
    ): Promise<DelegationGrantRow> {
      const [row] = await db
        .insert(delegationGrants)
        .values({
          companyId,
          grantorUserId,
          delegateUserId: input.delegateUserId,
          approvalTypes: input.approvalTypes,
          maxBand: input.maxBand,
          maxSpendCents: input.maxSpendCents,
          validFrom: input.validFrom ?? new Date(),
          validUntil: input.validUntil,
          source: input.source ?? "manual",
        })
        .returning();
      return row;
    },

    async getGrant(id: string): Promise<DelegationGrantRow | null> {
      const [row] = await db.select().from(delegationGrants).where(eq(delegationGrants.id, id)).limit(1);
      return row ?? null;
    },

    async listGrants(companyId: string, opts: { activeAt?: Date } = {}): Promise<DelegationGrantRow[]> {
      const rows = await db
        .select()
        .from(delegationGrants)
        .where(eq(delegationGrants.companyId, companyId))
        .orderBy(desc(delegationGrants.createdAt));
      if (!opts.activeAt) return rows;
      const at = opts.activeAt;
      return rows.filter((g) => g.revokedAt === null && g.validFrom <= at && g.validUntil > at);
    },

    async revokeGrant(id: string, at: Date): Promise<DelegationGrantRow | null> {
      const [row] = await db
        .update(delegationGrants)
        .set({ revokedAt: at })
        .where(and(eq(delegationGrants.id, id), isNull(delegationGrants.revokedAt)))
        .returning();
      return row ?? null;
    },

    async getCoverageConfig(companyId: string): Promise<CompanyCoverageConfigRow | null> {
      const [row] = await db.select().from(companyCoverageConfig).where(eq(companyCoverageConfig.companyId, companyId)).limit(1);
      return row ?? null;
    },

    async upsertCoverageConfig(
      companyId: string,
      patch: Partial<Omit<CompanyCoverageConfigRow, "companyId" | "updatedAt">>,
    ): Promise<CompanyCoverageConfigRow> {
      const [row] = await db
        .insert(companyCoverageConfig)
        .values({ companyId, ...patch, updatedAt: new Date() })
        .onConflictDoUpdate({ target: companyCoverageConfig.companyId, set: { ...patch, updatedAt: new Date() } })
        .returning();
      return row;
    },

    async setOutOfOffice(
      companyId: string,
      grantorUserId: string,
      input: { enabled: boolean; backupUserId?: string; maxBand?: RiskBand; until?: Date; now: Date },
    ): Promise<{ grant: DelegationGrantRow | null; revokedIds: string[] }> {
      // Revoke any active OOO presets this grantor already has.
      const active = await db
        .select()
        .from(delegationGrants)
        .where(
          and(
            eq(delegationGrants.companyId, companyId),
            eq(delegationGrants.grantorUserId, grantorUserId),
            eq(delegationGrants.source, "out_of_office"),
            isNull(delegationGrants.revokedAt),
            gt(delegationGrants.validUntil, input.now),
          ),
        );
      const revokedIds: string[] = [];
      for (const g of active) {
        await this.revokeGrant(g.id, input.now);
        revokedIds.push(g.id);
      }
      if (!input.enabled) return { grant: null, revokedIds };
      const grant = await this.createGrant(companyId, grantorUserId, {
        delegateUserId: input.backupUserId!,
        approvalTypes: [],
        maxBand: input.maxBand!,
        maxSpendCents: null,
        validFrom: input.now,
        validUntil: input.until!,
        source: "out_of_office",
      });
      return { grant, revokedIds };
    },
  };
}
```

- [ ] **Step 4: Export from `services/index.ts`**

```ts
export { delegationService } from "./delegation.js";
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @paperclipai/server test services/delegation`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/delegation.ts server/src/services/index.ts server/src/services/delegation.test.ts
git commit -m "feat(combo-05): 4a delegation service — grants, coverage config, OOO preset"
```

---

### Task 5: Delegations routes + mount

**Files:**
- Create: `server/src/routes/delegations.ts`
- Modify: `server/src/app.ts` (import + `api.use(delegationRoutes(db))`)
- Modify: `server/src/routes/index.ts` (re-export `delegationRoutes`)
- Test: `server/src/__tests__/delegations-routes.test.ts`

**Interfaces:**
- Consumes: `delegationService` (Task 4); shared `createDelegationGrantSchema`, `coverageConfigSchema`, `outOfOfficeSchema` (Task 3); `assertBoard`, `assertCompanyAccess` from `./authz.js`; `validate` middleware (same import the approvals route uses).
- Produces: `delegationRoutes(db)` mounting:
  - `POST /companies/:companyId/delegations`
  - `GET /companies/:companyId/delegations`
  - `POST /delegations/:id/revoke`
  - `GET /companies/:companyId/coverage-config`
  - `PUT /companies/:companyId/coverage-config`
  - `POST /companies/:companyId/out-of-office`

- [ ] **Step 1: Write the failing tests** (`delegations-routes.test.ts`)

Model the harness on `server/src/__tests__/approvals-authority-audit-routes.test.ts` (same app builder + board actor). Assertions:

```ts
// POST create → 200, returns grant with grantorUserId = acting board user
// GET list → includes the created grant
// POST revoke → 200, revokedAt set; re-revoke → 404 (already revoked / not found)
// PUT coverage-config { enabled:true } with no backup → 400 (schema refine)
// PUT coverage-config { enabled:true, backupUserId:"carol" } → 200
// GET coverage-config → returns the config
// POST out-of-office { enabled:true, backupUserId, maxBand, until } → 200, grant.source==="out_of_office"
// POST out-of-office { enabled:false } → 200, revokes the preset
```

Write these as concrete supertest calls following the neighboring test's request helper (it builds an app and issues `request(app).post(...).set(boardHeaders)`).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @paperclipai/server test delegations-routes`
Expected: FAIL — cannot resolve `../routes/delegations.js`.

- [ ] **Step 3: Implement `delegations.ts`**

```ts
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createDelegationGrantSchema, coverageConfigSchema, outOfOfficeSchema } from "@paperclipai/shared";
import { delegationService } from "../services/index.js";
import { validate } from "../middleware/validate.js"; // match the approvals route's import path
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function delegationRoutes(db: Db) {
  const router = Router();
  const svc = delegationService(db);

  router.post("/companies/:companyId/delegations", validate(createDelegationGrantSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const grantor = req.actor.userId ?? "board";
    const b = req.body as import("@paperclipai/shared").CreateDelegationGrant;
    const grant = await svc.createGrant(companyId, grantor, {
      delegateUserId: b.delegateUserId,
      approvalTypes: b.approvalTypes,
      maxBand: b.maxBand,
      maxSpendCents: b.maxSpendCents,
      validFrom: b.validFrom ? new Date(b.validFrom) : undefined,
      validUntil: new Date(b.validUntil),
      source: "manual",
    });
    res.json(grant);
  });

  router.get("/companies/:companyId/delegations", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await svc.listGrants(companyId));
  });

  router.post("/delegations/:id/revoke", async (req, res) => {
    const id = req.params.id as string;
    const grant = await svc.getGrant(id);
    if (!grant) { res.status(404).json({ error: "Grant not found" }); return; }
    assertBoard(req);
    assertCompanyAccess(req, grant.companyId);
    const revoked = await svc.revokeGrant(id, new Date());
    if (!revoked) { res.status(404).json({ error: "Grant not found or already revoked" }); return; }
    res.json(revoked);
  });

  router.get("/companies/:companyId/coverage-config", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await svc.getCoverageConfig(companyId));
  });

  router.put("/companies/:companyId/coverage-config", validate(coverageConfigSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const cfg = await svc.upsertCoverageConfig(companyId, req.body);
    res.json(cfg);
  });

  router.post("/companies/:companyId/out-of-office", validate(outOfOfficeSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const grantor = req.actor.userId ?? "board";
    const b = req.body as import("@paperclipai/shared").OutOfOfficeUpdate;
    const result = await svc.setOutOfOffice(companyId, grantor, {
      enabled: b.enabled,
      backupUserId: b.backupUserId,
      maxBand: b.maxBand,
      until: b.until ? new Date(b.until) : undefined,
      now: new Date(),
    });
    res.json(result);
  });

  return router;
}
```

- [ ] **Step 4: Mount + re-export**

In `server/src/routes/index.ts`: `export { delegationRoutes } from "./delegations.js";`
In `server/src/app.ts`: add `import { delegationRoutes } from "./routes/delegations.js";` and, next to `api.use(digestRoutes(db));`, add `api.use(delegationRoutes(db));`.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @paperclipai/server test delegations-routes`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/delegations.ts server/src/routes/index.ts server/src/app.ts server/src/__tests__/delegations-routes.test.ts
git commit -m "feat(combo-05): 4a delegation/coverage/OOO routes + mount"
```

---

### Task 6: Delegated decision path + coverage attribution in `approvals.ts`

**Files:**
- Modify: `server/src/routes/approvals.ts` (the `/approve`, `/reject`, `/request-revision` routes)
- Test: `server/src/__tests__/approvals-delegated-decision.test.ts`

**Interfaces:**
- Consumes: `canDecideUnderDelegation` (Task 2), `delegationService` (Task 4), `impliedSpendFromApproval` from `../services/approval-risk.js`, `approvalCoverageEscalations` (Task 1), existing `recordDecision`, `riskSvc.getSnapshot`, `svc.approve/reject/requestRevision`, `applyApprovalApprovedEffects`.
- Produces: delegated decision behavior (method `delegated_human`) and coverage attribution (method `coverage_escalation`).

- [ ] **Step 1: Write the failing tests** (`approvals-delegated-decision.test.ts`)

Model harness on `approvals-authority-audit-routes.test.ts`. Cases:

```ts
// Setup: company, coverage config with backup="carol", a pending approval, risk snapshot band "low".
// A grant: grantor "alice", delegate "bob", maxBand "medium", maxSpendCents null, valid window covering now.

// 1. bob POST /approvals/:id/approve { actingUnderGrantId: grant.id } (actor.userId="bob")
//    → 200; GET /approvals/:id → decidedVia === "delegated_human";
//    activity_log has an approval.decision row with details.method="delegated_human", details.onBehalfOf="alice", details.grantId=grant.id.

// 2. bob approve with actingUnderGrantId of a grant whose maxBand="low" but approval band="high" → 422 with the band deny message.

// 3. carol (not the delegate) approve with bob's grant id → 422 "actor is not this grant's delegate".

// 4. unknown grant id → 404.

// 5. Coverage attribution: insert an approval_coverage_escalations row for the approval (backup="carol").
//    carol POST /approvals/:id/approve {} (no actingUnderGrantId, board actor.userId="carol")
//    → 200; decidedVia === "coverage_escalation".

// 6. Same escalated approval, a DIFFERENT board user "dave" approves with no grant → decidedVia === "explicit_human".
```

Write these as concrete supertest calls. For actor.userId control, follow the neighboring test's mechanism for setting the board actor's user id (it stubs `req.actor`). If the harness cannot vary `actor.userId`, add a minimal test-only header path already used by that suite; do not invent a new auth mechanism.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @paperclipai/server test approvals-delegated-decision`
Expected: FAIL — routes ignore `actingUnderGrantId`; `decidedVia` stays `explicit_human`.

- [ ] **Step 3: Implement the delegated branch + coverage attribution**

At the top of `approvals.ts`, add imports:

```ts
import { canDecide, canDecideUnderDelegation } from "../services/approval-authority.js"; // extend existing canDecide import
import { impliedSpendFromApproval } from "../services/approval-risk.js";
import { delegationService } from "../services/index.js";
import { approvalCoverageEscalations, companyCoverageConfig } from "@paperclipai/db";
import { eq } from "drizzle-orm"; // if not already imported
```

Inside `approvalRoutes`, after `const svc = ...`, add:

```ts
const delegationSvc = delegationService(db);

// Returns { method, details } for a decision, applying the delegated path or coverage attribution.
// Throws { status, error } for the caller to translate. `outcome` is unused here but kept for symmetry.
async function resolveDecisionMethod(
  req: Request,
  approval: { id: string; companyId: string; type: string; payload: Record<string, unknown> },
  band: RiskBand,
): Promise<{ method: "explicit_human" | "delegated_human" | "coverage_escalation"; details: Record<string, unknown> }> {
  const grantId = (req.body as { actingUnderGrantId?: string }).actingUnderGrantId;
  const actorUserId = req.actor.userId ?? "board";

  if (grantId) {
    const grant = await delegationSvc.getGrant(grantId);
    if (!grant || grant.companyId !== approval.companyId) {
      throw { status: 404, error: "Delegation grant not found" };
    }
    const gate = canDecideUnderDelegation({
      approvalType: approval.type,
      band,
      impliedSpendCents: impliedSpendFromApproval(approval.payload),
      grant: {
        approvalTypes: grant.approvalTypes,
        maxBand: grant.maxBand as RiskBand,
        maxSpendCents: grant.maxSpendCents,
        validFrom: grant.validFrom,
        validUntil: grant.validUntil,
        revokedAt: grant.revokedAt,
        delegateUserId: grant.delegateUserId,
      },
      actorUserId,
      now: new Date(),
    });
    if (!gate.allow) throw { status: 422, error: gate.deny };
    return { method: "delegated_human", details: { grantId: grant.id, onBehalfOf: grant.grantorUserId } };
  }

  // Non-delegated board decision: attribute coverage_escalation if this actor is the
  // configured backup AND the item was escalated.
  const [esc] = await db.select().from(approvalCoverageEscalations).where(eq(approvalCoverageEscalations.approvalId, approval.id)).limit(1);
  if (esc) {
    const [cfg] = await db.select().from(companyCoverageConfig).where(eq(companyCoverageConfig.companyId, approval.companyId)).limit(1);
    if (cfg?.backupUserId && cfg.backupUserId === actorUserId) {
      return { method: "coverage_escalation", details: {} };
    }
  }
  return { method: "explicit_human", details: {} };
}
```

Then in **each** of the three decision routes (`/approve`, `/reject`, `/request-revision`), replace the current `assertBoard(req)` + hardcoded-`explicit_human` gate/record with:

1. Do **not** call `assertBoard(req)` unconditionally. Instead: if `req.body.actingUnderGrantId` is absent, call `assertBoard(req)` (unchanged board path); if present, skip it (the grant authorizes).
2. After loading `approvalForGate` + `risk`, compute the band, then call:

```ts
let decision;
try {
  decision = await resolveDecisionMethod(req, { id, companyId: approval.companyId, type: approval.type, payload: approval.payload }, (risk?.band as RiskBand) ?? "low");
} catch (e) {
  const err = e as { status: number; error?: string };
  res.status(err.status).json({ error: err.error ?? "not allowed" });
  return;
}
```

3. In the existing `recordDecision(...)` call, replace `method: "explicit_human"` with `method: decision.method` and merge `decision.details` into the `details` (e.g. spread `...decision.details` alongside the existing note/risk fields the audit builder passes). Keep the `explicit_human` `canDecide` gate for the board path (call it only when no grant, since the delegated gate already ran).

> Concretely, the approve route becomes: resolve `approval` via `svc.getById`; if no `actingUnderGrantId` → `assertBoard(req)` + `canDecide({ band, method: "explicit_human" })` (422 on deny); compute `decision`; run `svc.approve(id, req.actor.userId ?? "board", note)`; on `applied`, `applyApprovalApprovedEffects` + `recordDecision({ ..., method: decision.method, details: decision.details })`. Mirror for reject and request-revision, using their existing `recordDecision` outcomes (`rejected` / `revision_requested`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @paperclipai/server test approvals-delegated-decision`
Expected: PASS.

Run the existing approvals suites to confirm no regression:
Run: `pnpm --filter @paperclipai/server test approvals`
Expected: PASS (board `explicit_human` path unchanged when no grant / not backup).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/approvals.ts server/src/__tests__/approvals-delegated-decision.test.ts
git commit -m "feat(combo-05): 4a delegated_human decision path + coverage_escalation attribution"
```

---

### Task 7: SLA coverage sweep + timer wiring

**Files:**
- Create: `server/src/services/coverage-sweep.ts`
- Modify: `server/src/services/index.ts` (export factory)
- Modify: `server/src/app.ts` (interval timer, modeled on `feedbackExportTimer`)
- Test: `server/src/__tests__/coverage-sweep.test.ts` (embedded-postgres, `web-push` mocked)

**Interfaces:**
- Consumes: `companyCoverageConfig`, `approvalCoverageEscalations`, `approvals`, `approvalRisk` (Task 1 + existing); `deliverThroughChannels`, `NotificationPayload` from `./notification-delivery.js`; `narrateDigest` is NOT reused directly (its signals shape is digest-specific) — build a small inline coverage summary string instead.
- Produces: `coverageSweepService(db)` with `sweep(now: Date) → { escalated: string[] }` and a pure helper `slaMinutesForBand(cfg, band) → number`.

- [ ] **Step 1: Write the failing tests** (`coverage-sweep.test.ts`)

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
vi.mock("web-push"); // never send real push
import { startEmbeddedPostgresTestDatabase, type EmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { coverageSweepService, slaMinutesForBand } from "../services/coverage-sweep.js";
// plus imports to insert companies/approvals/config/risk via h.db

let h: EmbeddedPostgresTestDatabase;
beforeAll(async () => { h = await startEmbeddedPostgresTestDatabase(); });
afterAll(async () => { await h.stop(); });

describe("slaMinutesForBand", () => {
  it("maps each band to its config threshold", () => {
    const cfg = { slaCriticalMinutes: 60, slaHighMinutes: 240, slaMediumMinutes: 1440, slaLowMinutes: 4320 } as any;
    expect(slaMinutesForBand(cfg, "critical")).toBe(60);
    expect(slaMinutesForBand(cfg, "high")).toBe(240);
    expect(slaMinutesForBand(cfg, "low")).toBe(4320);
  });
});

describe("coverageSweepService.sweep", () => {
  // 1. company with coverage enabled + backup; a pending approval created 5h ago; risk band "high" (SLA 240m=4h).
  //    sweep(now) → escalated includes the approval id; a row exists in approval_coverage_escalations.
  // 2. second sweep(now) → escalated does NOT include it again (idempotent marker).
  // 3. a pending approval created 1h ago, band "high" → not escalated (within SLA).
  // 4. company with coverage disabled OR backup null → sweep escalates nothing for it.
  // 5. delivery throw does not abort: mock a channel to throw for one company; a second eligible company still escalates.
});
```

Write concrete inserts/assertions following `approval-decision-audit.test.ts` for how approvals + risk rows are created in this suite.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @paperclipai/server test coverage-sweep`
Expected: FAIL — cannot resolve `../services/coverage-sweep.js`.

- [ ] **Step 3: Implement `coverage-sweep.ts`**

```ts
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvals, approvalRisk, companyCoverageConfig, approvalCoverageEscalations } from "@paperclipai/db";
import type { RiskBand } from "./approval-risk.js";
import { deliverThroughChannels, type NotificationPayload } from "./notification-delivery.js";
import { logger } from "../logger.js"; // match the digest service's logger import

export function slaMinutesForBand(
  cfg: { slaCriticalMinutes: number; slaHighMinutes: number; slaMediumMinutes: number; slaLowMinutes: number },
  band: RiskBand,
): number {
  switch (band) {
    case "critical": return cfg.slaCriticalMinutes;
    case "high": return cfg.slaHighMinutes;
    case "medium": return cfg.slaMediumMinutes;
    default: return cfg.slaLowMinutes;
  }
}

export function coverageSweepService(db: Db) {
  return {
    async sweep(now: Date): Promise<{ escalated: string[] }> {
      const escalated: string[] = [];
      const configs = await db
        .select()
        .from(companyCoverageConfig)
        .where(eq(companyCoverageConfig.enabled, true));

      for (const cfg of configs) {
        if (!cfg.backupUserId) continue;
        try {
          // pending approvals for this company with no escalation marker, joined to their risk band.
          const rows = await db
            .select({
              id: approvals.id,
              createdAt: approvals.createdAt,
              band: approvalRisk.band,
            })
            .from(approvals)
            .leftJoin(approvalRisk, eq(approvalRisk.approvalId, approvals.id))
            .leftJoin(approvalCoverageEscalations, eq(approvalCoverageEscalations.approvalId, approvals.id))
            .where(
              and(
                eq(approvals.companyId, cfg.companyId),
                eq(approvals.status, "pending"),
                isNull(approvalCoverageEscalations.approvalId),
              ),
            );

          const due = rows.filter((r) => {
            const band = (r.band as RiskBand) ?? "low";
            const deadline = new Date(r.createdAt.getTime() + slaMinutesForBand(cfg, band) * 60_000);
            return now > deadline;
          });
          if (due.length === 0) continue;

          for (const r of due) {
            // Idempotent marker; ON CONFLICT guards against concurrent ticks.
            const inserted = await db
              .insert(approvalCoverageEscalations)
              .values({ approvalId: r.id, companyId: cfg.companyId, backupUserId: cfg.backupUserId, escalatedAt: now })
              .onConflictDoNothing()
              .returning();
            if (inserted.length > 0) escalated.push(r.id);
          }

          const payload: NotificationPayload = {
            kind: "coverage.escalation",
            title: "Approvals past SLA need a decision",
            body: `${due.length} approval${due.length === 1 ? "" : "s"} in your queue passed the response deadline — you're the backup.`,
            link: "/approvals/triage",
            push: {
              title: "Approvals past SLA",
              body: `${due.length} approval${due.length === 1 ? "" : "s"} awaiting a decision`,
              url: "/approvals/triage",
              tag: "coverage-escalation",
              band: "high",
            },
          };
          await deliverThroughChannels({ companyId: cfg.companyId, userId: cfg.backupUserId }, payload);
        } catch (err) {
          logger.warn({ err, companyId: cfg.companyId }, "coverage sweep failed for company");
        }
      }
      return { escalated };
    },
  };
}
```

> Confirm `NotificationPayload.push.band` accepts `"high"` and the `link`/`push.url` field names against `notification-delivery.ts` (the seam map lists `push: { title; body; url; tag?; band?; approvalId? }` and top-level `link`). Adjust field names to match exactly.

- [ ] **Step 4: Export + wire the timer**

In `services/index.ts`: `export { coverageSweepService } from "./coverage-sweep.js";`

In `app.ts`, mirror the `feedbackExportTimer` block (define `COVERAGE_SWEEP_INTERVAL_MS`, e.g. `5 * 60_000`, near the other interval constants):

```ts
const coverageSweep = coverageSweepService(db);
const coverageSweepTimer = setInterval(() => {
  void coverageSweep.sweep(new Date()).catch((err) => logger.error({ err }, "coverage sweep tick failed"));
}, COVERAGE_SWEEP_INTERVAL_MS);
coverageSweepTimer?.unref?.();
```

Add `clearInterval(coverageSweepTimer)` to the same shutdown path that clears `feedbackExportTimer` (find where `disableFeedbackExportFlushes` / shutdown clears timers and clear this one alongside).

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @paperclipai/server test coverage-sweep`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/coverage-sweep.ts server/src/services/index.ts server/src/app.ts server/src/__tests__/coverage-sweep.test.ts
git commit -m "feat(combo-05): 4a SLA coverage sweep + interval wiring"
```

---

### Task 8: UI — delegations management + act-as-delegate

**Files:**
- Create: `ui/src/pages/Delegations.tsx` (or match the repo's page directory convention — check where `Digest` page lives)
- Modify: the router registration file that mounts `/digest` (add `/delegations`)
- Modify: the approvals decision component to send `actingUnderGrantId` when acting as a delegate
- Test: `ui/src/pages/Delegations.test.tsx` (jsdom)

**Interfaces:**
- Consumes: the Task-5 routes (`/companies/:companyId/delegations`, `/coverage-config`, `/out-of-office`) and the Task-6 decision routes.
- Produces: a delegations management page + the delegate action wiring.

- [ ] **Step 1: Locate the UI conventions**

Run: `ls ui/src/pages | grep -iE "digest|approval"` and open the `/digest` page + its API client + its test to copy the fetch/render/test patterns (query hooks, `apiFetch` wrapper, jsdom render helper). Do not introduce a new data-fetching pattern.

- [ ] **Step 2: Write the failing component test** (`Delegations.test.tsx`)

Following the `/digest` page test:

```tsx
// Renders the coverage config form (backup select + SLA inputs + enabled toggle) and the grants list.
// Submitting "create grant" issues POST /companies/:companyId/delegations with the chosen fields.
// Toggling OOO on issues POST /companies/:companyId/out-of-office { enabled:true, backupUserId, maxBand, until }.
// A revoke button issues POST /delegations/:id/revoke.
```

Use the repo's existing fetch-mock helper (whatever `/digest`'s test uses).

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @paperclipai/ui test Delegations`
Expected: FAIL — component does not exist.

- [ ] **Step 4: Implement `Delegations.tsx`**

Build a page with three sections mirroring the `/digest` Notifications section styling:
1. **Coverage** — enabled toggle, backup-user picker, four SLA number inputs; save → `PUT /coverage-config`.
2. **Out-of-office** — toggle + backup + band select + return-date; on/off → `POST /out-of-office`.
3. **Delegations** — form (delegate, approval-types multiselect, band ceiling, spend cap, valid-until) → `POST /delegations`; list of active grants with a Revoke button → `POST /delegations/:id/revoke`.

Reuse the `/digest` page's API client wrapper and query invalidation. Keep the file focused on presentation + the API calls; no business logic beyond formatting.

- [ ] **Step 5: Wire the decision UI**

In the approvals decision component, when the current user holds an active grant covering the open approval (fetch `/companies/:companyId/delegations` filtered to active + delegate === current user, or expose a lighter endpoint if one already exists), render a "Decide as delegate" affordance that includes `actingUnderGrantId` in the approve/reject/request-revision POST body. When absent, behavior is unchanged.

- [ ] **Step 6: Register the route**

Add `/delegations` to the same router file that registers `/digest`.

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm --filter @paperclipai/ui test Delegations`
Expected: PASS.

Run: `pnpm --filter @paperclipai/ui typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ui/src/pages/Delegations.tsx ui/src/pages/Delegations.test.tsx ui/src/... # router + decision component
git commit -m "feat(combo-05): 4a delegations management UI + act-as-delegate"
```

---

### Task 9: Whole-branch verification + memory correction

**Files:**
- Modify: `/home/user/.claude/projects/-home-user-paperclip/memory/combo-05-phasing-state.md` (correct the stale request-revision note; mark 4a state)

- [ ] **Step 1: Full typecheck + tests + migrations**

Run: `pnpm -w typecheck`
Run: `pnpm --filter @paperclipai/db check:migrations`
Run: `pnpm --filter @paperclipai/server test` and `pnpm --filter @paperclipai/shared test` and `pnpm --filter @paperclipai/ui test`
Expected: all PASS. Fix any cross-package fallout (barrel type exports) before proceeding.

- [ ] **Step 2: Correct the combo-05 memory**

Update `combo-05-phasing-state.md`:
- Correct the 3c deferred note: the request-changes *decision endpoint* already exists (`POST /approvals/:id/request-revision`, status `revision_requested`); the remaining deferred item is only the **notification action** wiring (SW button → that endpoint), which belongs to a later push slice, not Phase 4a.
- Record Phase 4a state: delegation grants + SLA coverage designed/planned/built on `feat/combo05-phase4a-delegation-coverage`, migration `0120_combo05_delegation_coverage`, teeth latent-by-design (per-person authority still absent).

- [ ] **Step 3: Requesting code review**

Use `superpowers:requesting-code-review` for a whole-branch review before opening the PR to `master`.

---

## Notes for the implementer

- **Method-string parity:** the audit method strings are exactly `explicit_human` | `delegated_human` | `coverage_escalation` | `auto_policy`. `decidedVia` in `GET /approvals/:id` reads `activity_log.details.method` from the latest `approval.decision` row — the delegated/coverage records must go through the same `recordDecision(..., { method })` call the existing routes use, or `decidedVia` won't reflect them.
- **Do not gate `coverage_escalation` with band checks** — the backup is a full board actor deciding normally; `coverage_escalation` is attribution only (spec §C decision). The only enforced new method is `delegated_human`, via `canDecideUnderDelegation`.
- **Latent teeth:** do not add a per-user decide-permission or downgrade any human actor below `board`. That is explicitly out of scope for 4a.
