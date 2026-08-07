/**
 * FILE: server/src/lib/reserve-listen-port.test.ts
 * ABOUT: reserve-listen-port.test.ts (server lib module).
 *
 * SECTIONS:
 *   [TAG: module] - reserve-listen-port.test.ts (server lib module).
 */
// ==========================================
// [META: module]
// INTENT: Cover port reservation, fallback and the detect/listen race.
// PSEUDOCODE: 1. Occupy ports. 2. Reserve. 3. Assert bound port and errors.
// JSON_FLOW: {"file": "server/src/lib/reserve-listen-port.test.ts", "imports": "reserve-listen-port.ts", "exports": "tests"}
// ==========================================
// [START: module]
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { reserveListenPort } from "./reserve-listen-port.js";

const HOST = "127.0.0.1";
const cleanup: Server[] = [];

function track(server: Server): Server {
  cleanup.push(server);
  return server;
}

async function occupy(port: number): Promise<Server> {
  const server = track(createServer());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => resolve());
  });
  return server;
}

function boundPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("not bound to a TCP port");
  return address.port;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      if (address === null || typeof address === "string") return reject(new Error("no port"));
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

afterEach(async () => {
  while (cleanup.length > 0) {
    const server = cleanup.pop();
    if (!server) continue;
    await new Promise<void>((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
  }
});

describe("reserveListenPort", () => {
  it("binds the requested port when it is free", async () => {
    const requestedPort = await freePort();
    const server = track(createServer());

    const listenPort = await reserveListenPort({ server, requestedPort, host: HOST });

    expect(listenPort).toBe(requestedPort);
    expect(boundPort(server)).toBe(requestedPort);
  });

  it("falls back to another free port when the requested port is already bound", async () => {
    const requestedPort = await freePort();
    await occupy(requestedPort);
    const server = track(createServer());

    const listenPort = await reserveListenPort({ server, requestedPort, host: HOST });

    expect(listenPort).not.toBe(requestedPort);
    expect(boundPort(server)).toBe(listenPort);
  });

  it("recovers when the port is stolen between detection and listen", async () => {
    // Reproduces the orphaned-watcher race: detection reports the port free,
    // then another process binds it before we call listen().
    const requestedPort = await freePort();
    const server = track(createServer());
    let stolen = 0;

    const listenPort = await reserveListenPort({
      server,
      requestedPort,
      host: HOST,
      detect: async (port) => {
        if (stolen === 0) {
          stolen += 1;
          await occupy(port);
        }
        return port;
      },
    });

    expect(stolen).toBe(1);
    expect(listenPort).not.toBe(requestedPort);
    expect(boundPort(server)).toBe(listenPort);
  });

  it("throws an actionable error when every attempt loses the race", async () => {
    const requestedPort = await freePort();
    const server = track(createServer());

    await expect(
      reserveListenPort({
        server,
        requestedPort,
        host: HOST,
        maxAttempts: 3,
        detect: async (port) => {
          await occupy(port);
          return port;
        },
      }),
    ).rejects.toThrow(/could not bind .* after 3 attempts/i);
  });

  it("names the remedy in the exhaustion error so the operator can act on it", async () => {
    const requestedPort = await freePort();
    const server = track(createServer());

    await expect(
      reserveListenPort({
        server,
        requestedPort,
        host: HOST,
        maxAttempts: 2,
        detect: async (port) => {
          await occupy(port);
          return port;
        },
      }),
    ).rejects.toThrow(/stop\.sh --all/);
  });
});
// [END: module]
