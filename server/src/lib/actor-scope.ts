/**
 * FILE: server/src/lib/actor-scope.ts
 * ABOUT: actor-scope.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - actor-scope.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: Name the actor sources that are company-scoped by contract, in one dependency-free place.
// PSEUDOCODE: 1. Define the source set. 2. Export it.
// JSON_FLOW: {"file": "server/src/lib/actor-scope.ts", "imports": "none", "exports": "COMPANY_SCOPED_ACTOR_SOURCES"}
// ==========================================
// [START: module]

/**
 * Actor sources that are company-scoped by contract: whatever the underlying user can do elsewhere in
 * the instance, an actor arriving through one of these may never be elevated to instance admin. Kept as
 * a set rather than a chain of `!==` so adding the next such source is one line in one place — the
 * `telegram_miniapp` hole existed precisely because the rule read as a cloud_tenant special case.
 *
 * It lives in `lib/` rather than beside its first consumer because both the authorization service and
 * the route layer need it, and neither should have to import the other to ask the question. Sixty test
 * files mock the services barrel; routing this constant through that barrel would make every one of
 * them responsible for a rule they do not exercise.
 */
export const COMPANY_SCOPED_ACTOR_SOURCES: ReadonlySet<string> = new Set([
  "cloud_tenant",
  "telegram_miniapp",
]);
// [END: module]
