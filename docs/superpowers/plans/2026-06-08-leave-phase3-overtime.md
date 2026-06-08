# Leave Phase 3 — Overtime (OT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins record and price overtime — auto-surface candidate days (clock-out past the scheduled end), approve/dismiss them with a per-entry rate (flat ฿/hour **or** ×multiplier, defaulted per employee), add OT manually, and review monthly totals — all captured in a new `OvertimeEntry` table.

**Architecture:** `OvertimeEntry` stores one OT record per (employee, date) with a frozen `computedAmount` (snapshotted at approval via a pure `rate.ts`). Candidates are computed **live** from `Attendance.clockOutAt` vs the employee's `WorkScheduleDay.endTime` (no background job). A dedicated `/admin/attendance/overtime` page handles review + manual add + void. Per-employee default rates live on the employee form. **Scope decision: record-only** — no payroll-run wiring (none exists yet); OT amounts are reportable from `OvertimeEntry`.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), Prisma 6 + PostgreSQL, Zod 4, decimal.js (money), Vitest, custom Tailwind UI. Commands need `/opt/homebrew/bin` on PATH (Node 24+/pnpm) — **including `git commit`** (the pre-commit hook runs Node). Hand-authored numbered migrations via `pnpm db:deploy`. `.env.local` already in this worktree.

**Spec:** `docs/superpowers/specs/2026-06-08-leave-granularity-entitlements-ot-design.md` (§ Phase 3). Builds on Phase 1's `units.ts` (`standardDayMinutes`, `minutesOf`) + `LeaveConfig`.

---

## File structure (Phase 3)

| File | Responsibility | New/Modify |
|------|----------------|-----------|
| `prisma/schema.prisma` | `OtRateType`/`OtStatus` enums, `OvertimeEntry` model, `Employee.defaultOt*` + back-relation, `Attendance` back-relation, `PayrollConfig.workingDaysPerMonth`/`otThresholdMinutes` | Modify |
| `prisma/migrations/0018_overtime/migration.sql` | DDL + partial-unique (raw SQL) | Create |
| `src/lib/db/soft-delete-extension.ts` | register `OvertimeEntry` | Modify |
| `src/lib/overtime/rate.ts` | pure `hourlyWage` + `computeOtAmount` + `overtimeMinutes` | Create |
| `src/lib/overtime/rate.test.ts` | unit tests for the pure helpers | Create |
| `src/lib/overtime/candidates.ts` | live `getOtCandidates` (clock-out vs schedule) | Create |
| `src/lib/overtime/actions.ts` | `approveOt` / `dismissOt` / `addManualOt` / `voidOt` | Create |
| `src/lib/auth/permissions.ts` | `attendance.overtime.manage` | Modify |
| `src/lib/auth/roles.ts` | grant to Admin | Modify |
| `src/lib/audit/log.ts` | `overtime.*` actions + `OvertimeEntry` entity | Modify |
| `src/app/(admin)/admin/attendance/attendance-tabs.tsx` | add the OT tab | Modify |
| `src/app/(admin)/admin/attendance/overtime/page.tsx` | OT review page (candidates + history + manual add) | Create |
| `src/app/(admin)/admin/attendance/overtime/overtime-forms.tsx` | small client bits for the rate-mode inputs | Create |
| `src/app/(admin)/admin/employees/employee-schema.ts` | parse `defaultOt*` | Modify |
| `src/app/(admin)/admin/employees/employee-form.tsx` | OT defaults section | Modify |
| `src/app/(admin)/admin/employees/[id]/edit/page.tsx` | select + pass `defaultOt*` | Modify |

**Build order:** schema/migration + soft-delete → pure rate helpers → candidates → permission/audit → actions → OT page + tab → employee defaults → final gate. Each task ends with a commit; after each, confirm `git log --oneline -1` is your commit.

---

## Task 1: Schema + migration `0018_overtime` + soft-delete registration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0018_overtime/migration.sql`
- Modify: `src/lib/db/soft-delete-extension.ts`

- [ ] **Step 1: Add enums** (near the other enums, after `LeaveStatus`):

```prisma
enum OtRateType {
  PerHourAmount
  Multiplier
}

enum OtStatus {
  Approved
  Rejected
}
```

- [ ] **Step 2: Add the `OvertimeEntry` model** (place near the Attendance / payroll models):

```prisma
/// One overtime record per (employee, date). computedAmount is frozen at
/// approval (snapshot of rate × hours / wage × multiplier). status=Rejected
/// is a "dismissed — not OT" marker that stops the date re-surfacing as a
/// candidate. Candidates themselves are computed live (not stored). See spec §Phase 3.
model OvertimeEntry {
  id                 String      @id @default(uuid()) @db.Uuid
  employeeId         String      @db.Uuid
  employee           Employee    @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  date               DateTime    @db.Date
  minutes            Int
  rateType           OtRateType
  ratePerHour        Decimal?    @db.Decimal(12, 2) // when PerHourAmount
  multiplier         Decimal?    @db.Decimal(3, 2)  // when Multiplier
  computedAmount     Decimal     @db.Decimal(12, 2) // frozen pay at approval
  status             OtStatus
  sourceAttendanceId String?     @db.Uuid
  sourceAttendance   Attendance? @relation(fields: [sourceAttendanceId], references: [id], onDelete: SetNull)
  note               String?
  reviewedById       String?     @db.Uuid
  reviewedAt         DateTime?
  deletedAt          DateTime?
  deletedById        String?     @db.Uuid
  deleteReason       String?
  createdAt          DateTime    @default(now())
  createdById        String      @db.Uuid

  @@index([employeeId, date])
  @@index([status])
  @@index([deletedAt])
  // PARTIAL unique (employeeId, date) WHERE deletedAt IS NULL — raw SQL in the
  // migration (Prisma DSL can't express partial-unique; see Attendance 0014).
}
```

- [ ] **Step 3: Add `Employee` fields + back-relations.** In `model Employee`, add the OT default fields (near `baseSalary`) and the back-relation (near `leaveEntitlements`):

```prisma
  defaultOtRateType    OtRateType?
  defaultOtRatePerHour Decimal?    @db.Decimal(12, 2)
  defaultOtMultiplier  Decimal?    @db.Decimal(3, 2)
```
and in the relations block:
```prisma
  overtimeEntries     OvertimeEntry[]
```

- [ ] **Step 4: Add the `Attendance` back-relation.** In `model Attendance`, add (next to `leaveRequest`):

```prisma
  overtimeEntries  OvertimeEntry[]
```

- [ ] **Step 5: Extend `PayrollConfig`** (after `otMultiplier`):

```prisma
  /// Days/month used to derive an hourly wage from a monthly salary for OT
  /// multiplier-mode pricing (Thai convention ÷30).
  workingDaysPerMonth Int @default(30)
  /// Clock-out must beat the scheduled end by at least this many minutes to
  /// surface as an OT candidate.
  otThresholdMinutes  Int @default(30)
```

- [ ] **Step 6: Write the migration** at `prisma/migrations/0018_overtime/migration.sql`:

```sql
-- ─── 0018 — Overtime ──────────────────────────────────────────────────────
-- OvertimeEntry (one per employee/date, partial-unique excludes voided rows),
-- per-employee default OT rates, and OT-config knobs on PayrollConfig. See
-- spec §Phase 3. Record-only: no payroll-run wiring.

CREATE TYPE "OtRateType" AS ENUM ('PerHourAmount', 'Multiplier');
CREATE TYPE "OtStatus" AS ENUM ('Approved', 'Rejected');

ALTER TABLE "Employee" ADD COLUMN "defaultOtRateType" "OtRateType";
ALTER TABLE "Employee" ADD COLUMN "defaultOtRatePerHour" DECIMAL(12,2);
ALTER TABLE "Employee" ADD COLUMN "defaultOtMultiplier" DECIMAL(3,2);

ALTER TABLE "PayrollConfig" ADD COLUMN "workingDaysPerMonth" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "PayrollConfig" ADD COLUMN "otThresholdMinutes" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "OvertimeEntry" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "rateType" "OtRateType" NOT NULL,
    "ratePerHour" DECIMAL(12,2),
    "multiplier" DECIMAL(3,2),
    "computedAmount" DECIMAL(12,2) NOT NULL,
    "status" "OtStatus" NOT NULL,
    "sourceAttendanceId" UUID,
    "note" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,
    "deleteReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,
    CONSTRAINT "OvertimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OvertimeEntry_employeeId_date_idx" ON "OvertimeEntry" ("employeeId", "date");
CREATE INDEX "OvertimeEntry_status_idx" ON "OvertimeEntry" ("status");
CREATE INDEX "OvertimeEntry_deletedAt_idx" ON "OvertimeEntry" ("deletedAt");

-- One live OT entry per (employee, date); a voided row frees the slot.
CREATE UNIQUE INDEX "OvertimeEntry_employeeId_date_live_key"
  ON "OvertimeEntry" ("employeeId", "date")
  WHERE "deletedAt" IS NULL;

ALTER TABLE "OvertimeEntry"
  ADD CONSTRAINT "OvertimeEntry_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OvertimeEntry"
  ADD CONSTRAINT "OvertimeEntry_sourceAttendanceId_fkey"
  FOREIGN KEY ("sourceAttendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 7: Register `OvertimeEntry` for soft-delete** — in `src/lib/db/soft-delete-extension.ts`, add `'OvertimeEntry'` to the `SOFT_DELETE_MODELS` set:

```ts
const SOFT_DELETE_MODELS = new Set(['Attendance', 'LeaveRequest', 'CashAdvance', 'OvertimeEntry']);
```
(Read the file first — match the exact existing declaration; the set may be named differently.)

- [ ] **Step 8: Apply + regenerate + typecheck**

```bash
PATH="/opt/homebrew/bin:$PATH" pnpm db:deploy && PATH="/opt/homebrew/bin:$PATH" pnpm db:generate
PATH="/opt/homebrew/bin:$PATH" pnpm dotenv -e .env.local -- prisma migrate status
PATH="/opt/homebrew/bin:$PATH" pnpm typecheck
```
Expected: "Applying migration `0018_overtime`"; "Database schema is up to date!"; typecheck PASS.

- [ ] **Step 9: Commit**

```bash
PATH="/opt/homebrew/bin:$PATH" git add prisma/schema.prisma prisma/migrations/0018_overtime src/lib/db/soft-delete-extension.ts
PATH="/opt/homebrew/bin:$PATH" git commit -m "feat(ot): OvertimeEntry schema + employee defaults + OT config (0018)"
```

---

## Task 2: `rate.ts` — pure pricing helpers

**Files:**
- Create: `src/lib/overtime/rate.ts`
- Test: `src/lib/overtime/rate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/overtime/rate.test.ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { computeOtAmount, hourlyWage, overtimeMinutes } from './rate';

describe('hourlyWage', () => {
  it('Hourly → baseSalary as-is', () => {
    expect(
      hourlyWage({ salaryType: 'Hourly', baseSalary: 60, standardDayHours: 7, workingDaysPerMonth: 30 }).toNumber(),
    ).toBe(60);
  });
  it('Daily → base / standardDayHours', () => {
    expect(
      hourlyWage({ salaryType: 'Daily', baseSalary: 700, standardDayHours: 7, workingDaysPerMonth: 30 }).toNumber(),
    ).toBe(100);
  });
  it('Monthly → base / (workingDaysPerMonth × standardDayHours)', () => {
    expect(
      hourlyWage({ salaryType: 'Monthly', baseSalary: 21000, standardDayHours: 7, workingDaysPerMonth: 30 }).toNumber(),
    ).toBe(100); // 21000 / 30 / 7
  });
});

describe('computeOtAmount', () => {
  const wage = new Decimal(100);
  it('PerHourAmount → hours × ratePerHour', () => {
    expect(
      computeOtAmount({ minutes: 90, rateType: 'PerHourAmount', ratePerHour: 120, wage }).toNumber(),
    ).toBe(180); // 1.5h × 120
  });
  it('Multiplier → hours × wage × multiplier', () => {
    expect(
      computeOtAmount({ minutes: 120, rateType: 'Multiplier', multiplier: 1.5, wage }).toNumber(),
    ).toBe(300); // 2h × 100 × 1.5
  });
  it('missing rate value → 0', () => {
    expect(computeOtAmount({ minutes: 60, rateType: 'PerHourAmount', wage }).toNumber()).toBe(0);
  });
});

describe('overtimeMinutes', () => {
  it('positive difference past scheduled end', () => {
    expect(overtimeMinutes('17:00', '18:30')).toBe(90);
  });
  it('clamps to 0 when not past end', () => {
    expect(overtimeMinutes('17:00', '16:45')).toBe(0);
    expect(overtimeMinutes('17:00', '17:00')).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect red**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test overtime/rate -- --run`
Expected: FAIL — `Cannot find module './rate'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/overtime/rate.ts
import Decimal from 'decimal.js';
import { minutesOf } from '@/lib/leave/units';

export type OtRateType = 'PerHourAmount' | 'Multiplier';
export type SalaryType = 'Monthly' | 'Daily' | 'Hourly';

/** Derive an hourly wage from an employee's salary. Monthly uses the Thai
 *  convention: ÷ workingDaysPerMonth ÷ standardDayHours. */
export function hourlyWage(args: {
  salaryType: SalaryType;
  baseSalary: Decimal | string | number;
  standardDayHours: number;
  workingDaysPerMonth: number;
}): Decimal {
  const base = new Decimal(args.baseSalary);
  switch (args.salaryType) {
    case 'Hourly':
      return base;
    case 'Daily':
      return base.div(args.standardDayHours);
    case 'Monthly':
      return base.div(args.workingDaysPerMonth).div(args.standardDayHours);
  }
}

/** OT pay for one entry. PerHourAmount = hours × ratePerHour; Multiplier =
 *  hours × wage × multiplier. Missing rate value → 0. Rounded to 2 dp. */
export function computeOtAmount(args: {
  minutes: number;
  rateType: OtRateType;
  ratePerHour?: Decimal | string | number | null;
  multiplier?: Decimal | string | number | null;
  wage: Decimal;
}): Decimal {
  const hours = new Decimal(args.minutes).div(60);
  if (args.rateType === 'PerHourAmount') {
    return hours.times(new Decimal(args.ratePerHour ?? 0)).toDecimalPlaces(2);
  }
  return hours.times(args.wage).times(new Decimal(args.multiplier ?? 0)).toDecimalPlaces(2);
}

/** Minutes a clock-out ran past the scheduled end ("HH:MM" both), clamped ≥0. */
export function overtimeMinutes(scheduledEnd: string, clockOut: string): number {
  const diff = minutesOf(clockOut) - minutesOf(scheduledEnd);
  return diff > 0 ? diff : 0;
}
```

- [ ] **Step 4: Run — expect green**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test overtime/rate -- --run`
Expected: PASS (8 cases).

- [ ] **Step 5: Commit**

```bash
PATH="/opt/homebrew/bin:$PATH" git add src/lib/overtime/rate.ts src/lib/overtime/rate.test.ts
PATH="/opt/homebrew/bin:$PATH" git commit -m "feat(ot): pure rate helpers (hourlyWage, computeOtAmount, overtimeMinutes)"
```

---

## Task 3: `candidates.ts` — live OT candidate detection

**Files:**
- Create: `src/lib/overtime/candidates.ts`

- [ ] **Step 1: Implement** (DB read; uses the pure `overtimeMinutes` + Bangkok wall-clock conversion):

```ts
// src/lib/overtime/candidates.ts
import { prisma } from '@/lib/db/prisma';
import { overtimeMinutes } from './rate';

export type OtCandidate = {
  attendanceId: string;
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  scheduledEnd: string; // HH:MM
  clockOut: string; // HH:MM
  minutesOver: number;
  /** Suggested rate from the employee's defaults (fallback: config multiplier). */
  defaultOtRateType: 'PerHourAmount' | 'Multiplier' | null;
  defaultOtRatePerHour: string | null;
  defaultOtMultiplier: string | null;
};

/** "HH:MM" of a Date in Asia/Bangkok. */
function hhmm(d: Date): string {
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Day-of-week (0=Sun..6=Sat) of a @db.Date value in Asia/Bangkok. A @db.Date
 *  is stored at UTC midnight, which is the same calendar day in Bangkok. */
function bangkokDow(date: Date): number {
  return date.getUTCDay();
}

/**
 * Live OT candidates for a month: CheckIn rows whose clock-out beat the
 * employee's scheduled end (for that weekday) by ≥ otThresholdMinutes, minus
 * any date that already has an OvertimeEntry (Approved or Rejected).
 */
export async function getOtCandidates(args: {
  ym: string; // "YYYY-MM"
  employeeId?: string;
}): Promise<OtCandidate[]> {
  const [yStr, mStr] = args.ym.split('-');
  const y = Number(yStr);
  const m = Number(mStr); // 1-12
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));

  const cfg = await prisma.payrollConfig.findFirst({ select: { otThresholdMinutes: true } });
  const threshold = cfg?.otThresholdMinutes ?? 30;

  const rows = await prisma.attendance.findMany({
    where: {
      type: 'CheckIn',
      deletedAt: null,
      clockOutAt: { not: null },
      date: { gte: start, lt: end },
      ...(args.employeeId ? { employeeId: args.employeeId } : {}),
    },
    select: {
      id: true,
      employeeId: true,
      date: true,
      clockOutAt: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
          nickname: true,
          defaultOtRateType: true,
          defaultOtRatePerHour: true,
          defaultOtMultiplier: true,
          workSchedule: { select: { days: { select: { dayOfWeek: true, endTime: true } } } },
        },
      },
    },
  });

  // Existing decisions (Approved or Rejected, non-deleted) to exclude.
  const decided = await prisma.overtimeEntry.findMany({
    where: { date: { gte: start, lt: end }, deletedAt: null, ...(args.employeeId ? { employeeId: args.employeeId } : {}) },
    select: { employeeId: true, date: true },
  });
  const decidedKey = new Set(decided.map((d) => `${d.employeeId}:${d.date.toISOString().slice(0, 10)}`));

  const out: OtCandidate[] = [];
  for (const r of rows) {
    if (!r.clockOutAt) continue;
    const sched = r.employee.workSchedule?.days.find((d) => d.dayOfWeek === bangkokDow(r.date));
    if (!sched) continue; // no scheduled end → can't detect OT
    const clockOut = hhmm(r.clockOutAt);
    const over = overtimeMinutes(sched.endTime, clockOut);
    if (over < threshold) continue;
    const dateStr = r.date.toISOString().slice(0, 10);
    if (decidedKey.has(`${r.employeeId}:${dateStr}`)) continue;
    const e = r.employee;
    out.push({
      attendanceId: r.id,
      employeeId: r.employeeId,
      employeeName: e.nickname?.trim() || `${e.firstName} ${e.lastName}`.trim(),
      date: dateStr,
      scheduledEnd: sched.endTime,
      clockOut,
      minutesOver: over,
      defaultOtRateType: e.defaultOtRateType,
      defaultOtRatePerHour: e.defaultOtRatePerHour ? String(e.defaultOtRatePerHour) : null,
      defaultOtMultiplier: e.defaultOtMultiplier ? String(e.defaultOtMultiplier) : null,
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.employeeName.localeCompare(b.employeeName)));
  return out;
}
```

- [ ] **Step 2: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS (confirms `prisma.overtimeEntry` + the employee `defaultOt*` selects exist).

- [ ] **Step 3: Commit**

```bash
PATH="/opt/homebrew/bin:$PATH" git add src/lib/overtime/candidates.ts
PATH="/opt/homebrew/bin:$PATH" git commit -m "feat(ot): live OT candidate detection"
```

---

## Task 4: Permission + audit types

**Files:**
- Modify: `src/lib/auth/permissions.ts`, `src/lib/auth/roles.ts`, `src/lib/audit/log.ts`

- [ ] **Step 1: Permission** — in `permissions.ts`, add after `'attendance.void'`:

```ts
  'attendance.overtime.manage': 'จัดการการทำงานล่วงเวลา (OT)',
```
and add `'attendance.overtime.manage'` to the `PERMISSION_GROUPS` `attendance` group's `permissions` array (after `'attendance.void'`).

- [ ] **Step 2: Grant to Admin** — in `roles.ts`, add `'attendance.overtime.manage',` after `'attendance.void',` in `SYSTEM_ROLES.admin.permissions`.

- [ ] **Step 3: Audit types** — in `src/lib/audit/log.ts`, add to `AuditAction`: `'overtime.approve'`, `'overtime.dismiss'`, `'overtime.void'`; add to `AuditEntityType`: `'OvertimeEntry'` (match the existing union formatting).

- [ ] **Step 4: Verify**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm test perm-coverage -- --run && PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
PATH="/opt/homebrew/bin:$PATH" git add src/lib/auth/permissions.ts src/lib/auth/roles.ts src/lib/audit/log.ts
PATH="/opt/homebrew/bin:$PATH" git commit -m "feat(auth): attendance.overtime.manage permission + audit types"
```

---

## Task 5: `actions.ts` — approve / dismiss / manual add / void

**Files:**
- Create: `src/lib/overtime/actions.ts`

- [ ] **Step 1: Implement** (server actions; compute `computedAmount` via `rate.ts`):

```ts
// src/lib/overtime/actions.ts
'use server';

import Decimal from 'decimal.js';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { standardDayMinutes } from '@/lib/leave/units';
import { computeOtAmount, hourlyWage, type OtRateType } from './rate';

export type OtActionResult = { ok: true } | { ok: false; message: string };

const RATE_TYPES = ['PerHourAmount', 'Multiplier'] as const;

const ApproveSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minutes: z.coerce.number().int().min(1).max(24 * 60),
  rateType: z.enum(RATE_TYPES),
  ratePerHour: z.coerce.number().min(0).max(100000).optional(),
  multiplier: z.coerce.number().min(0).max(9.99).optional(),
  note: z.string().trim().max(200).optional(),
  sourceAttendanceId: z.string().uuid().optional(),
});

async function priceOt(input: {
  employeeId: string;
  minutes: number;
  rateType: OtRateType;
  ratePerHour?: number;
  multiplier?: number;
}): Promise<Decimal> {
  if (input.rateType === 'PerHourAmount') {
    return computeOtAmount({
      minutes: input.minutes,
      rateType: 'PerHourAmount',
      ratePerHour: input.ratePerHour ?? 0,
      wage: new Decimal(0),
    });
  }
  // Multiplier needs the employee wage.
  const [emp, cfg, leaveCfg] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: input.employeeId },
      select: { salaryType: true, baseSalary: true },
    }),
    prisma.payrollConfig.findFirst({ select: { workingDaysPerMonth: true } }),
    getLeaveConfig(),
  ]);
  const stdHours = standardDayMinutes(leaveCfg) / 60;
  const wage = emp
    ? hourlyWage({
        salaryType: emp.salaryType,
        baseSalary: emp.baseSalary,
        standardDayHours: stdHours,
        workingDaysPerMonth: cfg?.workingDaysPerMonth ?? 30,
      })
    : new Decimal(0);
  return computeOtAmount({
    minutes: input.minutes,
    rateType: 'Multiplier',
    multiplier: input.multiplier ?? 0,
    wage,
  });
}

function dateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Approve a candidate (or any day) as OT. Creates an Approved OvertimeEntry. */
export async function approveOt(formData: FormData): Promise<OtActionResult> {
  const { user } = await requirePermission('attendance.overtime.manage');
  const parsed = ApproveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };
  const d = parsed.data;

  const amount = await priceOt(d);
  try {
    const row = await prisma.overtimeEntry.create({
      data: {
        employeeId: d.employeeId,
        date: dateOnly(d.date),
        minutes: d.minutes,
        rateType: d.rateType,
        ratePerHour: d.rateType === 'PerHourAmount' ? new Decimal(d.ratePerHour ?? 0) : null,
        multiplier: d.rateType === 'Multiplier' ? new Decimal(d.multiplier ?? 0) : null,
        computedAmount: amount,
        status: 'Approved',
        sourceAttendanceId: d.sourceAttendanceId ?? null,
        note: d.note || null,
        reviewedById: user.id,
        reviewedAt: new Date(),
        createdById: user.id,
      },
    });
    auditLog({
      actorId: user.id,
      action: 'overtime.approve',
      entityType: 'OvertimeEntry',
      entityId: row.id,
      after: { employeeId: d.employeeId, date: d.date, minutes: d.minutes, amount: amount.toString() },
      metadata: { source: 'admin-ui' },
    });
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return { ok: false, message: 'วันนี้มีรายการ OT อยู่แล้ว' };
    }
    throw err;
  }
  revalidatePath('/admin/attendance/overtime');
  return { ok: true };
}

/** Dismiss a candidate ("not OT") — a Rejected marker that stops re-surfacing. */
export async function dismissOt(formData: FormData): Promise<OtActionResult> {
  const { user } = await requirePermission('attendance.overtime.manage');
  const employeeId = String(formData.get('employeeId'));
  const date = String(formData.get('date'));
  const sourceAttendanceId = formData.get('sourceAttendanceId');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: 'วันที่ไม่ถูกต้อง' };
  try {
    const row = await prisma.overtimeEntry.create({
      data: {
        employeeId,
        date: dateOnly(date),
        minutes: 0,
        rateType: 'PerHourAmount',
        ratePerHour: new Decimal(0),
        computedAmount: new Decimal(0),
        status: 'Rejected',
        sourceAttendanceId: sourceAttendanceId ? String(sourceAttendanceId) : null,
        reviewedById: user.id,
        reviewedAt: new Date(),
        createdById: user.id,
      },
    });
    auditLog({
      actorId: user.id,
      action: 'overtime.dismiss',
      entityType: 'OvertimeEntry',
      entityId: row.id,
      after: { employeeId, date },
      metadata: { source: 'admin-ui' },
    });
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') {
      return { ok: false, message: 'วันนี้ตัดสินใจไปแล้ว' };
    }
    throw err;
  }
  revalidatePath('/admin/attendance/overtime');
  return { ok: true };
}

/** Manual OT (no source attendance) — same as approve but always manual. */
export async function addManualOt(formData: FormData): Promise<OtActionResult> {
  return approveOt(formData);
}

/** Void (soft-delete) an OT entry, freeing its (employee, date) slot. */
export async function voidOt(formData: FormData): Promise<OtActionResult> {
  const { user } = await requirePermission('attendance.overtime.manage');
  const id = String(formData.get('id'));
  const reason = String(formData.get('reason') ?? '').trim() || null;
  const row = await prisma.overtimeEntry.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: user.id, deleteReason: reason },
  });
  auditLog({
    actorId: user.id,
    action: 'overtime.void',
    entityType: 'OvertimeEntry',
    entityId: row.id,
    metadata: { source: 'admin-ui', reason },
  });
  revalidatePath('/admin/attendance/overtime');
  return { ok: true };
}
```

NOTE: `Object.fromEntries(formData)` gives string values; Zod `coerce` handles numbers. Confirm `requirePermission` returns `{ user }` and `auditLog` is fire-and-forget `void` (match Phase 1/2 usage). The soft-delete extension means `prisma.overtimeEntry.update` for void writes through the extension — confirm the extension intercepts `update` with `deletedAt` correctly (it's used the same way for attendance void; check `src/lib/attendance/void.ts` if unsure).

- [ ] **Step 2: Typecheck**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
PATH="/opt/homebrew/bin:$PATH" git add src/lib/overtime/actions.ts
PATH="/opt/homebrew/bin:$PATH" git commit -m "feat(ot): approve/dismiss/manual-add/void server actions"
```

---

## Task 6: OT review page + attendance tab

**Files:**
- Modify: `src/app/(admin)/admin/attendance/attendance-tabs.tsx`
- Create: `src/app/(admin)/admin/attendance/overtime/page.tsx`
- Create: `src/app/(admin)/admin/attendance/overtime/overtime-forms.tsx`

- [ ] **Step 1: Add the OT tab** — in `attendance-tabs.tsx`, add to the `TABS` array (after `manual`):

```ts
  { key: 'overtime', href: '/admin/attendance/overtime', label: 'OT' },
```
(Read the file to match the exact `TABS` shape + the `current` prop union if it's typed.)

- [ ] **Step 2: Client rate-mode form bits** — create `overtime/overtime-forms.tsx`:

```tsx
'use client';

import { useState } from 'react';

/** Rate-mode inputs shared by approve + manual-add forms. Toggles between a
 *  ฿/hour field and a ×multiplier field. */
export function RateModeFields({
  defaultRateType = 'PerHourAmount',
  defaultRatePerHour = '',
  defaultMultiplier = '',
}: {
  defaultRateType?: 'PerHourAmount' | 'Multiplier';
  defaultRatePerHour?: string;
  defaultMultiplier?: string;
}) {
  const [mode, setMode] = useState<'PerHourAmount' | 'Multiplier'>(defaultRateType);
  return (
    <span className="inline-flex items-center gap-2">
      <select
        name="rateType"
        value={mode}
        onChange={(e) => setMode(e.target.value as 'PerHourAmount' | 'Multiplier')}
        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
      >
        <option value="PerHourAmount">฿/ชม.</option>
        <option value="Multiplier">×เท่า</option>
      </select>
      {mode === 'PerHourAmount' ? (
        <input
          name="ratePerHour"
          type="number"
          step="1"
          min="0"
          defaultValue={defaultRatePerHour}
          placeholder="฿/ชม."
          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
      ) : (
        <input
          name="multiplier"
          type="number"
          step="0.25"
          min="0"
          max="9.99"
          defaultValue={defaultMultiplier}
          placeholder="× เช่น 1.5"
          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
      )}
    </span>
  );
}
```

- [ ] **Step 3: The OT page** — create `overtime/page.tsx` (Server Component). Reads `?ym=` (default current Bangkok month), shows candidates (each an approve form + dismiss), a manual-add form, and the month's history with void + a total:

```tsx
import { requirePermission } from '@/lib/auth/check-permission';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { prisma } from '@/lib/db/prisma';
import { getOtCandidates } from '@/lib/overtime/candidates';
import { approveOt, dismissOt, voidOt } from '@/lib/overtime/actions';
import { AttendanceTabs } from '../attendance-tabs';
import { RateModeFields } from './overtime-forms';

export default async function OvertimePage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  await requirePermission('attendance.overtime.manage');
  const sp = await searchParams;
  const nowYm = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const ym = sp.ym && /^\d{4}-\d{2}$/.test(sp.ym) ? sp.ym : nowYm;

  const [yStr, mStr] = ym.split('-');
  const start = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, 1));
  const end = new Date(Date.UTC(Number(yStr), Number(mStr), 1));

  const [candidates, history, employees] = await Promise.all([
    getOtCandidates({ ym }),
    prisma.overtimeEntry.findMany({
      where: { date: { gte: start, lt: end } },
      orderBy: [{ date: 'asc' }],
      select: {
        id: true,
        date: true,
        minutes: true,
        rateType: true,
        ratePerHour: true,
        multiplier: true,
        computedAmount: true,
        status: true,
        note: true,
        employee: { select: { firstName: true, lastName: true, nickname: true } },
      },
    }),
    prisma.employee.findMany({
      where: { archivedAt: null, status: { not: 'Archived' } },
      orderBy: { firstName: 'asc' },
      select: { id: true, firstName: true, lastName: true, nickname: true },
    }),
  ]);

  const approvedTotal = history
    .filter((h) => h.status === 'Approved')
    .reduce((s, h) => s + Number(h.computedAmount), 0);
  const empName = (e: { firstName: string; lastName: string; nickname: string | null }) =>
    e.nickname?.trim() || `${e.firstName} ${e.lastName}`.trim();
  const hours = (min: number) => (min / 60).toFixed(2);

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <AttendanceTabs current="overtime" />

      {/* Month nav */}
      <div className="flex items-center gap-3 text-sm">
        <a href={`/admin/attendance/overtime?ym=${prevYm(ym)}`} className="text-primary-600 hover:underline">← เดือนก่อน</a>
        <span className="font-medium tabular-nums">{ym}</span>
        <a href={`/admin/attendance/overtime?ym=${nextYm(ym)}`} className="text-primary-600 hover:underline">เดือนถัดไป →</a>
      </div>

      {/* Candidates */}
      <Card>
        <CardHeader><CardTitle>ผู้เข้าข่าย OT (จากเวลาออกงาน)</CardTitle></CardHeader>
        <CardBody>
          {candidates.length === 0 ? (
            <p className="text-sm text-ink-3">ไม่มีรายการเข้าข่ายในเดือนนี้</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-ink-4">
                    <th className="py-2 pr-3">พนักงาน</th><th className="px-2">วันที่</th>
                    <th className="px-2">ออกงาน</th><th className="px-2">เกินเวลา</th>
                    <th className="px-2">ชม. OT</th><th className="px-2">เรท</th><th className="px-2"> </th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.attendanceId} className="border-b align-middle">
                      <td className="py-2 pr-3 font-medium">{c.employeeName}</td>
                      <td className="px-2 tabular-nums">{c.date}</td>
                      <td className="px-2 tabular-nums">{c.clockOut} (เลิก {c.scheduledEnd})</td>
                      <td className="px-2 tabular-nums">{c.minutesOver} น.</td>
                      <td className="px-2">
                        <form id={`ot-${c.attendanceId}`} action={approveOt}>
                          <input type="hidden" name="employeeId" value={c.employeeId} />
                          <input type="hidden" name="date" value={c.date} />
                          <input type="hidden" name="sourceAttendanceId" value={c.attendanceId} />
                          <input name="minutes" type="number" min="1" defaultValue={c.minutesOver} className="w-20 rounded-md border border-gray-300 px-2 py-1" />
                        </form>
                      </td>
                      <td className="px-2">
                        <span aria-hidden>{/* RateModeFields are associated by form= */}</span>
                        <RateModeFieldsHidden formId={`ot-${c.attendanceId}`} c={c} />
                      </td>
                      <td className="px-2 whitespace-nowrap">
                        <Button form={`ot-${c.attendanceId}`} type="submit" variant="secondary" size="sm">อนุมัติ</Button>
                        <form action={dismissOt} className="mt-1">
                          <input type="hidden" name="employeeId" value={c.employeeId} />
                          <input type="hidden" name="date" value={c.date} />
                          <input type="hidden" name="sourceAttendanceId" value={c.attendanceId} />
                          <Button type="submit" variant="ghost" size="sm">ไม่ใช่ OT</Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Manual add */}
      <Card>
        <CardHeader><CardTitle>+ เพิ่ม OT เอง</CardTitle></CardHeader>
        <CardBody>
          <form action={approveOt} className="flex flex-wrap items-end gap-3 text-sm">
            <select name="employeeId" required className="rounded-md border border-gray-300 px-2 py-1">
              <option value="">— เลือกพนักงาน —</option>
              {employees.map((e) => (<option key={e.id} value={e.id}>{empName(e)}</option>))}
            </select>
            <input name="date" type="date" required className="rounded-md border border-gray-300 px-2 py-1" />
            <input name="minutes" type="number" min="1" placeholder="นาที" required className="w-24 rounded-md border border-gray-300 px-2 py-1" />
            <RateModeFields />
            <input name="note" type="text" maxLength={200} placeholder="หมายเหตุ" className="w-40 rounded-md border border-gray-300 px-2 py-1" />
            <Button type="submit" variant="primary" size="sm">บันทึก OT</Button>
          </form>
        </CardBody>
      </Card>

      {/* History */}
      <Card>
        <CardHeader><CardTitle>ประวัติ OT เดือนนี้ — รวม ฿{approvedTotal.toLocaleString()}</CardTitle></CardHeader>
        <CardBody>
          {history.length === 0 ? (
            <p className="text-sm text-ink-3">ยังไม่มีรายการ</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-ink-4">
                    <th className="py-2 pr-3">พนักงาน</th><th className="px-2">วันที่</th><th className="px-2">ชม.</th>
                    <th className="px-2">เรท</th><th className="px-2">จำนวนเงิน</th><th className="px-2">สถานะ</th><th className="px-2"> </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b align-middle">
                      <td className="py-2 pr-3 font-medium">{empName(h.employee)}</td>
                      <td className="px-2 tabular-nums">{h.date.toISOString().slice(0, 10)}</td>
                      <td className="px-2 tabular-nums">{hours(h.minutes)}</td>
                      <td className="px-2">{h.rateType === 'PerHourAmount' ? `฿${h.ratePerHour}/ชม.` : `×${h.multiplier}`}</td>
                      <td className="px-2 tabular-nums">฿{Number(h.computedAmount).toLocaleString()}</td>
                      <td className="px-2">{h.status === 'Approved' ? 'อนุมัติ' : 'ไม่ใช่ OT'}</td>
                      <td className="px-2">
                        <form action={voidOt}>
                          <input type="hidden" name="id" value={h.id} />
                          <Button type="submit" variant="ghost" size="sm">ลบ</Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}
function nextYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}
```

**Implementation note on `RateModeFieldsHidden`:** the candidate row needs the rate-mode `<select>`/inputs associated with the row's approve `<form id="ot-...">` via the HTML `form=` attribute, but `RateModeFields` (above) renders plain inputs without a `form=` attr. Add a variant in `overtime-forms.tsx` that accepts `formId` and threads it onto each input's `form` attribute, prefilled from the candidate's defaults:

```tsx
export function RateModeFieldsHidden({
  formId,
  c,
}: {
  formId: string;
  c: { defaultOtRateType: 'PerHourAmount' | 'Multiplier' | null; defaultOtRatePerHour: string | null; defaultOtMultiplier: string | null };
}) {
  const [mode, setMode] = useState<'PerHourAmount' | 'Multiplier'>(c.defaultOtRateType ?? 'PerHourAmount');
  return (
    <span className="inline-flex items-center gap-1">
      <select form={formId} name="rateType" value={mode} onChange={(e) => setMode(e.target.value as 'PerHourAmount' | 'Multiplier')} className="rounded-md border border-gray-300 px-1 py-1 text-xs">
        <option value="PerHourAmount">฿/ชม.</option>
        <option value="Multiplier">×</option>
      </select>
      {mode === 'PerHourAmount' ? (
        <input form={formId} name="ratePerHour" type="number" step="1" min="0" defaultValue={c.defaultOtRatePerHour ?? ''} className="w-20 rounded-md border border-gray-300 px-1 py-1 text-xs" />
      ) : (
        <input form={formId} name="multiplier" type="number" step="0.25" min="0" max="9.99" defaultValue={c.defaultOtMultiplier ?? ''} className="w-20 rounded-md border border-gray-300 px-1 py-1 text-xs" />
      )}
    </span>
  );
}
```
Import `RateModeFieldsHidden` alongside `RateModeFields` in `page.tsx`. (Mark `RateModeFieldsHidden` is the one used in the candidate rows; `RateModeFields` is for the manual-add form.)

**Server-action form typing note:** `approveOt`/`dismissOt`/`voidOt` return `Promise<OtActionResult>`, but a `<form action={...}>` expects `(formData) => void | Promise<void>`. Wrap them in thin `'use server'` adapters that ignore the return (or change the actions to return `void` and `redirect` with an `?error=`/`?ok=` param like the leave-config action). **Simplest:** make the actions `redirect()` on completion (success → `?ok=1`, failure → `?error=...`) instead of returning a result object — mirror `src/app/(admin)/admin/settings/leave-config/actions.ts`. Update Task 5's actions to redirect rather than return `OtActionResult` if you choose this; pick ONE approach and keep it consistent.

- [ ] **Step 4: Typecheck + lint**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck && PATH="/opt/homebrew/bin:$PATH" pnpm exec biome check --write "src/app/(admin)/admin/attendance/overtime" src/lib/overtime`
Expected: typecheck PASS; biome formats cleanly.

- [ ] **Step 5: Manual verification**

`pnpm dev`, sign in as admin → `/admin/attendance/overtime`. With a check-in/out where clock-out beat the schedule, the candidate appears; approve it (pick a rate) → it moves to history with the computed ฿ and the candidate disappears; "ไม่ใช่ OT" dismisses; manual-add creates an entry; "ลบ" voids and the slot frees.

- [ ] **Step 6: Commit**

```bash
PATH="/opt/homebrew/bin:$PATH" git add "src/app/(admin)/admin/attendance/overtime" "src/app/(admin)/admin/attendance/attendance-tabs.tsx"
PATH="/opt/homebrew/bin:$PATH" git commit -m "feat(ot): OT review page (candidates, manual add, history) + attendance tab"
```

---

## Task 7: Per-employee default OT rate

**Files:**
- Modify: `src/app/(admin)/admin/employees/employee-schema.ts`
- Modify: `src/app/(admin)/admin/employees/employee-form.tsx`
- Modify: `src/app/(admin)/admin/employees/[id]/edit/page.tsx`

- [ ] **Step 1: Schema** — in `employee-schema.ts`, add to the Zod schema (read the file to match its transform style; OT fields are all optional/nullable):

```ts
  defaultOtRateType: z
    .enum(['PerHourAmount', 'Multiplier'])
    .optional()
    .or(z.literal('').transform(() => undefined)),
  defaultOtRatePerHour: z
    .union([z.literal('').transform(() => null), z.coerce.number().min(0).max(100000)])
    .nullable()
    .optional(),
  defaultOtMultiplier: z
    .union([z.literal('').transform(() => null), z.coerce.number().min(0).max(9.99)])
    .nullable()
    .optional(),
```
Add the three keys to `readForm()` (reading from `formData.get(...)`), and ensure the create/update actions persist them. **Read `employees/actions.ts`** to see how parsed data maps to `prisma.employee.create/update` — add `defaultOtRateType`, `defaultOtRatePerHour`, `defaultOtMultiplier` to the written `data` (converting numbers to the column types; Prisma accepts numbers for Decimal). Normalize `''`/undefined → `null` for a cleared value.

- [ ] **Step 2: Form** — in `employee-form.tsx`, add to the `Initial` type:

```ts
  defaultOtRateType: 'PerHourAmount' | 'Multiplier' | null;
  defaultOtRatePerHour: string | null;
  defaultOtMultiplier: string | null;
```
and add an "OT (ค่าล่วงเวลา)" field block (follow the existing field/section markup — a `select` for rate type with a blank "— ไม่กำหนด —" option, plus number inputs for ฿/hour and multiplier), with `defaultValue` from `initial`. Place it near the salary fields.

- [ ] **Step 3: Edit page** — in `[id]/edit/page.tsx`, add `defaultOtRateType`, `defaultOtRatePerHour`, `defaultOtMultiplier` to the `prisma.employee.findUnique` `select`, and to the `initial={{ ... }}` object (stringify the Decimals: `emp.defaultOtRatePerHour ? String(emp.defaultOtRatePerHour) : null`, same for multiplier).

- [ ] **Step 4: Typecheck + perm-coverage + tests**

Run: `PATH="/opt/homebrew/bin:$PATH" pnpm typecheck && PATH="/opt/homebrew/bin:$PATH" pnpm test -- --run`
Expected: typecheck PASS; tests pass (existing employee-form/schema tests still green).

- [ ] **Step 5: Commit**

```bash
PATH="/opt/homebrew/bin:$PATH" git add "src/app/(admin)/admin/employees"
PATH="/opt/homebrew/bin:$PATH" git commit -m "feat(ot): per-employee default OT rate on the employee form"
```

---

## Task 8: Final gate

- [ ] **Step 1: Full gate**

```bash
PATH="/opt/homebrew/bin:$PATH" pnpm typecheck && PATH="/opt/homebrew/bin:$PATH" pnpm test -- --run
```
Expected: typecheck clean; tests pass (350 baseline + new `rate` cases ≈ 358). Confirm no NEW lint errors in OT files: `PATH="/opt/homebrew/bin:$PATH" pnpm exec biome check src/lib/overtime "src/app/(admin)/admin/attendance/overtime" "src/app/(admin)/admin/employees"` (pre-existing seed `noConsole` warnings elsewhere are not ours).

- [ ] **Step 2: Live DB sanity**

```bash
PATH="/opt/homebrew/bin:$PATH" pnpm dotenv -e .env.local -- tsx -e "
import { PrismaClient } from '@prisma/client';
(async () => { const p = new PrismaClient(); console.log('OvertimeEntry rows:', await p.overtimeEntry.count()); await p.\$disconnect(); })();
"
```
Expected: runs without error.

- [ ] **Step 3: Commit any formatter changes**

```bash
PATH="/opt/homebrew/bin:$PATH" git add -A && PATH="/opt/homebrew/bin:$PATH" git commit -m "chore(ot): phase 3 gate" || echo "nothing to commit"
```

---

## Self-review notes (coverage map)

- **OvertimeEntry table (per-employee/date, partial-unique, soft-delete)** → Task 1.
- **Per-employee default rates + OT config knobs** → Task 1 (schema), Task 7 (form).
- **Pure pricing (flat ฿/hr + ×multiplier, wage derivation)** → Task 2.
- **Auto-surface candidates from clock-out vs schedule** → Task 3.
- **Approve / dismiss / manual add / void** → Task 5.
- **Dedicated OT menu + review UI** → Task 6.
- **Permission + audit** → Task 4.

**Scope decision (record-only):** NO `calc.ts` / `Payroll.incomeOt` changes — there's no payroll run to consume them. OT pay is captured in `OvertimeEntry.computedAmount` (frozen at approval) and totalled on the OT page. Wiring into payroll is a small follow-up once the payroll runner exists.

**Decisions to lock during build:** (a) server actions redirect with `?ok`/`?error` vs return a result object — pick the redirect style (matches leave-config) for `<form action>` compatibility; (b) candidate-row rate inputs use the `form=` attribute to associate with the row's approve form.

**Not in Phase 3:** holiday/rest-day OT multiplier tiers; pre-shift (early-start) OT; payroll payslip line.
