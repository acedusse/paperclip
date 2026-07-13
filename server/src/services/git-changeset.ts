/**
 * FILE: server/src/services/git-changeset.ts
 * ABOUT: git-changeset.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - git-changeset.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: git-changeset.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/git-changeset.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RunChangesetFile } from "@paperclipai/db";

const execFileAsync = promisify(execFile);
const DEFAULT_PER_FILE_DIFF_CAP = 200_000;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

function parseNumstat(out: string): Map<string, { additions: number; deletions: number; binary: boolean; oldPath?: string }> {
  const map = new Map();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [add, del, ...rest] = line.split("\t");
    const p = rest.join("\t");
    const binary = add === "-" && del === "-";
    map.set(p, { additions: binary ? 0 : Number(add), deletions: binary ? 0 : Number(del), binary });
  }
  return map;
}

export async function computeGitChangeset(
  workspacePath: string,
  baseRef: string | null,
  opts: { perFileDiffCap?: number } = {},
): Promise<{ files: RunChangesetFile[]; headRef: string | null; warning?: string }> {
  const cap = opts.perFileDiffCap ?? DEFAULT_PER_FILE_DIFF_CAP;
  let headRef: string | null = null;
  try {
    headRef = (await git(workspacePath, ["rev-parse", "HEAD"])).trim() || null;
  } catch (err) {
    return { files: [], headRef: null, warning: `git unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }

  const range = baseRef ? `${baseRef}...HEAD` : "HEAD";
  const files: RunChangesetFile[] = [];

  // Committed changes vs base
  const statusOut = await git(workspacePath, ["diff", "--name-status", "-M", range]).catch(() => "");
  const numstat = parseNumstat(await git(workspacePath, ["diff", "--numstat", "-M", range]).catch(() => ""));
  for (const line of statusOut.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0];
    const p = code.startsWith("R") ? parts[2] : parts[1];
    const oldPath = code.startsWith("R") ? parts[1] : undefined;
    const status: RunChangesetFile["status"] =
      code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : code.startsWith("R") ? "renamed" : "modified";
    const ns = numstat.get(p) ?? numstat.get(`${oldPath} => ${p}`) ?? { additions: 0, deletions: 0, binary: false };
    let diff: string | undefined;
    let truncated = false;
    if (!ns.binary && status !== "deleted") {
      const d = await git(workspacePath, ["diff", "-M", range, "--", p]).catch(() => "");
      if (d.length > cap) truncated = true;
      else diff = d;
    }
    files.push({ path: p, status, oldPath, additions: ns.additions, deletions: ns.deletions, binary: ns.binary, truncated, diff });
  }

  // Untracked / uncommitted working-tree files
  const porcelain = await git(workspacePath, ["status", "--porcelain=v1", "--untracked-files=all"]).catch(() => "");
  for (const line of porcelain.split("\n")) {
    if (!line.startsWith("?? ")) continue;
    const p = line.slice(3).trim();
    files.push({ path: p, status: "untracked", additions: 0, deletions: 0, binary: false, truncated: false });
  }

  return { files, headRef };
}
