/**
 * FILE: ui/src/lib/query-placeholder-data.ts
 * ABOUT: query-placeholder-data.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - query-placeholder-data.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: query-placeholder-data.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/query-placeholder-data.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { PlaceholderDataFunction, QueryKey } from "@tanstack/react-query";

export function keepPreviousDataForSameQueryTail<TQueryData, TQueryKey extends QueryKey = QueryKey>(
  tail: unknown,
): PlaceholderDataFunction<TQueryData, Error, TQueryData, TQueryKey> {
  return (previousData, previousQuery) => {
    const previousKey = Array.isArray(previousQuery?.queryKey) ? previousQuery.queryKey : [];
    return previousKey.at(-1) === tail ? previousData : undefined;
  };
}
// [END: module]
