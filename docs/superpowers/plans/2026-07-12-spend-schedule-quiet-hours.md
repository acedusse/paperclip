# Spend-Schedule / Quiet Hours + Manual Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each company time-of-day concurrency profiles ("quiet hours") plus one-click "boost / quiet now" manual overrides, both enforced through the existing effective-cap resolver.

**Architecture:** Fill the two reserved cap-writer slots — `manual-override` (idx 2) and `schedule` (idx 3) — below the predictive breaker. Both writers are pure and read pre-computed caps from `CapContext`; the caps are computed once per company per admission tick by a new stateless evaluator (`schedule-cap.ts`) that reads window config + a manual-override cap/expiry off the company row. No fired routines, no persisted schedule state. Company-scoped only; instance sites are untouched.

**Tech Stack:** TypeScript, Node, Drizzle ORM (Postgres), Zod (`@paperclipai/shared`), Vitest, React + TanStack Query (`ui/`).

## Global Constraints

- **Weekday convention: Sun=0 … Sat=6** everywhere (matches `getZonedMinuteParts` / `cron.ts`). `ScheduleWindow.days` uses this.
- **Minute-of-day range: `0..1439`.** `endMinute <= startMinute` means the window **wraps past midnight** (and `start === end` = full 24h); there is no representable empty window.
- **Overlap rule:** when multiple windows are active, the effective schedule cap is `min(maxConcurrentRuns)` across them (most-restrictive-wins). A cap-0 ("paused") window dominates.
- **Precedence (frozen, do not reorder):** `panic-drain > predictive-breaker > manual-override > schedule > configured-default`.
- **Company scope only.** No instance-level schedule/override. Instance resolver sites keep `PHASE1_WRITERS`.
- **Concurrency cap only.** No `maxBurnPerHour` in this phase.
- **Fail-open:** any schedule/override lookup failure in the admission path must fall back to "no opinion" (`null`), never block admission — mirror the existing `try/catch` around company cap resolution.
- **Next migration is `0112`.** drizzle-kit is unusable past `0098`; migrations are hand-written `.sql` + a `_journal.json` entry.
- **New files get the repo's nav header block** (the `FILE:/ABOUT:/SECTIONS:/[META]/[START]/[END]` comment banner) — copy the shape from any sibling file (e.g. `effective-cap-resolver.ts`).
- **Run server tests:** `pnpm --filter @paperclipai/server test -- <path>`; shared: `pnpm --filter @paperclipai/shared test`; ui: `pnpm --filter @paperclipai/ui test -- <path>`. (If `pnpm --filter` is not wired, `cd server && pnpm vitest run <path>`.)

---

## Task 1: Extract shared zoned-time primitives (`zoned-time.ts`)

`getZonedMinuteParts`, the formatter cache, and `WEEKDAY_INDEX` are private to `routines.ts` (only `nextCronTickInTimeZone` is exported). The schedule evaluator needs the same zoned weekday+minute logic without depending on the large `routines.ts` service. Extract the primitives into a focused module and re-point `routines.ts` at it.

**Files:**
- Create: `server/src/services/zoned-time.ts`
- Create: `server/src/services/zoned-time.test.ts`
- Modify: `server/src/services/routines.ts` (remove the local copies at ~L83, ~L123–162; import from the new module; keep `assertTimeZone` delegating to `isValidTimeZone`)

**Interfaces:**
- Produces:
  - `WEEKDAY_INDEX: Record<string, number>` (`{ Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }`)
  - `type ZonedMinuteParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number }`
  - `getZonedMinuteParts(date: Date, timeZone: string): ZonedMinuteParts`
  - `isValidTimeZone(timeZone: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `server/src/services/zoned-time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getZonedMinuteParts, isValidTimeZone, WEEKDAY_INDEX } from "./zoned-time.js";

describe("zoned-time", () => {
  it("maps a UTC instant into the target timezone's wall clock + weekday", () => {
    // 2026-07-12T13:30:00Z is Sunday 09:30 in America/New_York (EDT, UTC-4)
    const parts = getZonedMinuteParts(new Date("2026-07-12T13:30:00Z"), "America/New_York");
    expect(parts.weekday).toBe(WEEKDAY_INDEX.Sun); // 0
    expect(parts.hour).toBe(9);
    expect(parts.minute).toBe(30);
  });

  it("honors DST: the same wall-clock hour maps to different UTC offsets", () => {
    // Winter (EST, UTC-5): 14:30Z -> 09:30 local
    const winter = getZonedMinuteParts(new Date("2026-01-11T14:30:00Z"), "America/New_York");
    expect(winter.hour).toBe(9);
    expect(winter.minute).toBe(30);
  });

  it("validates timezones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- src/services/zoned-time.test.ts`
Expected: FAIL — `Cannot find module './zoned-time.js'`.

- [ ] **Step 3: Create the module**

Create `server/src/services/zoned-time.ts` (add the nav header banner like sibling files, then):

```ts
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
```

- [ ] **Step 4: Re-point `routines.ts` at the shared module**

In `server/src/services/routines.ts`:
- Delete the local `WEEKDAY_INDEX` const (~L83–91), the `zonedMinuteFormatterCache` + `getZonedMinuteFormatter` (~L123–142), and the local `getZonedMinuteParts` (~L144–162).
- Add an import near the other service imports: `import { getZonedMinuteParts, isValidTimeZone } from "./zoned-time.js";`
- Replace the body of `assertTimeZone` (keep it throwing `unprocessable`):

```ts
function assertTimeZone(timeZone: string) {
  if (!isValidTimeZone(timeZone)) {
    throw unprocessable(`Invalid timezone: ${timeZone}`);
  }
}
```

(`matchesCronMinute` already calls `getZonedMinuteParts` — it now resolves to the import. Leave it unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/server test -- src/services/zoned-time.test.ts src/services/routines-formatter-cache.test.ts`
Expected: PASS (new module tests pass; the existing routines formatter-cache test still passes against the re-pointed code).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/zoned-time.ts server/src/services/zoned-time.test.ts server/src/services/routines.ts
git commit -m "refactor(zoned-time): extract shared zoned-minute primitives from routines"
```

---

## Task 2: DB migration + companies columns (`0112`)

**Files:**
- Create: `packages/db/src/migrations/0112_spend_schedule.sql`
- Modify: `packages/db/src/migrations/meta/_journal.json` (append entry, `idx: 112`)
- Modify: `packages/db/src/schema/companies.ts` (add `jsonb` import + four columns)

**Interfaces:**
- Produces columns on `companies`: `scheduleWindows` (jsonb, default `[]`, not null), `scheduleTimezone` (text, nullable), `manualCapOverride` (integer, nullable), `manualCapOverrideExpiresAt` (timestamptz, nullable).

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/src/migrations/0112_spend_schedule.sql`:

```sql
ALTER TABLE "companies" ADD COLUMN "schedule_windows" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "schedule_timezone" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "manual_cap_override" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "manual_cap_override_expires_at" timestamp with time zone;
```

- [ ] **Step 2: Append the journal entry**

In `packages/db/src/migrations/meta/_journal.json`, add after the `0111_predictive_breaker` object in the `entries` array (mind the trailing comma on the previous entry):

```json
    {
      "idx": 112,
      "version": "7",
      "when": 1781902700000,
      "tag": "0112_spend_schedule",
      "breakpoints": true
    }
```

- [ ] **Step 3: Add the schema columns**

In `packages/db/src/schema/companies.ts`, extend the pgTable import to include `jsonb`:

```ts
import { pgTable, uuid, text, integer, timestamp, boolean, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
```

Add these columns inside the `companies` column object, next to `breakerHorizonMinutes` (line ~41):

```ts
    scheduleWindows: jsonb("schedule_windows")
      .$type<
        Array<{
          id: string;
          label: string;
          days: number[];
          startMinute: number;
          endMinute: number;
          maxConcurrentRuns: number;
        }>
      >()
      .notNull()
      .default([]),
    scheduleTimezone: text("schedule_timezone"),
    manualCapOverride: integer("manual_cap_override"),
    manualCapOverrideExpiresAt: timestamp("manual_cap_override_expires_at", { withTimezone: true }),
```

(The inline `$type` avoids a `packages/db` → `packages/shared` dependency; the shared `ScheduleWindow` type in Task 3 is structurally identical.)

- [ ] **Step 4: Verify the schema compiles**

Run: `pnpm --filter @paperclipai/db build`
Expected: PASS (TypeScript compiles; no drizzle-kit generation needed — the migration is hand-written).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/0112_spend_schedule.sql packages/db/src/migrations/meta/_journal.json packages/db/src/schema/companies.ts
git commit -m "feat(db): schedule windows + manual cap override columns on companies (0112)"
```

---

## Task 3: Shared `ScheduleWindow` type, validators, company fields

**Files:**
- Create: `packages/shared/src/validators/schedule.ts`
- Create: `packages/shared/src/validators/schedule.test.ts`
- Modify: `packages/shared/src/index.ts` (or the barrel that re-exports validators — confirm and add `export * from "./validators/schedule.js";`)
- Modify: `packages/shared/src/types/company.ts` (add four optional fields to `Company`)
- Modify: `packages/shared/src/validators/company.ts` (extend `updateCompanySchema`)

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `scheduleWindowSchema`, `type ScheduleWindow = z.infer<typeof scheduleWindowSchema>`
  - `scheduleWindowsSchema` (`z.array(...).max(24)`)
  - `capOverrideSchema`, `type CapOverride = z.infer<typeof capOverrideSchema>` (`{ cap: number; durationMinutes: number }`)
  - `Company` gains `scheduleWindows?`, `scheduleTimezone?`, `manualCapOverride?`, `manualCapOverrideExpiresAt?`.

- [ ] **Step 1: Write the failing validator test**

Create `packages/shared/src/validators/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scheduleWindowSchema, scheduleWindowsSchema, capOverrideSchema } from "./schedule.js";

const good = {
  id: "w1",
  label: "Business hours",
  days: [1, 2, 3, 4, 5],
  startMinute: 540, // 09:00
  endMinute: 1020, // 17:00
  maxConcurrentRuns: 4,
};

describe("scheduleWindowSchema", () => {
  it("accepts a well-formed window", () => {
    expect(scheduleWindowSchema.parse(good)).toEqual(good);
  });
  it("rejects out-of-range weekdays", () => {
    expect(scheduleWindowSchema.safeParse({ ...good, days: [7] }).success).toBe(false);
  });
  it("rejects an empty days list", () => {
    expect(scheduleWindowSchema.safeParse({ ...good, days: [] }).success).toBe(false);
  });
  it("rejects out-of-range minutes", () => {
    expect(scheduleWindowSchema.safeParse({ ...good, endMinute: 1440 }).success).toBe(false);
  });
  it("rejects a negative cap", () => {
    expect(scheduleWindowSchema.safeParse({ ...good, maxConcurrentRuns: -1 }).success).toBe(false);
  });
  it("accepts cap 0 (paused)", () => {
    expect(scheduleWindowSchema.safeParse({ ...good, maxConcurrentRuns: 0 }).success).toBe(true);
  });
});

describe("scheduleWindowsSchema", () => {
  it("rejects more than 24 windows", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...good, id: `w${i}` }));
    expect(scheduleWindowsSchema.safeParse(many).success).toBe(false);
  });
});

describe("capOverrideSchema", () => {
  it("accepts a boost", () => {
    expect(capOverrideSchema.parse({ cap: 20, durationMinutes: 120 })).toEqual({ cap: 20, durationMinutes: 120 });
  });
  it("accepts a quiet-now (cap 0)", () => {
    expect(capOverrideSchema.safeParse({ cap: 0, durationMinutes: 120 }).success).toBe(true);
  });
  it("rejects a non-positive duration", () => {
    expect(capOverrideSchema.safeParse({ cap: 5, durationMinutes: 0 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/shared test -- src/validators/schedule.test.ts`
Expected: FAIL — `Cannot find module './schedule.js'`.

- [ ] **Step 3: Create the validators**

Create `packages/shared/src/validators/schedule.ts` (add the nav header banner, then):

```ts
import { z } from "zod";

export const scheduleWindowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(100),
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .refine((d) => new Set(d).size === d.length, { message: "days must be unique" }),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  maxConcurrentRuns: z.number().int().min(0),
});

export type ScheduleWindow = z.infer<typeof scheduleWindowSchema>;

export const scheduleWindowsSchema = z.array(scheduleWindowSchema).max(24);

export const capOverrideSchema = z.object({
  cap: z.number().int().min(0),
  durationMinutes: z.number().int().positive().max(24 * 60),
});

export type CapOverride = z.infer<typeof capOverrideSchema>;
```

- [ ] **Step 4: Export from the barrel**

Find the shared package's public barrel (grep for where `validators/company.js` is re-exported):

Run: `grep -rn "validators/company" packages/shared/src/index.ts`

Add alongside it:

```ts
export * from "./validators/schedule.js";
```

- [ ] **Step 5: Add fields to the `Company` type**

In `packages/shared/src/types/company.ts`, add an import at the top and the four fields after `breakerHorizonMinutes` (line ~35):

```ts
import type { ScheduleWindow } from "../validators/schedule.js";
```

```ts
  scheduleWindows?: ScheduleWindow[];
  scheduleTimezone?: string | null;
  manualCapOverride?: number | null;
  manualCapOverrideExpiresAt?: Date | null;
```

- [ ] **Step 6: Extend `updateCompanySchema`**

In `packages/shared/src/validators/company.ts`, add the import and extend the `.extend({...})` block (after `breakerHorizonMinutes`, line ~57):

```ts
import { scheduleWindowsSchema } from "./schedule.js";
```

```ts
    scheduleWindows: scheduleWindowsSchema.optional(),
    scheduleTimezone: z.string().min(1).nullable().optional(),
```

(Timezone *validity* and the "tz required when windows present" cross-field rule are enforced at the route in Task 9 via the server's `isValidTimeZone`, keeping tz-database knowledge server-side.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/shared test -- src/validators/schedule.test.ts`
Expected: PASS. Also run `pnpm --filter @paperclipai/shared build` to confirm the type additions compile.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/validators/schedule.ts packages/shared/src/validators/schedule.test.ts packages/shared/src/index.ts packages/shared/src/types/company.ts packages/shared/src/validators/company.ts
git commit -m "feat(shared): ScheduleWindow + cap-override validators; company schedule fields"
```

---

## Task 4: Schedule evaluator (`activeScheduleCap`, `activeManualOverride`)

**Files:**
- Create: `server/src/services/schedule-cap.ts`
- Create: `server/src/services/schedule-cap.test.ts`

**Interfaces:**
- Consumes: `getZonedMinuteParts` (Task 1); `ScheduleWindow` (Task 3).
- Produces:
  - `activeScheduleCap(windows: ScheduleWindow[] | null | undefined, timezone: string | null | undefined, now: Date): number | null`
  - `activeManualOverride(company: { manualCapOverride?: number | null; manualCapOverrideExpiresAt?: Date | null }, now: Date): number | null`

- [ ] **Step 1: Write the failing test**

Create `server/src/services/schedule-cap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { activeScheduleCap, activeManualOverride } from "./schedule-cap.js";
import type { ScheduleWindow } from "@paperclipai/shared";

const w = (over: Partial<ScheduleWindow>): ScheduleWindow => ({
  id: "w",
  label: "win",
  days: [0, 1, 2, 3, 4, 5, 6],
  startMinute: 540,
  endMinute: 1020,
  maxConcurrentRuns: 4,
  ...over,
});

const tz = "America/New_York";

describe("activeScheduleCap", () => {
  it("returns null with no timezone, no windows, or empty windows", () => {
    expect(activeScheduleCap([w({})], null, new Date())).toBeNull();
    expect(activeScheduleCap(null, tz, new Date())).toBeNull();
    expect(activeScheduleCap([], tz, new Date())).toBeNull();
  });

  it("applies a window inside its range and gives no opinion outside it", () => {
    // 2026-07-13 is a Monday. 14:00Z = 10:00 EDT -> inside 09:00–17:00.
    expect(activeScheduleCap([w({})], tz, new Date("2026-07-13T14:00:00Z"))).toBe(4);
    // 22:00Z = 18:00 EDT -> outside.
    expect(activeScheduleCap([w({})], tz, new Date("2026-07-13T22:00:00Z"))).toBeNull();
  });

  it("treats start inclusive and end exclusive", () => {
    // 13:00Z = 09:00 EDT exactly -> inside; end 17:00 exactly -> outside.
    expect(activeScheduleCap([w({})], tz, new Date("2026-07-13T13:00:00Z"))).toBe(4);
    expect(activeScheduleCap([w({})], tz, new Date("2026-07-13T21:00:00Z"))).toBeNull();
  });

  it("only applies on listed days", () => {
    const weekdaysOnly = w({ days: [1, 2, 3, 4, 5] });
    // 2026-07-12 is Sunday (day 0) -> excluded even at 10:00 local.
    expect(activeScheduleCap([weekdaysOnly], tz, new Date("2026-07-12T14:00:00Z"))).toBeNull();
  });

  it("handles a midnight-wrapping window on both sides of midnight", () => {
    // Fri 22:00 -> Sat 02:00, days lists Friday (5).
    const overnight = w({ days: [5], startMinute: 1320, endMinute: 120, maxConcurrentRuns: 2 });
    // Fri 2026-07-17 23:00 EDT = 2026-07-18T03:00Z -> inside (start segment).
    expect(activeScheduleCap([overnight], tz, new Date("2026-07-18T03:00:00Z"))).toBe(2);
    // Sat 2026-07-18 01:00 EDT = 2026-07-18T05:00Z -> inside (wrapped tail from Friday's window).
    expect(activeScheduleCap([overnight], tz, new Date("2026-07-18T05:00:00Z"))).toBe(2);
    // Sat 2026-07-18 03:00 EDT = 2026-07-18T07:00Z -> outside.
    expect(activeScheduleCap([overnight], tz, new Date("2026-07-18T07:00:00Z"))).toBeNull();
  });

  it("treats start === end as a full 24h window on its days", () => {
    const allDay = w({ days: [1], startMinute: 0, endMinute: 0, maxConcurrentRuns: 0 });
    // Monday any time -> active, cap 0.
    expect(activeScheduleCap([allDay], tz, new Date("2026-07-13T14:00:00Z"))).toBe(0);
  });

  it("takes the most-restrictive cap on overlap", () => {
    const a = w({ maxConcurrentRuns: 4 });
    const b = w({ id: "b", maxConcurrentRuns: 1 });
    expect(activeScheduleCap([a, b], tz, new Date("2026-07-13T14:00:00Z"))).toBe(1);
  });

  it("lets a cap-0 window dominate an overlap", () => {
    const a = w({ maxConcurrentRuns: 5 });
    const paused = w({ id: "p", maxConcurrentRuns: 0 });
    expect(activeScheduleCap([a, paused], tz, new Date("2026-07-13T14:00:00Z"))).toBe(0);
  });
});

describe("activeManualOverride", () => {
  const now = new Date("2026-07-12T12:00:00Z");
  it("returns the cap while unexpired", () => {
    expect(
      activeManualOverride({ manualCapOverride: 20, manualCapOverrideExpiresAt: new Date("2026-07-12T13:00:00Z") }, now),
    ).toBe(20);
  });
  it("returns null when expired (boundary is expired)", () => {
    expect(activeManualOverride({ manualCapOverride: 20, manualCapOverrideExpiresAt: now }, now)).toBeNull();
  });
  it("returns null when absent", () => {
    expect(activeManualOverride({ manualCapOverride: null, manualCapOverrideExpiresAt: null }, now)).toBeNull();
    expect(activeManualOverride({}, now)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- src/services/schedule-cap.test.ts`
Expected: FAIL — `Cannot find module './schedule-cap.js'`.

- [ ] **Step 3: Implement the evaluator**

Create `server/src/services/schedule-cap.ts` (nav header banner, then):

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/server test -- src/services/schedule-cap.test.ts`
Expected: PASS (all cases, including DST — the July dates are EDT and the January check in Task 1 covers EST).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/schedule-cap.ts server/src/services/schedule-cap.test.ts
git commit -m "feat(schedule-cap): stateless active-window + manual-override evaluators"
```

---

## Task 5: Next-transition lookahead (`nextScheduleTransition`)

**Files:**
- Modify: `server/src/services/schedule-cap.ts`
- Modify: `server/src/services/schedule-cap.test.ts`

**Interfaces:**
- Consumes: `activeScheduleCap` (Task 4).
- Produces: `nextScheduleTransition(windows: ScheduleWindow[] | null | undefined, timezone: string | null | undefined, now: Date, horizonDays?: number): { at: Date; cap: number | null } | null`

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/schedule-cap.test.ts`:

```ts
import { nextScheduleTransition } from "./schedule-cap.js";

describe("nextScheduleTransition", () => {
  const tz2 = "America/New_York";
  const win: ScheduleWindow = {
    id: "biz",
    label: "Business hours",
    days: [1, 2, 3, 4, 5],
    startMinute: 540, // 09:00
    endMinute: 1020, // 17:00
    maxConcurrentRuns: 4,
  };

  it("returns null when there are no windows", () => {
    expect(nextScheduleTransition([], tz2, new Date())).toBeNull();
    expect(nextScheduleTransition([win], null, new Date())).toBeNull();
  });

  it("finds the next boundary and the cap that takes effect", () => {
    // Monday 2026-07-13 08:00 EDT = 12:00Z -> before the window opens.
    const before = nextScheduleTransition([win], tz2, new Date("2026-07-13T12:00:00Z"));
    expect(before?.cap).toBe(4);
    // Boundary is 09:00 EDT = 13:00Z.
    expect(before?.at.toISOString()).toBe("2026-07-13T13:00:00.000Z");
  });

  it("finds the closing boundary from inside the window", () => {
    // Monday 10:00 EDT = 14:00Z -> inside; next change is the 17:00 close -> no opinion (null).
    const after = nextScheduleTransition([win], tz2, new Date("2026-07-13T14:00:00Z"));
    expect(after?.cap).toBeNull();
    expect(after?.at.toISOString()).toBe("2026-07-13T21:00:00.000Z"); // 17:00 EDT
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- src/services/schedule-cap.test.ts`
Expected: FAIL — `nextScheduleTransition` is not exported.

- [ ] **Step 3: Implement**

Append to `server/src/services/schedule-cap.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/server test -- src/services/schedule-cap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/schedule-cap.ts server/src/services/schedule-cap.test.ts
git commit -m "feat(schedule-cap): next-transition lookahead for operator readout"
```

---

## Task 6: Resolver writers (`manualOverrideWriter`, `scheduleWriter`)

**Files:**
- Modify: `server/src/services/effective-cap-resolver.ts`
- Modify: `server/src/services/effective-cap-resolver.test.ts`

**Interfaces:**
- Consumes: `CapContext`, `CapWriter`, `CAP_WRITER_PRECEDENCE` (existing).
- Produces:
  - `CapContext.manualOverrideCap?: number | null`, `CapContext.scheduleCap?: number | null`
  - `manualOverrideWriter`, `scheduleWriter` (`CapWriter`)
  - `PHASE3B_COMPANY_WRITERS: CapWriter[]`

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/effective-cap-resolver.test.ts` (and add `PHASE3B_COMPANY_WRITERS`, `manualOverrideWriter`, `scheduleWriter` to the existing import block):

```ts
describe("phase 3b writers", () => {
  it("manual-override writer returns its cap, else no opinion", () => {
    expect(manualOverrideWriter.resolve({ configuredMax: 10, manualOverrideCap: 25 })).toBe(25);
    expect(manualOverrideWriter.resolve({ configuredMax: 10, manualOverrideCap: 0 })).toBe(0);
    expect(manualOverrideWriter.resolve({ configuredMax: 10 })).toBeNull();
  });

  it("schedule writer returns its cap, else no opinion", () => {
    expect(scheduleWriter.resolve({ configuredMax: 10, scheduleCap: 4 })).toBe(4);
    expect(scheduleWriter.resolve({ configuredMax: 10, scheduleCap: 0 })).toBe(0);
    expect(scheduleWriter.resolve({ configuredMax: 10 })).toBeNull();
  });

  it("manual override beats schedule beats configured default", () => {
    const ctx = { configuredMax: 10, manualOverrideCap: 25, scheduleCap: 4 };
    expect(resolveEffectiveCap(ctx, PHASE3B_COMPANY_WRITERS)).toEqual({ cap: 25, source: "manual-override" });
    expect(resolveEffectiveCap({ configuredMax: 10, scheduleCap: 4 }, PHASE3B_COMPANY_WRITERS)).toEqual({
      cap: 4,
      source: "schedule",
    });
    expect(resolveEffectiveCap({ configuredMax: 10 }, PHASE3B_COMPANY_WRITERS)).toEqual({
      cap: 10,
      source: "configured-default",
    });
  });

  it("breaker HALT and panic-drain both outrank a manual boost", () => {
    expect(
      resolveEffectiveCap(
        { configuredMax: 10, manualOverrideCap: 25, breakerLevel: "halt" },
        PHASE3B_COMPANY_WRITERS,
      ),
    ).toEqual({ cap: 0, source: "predictive-breaker" });
    expect(
      resolveEffectiveCap(
        { configuredMax: 10, manualOverrideCap: 25, executionState: "draining" },
        PHASE3B_COMPANY_WRITERS,
      ),
    ).toEqual({ cap: 0, source: "panic-drain" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- src/services/effective-cap-resolver.test.ts`
Expected: FAIL — `manualOverrideWriter` / `scheduleWriter` / `PHASE3B_COMPANY_WRITERS` not exported.

- [ ] **Step 3: Implement the writers**

In `server/src/services/effective-cap-resolver.ts`, add the two `CapContext` fields:

```ts
export type CapContext = {
  configuredMax: number | null;
  executionState?: RunExecutionState;
  breakerLevel?: BreakerLevel;
  manualOverrideCap?: number | null;
  scheduleCap?: number | null;
};
```

Add the writers after `predictiveBreakerWriter`:

```ts
// Combo-01 Phase 3b: operator "boost / quiet now" override. Reads a pre-computed,
// unexpired override cap from the context (null when none/expired). Sits below the
// breaker, so a safety throttle/halt or a human panic always wins over a boost.
export const manualOverrideWriter: CapWriter = {
  name: "manual-override",
  precedence: CAP_WRITER_PRECEDENCE.indexOf("manual-override"),
  resolve: (ctx) => ctx.manualOverrideCap ?? null,
};

// Combo-01 Phase 3b: time-of-day schedule. Reads the currently-active window cap
// (most-restrictive-wins, computed at the resolver site); null outside every window.
export const scheduleWriter: CapWriter = {
  name: "schedule",
  precedence: CAP_WRITER_PRECEDENCE.indexOf("schedule"),
  resolve: (ctx) => ctx.scheduleCap ?? null,
};
```

Add the writer set after `PHASE3_COMPANY_WRITERS`:

```ts
// Company resolver sites use this set once schedule + manual override ship.
export const PHASE3B_COMPANY_WRITERS: CapWriter[] = [
  panicDrainWriter,
  predictiveBreakerWriter,
  manualOverrideWriter,
  scheduleWriter,
  configuredDefaultWriter,
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/server test -- src/services/effective-cap-resolver.test.ts`
Expected: PASS (the new suite and the existing precedence-lock test, which already lists both slot names).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/effective-cap-resolver.ts server/src/services/effective-cap-resolver.test.ts
git commit -m "feat(cap-resolver): manualOverrideWriter + scheduleWriter (Phase 3b slots)"
```

---

## Task 7: Round-trip schedule fields through the company read path

`companySelection` (the list + `getById` read path) is an explicit column allowlist and currently omits schedule/override fields — without this, they never reach the UI on a fresh load.

**Files:**
- Modify: `server/src/services/companies.ts` (extend `companySelection` ~L138–158)
- Modify: `server/src/__tests__/companies-service.test.ts`

**Interfaces:**
- Consumes: the `companies` schema columns (Task 2).
- Produces: `getById` / `list` company objects now include `scheduleWindows`, `scheduleTimezone`, `manualCapOverride`, `manualCapOverrideExpiresAt`.

- [ ] **Step 1: Write the failing test**

Add to `server/src/__tests__/companies-service.test.ts` a case asserting a freshly-created company reads back `scheduleWindows: []` and that an update persists a window. Match the file's existing harness (it already constructs the service + a test db). Representative assertions:

```ts
it("round-trips schedule windows and timezone through getById", async () => {
  const created = await service.create({ name: "Sched Co" });
  const win = { id: "w1", label: "Nights", days: [0, 6], startMinute: 0, endMinute: 360, maxConcurrentRuns: 8 };
  await service.update(created.id, { scheduleWindows: [win], scheduleTimezone: "America/New_York" });
  const fetched = await service.getById(created.id);
  expect(fetched?.scheduleWindows).toEqual([win]);
  expect(fetched?.scheduleTimezone).toBe("America/New_York");
  // default on a company that never set windows:
  const bare = await service.getById(created.id);
  expect(Array.isArray(bare?.scheduleWindows)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- src/__tests__/companies-service.test.ts`
Expected: FAIL — `fetched.scheduleWindows` is `undefined` (not selected). (If the suite skips without an embedded Postgres, note the skip and rely on the type/compile check in Step 4.)

- [ ] **Step 3: Extend `companySelection`**

In `server/src/services/companies.ts`, add to the `companySelection` object (after `maxConcurrentRuns`, line ~148):

```ts
    scheduleWindows: companies.scheduleWindows,
    scheduleTimezone: companies.scheduleTimezone,
    manualCapOverride: companies.manualCapOverride,
    manualCapOverrideExpiresAt: companies.manualCapOverrideExpiresAt,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/server test -- src/__tests__/companies-service.test.ts`
Expected: PASS (or skip-without-db). Also `pnpm --filter @paperclipai/server build` to confirm the selection type matches the enriched `Company`.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/companies.ts server/src/__tests__/companies-service.test.ts
git commit -m "feat(company): expose schedule + override fields on the company read path"
```

---

## Task 8: Heartbeat wiring — inject caps, override setters, next-transition

**Files:**
- Modify: `server/src/services/heartbeat.ts`
  - `AdmissionStatus` type (~L3410) — add `scheduleNextTransition`
  - new helper `loadCompanyScheduleContext` (near `loadCompanyBreakerLevel` ~L7360)
  - `getCompanyAdmissionStatus` (~L7606) — inject caps + next transition, switch writer set
  - the admission gate (~L8721–8732) — inject caps, switch writer set
  - new service methods `setCompanyManualCapOverride` / `clearCompanyManualCapOverride` (near `setCompanyRunExecutionState`)
  - export both from the service return object (near `getInstanceAdmissionStatus` at ~L13019)
- Modify: `server/src/services/heartbeat.*` test (add to the existing predictive-breaker integration or a new `schedule-admission.test.ts` — see Step 1)

**Interfaces:**
- Consumes: `activeScheduleCap`, `activeManualOverride`, `nextScheduleTransition` (Tasks 4–5); `PHASE3B_COMPANY_WRITERS` (Task 6); `logActivity` (existing).
- Produces:
  - `AdmissionStatus.scheduleNextTransition?: { at: Date; cap: number | null } | null`
  - `setCompanyManualCapOverride(companyId: string, cap: number, durationMinutes: number, actor?: ExecutionStateActor): Promise<void>`
  - `clearCompanyManualCapOverride(companyId: string, actor?: ExecutionStateActor): Promise<void>`

- [ ] **Step 1: Write the failing integration test**

Create `server/src/services/schedule-admission.test.ts`. Follow the existing predictive-breaker integration test's harness (embedded-Postgres guard + `describe.skipIf`). It should:

```ts
// (Mirror the setup helpers from predictive-breaker's integration test: skip without DB.)
it("shifts the company cap at a schedule window boundary", async () => {
  // Given a company with configuredMax 10 and a window that throttles to 2 during a
  // period that includes `now`, getCompanyAdmissionStatus reports cap 2, source "schedule".
  // Outside the window it reports cap 10, source "configured-default".
});

it("a manual boost supersedes the active schedule window and auto-reverts", async () => {
  // With an active throttle window (cap 2), setCompanyManualCapOverride(id, 25, 120)
  // -> admission status cap 25, source "manual-override".
  // After expiry (simulate by setting durationMinutes small / advancing) -> back to the window cap.
});

it("a breaker throttle still wins over a manual boost", async () => {
  // With breaker level "throttle" persisted and a manual boost of 25 and configuredMax 10,
  // the resolved source is "predictive-breaker", not "manual-override".
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- src/services/schedule-admission.test.ts`
Expected: FAIL (methods absent) — or SKIP without embedded Postgres. If skipped, rely on the unit tests (Tasks 4–6) plus the compile check for wiring correctness.

- [ ] **Step 3: Add `scheduleNextTransition` to `AdmissionStatus`**

At `server/src/services/heartbeat.ts` ~L3410:

```ts
export type AdmissionStatus = {
  cap: number | null;
  source: string;
  running: number;
  queued: number;
  runExecutionState: RunExecutionState;
  breakerLevel: BreakerLevel;
  scheduleNextTransition?: { at: Date; cap: number | null } | null;
};
```

- [ ] **Step 4: Add imports and the schedule-context loader**

Add near the other service imports:

```ts
import { activeScheduleCap, activeManualOverride, nextScheduleTransition } from "./schedule-cap.js";
import { PHASE3B_COMPANY_WRITERS } from "./effective-cap-resolver.js";
```

Add a loader next to `loadCompanyBreakerLevel` (~L7360). It reads only the four columns and computes both caps in one round-trip:

```ts
async function loadCompanyScheduleContext(
  companyId: string,
  now: Date,
): Promise<{ scheduleCap: number | null; manualOverrideCap: number | null }> {
  const [row] = await db
    .select({
      scheduleWindows: companies.scheduleWindows,
      scheduleTimezone: companies.scheduleTimezone,
      manualCapOverride: companies.manualCapOverride,
      manualCapOverrideExpiresAt: companies.manualCapOverrideExpiresAt,
    })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!row) return { scheduleCap: null, manualOverrideCap: null };
  return {
    scheduleCap: activeScheduleCap(row.scheduleWindows, row.scheduleTimezone, now),
    manualOverrideCap: activeManualOverride(row, now),
  };
}
```

- [ ] **Step 5: Wire `getCompanyAdmissionStatus`**

Replace the body of `getCompanyAdmissionStatus` (~L7606) so it injects the two caps, switches to `PHASE3B_COMPANY_WRITERS`, and reports the next transition:

```ts
async function getCompanyAdmissionStatus(companyId: string): Promise<AdmissionStatus> {
  const now = new Date();
  const runExecutionState = await getEffectiveExecutionState(companyId);
  const breakerLevel = await loadCompanyBreakerLevel(companyId);
  const { scheduleCap, manualOverrideCap } = await loadCompanyScheduleContext(companyId, now);
  const { cap, source } = resolveEffectiveCap(
    {
      configuredMax: await getCompanyMaxConcurrentRuns(companyId),
      executionState: runExecutionState,
      breakerLevel,
      manualOverrideCap,
      scheduleCap,
    },
    PHASE3B_COMPANY_WRITERS,
  );
  const [scheduleRow] = await db
    .select({ windows: companies.scheduleWindows, tz: companies.scheduleTimezone })
    .from(companies)
    .where(eq(companies.id, companyId));
  return {
    cap,
    source,
    running: await countRunningRunsForCompany(companyId),
    queued: await countQueuedRunsForCompany(companyId),
    runExecutionState,
    breakerLevel,
    scheduleNextTransition: scheduleRow
      ? nextScheduleTransition(scheduleRow.windows, scheduleRow.tz, now)
      : null,
  };
}
```

- [ ] **Step 6: Wire the admission gate**

At the company cap resolution inside the admission sweep (~L8721), inject the caps and switch the writer set. Keep the existing fail-open `try/catch`:

```ts
      let companyCap: number | null = null;
      try {
        const companyMax = await getCompanyMaxConcurrentRuns(agent.companyId);
        const breakerLevel = evaluatedBreakerLevel ?? (await loadCompanyBreakerLevel(agent.companyId));
        const { scheduleCap, manualOverrideCap } = await loadCompanyScheduleContext(
          agent.companyId,
          new Date(),
        );
        ({ cap: companyCap } = resolveEffectiveCap(
          {
            configuredMax: companyMax,
            executionState: await getEffectiveExecutionState(agent.companyId),
            breakerLevel,
            manualOverrideCap,
            scheduleCap,
          },
          PHASE3B_COMPANY_WRITERS,
        ));
      } catch (err) {
        logger.warn({ err }, "company admission cap lookup failed; falling back");
        companyCap = null;
      }
```

Remove the now-unused `PHASE3_COMPANY_WRITERS` import if nothing else references it (grep first: `grep -n PHASE3_COMPANY_WRITERS server/src/services/heartbeat.ts`).

- [ ] **Step 7: Add the manual-override service methods**

Next to `setCompanyRunExecutionState`, add (mirroring its actor + activity-log shape):

```ts
async function setCompanyManualCapOverride(
  companyId: string,
  cap: number,
  durationMinutes: number,
  actor: ExecutionStateActor = SYSTEM_EXECUTION_STATE_ACTOR,
): Promise<void> {
  const expiresAt = new Date(Date.now() + durationMinutes * 60_000);
  await db
    .update(companies)
    .set({ manualCapOverride: cap, manualCapOverrideExpiresAt: expiresAt, updatedAt: new Date() })
    .where(eq(companies.id, companyId));
  await logActivity(db, {
    companyId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId ?? null,
    runId: actor.runId ?? null,
    action: "company.manual_cap_override_set",
    entityType: "company",
    entityId: companyId,
    details: { cap, durationMinutes, expiresAt: expiresAt.toISOString() },
  });
}

async function clearCompanyManualCapOverride(
  companyId: string,
  actor: ExecutionStateActor = SYSTEM_EXECUTION_STATE_ACTOR,
): Promise<void> {
  await db
    .update(companies)
    .set({ manualCapOverride: null, manualCapOverrideExpiresAt: null, updatedAt: new Date() })
    .where(eq(companies.id, companyId));
  await logActivity(db, {
    companyId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId ?? null,
    runId: actor.runId ?? null,
    action: "company.manual_cap_override_cleared",
    entityType: "company",
    entityId: companyId,
    details: {},
  });
}
```

- [ ] **Step 8: Export the new methods**

In the service's returned object (where `getInstanceAdmissionStatus`, `getCompanyAdmissionStatus`, `setCompanyRunExecutionState` are exposed), add:

```ts
    setCompanyManualCapOverride,
    clearCompanyManualCapOverride,
```

- [ ] **Step 9: Run tests + typecheck**

Run: `pnpm --filter @paperclipai/server test -- src/services/schedule-admission.test.ts` (PASS or skip-without-db) and `pnpm --filter @paperclipai/server build`.
Expected: compiles; integration assertions pass when a DB is present.

- [ ] **Step 10: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/services/schedule-admission.test.ts
git commit -m "feat(heartbeat): inject schedule + manual-override caps; override setters"
```

---

## Task 9: Company routes — persist schedule config + cap-override endpoints

**Files:**
- Modify: `server/src/routes/companies.ts`

**Interfaces:**
- Consumes: `capOverrideSchema` (Task 3); `heartbeat.setCompanyManualCapOverride` / `clearCompanyManualCapOverride` (Task 8); server `isValidTimeZone` (Task 1).
- Produces: `POST /companies/:companyId/cap-override`, `DELETE /companies/:companyId/cap-override`; timezone validation on `PATCH /companies/:companyId`.

- [ ] **Step 1: Write the failing route test**

In the companies route test suite (grep for `describe(` in `server/src/routes/companies.test.ts` or the nearest existing route test; if none, add to `server/src/__tests__/`), assert:
- `POST /companies/:id/cap-override` with `{ cap: 20, durationMinutes: 120 }` returns 200 and an `AdmissionStatus` whose `source` is `"manual-override"` and `cap` is `20`.
- `DELETE /companies/:id/cap-override` returns 200 and clears it (source falls back).
- `PATCH /companies/:id` with `scheduleWindows: [<window>]` but an invalid `scheduleTimezone` returns 422.

(Reuse the suite's existing app/supertest harness and board-actor auth helper.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- src/routes/companies.test.ts`
Expected: FAIL — endpoints 404 / no tz validation.

- [ ] **Step 3: Add the endpoints and tz validation**

In `server/src/routes/companies.ts`, add `capOverrideSchema` to the `@paperclipai/shared` import and `isValidTimeZone` to the `../services/zoned-time.js` import. Add the two endpoints next to the `execution-state` route (~L174):

```ts
  router.post(
    "/:companyId/cap-override",
    validate(capOverrideSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      assertBoard(req);
      const actor = getActorInfo(req);
      await heartbeat.setCompanyManualCapOverride(
        companyId,
        req.body.cap,
        req.body.durationMinutes,
        actor,
      );
      res.json(await heartbeat.getCompanyAdmissionStatus(companyId));
    },
  );

  router.delete("/:companyId/cap-override", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const actor = getActorInfo(req);
    await heartbeat.clearCompanyManualCapOverride(companyId, actor);
    res.json(await heartbeat.getCompanyAdmissionStatus(companyId));
  });
```

In the existing `PATCH /:companyId` handler, right after `body = updateCompanySchema.parse(req.body);` (~L404), enforce timezone validity and the "tz required when windows present" rule:

```ts
    if (body.scheduleTimezone != null && !isValidTimeZone(body.scheduleTimezone)) {
      res.status(422).json({ error: `Invalid timezone: ${body.scheduleTimezone}` });
      return;
    }
    if (body.scheduleWindows && body.scheduleWindows.length > 0 && !body.scheduleTimezone) {
      // A company may only have already-stored tz; require it to be present or already set.
      const existing = await svc.getById(companyId);
      if (!existing?.scheduleTimezone) {
        res.status(422).json({ error: "scheduleTimezone is required when scheduleWindows are set" });
        return;
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/server test -- src/routes/companies.test.ts`
Expected: PASS. Also `pnpm --filter @paperclipai/server build`.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/companies.ts server/src/routes/companies.test.ts
git commit -m "feat(routes): cap-override endpoints + schedule timezone validation"
```

---

## Task 10: UI — schedule editor, presets, manual-override controls

**Files:**
- Modify: `ui/src/api/companies.ts` (add `setCapOverride` / `clearCapOverride`)
- Modify: `ui/src/pages/CompanySettings.tsx` (schedule editor + presets + boost/quiet-now)
- Modify: the company update mutation call sites to include `scheduleWindows` / `scheduleTimezone`

**Interfaces:**
- Consumes: `companiesApi.update` (existing), the new `/cap-override` endpoints (Task 9), `Company.scheduleWindows` / `scheduleTimezone` (Task 3/7), `AdmissionStatus` (Task 8).
- Produces: operator UI. Presets are local templates (see below).

- [ ] **Step 1: Add API client methods**

In `ui/src/api/companies.ts`, add to the `companiesApi` object:

```ts
  setCapOverride: (companyId: string, cap: number, durationMinutes: number) =>
    api.post<AdmissionStatus>(`/companies/${companyId}/cap-override`, { cap, durationMinutes }),
  clearCapOverride: (companyId: string) =>
    api.delete<AdmissionStatus>(`/companies/${companyId}/cap-override`),
```

Ensure the `update` method's payload type includes `scheduleWindows` / `scheduleTimezone` (it forwards `UpdateCompany`, so it already does once Task 3 lands — otherwise widen the inline type).

- [ ] **Step 2: Define presets (local template constants)**

At the top of `ui/src/pages/CompanySettings.tsx`, add:

```ts
import type { ScheduleWindow } from "@paperclipai/shared";

type SchedulePreset = { key: string; label: string; windows: (throttleCap: number) => ScheduleWindow[] };

const SCHEDULE_PRESETS: SchedulePreset[] = [
  { key: "always-full", label: "Always full", windows: () => [] },
  {
    key: "business-hours-throttle",
    label: "Business-hours throttle",
    windows: (cap) => [
      { id: "biz", label: "Business hours", days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020, maxConcurrentRuns: cap },
    ],
  },
  {
    key: "nights-weekends",
    label: "Nights & weekends only",
    windows: (cap) => [
      { id: "weekday-day", label: "Weekday daytime", days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020, maxConcurrentRuns: cap },
    ],
  },
  {
    key: "paused",
    label: "Paused",
    windows: () => [
      { id: "paused", label: "Paused", days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 0, maxConcurrentRuns: 0 },
    ],
  },
];
```

- [ ] **Step 3: Add schedule + override state, hydrated from the company**

Alongside the existing breaker state (~L62), add:

```ts
const [scheduleWindows, setScheduleWindows] = useState<ScheduleWindow[]>([]);
const [scheduleTimezone, setScheduleTimezone] = useState("");
```

In the hydrate `useEffect` (~L69, where breaker fields are read from `selectedCompany`), add:

```ts
setScheduleWindows(selectedCompany.scheduleWindows ?? []);
setScheduleTimezone(selectedCompany.scheduleTimezone ?? "");
```

- [ ] **Step 4: Include schedule fields in the save payload**

In the update mutation payload (where `maxConcurrentRuns` / breaker fields are sent), add:

```ts
scheduleWindows,
scheduleTimezone: scheduleTimezone.trim() === "" ? null : scheduleTimezone.trim(),
```

- [ ] **Step 5: Render the editor**

Add a "Spend schedule / quiet hours" section near the admission controls:
- A timezone text input bound to `scheduleTimezone` (placeholder `America/New_York`).
- A preset button row: each `SCHEDULE_PRESETS` button calls `setScheduleWindows(preset.windows(2))`.
- A window list: for each window, inputs for label, a 7-checkbox day selector (Sun–Sat → indices 0–6), start/end time (`<input type="time">` converted to minute-of-day via `h*60+m`), and a `maxConcurrentRuns` number input; a remove button. An "Add window" button appends a blank window (`{ id: crypto.randomUUID(), label: "New window", days: [1,2,3,4,5], startMinute: 540, endMinute: 1020, maxConcurrentRuns: 2 }`).
- Manual override controls: a cap input + a duration select (30m / 2h / 8h) with a "Boost" and a "Quiet now" (cap 0) button calling `companiesApi.setCapOverride(id, cap, minutes)`, and a "Clear override" button calling `companiesApi.clearCapOverride(id)`. On success, invalidate the admission-status query.

Time↔minute helpers (add near the presets):

```ts
const minuteToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const timeToMinute = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
```

- [ ] **Step 6: Test the presets/helpers**

Add `ui/src/pages/CompanySettings.schedule.test.ts` (pure-logic unit test — no full render needed):

```ts
import { describe, expect, it } from "vitest";
import { SCHEDULE_PRESETS, minuteToTime, timeToMinute } from "./CompanySettings"; // export these

describe("schedule presets & helpers", () => {
  it("Paused preset is a full-day cap-0 window on all days", () => {
    const paused = SCHEDULE_PRESETS.find((p) => p.key === "paused")!.windows(2);
    expect(paused).toHaveLength(1);
    expect(paused[0]).toMatchObject({ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 0, maxConcurrentRuns: 0 });
  });
  it("Always full clears windows", () => {
    expect(SCHEDULE_PRESETS.find((p) => p.key === "always-full")!.windows(2)).toEqual([]);
  });
  it("round-trips minute<->time", () => {
    expect(timeToMinute("09:30")).toBe(570);
    expect(minuteToTime(570)).toBe("09:30");
  });
});
```

Export `SCHEDULE_PRESETS`, `minuteToTime`, `timeToMinute` from `CompanySettings.tsx` for the test.

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @paperclipai/ui test -- src/pages/CompanySettings.schedule.test.ts` and `pnpm --filter @paperclipai/ui build`.
Expected: PASS + compiles.

- [ ] **Step 8: Commit**

```bash
git add ui/src/api/companies.ts ui/src/pages/CompanySettings.tsx ui/src/pages/CompanySettings.schedule.test.ts
git commit -m "feat(ui): company schedule editor, presets, and boost/quiet-now controls"
```

---

## Task 11: UI — admission line badge + next-transition readout

**Files:**
- Modify: `ui/src/components/AdmissionStatusLine.tsx`
- Modify: `ui/src/api/instanceSettings.ts` (the `AdmissionStatus` type mirror — add `scheduleNextTransition`)
- Create: `ui/src/components/AdmissionStatusLine.test.tsx`

**Interfaces:**
- Consumes: `AdmissionStatus` (with `source` + `scheduleNextTransition`).
- Produces: a schedule/override badge and a "next transition" line.

- [ ] **Step 1: Extend the UI `AdmissionStatus` type**

In `ui/src/api/instanceSettings.ts`, add to the `AdmissionStatus` type:

```ts
  scheduleNextTransition?: { at: string; cap: number | null } | null;
```

(JSON serializes `Date` → ISO string over the wire, hence `at: string`.)

- [ ] **Step 2: Write the failing component test**

Create `ui/src/components/AdmissionStatusLine.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdmissionStatusLine } from "./AdmissionStatusLine";

const base = { cap: 4, running: 1, queued: 0, runExecutionState: "running", breakerLevel: "normal" } as const;

describe("AdmissionStatusLine", () => {
  it("shows a schedule badge when the schedule sets the cap", () => {
    render(<AdmissionStatusLine status={{ ...base, source: "schedule" }} isError={false} />);
    expect(screen.getByText(/schedule/i)).toBeInTheDocument();
  });
  it("shows an override badge when a manual override sets the cap", () => {
    render(<AdmissionStatusLine status={{ ...base, source: "manual-override" }} isError={false} />);
    expect(screen.getByText(/override/i)).toBeInTheDocument();
  });
  it("renders the next transition when present", () => {
    render(
      <AdmissionStatusLine
        status={{ ...base, source: "configured-default", scheduleNextTransition: { at: "2026-07-13T13:00:00.000Z", cap: 2 } }}
        isError={false}
      />,
    );
    expect(screen.getByText(/→ 2 runs/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/ui test -- src/components/AdmissionStatusLine.test.tsx`
Expected: FAIL — no schedule/override badge or transition text.

- [ ] **Step 4: Implement the badges + readout**

In `ui/src/components/AdmissionStatusLine.tsx`, after `breakerBadge`, add:

```tsx
  const scheduleBadge =
    status.source === "schedule" ? (
      <span className="ml-1 font-medium text-sky-600 dark:text-sky-400">· schedule</span>
    ) : status.source === "manual-override" ? (
      <span className="ml-1 font-medium text-sky-600 dark:text-sky-400">· override</span>
    ) : null;

  const nextTransition = status.scheduleNextTransition
    ? (() => {
        const at = new Date(status.scheduleNextTransition.at);
        const when = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const target =
          status.scheduleNextTransition.cap === null ? "unlimited" : `${status.scheduleNextTransition.cap} runs`;
        return <span className="ml-1 text-muted-foreground">· → {target} at {when}</span>;
      })()
    : null;
```

And add `{scheduleBadge}{nextTransition}` to the returned span, after `{breakerBadge}`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @paperclipai/ui test -- src/components/AdmissionStatusLine.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/AdmissionStatusLine.tsx ui/src/api/instanceSettings.ts ui/src/components/AdmissionStatusLine.test.tsx
git commit -m "feat(ui): schedule/override badge + next-transition readout on admission line"
```

---

## Final verification

- [ ] **Full suite:** `pnpm --filter @paperclipai/server test` and `pnpm --filter @paperclipai/shared test` and `pnpm --filter @paperclipai/ui test` — all green (integration cases may skip without embedded Postgres).
- [ ] **Typecheck/build all touched packages:** `pnpm --filter @paperclipai/db build && pnpm --filter @paperclipai/shared build && pnpm --filter @paperclipai/server build && pnpm --filter @paperclipai/ui build`.
- [ ] **Manual smoke (optional, needs a running instance):** set a company timezone + a throttle window covering "now"; confirm the admission line shows `· schedule` and a lowered cap; hit "Boost"; confirm it flips to `· override` at the boosted cap; "Clear"; confirm it reverts.
- [ ] **Invoke the `verify` skill** to drive the schedule cap end-to-end in the real app before finishing the branch.
