/**
 * FILE: packages/adapter-utils/src/exclude-patterns.ts
 * ABOUT: exclude-patterns.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - exclude-patterns.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: exclude-patterns.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapter-utils/src/exclude-patterns.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function isRelativePathOrDescendant(relative: string, candidate: string): boolean {
  return relative === candidate || relative.startsWith(`${candidate}/`);
}

function pathContainsSegmentOrDescendant(relative: string, segment: string): boolean {
  return relative === segment ||
    relative.startsWith(`${segment}/`) ||
    relative.endsWith(`/${segment}`) ||
    relative.includes(`/${segment}/`);
}

export function excludePatternMatches(relative: string, pattern: string): boolean {
  if (pattern.startsWith("*/") && pattern.endsWith("/*")) {
    return pathContainsSegmentOrDescendant(relative, pattern.slice(2, -2));
  }
  if (pattern.startsWith("*/")) {
    return pathContainsSegmentOrDescendant(relative, pattern.slice(2));
  }
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    return relative.startsWith(`${base}/`);
  }
  return isRelativePathOrDescendant(relative, pattern);
}

export function shouldExcludePath(relative: string, exclude: readonly string[]): boolean {
  return exclude.some((entry) => excludePatternMatches(relative, entry));
}
// [END: module]
