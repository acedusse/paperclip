/**
 * FILE: ui/src/components/AdmissionStatusLine.tsx
 * ABOUT: AdmissionStatusLine.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - AdmissionStatusLine.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: AdmissionStatusLine.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/AdmissionStatusLine.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { AdmissionStatus } from "../api/instanceSettings";

export function AdmissionStatusLine({
  status,
  isError,
}: {
  status: AdmissionStatus | undefined;
  isError: boolean;
}) {
  if (isError || !status) {
    return <span className="text-xs text-muted-foreground">status unavailable</span>;
  }
  const cap = status.cap === null ? "unlimited" : String(status.cap);
  return (
    <span className="text-xs text-muted-foreground">
      running {status.running} / cap {cap} · {status.queued} queued
    </span>
  );
}
// [END: module]
