/**
 * FILE: packages/skills-catalog/src/frontmatter.ts
 * ABOUT: frontmatter.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - frontmatter.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: frontmatter.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/skills-catalog/src/frontmatter.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export {
  asBoolean,
  asString,
  asStringArray,
  parseFrontmatterMarkdown,
  type MarkdownDoc,
} from "@paperclipai/shared";

export { isFrontmatterPlainRecord as isPlainRecord } from "@paperclipai/shared";
// [END: module]
