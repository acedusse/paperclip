/**
 * FILE: ui/src/lib/vite-watch.ts
 * ABOUT: vite-watch.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - vite-watch.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: vite-watch.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/vite-watch.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
const TEST_DIRECTORY_NAMES = new Set([
  "__tests__",
  "_tests",
  "test",
  "tests",
]);

const TEST_FILE_BASENAME_RE = /\.(test|spec)\.[^/]+$/i;

export function shouldIgnoreUiDevWatchPath(watchedPath: string): boolean {
  const normalizedPath = String(watchedPath).replaceAll("\\", "/");
  if (normalizedPath.length === 0) return false;

  const segments = normalizedPath.split("/");
  const basename = segments.at(-1) ?? normalizedPath;

  return segments.some((segment) => TEST_DIRECTORY_NAMES.has(segment))
    || TEST_FILE_BASENAME_RE.test(basename);
}

export function createUiDevWatchOptions(currentWorkingDirectory: string) {
  return {
    ignored: shouldIgnoreUiDevWatchPath,
    // WSL2 /mnt/ drives don't support inotify — fall back to polling so HMR works.
    ...(currentWorkingDirectory.startsWith("/mnt/")
      ? { usePolling: true, interval: 1000 }
      : {}),
  };
}
// [END: module]
