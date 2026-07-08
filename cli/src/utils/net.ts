/**
 * FILE: cli/src/utils/net.ts
 * ABOUT: net.ts (utils module).
 *
 * SECTIONS:
 *   [TAG: module] - net.ts (utils module).
 */
// ==========================================
// [META: module]
// INTENT: net.ts (utils module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "cli/src/utils/net.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import net from "node:net";

export function checkPort(port: number): Promise<{ available: boolean; error?: string }> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve({ available: false, error: `Port ${port} is already in use` });
      } else {
        resolve({ available: false, error: err.message });
      }
    });
    server.once("listening", () => {
      server.close(() => resolve({ available: true }));
    });
    server.listen(port, "127.0.0.1");
  });
}
// [END: module]
