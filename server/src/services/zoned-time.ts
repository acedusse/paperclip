/**
 * FILE: server/src/services/zoned-time.ts
 * ABOUT: zoned-time.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - zoned-time.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: zoned-time.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/zoned-time.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ZonedMinuteParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

// Constructing an Intl.DateTimeFormat costs ~1ms of ICU work and callers invoke
// getZonedMinuteParts in tight minute-stepping loops, so cache one formatter per
// timezone. Formatter instances are immutable. See #8033.
const zonedMinuteFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedMinuteFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zonedMinuteFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    zonedMinuteFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function getZonedMinuteParts(date: Date, timeZone: string): ZonedMinuteParts {
  const formatter = getZonedMinuteFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_INDEX[map.weekday ?? ""];
  if (weekday == null) {
    throw new Error(`Unable to resolve weekday for timezone ${timeZone}`);
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday,
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    getZonedMinuteFormatter(timeZone).format(new Date());
    return true;
  } catch {
    return false;
  }
}
// [END: module]
