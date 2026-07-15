// [START: module]
import { bandRank, type RiskBand } from "./approval-risk.js";

const SYSTEM_PUSH_MIN_BAND: RiskBand = "high";

export type DeliveryPrefs = {
  minBand: RiskBand;
  quietStart: string | null;
  quietEnd: string | null;
  timezone: string | null;
};

function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesInTz(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  } catch {
    return null;
  }
}

function inQuietWindow(prefs: DeliveryPrefs, now: Date): boolean {
  if (!prefs.quietStart || !prefs.quietEnd || !prefs.timezone) return false;
  const start = parseHHMM(prefs.quietStart);
  const end = parseHHMM(prefs.quietEnd);
  const mins = minutesInTz(now, prefs.timezone);
  if (start === null || end === null || mins === null || start === end) return false;
  return start < end ? mins >= start && mins < end : mins >= start || mins < end;
}

/** Decide whether one user should receive a push for `band` at `now`, given their prefs. Pure. */
export function shouldPushToUser({
  prefs,
  band,
  now,
}: {
  prefs: DeliveryPrefs | null;
  band: RiskBand;
  now: Date;
}): boolean {
  const userFloor = prefs?.minBand ?? SYSTEM_PUSH_MIN_BAND;
  const floor = bandRank(userFloor) > bandRank(SYSTEM_PUSH_MIN_BAND) ? userFloor : SYSTEM_PUSH_MIN_BAND;
  if (bandRank(band) < bandRank(floor)) return false;
  if (band === "critical") return true;
  if (prefs && inQuietWindow(prefs, now)) return false;
  return true;
}
// [END: module]
