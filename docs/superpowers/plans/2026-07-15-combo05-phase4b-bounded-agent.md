# Combo-05 Phase 4b — Bounded Manager-Agent Approver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable a human-authorized, tightly-scoped manager-agent to approve/reject/request-revision on low-band approvals it did not itself request, via the `bounded_agent` decision method, riding Phase 4a's `actingUnderGrantId` route seam.

**Architecture:** A new company-scoped `bounded_agent_approvers` grant table + service records which human authorized which manager-agent, within which scope/band/spend/time. A pure `canDecideAsBoundedAgent` gate enforces those bounds plus a self-approval prohibition. The `bounded_agent` method is flipped from declared-but-inert to enabled in the resolver (it stays in `NON_HUMAN`, so the Phase-1 hard rule keeps it forever ≤ the auto-decision band). The approve/reject/request-revision routes already skip the board assertion when a grant is present; they gain a bounded-agent branch in `resolveDecisionMethod` and method-aware actor attribution so a bounded-agent decision is audited as `actorType: "agent"` naming the deciding agent, the grant, and the authorizing human.

**Tech Stack:** TypeScript, Express, Drizzle ORM (hand-written raw-SQL migrations), Zod validators, Vitest, embedded-postgres test harness, React + @tanstack/react-query (jsdom UI tests via `createRoot`+`act`, no `@testing-library/react`).

## Global Constraints

- **Migrations are hand-written raw SQL.** Do NOT run `drizzle-kit generate` (snapshot baseline stale at 0098). Write `packages/db/src/migrations/NNNN_name.sql` + a matching `meta/_journal.json` entry (idx = number). This migration is `0121_combo05_bounded_agent_approvers`; additive only.
- **Shared validators need TWO exports.** A new validator must be added to BOTH `packages/shared/src/validators/index.ts` AND the top-level `packages/shared/src/index.ts` barrel, or the runtime import resolves to `undefined` and `validate(undefined)` 500s.
- **Schema barrel** `packages/db/src/schema/index.ts` uses named `export { … } from "./file.js"` before the `// [END: module]` marker.
- **Bounded-agent decisions are NEVER above-band.** `bounded_agent` stays in the resolver's `NON_HUMAN` set; the auto-decision ceiling is `AUTO_DECISION_MAX_BAND = "low"` (exported from `@paperclipai/shared`). Grant creation must reject `maxBand` above that ceiling.
- **Self-approval is prohibited.** A manager-agent may never decide an approval whose `requestedByAgentId` equals the deciding agent.
- **Server tests** use the embedded-postgres harness (`getEmbeddedPostgresTestSupport`/`startEmbeddedPostgresTestDatabase`, guarded by `describeEmbeddedPostgres`), config `isolate: true, pool: "forks", maxWorkers: 1`; register per-file singletons in `beforeAll`.
- **UI tests** use `// @vitest-environment jsdom`, `(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true`, render via `react-dom/client` `createRoot` in React's `act(...)`, assert on the DOM. Mirror `ui/src/pages/ApprovalDetail.autoApprove.test.tsx`.
- **Branch:** `feat/combo05-phase4b-bounded-agent` (stacked on `feat/combo05-phase4a-delegation-coverage`). Known-flaky `ui/src/components/artifacts/ArtifactCard.test.tsx` date failures are unrelated — ignore.
- **Commit style:** one commit per task, subject prefixed `feat(combo-05): 4b …`, trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `packages/db/src/schema/bounded_agent_approvers.ts` — Drizzle table (Task 1)
- `packages/db/src/schema/index.ts` — barrel export (Task 1)
- `packages/db/src/migrations/0121_combo05_bounded_agent_approvers.sql` + `meta/_journal.json` (Task 1)
- `server/src/services/approval-authority.ts` — register `bounded_agent`, add `canDecideAsBoundedAgent` (Task 2)
- `server/src/services/approval-authority.test.ts` — gate + resolver tests (Task 2)
- `server/src/services/bounded-agent-approver.ts` — grant service (Task 3)
- `server/src/services/bounded-agent-approver.test.ts` (Task 3)
- `server/src/services/index.ts` — service barrel export (Task 3)
- `packages/shared/src/validators/bounded-agent-approver.ts` — Zod schema (Task 4)
- `packages/shared/src/validators/index.ts` + `packages/shared/src/index.ts` — dual barrel exports (Task 4)
- `server/src/routes/bounded-agent-approvers.ts` — board CRUD routes (Task 5)
- `server/src/app.ts` — mount routes (Task 5)
- `server/src/routes/bounded-agent-approvers.test.ts` (Task 5)
- `server/src/routes/approvals.ts` — `resolveDecisionMethod` bounded branch + method-aware attribution (Task 6)
- `server/src/routes/approvals.boundedAgent.test.ts` — decision integration tests (Task 6)
- `ui/src/api/delegations.ts` — add bounded-agent API calls + types (Task 7)
- `ui/src/pages/Delegations.tsx` — "Bounded agent approvers" section (Task 7)
- `ui/src/pages/Delegations.test.tsx` — extend page test (Task 7)

---

### Task 1: DB schema + migration for `bounded_agent_approvers`

**Files:**
- Create: `packages/db/src/schema/bounded_agent_approvers.ts`
- Modify: `packages/db/src/schema/index.ts:112` (add export before `// [END: module]`)
- Create: `packages/db/src/migrations/0121_combo05_bounded_agent_approvers.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json` (append idx 121 entry)

**Interfaces:**
- Produces: `boundedAgentApprovers` Drizzle table; `type BoundedAgentApproverRow = typeof boundedAgentApprovers.$inferSelect` with fields `{ id, companyId, grantorUserId, delegateAgentId, approvalTypes: string[], maxBand: string, maxSpendCents: number | null, validFrom: Date, validUntil: Date, revokedAt: Date | null, createdByUserId: string | null, updatedByUserId: string | null, createdAt: Date, updatedAt: Date }`.

- [ ] **Step 1: Create the schema file**

Create `packages/db/src/schema/bounded_agent_approvers.ts` (mirrors `delegation_grants.ts`):

```typescript
/**
 * FILE: packages/db/src/schema/bounded_agent_approvers.ts
 * ABOUT: bounded_agent_approvers.ts (schema module).
 *
 * SECTIONS:
 *   [TAG: module] - bounded_agent_approvers.ts (schema module).
 */
// ==========================================
// [META: module]
// INTENT: bounded_agent_approvers.ts (schema module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/src/schema/bounded_agent_approvers.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { pgTable, text, integer, jsonb, timestamp, index, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const boundedAgentApprovers = pgTable(
  "bounded_agent_approvers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    grantorUserId: text("grantor_user_id").notNull(),
    delegateAgentId: text("delegate_agent_id").notNull(),
    approvalTypes: jsonb("approval_types").notNull().default([]).$type<string[]>(),
    maxBand: text("max_band").notNull(),
    maxSpendCents: integer("max_spend_cents"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyDelegateIdx: index("bounded_agent_approvers_company_agent_idx").on(table.companyId, table.delegateAgentId),
  }),
);
export type BoundedAgentApproverRow = typeof boundedAgentApprovers.$inferSelect;
// [END: module]
```

- [ ] **Step 2: Export from the schema barrel**

In `packages/db/src/schema/index.ts`, add this line immediately after line 112 (the `approvalCoverageEscalations` export) and before `// [END: module]`:

```typescript
export { boundedAgentApprovers, type BoundedAgentApproverRow } from "./bounded_agent_approvers.js";
```

- [ ] **Step 3: Write the migration SQL**

Create `packages/db/src/migrations/0121_combo05_bounded_agent_approvers.sql`:

```sql
CREATE TABLE IF NOT EXISTS "bounded_agent_approvers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "grantor_user_id" text NOT NULL,
  "delegate_agent_id" text NOT NULL,
  "approval_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "max_band" text NOT NULL,
  "max_spend_cents" integer,
  "valid_from" timestamp with time zone DEFAULT now() NOT NULL,
  "valid_until" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bounded_agent_approvers_company_agent_idx" ON "bounded_agent_approvers" ("company_id","delegate_agent_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bounded_agent_approvers" ADD CONSTRAINT "bounded_agent_approvers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
```

- [ ] **Step 4: Append the journal entry**

In `packages/db/src/migrations/meta/_journal.json`, add this object to the `entries` array immediately after the `idx: 120` entry (mind the comma after the previous entry's closing brace):

```json
    {
      "idx": 121,
      "version": "7",
      "when": 1784236900000,
      "tag": "0121_combo05_bounded_agent_approvers",
      "breakpoints": true
    }
```

- [ ] **Step 5: Verify migrations + typecheck**

Run: `pnpm --filter @paperclipai/db check:migrations && pnpm --filter @paperclipai/db typecheck`
Expected: migration check passes (journal ↔ files consistent), typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/bounded_agent_approvers.ts packages/db/src/schema/index.ts packages/db/src/migrations/0121_combo05_bounded_agent_approvers.sql packages/db/src/migrations/meta/_journal.json
git commit -m "feat(combo-05): 4b bounded_agent_approvers table + migration 0121

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Register `bounded_agent` + pure `canDecideAsBoundedAgent` gate

**Files:**
- Modify: `server/src/services/approval-authority.ts:6-11` (add `bounded_agent` to `REGISTERED`), append new function
- Modify: `server/src/services/approval-authority.test.ts` (add tests)

**Interfaces:**
- Consumes: `RiskBand`, `RISK_BAND_ORDER` from `./approval-risk.js`; existing `bandRank` local helper.
- Produces:
  ```typescript
  export function canDecideAsBoundedAgent(input: {
    approvalType: string;
    band: RiskBand;
    impliedSpendCents: number;
    deciderAgentId: string | null;
    requestedByAgentId: string | null;
    grant: {
      approvalTypes: string[];
      maxBand: RiskBand;
      maxSpendCents: number | null;
      validFrom: Date;
      validUntil: Date;
      revokedAt: Date | null;
      delegateAgentId: string;
    };
    now: Date;
  }): { allow: boolean; deny?: string }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `server/src/services/approval-authority.test.ts` (import `canDecideAsBoundedAgent` alongside the existing imports from `./approval-authority.js`):

```typescript
import { describe, it, expect } from "vitest";
import { canDecide, canDecideAsBoundedAgent } from "./approval-authority.js";

describe("bounded_agent registration", () => {
  it("bounded_agent is enabled for in-band items", () => {
    expect(canDecide({ band: "low", method: "bounded_agent" }).allow).toBe(true);
  });
  it("bounded_agent still cannot decide above the auto ceiling", () => {
    const r = canDecide({ band: "high", method: "bounded_agent", autoDecisionMaxBand: "low" });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("may not decide items above band");
  });
});

describe("canDecideAsBoundedAgent", () => {
  const base = {
    approvalType: "work_product",
    band: "low" as const,
    impliedSpendCents: 100,
    deciderAgentId: "mgr-agent",
    requestedByAgentId: "worker-agent",
    grant: {
      approvalTypes: ["work_product"],
      maxBand: "low" as const,
      maxSpendCents: 1000,
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validUntil: new Date("2026-12-31T00:00:00Z"),
      revokedAt: null as Date | null,
      delegateAgentId: "mgr-agent",
    },
    now: new Date("2026-07-15T00:00:00Z"),
  };

  it("allows an in-scope, in-band, in-budget decision by the granted agent", () => {
    expect(canDecideAsBoundedAgent(base).allow).toBe(true);
  });
  it("denies when the acting agent is not the grant's delegate", () => {
    const r = canDecideAsBoundedAgent({ ...base, deciderAgentId: "other-agent" });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("not this grant's delegate agent");
  });
  it("denies a non-agent actor", () => {
    expect(canDecideAsBoundedAgent({ ...base, deciderAgentId: null }).allow).toBe(false);
  });
  it("denies self-approval (decider is the requester)", () => {
    const r = canDecideAsBoundedAgent({ ...base, requestedByAgentId: "mgr-agent" });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("own work");
  });
  it("denies a revoked grant", () => {
    const r = canDecideAsBoundedAgent({ ...base, grant: { ...base.grant, revokedAt: new Date("2026-07-01T00:00:00Z") } });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("revoked");
  });
  it("denies before validFrom and after validUntil", () => {
    expect(canDecideAsBoundedAgent({ ...base, now: new Date("2025-12-01T00:00:00Z") }).allow).toBe(false);
    expect(canDecideAsBoundedAgent({ ...base, now: new Date("2027-01-01T00:00:00Z") }).allow).toBe(false);
  });
  it("denies an out-of-scope approval type", () => {
    const r = canDecideAsBoundedAgent({ ...base, approvalType: "budget_change" });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("outside the delegation scope");
  });
  it("denies above the grant band", () => {
    const r = canDecideAsBoundedAgent({ ...base, band: "high" });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("above band");
  });
  it("denies over the spend cap", () => {
    const r = canDecideAsBoundedAgent({ ...base, impliedSpendCents: 5000 });
    expect(r.allow).toBe(false);
    expect(r.deny).toContain("exceeds delegation limit");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @paperclipai/server vitest run src/services/approval-authority.test.ts`
Expected: FAIL — `canDecideAsBoundedAgent` is not exported; `bounded_agent` in-band decision currently denied ("not enabled").

- [ ] **Step 3: Register `bounded_agent` and add the gate**

In `server/src/services/approval-authority.ts`, add `"bounded_agent"` to the `REGISTERED` set (it already sits in `METHOD_PRECEDENCE` and `NON_HUMAN`):

```typescript
const REGISTERED: ReadonlySet<DecisionMethod> = new Set([
  "explicit_human",
  "delegated_human",
  "coverage_escalation",
  "bounded_agent",
  "auto_policy",
]); // phase 2a + 4a + 4b
```

Then append this function at the end of the file (after `canDecideUnderDelegation`), reusing the file's existing `bandRank`:

```typescript
export function canDecideAsBoundedAgent(input: {
  approvalType: string;
  band: RiskBand;
  impliedSpendCents: number;
  deciderAgentId: string | null;
  requestedByAgentId: string | null;
  grant: {
    approvalTypes: string[];
    maxBand: RiskBand;
    maxSpendCents: number | null;
    validFrom: Date;
    validUntil: Date;
    revokedAt: Date | null;
    delegateAgentId: string;
  };
  now: Date;
}): { allow: boolean; deny?: string } {
  const g = input.grant;
  if (!input.deciderAgentId) return { allow: false, deny: "actor is not an agent" };
  if (input.deciderAgentId !== g.delegateAgentId) return { allow: false, deny: "actor is not this grant's delegate agent" };
  if (input.requestedByAgentId !== null && input.deciderAgentId === input.requestedByAgentId) {
    return { allow: false, deny: "a bounded agent may not approve its own work" };
  }
  if (g.revokedAt !== null) return { allow: false, deny: "bounded-agent grant is revoked" };
  if (input.now < g.validFrom) return { allow: false, deny: "bounded-agent grant is not yet active" };
  if (input.now > g.validUntil) return { allow: false, deny: "bounded-agent grant has expired" };
  if (g.approvalTypes.length > 0 && !g.approvalTypes.includes(input.approvalType)) {
    return { allow: false, deny: `approval type ${input.approvalType} is outside the delegation scope` };
  }
  if (bandRank(input.band) > bandRank(g.maxBand)) {
    return { allow: false, deny: `bounded-agent grant may not decide items above band ${g.maxBand}` };
  }
  if (g.maxSpendCents !== null && input.impliedSpendCents > g.maxSpendCents) {
    return { allow: false, deny: `implied spend ${input.impliedSpendCents} exceeds delegation limit ${g.maxSpendCents}` };
  }
  return { allow: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/server vitest run src/services/approval-authority.test.ts`
Expected: PASS (all new + existing above-band hard-rule tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/approval-authority.ts server/src/services/approval-authority.test.ts
git commit -m "feat(combo-05): 4b register bounded_agent + canDecideAsBoundedAgent gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `boundedAgentApproverService`

**Files:**
- Create: `server/src/services/bounded-agent-approver.ts`
- Modify: `server/src/services/index.ts:65` (add export after the `delegationService` export)
- Create: `server/src/services/bounded-agent-approver.test.ts`

**Interfaces:**
- Consumes: `boundedAgentApprovers`, `BoundedAgentApproverRow` from `@paperclipai/db`; `RiskBand` from `./approval-risk.js`.
- Produces:
  ```typescript
  export function boundedAgentApproverService(db: Db): {
    createGrant(companyId: string, grantorUserId: string, input: {
      delegateAgentId: string; approvalTypes: string[]; maxBand: RiskBand;
      maxSpendCents: number | null; validFrom?: Date; validUntil: Date;
    }): Promise<BoundedAgentApproverRow>;
    getGrant(id: string): Promise<BoundedAgentApproverRow | null>;
    listGrants(companyId: string, opts?: { activeAt?: Date }): Promise<BoundedAgentApproverRow[]>;
    revokeGrant(id: string, at: Date): Promise<BoundedAgentApproverRow | null>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `server/src/services/bounded-agent-approver.test.ts` (mirror `delegation.test.ts` harness usage — check that file for the exact embedded-postgres import path and company-seed helper, and reuse them):

```typescript
import { afterAll, beforeAll, expect } from "vitest";
import { getEmbeddedPostgresTestSupport } from "../__tests__/helpers/embedded-postgres.js";
import { boundedAgentApproverService } from "./bounded-agent-approver.js";

const { describeEmbeddedPostgres, startEmbeddedPostgresTestDatabase } = getEmbeddedPostgresTestSupport();

describeEmbeddedPostgres("boundedAgentApproverService", () => {
  let ctx: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let companyId: string;

  beforeAll(async () => {
    ctx = await startEmbeddedPostgresTestDatabase();
    // Seed a company; reuse whatever helper delegation.test.ts uses (e.g. ctx.seedCompany()).
    companyId = await ctx.seedCompany();
  });
  afterAll(async () => { await ctx.stop(); });

  it("creates, lists active, gets, and revokes a bounded-agent grant", async () => {
    const svc = boundedAgentApproverService(ctx.db);
    const now = new Date();
    const grant = await svc.createGrant(companyId, "human-1", {
      delegateAgentId: "mgr-agent",
      approvalTypes: ["work_product"],
      maxBand: "low",
      maxSpendCents: 1000,
      validUntil: new Date(now.getTime() + 86_400_000),
    });
    expect(grant.delegateAgentId).toBe("mgr-agent");

    expect(await svc.getGrant(grant.id)).not.toBeNull();

    const active = await svc.listGrants(companyId, { activeAt: now });
    expect(active.map((g) => g.id)).toContain(grant.id);

    const revoked = await svc.revokeGrant(grant.id, new Date());
    expect(revoked?.revokedAt).not.toBeNull();
    const activeAfter = await svc.listGrants(companyId, { activeAt: new Date() });
    expect(activeAfter.map((g) => g.id)).not.toContain(grant.id);
  });
});
```

> NOTE: Open `server/src/services/delegation.test.ts` first and copy its exact harness bootstrap (import path, `describeEmbeddedPostgres` usage, and the company-seed helper name). Match it verbatim; the pseudo-calls `ctx.seedCompany()`/`ctx.db`/`ctx.stop()` above are placeholders for whatever that file actually uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server vitest run src/services/bounded-agent-approver.test.ts`
Expected: FAIL — `bounded-agent-approver.js` module not found.

- [ ] **Step 3: Write the service**

Create `server/src/services/bounded-agent-approver.ts`:

```typescript
/**
 * FILE: server/src/services/bounded-agent-approver.ts
 * ABOUT: bounded-agent-approver.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - bounded-agent-approver.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: CRUD for human-authorized bounded manager-agent approver grants.
// PSEUDOCODE: 1. create. 2. get. 3. list (optionally active-at). 4. revoke.
// JSON_FLOW: {"file": "server/src/services/bounded-agent-approver.ts", "imports": "@paperclipai/db", "exports": "boundedAgentApproverService"}
// ==========================================
// [START: module]
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { boundedAgentApprovers, type BoundedAgentApproverRow } from "@paperclipai/db";
import type { RiskBand } from "./approval-risk.js";

export function boundedAgentApproverService(db: Db) {
  return {
    async createGrant(
      companyId: string,
      grantorUserId: string,
      input: {
        delegateAgentId: string;
        approvalTypes: string[];
        maxBand: RiskBand;
        maxSpendCents: number | null;
        validFrom?: Date;
        validUntil: Date;
      },
    ): Promise<BoundedAgentApproverRow> {
      const [row] = await db
        .insert(boundedAgentApprovers)
        .values({
          companyId,
          grantorUserId,
          delegateAgentId: input.delegateAgentId,
          approvalTypes: input.approvalTypes,
          maxBand: input.maxBand,
          maxSpendCents: input.maxSpendCents,
          validFrom: input.validFrom ?? new Date(),
          validUntil: input.validUntil,
          createdByUserId: grantorUserId,
          updatedByUserId: grantorUserId,
        })
        .returning();
      return row!;
    },

    async getGrant(id: string): Promise<BoundedAgentApproverRow | null> {
      const [row] = await db.select().from(boundedAgentApprovers).where(eq(boundedAgentApprovers.id, id)).limit(1);
      return row ?? null;
    },

    async listGrants(companyId: string, opts: { activeAt?: Date } = {}): Promise<BoundedAgentApproverRow[]> {
      const rows = await db
        .select()
        .from(boundedAgentApprovers)
        .where(eq(boundedAgentApprovers.companyId, companyId))
        .orderBy(desc(boundedAgentApprovers.createdAt));
      if (!opts.activeAt) return rows;
      const at = opts.activeAt;
      return rows.filter((g) => g.revokedAt === null && g.validFrom <= at && g.validUntil > at);
    },

    async revokeGrant(id: string, at: Date): Promise<BoundedAgentApproverRow | null> {
      const [row] = await db
        .update(boundedAgentApprovers)
        .set({ revokedAt: at, updatedAt: new Date() })
        .where(and(eq(boundedAgentApprovers.id, id), isNull(boundedAgentApprovers.revokedAt)))
        .returning();
      return row ?? null;
    },
  };
}
// [END: module]
```

- [ ] **Step 4: Export from the services barrel**

In `server/src/services/index.ts`, add immediately after line 65 (the `delegationService` export):

```typescript
export { boundedAgentApproverService } from "./bounded-agent-approver.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/server vitest run src/services/bounded-agent-approver.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/bounded-agent-approver.ts server/src/services/bounded-agent-approver.test.ts server/src/services/index.ts
git commit -m "feat(combo-05): 4b bounded-agent approver grant service

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Shared validator `createBoundedAgentApproverSchema`

**Files:**
- Create: `packages/shared/src/validators/bounded-agent-approver.ts`
- Modify: `packages/shared/src/validators/index.ts` (add re-export block)
- Modify: `packages/shared/src/index.ts:1166` (add names to the existing export block that lists `createDelegationGrantSchema`)
- Create: `packages/shared/src/validators/bounded-agent-approver.test.ts`

**Interfaces:**
- Consumes: `APPROVAL_TYPES` from `../constants.js`; `AUTO_DECISION_MAX_BAND` from `./auto-approve-policy.js`.
- Produces: `createBoundedAgentApproverSchema` (Zod), `type CreateBoundedAgentApprover`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/validators/bounded-agent-approver.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createBoundedAgentApproverSchema } from "./bounded-agent-approver.js";

describe("createBoundedAgentApproverSchema", () => {
  const good = {
    delegateAgentId: "mgr-agent",
    approvalTypes: [] as string[],
    maxBand: "low",
    maxSpendCents: 1000,
    validUntil: "2026-12-31T00:00:00.000Z",
  };
  it("accepts a low-band grant", () => {
    expect(createBoundedAgentApproverSchema.safeParse(good).success).toBe(true);
  });
  it("rejects a maxBand above the auto ceiling", () => {
    const r = createBoundedAgentApproverSchema.safeParse({ ...good, maxBand: "high" });
    expect(r.success).toBe(false);
  });
  it("requires a delegateAgentId", () => {
    const r = createBoundedAgentApproverSchema.safeParse({ ...good, delegateAgentId: "" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/shared vitest run src/validators/bounded-agent-approver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the validator**

Create `packages/shared/src/validators/bounded-agent-approver.ts`:

```typescript
import { z } from "zod";
import { APPROVAL_TYPES } from "../constants.js";
import { AUTO_DECISION_MAX_BAND } from "./auto-approve-policy.js";

const bandSchema = z.enum(["low", "medium", "high", "critical"]);
const BAND_ORDER = ["low", "medium", "high", "critical"] as const;

export const createBoundedAgentApproverSchema = z
  .object({
    delegateAgentId: z.string().min(1),
    approvalTypes: z.array(z.enum(APPROVAL_TYPES)).default([]),
    maxBand: bandSchema,
    maxSpendCents: z.number().int().nonnegative().nullable().default(null),
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime(),
  })
  .refine((v) => BAND_ORDER.indexOf(v.maxBand) <= BAND_ORDER.indexOf(AUTO_DECISION_MAX_BAND), {
    message: `maxBand may not exceed the auto-decision ceiling (${AUTO_DECISION_MAX_BAND})`,
    path: ["maxBand"],
  });
export type CreateBoundedAgentApprover = z.infer<typeof createBoundedAgentApproverSchema>;
```

- [ ] **Step 4: Add the validators-barrel export**

In `packages/shared/src/validators/index.ts`, add a new export block mirroring the delegation one:

```typescript
export {
  createBoundedAgentApproverSchema,
  type CreateBoundedAgentApprover,
} from "./bounded-agent-approver.js";
```

- [ ] **Step 5: Add the top-level barrel export**

In `packages/shared/src/index.ts`, add `createBoundedAgentApproverSchema,` to the existing export block that already contains `createDelegationGrantSchema,` (around line 1168):

```typescript
  createDelegationGrantSchema,
  createBoundedAgentApproverSchema,
  coverageConfigSchema,
```

(Add the type `CreateBoundedAgentApprover` to the corresponding `export type { … }` block in that file if one lists `CreateDelegationGrant`; otherwise the value export above is sufficient for runtime use.)

- [ ] **Step 6: Run test to verify it passes + build the package**

Run: `pnpm --filter @paperclipai/shared vitest run src/validators/bounded-agent-approver.test.ts && pnpm --filter @paperclipai/shared build`
Expected: PASS; build succeeds so `@paperclipai/shared` re-exports resolve for the server.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/validators/bounded-agent-approver.ts packages/shared/src/validators/bounded-agent-approver.test.ts packages/shared/src/validators/index.ts packages/shared/src/index.ts
git commit -m "feat(combo-05): 4b shared createBoundedAgentApproverSchema (dual barrel)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Board CRUD routes for bounded-agent approvers

**Files:**
- Create: `server/src/routes/bounded-agent-approvers.ts`
- Modify: `server/src/app.ts:42` (import) and `server/src/app.ts:265` (mount, next to `delegationRoutes`)
- Create: `server/src/routes/bounded-agent-approvers.test.ts`

**Interfaces:**
- Consumes: `boundedAgentApproverService` (Task 3), `createBoundedAgentApproverSchema` + `CreateBoundedAgentApprover` (Task 4), `assertBoard`/`assertCompanyAccess` from `./authz.js`, `validate` middleware.
- Produces: `boundedAgentApproverRoutes(db: Db): Router` mounted so these paths exist:
  `GET/POST /companies/:companyId/bounded-agent-approvers`, `POST /bounded-agent-approvers/:id/revoke`.

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/bounded-agent-approvers.test.ts`. Mirror the harness/auth setup in `server/src/routes/delegations.test.ts` (open it and copy how it builds the app, seeds a company, and authenticates a board actor). Assert:

```typescript
// (bootstrap copied from delegations.test.ts: app, board-auth header, seeded companyId)

it("board can create, list, and revoke a bounded-agent approver grant", async () => {
  const create = await boardRequest(app)
    .post(`/companies/${companyId}/bounded-agent-approvers`)
    .send({ delegateAgentId: "mgr-agent", approvalTypes: ["work_product"], maxBand: "low", maxSpendCents: 1000, validUntil: "2026-12-31T00:00:00.000Z" });
  expect(create.status).toBe(200);
  const grantId = create.body.id;

  const list = await boardRequest(app).get(`/companies/${companyId}/bounded-agent-approvers`);
  expect(list.body.map((g: any) => g.id)).toContain(grantId);

  const revoke = await boardRequest(app).post(`/bounded-agent-approvers/${grantId}/revoke`).send({});
  expect(revoke.status).toBe(200);
  expect(revoke.body.revokedAt).not.toBeNull();
});

it("rejects a grant whose maxBand exceeds the auto ceiling", async () => {
  const res = await boardRequest(app)
    .post(`/companies/${companyId}/bounded-agent-approvers`)
    .send({ delegateAgentId: "mgr-agent", approvalTypes: [], maxBand: "high", maxSpendCents: null, validUntil: "2026-12-31T00:00:00.000Z" });
  expect(res.status).toBe(400);
});
```

> NOTE: `boardRequest`/`app` are placeholders — use the exact helpers `delegations.test.ts` uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server vitest run src/routes/bounded-agent-approvers.test.ts`
Expected: FAIL — routes not mounted (404).

- [ ] **Step 3: Write the routes**

Create `server/src/routes/bounded-agent-approvers.ts`:

```typescript
/**
 * FILE: server/src/routes/bounded-agent-approvers.ts
 * ABOUT: bounded-agent-approvers.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - bounded-agent-approvers.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: Board-only CRUD for bounded manager-agent approver grants.
// PSEUDOCODE: 1. create (board). 2. list (board). 3. revoke (board).
// JSON_FLOW: {"file": "server/src/routes/bounded-agent-approvers.ts", "imports": "see code", "exports": "boundedAgentApproverRoutes"}
// ==========================================
// [START: module]
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createBoundedAgentApproverSchema, type CreateBoundedAgentApprover } from "@paperclipai/shared";
import { boundedAgentApproverService } from "../services/index.js";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function boundedAgentApproverRoutes(db: Db) {
  const router = Router();
  const svc = boundedAgentApproverService(db);

  router.post(
    "/companies/:companyId/bounded-agent-approvers",
    validate(createBoundedAgentApproverSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const grantor = req.actor.userId ?? "board";
      const b = req.body as CreateBoundedAgentApprover;
      const grant = await svc.createGrant(companyId, grantor, {
        delegateAgentId: b.delegateAgentId,
        approvalTypes: b.approvalTypes,
        maxBand: b.maxBand,
        maxSpendCents: b.maxSpendCents,
        validFrom: b.validFrom ? new Date(b.validFrom) : undefined,
        validUntil: new Date(b.validUntil),
      });
      res.json(grant);
    },
  );

  router.get("/companies/:companyId/bounded-agent-approvers", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await svc.listGrants(companyId));
  });

  router.post("/bounded-agent-approvers/:id/revoke", async (req, res) => {
    const id = req.params.id as string;
    const grant = await svc.getGrant(id);
    if (!grant) {
      res.status(404).json({ error: "Grant not found" });
      return;
    }
    assertBoard(req);
    assertCompanyAccess(req, grant.companyId);
    const revoked = await svc.revokeGrant(id, new Date());
    if (!revoked) {
      res.status(404).json({ error: "Grant not found or already revoked" });
      return;
    }
    res.json(revoked);
  });

  return router;
}
// [END: module]
```

- [ ] **Step 4: Mount the routes**

In `server/src/app.ts`, add the import next to line 42 (`delegationRoutes`):

```typescript
import { boundedAgentApproverRoutes } from "./routes/bounded-agent-approvers.js";
```

And mount it immediately after line 265 (`api.use(delegationRoutes(db));`):

```typescript
  api.use(boundedAgentApproverRoutes(db));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/server vitest run src/routes/bounded-agent-approvers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/bounded-agent-approvers.ts server/src/routes/bounded-agent-approvers.test.ts server/src/app.ts
git commit -m "feat(combo-05): 4b board CRUD routes for bounded-agent approvers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire `bounded_agent` into the decision flow

**Files:**
- Modify: `server/src/routes/approvals.ts` — `resolveDecisionMethod` (lines 89-141), `applyApprovalApprovedEffects` param type (line 165), and the approve/reject/request-revision handlers (lines 492-676)
- Create: `server/src/routes/approvals.boundedAgent.test.ts`

**Interfaces:**
- Consumes: `canDecideAsBoundedAgent` (Task 2), `boundedAgentApproverService` (Task 3), `impliedSpendFromApproval` (already imported), `req.actor.agentId`.
- Produces: `resolveDecisionMethod` return type widened to include `"bounded_agent"`; a local `decisionActor(req, method)` helper.

- [ ] **Step 1: Write the failing integration test**

Create `server/src/routes/approvals.boundedAgent.test.ts`. Bootstrap from an existing approvals route test (e.g. an existing `approvals.*.test.tsx`/`.ts` that seeds an approval and posts a decision — copy its app build, company/agent seed, and how it sets an **agent** actor header vs a board actor header). Assert:

```typescript
// bootstrap: app, seeded companyId, a low-band approval requested by "worker-agent",
// a board-auth header, and an agent-auth header for "mgr-agent".

it("a granted manager-agent approves a low-band item it did not request, audited as agent", async () => {
  // board grants mgr-agent bounded approver authority
  const grant = await boardRequest(app)
    .post(`/companies/${companyId}/bounded-agent-approvers`)
    .send({ delegateAgentId: "mgr-agent", approvalTypes: [], maxBand: "low", maxSpendCents: null, validUntil: "2026-12-31T00:00:00.000Z" });

  const res = await agentRequest(app, "mgr-agent")
    .post(`/approvals/${approvalId}/approve`)
    .send({ actingUnderGrantId: grant.body.id });
  expect(res.status).toBe(200);

  // audit row names the agent, the grant, and the authorizing human
  const decisions = await listDecisions(db, approvalId); // helper reading approval_decisions/activity
  const d = decisions.find((x: any) => x.method === "bounded_agent");
  expect(d).toBeTruthy();
  expect(d.actorType).toBe("agent");
  expect(d.actorId).toBe("mgr-agent");
  expect(d.details.grantId).toBe(grant.body.id);
  expect(d.details.onBehalfOf).toBeTruthy();
});

it("denies self-approval (agent approving its own requested item) with 422", async () => {
  const grant = await boardRequest(app)
    .post(`/companies/${companyId}/bounded-agent-approvers`)
    .send({ delegateAgentId: "worker-agent", approvalTypes: [], maxBand: "low", maxSpendCents: null, validUntil: "2026-12-31T00:00:00.000Z" });
  const res = await agentRequest(app, "worker-agent")
    .post(`/approvals/${approvalId}/approve`)
    .send({ actingUnderGrantId: grant.body.id });
  expect(res.status).toBe(422);
  expect(res.body.error).toContain("own work");
});

it("an agent with no grant is still board-gated (403) on approve", async () => {
  const res = await agentRequest(app, "mgr-agent").post(`/approvals/${approvalId}/approve`).send({});
  expect(res.status).toBe(403);
});

it("denies an above-band item even with a grant (422)", async () => {
  // seed/raise the approval to a high band, then attempt with a low-band grant
  const grant = await boardRequest(app)
    .post(`/companies/${companyId}/bounded-agent-approvers`)
    .send({ delegateAgentId: "mgr-agent", approvalTypes: [], maxBand: "low", maxSpendCents: null, validUntil: "2026-12-31T00:00:00.000Z" });
  const res = await agentRequest(app, "mgr-agent")
    .post(`/approvals/${highBandApprovalId}/approve`)
    .send({ actingUnderGrantId: grant.body.id });
  expect(res.status).toBe(422);
});
```

> NOTE: `boardRequest`/`agentRequest`/`listDecisions`/`highBandApprovalId` are placeholders — wire them from the existing approvals test helpers and the `approval_decisions` audit reader. The core assertions (200 + agent-typed audit naming grant+onBehalfOf; 422 self-approval; 403 no-grant; 422 above-band) are the contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server vitest run src/routes/approvals.boundedAgent.test.ts`
Expected: FAIL — bounded-agent grant id is unknown to `resolveDecisionMethod` (currently 404 "Delegation grant not found"), so approve does not reach the agent path.

- [ ] **Step 3: Instantiate the bounded-agent service in the router**

In `server/src/routes/approvals.ts`, add the import to the existing services import from `../services/index.js` and instantiate near line 81 (next to `const delegationSvc = delegationService(db);`):

```typescript
  const boundedAgentSvc = boundedAgentApproverService(db);
```

Also import `canDecideAsBoundedAgent` alongside the existing `canDecideUnderDelegation` import (line 37).

- [ ] **Step 4: Extend `resolveDecisionMethod` with the bounded-agent branch**

In `server/src/routes/approvals.ts`, widen the return type (line 93) to include `"bounded_agent"`:

```typescript
  ): Promise<{ method: "explicit_human" | "delegated_human" | "coverage_escalation" | "bounded_agent"; details: Record<string, unknown> }> {
```

Then replace the `if (grantId) { … }` block (lines 97-120) so it tries the delegation grant first, then the bounded-agent grant:

```typescript
    if (grantId) {
      const grant = await delegationSvc.getGrant(grantId);
      if (grant) {
        if (grant.companyId !== approval.companyId) {
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

      const baGrant = await boundedAgentSvc.getGrant(grantId);
      if (baGrant) {
        if (baGrant.companyId !== approval.companyId) {
          throw { status: 404, error: "Bounded-agent grant not found" };
        }
        const gate = canDecideAsBoundedAgent({
          approvalType: approval.type,
          band,
          impliedSpendCents: impliedSpendFromApproval(approval.payload),
          deciderAgentId: req.actor.agentId ?? null,
          requestedByAgentId: (approval as { requestedByAgentId?: string | null }).requestedByAgentId ?? null,
          grant: {
            approvalTypes: baGrant.approvalTypes,
            maxBand: baGrant.maxBand as RiskBand,
            maxSpendCents: baGrant.maxSpendCents,
            validFrom: baGrant.validFrom,
            validUntil: baGrant.validUntil,
            revokedAt: baGrant.revokedAt,
            delegateAgentId: baGrant.delegateAgentId,
          },
          now: new Date(),
        });
        if (!gate.allow) throw { status: 422, error: gate.deny };
        return {
          method: "bounded_agent",
          details: { grantId: baGrant.id, onBehalfOf: baGrant.grantorUserId, deciderAgentId: req.actor.agentId ?? null },
        };
      }

      throw { status: 404, error: "Delegation grant not found" };
    }
```

> The `approval` object passed to `resolveDecisionMethod` currently omits `requestedByAgentId`. Update its three call sites (approve/reject/request-revision) to include it — see Step 6. The gate reads it to enforce the self-approval prohibition.

- [ ] **Step 5: Add the `decisionActor` helper and widen `applyApprovalApprovedEffects`**

In `server/src/routes/approvals.ts`, add a helper just after `resolveDecisionMethod` (before `const riskSvc = …`):

```typescript
  // Combo-05 Phase 4b: attribute the decision to the acting agent when the
  // resolved method is bounded_agent; otherwise the existing human/board actor.
  function decisionActor(
    req: Request,
    method: "explicit_human" | "delegated_human" | "coverage_escalation" | "bounded_agent",
  ): { actorType: "user" | "agent"; actorId: string } {
    if (method === "bounded_agent") return { actorType: "agent", actorId: req.actor.agentId ?? "agent" };
    return { actorType: "user", actorId: req.actor.userId ?? "board" };
  }
```

Widen `applyApprovalApprovedEffects`'s actor parameter type (line 165) to admit `"agent"`:

```typescript
    actor: { actorType: "user" | "system" | "agent"; actorId: string },
```

- [ ] **Step 6: Update the three decision handlers to use method-aware attribution**

For **each** of the approve (492-548), reject (550-611), and request-revision (613-676) handlers, apply the same three edits:

**(a)** Add `requestedByAgentId` to the object passed into `resolveDecisionMethod` so the gate can see it. Change:
```typescript
        { id, companyId: approvalForGate!.companyId, type: approvalForGate!.type, payload: approvalForGate!.payload },
```
to:
```typescript
        { id, companyId: approvalForGate!.companyId, type: approvalForGate!.type, payload: approvalForGate!.payload, requestedByAgentId: approvalForGate!.requestedByAgentId ?? null },
```
(and widen the `approval` param type of `resolveDecisionMethod` at line 91 to include `requestedByAgentId?: string | null`).

**(b)** After `decision` is resolved, derive the actor and use it for the service call. Replace the pre-computed `const decidedByUserId = req.actor.userId ?? "board";` usage: compute `const actor = decisionActor(req, decision.method);` right after the `try/catch` that sets `decision`, and pass `actor.actorId` to the service call. For approve:
```typescript
    const actor = decisionActor(req, decision.method);
    const { approval, applied } = await svc.approve(id, actor.actorId, req.body.decisionNote);
```
For reject: `await svc.reject(id, actor.actorId, req.body.decisionNote);`
For request-revision: `await svc.requestRevision(id, actor.actorId, req.body.decisionNote);`

**(c)** Use `actor` in the side-effects, activity log, and audit record. In approve, change `applyApprovalApprovedEffects(approval, { actorType: "user", actorId: req.actor.userId ?? "board" })` to `applyApprovalApprovedEffects(approval, actor)`. In all three, change the `recordDecision(..., actor: { actorType: "user", actorId: req.actor.userId ?? "board" }, ...)` to `actor,` and the `logActivity(..., actorType: "user", actorId: req.actor.userId ?? "board", ...)` (reject/request-revision) to `actorType: actor.actorType, actorId: actor.actorId,`.

> The old line `const decidedByUserId = req.actor.userId ?? "board";` (approve line 500, reject 558, revision 624) is now dead — delete it in each handler.

- [ ] **Step 7: Run the integration test + full server suite**

Run: `pnpm --filter @paperclipai/server vitest run src/routes/approvals.boundedAgent.test.ts && pnpm --filter @paperclipai/server typecheck`
Expected: PASS. Then run the existing approvals/delegation route tests to confirm no regression:
Run: `pnpm --filter @paperclipai/server vitest run src/routes/delegations.test.ts src/routes/approvals`
Expected: PASS (delegated_human path unchanged).

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/approvals.ts server/src/routes/approvals.boundedAgent.test.ts
git commit -m "feat(combo-05): 4b bounded_agent decision path + agent-typed audit attribution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: UI — bounded-agent approvers section on the Delegations page

**Files:**
- Modify: `ui/src/api/delegations.ts` (add types + `delegationsApi` calls)
- Modify: `ui/src/pages/Delegations.tsx` (add a "Bounded agent approvers" section)
- Modify: `ui/src/pages/Delegations.test.tsx` (extend)

**Interfaces:**
- Consumes: `api` client, `APPROVAL_TYPES`, `useCompany`, react-query hooks — all already used by this page.
- Produces: `delegationsApi.listBoundedAgents/createBoundedAgent/revokeBoundedAgent`; a rendered section with `name="delegateAgentId"` input and a "Create approver" button.

- [ ] **Step 1: Write the failing test**

Extend `ui/src/pages/Delegations.test.tsx` (copy the existing render harness in that file — `createRoot`+`act`, mocked `delegationsApi`). Add a case asserting the new section renders and can submit:

```typescript
it("renders the bounded agent approvers section and creates a grant", async () => {
  // mock delegationsApi.listBoundedAgents -> [] and createBoundedAgent -> resolved
  const { container } = await renderDelegations(); // existing helper
  expect(container.textContent).toContain("Bounded agent approvers");
  const agentInput = container.querySelector('input[name="delegateAgentId"]') as HTMLInputElement;
  expect(agentInput).toBeTruthy();
});
```

> NOTE: match the file's existing mocking style for `../api/delegations` (it already mocks `delegationsApi`); add the three new methods to that mock.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/ui vitest run src/pages/Delegations.test.tsx`
Expected: FAIL — "Bounded agent approvers" text / `delegateAgentId` input absent.

- [ ] **Step 3: Add the API layer**

In `ui/src/api/delegations.ts`, append before `// [END: module]`:

```typescript
export type BoundedAgentApprover = {
  id: string;
  companyId: string;
  grantorUserId: string;
  delegateAgentId: string;
  approvalTypes: string[];
  maxBand: DelegationBand;
  maxSpendCents: number | null;
  validFrom: string;
  validUntil: string;
  revokedAt: string | null;
  createdAt: string;
};

export type CreateBoundedAgentApproverBody = {
  delegateAgentId: string;
  approvalTypes: string[];
  maxBand: DelegationBand;
  maxSpendCents: number | null;
  validUntil: string;
};
```

And add three methods to the `delegationsApi` object:

```typescript
  listBoundedAgents: (companyId: string) =>
    api.get<BoundedAgentApprover[]>(`/companies/${companyId}/bounded-agent-approvers`),
  createBoundedAgent: (companyId: string, body: CreateBoundedAgentApproverBody) =>
    api.post<BoundedAgentApprover>(`/companies/${companyId}/bounded-agent-approvers`, body),
  revokeBoundedAgent: (id: string) =>
    api.post<BoundedAgentApprover>(`/bounded-agent-approvers/${id}/revoke`, {}),
```

- [ ] **Step 4: Add the page section**

In `ui/src/pages/Delegations.tsx`, add state, query, mutations, and a `<section>` mirroring the existing Delegations section. Add near the other `useState`/`useQuery`/`useMutation` blocks:

```typescript
  type BoundedAgentForm = {
    delegateAgentId: string;
    approvalTypes: string[];
    maxBand: DelegationBand;
    maxSpendCents: string;
    validUntil: string;
  };
  const defaultBoundedAgentForm: BoundedAgentForm = {
    delegateAgentId: "",
    approvalTypes: [],
    maxBand: "low",
    maxSpendCents: "",
    validUntil: "",
  };
  const [baForm, setBaForm] = useState<BoundedAgentForm>(defaultBoundedAgentForm);
  const [baError, setBaError] = useState<string | null>(null);

  const { data: boundedAgents } = useQuery({
    queryKey: ["bounded-agent-approvers", companyId],
    queryFn: () => delegationsApi.listBoundedAgents(companyId),
    enabled: !!companyId,
    retry: false,
  });

  const createBoundedAgent = useMutation({
    mutationFn: () =>
      delegationsApi.createBoundedAgent(companyId, {
        delegateAgentId: baForm.delegateAgentId,
        approvalTypes: baForm.approvalTypes,
        maxBand: baForm.maxBand,
        maxSpendCents: baForm.maxSpendCents ? Number(baForm.maxSpendCents) : null,
        validUntil: toIsoDateTime(baForm.validUntil) ?? "",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bounded-agent-approvers", companyId] });
      setBaForm(defaultBoundedAgentForm);
      setBaError(null);
    },
    onError: () => setBaError("Couldn't create the bounded-agent approver. Please try again."),
  });

  const revokeBoundedAgent = useMutation({
    mutationFn: (id: string) => delegationsApi.revokeBoundedAgent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bounded-agent-approvers", companyId] }),
  });

  const toggleBaApprovalType = (type: string) => {
    setBaForm((f) => ({
      ...f,
      approvalTypes: f.approvalTypes.includes(type)
        ? f.approvalTypes.filter((t) => t !== type)
        : [...f.approvalTypes, type],
    }));
  };

  const activeBoundedAgents = (boundedAgents ?? []).filter((g) => !g.revokedAt);
```

Then add this `<section>` immediately before the closing `</div>` of the page (after the Delegations section):

```tsx
      <section className="bounded-agents mt-6 border-t pt-4">
        <h2 className="text-lg font-medium">Bounded agent approvers</h2>
        <p className="text-xs text-muted-foreground">
          Authorize a manager-agent to decide low-band approvals it did not itself request. Band is
          capped at the auto-decision ceiling; a manager-agent can never approve its own work.
        </p>
        <label className="block mt-2">
          Manager agent
          <input
            type="text"
            name="delegateAgentId"
            value={baForm.delegateAgentId}
            onChange={(e) => setBaForm({ ...baForm, delegateAgentId: e.target.value })}
          />
        </label>
        <fieldset className="mt-2">
          <legend>Approval types</legend>
          {APPROVAL_TYPES.map((type) => (
            <label key={type} className="block">
              <input
                type="checkbox"
                value={type}
                checked={baForm.approvalTypes.includes(type)}
                onChange={() => toggleBaApprovalType(type)}
              />{" "}
              {type}
            </label>
          ))}
        </fieldset>
        <label className="block mt-2">
          Spend cap (cents)
          <input
            type="number"
            name="baMaxSpendCents"
            value={baForm.maxSpendCents}
            onChange={(e) => setBaForm({ ...baForm, maxSpendCents: e.target.value })}
          />
        </label>
        <label className="block mt-2">
          Valid until
          <input
            type="date"
            name="baValidUntil"
            value={baForm.validUntil}
            onChange={(e) => setBaForm({ ...baForm, validUntil: e.target.value })}
          />
        </label>
        <button
          className="mt-2"
          onClick={() => {
            setBaError(null);
            createBoundedAgent.mutate();
          }}
          disabled={!companyId || createBoundedAgent.isPending || !baForm.delegateAgentId || !baForm.validUntil}
        >
          {createBoundedAgent.isPending ? "Creating…" : "Create approver"}
        </button>
        {baError && <p className="text-xs text-destructive mt-1">{baError}</p>}

        <h3 className="font-medium mt-4">Active approvers</h3>
        <ul className="list-disc pl-5">
          {activeBoundedAgents.map((g) => (
            <li key={g.id}>
              {g.delegateAgentId}{" "}
              <span className="text-xs text-muted-foreground">
                ({g.maxBand}, expires {new Date(g.validUntil).toLocaleDateString()})
              </span>{" "}
              <button onClick={() => revokeBoundedAgent.mutate(g.id)} disabled={revokeBoundedAgent.isPending}>
                Revoke
              </button>
            </li>
          ))}
          {activeBoundedAgents.length === 0 && (
            <p className="text-sm text-muted-foreground">No active approvers.</p>
          )}
        </ul>
      </section>
```

Note the band is fixed to `"low"` in `defaultBoundedAgentForm` (the ceiling) — no band selector is shown, since the server rejects anything higher.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/ui vitest run src/pages/Delegations.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/api/delegations.ts ui/src/pages/Delegations.tsx ui/src/pages/Delegations.test.tsx
git commit -m "feat(combo-05): 4b bounded-agent approvers section on /delegations page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Whole-branch verification (after Task 7)

- [ ] `pnpm --filter @paperclipai/db check:migrations` — journal ↔ files consistent through 0121.
- [ ] `pnpm -r typecheck` — all packages typecheck.
- [ ] `pnpm --filter @paperclipai/shared vitest run && pnpm --filter @paperclipai/server vitest run && pnpm --filter @paperclipai/ui vitest run` — green (ignore the known-flaky `ArtifactCard.test.tsx` date failures; confirm those artifact files are unchanged vs base).
- [ ] Manual sanity via the `verify`/`run` skill: board grants a manager-agent → agent approves a low-band item it didn't request → audit shows `bounded_agent`, agent actor, grant + onBehalfOf; agent self-approval → 422; no-grant agent → 403.

## Self-review notes (spec coverage)

- Resolver registration + never-above-band → Task 2 (register + hard-rule test).
- New grant table → Task 1; service → Task 3; gate incl. self-approval → Task 2.
- Agent-initiated decide via the 4a `actingUnderGrantId` seam + double-log attribution → Task 6.
- Board-only CRUD + `maxBand ≤ low` server rejection + dual-barrel validator → Tasks 4, 5.
- Management UI folded into `/delegations` → Task 7.
- Deferred items (above-band reach, dedicated agent endpoint, bulk) → not built, per spec.
