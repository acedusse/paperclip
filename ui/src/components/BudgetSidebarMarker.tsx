/**
 * FILE: ui/src/components/BudgetSidebarMarker.tsx
 * ABOUT: BudgetSidebarMarker.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - BudgetSidebarMarker.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: BudgetSidebarMarker.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/BudgetSidebarMarker.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { DollarSign } from "lucide-react";

export type BudgetSidebarMarkerLevel = "healthy" | "warning" | "critical";

const levelClasses: Record<BudgetSidebarMarkerLevel, string> = {
  healthy: "bg-emerald-500/90 text-white",
  warning: "bg-amber-500/95 text-amber-950",
  critical: "bg-red-500/90 text-white",
};

const defaultTitles: Record<BudgetSidebarMarkerLevel, string> = {
  healthy: "Budget healthy",
  warning: "Budget warning",
  critical: "Paused by budget",
};

export function BudgetSidebarMarker({
  title,
  level = "critical",
}: {
  title?: string;
  level?: BudgetSidebarMarkerLevel;
}) {
  const accessibleTitle = title ?? defaultTitles[level];

  return (
    <span
      title={accessibleTitle}
      aria-label={accessibleTitle}
      className={`ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.08)] ${levelClasses[level]}`}
    >
      <DollarSign className="h-3 w-3" />
    </span>
  );
}
// [END: module]
