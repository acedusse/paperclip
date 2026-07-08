/**
 * FILE: server/src/types/express.d.ts
 * ABOUT: express.d.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - express.d.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: express.d.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/types/express.d.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export {};

declare global {
  namespace Express {
    interface Request {
      actor: {
        type: "board" | "agent" | "none";
        userId?: string;
        userName?: string | null;
        userEmail?: string | null;
        agentId?: string;
        companyId?: string;
        companyIds?: string[];
        memberships?: Array<{
          companyId: string;
          membershipRole?: string | null;
          status?: string;
        }>;
        isInstanceAdmin?: boolean;
        keyId?: string;
        runId?: string;
        source?: "local_implicit" | "session" | "board_key" | "agent_key" | "agent_jwt" | "cloud_tenant" | "none";
      };
    }
  }
}
// [END: module]
