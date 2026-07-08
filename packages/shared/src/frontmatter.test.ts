/**
 * FILE: packages/shared/src/frontmatter.test.ts
 * ABOUT: frontmatter.test.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - frontmatter.test.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: frontmatter.test.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/frontmatter.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { parseFrontmatterMarkdown } from "./frontmatter.js";

describe("parseFrontmatterMarkdown", () => {
  it("parses folded and literal YAML block scalars", () => {
    const folded = parseFrontmatterMarkdown([
      "---",
      "name: Folded",
      "description: >",
      "  First line",
      "  second line",
      "",
      "  Third paragraph",
      "---",
      "",
      "Body",
    ].join("\n"));

    expect(folded.frontmatter.description).toBe("First line second line\n\nThird paragraph\n");

    const literal = parseFrontmatterMarkdown([
      "---",
      "name: Literal",
      "description: |",
      "  First line",
      "  second line",
      "---",
      "",
      "Body",
    ].join("\n"));

    expect(literal.frontmatter.description).toBe("First line\nsecond line\n");
  });

  it("respects block-scalar chomping indicators", () => {
    const foldedStrip = parseFrontmatterMarkdown([
      "---",
      "description: >-",
      "  First line",
      "  second line",
      "",
      "  Third paragraph",
      "---",
      "",
      "Body",
    ].join("\n"));

    expect(foldedStrip.frontmatter.description).toBe("First line second line\n\nThird paragraph");

    const literalKeep = parseFrontmatterMarkdown([
      "---",
      "description: |+",
      "  First line",
      "  second line",
      "",
      "",
      "---",
      "",
      "Body",
    ].join("\n"));

    expect(literalKeep.frontmatter.description).toBe("First line\nsecond line\n\n");
  });

  it("parses inline object array items nested under frontmatter keys", () => {
    const parsed = parseFrontmatterMarkdown([
      "---",
      "metadata:",
      "  sources:",
      "    - kind: github-dir",
      "      repo: paperclipai/paperclip",
      "      path: skills/paperclip",
      "---",
      "",
      "Body",
    ].join("\n"));

    expect(parsed.frontmatter).toMatchObject({
      metadata: {
        sources: [
          {
            kind: "github-dir",
            repo: "paperclipai/paperclip",
            path: "skills/paperclip",
          },
        ],
      },
    });
  });

  it("does not treat trailing-dot decimals as numbers", () => {
    const parsed = parseFrontmatterMarkdown([
      "---",
      "version: 1.",
      "---",
      "",
    ].join("\n"));

    expect(parsed.frontmatter.version).toBe("1.");
  });
});
// [END: module]
