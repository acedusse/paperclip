/**
 * FILE: packages/plugins/sandbox-providers/cloudflare/bridge-template/src/helpers.ts
 * ABOUT: helpers.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - helpers.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: helpers.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/cloudflare/bridge-template/src/helpers.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function normalizeLeaseIdPart(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function buildLeaseSandboxId(input: {
  environmentId: string;
  runId: string;
  reuseLease: boolean;
  normalizeId: boolean;
  randomId?: string;
}): string {
  const base = input.reuseLease
    ? `pc-env-${input.environmentId}`
    : `pc-${input.runId}-${input.randomId ?? crypto.randomUUID().slice(0, 8)}`;
  return input.normalizeId ? normalizeLeaseIdPart(base) : base;
}

export function buildSentinelPath(remoteCwd: string): string {
  return `${remoteCwd.replace(/\/+$/, "")}/.paperclip-lease.json`;
}

export function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? "";
  const message = error instanceof Error ? error.message : String(error);
  return /timeout/i.test(name) || /timed out|timeout/i.test(message);
}

// Single-quote `value` for safe inclusion in a `sh -c` script. Single
// quotes inside the value are escaped via the standard `'"'"'` dance.
// Used by both `routes.ts` and `exec.ts` — keep one copy here so updates
// (e.g. handling additional shell special characters) stay in sync.
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
// [END: module]
