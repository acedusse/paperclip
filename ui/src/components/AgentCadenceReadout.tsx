/**
 * FILE: ui/src/components/AgentCadenceReadout.tsx
 * ABOUT: AgentCadenceReadout.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - AgentCadenceReadout.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: AgentCadenceReadout.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/AgentCadenceReadout.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { formatDurationMs } from "../lib/utils";

export interface AgentCadenceReadoutProps {
  /** Combo-01 Phase 4A: consecutive empty timer-heartbeat count (0 when active). */
  heartbeatIdleStreak: number;
  /** Computed effective wake interval (seconds), already backed off if applicable. */
  effectiveHeartbeatIntervalSec: number;
  /** Whether runtimeConfig.heartbeat.idleBackoff.enabled is true for this agent. */
  enabled: boolean;
  /** The agent's plain configured heartbeat interval (seconds), pre-backoff. */
  intervalSec: number;
}

/**
 * Compact per-agent heartbeat cadence readout. Shows the backed-off interval
 * once an agent has gone idle (and idle backoff is enabled); otherwise shows
 * the plain configured interval so agents that haven't opted in read exactly
 * as they did before Combo-01 Phase 4A.
 */
export function AgentCadenceReadout({
  heartbeatIdleStreak,
  effectiveHeartbeatIntervalSec,
  enabled,
  intervalSec,
}: AgentCadenceReadoutProps) {
  if (enabled && heartbeatIdleStreak > 0) {
    return (
      <span className="text-xs text-muted-foreground">
        idle ×{heartbeatIdleStreak} → {formatDurationMs(effectiveHeartbeatIntervalSec * 1000)}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">{formatDurationMs(intervalSec * 1000)}</span>
  );
}
// [END: module]
