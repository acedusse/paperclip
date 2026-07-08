/**
 * FILE: packages/skills-catalog/scripts/build-catalog-manifest.ts
 * ABOUT: build-catalog-manifest.ts (scripts module).
 *
 * SECTIONS:
 *   [TAG: module] - build-catalog-manifest.ts (scripts module).
 */
// ==========================================
// [META: module]
// INTENT: build-catalog-manifest.ts (scripts module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/skills-catalog/scripts/build-catalog-manifest.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeCatalogManifest } from "../src/catalog-builder.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await writeCatalogManifest(packageDir);

if (result.errors.length > 0) {
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Wrote generated/catalog.json with ${result.manifest.skills.length} catalog skills.`);
}
// [END: module]
