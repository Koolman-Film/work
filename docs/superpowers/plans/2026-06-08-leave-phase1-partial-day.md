# Leave Phase 1 — Partial-day leave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let employees take leave as a full day, morning-half, afternoon-half, or an arbitrary hourly time-segment — with each leave type declaring which granularities it allows, a company-wide config defining the half-day windows, and balances stored in minutes shown as a "X วัน Y ชม." hybrid.

**Architecture:** A single pure helper (`src/lib/leave/units.ts`) owns all minutes↔days conversion and segment math. The `LeaveRequest` gains a `unit` + optional `startTime`/`endTime` + frozen `chargedMinutes`. Submit validation and the approval transaction become unit-aware; approval writes `OnLeave` Attendance rows with real durations/segment times and enforces a per-date time-overlap guard (a date can hold two disjoint partial leaves). The `Attendance` partial-unique is relaxed to exclude `OnLeave`, so the live board / dashboard count on-leave employees distinctly.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 6 + PostgreSQL, Zod 4, Vitest, custom Tailwind UI components, `next-intl`. Run all commands with `/opt/homebrew/bin` on PATH (Node 24+/pnpm).

**Spec:** `docs/superpowers/specs/2026-06-08-leave-granularity-entitlements-ot-design.md` (§ Shared foundation, § Phase 1).

---

## File structure (Phase 1)

| File | Responsibility | New/Modify |
|------|----------------|-----------|
| `prisma/schema.prisma` | `LeaveConfig` model, `LeaveUnit` enum, `LeaveType.allow*`, `LeaveRequest.unit/startTime/endTime/chargedMinutes` | Modify |
| `prisma/migrations/0016_partial_day_leave/migration.sql` | DDL + relax Attendance unique + seed `LeaveConfig` | Create |
| `prisma/seed.ts` | seed one `LeaveConfig`; set `allowHalfDay/allowHourly` on seeded types | Modify |
| `src/lib/leave/units.ts` | pure unit math (the brain) | Create |
| `src/lib/leave/units.test.ts` | unit tests for the above | Create |
| `src/lib/leave/leave-config.ts` | read the singleton + derive standard day | Create |
| `src/lib/leave/actions.ts` | unit-aware submit validation | Modify |
| `src/lib/leave/admin.ts` | unit-aware approval + time-overlap guard + chargedMinutes | Modify |
| `src/app/(admin)/admin/settings/leave-types/actions.ts` | persist `allow*` flags | Modify |
| `src/app/(admin)/admin/settings/leave-types/leave-type-form.tsx` | three granularity checkboxes | Modify |
| `src/app/(admin)/admin/settings/leave-types/[id]/edit/page.tsx` | pass flags into the form | Modify |
| `src/app/(admin)/admin/settings/leave-config/page.tsx` + `actions.ts` | edit half-day windows | Create |
| `src/app/(admin)/admin/settings/settings-nav.tsx` | add the leave-config nav item | Modify |
| `src/lib/auth/permissions.ts` | add `settings.leave-config.manage` | Modify |
| `src/lib/auth/roles.ts` | grant the new perm to Admin | Modify |
| `src/app/(liff)/liff/leave/new/page.tsx` | select `allow*` flags + config | Modify |
| `src/app/(liff)/liff/leave/new/leave-new-form.tsx` | unit selector + time pickers + preview | Modify |
| `src/lib/attendance/live.ts` | distinct-by-employee on-leave list/count | Modify |
| `src/app/(admin)/admin/page.tsx` | distinct-by-employee on-leave count | Modify |

**Build order:** the pure helper first (everything depends on it), then schema/migration, then the server logic (submit/approve), then settings UI, then the LIFF form, then the on-leave-counting fixes. Each task ends with a commit.

---

## Task 1: `units.ts` — minutesOf / window math / formatDaysHours

**Files:**
- Create: `src/lib/leave/units.ts`
- Test: `src/lib/leave/units.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/leave/units.test.ts
import { describe, expect, it } from 'vitest';
import {
  minutesOf,
  windowMinutes,
  morningMinutes,
  afternoonMinutes,
  standardDayMinutes,
  formatDaysHours,
  type LeaveUnitConfig,
} from './units';

const CFG: LeaveUnitConfig = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

describe('time-of-day math', () => {
  it('minutesOf parses HH:MM to minutes-since-midnight', () => {
    expect(minutesOf('00:00')).toBe(0);
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('23:59')).toBe(1439);
  });

  it('windowMinutes is the difference', () => {
    expect(windowMinutes('09:00', '12:00')).toBe(180);
  });

  it('morning/afternoon/standard derive from the config', () => {
    expect(morningMinutes(CFG)).toBe(180); // 3h
    expect(afternoonMinutes(CFG)).toBe(240); // 4h
    expect(standardDayMinutes(CFG)).toBe(420); // 7h
  });
});

describe('formatDaysHours', () => {
  it('renders days + hours + minutes against the standard day', () => {
    expect(formatDaysHours(0, CFG)).toBe('0 ชม.');
    expect(formatDaysHours(180, CFG)).toBe('3 ชม.'); // < 1 day
    expect(formatDaysHours(420, CFG)).toBe('1 วัน'); // exact day
    expect(formatDaysHours(600, CFG)).toBe('1 วัน 3 ชม.'); // 420 + 180
    expect(formatDaysHours(630, CFG)).toBe('1 วัน 3 ชม. 30 น.'); // 420 + 210
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test units -- --run`
Expected: FAIL — `Cannot find module './units'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/leave/units.ts
/**
 * Leave time-unit helper — the single source of truth for converting
 * between minutes, the days+hours hybrid display, and the morning/afternoon
 * half-day windows. Pure (no DB, no time-of-day dependence).
 *
 * Convention: a "full leave day" = standardDayMinutes = morning + afternoon
 * window. Balances/quotas are accounted in standard days, decoupled from an
 * employee's actual shift length (see spec key decisions 2–3).
 */

export type LeaveUnitConfig = {
  morningStart: string; // "HH:MM"
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
};

/** "HH:MM" → minutes since midnight. Assumes app-validated input. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Minutes between two "HH:MM" times (end − start). */
export function windowMinutes(start: string, end: string): number {
  return minutesOf(end) - minutesOf(start);
}

export function morningMinutes(cfg: LeaveUnitConfig): number {
  return windowMinutes(cfg.morningStart, cfg.morningEnd);
}

export function afternoonMinutes(cfg: LeaveUnitConfig): number {
  return windowMinutes(cfg.afternoonStart, cfg.afternoonEnd);
}

/** A full leave day in minutes = morning window + afternoon window. */
export function standardDayMinutes(cfg: LeaveUnitConfig): number {
  return morningMinutes(cfg) + afternoonMinutes(cfg);
}

/**
 * Render minutes as the Thai days+hours+minutes hybrid, using the standard
 * day as the "day" size. Examples (420/day): 600 → "1 วัน 3 ชม.".
 */
export function formatDaysHours(minutes: number, cfg: LeaveUnitConfig): string {
  const perDay = standardDayMinutes(cfg);
  const days = Math.floor(minutes / perDay);
  const rem = minutes - days * perDay;
  const hours = Math.floor(rem / 60);
  const mins = rem - hours * 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} วัน`);
  if (hours > 0) parts.push(`${hours} ชม.`);
  if (mins > 0) parts.push(`${mins} น.`);
  if (parts.length === 0) return '0 ชม.';
  return parts.join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test units -- --run`
Expected: PASS (all cases in both describes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/leave/units.ts src/lib/leave/units.test.ts
git commit -m "feat(leave): units helper for minutes↔days+hours conversion"
```

---

## Task 2: `units.ts` — segmentFor + segmentsOverlap

**Files:**
- Modify: `src/lib/leave/units.ts`
- Test: `src/lib/leave/units.test.ts`

- [ ] **Step 1: Add the failing tests**

```ts
// append to src/lib/leave/units.test.ts
import { segmentFor, segmentsOverlap, type LeaveUnit } from './units';

describe('segmentFor', () => {
  it('half-morning fills from config', () => {
    expect(segmentFor('HalfMorning', CFG)).toEqual({
      startTime: '09:00',
      endTime: '12:00',
      minutes: 180,
    });
  });

  it('half-afternoon fills from config', () => {
    expect(segmentFor('HalfAfternoon', CFG)).toEqual({
      startTime: '13:00',
      endTime: '17:00',
      minutes: 240,
    });
  });

  it('hourly uses the supplied times', () => {
    expect(segmentFor('Hourly', CFG, '14:00', '16:30')).toEqual({
      startTime: '14:00',
      endTime: '16:30',
      minutes: 150,
    });
  });

  it('full day has null times and one standard day of minutes', () => {
    expect(segmentFor('FullDay', CFG)).toEqual({
      startTime: null,
      endTime: null,
      minutes: 420,
    });
  });

  it('returns null for hourly without valid times', () => {
    expect(segmentFor('Hourly', CFG)).toBeNull();
    expect(segmentFor('Hourly', CFG, '16:00', '14:00')).toBeNull(); // end ≤ start
  });
});

describe('segmentsOverlap', () => {
  it('null bounds mean whole-day → always overlaps', () => {
    expect(segmentsOverlap(null, null, '09:00', '10:00')).toBe(true);
    expect(segmentsOverlap('09:00', '10:00', null, null)).toBe(true);
  });

  it('disjoint AM/PM segments do not overlap', () => {
    expect(segmentsOverlap('09:00', '12:00', '13:00', '17:00')).toBe(false);
  });

  it('touching at a boundary does not overlap (half-open)', () => {
    expect(segmentsOverlap('09:00', '12:00', '12:00', '13:00')).toBe(false);
  });

  it('genuine overlap is detected', () => {
    expect(segmentsOverlap('09:00', '11:00', '10:00', '12:00')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test units -- --run`
Expected: FAIL — `segmentFor`/`segmentsOverlap` not exported.

- [ ] **Step 3: Add the implementation to `units.ts`**

```ts
// append to src/lib/leave/units.ts
export type LeaveUnit = 'FullDay' | 'HalfMorning' | 'HalfAfternoon' | 'Hourly';

export type LeaveSegment = {
  startTime: string | null; // null for FullDay
  endTime: string | null;
  minutes: number; // per-day minutes this unit charges
};

/**
 * Resolve a leave unit to a concrete time segment + per-day minutes.
 * Halves use the config windows; Hourly uses caller times (must be a valid
 * start < end); FullDay has null times and one standard day of minutes.
 * Returns null when the inputs are invalid (e.g. hourly with end ≤ start).
 */
export function segmentFor(
  unit: LeaveUnit,
  cfg: LeaveUnitConfig,
  startTime?: string | null,
  endTime?: string | null,
): LeaveSegment | null {
  switch (unit) {
    case 'FullDay':
      return { startTime: null, endTime: null, minutes: standardDayMinutes(cfg) };
    case 'HalfMorning':
      return { startTime: cfg.morningStart, endTime: cfg.morningEnd, minutes: morningMinutes(cfg) };
    case 'HalfAfternoon':
      return {
        startTime: cfg.afternoonStart,
        endTime: cfg.afternoonEnd,
        minutes: afternoonMinutes(cfg),
      };
    case 'Hourly': {
      if (!startTime || !endTime) return null;
      const mins = windowMinutes(startTime, endTime);
      if (mins <= 0) return null;
      return { startTime, endTime, minutes: mins };
    }
  }
}

/**
 * Half-open [start, end) overlap test for two same-date segments. A null
 * start/end means "whole day", which overlaps everything.
 */
export function segmentsOverlap(
  aStart: string | null,
  aEnd: string | null,
  bStart: string | null,
  bEnd: string | null,
): boolean {
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) return true;
  return minutesOf(aStart) < minutesOf(bEnd) && minutesOf(bStart) < minutesOf(aEnd);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test units -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leave/units.ts src/lib/leave/units.test.ts
git commit -m "feat(leave): segment resolution + overlap helpers"
```

---

## Task 3: Schema + migration `0016_partial_day_leave`

**Files:**
- Modify: `prisma/schema.prisma` (enums, `LeaveType`, `LeaveRequest`, new `LeaveConfig`)
- Create: `prisma/migrations/0016_partial_day_leave/migration.sql`

- [ ] **Step 1: Add the `LeaveUnit` enum** after the `LeaveStatus` enum (around line 86):

```prisma
enum LeaveUnit {
  FullDay
  HalfMorning
  HalfAfternoon
  Hourly
}
```

- [ ] **Step 2: Add granularity flags to `LeaveType`** (after `annualQuota`, line 416):

```prisma
model LeaveType {
  id          String    @id @default(uuid()) @db.Uuid
  name        String    @unique
  isPaid      Boolean   @default(true)
  annualQuota Int?
  allowFullDay Boolean  @default(true)
  allowHalfDay Boolean  @default(false)
  allowHourly  Boolean  @default(false)
  archivedAt  DateTime?
  requests    LeaveRequest[]
}
```

- [ ] **Step 3: Add unit columns to `LeaveRequest`** (after `endDate`, line 428):

```prisma
  unit           LeaveUnit @default(FullDay)
  startTime      String?   // "HH:MM" — set for HalfMorning/HalfAfternoon/Hourly
  endTime        String?
  chargedMinutes Int?      // frozen at approval; the amount deducted from balance
```

- [ ] **Step 4: Add the `LeaveConfig` model** after `LeaveType` (around line 419):

```prisma
/// Company-wide leave-unit configuration (singleton — read via findFirst()).
/// Defines the morning/afternoon half-day windows; the standard day length is
/// derived from them. Edited on /admin/settings/leave-config.
model LeaveConfig {
  id             String   @id @default(uuid()) @db.Uuid
  morningStart   String   @default("09:00") // "HH:MM" 24h, app-validated
  morningEnd     String   @default("12:00")
  afternoonStart String   @default("13:00")
  afternoonEnd   String   @default("17:00")
  updatedAt      DateTime @updatedAt
}
```

- [ ] **Step 5: Write the migration SQL**

```sql
-- prisma/migrations/0016_partial_day_leave/migration.sql
-- ─── 0016 — Partial-day leave ─────────────────────────────────────────────
-- Adds the LeaveUnit enum, per-type granularity flags, per-request unit +
-- segment + chargedMinutes, and the LeaveConfig singleton. Relaxes the
-- Attendance partial-unique to EXCLUDE OnLeave so a date can hold two disjoint
-- partial leaves (morning + afternoon). See spec §Phase 1.

CREATE TYPE "LeaveUnit" AS ENUM ('FullDay', 'HalfMorning', 'HalfAfternoon', 'Hourly');

ALTER TABLE "LeaveType" ADD COLUMN "allowFullDay" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LeaveType" ADD COLUMN "allowHalfDay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeaveType" ADD COLUMN "allowHourly"  BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LeaveRequest" ADD COLUMN "unit" "LeaveUnit" NOT NULL DEFAULT 'FullDay';
ALTER TABLE "LeaveRequest" ADD COLUMN "startTime" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "endTime" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "chargedMinutes" INTEGER;

CREATE TABLE "LeaveConfig" (
    "id" UUID NOT NULL,
    "morningStart" TEXT NOT NULL DEFAULT '09:00',
    "morningEnd" TEXT NOT NULL DEFAULT '12:00',
    "afternoonStart" TEXT NOT NULL DEFAULT '13:00',
    "afternoonEnd" TEXT NOT NULL DEFAULT '17:00',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveConfig_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row (gen_random_uuid is available on Supabase Postgres).
INSERT INTO "LeaveConfig" ("id", "updatedAt") VALUES (gen_random_uuid(), CURRENT_TIMESTAMP);

-- Relax the Attendance live-unique to exclude OnLeave so a date may hold
-- multiple OnLeave rows (two disjoint partial leaves). Other types keep
-- one-per-(employee,date,type).
DROP INDEX IF EXISTS "Attendance_employeeId_date_type_live_key";
CREATE UNIQUE INDEX "Attendance_employeeId_date_type_live_key"
  ON "Attendance" ("employeeId", "date", "type")
  WHERE "deletedAt" IS NULL AND "type" <> 'OnLeave';
```

- [ ] **Step 6: Apply the migration locally + regenerate the client**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm db:migrate`
Expected: migration `0016_partial_day_leave` applied; Prisma Client regenerated. (If a local DB isn't running, start it first — `pnpm db:reset` reseeds.)

- [ ] **Step 7: Verify the schema compiles**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS (no references to the new fields are broken yet).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0016_partial_day_leave
git commit -m "feat(leave): schema for partial-day leave + LeaveConfig (0016)"
```

---

## Task 4: `leave-config.ts` — read the singleton

**Files:**
- Create: `src/lib/leave/leave-config.ts`

- [ ] **Step 1: Implement the loader** (no test — thin DB read; covered indirectly)

```ts
// src/lib/leave/leave-config.ts
import { prisma } from '@/lib/db/prisma';
import type { LeaveUnitConfig } from './units';

/** Hardcoded fallback matching the LeaveConfig column defaults — used only if
 *  the singleton row is somehow missing (fresh DB before seed). */
const FALLBACK: LeaveUnitConfig = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

/** Read the company-wide leave-unit config (singleton row). */
export async function getLeaveConfig(): Promise<LeaveUnitConfig> {
  const row = await prisma.leaveConfig.findFirst({
    select: { morningStart: true, morningEnd: true, afternoonStart: true, afternoonEnd: true },
  });
  return row ?? FALLBACK;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/leave/leave-config.ts
git commit -m "feat(leave): leave-config singleton loader"
```

---

## Task 5: Unit-aware submit validation

**Files:**
- Modify: `src/lib/leave/actions.ts`

This task makes `submitLeaveRequest` accept `unit` + optional `startTime`/`endTime`, validate them against the type's flags, enforce single-date for partials, and make the overlap check segment-aware.

- [ ] **Step 1: Extend `SubmitInput` and the result codes** (`actions.ts`, the `SubmitInput` type at line 67 and `SubmitLeaveResult` at line 46):

```ts
// add to the SubmitLeaveResult `code` union:
        | 'bad-unit'
        | 'bad-segment'
// ...

type SubmitInput = {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  attachmentKey?: string | null;
  /** Granularity. Defaults to FullDay when omitted (back-compat). The
   *  `LeaveUnit` string union from ./units shares the Prisma enum's literal
   *  values, so it's assignable to `prisma.leaveRequest.create({ data: { unit } })`. */
  unit?: LeaveUnit;
  /** "HH:MM" — required for Hourly; ignored for halves (derived). */
  startTime?: string | null;
  endTime?: string | null;
};
```

(`LeaveUnit` is imported from `./units` in Step 2 — use that single source, not a separate `@prisma/client` import, to avoid two same-named types in one file.)

- [ ] **Step 2: Add imports** at the top of `actions.ts` (after the existing `parseInputDate` import on line 36):

```ts
import { getLeaveConfig } from './leave-config';
import { segmentFor, segmentsOverlap, type LeaveUnit } from './units';
```

- [ ] **Step 3: Select the flags on the leave-type lookup** — change the `select` at lines 133–136:

```ts
  const lt = await prisma.leaveType.findUnique({
    where: { id: input.leaveTypeId },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      allowFullDay: true,
      allowHalfDay: true,
      allowHourly: true,
    },
  });
```

- [ ] **Step 4: Resolve + validate the unit/segment** — insert this block immediately after the `if (!lt || lt.archivedAt)` guard (after line 139), before the overlap check:

```ts
  const unit: LeaveUnit = input.unit ?? 'FullDay';
  const allowed =
    (unit === 'FullDay' && lt.allowFullDay) ||
    ((unit === 'HalfMorning' || unit === 'HalfAfternoon') && lt.allowHalfDay) ||
    (unit === 'Hourly' && lt.allowHourly);
  if (!allowed) {
    return { ok: false, code: 'bad-unit', message: 'ประเภทการลานี้ไม่รองรับหน่วยที่เลือก' };
  }

  // Partial units are single-date and must fall on an open weekday. (Sunday is
  // the hardcoded closed day; holidays are caught authoritatively at approval,
  // where the Holiday table is consulted — see admin.ts targetDates guard.)
  const isPartial = unit !== 'FullDay';
  if (isPartial) {
    if (start.getTime() !== end.getTime()) {
      return { ok: false, code: 'bad-segment', message: 'การลาบางส่วนต้องเป็นวันเดียว' };
    }
    if (start.getUTCDay() === 0) {
      return { ok: false, code: 'bad-segment', message: 'ไม่สามารถลาบางส่วนในวันหยุดได้' };
    }
  }

  const cfg = await getLeaveConfig();
  const segment = segmentFor(unit, cfg, input.startTime, input.endTime);
  if (!segment) {
    return { ok: false, code: 'bad-segment', message: 'ช่วงเวลาที่เลือกไม่ถูกต้อง' };
  }
```

- [ ] **Step 5: Make the overlap check segment-aware** — replace the overlap block (lines 143–160) with:

```ts
  // Overlap: pull every Pending/Approved request that intersects our date
  // range, then reject only when the day actually conflicts. Two PARTIAL
  // leaves on a shared date are allowed if their time segments are disjoint.
  const overlaps = await prisma.leaveRequest.findMany({
    where: {
      employeeId: employee.id,
      status: { in: ['Pending', 'Approved'] },
      startDate: { lte: end },
      endDate: { gte: start },
    },
    select: { unit: true, startTime: true, endTime: true },
  });
  const conflict = overlaps.some((o) => {
    // Either side full-day (or multi-day) → whole-day occupancy → conflict.
    if (unit === 'FullDay' || o.unit === 'FullDay') return true;
    // Both partial + single-date: conflict only if the time segments overlap.
    return segmentsOverlap(segment.startTime, segment.endTime, o.startTime, o.endTime);
  });
  if (conflict) {
    return { ok: false, code: 'overlap', message: 'มีคำขอลาที่ทับซ้อนช่วงวัน/เวลานี้อยู่แล้ว' };
  }
```

- [ ] **Step 6: Persist the new fields** — in the `prisma.leaveRequest.create` `data` (lines 184–192) add:

```ts
      data: {
        employeeId: employee.id,
        leaveTypeId: lt.id,
        startDate: start,
        endDate: end,
        reason,
        status: 'Pending',
        attachmentUrl: attachmentKey,
        unit,
        startTime: segment.startTime,
        endTime: segment.endTime,
      },
```

(`chargedMinutes` stays null until approval. The audit `after` payload may also include `unit` — optional.)

- [ ] **Step 7: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Run the existing leave tests to confirm no regression**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test leave -- --run`
Expected: PASS (existing `working-days` / `team-calendar` suites unaffected; `units` passes).

- [ ] **Step 9: Commit**

```bash
git add src/lib/leave/actions.ts
git commit -m "feat(leave): unit-aware submit validation + segment overlap"
```

---

## Task 6: Approval — chargedMinutes, segment OnLeave rows, time-overlap guard

**Files:**
- Modify: `src/lib/leave/admin.ts`

The approval transaction must: compute `chargedMinutes`; write `OnLeave` rows with correct `durationMinutes` (+ segment clock times for partials); enforce the per-date time-overlap guard against existing OnLeave rows; and stop relying on `skipDuplicates`.

- [ ] **Step 1: Add imports** to `admin.ts` (after the `working-days` import on line 34):

```ts
import { getLeaveConfig } from './leave-config';
import { segmentFor, segmentsOverlap } from './units';
```

- [ ] **Step 2: Select the unit/segment on the request lookup** — extend the `select` at lines 99–108 with:

```ts
          unit: true,
          startTime: true,
          endTime: true,
```

- [ ] **Step 3: Resolve the segment + compute target dates** — inside the transaction, after `expandedHolidays`/`workingDays` are built (after line 142), insert:

```ts
      const cfg = await getLeaveConfig();
      const segment = segmentFor(req.unit, cfg, req.startTime, req.endTime);
      if (!segment) {
        return { ok: false as const, code: 'db-error' as const, message: 'ช่วงเวลาการลาไม่ถูกต้อง' };
      }

      // FullDay → one row per working day, each a full standard day.
      // Partial → exactly one row on the single date (workingDays has 1 entry;
      // if 0, the date is a closed day and there is nothing to charge).
      const targetDates = workingDays;
      if (targetDates.length === 0) {
        return {
          ok: false as const,
          code: 'db-error' as const,
          message: 'ไม่มีวันทำงานในช่วงที่เลือก',
        };
      }

      // Per-date time-overlap guard against existing OnLeave rows.
      const existing = await tx.attendance.findMany({
        where: {
          employeeId: req.employeeId,
          type: 'OnLeave',
          deletedAt: null,
          date: { in: targetDates },
          leaveRequestId: { not: req.id },
        },
        select: { date: true, clockInAt: true, clockOutAt: true },
      });
      const newStart = req.unit === 'FullDay' ? null : segment.startTime;
      const newEnd = req.unit === 'FullDay' ? null : segment.endTime;
      const clash = existing.find((e) => {
        const eStart = e.clockInAt ? hhmm(e.clockInAt) : null;
        const eEnd = e.clockOutAt ? hhmm(e.clockOutAt) : null;
        return segmentsOverlap(newStart, newEnd, eStart, eEnd);
      });
      if (clash) {
        return {
          ok: false as const,
          code: 'db-error' as const,
          message: `วันที่ ${clash.date.toISOString().slice(0, 10)} มีการลาทับซ้อนอยู่แล้ว`,
        };
      }
```

- [ ] **Step 4: Add the `hhmm` helper** near the top of `admin.ts` (after the imports):

```ts
/** Format a Date's Bangkok wall-clock time as "HH:MM" for segment comparison.
 *  OnLeave rows store clockInAt/clockOutAt as the segment bounds on the date. */
function hhmm(d: Date): string {
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
```

- [ ] **Step 5: Build unit-aware Attendance rows + chargedMinutes** — replace the `attendanceRows`/`inserted` block (lines 148–165) with:

```ts
      // Partial leaves carry the segment as clockInAt/clockOutAt so the live
      // board can show the window and OT can reconcile. Build the BANGKOK
      // instant (+07:00, no DST in Thailand) so it renders as the chosen wall-
      // clock time everywhere clockInAt is formatted in Asia/Bangkok — and so
      // the `hhmm()` round-trip used by the overlap guard is consistent.
      function segInstant(date: Date, time: string): Date {
        return new Date(`${date.toISOString().slice(0, 10)}T${time}:00+07:00`);
      }

      const attendanceRows = targetDates.map((d) => ({
        employeeId: req.employeeId,
        date: d,
        type: 'OnLeave' as const,
        source: 'Manual' as const,
        durationMinutes: segment.minutes,
        clockInAt: segment.startTime ? segInstant(d, segment.startTime) : null,
        clockOutAt: segment.endTime ? segInstant(d, segment.endTime) : null,
        leaveRequestId: req.id,
        createdById: user.id,
      }));

      const inserted = await tx.attendance.createMany({ data: attendanceRows });
      const chargedMinutes = segment.minutes * targetDates.length;
```

- [ ] **Step 6: Write `chargedMinutes` on the request** — in the `tx.leaveRequest.update` `data` (lines 170–175) add `chargedMinutes,` alongside the status fields.

- [ ] **Step 7: Surface unit + chargedMinutes in the audit `after`** — add to the `after` object (line 184): `unit: req.unit, chargedMinutes,`.

- [ ] **Step 8: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Run the full unit suite (no regressions)**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test -- --run`
Expected: PASS (301 + new `units` tests).

- [ ] **Step 10: Commit**

```bash
git add src/lib/leave/admin.ts
git commit -m "feat(leave): unit-aware approval, segment OnLeave rows, overlap guard"
```

---

## Task 7: Settings — leave-type granularity flags

**Files:**
- Modify: `src/app/(admin)/admin/settings/leave-types/actions.ts`
- Modify: `src/app/(admin)/admin/settings/leave-types/leave-type-form.tsx`
- Modify: `src/app/(admin)/admin/settings/leave-types/[id]/edit/page.tsx`

- [ ] **Step 1: Extend the Zod schema + normalize** in `leave-types/actions.ts`. Add to the `Schema` object (after `annualQuota`, line 29):

```ts
  allowFullDay: z.literal('on').optional().transform((v) => v === 'on'),
  allowHalfDay: z.literal('on').optional().transform((v) => v === 'on'),
  allowHourly: z.literal('on').optional().transform((v) => v === 'on'),
```

Add the three keys to `readForm` (line 32):

```ts
    allowFullDay: formData.get('allowFullDay') ?? undefined,
    allowHalfDay: formData.get('allowHalfDay') ?? undefined,
    allowHourly: formData.get('allowHourly') ?? undefined,
```

Extend `ParsedData` (line 48) and `normalize` (line 54):

```ts
type ParsedData = {
  name: string;
  isPaid: boolean;
  annualQuota: number | null;
  allowFullDay: boolean;
  allowHalfDay: boolean;
  allowHourly: boolean;
};

function normalize(parsed: z.infer<typeof Schema>): ParsedData {
  return {
    name: parsed.name,
    isPaid: parsed.isPaid ?? false,
    annualQuota: parsed.annualQuota ?? null,
    allowFullDay: parsed.allowFullDay ?? false,
    allowHalfDay: parsed.allowHalfDay ?? false,
    allowHourly: parsed.allowHourly ?? false,
  };
}
```

- [ ] **Step 2: Guard against "no unit allowed"** — in `createLeaveType`, right after `const data = normalize(parsed.data);` (line 72), add:

```ts
  if (!data.allowFullDay && !data.allowHalfDay && !data.allowHourly) {
    redirect(
      `/admin/settings/leave-types/new?error=${encodeURIComponent('ต้องเลือกอย่างน้อยหนึ่งหน่วยการลา')}`,
    );
  }
```

In `updateLeaveType`, right after its `const data = normalize(parsed.data);` (line 110), add the same guard but redirecting to the edit URL:

```ts
  if (!data.allowFullDay && !data.allowHalfDay && !data.allowHourly) {
    redirect(
      `/admin/settings/leave-types/${id}/edit?error=${encodeURIComponent('ต้องเลือกอย่างน้อยหนึ่งหน่วยการลา')}`,
    );
  }
```

Also extend `updateLeaveType`'s audit `before` (line 119) so the flags are captured:

```ts
      before: {
        name: before.name,
        isPaid: before.isPaid,
        annualQuota: before.annualQuota,
        allowFullDay: before.allowFullDay,
        allowHalfDay: before.allowHalfDay,
        allowHourly: before.allowHourly,
      },
```

- [ ] **Step 3: Add the checkboxes to the form** — in `leave-type-form.tsx`, extend `Initial` (line 7):

```ts
type Initial = {
  name: string;
  isPaid: boolean;
  annualQuota: number | null;
  allowFullDay: boolean;
  allowHalfDay: boolean;
  allowHourly: boolean;
};
```

Add a `FormField` after the `annualQuota` field (after line 90):

```tsx
            <FormField
              label="หน่วยการลาที่อนุญาต"
              htmlFor="allowFullDay"
              hint="เลือกได้ว่าการลาประเภทนี้ลาแบบใดได้บ้าง"
            >
              <div className="space-y-2">
                {[
                  { name: 'allowFullDay', label: 'เต็มวัน', def: initial?.allowFullDay ?? true },
                  { name: 'allowHalfDay', label: 'ครึ่งวัน (เช้า/บ่าย)', def: initial?.allowHalfDay ?? false },
                  { name: 'allowHourly', label: 'รายชั่วโมง', def: initial?.allowHourly ?? false },
                ].map((u) => (
                  <label key={u.name} className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      id={u.name}
                      name={u.name}
                      defaultChecked={u.def}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-gray-900">{u.label}</span>
                  </label>
                ))}
              </div>
            </FormField>
```

- [ ] **Step 4: Pass the flags from the edit page** — in `leave-types/[id]/edit/page.tsx`, ensure the `leaveType` query selects the three flags and the `initial` prop includes them. (Open the file; add `allowFullDay`, `allowHalfDay`, `allowHourly` to the `select` and to the `initial={{ ... }}` object passed to `LeaveTypeForm`.)

- [ ] **Step 5: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/admin/settings/leave-types"
git commit -m "feat(leave): per-type granularity flags in settings"
```

---

## Task 8: Permission `settings.leave-config.manage`

**Files:**
- Modify: `src/lib/auth/permissions.ts`
- Modify: `src/lib/auth/roles.ts`

- [ ] **Step 1: Add the catalog entry** — in `permissions.ts`, add to the settings block (after `settings.leave-type.manage`, line 65):

```ts
  'settings.leave-config.manage': 'จัดการการตั้งค่าการลา',
```

And add it to the `settings` group's `permissions` array (after `'settings.leave-type.manage'`, line 165).

- [ ] **Step 2: Grant it to Admin** — in `roles.ts`, add `'settings.leave-config.manage',` after `'settings.leave-type.manage'` (line 86).

- [ ] **Step 3: Run the perm-coverage guard**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test perm-coverage -- --run`
Expected: PASS (every catalog perm reachable by a role).

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/permissions.ts src/lib/auth/roles.ts
git commit -m "feat(auth): settings.leave-config.manage permission"
```

---

## Task 9: Leave-config settings page

**Files:**
- Create: `src/app/(admin)/admin/settings/leave-config/page.tsx`
- Create: `src/app/(admin)/admin/settings/leave-config/actions.ts`
- Modify: `src/app/(admin)/admin/settings/settings-nav.tsx`

- [ ] **Step 1: Write the server action** (`leave-config/actions.ts`):

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

const TIME = z.string().regex(/^\d{2}:\d{2}$/, 'รูปแบบเวลาไม่ถูกต้อง (HH:MM)');
const Schema = z
  .object({
    morningStart: TIME,
    morningEnd: TIME,
    afternoonStart: TIME,
    afternoonEnd: TIME,
  })
  .refine((v) => v.morningStart < v.morningEnd, { message: 'เวลาเช้าไม่ถูกต้อง' })
  .refine((v) => v.afternoonStart < v.afternoonEnd, { message: 'เวลาบ่ายไม่ถูกต้อง' })
  .refine((v) => v.morningEnd <= v.afternoonStart, { message: 'ช่วงเช้า/บ่ายทับซ้อนกัน' });

export async function updateLeaveConfig(formData: FormData) {
  const { user } = await requirePermission('settings.leave-config.manage');
  const parsed = Schema.safeParse({
    morningStart: formData.get('morningStart'),
    morningEnd: formData.get('morningEnd'),
    afternoonStart: formData.get('afternoonStart'),
    afternoonEnd: formData.get('afternoonEnd'),
  });
  if (!parsed.success) {
    redirect(
      `/admin/settings/leave-config?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const before = await prisma.leaveConfig.findFirst();
  if (before) {
    await prisma.leaveConfig.update({ where: { id: before.id }, data: parsed.data });
  } else {
    await prisma.leaveConfig.create({ data: parsed.data });
  }

  auditLog({
    actorId: user.id,
    action: 'leaveConfig.update',
    entityType: 'LeaveConfig',
    entityId: before?.id ?? 'new',
    before: before ?? undefined,
    after: parsed.data,
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/leave-config');
  redirect('/admin/settings/leave-config?ok=1');
}
```

- [ ] **Step 2: Write the page** (`leave-config/page.tsx`) — Server Component using `getLeaveConfig` + `standardDayMinutes`/`formatDaysHours` to show the derived day, with a simple form of four `time` inputs:

```tsx
import { requirePermission } from '@/lib/auth/check-permission';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { formatDaysHours, standardDayMinutes } from '@/lib/leave/units';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { updateLeaveConfig } from './actions';

export default async function LeaveConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePermission('settings.leave-config.manage');
  const cfg = await getLeaveConfig();
  const sp = await searchParams;
  const std = standardDayMinutes(cfg);

  return (
    <form action={updateLeaveConfig}>
      <Card>
        <CardHeader>
          <CardTitle>ตั้งค่าการลา — ช่วงครึ่งวัน</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          {sp.error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {sp.error}
            </p>
          )}
          {sp.ok && (
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">บันทึกแล้ว</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="เช้า — เริ่ม" htmlFor="morningStart">
              <Input id="morningStart" name="morningStart" type="time" defaultValue={cfg.morningStart} required />
            </FormField>
            <FormField label="เช้า — สิ้นสุด" htmlFor="morningEnd">
              <Input id="morningEnd" name="morningEnd" type="time" defaultValue={cfg.morningEnd} required />
            </FormField>
            <FormField label="บ่าย — เริ่ม" htmlFor="afternoonStart">
              <Input id="afternoonStart" name="afternoonStart" type="time" defaultValue={cfg.afternoonStart} required />
            </FormField>
            <FormField label="บ่าย — สิ้นสุด" htmlFor="afternoonEnd">
              <Input id="afternoonEnd" name="afternoonEnd" type="time" defaultValue={cfg.afternoonEnd} required />
            </FormField>
          </div>
          <p className="text-sm text-ink-3">
            วันทำงานมาตรฐาน = <strong>{formatDaysHours(std, cfg)}</strong>
          </p>
        </CardBody>
        <CardFooter className="flex justify-end">
          <Button type="submit">บันทึก</Button>
        </CardFooter>
      </Card>
    </form>
  );
}
```

- [ ] **Step 3: Add the nav item** — in `settings-nav.tsx`, import an icon (e.g. `Hourglass`) and add to `ITEMS` after the `leave-types` entry (line 34):

```tsx
  {
    href: '/admin/settings/leave-config',
    label: 'ตั้งค่าการลา',
    desc: 'ครึ่งวัน / รายชั่วโมง',
    Icon: Hourglass,
  },
```

- [ ] **Step 4: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Manual verification**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm dev`, sign in as admin, open `/admin/settings/leave-config`, change afternoon end to `16:00`, save → page shows "วันทำงานมาตรฐาน = 6 ชม."; an invalid overlap (morning end after afternoon start) shows the error.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/admin/settings/leave-config" "src/app/(admin)/admin/settings/settings-nav.tsx"
git commit -m "feat(leave): company-wide leave-config settings page"
```

---

## Task 10: LIFF form — unit selector, time pickers, preview

**Files:**
- Modify: `src/app/(liff)/liff/leave/new/page.tsx`
- Modify: `src/app/(liff)/liff/leave/new/leave-new-form.tsx`

- [ ] **Step 1: Pass flags + config from the page** — in `leave/new/page.tsx`, extend the `leaveTypes` select with the three flags and load the config:

```ts
import { getLeaveConfig } from '@/lib/leave/leave-config';
// ...
  const [leaveTypes, leaveConfig] = await Promise.all([
    prisma.leaveType.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        isPaid: true,
        annualQuota: true,
        allowFullDay: true,
        allowHalfDay: true,
        allowHourly: true,
      },
    }),
    getLeaveConfig(),
  ]);
  // ...
  return <LeaveNewForm leaveTypes={leaveTypes} minDate={todayYmd} leaveConfig={leaveConfig} />;
```

- [ ] **Step 2: Extend the form props + type** — in `leave-new-form.tsx`, update `LeaveTypeOption` and `Props`:

```ts
import {
  segmentFor,
  formatDaysHours,
  standardDayMinutes,
  type LeaveUnit,
  type LeaveUnitConfig,
} from '@/lib/leave/units';

type LeaveTypeOption = {
  id: string;
  name: string;
  isPaid: boolean;
  annualQuota: number | null;
  allowFullDay: boolean;
  allowHalfDay: boolean;
  allowHourly: boolean;
};

type Props = {
  leaveTypes: readonly LeaveTypeOption[];
  minDate: string;
  leaveConfig: LeaveUnitConfig;
};
```

- [ ] **Step 3: Add unit state + a selector** — add state (near line 37) and a selector + conditional time inputs after the leave-type `<select>`. Render only the units the selected type allows; collapse the end-date input when `unit !== 'FullDay'`:

```tsx
  const [unit, setUnit] = useState<LeaveUnit>('FullDay');
  const [startTime, setStartTime] = useState('13:00');
  const [endTime, setEndTime] = useState('15:00');

  const selectedType = leaveTypes.find((t) => t.id === leaveTypeId);
  const allowedUnits: { value: LeaveUnit; label: string }[] = [];
  if (selectedType?.allowFullDay) allowedUnits.push({ value: 'FullDay', label: 'เต็มวัน' });
  if (selectedType?.allowHalfDay) {
    allowedUnits.push({ value: 'HalfMorning', label: 'ครึ่งเช้า' });
    allowedUnits.push({ value: 'HalfAfternoon', label: 'ครึ่งบ่าย' });
  }
  if (selectedType?.allowHourly) allowedUnits.push({ value: 'Hourly', label: 'รายชั่วโมง' });
```

Add an effect (import `useEffect`) so `unit` snaps to the first allowed unit whenever the selected type changes — the selector never offers a disallowed unit:

```tsx
  useEffect(() => {
    if (allowedUnits.length > 0 && !allowedUnits.some((u) => u.value === unit)) {
      setUnit(allowedUnits[0].value);
    }
    // allowedUnits is derived from selectedType; depend on the type id.
  }, [leaveTypeId]);
```

Render the selector as a row of buttons (highlight the active one), and show from/to `time` inputs only when `unit === 'Hourly'`:

```tsx
        {allowedUnits.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {allowedUnits.map((u) => (
              <button
                key={u.value}
                type="button"
                onClick={() => setUnit(u.value)}
                className={
                  unit === u.value
                    ? 'rounded-md border border-primary-600 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700'
                    : 'rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700'
                }
              >
                {u.label}
              </button>
            ))}
          </div>
        )}
        {unit === 'Hourly' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              ตั้งแต่
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              ถึง
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
        )}
```

- [ ] **Step 4: Replace the working-day preview with a charged-amount preview** — compute the segment client-side and show `formatDaysHours`:

```tsx
  const chargePreview = useMemo(() => {
    if (unit === 'FullDay') {
      const s = parseInputDate(startDate);
      const e = parseInputDate(endDate);
      if (!s || !e || e < s) return null;
      const days = workingDaysIn({ startDate: s, endDate: e, holidays: [] }).length;
      return days * standardDayMinutes(leaveConfig);
    }
    const seg = segmentFor(unit, leaveConfig, startTime, endTime);
    return seg ? seg.minutes : null;
  }, [unit, startDate, endDate, startTime, endTime, leaveConfig]);
```

(Import `standardDayMinutes` too.) Show `ประมาณการ: {formatDaysHours(chargePreview, leaveConfig)}` when non-null. Keep the "แอดมินจะคำนวณวันหยุดอีกครั้ง" note for FullDay.

- [ ] **Step 5: Send unit + times on submit** — in `onSubmit`, when `unit !== 'FullDay'` set `endDate = startDate` and pass `unit`, `startTime`, `endTime` to `submitLeaveRequest`:

```ts
        const result = await submitLeaveRequest({
          leaveTypeId,
          startDate,
          endDate: unit === 'FullDay' ? endDate : startDate,
          reason,
          attachmentKey,
          unit,
          startTime: unit === 'Hourly' ? startTime : null,
          endTime: unit === 'Hourly' ? endTime : null,
        });
```

- [ ] **Step 6: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Manual verification**

With `pnpm dev`: set a leave type to allow half + hourly in settings; open the LIFF leave form; selecting that type shows เต็มวัน/ครึ่งเช้า/ครึ่งบ่าย/รายชั่วโมง; choosing ครึ่งเช้า shows "ประมาณการ: 3 ชม."; choosing รายชั่วโมง 14:00–16:30 shows "2 ชม. 30 น."; submitting an hourly leave then a non-overlapping afternoon-half on the same date both succeed.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(liff)/liff/leave/new"
git commit -m "feat(leave): LIFF partial-day picker + charged-amount preview"
```

---

## Task 11: Distinct-by-employee on-leave counting

**Files:**
- Modify: `src/lib/attendance/live.ts`
- Modify: `src/app/(admin)/admin/page.tsx`

Two OnLeave rows can now exist for one employee on one date (two halves). The board/dashboard must count **employees**, not rows.

- [ ] **Step 1: Dedupe in `live.ts`** — today (around line 113) `onLeave` is built as `onLeaveRows.map((r) => ({ ...fields... }))`. Convert that to a dedupe keyed by `employeeId` so an employee taking two halves appears **once**. Keep the exact object literal the current `.map()` produces — only wrap it so the first row per employee wins:

```ts
  const onLeaveByEmp = new Map<string, OnLeaveEmployee>();
  for (const r of onLeaveRows) {
    if (onLeaveByEmp.has(r.employeeId)) continue;
    onLeaveByEmp.set(r.employeeId, {
      // ⬇️ paste the SAME object literal the existing `.map((r) => ({...}))`
      //    builds (employeeName, employeeNickname, branchName, leaveTypeName,
      //    startDate, endDate — whatever the current code sets). Do not change
      //    the fields; only the iteration/dedup wrapper is new.
    });
  }
  const onLeave: OnLeaveEmployee[] = [...onLeaveByEmp.values()];
```

`onLeaveCount: onLeave.length` then counts distinct employees. (The "busy" set on line 110 already keys on `employeeId`, so it's unaffected.)

- [ ] **Step 2: Dedupe the dashboard count** — in `admin/page.tsx`, replace the `prisma.attendance.count({ where: { type: 'OnLeave', date: today } })` (line 113) with a distinct-employee count:

```ts
    prisma.attendance
      .findMany({
        where: { type: 'OnLeave', date: today },
        distinct: ['employeeId'],
        select: { employeeId: true },
      })
      .then((rows) => rows.length),
```

And for the `onLeaveToday` list query (line 143), add `distinct: ['employeeId']` so the displayed list shows each employee once.

- [ ] **Step 3: Run the attendance tests**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test attendance -- --run`
Expected: PASS (`live-shape`, `live/filter`, `date`, etc.).

- [ ] **Step 4: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/attendance/live.ts "src/app/(admin)/admin/page.tsx"
git commit -m "fix(attendance): count on-leave employees distinctly (partial leave)"
```

---

## Task 12: Seed + final full-suite gate

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Seed a `LeaveConfig` row + sample granularity** — in `seed.ts`, add an idempotent upsert of the `LeaveConfig` singleton (only create if none exists) and set `allowHalfDay: true`/`allowHourly: true` on at least one seeded leave type (e.g. ลากิจ allows hourly, ลาพักร้อน allows half) so the dev DB exercises the feature. Match the existing seed style (find-or-create).

```ts
  // Leave config singleton (only if missing).
  const existingCfg = await prisma.leaveConfig.findFirst();
  if (!existingCfg) {
    await prisma.leaveConfig.create({ data: {} }); // column defaults = 09–12 / 13–17
  }
```

(For the leave-type granularity, extend the existing `leaveTypes` seed objects with the `allow*` flags.)

- [ ] **Step 2: Reseed locally**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm db:seed`
Expected: completes; `LeaveConfig` has one row; sample types have half/hourly enabled.

- [ ] **Step 3: Full gate — typecheck + lint + tests**

Run:
```bash
PATH="/opt/homebrew/bin:$PATH" pnpm typecheck && \
PATH="/opt/homebrew/bin:$PATH" pnpm lint && \
PATH="/opt/homebrew/bin:$PATH" pnpm test -- --run
```
Expected: all green (301 baseline + new `units` tests).

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "chore(leave): seed LeaveConfig + sample granularities"
```

---

## Self-review notes (coverage map)

- **Partial units / per-type flags** → Tasks 1–3, 5, 7, 10.
- **Company-wide half-day config** → Tasks 3, 4, 9.
- **Minutes storage, days+hours display** → Tasks 1, 6, 9, 10.
- **Two same-day halves + time-overlap guard** → Tasks 2, 5, 6 (submit + approval), Task 3 (relax unique), Task 11 (counting).
- **Frozen `chargedMinutes`** → Task 6.
- **Permissions** → Task 8.
- **Seed/dev exercise** → Task 12.

**Not in Phase 1 (later phases):** per-employee entitlements + LIFF balance/soft-warn (Phase 2); OT (Phase 3). The LIFF preview here shows the charged amount but not "remaining" — that arrives with Phase 2.

## Manual end-to-end smoke (after all tasks)

1. Settings → ประเภทการลา → edit ลากิจ → enable ครึ่งวัน + รายชั่วโมง → save.
2. Settings → ตั้งค่าการลา → set windows 09:00–12:00 / 13:00–17:00 → standard day shows "1 วัน" (= 7 ชม.).
3. LIFF → ส่งคำขอลา → pick ลากิจ → ครึ่งเช้า → preview "3 ชม." → submit.
4. LIFF → same date → รายชั่วโมง 13:30–15:00 → submit succeeds (disjoint); 09:30–11:00 → rejected (overlaps morning half).
5. Admin → approve both → employee shows once under "ลาวันนี้"; attendance has two OnLeave rows with the right segment times + durations.
