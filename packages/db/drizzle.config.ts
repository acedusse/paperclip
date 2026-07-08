/**
 * FILE: packages/db/drizzle.config.ts
 * ABOUT: drizzle.config.ts (db module).
 *
 * SECTIONS:
 *   [TAG: module] - drizzle.config.ts (db module).
 */
// ==========================================
// [META: module]
// INTENT: drizzle.config.ts (db module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/db/drizzle.config.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./dist/schema/*.js",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
// [END: module]
