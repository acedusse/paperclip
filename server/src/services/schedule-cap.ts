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
