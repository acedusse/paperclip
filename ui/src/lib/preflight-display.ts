/**
 * FILE: ui/src/lib/preflight-display.ts
 * ABOUT: Presentation helpers for the Combo-10 preflight panel.
 *
 * SECTIONS:
 *   [TAG: module] - preflight-display.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: Map preflight status/levels to labels and classes, testable in isolation.
// PSEUDOCODE: 1. Map status to summary. 2. Map level to badge. 3. Group findings.
// JSON_FLOW: {"file": "ui/src/lib/preflight-display.ts", "imports": "shared types", "exports": "statusSummary, levelBadgeClass, groupFindingsByLevel"}
// ==========================================
// [START: module]
import type { PreflightFinding, PreflightLevel, PreflightReport } from "@paperclipai/shared";

export interface StatusSummary {
  label: string;
  detail: string;
  /** Tailwind classes for the traffic-light dot. */
  dotClass: string;
  /** True when launching now is expected to fail. */
  blocking: boolean;
}

export function statusSummary(report: PreflightReport | undefined): StatusSummary {
  if (!report) {
    return { label: "Checking…", detail: "Running preflight checks.", dotClass: "bg-muted-foreground/40", blocking: false };
  }

  const errors = report.findings.filter((f) => f.level === "error").length;
  const warnings = report.findings.filter((f) => f.level === "warn").length;

  if (report.status === "fail") {
    return {
      label: "Not ready to launch",
      detail: `${errors} blocking ${errors === 1 ? "problem" : "problems"} must be fixed first.`,
      dotClass: "bg-red-500",
      blocking: true,
    };
  }
  if (report.status === "warn") {
    return {
      label: "Ready, with warnings",
      detail: `${warnings} ${warnings === 1 ? "thing is" : "things are"} worth checking before you launch.`,
      dotClass: "bg-amber-400",
      blocking: false,
    };
  }
  return {
    label: "Ready to launch",
    detail: "No configuration problems found.",
    dotClass: "bg-emerald-500",
    blocking: false,
  };
}

export function levelBadgeClass(level: PreflightLevel): string {
  switch (level) {
    case "error":
      return "bg-red-500/10 text-red-600 dark:text-red-400";
    case "warn":
      return "bg-amber-400/10 text-amber-700 dark:text-amber-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function levelLabel(level: PreflightLevel): string {
  switch (level) {
    case "error":
      return "Blocking";
    case "warn":
      return "Warning";
    default:
      return "Info";
  }
}

/**
 * Groups in severity order so the panel renders blocking problems first
 * regardless of how the server happened to order them.
 */
export function groupFindingsByLevel(
  findings: PreflightFinding[],
): Array<{ level: PreflightLevel; findings: PreflightFinding[] }> {
  const order: PreflightLevel[] = ["error", "warn", "info"];
  return order
    .map((level) => ({ level, findings: findings.filter((finding) => finding.level === level) }))
    .filter((group) => group.findings.length > 0);
}
// [END: module]
