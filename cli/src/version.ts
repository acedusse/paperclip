/**
 * FILE: cli/src/version.ts
 * ABOUT: version.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - version.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: version.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/version.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { createRequire } from "node:module";

type PackageJson = {
  version?: string;
};

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as PackageJson;

export const cliVersion = pkg.version ?? "0.0.0";
// [END: module]
