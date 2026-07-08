/**
 * FILE: ui/src/api/execution-workspaces.test.ts
 * ABOUT: execution-workspaces.test.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - execution-workspaces.test.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: execution-workspaces.test.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/execution-workspaces.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  api: mockApi,
}));

import { executionWorkspacesApi } from "./execution-workspaces";

describe("executionWorkspacesApi.listSummaries", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.get.mockResolvedValue([]);
  });

  it("requests the lightweight summary payload", async () => {
    await executionWorkspacesApi.listSummaries("company-1", {
      projectId: "project-1",
      reuseEligible: true,
    });

    expect(mockApi.get).toHaveBeenCalledWith(
      "/companies/company-1/execution-workspaces?projectId=project-1&reuseEligible=true&summary=true",
    );
  });

});
// [END: module]
