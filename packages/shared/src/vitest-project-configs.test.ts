/**
 * FILE: packages/shared/src/vitest-project-configs.test.ts
 * ABOUT: vitest-project-configs.test.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - vitest-project-configs.test.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: vitest-project-configs.test.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/vitest-project-configs.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards against collecting build output as tests.
 *
 * `tsc -b` emits compiled copies of every `*.test.ts` into `dist/`. If a project
 * collects those, each suite runs twice — once from source and once from a compiled
 * snapshot that can be arbitrarily old. A stale copy can pass while current source is
 * broken, or fail for a reason that no longer exists in the tree.
 *
 * Two vitest behaviours make this easy to reintroduce, which is why it needs a test
 * rather than a convention:
 *   1. the default `exclude` is replaced, not merged, once a project sets its own
 *      test options; and
 *   2. an `exclude` on the root config does NOT propagate into projects.
 *
 * So every project must state the exclude itself, and a project added without a
 * vitest config inherits the problem silently.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function readRootProjectDirs(): Promise<string[]> {
  const source = await readFile(path.join(REPO_ROOT, "vitest.config.ts"), "utf8");
  const block = /projects:\s*\[([\s\S]*?)\]/.exec(source);
  if (!block) throw new Error("could not find the projects array in the root vitest.config.ts");
  return [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("vitest project configs", () => {
  it("finds the projects it is meant to guard", async () => {
    // Without this the assertions below would pass vacuously if the root config moved.
    const dirs = await readRootProjectDirs();
    expect(dirs.length).toBeGreaterThan(5);
  });

  it("every project excludes dist/ so build output is never collected as tests", async () => {
    const dirs = await readRootProjectDirs();
    const offenders: string[] = [];

    for (const dir of dirs) {
      const configPath = path.join(REPO_ROOT, dir, "vitest.config.ts");
      let source: string;
      try {
        source = await readFile(configPath, "utf8");
      } catch {
        // A project with no config of its own inherits the root config, whose
        // exclude does not propagate — so it collects dist. Missing counts as an offence.
        offenders.push(`${dir} (no vitest.config.ts)`);
        continue;
      }
      if (!/exclude:\s*\[[^\]]*\*\*\/dist\/\*\*/.test(source)) {
        offenders.push(`${dir} (config does not exclude **/dist/**)`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
// [END: module]
