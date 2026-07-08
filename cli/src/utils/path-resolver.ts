/**
 * FILE: cli/src/utils/path-resolver.ts
 * ABOUT: path-resolver.ts (utils module).
 *
 * SECTIONS:
 *   [TAG: module] - path-resolver.ts (utils module).
 */
// ==========================================
// [META: module]
// INTENT: path-resolver.ts (utils module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/utils/path-resolver.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import fs from "node:fs";
import path from "node:path";
import { expandHomePrefix } from "../config/home.js";

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

export function resolveRuntimeLikePath(value: string, configPath?: string): string {
  const expanded = expandHomePrefix(value);
  if (path.isAbsolute(expanded)) return path.resolve(expanded);

  const cwd = process.cwd();
  const configDir = configPath ? path.dirname(configPath) : null;
  const workspaceRoot = configDir ? path.resolve(configDir, "..") : cwd;

  const candidates = unique([
    ...(configDir ? [path.resolve(configDir, expanded)] : []),
    path.resolve(workspaceRoot, "server", expanded),
    path.resolve(workspaceRoot, expanded),
    path.resolve(cwd, expanded),
  ]);

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}
// [END: module]
