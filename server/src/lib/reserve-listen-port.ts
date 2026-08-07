/**
 * FILE: server/src/lib/reserve-listen-port.ts
 * ABOUT: reserve-listen-port.ts (server lib module).
 *
 * SECTIONS:
 *   [TAG: module] - reserve-listen-port.ts (server lib module).
 */
// ==========================================
// [META: module]
// INTENT: Bind the HTTP server to a free port without a detect/listen race.
// PSEUDOCODE: 1. Detect a candidate port. 2. Listen immediately. 3. On EADDRINUSE retry past it.
// JSON_FLOW: {"file": "server/src/lib/reserve-listen-port.ts", "imports": "detect-port", "exports": "reserveListenPort"}
// ==========================================
// [START: module]
import type { Server } from "node:http";
import detectPort from "detect-port";

export interface ReserveListenPortOptions {
  /** Server to bind. Retried in place when a candidate port is lost to another process. */
  server: Server;
  /** Port the operator asked for; the first candidate. */
  requestedPort: number;
  host: string;
  /** Candidates to try before giving up. */
  maxAttempts?: number;
  /** Port discovery, injectable for tests. Defaults to `detect-port`. */
  detect?: (port: number) => Promise<number>;
}

function isAddressInUse(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "EADDRINUSE";
}

function listenOnce(server: Server, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/**
 * Reserve a port for `server` and return the port it is actually bound to.
 *
 * Detection and binding are deliberately adjacent: a port that is free when
 * probed can be taken moments later by a leftover dev watcher, so losing the
 * race is expected and retried rather than fatal.
 */
export async function reserveListenPort({
  server,
  requestedPort,
  host,
  maxAttempts = 10,
  detect = (port) => detectPort(port),
}: ReserveListenPortOptions): Promise<number> {
  let candidate = requestedPort;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = await detect(candidate);
    try {
      await listenOnce(server, port, host);
      return port;
    } catch (err) {
      if (!isAddressInUse(err)) throw err;
      lastError = err;
      candidate = port + 1;
    }
  }

  throw new Error(
    `could not bind ${host}:${requestedPort} after ${maxAttempts} attempts — every candidate port was taken ` +
      `while starting up. This usually means leftover Paperclip dev processes are still running; ` +
      `run ./stop.sh --all to clear them, then start again.`,
    { cause: lastError },
  );
}
// [END: module]
