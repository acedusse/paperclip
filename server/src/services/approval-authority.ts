import { RISK_BAND_ORDER, type RiskBand } from "./approval-risk.js";

export type DecisionMethod = "explicit_human" | "delegated_human" | "coverage_escalation" | "bounded_agent" | "auto_policy";
export const METHOD_PRECEDENCE: readonly DecisionMethod[] = ["explicit_human", "delegated_human", "coverage_escalation", "bounded_agent", "auto_policy"];

const REGISTERED: ReadonlySet<DecisionMethod> = new Set([
  "explicit_human",
  "delegated_human",
  "coverage_escalation",
  "bounded_agent",
  "auto_policy",
]); // phase 2a + 4a + 4b
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
