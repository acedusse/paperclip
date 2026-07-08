/**
 * FILE: server/src/routes/company-import-paths.ts
 * ABOUT: company-import-paths.ts (routes module).
 *
 * SECTIONS:
 *   [TAG: module] - company-import-paths.ts (routes module).
 */
// ==========================================
// [META: module]
// INTENT: company-import-paths.ts (routes module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/routes/company-import-paths.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export const COMPANY_IMPORT_ROUTE_PATH = "/import";
export const COMPANY_IMPORT_API_PATH = `/api/companies${COMPANY_IMPORT_ROUTE_PATH}`;
// [END: module]
