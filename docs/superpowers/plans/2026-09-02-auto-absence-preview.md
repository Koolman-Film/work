# Auto-absence Phase 1: Pure Core + Read-Only Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show admins exactly which days would be derived as absence and what they would cost, without changing a single baht of anyone's pay.

**Architecture:** A pure `deriveAbsentMinutes` following the codebase's pure-core pattern (`over-quota.ts`, `late-policy.ts`), a server-side gatherer that assembles one payroll period's worth of per-employee per-date facts, and a read-only page mirroring `/admin/tools/leave-backlog`. **No migration, no payroll integration, no money math changes.** Phase 2 adds `PayrollConfig.absenceDerivedFrom` and the fractional deduction; this phase deliberately ships zero DDL so it can be reverted by redeploy alone.

**Tech Stack:** Next.js 16 App Router (server components), Prisma/PostgreSQL, Vitest (unit + integration), Biome.

**Spec:** `docs/superpowers/specs/2026-08-10-auto-absence-design.md`

## Global Constraints

- **This phase writes nothing.** No `create`/`update`/`upsert`/`delete`, no migration, no schema change. If a task seems to need one, stop and ask.
- **Payroll money math is untouched.** `calc.ts`'s `absentCount` stays whole-row. Do not touch `reconcile-settlement.ts`.
- Admin UI is deliberately untranslated Thai (see `formatDaysHours` in `src/lib/leave/units.ts`). This page is admin-only → Thai literals, no i18n keys.
- Gate on `payroll.read` via `requireGlobalPermission`, matching `/admin/tools/leave-backlog`.
- `@db.Date` columns are UTC midnight. Compare and bucket by `toISOString().slice(0, 10)`, never by local-time getters.
- `prisma` auto-filters `deletedAt`; raw SQL does not. Use `prisma`.
- Run the full gate before each commit: `npx biome check src/ tests/`, `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, and for Task 2+ `pnpm db:test:deploy && pnpm test:integration`.

---

### Task 1: Pure core — `deriveAbsentMinutes`

**Files:**
- Create: `src/lib/attendance/derive-absence.ts`
- Test: `src/lib/attendance/derive-absence.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports from the app).
- Produces: `deriveAbsentMinutes(input: AbsenceDayInput): number` and `type AbsenceDayInput = { scheduledMinutes: number; leaveMinutes: number | null; hasCheckIn: boolean; hasManualAbsent: boolean; isWorkday: boolean }`.

**Why `leaveMinutes` is nullable, and why null means "fully covered":** production has 14 `OnLeave` attendance rows with a NULL `durationMinutes`, and every one of them is อีฟ's approved full-day maternity leave. Treating unknown as zero coverage would derive her as absent for ~30 consecutive days. Under-deriving is recoverable by an admin keying a manual `Absent`; falsely deducting a month of maternity pay is not.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/attendance/derive-absence.test.ts
import { describe, expect, it } from 'vitest';
import { type AbsenceDayInput, deriveAbsentMinutes } from './derive-absence';

const day = (o: Partial<AbsenceDayInput> = {}): AbsenceDayInput => ({
  scheduledMinutes: 480,
  leaveMinutes: 0,
  hasCheckIn: false,
  hasManualAbsent: false,
  isWorkday: true,
  ...o,
});

describe('deriveAbsentMinutes', () => {
  it('derives a whole scheduled day when nobody turned up and no leave covers it', () => {
    expect(deriveAbsentMinutes(day())).toBe(480);
  });

  it('derives nothing when they checked in — lateness and early-leave handle the rest', () => {
    expect(deriveAbsentMinutes(day({ hasCheckIn: true }))).toBe(0);
  });

  it('derives nothing on a non-workday (Sunday, holiday, or off their schedule)', () => {
    expect(deriveAbsentMinutes(day({ isWorkday: false }))).toBe(0);
  });

  it('derives only the uncovered part when a half-day leave covers the rest', () => {
    expect(deriveAbsentMinutes(day({ leaveMinutes: 180 }))).toBe(300);
  });

  it('derives nothing when leave covers the whole scheduled day', () => {
    expect(deriveAbsentMinutes(day({ leaveMinutes: 480 }))).toBe(0);
  });

  it('clamps to zero when leave exceeds the scheduled day', () => {
    expect(deriveAbsentMinutes(day({ leaveMinutes: 600 }))).toBe(0);
  });

  it('treats UNKNOWN leave duration as fully covered, never as uncovered', () => {
    // Production: 14 OnLeave rows have a null durationMinutes and every one is
    // อีฟ's approved maternity leave. Reading null as "0 minutes of leave"
    // would derive ~30 absent days against her. Under-deriving is recoverable;
    // deducting a month of maternity pay is not.
    expect(deriveAbsentMinutes(day({ leaveMinutes: null }))).toBe(0);
  });

  it('yields to an admin-keyed manual Absent row rather than double-counting it', () => {
    expect(deriveAbsentMinutes(day({ hasManualAbsent: true }))).toBe(0);
  });

  it('derives nothing when the day has no scheduled minutes', () => {
    expect(deriveAbsentMinutes(day({ scheduledMinutes: 0 }))).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/attendance/derive-absence.test.ts`
Expected: FAIL — `deriveAbsentMinutes is not a function`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/attendance/derive-absence.ts
/**
 * How many minutes of a scheduled day an employee was absent for — derived,
 * never stored.
 *
 * Absence does not exist in this system today: `Absent` rows are created in
 * exactly one place, the admin manual-entry form, and payroll deducts only what
 * was keyed by hand. This is the pure core of deriving it instead, so that
 * "ไม่ได้เช็คอิน / ไม่ลา แต่ระบบไม่ขึ้นว่า ขาดงาน" stops depending on somebody
 * remembering.
 *
 * Derived rather than stored so it self-corrects: approve leave retroactively
 * and the absence disappears on the next read, with no backfill. Same
 * derive-on-read model as `computeLiveLeaveCharges`.
 */

export type AbsenceDayInput = {
  /** Minutes the employee's WorkSchedule says they work on this weekday. */
  scheduledMinutes: number;
  /**
   * Minutes of approved leave covering this date, or `null` when leave exists
   * but its duration was never recorded. Null is NOT zero — see below.
   */
  leaveMinutes: number | null;
  /** Any CheckIn row for the date: they turned up, so this is not an absence. */
  hasCheckIn: boolean;
  /** An admin keyed an Absent row for this date — their word beats inference. */
  hasManualAbsent: boolean;
  /** A scheduled working day: not Sunday, not a holiday, on their schedule. */
  isWorkday: boolean;
};

export function deriveAbsentMinutes(input: AbsenceDayInput): number {
  if (!input.isWorkday) return 0;
  if (input.hasCheckIn) return 0;
  // The admin's explicit statement wins over the inference, so the two can
  // never both charge for the same date.
  if (input.hasManualAbsent) return 0;
  // Unknown leave duration counts as FULL coverage, deliberately. Production
  // has 14 OnLeave rows with a null durationMinutes and all of them are one
  // employee's approved maternity leave; reading null as "no leave" would
  // derive her as absent for the whole of it. An under-derived day can still be
  // keyed by hand — a wrongly deducted month of maternity pay cannot be undone
  // as easily.
  if (input.leaveMinutes === null) return 0;
  return Math.max(0, input.scheduledMinutes - input.leaveMinutes);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/attendance/derive-absence.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Full gate, then commit**

```bash
npx biome check --write src/lib/attendance/derive-absence.ts src/lib/attendance/derive-absence.test.ts
npx tsc --noEmit -p tsconfig.json
npx vitest run
git add src/lib/attendance/derive-absence.ts src/lib/attendance/derive-absence.test.ts
git commit -m "feat(attendance): pure core for derived absence"
```

---

### Task 2: Read-side gatherer — `previewAbsences`

**Files:**
- Create: `src/lib/attendance/absence-preview.ts`
- Test: `tests/integration/absence-preview.integration.test.ts`

**Interfaces:**
- Consumes: `deriveAbsentMinutes`, `AbsenceDayInput` (Task 1); `isScheduledWorkday(scheduleDows, dow, hasHoliday)` from `src/lib/attendance/schedule.ts`; `windowMinutes(start, end)` and `standardDayMinutes(cfg)` from `src/lib/leave/units.ts`; `payrollMonthWindowYmd(month, cutoffDay)` from `src/lib/payroll/period.ts`; `expandHolidaysWithSubstitutes(holidays)` from `src/lib/leave/working-days.ts`.
- Produces: `previewAbsences(month: string): Promise<AbsencePreview>` where
  `type AbsencePreviewDay = { date: string; minutes: number }` and
  `type AbsencePreviewRow = { employeeId: string; name: string; baseSalary: number; days: AbsencePreviewDay[]; totalMinutes: number; totalDays: number; estimatedBaht: number; hasSchedule: boolean }` and
  `type AbsencePreview = { month: string; from: string; to: string; rows: AbsencePreviewRow[]; standardDayMinutes: number; absentDeductionPerDay: number; skippedNoSchedule: number }`.

**Note:** `estimatedBaht` is `totalDays * absentDeductionPerDay` — an *estimate shown on a page*, not a deduction. Nothing consumes it.

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/absence-preview.integration.test.ts
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { previewAbsences } from '@/lib/attendance/absence-preview';
import { prisma } from '@/lib/db/prisma';

const MONTH = '2026-06';

// Local reset + config seed, matching the convention in
// payslip-document.integration.test.ts. There is no shared `helpers/` module:
// `tests/integration/_reset-db.ts` is a `setupFiles` hook that truncates BETWEEN
// FILES, and each file still owns its own `beforeEach` reset. previewAbsences
// calls payrollConfig.findFirstOrThrow, so the config rows are required, not
// decoration.
async function reset() {
  await prisma.attendance.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.holiday.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.workScheduleDay.deleteMany({});
  await prisma.workSchedule.deleteMany({});
  await prisma.payrollConfig.deleteMany({});
  await prisma.leaveConfig.deleteMany({});
  await prisma.leaveConfig.create({ data: {} });
  await prisma.payrollConfig.create({
    data: {
      ssoRate: new Prisma.Decimal('0.05'),
      ssoSalaryCap: new Prisma.Decimal(15_000),
      ssoAmountCap: new Prisma.Decimal(750),
      otMultiplier: new Prisma.Decimal('1.5'),
      absentDeductionPerDay: new Prisma.Decimal(500),
      lateDeduction: new Prisma.Decimal(100),
      earlyLeaveDeduction: new Prisma.Decimal(100),
      workingDaysPerMonth: 30,
    },
  });
}

/** Employee.userId and Employee.branchId are BOTH required (schema.prisma). */
async function makeEmployee(workScheduleId: string | null) {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `br-${user.id.slice(0, 6)}` } });
  return prisma.employee.create({
    data: {
      userId: user.id,
      branchId: branch.id,
      firstName: 'Absent',
      lastName: 'Tester',
      baseSalary: new Prisma.Decimal(12_000),
      salaryType: 'Monthly',
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
      ...(workScheduleId ? { workScheduleId } : {}),
    },
  });
}

async function seed() {
  const schedule = await prisma.workSchedule.create({
    data: {
      name: 'it-mon-fri',
      days: {
        create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '09:00',
          endTime: '17:00',
        })),
      },
    },
  });
  return { employee: await makeEmployee(schedule.id), schedule };
}

describe('previewAbsences', () => {
  beforeEach(reset);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('derives a full scheduled day when there is no check-in and no leave', async () => {
    const { employee } = await seed();
    // 2026-06-01 is a Monday, inside the 2026-06 window (27 May – 26 Jun).
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01' && d.minutes === 480)).toBe(true);
  });

  it('derives nothing for a date the employee checked in', async () => {
    const { employee } = await seed();
    await prisma.attendance.create({
      data: { employeeId: employee.id, date: new Date('2026-06-01'), type: 'CheckIn' },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });

  it('yields to an admin-keyed manual Absent rather than deriving the same date twice', async () => {
    const { employee } = await seed();
    await prisma.attendance.create({
      data: { employeeId: employee.id, date: new Date('2026-06-01'), type: 'Absent' },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });

  it('treats an OnLeave row with a NULL duration as fully covered', async () => {
    // The maternity-leave shape: approved leave whose minutes were never
    // recorded must never read as an absence.
    const { employee } = await seed();
    await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: new Date('2026-06-01'),
        type: 'OnLeave',
        durationMinutes: null,
      },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });

  it('derives only the uncovered part of a half-day leave', async () => {
    const { employee } = await seed();
    await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: new Date('2026-06-01'),
        type: 'OnLeave',
        durationMinutes: 180,
      },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.find((d) => d.date === '2026-06-01')?.minutes).toBe(300);
  });

  it('derives nothing on a holiday', async () => {
    const { employee } = await seed();
    await prisma.holiday.create({
      data: { date: new Date('2026-06-01'), name: 'e2e-holiday' },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });

  it('skips an employee with no work schedule instead of assuming Mon-Sat', async () => {
    const noSchedule = await makeEmployee(null);
    const preview = await previewAbsences(MONTH);
    expect(preview.rows.some((r) => r.employeeId === noSchedule.id)).toBe(false);
    expect(preview.skippedNoSchedule).toBeGreaterThanOrEqual(1);
  });

  it('writes nothing — the Attendance table is unchanged by a preview', async () => {
    const { employee } = await seed();
    const before = await prisma.attendance.count();
    await previewAbsences(MONTH);
    expect(await prisma.attendance.count()).toBe(before);
    expect(employee.id).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm db:test:deploy && npx vitest run --config vitest.integration.config.ts tests/integration/absence-preview.integration.test.ts`
Expected: FAIL — cannot resolve `@/lib/attendance/absence-preview`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/attendance/absence-preview.ts
import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { expandHolidaysWithSubstitutes } from '@/lib/leave/working-days';
import { standardDayMinutes, windowMinutes } from '@/lib/leave/units';
import { payrollMonthWindowYmd } from '@/lib/payroll/period';
import { deriveAbsentMinutes } from './derive-absence';
import { isScheduledWorkday } from './schedule';

export type AbsencePreviewDay = { date: string; minutes: number };

export type AbsencePreviewRow = {
  employeeId: string;
  name: string;
  baseSalary: number;
  days: AbsencePreviewDay[];
  totalMinutes: number;
  totalDays: number;
  /** Illustrative only. Nothing consumes this; payroll is untouched. */
  estimatedBaht: number;
  hasSchedule: boolean;
};

export type AbsencePreview = {
  month: string;
  from: string;
  to: string;
  rows: AbsencePreviewRow[];
  standardDayMinutes: number;
  absentDeductionPerDay: number;
  skippedNoSchedule: number;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What absence derivation WOULD produce for one payroll month. Read-only: it
 * computes, it never writes, and nothing in payroll consumes it.
 *
 * Exists because deriving absence is the largest money change in the backlog —
 * it moves `deductAttendance` for potentially every employee. This page is how
 * that gets inspected before a single baht moves.
 */
export async function previewAbsences(month: string): Promise<AbsencePreview> {
  const [payCfg, leaveCfg] = await Promise.all([
    prisma.payrollConfig.findFirstOrThrow({
      select: { cutoffDay: true, absentDeductionPerDay: true },
    }),
    prisma.leaveConfig.findFirst(),
  ]);
  const std = standardDayMinutes(
    leaveCfg ?? {
      morningStart: '09:00',
      morningEnd: '12:00',
      afternoonStart: '13:00',
      afternoonEnd: '17:00',
    },
  );
  const { from, to } = payrollMonthWindowYmd(month, payCfg.cutoffDay);
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  const [employees, attendance, holidays] = await Promise.all([
    prisma.employee.findMany({
      where: { status: { in: ['Active', 'Probation'] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
        baseSalary: true,
        workScheduleId: true,
        workSchedule: { select: { days: { select: { dayOfWeek: true, startTime: true, endTime: true } } } },
      },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: start, lte: end }, deletedAt: null },
      select: { employeeId: true, date: true, type: true, durationMinutes: true },
    }),
    prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } }),
  ]);

  const holidaySet = new Set(
    expandHolidaysWithSubstitutes(holidays.map((h) => h.date)).map(ymd),
  );

  // Per employee, per date: what happened. `leaveMinutes` stays `undefined`
  // until an OnLeave row is seen, and becomes `null` if that row has no
  // duration — the distinction deriveAbsentMinutes depends on.
  type DayFacts = { checkIn: boolean; manualAbsent: boolean; leaveMinutes: number | null | undefined };
  const facts = new Map<string, Map<string, DayFacts>>();
  const factFor = (empId: string, date: string): DayFacts => {
    let byDate = facts.get(empId);
    if (!byDate) {
      byDate = new Map();
      facts.set(empId, byDate);
    }
    let f = byDate.get(date);
    if (!f) {
      f = { checkIn: false, manualAbsent: false, leaveMinutes: undefined };
      byDate.set(date, f);
    }
    return f;
  };

  for (const a of attendance) {
    const f = factFor(a.employeeId, ymd(a.date));
    if (a.type === 'CheckIn') f.checkIn = true;
    else if (a.type === 'Absent') f.manualAbsent = true;
    else if (a.type === 'OnLeave') {
      // A null duration poisons the sum to null on purpose: unknown coverage is
      // treated as FULL coverage downstream, never as none.
      f.leaveMinutes =
        a.durationMinutes === null || f.leaveMinutes === null
          ? null
          : (f.leaveMinutes ?? 0) + a.durationMinutes;
    }
  }

  const rows: AbsencePreviewRow[] = [];
  let skippedNoSchedule = 0;

  for (const emp of employees) {
    // Guard #2 from the design: with no schedule the system assumes Mon–Sat, so
    // deriving would charge a day's pay for every real day off. Refuse instead.
    if (!emp.workScheduleId || !emp.workSchedule) {
      skippedNoSchedule++;
      continue;
    }
    const minutesByDow = new Map<number, number>(
      emp.workSchedule.days.map((d) => [d.dayOfWeek, windowMinutes(d.startTime, d.endTime)]),
    );
    const dows = [...minutesByDow.keys()];

    const days: AbsencePreviewDay[] = [];
    for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
      const d = new Date(t);
      const date = ymd(d);
      const dow = d.getUTCDay();
      const f = facts.get(emp.id)?.get(date);
      const minutes = deriveAbsentMinutes({
        scheduledMinutes: minutesByDow.get(dow) ?? 0,
        leaveMinutes: f?.leaveMinutes === undefined ? 0 : f.leaveMinutes,
        hasCheckIn: f?.checkIn ?? false,
        hasManualAbsent: f?.manualAbsent ?? false,
        isWorkday: isScheduledWorkday(dows, dow, holidaySet.has(date)),
      });
      if (minutes > 0) days.push({ date, minutes });
    }

    if (days.length === 0) continue;
    const totalMinutes = days.reduce((s, x) => s + x.minutes, 0);
    const totalDays = totalMinutes / std;
    rows.push({
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}${emp.nickname ? ` (${emp.nickname})` : ''}`,
      baseSalary: Number(emp.baseSalary),
      days,
      totalMinutes,
      totalDays,
      estimatedBaht: totalDays * Number(payCfg.absentDeductionPerDay),
      hasSchedule: true,
    });
  }

  rows.sort((a, b) => b.totalMinutes - a.totalMinutes);

  return {
    month,
    from,
    to,
    rows,
    standardDayMinutes: std,
    absentDeductionPerDay: Number(payCfg.absentDeductionPerDay),
    skippedNoSchedule,
  };
}
```

- [ ] **Step 4: Run the integration tests and confirm they pass**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/absence-preview.integration.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Full gate, then commit**

```bash
npx biome check --write src/lib/attendance/absence-preview.ts tests/integration/absence-preview.integration.test.ts
npx tsc --noEmit -p tsconfig.json
npx vitest run
pnpm test:integration
git add src/lib/attendance/absence-preview.ts tests/integration/absence-preview.integration.test.ts
git commit -m "feat(attendance): read-only absence derivation preview"
```

---

### Task 3: The preview page

**Files:**
- Create: `src/app/(admin)/admin/tools/absence-preview/page.tsx`

**Interfaces:**
- Consumes: `previewAbsences`, `AbsencePreview` (Task 2); `requireGlobalPermission` from `@/lib/auth/require-global-permission`; `PageHeader` from `@/components/ui/page-header`; `EmptyState` from `@/components/ui/empty-state`; `formatTHB` from `@/lib/format`; `formatDaysHours` from `@/lib/leave/units`; `currentMonthYM` from `@/lib/leave/team-calendar-shape`.
- Produces: a route at `/admin/tools/absence-preview?m=YYYY-MM`. Nothing imports it.

- [ ] **Step 1: Write the page**

```tsx
// src/app/(admin)/admin/tools/absence-preview/page.tsx
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { previewAbsences } from '@/lib/attendance/absence-preview';
import { requireGlobalPermission } from '@/lib/auth/require-global-permission';
import { formatTHB } from '@/lib/format';
import { currentMonthYM } from '@/lib/leave/team-calendar-shape';

/**
 * What absence derivation WOULD charge, if it were switched on.
 *
 * Absence does not exist in this system yet: `Absent` rows come only from the
 * admin manual-entry form, so payroll deducts only what somebody keyed. Turning
 * that into a derivation is the largest money change in the backlog — it moves
 * `deductAttendance` for potentially every employee at once. This page exists so
 * that change can be READ before it is made. It computes; it never writes, and
 * no payroll figure anywhere consumes it.
 *
 * What to read from it:
 *   - A row with many derived days → either a genuine no-show run, or leave
 *     that was never recorded. Check the leave first.
 *   - Employees listed as skipped → they have no WorkSchedule. Derivation
 *     refuses to guess for them, because assuming Mon–Sat would charge a day's
 *     pay for every real day off.
 *   - A total near or above the employee's salary → derivation is wrong for
 *     them, not merely expensive. Do not enable until it is understood.
 *
 * Gated on payroll.read, matching /admin/tools/leave-backlog: it shows money
 * the payroll team already sees, grouped so the cause is legible.
 */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function AbsencePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  await requireGlobalPermission('payroll.read');
  const params = await searchParams;
  const month = params.m && MONTH_RE.test(params.m) ? params.m : currentMonthYM();
  const preview = await previewAbsences(month);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="เครื่องมือ"
        title="ตัวอย่างการคิดวันขาดงานอัตโนมัติ"
        subtitle={`งวด ${preview.from} – ${preview.to} — ดูอย่างเดียว ยังไม่มีการหักเงินจริง`}
      />

      <div className="mb-5 space-y-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p>
          <strong>หน้านี้ไม่หักเงินใคร</strong> — ปัจจุบันระบบจะนับว่าขาดงานก็ต่อเมื่อแอดมินคีย์เองเท่านั้น
          หน้านี้แสดงว่า<strong>ถ้า</strong>เปิดใช้การคิดอัตโนมัติแล้วจะได้ผลอย่างไร เพื่อให้ตรวจสอบก่อนตัดสินใจ
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          <li>วันที่มีการเช็คอิน หรือมีใบลาครอบคลุม จะไม่ถูกนับ</li>
          <li>วันที่แอดมินคีย์ขาดงานไว้เองแล้ว จะไม่ถูกนับซ้ำ</li>
          <li>
            ใบลาที่ไม่ได้บันทึกจำนวนนาทีไว้ ระบบจะถือว่า<strong>ลาเต็มวัน</strong> เพื่อไม่ให้หักเงินผิด
          </li>
          {preview.skippedNoSchedule > 0 && (
            <li>
              ข้ามพนักงาน {preview.skippedNoSchedule} คนที่ยังไม่ได้กำหนดตารางงาน — ระบบจะไม่เดาให้
            </li>
          )}
        </ul>
      </div>

      {preview.rows.length === 0 ? (
        <EmptyState title="ไม่มีวันขาดงานที่จะคิดในงวดนี้" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-sunken text-left text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2">พนักงาน</th>
                <th className="px-3 py-2 text-right">จำนวนวัน</th>
                <th className="px-3 py-2 text-right">ประมาณการหัก</th>
                <th className="px-3 py-2 text-right">เงินเดือน</th>
                <th className="px-3 py-2">วันที่</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.employeeId} className="border-t border-line-soft align-top">
                  <td className="px-3 py-2 text-ink-1">{r.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.totalDays.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatTHB(r.estimatedBaht)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-3">
                    {formatTHB(r.baseSalary)}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-2">
                    {r.days.map((d) => d.date).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles and the suites still pass**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: clean, all green. All four imports were verified to exist while this plan was written: `formatTHB` (`src/lib/format.ts:21`), `currentMonthYM` (`src/lib/leave/team-calendar-shape.ts:124`), `EmptyState` (`src/components/ui/empty-state.tsx:10`), `PageHeader` (`src/components/ui/page-header.tsx:10`).

- [ ] **Step 3: Load the page in the browser and confirm it renders**

Start the dev server via the Browser pane preview (never `pnpm dev` in Bash), sign in as an admin, and open `/admin/tools/absence-preview`. Confirm: the page renders, the skipped-employee count matches production expectations, and no row shows a total anywhere near an employee's salary. Screenshot it for the review.

- [ ] **Step 4: Commit**

```bash
npx biome check --write "src/app/(admin)/admin/tools/absence-preview/page.tsx"
git add "src/app/(admin)/admin/tools/absence-preview/page.tsx"
git commit -m "feat(admin): absence-derivation preview page"
```

---

## Not in this phase — deliberately

Phase 2, only after this preview has been read against real data and September payroll has published:

- Migration adding `PayrollConfig.absenceDerivedFrom` (nullable; `null` = OFF).
- Fractional absence in `calc.ts` (`absentDays = uncoveredMinutes / standardDayMinutes`).
- Fractional days through `actualDaysFromAttendance` in `reconcile-settlement.ts`, and the `publishPayroll` settled-vs-actual guard that the race tests in `penalty-settlement.integration.test.ts` cover.
- The "record presence without a late penalty" checkbox on the manual-entry form.

**The safety picture has changed since the design was written.** It assumed guard #2 — "skip employees with no WorkSchedule" — would keep the feature inert, noting *"with all 9 employees currently unset, the feature does nothing until schedules are assigned."* All 50 employees now have a schedule, so that guard is inert and no longer holds anything back. Guard #1, the `absenceDerivedFrom` cutoff, is now the only thing between the code and every employee's pay — and it does not exist yet. Phase 2 must not merge without it.
