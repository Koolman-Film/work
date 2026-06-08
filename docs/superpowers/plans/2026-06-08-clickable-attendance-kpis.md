# Clickable Attendance KPIs → Filtered Live Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin dashboard's "เข้างานแล้ว" / "ยังไม่เข้า" figures deep-link into the live attendance board, which gains clickable KPI cards that filter to each state's employee list (including the never-before-surfaced not-checked-in and on-leave lists).

**Architecture:** Extend `getTodayAttendance()` to return two new employee lists (not-checked-in, on-leave) plus an `isClosedDay` flag, computing not-checked-in as a **pure diff** of the active `canCheckIn` roster minus a "busy" employee-id set (checked-in ∪ on-leave) so the exclusion logic is unit-testable. The live board's `StatCard`s become URL-driven filter toggles; the dashboard's `KpiHero` figures become permission-gated links.

**Tech Stack:** Next.js 16 (App Router, React 19 Server/Client Components), Prisma, Supabase Realtime, Vitest (pure-function unit tests), Playwright (e2e), Biome (lint).

**Spec:** [docs/superpowers/specs/2026-06-08-clickable-attendance-kpis-design.md](../specs/2026-06-08-clickable-attendance-kpis-design.md)

---

## Conventions for every task

- **Branch first.** This plan must run on a feature branch, not `main`. If not already on one: `git checkout -b feat/clickable-attendance-kpis`.
- **Tests live beside source** as `*.test.ts`, using `import { describe, expect, it } from 'vitest'`. There is **no** jsdom / testing-library — only **pure functions** get unit tests. UI wiring is verified by `npm run typecheck` + `npm run build` + an e2e test + manual check.
- Commands: `npm run test` (vitest), `npm run typecheck` (tsc --noEmit), `npm run lint` (biome), `npm run build`, `npm run test:e2e` (playwright).
- Each `git add` lists **exact paths** so unrelated uncommitted work in the tree is never swept into these commits.

## File Structure

| File | New/Modify | Responsibility |
|------|-----------|----------------|
| `src/lib/attendance/date.ts` | **New** | Pure date helpers: `bangkokDateUtcMidnight`, `isClosedDay`. Single source of truth (replaces 3 inline copies). |
| `src/lib/attendance/date.test.ts` | **New** | Unit tests for the date helpers. |
| `src/lib/attendance/live.ts` | Modify | Extend `getTodayAttendance` + export pure `selectNotCheckedIn`. New types. |
| `src/lib/attendance/live.test.ts` | **New** | Unit tests for `selectNotCheckedIn`. |
| `src/lib/attendance/check-in.ts` | Modify | Use shared `bangkokDateUtcMidnight` (keep local `bangkokDateString`). |
| `src/app/(admin)/admin/attendance/live/filter.ts` | **New** | Pure filter vocabulary + `parseFilter`, `isLate`, `selectView`. |
| `src/app/(admin)/admin/attendance/live/filter.test.ts` | **New** | Unit tests for the filter module. |
| `src/components/ui/stat-card.tsx` | Modify | Optional `onClick` + `active` props → renders as a button filter toggle. |
| `src/app/(admin)/admin/attendance/live/live-client.tsx` | Modify | Clickable KPI cards; render not-checked-in / on-leave lists; generic branch grouping. |
| `src/app/(admin)/admin/attendance/live/page.tsx` | Modify | Read `?filter=` searchParam → pass `initialFilter` to client. |
| `src/components/ui/kpi-hero.tsx` | Modify | Optional `checkedInHref` / `notCheckedInHref` → wrap figures in `<Link>`. |
| `src/app/(admin)/admin/page.tsx` | Modify | Permission-gate + pass hrefs; use shared date helpers. |
| `tests/e2e/admin-attendance-live-filter.spec.ts` | **New** | e2e: dashboard deep-link + checked-in / not-checked-in filtering. |

---

## Task 1: Shared date helpers (`date.ts`)

**Files:**
- Create: `src/lib/attendance/date.ts`
- Test: `src/lib/attendance/date.test.ts`
- Modify: `src/lib/attendance/check-in.ts`, `src/app/(admin)/admin/attendance/live/live.ts` (the inline copy is removed in Task 2), `src/app/(admin)/admin/page.tsx` (in Task 8)

- [ ] **Step 1: Write the failing test**

Create `src/lib/attendance/date.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bangkokDateUtcMidnight, isClosedDay } from './date';

describe('bangkokDateUtcMidnight', () => {
  it('maps a Bangkok-evening instant to that local date at UTC midnight', () => {
    // 2026-06-08 23:30 in Bangkok (UTC+7) is still 2026-06-08 locally,
    // even though in UTC it is already 2026-06-08T16:30Z.
    const d = new Date('2026-06-08T16:30:00.000Z');
    expect(bangkokDateUtcMidnight(d).toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('rolls to the next local date once Bangkok passes midnight', () => {
    // 2026-06-08T17:30Z == 2026-06-09T00:30 Bangkok → local date is the 9th.
    const d = new Date('2026-06-08T17:30:00.000Z');
    expect(bangkokDateUtcMidnight(d).toISOString()).toBe('2026-06-09T00:00:00.000Z');
  });
});

describe('isClosedDay', () => {
  it('is true on a Sunday (UTC-midnight date)', () => {
    // 2026-06-07 is a Sunday.
    expect(isClosedDay(new Date('2026-06-07T00:00:00.000Z'), false)).toBe(true);
  });

  it('is true on a holiday even when not Sunday', () => {
    // 2026-06-08 is a Monday.
    expect(isClosedDay(new Date('2026-06-08T00:00:00.000Z'), true)).toBe(true);
  });

  it('is false on a normal working day with no holiday', () => {
    expect(isClosedDay(new Date('2026-06-08T00:00:00.000Z'), false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/attendance/date.test.ts`
Expected: FAIL — `Cannot find module './date'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/attendance/date.ts`:

```ts
/**
 * Shared Bangkok-date helpers for attendance.
 *
 * Extracted from the verbatim copies that previously lived in live.ts,
 * check-in.ts, and the admin dashboard page. Pure + dependency-free so they
 * can be unit-tested without a DB or a request context.
 */

/**
 * Start-of-day in UTC for the Bangkok calendar date of `d`, matching how
 * Prisma stores `@db.Date` columns (UTC midnight). Uses the 'sv-SE' locale,
 * which renders YYYY-MM-DD, to extract the date part in Asia/Bangkok.
 */
export function bangkokDateUtcMidnight(d: Date): Date {
  const ymd = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * A "closed day" is one nobody is expected to check in on: a Sunday, or a
 * day with an active Holiday row. `date` must be a UTC-midnight @db.Date
 * value (as produced by `bangkokDateUtcMidnight`), so `getUTCDay()` reads the
 * Bangkok weekday correctly.
 */
export function isClosedDay(date: Date, hasHoliday: boolean): boolean {
  return date.getUTCDay() === 0 || hasHoliday;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/attendance/date.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Point `check-in.ts` at the shared helper**

In `src/lib/attendance/check-in.ts`:
1. Add to the imports near the top (alongside the other `@/lib` imports):

```ts
import { bangkokDateUtcMidnight } from './date';
```

2. **Delete** the local `bangkokDateUtcMidnight` function (lines ~92-98):

```ts
/** Helper: today's start-of-day in UTC for Prisma's `@db.Date` column. */
function bangkokDateUtcMidnight(d: Date): Date {
  const ymd = bangkokDateString(d);
  return new Date(`${ymd}T00:00:00.000Z`);
}
```

3. **Keep** `bangkokDateString` (it's still used directly at the `today:` and `date:` callsites). Leave all `bangkokDateUtcMidnight(...)` / `bangkokDateString(...)` callsites unchanged.

- [ ] **Step 6: Verify check-in.ts still typechecks**

Run: `npm run typecheck`
Expected: PASS, no errors (and `bangkokDateString` is still referenced, so no "unused" lint error).

- [ ] **Step 7: Commit**

```bash
git add src/lib/attendance/date.ts src/lib/attendance/date.test.ts src/lib/attendance/check-in.ts
git commit -m "refactor(attendance): extract shared bangkok date helpers"
```

---

## Task 2: Extend `getTodayAttendance` + pure `selectNotCheckedIn`

**Files:**
- Modify: `src/lib/attendance/live.ts`
- Test: `src/lib/attendance/live.test.ts` (new)

- [ ] **Step 1: Write the failing test for the pure diff helper**

Create `src/lib/attendance/live.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { selectNotCheckedIn, type RosterEmployee } from './live';

const roster: RosterEmployee[] = [
  { id: 'e1', employeeName: 'A A', employeeNickname: null, branchName: 'สาขา 1' },
  { id: 'e2', employeeName: 'B B', employeeNickname: 'บี', branchName: 'สาขา 1' },
  { id: 'e3', employeeName: 'C C', employeeNickname: null, branchName: 'สาขา 2' },
];

describe('selectNotCheckedIn', () => {
  it('returns roster members who are not in the busy set', () => {
    const busy = new Set(['e2']); // e2 checked in or on leave
    expect(selectNotCheckedIn(roster, busy, false).map((r) => r.id)).toEqual(['e1', 'e3']);
  });

  it('returns the whole roster when nobody is busy', () => {
    expect(selectNotCheckedIn(roster, new Set(), false).map((r) => r.id)).toEqual([
      'e1',
      'e2',
      'e3',
    ]);
  });

  it('returns an empty list on a closed day regardless of the busy set', () => {
    expect(selectNotCheckedIn(roster, new Set(), true)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/attendance/live.test.ts`
Expected: FAIL — `selectNotCheckedIn` / `RosterEmployee` not exported.

- [ ] **Step 3: Implement the new types, pure helper, and extended loader**

Rewrite `src/lib/attendance/live.ts` to the following (this is the full file):

```ts
'use server';

/**
 * `getTodayAttendance()` — reused for both the initial Server-Component
 * render and the 30-second polling fallback in the live board client.
 *
 * Returns today's CheckIn rows (newest first) PLUS the two employee lists the
 * KPI filters need (not-checked-in, on-leave) and the roster figures the KPI
 * strip shows. The not-checked-in list is a pure diff of the active
 * `canCheckIn` roster minus everyone "busy" today (checked-in ∪ on-leave), so
 * the exclusion logic is unit-testable without a DB.
 */

import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { bangkokDateUtcMidnight, isClosedDay } from './date';

export type LiveAttendanceRow = {
  id: string;
  employeeName: string;
  employeeNickname: string | null;
  branchName: string;
  clockInAt: string | null; // ISO
  clockOutAt: string | null; // ISO
  checkInStatus: 'Confirmed' | 'Disputed' | 'Rejected' | null;
  isOverridden: boolean;
};

/** A roster member as shown in the not-checked-in list. `id` keys the chip. */
export type RosterEmployee = {
  id: string;
  employeeName: string;
  employeeNickname: string | null;
  branchName: string;
};

/** An on-leave member, with the leave type + range for the chip subtitle. */
export type OnLeaveEmployee = RosterEmployee & {
  leaveTypeName: string | null;
  startDate: string | null; // ISO date
  endDate: string | null; // ISO date
};

export type LiveBoardData = {
  rows: LiveAttendanceRow[];
  /** Active canCheckIn employees with no CheckIn & no OnLeave today; [] on closed days. */
  notCheckedIn: RosterEmployee[];
  /** Today's OnLeave employees (name + leave type + range). */
  onLeave: OnLeaveEmployee[];
  /** Active canCheckIn roster size — the denominator for "เข้างานแล้ว %". */
  activeCount: number;
  /** OnLeave count for the "ลา/หยุด" tile (== onLeave.length). */
  onLeaveCount: number;
  /** Sunday or holiday — nobody is expected to check in. */
  isClosedDay: boolean;
};

/**
 * Pure: roster minus the busy set, or [] on a closed day. Exported for unit
 * tests — this is the whole "who hasn't checked in" rule.
 */
export function selectNotCheckedIn(
  roster: RosterEmployee[],
  busyEmployeeIds: ReadonlySet<string>,
  closed: boolean,
): RosterEmployee[] {
  if (closed) return [];
  return roster.filter((r) => !busyEmployeeIds.has(r.id));
}

export async function getTodayAttendance(): Promise<LiveBoardData> {
  await requirePermission('attendance.live-board');

  const today = bangkokDateUtcMidnight(new Date());

  const [checkInRows, rosterRows, onLeaveRows, holiday] = await Promise.all([
    prisma.attendance.findMany({
      where: { type: 'CheckIn', date: today },
      orderBy: { clockInAt: 'desc' },
      select: {
        id: true,
        employeeId: true,
        clockInAt: true,
        clockOutAt: true,
        checkInStatus: true,
        isOverridden: true,
        checkInBranch: { select: { name: true } },
        employee: {
          select: {
            firstName: true,
            lastName: true,
            nickname: true,
            branch: { select: { name: true } },
          },
        },
      },
    }),
    prisma.employee.findMany({
      where: { archivedAt: null, status: { not: 'Archived' }, canCheckIn: true },
      orderBy: [{ branch: { name: 'asc' } }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
        branch: { select: { name: true } },
      },
    }),
    prisma.attendance.findMany({
      where: { type: 'OnLeave', date: today, deletedAt: null },
      orderBy: [{ employee: { branch: { name: 'asc' } } }, { employee: { firstName: 'asc' } }],
      select: {
        id: true,
        employeeId: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
            nickname: true,
            branch: { select: { name: true } },
          },
        },
        leaveRequest: {
          select: {
            startDate: true,
            endDate: true,
            leaveType: { select: { name: true } },
          },
        },
      },
    }),
    prisma.holiday.findFirst({ where: { date: today, archivedAt: null }, select: { id: true } }),
  ]);

  const closed = isClosedDay(today, holiday !== null);

  const roster: RosterEmployee[] = rosterRows.map((e) => ({
    id: e.id,
    employeeName: `${e.firstName} ${e.lastName}`,
    employeeNickname: e.nickname,
    branchName: e.branch.name,
  }));

  // "Busy" = anyone with a CheckIn (the displayed rows) or an OnLeave today.
  // Derived from the same rows we render, so the checked-in list and the
  // not-checked-in list can never double-count an employee.
  const busyEmployeeIds = new Set<string>([
    ...checkInRows.map((r) => r.employeeId),
    ...onLeaveRows.map((r) => r.employeeId),
  ]);

  const onLeave: OnLeaveEmployee[] = onLeaveRows.map((r) => ({
    id: r.id,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    employeeNickname: r.employee.nickname,
    branchName: r.employee.branch.name,
    leaveTypeName: r.leaveRequest?.leaveType.name ?? null,
    startDate: r.leaveRequest ? r.leaveRequest.startDate.toISOString() : null,
    endDate: r.leaveRequest ? r.leaveRequest.endDate.toISOString() : null,
  }));

  return {
    rows: checkInRows.map((r) => ({
      id: r.id,
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
      employeeNickname: r.employee.nickname,
      branchName: r.checkInBranch?.name ?? r.employee.branch.name,
      clockInAt: r.clockInAt ? r.clockInAt.toISOString() : null,
      clockOutAt: r.clockOutAt ? r.clockOutAt.toISOString() : null,
      checkInStatus: r.checkInStatus,
      isOverridden: r.isOverridden,
    })),
    notCheckedIn: selectNotCheckedIn(roster, busyEmployeeIds, closed),
    onLeave,
    activeCount: roster.length,
    onLeaveCount: onLeave.length,
    isClosedDay: closed,
  };
}
```

> Note: `'use server'` files may only export async functions. `selectNotCheckedIn` is **synchronous**, so if the build complains that a server file exported a non-async value, move `selectNotCheckedIn` + the three `*Employee` types into a sibling `src/lib/attendance/live-shape.ts` (no `'use server'`) and re-export the helper from there in the test. Default to keeping it inline; only split if the build errors.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npm run test -- src/lib/attendance/live.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`live-client.tsx` still consumes `rows`, `activeCount`, `onLeaveCount`, which all still exist — the new fields are additive, so the client keeps compiling until Task 5.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/attendance/live.ts src/lib/attendance/live.test.ts
git commit -m "feat(attendance): getTodayAttendance returns not-checked-in + on-leave lists"
```

---

## Task 3: Live board filter module (`filter.ts`)

**Files:**
- Create: `src/app/(admin)/admin/attendance/live/filter.ts`
- Test: `src/app/(admin)/admin/attendance/live/filter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/(admin)/admin/attendance/live/filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LiveAttendanceRow, LiveBoardData } from '@/lib/attendance/live';
import { isLate, parseFilter, selectView } from './filter';

function row(over: Partial<LiveAttendanceRow>): LiveAttendanceRow {
  return {
    id: 'r',
    employeeName: 'A A',
    employeeNickname: null,
    branchName: 'สาขา 1',
    clockInAt: '2026-06-08T01:00:00.000Z', // 08:00 Bangkok → not late
    clockOutAt: null,
    checkInStatus: 'Confirmed',
    isOverridden: false,
    ...over,
  };
}

const present = row({ id: 'present' });
const lateRow = row({ id: 'late', clockInAt: '2026-06-08T03:00:00.000Z' }); // 10:00 BKK
const outRow = row({ id: 'out', clockOutAt: '2026-06-08T10:00:00.000Z' });

const data: LiveBoardData = {
  rows: [present, lateRow, outRow],
  notCheckedIn: [{ id: 'n1', employeeName: 'N N', employeeNickname: null, branchName: 'สาขา 1' }],
  onLeave: [
    {
      id: 'l1',
      employeeName: 'L L',
      employeeNickname: null,
      branchName: 'สาขา 2',
      leaveTypeName: 'ลาป่วย',
      startDate: '2026-06-08T00:00:00.000Z',
      endDate: '2026-06-08T00:00:00.000Z',
    },
  ],
  activeCount: 4,
  onLeaveCount: 1,
  isClosedDay: false,
};

describe('parseFilter', () => {
  it('accepts the five known filters', () => {
    for (const f of ['checkedin', 'late', 'notcheckedin', 'onleave', 'checkedout']) {
      expect(parseFilter(f)).toBe(f);
    }
  });
  it('returns null for unknown / null input', () => {
    expect(parseFilter('bogus')).toBeNull();
    expect(parseFilter(null)).toBeNull();
  });
});

describe('isLate', () => {
  it('is true after 09:00 Bangkok and false at/under it', () => {
    expect(isLate('2026-06-08T03:00:00.000Z')).toBe(true); // 10:00
    expect(isLate('2026-06-08T01:00:00.000Z')).toBe(false); // 08:00
    expect(isLate(null)).toBe(false);
  });
});

describe('selectView', () => {
  it('default (null) shows all check-in rows', () => {
    const v = selectView(data, null);
    expect(v.kind).toBe('checkin');
    if (v.kind === 'checkin') expect(v.rows.map((r) => r.id)).toEqual(['present', 'late', 'out']);
  });
  it('late shows only late check-ins', () => {
    const v = selectView(data, 'late');
    expect(v.kind).toBe('checkin');
    if (v.kind === 'checkin') expect(v.rows.map((r) => r.id)).toEqual(['late']);
  });
  it('checkedout shows only checked-out rows', () => {
    const v = selectView(data, 'checkedout');
    if (v.kind === 'checkin') expect(v.rows.map((r) => r.id)).toEqual(['out']);
  });
  it('notcheckedin shows the roster list', () => {
    const v = selectView(data, 'notcheckedin');
    expect(v.kind).toBe('roster');
    if (v.kind === 'roster') expect(v.rows.map((r) => r.id)).toEqual(['n1']);
  });
  it('onleave shows the leave list', () => {
    const v = selectView(data, 'onleave');
    expect(v.kind).toBe('leave');
    if (v.kind === 'leave') expect(v.rows.map((r) => r.id)).toEqual(['l1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- "src/app/(admin)/admin/attendance/live/filter.test.ts"`
Expected: FAIL — `./filter` not found.

- [ ] **Step 3: Implement the filter module**

Create `src/app/(admin)/admin/attendance/live/filter.ts`:

```ts
/**
 * Pure filter logic for the live attendance board. Kept out of the client
 * component so the "which list does this filter show" rule is unit-testable
 * (the repo convention — see status-badge.test.ts).
 */

import type { LiveAttendanceRow, LiveBoardData, OnLeaveEmployee, RosterEmployee } from '@/lib/attendance/live';

export type AttendanceFilter = 'checkedin' | 'late' | 'notcheckedin' | 'onleave' | 'checkedout';

export const ATTENDANCE_FILTERS: readonly AttendanceFilter[] = [
  'checkedin',
  'late',
  'notcheckedin',
  'onleave',
  'checkedout',
];

/** Narrow a raw `?filter=` value to a known filter, or null (default view). */
export function parseFilter(raw: string | null | undefined): AttendanceFilter | null {
  return raw != null && (ATTENDANCE_FILTERS as readonly string[]).includes(raw)
    ? (raw as AttendanceFilter)
    : null;
}

/** A check-in is "late" if its clock-in is after 09:00 Asia/Bangkok. */
export function isLate(clockInIso: string | null): boolean {
  if (!clockInIso) return false;
  const hhmm = new Date(clockInIso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return hhmm > '09:00';
}

/** Discriminated view the client renders for the active filter. */
export type BoardView =
  | { kind: 'checkin'; rows: LiveAttendanceRow[] }
  | { kind: 'roster'; rows: RosterEmployee[] }
  | { kind: 'leave'; rows: OnLeaveEmployee[] };

/** Map the active filter to the list of items to render. */
export function selectView(data: LiveBoardData, filter: AttendanceFilter | null): BoardView {
  switch (filter) {
    case 'notcheckedin':
      return { kind: 'roster', rows: data.notCheckedIn };
    case 'onleave':
      return { kind: 'leave', rows: data.onLeave };
    case 'late':
      return { kind: 'checkin', rows: data.rows.filter((r) => isLate(r.clockInAt)) };
    case 'checkedout':
      return { kind: 'checkin', rows: data.rows.filter((r) => r.clockOutAt != null) };
    default: // 'checkedin' and null both show the full check-in list
      return { kind: 'checkin', rows: data.rows };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- "src/app/(admin)/admin/attendance/live/filter.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/attendance/live/filter.ts" "src/app/(admin)/admin/attendance/live/filter.test.ts"
git commit -m "feat(attendance): add pure live-board filter module"
```

---

## Task 4: Make `StatCard` an optional filter toggle

**Files:**
- Modify: `src/components/ui/stat-card.tsx`

No unit test (no DOM testing in repo; backward compatibility verified by typecheck — the 3 existing consumers pass no new props). Optional props default to the current static rendering.

- [ ] **Step 1: Implement**

Replace `src/components/ui/stat-card.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Dashboard/owner metric tile: label + big tabular number + optional delta/hint.
 *
 * When `onClick` is provided the tile becomes a filter toggle (renders as a
 * `<button>`, shows a hover/active ring). Without it, it renders exactly as
 * before — a static `<div>` — so existing consumers are unaffected.
 */
export function StatCard({
  label,
  value,
  delta,
  hint,
  className,
  onClick,
  active = false,
}: {
  label: string;
  value: ReactNode;
  delta?: { dir: 'up' | 'down'; text: string };
  hint?: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-4">
        {label}
      </p>
      <p className="mt-1 font-display text-3xl font-bold leading-none text-ink-1 tabular">{value}</p>
      {delta && (
        <p
          className={cn(
            'mt-2 text-[11px] font-semibold',
            delta.dir === 'up' ? 'text-success-deep' : 'text-danger-deep',
          )}
        >
          {delta.dir === 'up' ? '▲' : '▼'} {delta.text}
        </p>
      )}
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          'surface block w-full p-4 text-left transition hover:-translate-y-0.5 hover:shadow-cta',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
          active && 'ring-2 ring-primary-400',
          className,
        )}
      >
        {body}
      </button>
    );
  }

  return <div className={cn('surface p-4', className)}>{body}</div>;
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (Owner page, admin dashboard, and live-client still compile — they pass no `onClick`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/stat-card.tsx
git commit -m "feat(ui): StatCard supports optional onClick/active filter toggle"
```

---

## Task 5: Wire the live board client (clickable cards + new lists)

**Files:**
- Modify: `src/app/(admin)/admin/attendance/live/live-client.tsx`

No unit test (selection logic already tested in Task 3; rendering verified by typecheck/build + Task 9 e2e + manual).

- [ ] **Step 1: Implement**

Replace `src/app/(admin)/admin/attendance/live/live-client.tsx` with:

```tsx
'use client';

/**
 * Live attendance board — KPI strip (clickable filters) + branch-grouped list.
 *
 * Connection model (unchanged): subscribe to Supabase Realtime for
 * postgres_changes on Attendance → refetch the day on any change; plus a
 * 30s polling fallback so the board self-heals if the socket drops.
 *
 * Filtering: the five KPI cards are filter toggles. The active filter lives in
 * the URL (`?filter=`) so it's shareable and the dashboard can deep-link in;
 * the client seeds from `initialFilter` and updates the URL via router.replace.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard } from '@/components/ui/stat-card';
import {
  getTodayAttendance,
  type LiveAttendanceRow,
  type LiveBoardData,
  type OnLeaveEmployee,
  type RosterEmployee,
} from '@/lib/attendance/live';
import { createClient } from '@/lib/supabase/browser';
import { type AttendanceFilter, isLate, selectView } from './filter';

type Status =
  | { kind: 'realtime'; channelStatus: 'connecting' | 'connected' | 'error' }
  | { kind: 'polling-only' };

const POLL_INTERVAL_MS = 30_000;
const LIVE_PATH = '/admin/attendance/live';

export function LiveBoardClient({
  initial,
  initialFilter,
}: {
  initial: LiveBoardData;
  initialFilter: AttendanceFilter | null;
}) {
  const router = useRouter();
  const [data, setData] = useState<LiveBoardData>(initial);
  const [filter, setFilter] = useState<AttendanceFilter | null>(initialFilter);
  const [status, setStatus] = useState<Status>({ kind: 'realtime', channelStatus: 'connecting' });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refetch = useCallback(async () => {
    try {
      const next = await getTodayAttendance();
      setData(next);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('[live-board] refetch failed', err);
    }
  }, []);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  // Toggle a filter: clicking the active card clears it. Mirror the change to
  // the URL (replace, so we don't pile up history entries) for shareability.
  const toggleFilter = useCallback(
    (next: AttendanceFilter) => {
      setFilter((cur) => {
        const value = cur === next ? null : next;
        router.replace(value ? `${LIVE_PATH}?filter=${value}` : LIVE_PATH, { scroll: false });
        return value;
      });
    },
    [router],
  );

  // Realtime subscription.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('attendance:live-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Attendance' }, () => {
        void refetchRef.current();
      })
      .subscribe((channelStatus) => {
        if (channelStatus === 'SUBSCRIBED') {
          setStatus({ kind: 'realtime', channelStatus: 'connected' });
        } else if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
          setStatus({ kind: 'polling-only' });
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  // 30-second polling fallback.
  useEffect(() => {
    const id = setInterval(() => {
      void refetchRef.current();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const { rows, notCheckedIn, onLeave, activeCount, onLeaveCount } = data;
  const present = rows.length;
  const late = rows.filter((r) => isLate(r.clockInAt)).length;
  const out = rows.filter((r) => r.clockOutAt).length;
  const notYet = notCheckedIn.length;
  const pct = activeCount > 0 ? Math.round((present / activeCount) * 100) : 0;

  const view = selectView(data, filter);

  return (
    <div className="space-y-5">
      {/* Status row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusPill status={status} />
        <div className="flex items-center gap-3 text-xs text-ink-3">
          <a
            href="/admin/attendance/manual"
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-medium text-ink-2 transition hover:bg-gray-50"
          >
            + บันทึกด้วยตนเอง
          </a>
          <span>
            ซิงค์ล่าสุด{' '}
            {lastUpdated
              ? lastUpdated.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })
              : '—'}
          </span>
        </div>
      </div>

      {/* KPI strip — clickable filters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="เข้างานแล้ว"
          value={present}
          hint={`${pct}% ของ ${activeCount} คน`}
          active={filter === 'checkedin'}
          onClick={() => toggleFilter('checkedin')}
        />
        <StatCard
          label="มาสาย"
          value={late}
          hint="เช็คอินหลัง 09:00"
          active={filter === 'late'}
          onClick={() => toggleFilter('late')}
        />
        <StatCard
          label="ยังไม่มา"
          value={notYet}
          hint="ยังไม่เช็คอินวันนี้"
          active={filter === 'notcheckedin'}
          onClick={() => toggleFilter('notcheckedin')}
        />
        <StatCard
          label="ลา/หยุด"
          value={onLeaveCount}
          hint="อนุมัติแล้ว"
          active={filter === 'onleave'}
          onClick={() => toggleFilter('onleave')}
        />
        <StatCard
          label="ออกแล้ว"
          value={out}
          hint="เช็คเอาท์แล้ว"
          active={filter === 'checkedout'}
          onClick={() => toggleFilter('checkedout')}
        />
      </div>

      {/* List area — content depends on the active filter */}
      <FilteredList view={view} />

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-4">
        <Legend color="bg-emerald-400" label="กำลังทำงาน" />
        <Legend color="bg-amber-400" label="ตรวจสอบ" />
        <Legend color="bg-slate-300" label="ออกแล้ว" />
        <Legend color="bg-red-400" label="ปฏิเสธ" />
        <span className="ml-auto text-ink-5">realtime · supabase channel + 30s polling</span>
      </div>
    </div>
  );
}

function FilteredList({ view }: { view: ReturnType<typeof selectView> }) {
  if (view.kind === 'checkin') {
    if (view.rows.length === 0) {
      return (
        <div className="surface">
          <EmptyState title="ไม่มีรายการในมุมมองนี้" hint="แผงจะอัปเดตอัตโนมัติเมื่อมีการเปลี่ยนแปลง" />
        </div>
      );
    }
    return (
      <BranchGroups
        groups={groupByBranch(view.rows)}
        render={(r) => <Chip key={r.id} row={r} />}
      />
    );
  }

  if (view.kind === 'roster') {
    if (view.rows.length === 0) {
      return (
        <div className="surface">
          <EmptyState title="ทุกคนเช็คอินแล้ว ✨" hint="ไม่มีพนักงานที่ยังไม่เข้างานวันนี้" />
        </div>
      );
    }
    return (
      <BranchGroups
        groups={groupByBranch(view.rows)}
        render={(r) => <RosterChip key={r.id} person={r} />}
      />
    );
  }

  // view.kind === 'leave'
  if (view.rows.length === 0) {
    return (
      <div className="surface">
        <EmptyState title="ไม่มีพนักงานลาวันนี้" hint="รายการลาที่อนุมัติแล้วจะแสดงที่นี่" />
      </div>
    );
  }
  return (
    <BranchGroups
      groups={groupByBranch(view.rows)}
      render={(r) => <LeaveChip key={r.id} person={r} />}
    />
  );
}

function BranchGroups<T extends { branchName: string }>({
  groups,
  render,
}: {
  groups: { branch: string; rows: T[] }[];
  render: (item: T) => React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.branch}>
          <p className="mb-2 text-xs font-semibold text-ink-3">
            {g.branch} <span className="text-ink-4">· {g.rows.length} คน</span>
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.rows.map(render)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Chip({ row }: { row: LiveAttendanceRow }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border border-gray-200 border-l-4 ${chipRail(row)} bg-white px-3 py-2 shadow-sm`}
    >
      <Avatar name={row.employeeName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-1">
          {row.employeeName}
          {row.employeeNickname && <span className="text-ink-3"> ({row.employeeNickname})</span>}
        </p>
        <p className="mono text-[10px] text-ink-3">
          เข้า {row.clockInAt ? fmtTime(row.clockInAt) : '—'}
          {row.clockOutAt && ` · ออก ${fmtTime(row.clockOutAt)}`}
        </p>
      </div>
    </div>
  );
}

function RosterChip({ person }: { person: RosterEmployee }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-gray-200 border-l-4 border-l-slate-300 bg-white px-3 py-2 shadow-sm">
      <Avatar name={person.employeeName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-1">
          {person.employeeName}
          {person.employeeNickname && <span className="text-ink-3"> ({person.employeeNickname})</span>}
        </p>
        <p className="text-[10px] text-ink-4">ยังไม่เช็คอิน</p>
      </div>
    </div>
  );
}

function LeaveChip({ person }: { person: OnLeaveEmployee }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-gray-200 border-l-4 border-l-amber-400 bg-white px-3 py-2 shadow-sm">
      <Avatar name={person.employeeName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink-1">
          {person.employeeName}
          {person.employeeNickname && <span className="text-ink-3"> ({person.employeeNickname})</span>}
        </p>
        <p className="text-[10px] text-ink-3">
          {person.leaveTypeName ?? 'ลา'}
          {person.startDate && person.endDate && ` · ${fmtRange(person.startDate, person.endDate)}`}
        </p>
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-100 font-display text-[11px] font-bold text-primary-700">
      {initials(name)}
    </span>
  );
}

function StatusPill({ status }: { status: Status }) {
  if (status.kind === 'realtime' && status.channelStatus === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />🟢
        LIVE — เชื่อมต่อสด
      </span>
    );
  }
  if (status.kind === 'realtime' && status.channelStatus === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-ink-3">
        <span className="size-1.5 rounded-full bg-gray-400" aria-hidden="true" />
        กำลังเชื่อมต่อ...
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
      <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
      อัปเดตทุก 30 วินาที
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`size-2 rounded-full ${color}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function chipRail(row: LiveAttendanceRow): string {
  if (row.checkInStatus === 'Disputed') return 'border-l-amber-400';
  if (row.checkInStatus === 'Rejected') return 'border-l-red-400';
  if (row.clockOutAt) return 'border-l-slate-300';
  return 'border-l-emerald-400';
}

function groupByBranch<T extends { branchName: string }>(
  rows: T[],
): { branch: string; rows: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const list = map.get(r.branchName);
    if (list) list.push(r);
    else map.set(r.branchName, [r]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'th'))
    .map(([branch, list]) => ({ branch, rows: list }));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}

function fmtRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'UTC', day: 'numeric', month: 'short' };
  const start = new Date(startIso);
  const end = new Date(endIso);
  const same =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();
  if (same) return start.toLocaleDateString('th-TH', opts);
  return `${start.toLocaleDateString('th-TH', opts)}–${end.toLocaleDateString('th-TH', opts)}`;
}
```

> `isLate` now lives in `filter.ts` and is imported — the old local copy is gone. `import React` is not needed for the `React.ReactNode` type under the repo's `tsconfig` (`jsx: preserve` + React 19 automatic runtime); if typecheck complains, change `React.ReactNode` to `ReactNode` and add `import type { ReactNode } from 'react'`.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (The page still passes only `initial`; it gets `initialFilter` in Task 6 — until then typecheck FAILS on the missing prop, so do Task 6 before re-running. To keep this task self-contained, proceed straight to Task 6, then run typecheck once.)

- [ ] **Step 3: Commit (after Task 6 typechecks)** — see Task 6 Step 3.

---

## Task 6: Wire the live page to read `?filter=`

**Files:**
- Modify: `src/app/(admin)/admin/attendance/live/page.tsx`

- [ ] **Step 1: Implement**

Replace `src/app/(admin)/admin/attendance/live/page.tsx` with:

```tsx
/**
 * /admin/attendance/live — today's check-in board.
 *
 * Server Component does the initial fetch (useful before client JS / Realtime
 * connects); the Client child subscribes to Supabase Realtime + 30s polling.
 * Reads `?filter=` so the dashboard KPIs can deep-link into a specific list.
 */

import { PageHeader } from '@/components/ui/page-header';
import { getTodayAttendance } from '@/lib/attendance/live';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { AttendanceTabs } from '../attendance-tabs';
import { parseFilter } from './filter';
import { LiveBoardClient } from './live-client';

export default async function LiveBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requirePermission('attendance.live-board');
  const [{ filter }, [initial, disputedCount]] = await Promise.all([
    searchParams,
    Promise.all([
      getTodayAttendance(),
      prisma.attendance.count({
        where: { type: 'CheckIn', checkInStatus: 'Disputed', deletedAt: null },
      }),
    ]),
  ]);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ลงเวลา"
        title="การลงเวลาสด"
        subtitle="อัปเดตอัตโนมัติทุก 30 วินาที — เรียลไทม์ผ่าน Supabase channel"
      />
      <AttendanceTabs current="live" disputedCount={disputedCount} />
      <LiveBoardClient initial={initial} initialFilter={parseFilter(filter)} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS. The board route compiles with the new client props.

- [ ] **Step 3: Commit (Tasks 5 + 6 together — they're interdependent)**

```bash
git add "src/app/(admin)/admin/attendance/live/live-client.tsx" "src/app/(admin)/admin/attendance/live/page.tsx"
git commit -m "feat(attendance): clickable KPI filters + not-checked-in/on-leave lists on live board"
```

---

## Task 7: `KpiHero` optional figure links

**Files:**
- Modify: `src/components/ui/kpi-hero.tsx`

- [ ] **Step 1: Implement**

Replace `src/components/ui/kpi-hero.tsx` with:

```tsx
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Dashboard hero (Sapphire gradient). Leads with two equal figures —
 * checked-in (white) and not-checked-in (amber, the action-needed number) —
 * with the expected total, a progress bar, and late/leave sub-stats.
 *
 * Each figure can optionally be a link (`checkedInHref` / `notCheckedInHref`):
 * when set, the number+label column becomes a clickable `<Link>` with a hover
 * affordance. When omitted it renders as a plain figure (unchanged).
 */
export function KpiHero({
  checkedIn,
  notCheckedIn,
  total,
  late,
  leave,
  percent,
  checkedInHref,
  notCheckedInHref,
}: {
  checkedIn: number;
  notCheckedIn: number;
  total: number;
  late?: number;
  leave?: number;
  /** Override the bar %; defaults to checkedIn/total. */
  percent?: number;
  checkedInHref?: string;
  notCheckedInHref?: string;
}) {
  const pct = percent ?? (total > 0 ? Math.round((checkedIn / total) * 100) : 0);
  return (
    <div
      className="relative flex h-full flex-col overflow-hidden rounded-2xl p-5 text-white shadow-hero"
      style={{
        background: 'linear-gradient(135deg, var(--color-primary-700), var(--color-primary-900))',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="font-display text-[11.5px] font-semibold uppercase tracking-wider opacity-70">
          การเข้างานวันนี้
        </div>
        <div className="text-right leading-tight">
          <div className="text-[13px] font-semibold tabular opacity-85">{total}</div>
          <div className="text-[10px] opacity-55">ที่ต้องเข้า</div>
        </div>
      </div>

      <div className="mt-2 flex items-end gap-5">
        <Figure href={checkedInHref} ariaLabel="ดูรายชื่อผู้ที่เข้างานแล้ว">
          <div className="font-display text-[52px] font-black leading-none tabular tracking-[-0.04em]">
            {checkedIn}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs opacity-85">
            <span className="size-2 rounded-full bg-[#6ee7b7]" />{' '}
            <span className="group-hover:underline">เข้างานแล้ว</span>
          </div>
        </Figure>
        <div className="mb-1.5 h-12 w-px bg-white/20" />
        <Figure href={notCheckedInHref} ariaLabel="ดูรายชื่อผู้ที่ยังไม่เข้า">
          <div className="font-display text-[52px] font-black leading-none tabular tracking-[-0.04em] text-[#fde68a]">
            {notCheckedIn}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs opacity-85">
            <span className="size-2 rounded-full bg-accent-400" />{' '}
            <span className="group-hover:underline">ยังไม่เข้า</span>
          </div>
        </Figure>
      </div>

      <div className="mt-auto pt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, var(--color-accent-400), #f59e0b)',
            }}
          />
        </div>
        <div className="mt-2.5 flex items-center gap-4 text-[11.5px] opacity-80">
          <span>เข้าแล้ว {pct}%</span>
          {late != null && <span>● สาย {late}</span>}
          {leave != null && <span>● ลา {leave}</span>}
        </div>
      </div>
    </div>
  );
}

/** A figure column: a hover-underlining `<Link>` when `href` is set, else a plain block. */
function Figure({
  href,
  ariaLabel,
  children,
}: {
  href?: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        className="group -m-1 rounded-lg p-1 transition hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        {children}
      </Link>
    );
  }
  return <div>{children}</div>;
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (The dashboard passes no hrefs yet, so figures render plainly — unchanged.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/kpi-hero.tsx
git commit -m "feat(ui): KpiHero figures support optional deep-link hrefs"
```

---

## Task 8: Wire the dashboard (permission-gate + hrefs + shared date helpers)

**Files:**
- Modify: `src/app/(admin)/admin/page.tsx`

- [ ] **Step 1: Swap inline date helpers for the shared module**

In `src/app/(admin)/admin/page.tsx`:

1. Add the import (next to the other `@/lib` imports):

```ts
import { canDo } from '@/lib/auth/check-permission';
import { bangkokDateUtcMidnight, isClosedDay } from '@/lib/attendance/date';
```

(`requirePermission` is already imported from `@/lib/auth/check-permission`; add `canDo` to that existing import line instead of duplicating — i.e. `import { canDo, requirePermission } from '@/lib/auth/check-permission';`.)

2. **Delete** the local `bangkokDateUtcMidnight` function (lines ~46-54, including its doc comment).

- [ ] **Step 2: Capture the user, compute board access, and use shared `isClosedDay`**

In the same file, change the permission line and the closed-day computation:

Replace:

```ts
  await requirePermission('dashboard.read');

  const today = bangkokDateUtcMidnight(new Date());
  const todayIsSunday = today.getUTCDay() === 0;
  const todayYmd = today.toISOString().slice(0, 10);
```

with:

```ts
  const { user } = await requirePermission('dashboard.read');
  const canViewLiveBoard = await canDo(user, 'attendance.live-board');

  const today = bangkokDateUtcMidnight(new Date());
  const todayYmd = today.toISOString().slice(0, 10);
```

Then replace the `isClosedDay` derivation:

```ts
  const isClosedDay = todayIsSunday || todayHoliday !== null;
  const notCheckedInCount = isClosedDay
```

with (note: shadowing is gone — `isClosedDay` is now the imported function, so name the boolean `closedToday`):

```ts
  const closedToday = isClosedDay(today, todayHoliday !== null);
  const notCheckedInCount = closedToday
```

…and update the two later references to the old `isClosedDay` boolean to `closedToday`:
- the `<Pill variant="neutral">` branch: `isClosedDay ? (...)` → `closedToday ? (...)`
- the "ลาวันนี้" empty-state line: `{isClosedDay ? (...)}` → `{closedToday ? (...)}`

(Search the file for `isClosedDay` after editing — every remaining **boolean** use must read `closedToday`; the only `isClosedDay` identifier left should be the imported function call.)

- [ ] **Step 3: Pass the deep-link hrefs to `KpiHero`**

Replace the `<KpiHero .../>` usage:

```tsx
          <KpiHero
            checkedIn={checkedInTodayCount}
            notCheckedIn={notCheckedInCount}
            total={activeEmployeeCount}
            leave={onLeaveTodayCount}
          />
```

with:

```tsx
          <KpiHero
            checkedIn={checkedInTodayCount}
            notCheckedIn={notCheckedInCount}
            total={activeEmployeeCount}
            leave={onLeaveTodayCount}
            checkedInHref={
              canViewLiveBoard ? '/admin/attendance/live?filter=checkedin' : undefined
            }
            notCheckedInHref={
              canViewLiveBoard ? '/admin/attendance/live?filter=notcheckedin' : undefined
            }
          />
```

- [ ] **Step 4: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS. No remaining bare-boolean `isClosedDay` references; dashboard still renders with `revalidate = 30` (the page reads no `searchParams`, so it stays ISR-cached).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/page.tsx"
git commit -m "feat(dashboard): deep-link attendance KPIs to filtered live board"
```

---

## Task 9: e2e — dashboard deep-link + checked-in/not-checked-in filtering

**Files:**
- Create: `tests/e2e/admin-attendance-live-filter.spec.ts`

Covers the integration the unit tests can't: the dashboard link navigates to the board with the right filter, a checked-in employee shows under `checkedin`, and a not-checked-in employee shows under `notcheckedin` (Sunday-guarded, since closed days legitimately empty that list).

- [ ] **Step 1: Write the test**

Create `tests/e2e/admin-attendance-live-filter.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * Clickable dashboard KPIs → filtered live board. Seeds two e2e employees in
 * a fresh branch: one with a CheckIn for *today* (Bangkok) and one with no
 * attendance (so they're "not checked in"). Drives the real UI.
 */
test.describe('Live board KPI filters', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  // today at UTC-midnight, matching @db.Date semantics (same as the loader).
  function todayUtcMidnight(): Date {
    const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    return new Date(`${ymd}T00:00:00.000Z`);
  }
  function isSundayBangkok(): boolean {
    return todayUtcMidnight().getUTCDay() === 0;
  }

  async function seed(suffix: string) {
    const branch = await prisma.branch.create({
      data: {
        name: `e2e-Branch-${suffix}`,
        latitude: new Prisma.Decimal(13.7563),
        longitude: new Prisma.Decimal(100.5018),
        radiusMeters: 150,
      },
    });
    async function emp(tag: string) {
      const user = await prisma.user.create({ data: {} });
      return prisma.employee.create({
        data: {
          userId: user.id,
          firstName: `e2e-${tag}-${suffix}`,
          lastName: `e2e-Last-${suffix}`,
          branchId: branch.id,
          assignedBranchIds: [branch.id],
          salaryType: 'Monthly',
          baseSalary: new Prisma.Decimal(20_000),
          status: 'Active',
          canCheckIn: true,
          hiredAt: new Date('2026-01-01'),
        },
      });
    }
    const present = await emp('Present');
    const absent = await emp('Absent');
    await prisma.attendance.create({
      data: {
        employeeId: present.id,
        date: todayUtcMidnight(),
        type: 'CheckIn',
        source: 'Liff',
        clockInAt: new Date(),
        checkInBranchId: branch.id,
        checkInStatus: 'Confirmed',
        createdById: present.userId,
      },
    });
    return { presentName: present.firstName, absentName: absent.firstName };
  }

  test('checked-in employee appears under ?filter=checkedin', async ({ page }) => {
    const { presentName, absentName } = await seed(e2eId());
    await loginAsAdmin(page);
    await page.goto('/admin/attendance/live?filter=checkedin');
    await expect(page.getByText(presentName, { exact: false })).toBeVisible();
    await expect(page.getByText(absentName, { exact: false })).toHaveCount(0);
  });

  test('not-checked-in employee appears under ?filter=notcheckedin', async ({ page }) => {
    test.skip(isSundayBangkok(), 'Closed day: not-checked-in list is empty by design');
    const { presentName, absentName } = await seed(e2eId());
    await loginAsAdmin(page);
    await page.goto('/admin/attendance/live?filter=notcheckedin');
    await expect(page.getByText(absentName, { exact: false })).toBeVisible();
    await expect(page.getByText(presentName, { exact: false })).toHaveCount(0);
  });

  test('dashboard เข้างานแล้ว figure links to the checked-in board', async ({ page }) => {
    await seed(e2eId());
    await loginAsAdmin(page);
    await page.goto('/admin');
    await page.getByRole('link', { name: 'ดูรายชื่อผู้ที่เข้างานแล้ว' }).click();
    await expect(page).toHaveURL(/\/admin\/attendance\/live\?filter=checkedin/);
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npm run test:e2e -- admin-attendance-live-filter`
Expected: PASS (3 tests; the not-checked-in test auto-skips on Sundays). If the dev/preview server isn't running per the Playwright config, start it as the other e2e specs require (see `tests/e2e/README.md`).

> If `getByText(presentName)` is flaky because the seeded admin's own roster is large, the names are `e2e-…`-prefixed and unique per run, so the exact-substring assertions remain stable. The dashboard `เข้างานแล้ว` link is matched by its `aria-label` set in Task 7.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/admin-attendance-live-filter.spec.ts
git commit -m "test(e2e): live board KPI filters + dashboard deep-link"
```

---

## Task 10: Full verification + manual check

- [ ] **Step 1: Run the whole suite**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 2: Manual smoke (dev server)**

Run: `npm run dev`, then:
1. Open `/admin`. Confirm the "การเข้างานวันนี้" hero shows เข้างานแล้ว and ยังไม่เข้า; hovering each underlines the label and shows a pointer.
2. Click **เข้างานแล้ว** → lands on `/admin/attendance/live?filter=checkedin`, the เข้างานแล้ว card is ring-highlighted, list shows checked-in employees.
3. Click **ยังไม่มา** card → URL becomes `?filter=notcheckedin`, list shows not-checked-in employees with "ยังไม่เช็คอิน".
4. Click **ลา/หยุด** → on-leave employees with leave type/range.
5. Click the active card again → highlight clears, URL drops `?filter=`, default check-in list returns.
6. Back on `/admin`, click **ยังไม่เข้า** → `?filter=notcheckedin`, list correct.
7. (If testable) As an admin **without** `attendance.live-board`, the two figures render as plain numbers (no link, no pointer).

- [ ] **Step 3: Final commit (if manual tweaks were needed)**

```bash
git add -A
git commit -m "chore(attendance): polish clickable KPI live-board filtering"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** A (data layer) → Task 2; B (roster reconciliation `canCheckIn`) → Task 2 (`rosterRows` where-clause + `activeCount = roster.length`); C (clickable cards / lists) → Tasks 3-6; D (KpiHero links + permission gate) → Tasks 7-8; E (edge cases/testing) → Tasks 1-3 unit tests + Task 9 e2e; closed-day (decision 7) → `isClosedDay` in Tasks 1-2, dashboard `closedToday` in Task 8; date extraction (decision 6) → Task 1. All covered.
- **Placeholder scan:** none — every code step is complete.
- **Type/name consistency:** `LiveBoardData` fields (`rows`, `notCheckedIn`, `onLeave`, `activeCount`, `onLeaveCount`, `isClosedDay`), `RosterEmployee`/`OnLeaveEmployee` (with `id`), `selectNotCheckedIn`, `AttendanceFilter` values (`checkedin|late|notcheckedin|onleave|checkedout`), `selectView`/`BoardView` kinds (`checkin|roster|leave`), `parseFilter`, `isLate`, and the `Figure`/`StatCard` props are used identically across tasks. The dashboard boolean is renamed `closedToday` to avoid shadowing the imported `isClosedDay` function.
