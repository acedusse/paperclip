/**
 * FILE: packages/skills-catalog/src/frontmatter.test.ts
 * ABOUT: frontmatter.test.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - frontmatter.test.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: frontmatter.test.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/skills-catalog/src/frontmatter.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { parseFrontmatterMarkdown } from "./frontmatter.js";

describe("skills catalog frontmatter parsing", () => {
  it("supports YAML block scalars used by SKILL.md descriptions", () => {
    const parsed = parseFrontmatterMarkdown([
      "---",
      "name: Catalog Skill",
      "description: >",
      "  First line",
      "  second line",
      "---",
      "",
      "Body",
    ].join("\n"));

    expect(parsed.frontmatter.description).toBe("First line second line\n");
  });

  it("supports block-scalar chomping variants", () => {
    const parsed = parseFrontmatterMarkdown([
      "---",
      "name: Catalog Skill",
      "description: >-",
      "  First line",
      "  second line",
      "---",
      "",
      "Body",
    ].join("\n"));

    expect(parsed.frontmatter.description).toBe("First line second line");
  });
});
// [END: module]
