import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeGitChangeset } from "./git-changeset.js";

const run = promisify(execFile);
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "chgset-"));
  const git = (...a: string[]) => run("git", ["-C", dir, ...a]);
  await git("init", "-q");
  await git("config", "user.email", "t@t.dev");
  await git("config", "user.name", "t");
  writeFileSync(path.join(dir, "keep.txt"), "one\ntwo\n");
  writeFileSync(path.join(dir, "gone.txt"), "delete me\n");
  await git("add", "."); await git("commit", "-qm", "base");
  const base = (await git("rev-parse", "HEAD")).stdout.trim();
  writeFileSync(path.join(dir, "keep.txt"), "one\ntwo\nthree\n"); // modified
  writeFileSync(path.join(dir, "new.txt"), "brand new\n");         // added (committed)
  rmSync(path.join(dir, "gone.txt"));                              // deleted
  await git("add", "-A"); await git("commit", "-qm", "work");
  writeFileSync(path.join(dir, "untracked.txt"), "not staged\n");  // untracked
  (globalThis as any).__base = base;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("computeGitChangeset", () => {
  it("reports added/modified/deleted/untracked with line counts", async () => {
    const base = (globalThis as any).__base as string;
    const { files } = await computeGitChangeset(dir, base);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath["new.txt"].status).toBe("added");
    expect(byPath["keep.txt"].status).toBe("modified");
    expect(byPath["keep.txt"].additions).toBe(1);
    expect(byPath["gone.txt"].status).toBe("deleted");
    expect(byPath["untracked.txt"].status).toBe("untracked");
    expect(byPath["keep.txt"].diff).toContain("three");
  });

  it("truncates over-cap diffs to metadata only", async () => {
    const base = (globalThis as any).__base as string;
    const { files } = await computeGitChangeset(dir, base, { perFileDiffCap: 5 });
    expect(files.find((f) => f.path === "keep.txt")!.truncated).toBe(true);
    expect(files.find((f) => f.path === "keep.txt")!.diff).toBeUndefined();
  });
});
