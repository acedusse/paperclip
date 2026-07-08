/**
 * FILE: packages/plugins/plugin-workspace-diff/tests/ui-error-state.spec.ts
 * ABOUT: ui-error-state.spec.ts (tests module).
 *
 * SECTIONS:
 *   [TAG: module] - ui-error-state.spec.ts (tests module).
 */
// ==========================================
// [META: module]
// INTENT: ui-error-state.spec.ts (tests module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/plugin-workspace-diff/tests/ui-error-state.spec.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorState } from "../src/ui/index.js";

describe("workspace diff error state", () => {
  it("keeps bridge error details out of the primary headline", () => {
    const rawError = "Execution workspace not found";
    const html = renderToStaticMarkup(createElement(ErrorState, {
      message: rawError,
      onRetry: () => undefined,
    }));

    expect(html).toContain("Unable to load workspace changes.");
    expect(html).toContain("Retry");
    expect(html).toContain("Troubleshooting details");
    expect(html).not.toContain(`font-medium text-foreground">${rawError}`);
    expect(html.indexOf(rawError)).toBeGreaterThan(html.indexOf("Troubleshooting details"));
  });
});
// [END: module]
