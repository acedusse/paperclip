/**
 * FILE: ui/src/api/plugins.test.ts
 * ABOUT: plugins.test.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - plugins.test.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: plugins.test.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/plugins.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock("./client", () => ({
  api: mockApi,
}));

import { pluginsApi } from "./plugins";

describe("pluginsApi local folders", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.post.mockReset();
    mockApi.put.mockReset();
    mockApi.get.mockResolvedValue({});
    mockApi.post.mockResolvedValue({});
    mockApi.put.mockResolvedValue({});
  });

  it("lists company-scoped local folders for a plugin", async () => {
    await pluginsApi.listLocalFolders("plugin-1", "company-1");

    expect(mockApi.get).toHaveBeenCalledWith(
      "/plugins/plugin-1/companies/company-1/local-folders",
    );
  });

  it("validates a candidate folder path without saving", async () => {
    await pluginsApi.validateLocalFolder("plugin-1", "company-1", "wiki-root", {
      path: "/tmp/wiki",
      access: "readWrite",
      requiredFiles: ["WIKI.md"],
    });

    expect(mockApi.post).toHaveBeenCalledWith(
      "/plugins/plugin-1/companies/company-1/local-folders/wiki-root/validate",
      {
        path: "/tmp/wiki",
        access: "readWrite",
        requiredFiles: ["WIKI.md"],
      },
    );
  });

  it("saves through the local-folder PUT endpoint", async () => {
    await pluginsApi.configureLocalFolder("plugin-1", "company-1", "wiki-root", {
      path: "/tmp/wiki",
      requiredDirectories: ["wiki"],
    });

    expect(mockApi.put).toHaveBeenCalledWith(
      "/plugins/plugin-1/companies/company-1/local-folders/wiki-root",
      {
        path: "/tmp/wiki",
        requiredDirectories: ["wiki"],
      },
    );
  });
});
// [END: module]
