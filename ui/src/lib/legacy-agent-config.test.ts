/**
 * FILE: ui/src/lib/legacy-agent-config.test.ts
 * ABOUT: legacy-agent-config.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - legacy-agent-config.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: legacy-agent-config.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/legacy-agent-config.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  hasLegacyWorkingDirectory,
  shouldShowLegacyWorkingDirectoryField,
} from "./legacy-agent-config";

describe("legacy agent config helpers", () => {
  it("treats non-empty cwd values as legacy working directories", () => {
    expect(hasLegacyWorkingDirectory("/tmp/workspace")).toBe(true);
    expect(hasLegacyWorkingDirectory("  /tmp/workspace  ")).toBe(true);
  });

  it("ignores nullish and blank cwd values", () => {
    expect(hasLegacyWorkingDirectory("")).toBe(false);
    expect(hasLegacyWorkingDirectory("   ")).toBe(false);
    expect(hasLegacyWorkingDirectory(null)).toBe(false);
    expect(hasLegacyWorkingDirectory(undefined)).toBe(false);
  });

  it("shows the deprecated field only for edit forms with an existing cwd", () => {
    expect(
      shouldShowLegacyWorkingDirectoryField({
        isCreate: true,
        adapterConfig: { cwd: "/tmp/workspace" },
      }),
    ).toBe(false);
    expect(
      shouldShowLegacyWorkingDirectoryField({
        isCreate: false,
        adapterConfig: { cwd: "" },
      }),
    ).toBe(false);
    expect(
      shouldShowLegacyWorkingDirectoryField({
        isCreate: false,
        adapterConfig: { cwd: "/tmp/workspace" },
      }),
    ).toBe(true);
  });
});
// [END: module]
