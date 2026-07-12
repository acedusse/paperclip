/**
 * FILE: server/src/services/schedule-cap.ts
 * ABOUT: schedule-cap.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - schedule-cap.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: schedule-cap.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/schedule-cap.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { ScheduleWindow } from "@paperclipai/shared";
import { getZonedMinuteParts } from "./zoned-time.js";

// A window is active iff the current zoned weekday+minute-of-day falls in its range.
// endMinute <= startMinute means the window wraps past midnight (and start === end is
// a full 24h window). For the wrapped post-midnight tail, membership is tested against
// the *previous* day, because `days` lists the day the window starts on.
function isWindowActive(
  window: ScheduleWindow,
  weekday: number,
  prevWeekday: number,
  minuteOfDay: number,
): boolean {
  // start === end means a full 24h window on each listed day (spec: no empty window).
  if (window.startMinute === window.endMinute) {
    return window.days.includes(weekday);
  }
  const wraps = window.endMinute <= window.startMinute;
  if (!wraps) {
    return (
      window.days.includes(weekday) &&
      minuteOfDay >= window.startMinute &&
      minuteOfDay < window.endMinute
    );
  }
  const startSegment = window.days.includes(weekday) && minuteOfDay >= window.startMinute;
  const tailSegment = window.days.includes(prevWeekday) && minuteOfDay < window.endMinute;
  return startSegment || tailSegment;
}

export function activeScheduleCap(
  windows: ScheduleWindow[] | null | undefined,
  timezone: string | null | undefined,
  now: Date,
): number | null {
  if (!timezone || !windows || windows.length === 0) return null;
  const { weekday, hour, minute } = getZonedMinuteParts(now, timezone);
  const minuteOfDay = hour * 60 + minute;
  const prevWeekday = (weekday + 6) % 7;
  let cap: number | null = null;
  for (const window of windows) {
    if (isWindowActive(window, weekday, prevWeekday, minuteOfDay)) {
      cap = cap === null ? window.maxConcurrentRuns : Math.min(cap, window.maxConcurrentRuns);
    }
  }
  return cap;
}

// Forward-scan minute-by-minute (bounded) for the first minute at which the active
// schedule cap changes. Scanning in UTC and re-deriving zoned parts each step sidesteps
// error-prone reverse (zoned->UTC) conversion across DST. Runs only on the pollable
// status endpoint, never the hot admission gate, so the bounded cost is immaterial.
export function nextScheduleTransition(
  windows: ScheduleWindow[] | null | undefined,
  timezone: string | null | undefined,
  now: Date,
  horizonDays = 8,
): { at: Date; cap: number | null } | null {
  if (!timezone || !windows || windows.length === 0) return null;
  const current = activeScheduleCap(windows, timezone, now);
  const cursor = new Date(now.getTime());
  cursor.setUTCSeconds(0, 0);
  const limit = horizonDays * 24 * 60;
  for (let i = 0; i < limit; i += 1) {
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    const cap = activeScheduleCap(windows, timezone, cursor);
    if (cap !== current) {
      return { at: new Date(cursor.getTime()), cap };
    }
  }
  return null;
}

export function activeManualOverride(
  company: { manualCapOverride?: number | null; manualCapOverrideExpiresAt?: Date | null },
  now: Date,
): number | null {
  if (company.manualCapOverride == null || company.manualCapOverrideExpiresAt == null) {
    return null;
  }
  return company.manualCapOverrideExpiresAt.getTime() > now.getTime()
    ? company.manualCapOverride
    : null;
}
// [END: module]
