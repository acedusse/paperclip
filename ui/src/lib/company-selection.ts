/**
 * FILE: ui/src/lib/company-selection.ts
 * ABOUT: company-selection.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - company-selection.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: company-selection.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/company-selection.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export type CompanySelectionSource = "manual" | "route_sync" | "bootstrap";

export function shouldSyncCompanySelectionFromRoute(params: {
  selectionSource: CompanySelectionSource;
  selectedCompanyId: string | null;
  routeCompanyId: string;
}): boolean {
  const { selectionSource, selectedCompanyId, routeCompanyId } = params;

  if (selectedCompanyId === routeCompanyId) return false;

  // Let manual company switches finish their remembered-path navigation first.
  if (selectionSource === "manual" && selectedCompanyId) {
    return false;
  }

  return true;
}
// [END: module]
