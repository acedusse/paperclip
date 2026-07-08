/**
 * FILE: server/src/__tests__/project-shortname-resolution.test.ts
 * ABOUT: project-shortname-resolution.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - project-shortname-resolution.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: project-shortname-resolution.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/project-shortname-resolution.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { resolveProjectNameForUniqueShortname } from "../services/projects.ts";

describe("resolveProjectNameForUniqueShortname", () => {
  it("keeps name when shortname is not used", () => {
    const resolved = resolveProjectNameForUniqueShortname("Platform", [
      { id: "p1", name: "Growth" },
    ]);
    expect(resolved).toBe("Platform");
  });

  it("appends numeric suffix when shortname collides", () => {
    const resolved = resolveProjectNameForUniqueShortname("Growth Team", [
      { id: "p1", name: "growth-team" },
    ]);
    expect(resolved).toBe("Growth Team 2");
  });

  it("increments suffix until unique", () => {
    const resolved = resolveProjectNameForUniqueShortname("Growth Team", [
      { id: "p1", name: "growth-team" },
      { id: "p2", name: "growth-team-2" },
    ]);
    expect(resolved).toBe("Growth Team 3");
  });

  it("ignores excluded project id", () => {
    const resolved = resolveProjectNameForUniqueShortname(
      "Growth Team",
      [
        { id: "p1", name: "growth-team" },
        { id: "p2", name: "platform" },
      ],
      { excludeProjectId: "p1" },
    );
    expect(resolved).toBe("Growth Team");
  });

  it("keeps non-normalizable names unchanged", () => {
    const resolved = resolveProjectNameForUniqueShortname("!!!", [
      { id: "p1", name: "growth" },
    ]);
    expect(resolved).toBe("!!!");
  });
});
// [END: module]
