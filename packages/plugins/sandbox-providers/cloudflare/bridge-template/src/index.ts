/**
 * FILE: packages/plugins/sandbox-providers/cloudflare/bridge-template/src/index.ts
 * ABOUT: index.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/cloudflare/bridge-template/src/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { Sandbox } from "@cloudflare/sandbox";
import { handleBridgeRequest, } from "./routes.js";
import type { BridgeEnv } from "./sandboxes.js";

export { Sandbox };

export default {
  async fetch(request: Request, env: BridgeEnv): Promise<Response> {
    try {
      return await handleBridgeRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(
        JSON.stringify({
          error: "internal_error",
          message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
};
// [END: module]
