/**
 * FILE: packages/teams-catalog/scripts/validate-catalog.ts
 * ABOUT: validate-catalog.ts (scripts module).
 *
 * SECTIONS:
 *   [TAG: module] - validate-catalog.ts (scripts module).
 */
// ==========================================
// [META: module]
// INTENT: validate-catalog.ts (scripts module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/teams-catalog/scripts/validate-catalog.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalog } from "../src/catalog-builder.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await validateCatalog(packageDir);

if (result.errors.length > 0) {
  console.error(result.errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${result.manifest.teams.length} teams.`);
// [END: module]
