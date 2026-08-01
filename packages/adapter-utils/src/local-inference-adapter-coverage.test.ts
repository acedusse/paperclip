/**
 * FILE: packages/adapter-utils/src/local-inference-adapter-coverage.test.ts
 * ABOUT: local-inference-adapter-coverage.test.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - local-inference-adapter-coverage.test.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: local-inference-adapter-coverage.test.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapter-utils/src/local-inference-adapter-coverage.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the invariant that makes local billing complete rather than partial:
 *
 *   every adapter that infers a biller from OpenAI-compatible env vars must also
 *   apply the local-inference $0 override.
 *
 * Without this, adding a fifth OpenAI-compatible adapter silently reintroduces the bug
 * this phase fixed — a local run billed as OpenAI/ChatGPT/Cursor spend. The failure is
 * invisible in typecheck and in every unit test, because the omission is the absence of
 * a call rather than a wrong one.
 */

const ADAPTERS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../adapters",
);

async function readAdapterSources(): Promise<Array<{ adapter: string; source: string }>> {
  const entries = await readdir(ADAPTERS_DIR, { withFileTypes: true });
  const sources: Array<{ adapter: string; source: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const executePath = path.join(ADAPTERS_DIR, entry.name, "src/server/execute.ts");
    try {
      sources.push({ adapter: entry.name, source: await readFile(executePath, "utf8") });
    } catch {
      // adapter without a server execute module — not in scope
    }
  }

  return sources;
}

describe("local inference adapter coverage", () => {
  it("finds the adapter sources it is meant to guard", async () => {
    // If this fails the directory layout moved and the guard below is silently vacuous.
    const sources = await readAdapterSources();
    expect(sources.length).toBeGreaterThan(0);
  });

  it("applies localBillingOverride in every adapter that infers an OpenAI-compatible biller", async () => {
    const sources = await readAdapterSources();

    const openAiCompatible = sources.filter((entry) =>
      entry.source.includes("inferOpenAiCompatibleBiller"),
    );
    expect(openAiCompatible.length).toBeGreaterThan(0);

    const missing = openAiCompatible
      .filter((entry) => !entry.source.includes("localBillingOverride"))
      .map((entry) => entry.adapter);

    expect(missing).toEqual([]);
  });
});
// [END: module]
