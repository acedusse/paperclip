#!/usr/bin/env -S node --import tsx
/**
 * FILE: scripts/check-dev-port.ts
 * ABOUT: check-dev-port.ts (scripts module).
 *
 * SECTIONS:
 *   [TAG: module] - check-dev-port.ts (scripts module).
 */
// ==========================================
// [META: module]
// INTENT: Refuse to start when the dev port is still held after dev:stop.
// PSEUDOCODE: 1. Probe port. 2. Identify holders. 3. Print remedy and fail.
// JSON_FLOW: {"file": "scripts/check-dev-port.ts", "imports": "server/src/lib/port-holder.ts", "exports": "exit code"}
// ==========================================
// [START: module]
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readConfigFile } from "../server/src/config-file.ts";
import { findPortHolders, isPortInUse } from "../server/src/lib/port-holder.ts";

const execFileAsync = promisify(execFile);

// Escape hatch for deliberately running a second instance beside a first one.
if (process.env.PAPERCLIP_ALLOW_PORT_IN_USE === "true") {
  process.exit(0);
}

// Mirror the server's own precedence (see server/src/config.ts) so the guard
// never blocks a start that would legitimately have used a different port.
const configuredPort =
  process.argv[2]?.trim() || process.env.PORT?.trim() || readConfigFile()?.server.port || 3100;
const port = Number(configuredPort);
const host = "127.0.0.1";

if (!Number.isInteger(port) || port <= 0) {
  console.error(`check-dev-port: invalid port ${process.argv[2] ?? ""}`);
  process.exit(2);
}

if (!(await isPortInUse(port, host))) {
  process.exit(0);
}

const holders = await findPortHolders(port);

async function describe(pid: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "command=", "-p", String(pid)]);
    const command = stdout.trim();
    return command ? `  pid ${pid}: ${command.slice(0, 140)}` : `  pid ${pid}`;
  } catch {
    return `  pid ${pid}`;
  }
}

const lines = await Promise.all(holders.map(describe));

console.error("");
console.error(`error: port ${port} is still in use after stopping the managed dev runner.`);
if (lines.length > 0) {
  console.error("It is held by:");
  for (const line of lines) console.error(line);
} else {
  console.error("The holding process could not be identified.");
}
console.error("");
console.error("This is usually a leftover watcher from an earlier session that the managed");
console.error("runner no longer tracks, and it will keep serving stale code on this port.");
console.error("Clear it with:  ./stop.sh --all");
console.error("");
console.error("To start a second instance alongside this one instead, re-run with");
console.error("PAPERCLIP_ALLOW_PORT_IN_USE=true (the server will pick the next free port).");
console.error("");
process.exit(1);
// [END: module]
