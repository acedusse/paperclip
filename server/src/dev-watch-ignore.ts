/**
 * FILE: server/src/dev-watch-ignore.ts
 * ABOUT: dev-watch-ignore.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - dev-watch-ignore.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: dev-watch-ignore.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/dev-watch-ignore.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import fs from "node:fs";
import path from "node:path";

function toGlobstarPath(candidate: string): string {
  return `${candidate.replaceAll(path.sep, "/")}/**`;
}

function addIgnorePath(target: Set<string>, candidate: string): void {
  target.add(candidate);
  target.add(toGlobstarPath(candidate));
  try {
    const realPath = fs.realpathSync(candidate);
    target.add(realPath);
    target.add(toGlobstarPath(realPath));
  } catch {
    // Ignore paths that do not exist in the current checkout.
  }
}

export function resolveServerDevWatchIgnorePaths(serverRoot: string): string[] {
  const ignorePaths = new Set<string>([
    "**/{node_modules,bower_components,vendor}/**",
    "**/.vite-temp/**",
  ]);

  for (const relativePath of [
    "../ui/node_modules",
    "../ui/node_modules/.vite-temp",
    "../ui/.vite",
    "../ui/dist",
    // npm install during reinstall would trigger a restart mid-request
    // if tsx watch sees the new files. Exclude the managed plugins dir.
    process.env.HOME + "/.paperclip/adapter-plugins",
  ]) {
    addIgnorePath(ignorePaths, path.resolve(serverRoot, relativePath));
  }

  return [...ignorePaths];
}
// [END: module]
