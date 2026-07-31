/**
 * FILE: packages/shared/src/types/company-preflight.ts
 * ABOUT: Wire/domain types for the Combo-10 company preflight (dry-run estimator).
 *
 * SECTIONS:
 *   [TAG: module] - company-preflight.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: Launch-readiness findings for a company, before the operator hits go.
// PSEUDOCODE: 1. Define finding vocabulary. 2. Define finding. 3. Define report.
// JSON_FLOW: {"file": "packages/shared/src/types/company-preflight.ts", "imports": "none", "exports": "PreflightFinding, PreflightReport"}
// ==========================================
// [START: module]

/**
 * Mirrors the `AdapterEnvironmentCheck` vocabulary in `agent.ts` — operators
 * already read `code`/`level`/`message`/`hint` on the adapter test screen, so
 * preflight reuses the shape rather than inventing a second one.
 */
export type PreflightLevel = "info" | "warn" | "error";

export type PreflightCode =
  /** No agent is in a state that can actually be invoked. */
  | "no_invokable_agents"
  /** An agent's reporting chain is cyclic or broken. */
  | "org_chain_invalid"
  /** An agent is bound to an adapter that is not registered or is disabled. */
  | "adapter_unavailable"
  /** A required secret binding has no readable version. */
  | "required_secret_unbound"
  /** No active budget policy — spend is unbounded. */
  | "no_budget_policy"
  /** The remaining budget cannot cover even one run at observed rates. */
  | "budget_below_one_run"
  /** No cost history yet, so spend projection is unavailable. */
  | "no_cost_history"
  /** An invokable agent has nothing assigned to it. */
  | "agent_without_work"
  /** A check threw; surfaced rather than failing the whole report. */
  | "check_failed";

export interface PreflightFinding {
  code: PreflightCode;
  level: PreflightLevel;
  message: string;
  /** The concrete fix. Required — a finding the operator cannot act on is noise. */
  hint: string;
  agentIds: string[];
}

export interface PreflightReport {
  companyId: string;
  generatedAt: string;
  /** `fail` if any error, `warn` if any warning, else `pass`. */
  status: "pass" | "warn" | "fail";
  findings: PreflightFinding[];
}
// [END: module]
