/**
 * FILE: server/src/__tests__/cursor-local-skill-sync.test.ts
 * ABOUT: cursor-local-skill-sync.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - cursor-local-skill-sync.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: cursor-local-skill-sync.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/cursor-local-skill-sync.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCursorSkills,
  syncCursorSkills,
} from "@paperclipai/adapter-cursor-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createSkillDir(root: string, name: string) {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
  return skillDir;
}

describe("cursor local skill sync", () => {
  const paperclipKey = "paperclipai/paperclip/paperclip";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Paperclip skills and installs them into the Cursor skills home", async () => {
    const home = await makeTempDir("paperclip-cursor-skill-sync-");
    cleanupDirs.add(home);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "cursor",
      config: {
        env: {
          HOME: home,
        },
        paperclipSkillSync: {
          desiredSkills: [paperclipKey],
        },
      },
    } as const;

    const before = await listCursorSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(paperclipKey);
    expect(before.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("missing");

    const after = await syncCursorSkills(ctx, [paperclipKey]);
    expect(after.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".cursor", "skills", "paperclip"))).isSymbolicLink()).toBe(true);
  });

  it("recognizes company-library runtime skills supplied outside the bundled Paperclip directory", async () => {
    const home = await makeTempDir("paperclip-cursor-runtime-skills-home-");
    const runtimeSkills = await makeTempDir("paperclip-cursor-runtime-skills-src-");
    cleanupDirs.add(home);
    cleanupDirs.add(runtimeSkills);

    const paperclipDir = await createSkillDir(runtimeSkills, "paperclip");
    const asciiHeartDir = await createSkillDir(runtimeSkills, "ascii-heart");

    const ctx = {
      agentId: "agent-3",
      companyId: "company-1",
      adapterType: "cursor",
      config: {
        env: {
          HOME: home,
        },
        paperclipRuntimeSkills: [
          {
            key: "paperclip",
            runtimeName: "paperclip",
            source: paperclipDir,
          },
          {
            key: "ascii-heart",
            runtimeName: "ascii-heart",
            source: asciiHeartDir,
          },
        ],
        paperclipSkillSync: {
          desiredSkills: ["ascii-heart"],
        },
      },
    } as const;

    const before = await listCursorSkills(ctx);
    expect(before.warnings).toEqual([]);
    expect(before.desiredSkills).toEqual(["ascii-heart"]);
    expect(before.entries.find((entry) => entry.key === "ascii-heart")?.state).toBe("missing");

    const after = await syncCursorSkills(ctx, ["ascii-heart"]);
    expect(after.warnings).toEqual([]);
    expect(after.entries.find((entry) => entry.key === "ascii-heart")?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".cursor", "skills", "ascii-heart"))).isSymbolicLink()).toBe(true);
  });

});
// [END: module]
