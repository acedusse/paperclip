/**
 * FILE: server/src/lib/startup-failure-remedy.ts
 * ABOUT: startup-failure-remedy.ts (server lib module).
 *
 * SECTIONS:
 *   [TAG: module] - startup-failure-remedy.ts (server lib module).
 */
// ==========================================
// [META: module]
// INTENT: Turn fatal startup errors into an operator-facing next step.
// PSEUDOCODE: 1. Classify error. 2. Return remedy text or null.
// JSON_FLOW: {"file": "server/src/lib/startup-failure-remedy.ts", "imports": "none", "exports": "describeStartupFailureRemedy"}
// ==========================================
// [START: module]
const CLEAR_LEFTOVERS = "./stop.sh --all";

/** Node attaches `port` to listen errors; it is absent from the built-in typing. */
interface ListenError extends Error {
  code?: string;
  port?: number;
}

/**
 * Describe how to recover from a fatal startup failure, or null when the
 * failure has no known remedy and the logged error is all we can offer.
 */
export function describeStartupFailureRemedy(err: unknown): string | null {
  if (!(err instanceof Error)) return null;

  const { code, port } = err as ListenError;
  if (code === "EADDRINUSE") {
    const target = typeof port === "number" ? `Port ${port}` : "The configured port";
    return (
      `${target} is already in use by another process — most often a leftover Paperclip dev ` +
      `watcher from an earlier session.\nRun ${CLEAR_LEFTOVERS} to clear them, then start again.`
    );
  }

  if (err.message.includes(CLEAR_LEFTOVERS)) {
    return err.message;
  }

  return null;
}
// [END: module]
