/**
 * FILE: packages/teams-catalog/scripts/build-catalog-manifest.ts
 * ABOUT: build-catalog-manifest.ts (scripts module).
 *
 * SECTIONS:
 *   [TAG: module] - build-catalog-manifest.ts (scripts module).
 */
// ==========================================
// [META: module]
// INTENT: build-catalog-manifest.ts (scripts module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/teams-catalog/scripts/build-catalog-manifest.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeCatalogManifest } from "../src/catalog-builder.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await writeCatalogManifest(packageDir);

if (result.errors.length > 0) {
  console.error(result.errors.join("\n"));
  process.exit(1);
}

console.log(`Wrote ${result.manifest.teams.length} teams to generated/catalog.json`);
// [END: module]
