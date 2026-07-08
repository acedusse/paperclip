/**
 * FILE: server/src/__tests__/plugin-execution-workspace-bridge.test.ts
 * ABOUT: plugin-execution-workspace-bridge.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - plugin-execution-workspace-bridge.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: plugin-execution-workspace-bridge.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/plugin-execution-workspace-bridge.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it, vi } from "vitest";
import { createHostClientHandlers } from "../../../packages/plugins/sdk/src/host-client-factory.js";
import { PLUGIN_RPC_ERROR_CODES } from "../../../packages/plugins/sdk/src/protocol.js";

describe("plugin execution workspace bridge", () => {
  it("routes metadata reads through the host client when the capability is declared", async () => {
    const get = vi.fn().mockResolvedValue({
      id: "workspace-1",
      companyId: "company-1",
      projectId: "project-1",
      projectWorkspaceId: null,
      path: "/tmp/workspace-1",
      cwd: "/tmp/workspace-1",
      repoUrl: null,
      baseRef: "main",
      branchName: "feature/workspace-1",
      providerType: "git_worktree",
      providerMetadata: null,
    });
    const handlers = createHostClientHandlers({
      pluginId: "workspace-plugin",
      capabilities: ["execution.workspaces.read"],
      services: {
        executionWorkspaces: { get },
      } as any,
    });

    await expect(
      handlers["executionWorkspaces.get"]({ workspaceId: "workspace-1", companyId: "company-1" }),
    ).resolves.toMatchObject({
      id: "workspace-1",
      cwd: "/tmp/workspace-1",
    });
    expect(get).toHaveBeenCalledWith({ workspaceId: "workspace-1", companyId: "company-1" });
  });

  it("rejects metadata reads when the plugin lacks execution.workspace read access", async () => {
    const get = vi.fn();
    const handlers = createHostClientHandlers({
      pluginId: "workspace-plugin",
      capabilities: [],
      services: {
        executionWorkspaces: { get },
      } as any,
    });

    await expect(
      handlers["executionWorkspaces.get"]({ workspaceId: "workspace-1", companyId: "company-1" }),
    ).rejects.toMatchObject({
      code: PLUGIN_RPC_ERROR_CODES.CAPABILITY_DENIED,
    });
    expect(get).not.toHaveBeenCalled();
  });
});
// [END: module]
