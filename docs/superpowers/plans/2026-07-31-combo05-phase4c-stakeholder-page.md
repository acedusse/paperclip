# Combo-05 Phase 4c — Stakeholder Transparency Page Implementation Plan

Spec: `docs/superpowers/specs/2026-07-31-combo05-phase4c-stakeholder-page-design.md`
Branch: `feat/combo05-phase4c-stakeholder-page` (off `master` @ `bc9ae2b`)

## Global constraints

- Migrations are **hand-written raw SQL** + a `meta/_journal.json` entry. Never `drizzle-kit generate`.
- New shared validators need **two** exports: `validators/index.ts` **and** the top-level
  `packages/shared/src/index.ts` barrel.
- Server tests use the embedded-postgres harness (`describeEmbeddedPostgres`).
- UI tests: no `@testing-library/react` — `// @vitest-environment jsdom`, `createRoot` + `act`.
- One commit per task. TDD: failing test first.

## Tasks

### Task 1 — `stakeholder_shares` table + migration `0122`
`packages/db/src/schema/stakeholder_shares.ts` + barrel export + raw SQL migration + journal entry.
All four `show_*` columns default `false`. Unique index on `token`.
**Done when:** `pnpm --filter @paperclipai/db check:migrations` passes and the table round-trips.

### Task 2 — Shared validators
`createStakeholderShareSchema`, `updateStakeholderShareSchema` in
`packages/shared/src/validators/stakeholder-share.ts`. Toggles optional, default `false`.
`expiresAt` optional ISO datetime. Exported from **both** barrels.
**Done when:** a server-side import from `@paperclipai/shared` resolves (not `undefined`).

### Task 3 — Pure gate + projection + narrator
`server/src/services/stakeholder-share-policy.ts`:
- `assertShareViewable(share, now)` → `{ok:true} | {ok:false, reason:"revoked"|"expired"}`
- `projectStakeholderPayload(share, signals)` → omits every disabled section
- `narrateStakeholder(signals)` → `{headline, sections, text}` (pure, mirrors `deterministicNarrator`)
**Done when:** unit tests cover active/revoked/expired/expires-exactly-now and each toggle off ⇒ key
absent, all off ⇒ empty sections.

### Task 4 — Signals gatherer (no-toggle-no-query)
`server/src/services/stakeholder-signals.ts`: `gatherStakeholderSignals(db, companyId, toggles)`
queries **only** for enabled toggles. Goals filtered to `company`/`team` level; shipped work =
issues with status `done`, capped and most-recent-first.
**Done when:** a test with all toggles false proves zero section queries were issued.

### Task 5 — `stakeholderShareService(db)`
`create` (random 32-byte base64url token), `list` (returns `tokenTail`, never full token),
`update`, `revoke`, `rotate`, `resolvePublic(token, now)` (gate → gather → project, else `null`).
**Done when:** embedded-postgres tests cover CRUD, rotate-invalidates-old, cross-company isolation.

### Task 6 — Routes
`server/src/routes/stakeholder-shares.ts`: five board-only management routes (`assertBoard` +
`assertCompanyAccess`) + public `GET /api/stakeholder/:token` returning 404 for
unknown/revoked/expired. Mounted in `app.ts`.
**Done when:** route tests cover board guards, 404-not-403 behaviour, and enabled-sections-only output.

### Task 7 — OpenAPI registration
Register all six operations; add the public route to `PUBLIC_OPERATIONS`, the five management routes
to `BOARD_ONLY_OPERATIONS`; add `stakeholder-shares.ts` to `apiPrefixes` in
`server/src/__tests__/openapi-routes.test.ts`.
**Done when:** `openapi-routes.test.ts` is green.

### Task 8 — UI
Public unauthenticated page `/s/:token` (outside `boardRoutes()`, no board chrome) + a "Stakeholder
sharing" management section on the existing `/digest` page.
**Done when:** a jsdom test renders the public page from a payload with a subset of sections enabled
and asserts the disabled ones are absent.

## Whole-branch verification (after Task 8)

`pnpm typecheck`, `pnpm test:run:serialized` (all 4 shards), targeted UI + server suites,
`pnpm --filter @paperclipai/db check:migrations`.

## Deferred (recorded in the spec)

Access logging to the audit path (operator-deselected 2026-07-31), passphrase, portfolio roll-up,
MRR/P&L fields.
