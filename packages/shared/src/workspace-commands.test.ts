/**
 * FILE: packages/shared/src/workspace-commands.test.ts
 * ABOUT: workspace-commands.test.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace-commands.test.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: workspace-commands.test.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/workspace-commands.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  findWorkspaceCommandDefinition,
  listWorkspaceCommandDefinitions,
  matchWorkspaceRuntimeServiceToCommand,
} from "./workspace-commands.js";

describe("workspace command helpers", () => {
  it("derives service and job commands from command-first runtime config", () => {
    const commands = listWorkspaceCommandDefinitions({
      commands: [
        { id: "web", name: "web", kind: "service", command: "pnpm dev" },
        { id: "db-migrate", name: "db:migrate", kind: "job", command: "pnpm db:migrate" },
      ],
    });

    expect(commands).toEqual([
      expect.objectContaining({ id: "web", kind: "service", serviceIndex: 0 }),
      expect.objectContaining({ id: "db-migrate", kind: "job", serviceIndex: null }),
    ]);
  });

  it("falls back to legacy services and jobs arrays", () => {
    const commands = listWorkspaceCommandDefinitions({
      services: [{ name: "web", command: "pnpm dev" }],
      jobs: [{ name: "lint", command: "pnpm lint" }],
    });

    expect(commands).toEqual([
      expect.objectContaining({ id: "service:web", kind: "service", serviceIndex: 0 }),
      expect.objectContaining({ id: "job:lint", kind: "job", serviceIndex: null }),
    ]);
  });

  it("matches a configured service command to the current runtime service", () => {
    const workspaceRuntime = {
      commands: [
        { id: "web", name: "web", kind: "service", command: "pnpm dev", cwd: "." },
      ],
    };
    const command = findWorkspaceCommandDefinition(workspaceRuntime, "web");
    expect(command).not.toBeNull();

    const match = matchWorkspaceRuntimeServiceToCommand(command!, [
      {
        id: "runtime-web",
        serviceName: "web",
        command: "pnpm dev",
        cwd: "/repo",
        configIndex: null,
      },
    ]);

    expect(match).toEqual(expect.objectContaining({ id: "runtime-web" }));
  });

  it("does not match a stale runtime service after the configured command changes", () => {
    const workspaceRuntime = {
      commands: [
        { id: "web", name: "web", kind: "service", command: "pnpm dev:once --tailscale-auth", cwd: "." },
      ],
    };
    const command = findWorkspaceCommandDefinition(workspaceRuntime, "web");
    expect(command).not.toBeNull();

    const match = matchWorkspaceRuntimeServiceToCommand(command!, [
      {
        id: "runtime-web",
        serviceName: "web",
        command: "pnpm dev",
        cwd: "/repo",
        configIndex: null,
      },
    ]);

    expect(match).toBeNull();
  });
});
// [END: module]
