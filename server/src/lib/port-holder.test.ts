/**
 * FILE: server/src/lib/port-holder.test.ts
 * ABOUT: port-holder.test.ts (server lib module).
 *
 * SECTIONS:
 *   [TAG: module] - port-holder.test.ts (server lib module).
 */
// ==========================================
// [META: module]
// INTENT: Cover listener parsing and live port occupancy detection.
// PSEUDOCODE: 1. Parse ss output. 2. Bind a real port. 3. Assert detection.
// JSON_FLOW: {"file": "server/src/lib/port-holder.test.ts", "imports": "port-holder.ts", "exports": "tests"}
// ==========================================
// [START: module]
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { isPortInUse, parsePortHolders } from "./port-holder.js";

const HOST = "127.0.0.1";
const opened: Server[] = [];

afterEach(async () => {
  while (opened.length > 0) {
    const server = opened.pop();
    if (!server) continue;
    await new Promise<void>((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
  }
});

const SS_OUTPUT = [
  "State  Recv-Q Send-Q   Local Address:Port    Peer Address:Port Process",
  'LISTEN 0      511          127.0.0.1:3100         0.0.0.0:*    users:(("MainThread",pid=1231919,fd=61))',
  'LISTEN 0      511          127.0.0.1:13100        0.0.0.0:*    users:(("MainThread",pid=1231919,fd=48))',
  'LISTEN 0      511              [::1]:3100            [::]:*    users:(("MainThread",pid=555,fd=7))',
  'LISTEN 0      244          127.0.0.1:54329        0.0.0.0:*    users:(("postgres",pid=4242,fd=3))',
].join("\n");

describe("parsePortHolders", () => {
  it("returns the pids listening on the requested port", () => {
    expect(parsePortHolders(SS_OUTPUT, 3100).sort((a, b) => a - b)).toEqual([555, 1231919]);
  });

  it("does not treat a longer port number as a match", () => {
    // 3100 is a substring of 13100; a naive search would claim the HMR socket.
    expect(parsePortHolders(SS_OUTPUT, 13100)).toEqual([1231919]);
  });

  it("returns nothing when no process listens on the port", () => {
    expect(parsePortHolders(SS_OUTPUT, 9999)).toEqual([]);
  });

  it("reports each holding pid once", () => {
    const duplicated = [SS_OUTPUT, SS_OUTPUT].join("\n");
    expect(parsePortHolders(duplicated, 54329)).toEqual([4242]);
  });
});

describe("isPortInUse", () => {
  it("is false for a port nothing is bound to", async () => {
    const probe = createServer();
    const port = await new Promise<number>((resolve) => {
      probe.listen(0, HOST, () => {
        const address = probe.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    expect(await isPortInUse(port, HOST)).toBe(false);
  });

  it("is true while a server holds the port", async () => {
    const server = createServer();
    opened.push(server);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, HOST, () => {
        const address = server.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });

    expect(await isPortInUse(port, HOST)).toBe(true);
  });
});
// [END: module]
