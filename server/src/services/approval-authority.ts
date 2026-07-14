import { RISK_BAND_ORDER, type RiskBand } from "./approval-risk.js";

export type DecisionMethod = "explicit_human" | "delegated_human" | "coverage_escalation" | "bounded_agent" | "auto_policy";
export const METHOD_PRECEDENCE: readonly DecisionMethod[] = ["explicit_human", "delegated_human", "coverage_escalation", "bounded_agent", "auto_policy"];

const REGISTERED: ReadonlySet<DecisionMethod> = new Set(["explicit_human", "auto_policy"]); // phase 2a
const NON_HUMAN: ReadonlySet<DecisionMethod> = new Set(["bounded_agent", "auto_policy"]);

function bandRank(b: RiskBand): number { return RISK_BAND_ORDER.indexOf(b); }

export function canDecide(input: { band: RiskBand; method: DecisionMethod; autoDecisionMaxBand?: RiskBand }): { allow: boolean; deny?: string } {
  const maxBand = input.autoDecisionMaxBand ?? "low";
  // Hard rule first, so it holds even for methods that later become registered.
  if (NON_HUMAN.has(input.method) && bandRank(input.band) > bandRank(maxBand)) {
    return { allow: false, deny: `method ${input.method} may not decide items above band ${maxBand}` };
  }
  if (!REGISTERED.has(input.method)) {
    return { allow: false, deny: `decision method ${input.method} is not enabled` };
  }
  return { allow: true };
}
