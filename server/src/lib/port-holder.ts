/**
 * FILE: server/src/lib/port-holder.ts
 * ABOUT: port-holder.ts (server lib module).
 *
 * SECTIONS:
 *   [TAG: module] - port-holder.ts (server lib module).
 */
// ==========================================
// [META: module]
// INTENT: Report whether a TCP port is held and which pids hold it.
// PSEUDOCODE: 1. Probe the port. 2. Shell out to ss/lsof. 3. Parse pids.
// JSON_FLOW: {"file": "server/src/lib/port-holder.ts", "imports": "node:net,node:child_process", "exports": "isPortInUse,parsePortHolders,findPortHolders"}
// ==========================================
// [START: module]
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Whether something is currently bound to `port` on `host`.
 *
 * Probes by binding rather than by reading the process table, so it stays
 * correct regardless of which listing tools exist on the machine.
 */
export function isPortInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") return resolve(true);
      reject(err);
    });
    probe.listen(port, host, () => {
      probe.close(() => resolve(false));
    });
  });
}

/**
 * Extract the pids listening on `port` from `ss -ltnp` style output.
 *
 * Anchors on the address:port column so that, for example, port 3100 never
 * matches a listener on 13100.
 */
export function parsePortHolders(listingOutput: string, port: number): number[] {
  const pids = new Set<number>();
  const portPattern = new RegExp(`[:.\\]]${port}\\s`);

  for (const line of listingOutput.split("\n")) {
    if (!portPattern.test(line)) continue;
    for (const match of line.matchAll(/pid=(\d+)/g)) {
      pids.add(Number(match[1]));
    }
  }

  return [...pids];
}

/** Best-effort lookup of the pids holding `port`; empty when no tool is available. */
export async function findPortHolders(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("ss", ["-ltnp"]);
    return parsePortHolders(stdout, port);
  } catch {
    // ss missing or refused; fall through to lsof.
  }

  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
    return stdout
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}
// [END: module]
