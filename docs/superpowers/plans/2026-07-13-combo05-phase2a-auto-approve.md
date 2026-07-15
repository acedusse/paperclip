# Combo-05 Phase 2a — Auto-Approve Policy Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator explicitly opt specific agents' low-risk work into being auto-approved on create, routed through the same authority resolver and decision-audit record human decisions use, with a legible "Auto-approved" badge on the approval detail.

**Architecture:** A new per-company `auto_approve_policies` allowlist table drives a pure matcher (`evaluateAutoApprove`) and a DB service (`autoApprovePolicyService`). On approval create, after the risk snapshot is computed, the route evaluates active policies; a match resolves the approval through the existing `approvalService.approve` path and writes a `recordDecision` audit tagged `method: "auto_policy"`. The resolver registers `auto_policy` while keeping the above-band hard rule as a backstop. Every failure mode is fail-safe: absent risk, thrown error, or band doubt leaves the item pending for a human.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), drizzle-orm + PostgreSQL, Express, zod (`@paperclipai/shared`), vitest + embedded-postgres for server tests, React + `react-dom/act` for UI tests.

## Global Constraints

- Language/module: TypeScript, ESM; **all relative imports use `.js` extensions**.
- Services are factory functions: `export function xService(db: Db) { return { ... } }`.
- Server DB tests use the embedded-postgres harness: `getEmbeddedPostgresTestSupport()` / `startEmbeddedPostgresTestDatabase()` from `server/src/__tests__/helpers/embedded-postgres.js`; guard the suite with `describeEmbeddedPostgres`.
- Pure (no-DB) tests are plain vitest files colocated as `*.test.ts`.
- Run a single test file: `pnpm exec vitest run <path>`. Full suite: `pnpm test`.
- Migrations live in `packages/db/src/migrations/` numbered `NNNN_name.sql`; next free number is **0112**. Hand-write raw SQL + a `meta/_journal.json` entry — **never run `drizzle-kit generate`** (the snapshot baseline is stale at 0098; see the Phase 1 plan). Mirror `0111_combo05_review_cockpit.sql`.
- All decision audit goes through `recordDecision(db, …)` (`server/src/services/approval-decision-audit.ts`), which wraps `logActivity`.
- **`AUTO_DECISION_MAX_BAND` is a locked constant = `"low"`.** A policy's `maxBand` may never exceed it (validated at create; enforced by `canDecide` at decision time).
- Risk bands + order: `RISK_BAND_ORDER = ["low","medium","high","critical"]` (exported from `approval-risk.ts`). `bandRank(b) = RISK_BAND_ORDER.indexOf(b)`.
- **Fail-safe rule:** an absent risk snapshot, any thrown error in the auto path, or any band doubt means the approval stays pending. Auto-approve may only ever *remove* items from the human queue that a human explicitly pre-authorized.
- **Do not conflate** `auto_approve_policies` (decision authority: whose work may be auto-approved) with the existing `trust-policy.ts` "low-trust review preset" (how a low-trust agent's *output* is gated). They are separate concerns; this plan touches only the former.
- Follow the existing file-header comment block convention when creating new files (see any `server/src/services/*.ts`).
- Auto-approved items become `approved` on create, so they never appear in the open-only triage queue — no triage changes in this plan.

---

## File Structure

**New:**
- `packages/db/src/schema/auto_approve_policies.ts` — the allowlist table + inferred types.
- `packages/db/src/migrations/0112_combo05_auto_approve_policies.sql` — hand-written migration.
- `server/src/services/auto-approve-policy.ts` — pure `evaluateAutoApprove` matcher + `autoApprovePolicyService(db)`.
- `server/src/routes/auto-approve-policies.ts` — board-only CRUD routes.
- `packages/shared/src/validators/auto-approve-policy.ts` — `autoApprovePolicySchema`.

**Modified:**
- `packages/db/src/schema/index.ts` — export the new table.
- `server/src/services/approval-risk.ts` — export `bandRank`, `hasSensitiveBoundary`, `impliedSpendFromApproval`; use the spend helper internally (no behavior change).
- `server/src/services/approval-authority.ts` — register `auto_policy`.
- `server/src/services/index.ts` — export `autoApprovePolicyService`, `evaluateAutoApprove`.
- `server/src/routes/approvals.ts` — on-create auto-approve wiring; `AUTO_DECISION_MAX_BAND` constant; `decidedVia` on `GET /approvals/:id`.
- `server/src/app.ts` — mount the CRUD route.
- `ui/src/api/approvals.ts` — add `decidedVia` to the `Approval` type.
- `ui/src/pages/ApprovalDetail.tsx` — render the "Auto-approved" badge.

---

### Task 1: DB schema — `auto_approve_policies` table + migration

**Files:**
- Create: `packages/db/src/schema/auto_approve_policies.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/migrations/0112_combo05_auto_approve_policies.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json`
- Test: `packages/db/src/__tests__/schema-auto-approve-policies.test.ts`

**Interfaces:**
- Produces: `autoApprovePolicies` drizzle table; type `AutoApprovePolicyRow = typeof autoApprovePolicies.$inferSelect`.

- [ ] **Step 1: Write the schema**

`packages/db/src/schema/auto_approve_policies.ts`:

```ts
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const autoApprovePolicies = pgTable(
  "auto_approve_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    approvalType: text("approval_type").notNull(),
    maxBand: text("max_band").notNull(), // low | medium | high | critical — must be ≤ AUTO_DECISION_MAX_BAND
    maxSpendCents: integer("max_spend_cents").notNull().default(0),
    requireNoSecrets: boolean("require_no_secrets").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyActiveIdx: index("auto_approve_policies_company_active_idx").on(table.companyId, table.isActive),
    companyAgentTypeActiveUniqueIdx: uniqueIndex("auto_approve_policies_company_agent_type_active_unique_idx").on(
      table.companyId,
      table.agentId,
      table.approvalType,
      table.isActive,
    ),
  }),
);

export type AutoApprovePolicyRow = typeof autoApprovePolicies.$inferSelect;
```

If `agents` is not at `./agents.js`, find the agents table export with `grep -n "export const agents" packages/db/src/schema/*.ts` and import from that path.

- [ ] **Step 2: Export from the schema barrel**

In `packages/db/src/schema/index.ts`, add (match the file's existing `export * from` style):

```ts
export * from "./auto_approve_policies.js";
```

- [ ] **Step 3: Hand-write the migration**

Create `packages/db/src/migrations/0112_combo05_auto_approve_policies.sql`:

```sql
CREATE TABLE IF NOT EXISTS "auto_approve_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "approval_type" text NOT NULL,
  "max_band" text NOT NULL,
  "max_spend_cents" integer DEFAULT 0 NOT NULL,
  "require_no_secrets" boolean DEFAULT true NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_approve_policies_company_active_idx" ON "auto_approve_policies" ("company_id","is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auto_approve_policies_company_agent_type_active_unique_idx" ON "auto_approve_policies" ("company_id","agent_id","approval_type","is_active");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_approve_policies" ADD CONSTRAINT "auto_approve_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_approve_policies" ADD CONSTRAINT "auto_approve_policies_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
```

- [ ] **Step 4: Register the journal entry**

Append to the `entries` array in `packages/db/src/migrations/meta/_journal.json`, immediately after the `idx: 111` entry (copy the exact shape of the 111 entry; only `idx`, `when`, and `tag` change):

```json
    {
      "idx": 112,
      "version": "7",
      "when": 1784000000000,
      "tag": "0112_combo05_auto_approve_policies",
      "breakpoints": true
    }
```

- [ ] **Step 5: Write a schema smoke test**

`packages/db/src/__tests__/schema-auto-approve-policies.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { autoApprovePolicies } from "../schema/index.js";

describe("auto_approve_policies schema", () => {
  it("exposes the auto_approve_policies table", () => {
    expect(autoApprovePolicies).toBeDefined();
  });
});
```

- [ ] **Step 6: Verify migration numbering + run test**

Run: `pnpm --filter @paperclipai/db run check:migrations`
Expected: PASS (no numbering gaps/dupes).
Run: `pnpm exec vitest run packages/db/src/__tests__/schema-auto-approve-policies.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/auto_approve_policies.ts packages/db/src/schema/index.ts \
  packages/db/src/migrations/0112_combo05_auto_approve_policies.sql packages/db/src/migrations/meta/_journal.json \
  packages/db/src/__tests__/schema-auto-approve-policies.test.ts
git commit -m "feat(combo-05): auto_approve_policies schema and migration"
```

---

### Task 2: Export reusable helpers from `approval-risk.ts`

The matcher (Task 3) needs three things the risk module already computes privately: `bandRank`, sensitive-boundary detection, and implied-spend derivation. Export them and route the risk service through the spend helper — a pure refactor with no behavior change.

**Files:**
- Modify: `server/src/services/approval-risk.ts`
- Test: `server/src/services/approval-risk.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  export function bandRank(b: RiskBand): number;                                  // RISK_BAND_ORDER.indexOf(b)
  export function hasSensitiveBoundary(a: { type: string; payload: Record<string, unknown> }): boolean;
  export function impliedSpendFromApproval(payload: Record<string, unknown>): number; // cents, 0 if none
  ```

- [ ] **Step 1: Extend the pure test with the new helpers**

Append to `server/src/services/approval-risk.test.ts`:

```ts
import { bandRank, hasSensitiveBoundary, impliedSpendFromApproval } from "./approval-risk.js";

describe("risk helpers", () => {
  it("ranks bands low<medium<high<critical", () => {
    expect(bandRank("low")).toBe(0);
    expect(bandRank("critical")).toBe(3);
    expect(bandRank("high")).toBeGreaterThan(bandRank("medium"));
  });
  it("flags sensitive type or sensitive payload key", () => {
    expect(hasSensitiveBoundary({ type: "hire_agent", payload: {} })).toBe(true);
    expect(hasSensitiveBoundary({ type: "work_product", payload: { secretRef: "x" } })).toBe(true);
    expect(hasSensitiveBoundary({ type: "work_product", payload: {} })).toBe(false);
  });
  it("reads implied spend from budgetMonthlyCents, else 0", () => {
    expect(impliedSpendFromApproval({ budgetMonthlyCents: 500 })).toBe(500);
    expect(impliedSpendFromApproval({})).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/services/approval-risk.test.ts`
Expected: FAIL (helpers not exported).

- [ ] **Step 3: Export the helpers and refactor the spend read**

In `server/src/services/approval-risk.ts`:

Add after `RISK_BAND_ORDER`:
```ts
export function bandRank(b: RiskBand): number {
  return RISK_BAND_ORDER.indexOf(b);
}
```

Change the private `detectSensitiveBoundaries` to stay as-is, and add an exported predicate beside it:
```ts
export function hasSensitiveBoundary(a: { type: string; payload: Record<string, unknown> }): boolean {
  return detectSensitiveBoundaries(a).length > 0;
}

export function impliedSpendFromApproval(payload: Record<string, unknown>): number {
  return typeof payload?.budgetMonthlyCents === "number" ? (payload.budgetMonthlyCents as number) : 0;
}
```

Then in `approvalRiskService(db).computeAndPersist`, replace the inline spend derivation:
```ts
const impliedSpendCents = typeof approval.payload?.budgetMonthlyCents === "number"
  ? (approval.payload.budgetMonthlyCents as number) : undefined;
```
with:
```ts
const impliedSpendCents = impliedSpendFromApproval(approval.payload);
```
(The risk signal treats `0` and `undefined` identically — `const c = ctx.impliedSpendCents ?? 0` — so this is behavior-preserving.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/services/approval-risk.test.ts`
Expected: PASS (existing risk cases + new helper cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/approval-risk.ts server/src/services/approval-risk.test.ts
git commit -m "feat(combo-05): export bandRank/sensitivity/spend helpers from risk module"
```

---

### Task 3: Pure auto-approve matcher

**Files:**
- Create: `server/src/services/auto-approve-policy.ts`
- Test: `server/src/services/auto-approve-policy.test.ts`

**Interfaces:**
- Consumes: `RiskBand`, `bandRank` from `./approval-risk.js`.
- Produces:
  ```ts
  export type AutoApprovePolicy = {
    id: string; agentId: string; approvalType: string;
    maxBand: RiskBand; maxSpendCents: number; requireNoSecrets: boolean;
  };
  export type AutoApproveContext = {
    approval: { type: string; requestedByAgentId: string | null; payload: Record<string, unknown> };
    risk: { band: RiskBand; reasons: string[] } | null;
    impliedSpendCents: number;
    hasSecretsOrSensitive: boolean;
  };
  export function evaluateAutoApprove(ctx: AutoApproveContext, policies: AutoApprovePolicy[]):
    { matched: AutoApprovePolicy | null; reasons: string[] };
  ```

- [ ] **Step 1: Write the failing test**

`server/src/services/auto-approve-policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluateAutoApprove, type AutoApprovePolicy, type AutoApproveContext } from "./auto-approve-policy.js";

const policy: AutoApprovePolicy = {
  id: "p1", agentId: "agent-1", approvalType: "work_product",
  maxBand: "low", maxSpendCents: 100, requireNoSecrets: true,
};
const baseCtx: AutoApproveContext = {
  approval: { type: "work_product", requestedByAgentId: "agent-1", payload: {} },
  risk: { band: "low", reasons: [] },
  impliedSpendCents: 0,
  hasSecretsOrSensitive: false,
};

describe("evaluateAutoApprove", () => {
  it("matches when every condition holds", () => {
    expect(evaluateAutoApprove(baseCtx, [policy]).matched?.id).toBe("p1");
  });
  it("never matches when risk snapshot is absent", () => {
    expect(evaluateAutoApprove({ ...baseCtx, risk: null }, [policy]).matched).toBeNull();
  });
  it("never matches above the policy band", () => {
    expect(evaluateAutoApprove({ ...baseCtx, risk: { band: "medium", reasons: [] } }, [policy]).matched).toBeNull();
  });
  it("does not match a different agent", () => {
    expect(evaluateAutoApprove({ ...baseCtx, approval: { ...baseCtx.approval, requestedByAgentId: "agent-2" } }, [policy]).matched).toBeNull();
  });
  it("does not match a different type", () => {
    expect(evaluateAutoApprove({ ...baseCtx, approval: { ...baseCtx.approval, type: "hire_agent" } }, [policy]).matched).toBeNull();
  });
  it("does not match over the spend cap", () => {
    expect(evaluateAutoApprove({ ...baseCtx, impliedSpendCents: 500 }, [policy]).matched).toBeNull();
  });
  it("does not match when secrets present and requireNoSecrets", () => {
    expect(evaluateAutoApprove({ ...baseCtx, hasSecretsOrSensitive: true }, [policy]).matched).toBeNull();
  });
  it("returns the first matching policy deterministically", () => {
    const p2: AutoApprovePolicy = { ...policy, id: "p2" };
    expect(evaluateAutoApprove(baseCtx, [policy, p2]).matched?.id).toBe("p1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/services/auto-approve-policy.test.ts`
Expected: FAIL (module/function missing).

- [ ] **Step 3: Implement the matcher**

`server/src/services/auto-approve-policy.ts` (pure section; the DB service is added in Task 4 — leave the file exporting just the matcher for now, with the standard file-header block):

```ts
import { bandRank, type RiskBand } from "./approval-risk.js";

export type AutoApprovePolicy = {
  id: string; agentId: string; approvalType: string;
  maxBand: RiskBand; maxSpendCents: number; requireNoSecrets: boolean;
};

export type AutoApproveContext = {
  approval: { type: string; requestedByAgentId: string | null; payload: Record<string, unknown> };
  risk: { band: RiskBand; reasons: string[] } | null;
  impliedSpendCents: number;
  hasSecretsOrSensitive: boolean;
};

export function evaluateAutoApprove(
  ctx: AutoApproveContext,
  policies: AutoApprovePolicy[],
): { matched: AutoApprovePolicy | null; reasons: string[] } {
  if (!ctx.risk) return { matched: null, reasons: ["no risk snapshot — human decides"] };
  for (const p of policies) {
    if (p.approvalType !== ctx.approval.type) continue;
    if (p.agentId !== ctx.approval.requestedByAgentId) continue;
    if (bandRank(ctx.risk.band) > bandRank(p.maxBand)) continue;
    if (ctx.impliedSpendCents > p.maxSpendCents) continue;
    if (p.requireNoSecrets && ctx.hasSecretsOrSensitive) continue;
    return {
      matched: p,
      reasons: [
        `agent ${p.agentId} allowlisted for ${p.approvalType}`,
        `band ${ctx.risk.band} ≤ ${p.maxBand}`,
        `spend ${ctx.impliedSpendCents} ≤ ${p.maxSpendCents}`,
      ],
    };
  }
  return { matched: null, reasons: ["no active policy matched"] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/services/auto-approve-policy.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/auto-approve-policy.ts server/src/services/auto-approve-policy.test.ts
git commit -m "feat(combo-05): pure auto-approve policy matcher"
```

---

### Task 4: `autoApprovePolicyService` — CRUD + `evaluateForApproval`

**Files:**
- Modify: `server/src/services/auto-approve-policy.ts` (append the service)
- Modify: `server/src/services/index.ts` (export)
- Test: `server/src/__tests__/auto-approve-policy-service.test.ts`

**Interfaces:**
- Consumes: `approvals`, `approvalRisk`, `autoApprovePolicies` tables; `evaluateAutoApprove` (Task 3); `hasSensitiveBoundary`, `impliedSpendFromApproval` (Task 2); `RiskBand`.
- Produces:
  ```ts
  export function autoApprovePolicyService(db: Db): {
    listActive(companyId: string): Promise<AutoApprovePolicy[]>;
    create(companyId: string, input: { agentId: string; approvalType: string; maxBand: RiskBand; maxSpendCents: number; requireNoSecrets: boolean; createdByUserId?: string | null }): Promise<AutoApprovePolicyRow>;
    update(companyId: string, id: string, patch: Partial<{ maxBand: RiskBand; maxSpendCents: number; requireNoSecrets: boolean; isActive: boolean; updatedByUserId: string | null }>): Promise<AutoApprovePolicyRow | null>;
    deactivate(companyId: string, id: string): Promise<void>;
    evaluateForApproval(approvalId: string): Promise<{ matched: AutoApprovePolicy | null; reasons: string[] }>;
  };
  ```

- [ ] **Step 1: Write the failing test**

`server/src/__tests__/auto-approve-policy-service.test.ts` (embedded-postgres harness — mirror the header of `server/src/__tests__/approval-risk-service.test.ts`). Seed a company, an agent, an approval (`type: "work_product"`, `requestedByAgentId` = the agent, small/empty payload), and a persisted `approval_risk` row with `band: "low"`. Then:

```ts
const svc = autoApprovePolicyService(db);

// no policy → no match
expect((await svc.evaluateForApproval(approvalId)).matched).toBeNull();

// active matching policy → match
const p = await svc.create(companyId, { agentId, approvalType: "work_product", maxBand: "low", maxSpendCents: 100, requireNoSecrets: true });
expect((await svc.evaluateForApproval(approvalId)).matched?.id).toBe(p.id);

// listActive returns it
expect((await svc.listActive(companyId)).some((x) => x.id === p.id)).toBe(true);

// deactivate → no match, not listed
await svc.deactivate(companyId, p.id);
expect((await svc.evaluateForApproval(approvalId)).matched).toBeNull();
expect((await svc.listActive(companyId)).some((x) => x.id === p.id)).toBe(false);

// wrong agent policy → no match
await svc.create(companyId, { agentId: otherAgentId, approvalType: "work_product", maxBand: "low", maxSpendCents: 100, requireNoSecrets: true });
expect((await svc.evaluateForApproval(approvalId)).matched).toBeNull();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/auto-approve-policy-service.test.ts`
Expected: FAIL (service missing).

- [ ] **Step 3: Append the service to `auto-approve-policy.ts`**

```ts
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvals, approvalRisk, autoApprovePolicies, type AutoApprovePolicyRow } from "@paperclipai/db";
import { hasSensitiveBoundary, impliedSpendFromApproval } from "./approval-risk.js";

function toPolicy(row: AutoApprovePolicyRow): AutoApprovePolicy {
  return {
    id: row.id, agentId: row.agentId, approvalType: row.approvalType,
    maxBand: row.maxBand as RiskBand, maxSpendCents: row.maxSpendCents, requireNoSecrets: row.requireNoSecrets,
  };
}

export function autoApprovePolicyService(db: Db) {
  async function listActiveRows(companyId: string): Promise<AutoApprovePolicyRow[]> {
    return db
      .select()
      .from(autoApprovePolicies)
      .where(and(eq(autoApprovePolicies.companyId, companyId), eq(autoApprovePolicies.isActive, true)))
      .orderBy(asc(autoApprovePolicies.createdAt));
  }

  return {
    listActive: async (companyId: string) => (await listActiveRows(companyId)).map(toPolicy),

    create: async (
      companyId: string,
      input: { agentId: string; approvalType: string; maxBand: RiskBand; maxSpendCents: number; requireNoSecrets: boolean; createdByUserId?: string | null },
    ): Promise<AutoApprovePolicyRow> => {
      return db
        .insert(autoApprovePolicies)
        .values({
          companyId, agentId: input.agentId, approvalType: input.approvalType,
          maxBand: input.maxBand, maxSpendCents: input.maxSpendCents, requireNoSecrets: input.requireNoSecrets,
          createdByUserId: input.createdByUserId ?? null, updatedByUserId: input.createdByUserId ?? null,
        })
        .returning()
        .then((r) => r[0]);
    },

    update: async (
      companyId: string,
      id: string,
      patch: Partial<{ maxBand: RiskBand; maxSpendCents: number; requireNoSecrets: boolean; isActive: boolean; updatedByUserId: string | null }>,
    ): Promise<AutoApprovePolicyRow | null> => {
      return db
        .update(autoApprovePolicies)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(autoApprovePolicies.companyId, companyId), eq(autoApprovePolicies.id, id)))
        .returning()
        .then((r) => r[0] ?? null);
    },

    deactivate: async (companyId: string, id: string): Promise<void> => {
      await db
        .update(autoApprovePolicies)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(autoApprovePolicies.companyId, companyId), eq(autoApprovePolicies.id, id)));
    },

    async evaluateForApproval(approvalId: string) {
      const approval = await db.select().from(approvals).where(eq(approvals.id, approvalId)).then((r) => r[0] ?? null);
      if (!approval) return { matched: null, reasons: ["approval not found"] };

      const riskRow = await db
        .select({ band: approvalRisk.band, reasons: approvalRisk.reasons })
        .from(approvalRisk)
        .where(eq(approvalRisk.approvalId, approvalId))
        .then((r) => r[0] ?? null);

      const policies = (await listActiveRows(approval.companyId)).map(toPolicy);
      return evaluateAutoApprove(
        {
          approval: { type: approval.type, requestedByAgentId: approval.requestedByAgentId ?? null, payload: approval.payload },
          risk: riskRow ? { band: riskRow.band as RiskBand, reasons: riskRow.reasons ?? [] } : null,
          impliedSpendCents: impliedSpendFromApproval(approval.payload),
          hasSecretsOrSensitive: hasSensitiveBoundary({ type: approval.type, payload: approval.payload }),
        },
        policies,
      );
    },
  };
}
```

Confirm `approvals` has `requestedByAgentId` (it does — `approvals_company_status_type_idx` file). If the column name differs, adjust here and in the matcher context mapping.

- [ ] **Step 4: Export from the services barrel**

In `server/src/services/index.ts` add:
```ts
export { evaluateAutoApprove, autoApprovePolicyService, type AutoApprovePolicy } from "./auto-approve-policy.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/auto-approve-policy-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/auto-approve-policy.ts server/src/services/index.ts server/src/__tests__/auto-approve-policy-service.test.ts
git commit -m "feat(combo-05): auto-approve policy service (CRUD + evaluateForApproval)"
```

---

### Task 5: Register `auto_policy` in the authority resolver

**Files:**
- Modify: `server/src/services/approval-authority.ts`
- Test: `server/src/services/approval-authority.test.ts` (extend)

**Interfaces:**
- Consumes/Produces: unchanged `canDecide` signature; `auto_policy` becomes a registered method.

- [ ] **Step 1: Extend the failing test**

Append to `server/src/services/approval-authority.test.ts`:

```ts
describe("canDecide — auto_policy (phase 2a)", () => {
  it("allows auto_policy at or below the max band", () => {
    expect(canDecide({ band: "low", method: "auto_policy", autoDecisionMaxBand: "low" }).allow).toBe(true);
  });
  it("still denies auto_policy above the max band", () => {
    const r = canDecide({ band: "medium", method: "auto_policy", autoDecisionMaxBand: "low" });
    expect(r.allow).toBe(false);
    expect(r.deny).toMatch(/band/i);
  });
  it("leaves explicit_human unaffected", () => {
    expect(canDecide({ band: "critical", method: "explicit_human" }).allow).toBe(true);
  });
});
```

Note: the Phase-1 test `"denies every non-registered method in phase 1"` currently includes `auto_policy`. Update that test's method list to drop `auto_policy` (it is now registered): change it to iterate `["delegated_human", "coverage_escalation", "bounded_agent"]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/services/approval-authority.test.ts`
Expected: FAIL (auto_policy still denied by REGISTERED check).

- [ ] **Step 3: Register the method**

In `server/src/services/approval-authority.ts`, change:
```ts
const REGISTERED: ReadonlySet<DecisionMethod> = new Set(["explicit_human"]); // phase 1
```
to:
```ts
const REGISTERED: ReadonlySet<DecisionMethod> = new Set(["explicit_human", "auto_policy"]); // phase 2a
```
Leave `NON_HUMAN` unchanged — `auto_policy` stays in it, so the above-band hard rule still fires first.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/services/approval-authority.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/approval-authority.ts server/src/services/approval-authority.test.ts
git commit -m "feat(combo-05): register auto_policy in authority resolver"
```

---

### Task 6: Shared validator `autoApprovePolicySchema`

**Files:**
- Create: `packages/shared/src/validators/auto-approve-policy.ts`
- Modify: `packages/shared/src/validators/index.ts` (export)
- Test: `packages/shared/src/validators/auto-approve-policy.test.ts`

**Interfaces:**
- Produces: `createAutoApprovePolicySchema`, `updateAutoApprovePolicySchema`, `AUTO_DECISION_MAX_BAND`, type `CreateAutoApprovePolicy`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/validators/auto-approve-policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createAutoApprovePolicySchema } from "./auto-approve-policy.js";

describe("createAutoApprovePolicySchema", () => {
  const base = { agentId: "11111111-1111-1111-1111-111111111111", approvalType: "work_product", maxBand: "low", maxSpendCents: 0, requireNoSecrets: true };
  it("accepts a valid low-band policy", () => {
    expect(createAutoApprovePolicySchema.parse(base).maxBand).toBe("low");
  });
  it("rejects a band above the locked max", () => {
    expect(() => createAutoApprovePolicySchema.parse({ ...base, maxBand: "medium" })).toThrow();
  });
  it("rejects negative spend", () => {
    expect(() => createAutoApprovePolicySchema.parse({ ...base, maxSpendCents: -1 })).toThrow();
  });
  it("rejects a non-uuid agentId", () => {
    expect(() => createAutoApprovePolicySchema.parse({ ...base, agentId: "nope" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/validators/auto-approve-policy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the schema**

`packages/shared/src/validators/auto-approve-policy.ts`:

```ts
import { z } from "zod";

// Locked constant — a policy may never auto-decide above this band. Mirrored server-side
// as AUTO_DECISION_MAX_BAND; keep both in sync.
export const AUTO_DECISION_MAX_BAND = "low" as const;

// Bands at or below the locked max (RISK_BAND_ORDER prefix). Widen when the constant is raised.
const ALLOWED_POLICY_BANDS = ["low"] as const;

export const createAutoApprovePolicySchema = z.object({
  agentId: z.string().uuid(),
  approvalType: z.string().trim().min(1).max(120),
  maxBand: z.enum(ALLOWED_POLICY_BANDS),
  maxSpendCents: z.number().int().min(0),
  requireNoSecrets: z.boolean(),
});
export type CreateAutoApprovePolicy = z.infer<typeof createAutoApprovePolicySchema>;

export const updateAutoApprovePolicySchema = z.object({
  maxBand: z.enum(ALLOWED_POLICY_BANDS).optional(),
  maxSpendCents: z.number().int().min(0).optional(),
  requireNoSecrets: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAutoApprovePolicy = z.infer<typeof updateAutoApprovePolicySchema>;
```

- [ ] **Step 4: Export from the validators barrel**

In `packages/shared/src/validators/index.ts`, add (match the existing `export * from` style):
```ts
export * from "./auto-approve-policy.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/shared/src/validators/auto-approve-policy.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/validators/auto-approve-policy.ts packages/shared/src/validators/index.ts packages/shared/src/validators/auto-approve-policy.test.ts
git commit -m "feat(combo-05): auto-approve policy validators (band ≤ locked max)"
```

---

### Task 7: Board-only CRUD route + mount

**Files:**
- Create: `server/src/routes/auto-approve-policies.ts`
- Modify: `server/src/app.ts`
- Test: `server/src/__tests__/auto-approve-policy-routes.test.ts`

**Interfaces:**
- Consumes: `autoApprovePolicyService` (Task 4); `createAutoApprovePolicySchema`, `updateAutoApprovePolicySchema` (Task 6); `assertBoard`, `assertCompanyAccess`, `getActorInfo` from `./authz.js`; `validate` middleware.
- Produces routes: `GET/POST /companies/:companyId/auto-approve-policies`, `PATCH …/:id`.

- [ ] **Step 1: Write the failing test**

`server/src/__tests__/auto-approve-policy-routes.test.ts` (embedded-postgres, full app — mirror app+auth assembly from `server/src/__tests__/approval-triage-routes.test.ts`). Seed a company + agent. Then:

```ts
// create as board
const created = await request(app).post(`/api/companies/${companyId}/auto-approve-policies`)
  .set(boardAuthHeaders).send({ agentId, approvalType: "work_product", maxBand: "low", maxSpendCents: 0, requireNoSecrets: true });
expect(created.status).toBe(200);

// list
const list = await request(app).get(`/api/companies/${companyId}/auto-approve-policies`).set(boardAuthHeaders);
expect(list.body.some((p: any) => p.id === created.body.id)).toBe(true);

// non-board create → 403
const forbidden = await request(app).post(`/api/companies/${companyId}/auto-approve-policies`)
  .set(nonBoardAuthHeaders).send({ agentId, approvalType: "work_product", maxBand: "low", maxSpendCents: 0, requireNoSecrets: true });
expect(forbidden.status).toBe(403);

// band above the locked max → 422/400 (validation)
const bad = await request(app).post(`/api/companies/${companyId}/auto-approve-policies`)
  .set(boardAuthHeaders).send({ agentId, approvalType: "work_product", maxBand: "medium", maxSpendCents: 0, requireNoSecrets: true });
expect(bad.status).toBeGreaterThanOrEqual(400);
expect(bad.status).toBeLessThan(500);

// deactivate via PATCH
const patched = await request(app).patch(`/api/companies/${companyId}/auto-approve-policies/${created.body.id}`)
  .set(boardAuthHeaders).send({ isActive: false });
expect(patched.status).toBe(200);
```

(Use the same `boardAuthHeaders` / `nonBoardAuthHeaders` construction as the triage route test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/auto-approve-policy-routes.test.ts`
Expected: FAIL (route not mounted).

- [ ] **Step 3: Implement the route**

`server/src/routes/auto-approve-policies.ts`:

```ts
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { createAutoApprovePolicySchema, updateAutoApprovePolicySchema } from "@paperclipai/shared";
import { autoApprovePolicyService } from "../services/index.js";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function autoApprovePolicyRoutes(db: Db) {
  const router = Router();
  const svc = autoApprovePolicyService(db);

  router.get("/companies/:companyId/auto-approve-policies", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await svc.listActive(companyId));
  });

  router.post("/companies/:companyId/auto-approve-policies", validate(createAutoApprovePolicySchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const created = await svc.create(companyId, {
      agentId: req.body.agentId, approvalType: req.body.approvalType, maxBand: req.body.maxBand,
      maxSpendCents: req.body.maxSpendCents, requireNoSecrets: req.body.requireNoSecrets,
      createdByUserId: req.actor?.userId ?? null,
    });
    res.json(created);
  });

  router.patch("/companies/:companyId/auto-approve-policies/:id", validate(updateAutoApprovePolicySchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const updated = await svc.update(companyId, req.params.id as string, { ...req.body, updatedByUserId: req.actor?.userId ?? null });
    if (!updated) { res.status(404).json({ error: "Policy not found" }); return; }
    res.json(updated);
  });

  return router;
}
```

Verify the `validate` middleware import path with `grep -rn "export .*validate" server/src/middleware/`; if it differs, adjust. Verify `req.actor` shape matches how `routes/approvals.ts` reads `req.actor.userId`.

- [ ] **Step 4: Mount the route in `app.ts`**

Add the import near the other route imports and mount it on the `api` router (mirror `api.use(runChangesetRoutes(db))`):
```ts
import { autoApprovePolicyRoutes } from "./routes/auto-approve-policies.js";
// ...
api.use(autoApprovePolicyRoutes(db));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/auto-approve-policy-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/auto-approve-policies.ts server/src/app.ts server/src/__tests__/auto-approve-policy-routes.test.ts
git commit -m "feat(combo-05): board-only auto-approve policy CRUD routes"
```

---

### Task 8: Evaluate auto-approve on approval create

**Files:**
- Modify: `server/src/routes/approvals.ts`
- Test: `server/src/__tests__/approvals-auto-approve-routes.test.ts`

**Interfaces:**
- Consumes: `autoApprovePolicyService` (Task 4), `canDecide` (Task 5), `recordDecision` (Phase 1), `riskSvc.getSnapshot` (Phase 1).

- [ ] **Step 1: Write the failing test**

`server/src/__tests__/approvals-auto-approve-routes.test.ts` (embedded-postgres, full app). Seed a company + agent + an active policy (`work_product`, agent, `maxBand: low`, `maxSpendCents: 1000`, `requireNoSecrets: true`). Then:

```ts
// creating a matching low-risk approval auto-approves it
const created = await request(app).post(`/api/companies/${companyId}/approvals`)
  .set(boardAuthHeaders).send({ type: "work_product", requestedByAgentId: agentId, payload: {} });
expect(created.status).toBe(201); // or the code the existing create returns
expect(created.body.status).toBe("approved");

// exactly one approval.decision audit row with method auto_policy
const decisions = await db.select().from(activityLog)
  .where(and(eq(activityLog.entityId, created.body.id), eq(activityLog.action, "approval.decision")));
expect(decisions).toHaveLength(1);
expect((decisions[0].details as any).method).toBe("auto_policy");

// the pre-existing approval.approved domain event still fires (Phase-1 no regression)
const approvedEvents = await db.select().from(activityLog)
  .where(and(eq(activityLog.entityId, created.body.id), eq(activityLog.action, "approval.approved")));
expect(approvedEvents.length).toBeGreaterThanOrEqual(1);

// a hire_agent approval (sensitive type → higher band, requireNoSecrets fails) is NOT auto-approved
const sensitive = await request(app).post(`/api/companies/${companyId}/approvals`)
  .set(boardAuthHeaders).send({ type: "hire_agent", requestedByAgentId: agentId, payload: { budgetMonthlyCents: 50000 } });
expect(sensitive.body.status).toBe("pending");
```

Check the exact create status code and request body shape against the existing create test (`grep -rn "post(.*/approvals\`)" server/src/__tests__/` and an existing approval-create test) and align `expect(created.status)` accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/approvals-auto-approve-routes.test.ts`
Expected: FAIL (item stays pending; no auto_policy decision).

- [ ] **Step 3: Add the constant + service instance**

In `server/src/routes/approvals.ts`:
- Add imports from `../services/index.js`: `autoApprovePolicyService`, `canDecide`, `recordDecision` (some may already be imported for Phase 1 — do not duplicate). Import `RiskBand` type if needed.
- Near `const riskSvc = approvalRiskService(db);` add:
  ```ts
  const autoPolicySvc = autoApprovePolicyService(db);
  ```
- Near the top of the module (module scope), add the locked constant:
  ```ts
  const AUTO_DECISION_MAX_BAND = "low" as const;
  ```

- [ ] **Step 4: Wire evaluation after risk compute**

In the `POST /companies/:companyId/approvals` handler, immediately after the existing:
```ts
await riskSvc.computeAndPersist(approval.id).catch((err) => {
  logger.warn({ err, approvalId: approval.id }, "risk compute failed on approval create");
});
```
add:
```ts
// Phase 2a: attempt auto-approve. Best-effort — never blocks or fails the create.
const auto = await autoPolicySvc.evaluateForApproval(approval.id).catch((err) => {
  logger.warn({ err, approvalId: approval.id }, "auto-approve evaluation failed");
  return { matched: null as null };
});
if (auto.matched) {
  const risk = await riskSvc.getSnapshot(approval.id);
  const gate = canDecide({ band: auto.matched.maxBand, method: "auto_policy", autoDecisionMaxBand: AUTO_DECISION_MAX_BAND });
  if (gate.allow) {
    try {
      const { applied } = await svc.approve(approval.id, "auto_policy", null);
      if (applied) {
        await recordDecision(db, {
          approvalId: approval.id, companyId: approval.companyId,
          actor: { actorType: "system", actorId: "auto_policy" },
          method: "auto_policy", outcome: "approved",
          risk: risk ? { score: risk.score, band: risk.band as RiskBand } : null,
          note: `auto-approved by policy ${auto.matched.id}`,
        });
      }
    } catch (err) {
      logger.warn({ err, approvalId: approval.id }, "auto-approve failed; leaving pending");
    }
  }
}
```

Then, so the response reflects the auto-decision, re-read the approval before responding. Find where the handler currently sends the created approval (e.g. `res.status(201).json(approval)`), and replace `approval` in that response with a fresh read:
```ts
const finalApproval = (await svc.getById(approval.id)) ?? approval;
res.status(201).json(finalApproval); // keep the existing status code
```
(Match the existing status code and any response wrapper — do not change either; only swap the stale `approval` object for `finalApproval`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/approvals-auto-approve-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Regression-check existing approval tests**

Run: `pnpm exec vitest run server/src/__tests__/ -t approval`
Expected: existing approval + triage + authority-audit tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/approvals.ts server/src/__tests__/approvals-auto-approve-routes.test.ts
git commit -m "feat(combo-05): auto-approve matching approvals on create"
```

---

### Task 9: Expose `decidedVia` on the single-approval read

**Files:**
- Modify: `server/src/routes/approvals.ts` (`GET /approvals/:id`)
- Test: `server/src/__tests__/approvals-auto-approve-routes.test.ts` (extend Task 8's file)

**Interfaces:**
- Produces: `GET /approvals/:id` response gains `decidedVia: string | null` (the `method` of the latest `approval.decision` audit record).

- [ ] **Step 1: Extend the failing test**

Append to `server/src/__tests__/approvals-auto-approve-routes.test.ts`:

```ts
// the auto-approved item reports decidedVia
const detail = await request(app).get(`/api/approvals/${created.body.id}`).set(boardAuthHeaders);
expect(detail.status).toBe(200);
expect(detail.body.decidedVia).toBe("auto_policy");

// the still-pending sensitive item has no decision yet
const pendingDetail = await request(app).get(`/api/approvals/${sensitive.body.id}`).set(boardAuthHeaders);
expect(pendingDetail.body.decidedVia).toBeNull();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/approvals-auto-approve-routes.test.ts`
Expected: FAIL (`decidedVia` undefined).

- [ ] **Step 3: Add the derived field to the GET handler**

In `server/src/routes/approvals.ts`, in `router.get("/approvals/:id", …)`, after the approval is loaded and access asserted, look up the latest decision and attach it. Add the imports `activityLog`, `and`, `desc`, `eq` from their existing sources (drizzle ops likely already imported; `activityLog` from `@paperclipai/db`):

```ts
const lastDecision = await db
  .select({ details: activityLog.details })
  .from(activityLog)
  .where(and(eq(activityLog.entityId, approval.id), eq(activityLog.action, "approval.decision")))
  .orderBy(desc(activityLog.createdAt))
  .limit(1)
  .then((r) => r[0] ?? null);
const decidedVia = (lastDecision?.details as { method?: string } | null)?.method ?? null;
res.json({ ...approval, decidedVia });
```

Match the existing response shape — if the handler currently does `res.json(approval)`, replace it with the spread above; if it wraps the approval, add `decidedVia` alongside. Confirm the activity-log table export name with `grep -n "export const activityLog" packages/db/src/schema/*.ts` and the `createdAt` column name.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run server/src/__tests__/approvals-auto-approve-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/approvals.ts server/src/__tests__/approvals-auto-approve-routes.test.ts
git commit -m "feat(combo-05): expose decidedVia on approval detail read"
```

---

### Task 10: UI — "Auto-approved" badge on `ApprovalDetail`

**Files:**
- Modify: `ui/src/api/approvals.ts` (add `decidedVia` to the `Approval` type)
- Modify: `ui/src/pages/ApprovalDetail.tsx`
- Test: `ui/src/pages/ApprovalDetail.autoApprove.test.tsx`

**Interfaces:**
- Consumes: `approvalsApi.get(id)` returning `decidedVia` (Task 9).

- [ ] **Step 1: Add `decidedVia` to the `Approval` type**

In `ui/src/api/approvals.ts`, find the `Approval` type and add:
```ts
  decidedVia?: string | null;
```
(If `Approval` is imported from a shared types module rather than declared here, add the optional field there instead; `grep -n "decidedVia\|type Approval" ui/src/api/approvals.ts`.)

- [ ] **Step 2: Write the failing test**

`ui/src/pages/ApprovalDetail.autoApprove.test.tsx` — follow the repo UI-test convention (mirror `ui/src/pages/ApprovalDetail.changeset.test.tsx`: `// @vitest-environment jsdom` header, `IS_REACT_ACT_ENVIRONMENT = true`, render via `react-dom/client` `createRoot` inside `act(...)`, assert on the DOM). Mock `approvalsApi.get` to resolve an approval with `status: "approved"` and `decidedVia: "auto_policy"`; assert the rendered DOM contains "Auto-approved". Add a second render with `decidedVia: "explicit_human"` and assert "Auto-approved" is absent.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run ui/src/pages/ApprovalDetail.autoApprove.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Render the badge**

In `ui/src/pages/ApprovalDetail.tsx`, where the approval header/status renders, add:
```tsx
{approval?.decidedVia === "auto_policy" ? (
  <span className="badge badge--auto-approved" title="Auto-approved by policy">Auto-approved</span>
) : null}
```
Use the existing status/badge styling convention already present in the file for chips; if none exists, a plain `<span>` with the text is sufficient for the test and legibility.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run ui/src/pages/ApprovalDetail.autoApprove.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/api/approvals.ts ui/src/pages/ApprovalDetail.tsx ui/src/pages/ApprovalDetail.autoApprove.test.tsx
git commit -m "feat(combo-05): Auto-approved badge on approval detail"
```

---

### Task 11: Full-suite + typecheck gate

**Files:** none (verification only).

- [ ] **Step 1: Run the combo-05 Phase-2a suites together**

Run:
```bash
pnpm exec vitest run \
  packages/db/src/__tests__/schema-auto-approve-policies.test.ts \
  server/src/services/auto-approve-policy.test.ts \
  server/src/__tests__/auto-approve-policy-service.test.ts \
  server/src/services/approval-authority.test.ts \
  server/src/services/approval-risk.test.ts \
  packages/shared/src/validators/auto-approve-policy.test.ts \
  server/src/__tests__/auto-approve-policy-routes.test.ts \
  server/src/__tests__/approvals-auto-approve-routes.test.ts \
  ui/src/pages/ApprovalDetail.autoApprove.test.tsx
```
Expected: all PASS.

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm --filter @paperclipai/db typecheck && \
pnpm --filter @paperclipai/shared exec tsc --noEmit && \
pnpm --filter @paperclipai/server exec tsc --noEmit && \
pnpm --filter @paperclipai/ui exec tsc --noEmit
```
Expected: no type errors. (Confirm exact typecheck invocations against `package.json` scripts; the Phase-1 plan used `pnpm --filter @paperclipai/<pkg> exec tsc --noEmit`.)

- [ ] **Step 3: Full suite**

Run: `pnpm test`
Expected: full suite PASS (embedded-postgres suites run where supported; skipped only on unsupported hosts).

- [ ] **Step 4: Commit (if any snapshot/lockfile churn)**

```bash
git add -A
git commit -m "test(combo-05): Phase 2a full-suite + typecheck green" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- Data model `auto_approve_policies` (agent required, `0112` migration) → Task 1. ✔
- Reuse of Phase-1 risk helpers (`bandRank`, sensitivity, spend) → Task 2. ✔
- Pure matcher `evaluateAutoApprove` (all conditions; null-risk/above-band fail-safe; first-match) → Task 3. ✔
- DB service `autoApprovePolicyService` (listActive/create/update/deactivate/evaluateForApproval) → Task 4. ✔
- Resolver registers `auto_policy`; above-band hard rule preserved as backstop → Task 5. ✔
- Validator `autoApprovePolicySchema` with `maxBand ≤ AUTO_DECISION_MAX_BAND` → Task 6. ✔
- Board-only CRUD API + non-board 403 + band-too-high rejected → Task 7. ✔
- On-create evaluation after risk snapshot; reuse `approve` path; one `approval.decision` audit; Phase-1 `approval.approved` preserved; above-band/sensitive stays pending → Task 8. ✔
- `decidedVia` on `GET /approvals/:id` → Task 9. ✔
- "Auto-approved" badge on `ApprovalDetail` (not triage — auto-approved items leave the open queue) → Task 10. ✔
- Fail-safe error handling (absent risk, thrown eval, thrown approve → pending) → Tasks 3 (null-risk), 4 (not-found), 8 (`.catch` + try/catch). ✔
- Full-suite + typecheck gate → Task 11. ✔
- Explicitly out of scope (narration/digest, sweep, per-company max band, wildcard agent, editor UI, trust-stage) → not implemented. ✔

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Bounded implementer-judgement points, each with a concrete resolution command: the `agents` schema import path (Task 1 `grep`), the `validate` middleware path + `req.actor` shape (Task 7 `grep`), the create-response status code/shape (Task 8 `grep` against an existing create test), the `activityLog`/`createdAt` names (Task 9 `grep`), and the `Approval` type location (Task 10 `grep`).

**Type consistency:** `AutoApprovePolicy` (`{id, agentId, approvalType, maxBand, maxSpendCents, requireNoSecrets}`) defined in Task 3, produced by `autoApprovePolicyService` (Task 4), consumed by the matcher and the create wiring (Task 8). `AutoApproveContext` shape is identical between Task 3's matcher and Task 4's `evaluateForApproval` construction. `RiskBand`/`bandRank` defined/exported in Task 2, consumed in Tasks 3/4/8. `canDecide` signature unchanged (Task 5). `recordDecision` call shape matches Phase 1's signature (`actorType: "system"`, `method: "auto_policy"`). `decidedVia` produced in Task 9, typed in Task 10. `AUTO_DECISION_MAX_BAND = "low"` appears as a server route constant (Task 8) and a shared validator constant (Task 6) — kept in sync by the `ALLOWED_POLICY_BANDS` prefix; a comment in Task 6 flags the sync obligation.

**Locked-constant safety:** `maxBand` is bounded three times — validator enum (Task 6), matcher band check (Task 3), and `canDecide` backstop (Tasks 5, 8) — so no policy can auto-decide above `low` even if one layer is bypassed.
