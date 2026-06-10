# Reports & Entitlement Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add report pages (advances, attendance lateness, leave by type) for admin and workers, and enforce leave/advance entitlements: warn at submit, decide at approval — `Block` policy types cannot be approved over quota; `DeductPay` types freeze an automatic salary deduction.

**Architecture:** One migration adds `OverQuotaPolicy` to `LeaveType`, frozen `overQuotaMinutes`/`deductAmount` to `LeaveRequest`, and `deductLeave` to `Payroll`. Pure calculation modules (`leave/over-quota.ts`, `advance/period-earnings.ts`) are shared by worker-form previews, admin approval guards, and the (future) payroll run. Reports are server-component aggregation pages under `/admin/reports/*` plus a worker `/liff/summary` page.

**Tech Stack:** Next.js App Router (RSC + server actions), Prisma/Postgres (Supabase), next-intl (6 locales), Vitest, Tailwind, decimal.js.

**Spec:** `docs/superpowers/specs/2026-06-10-reports-and-entitlement-enforcement-design.md`

**Environment notes (worktree):**
- Prepend Homebrew to PATH in every shell: `export PATH=/opt/homebrew/bin:$PATH` (default node is v22; repo needs v24+/pnpm).
- `.env.local` must exist in the worktree (copy from the main checkout) before `pnpm db:migrate` / tests.
- Run commands from the worktree root.
- **Known facts discovered during planning** (do not re-litigate):
  - There is NO payroll-generation pipeline yet. `calcPayroll` (`src/lib/payroll/calc.ts`) is a pure function with no production caller, Monthly-only. We extend the pure function + data model so the future pipeline picks deductions up; we do NOT build the pipeline.
  - The worker leave form already shows balance + a generic over-balance warning (`leave.new.exceedsBalance`); we make it policy-aware.
  - The admin UI is intentionally Thai-only (no i18n). Only LIFF pages need 6-locale strings.
  - Migration folders are numbered `00NN_snake_name`.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | New enum + 4 fields |
| `prisma/migrations/0025_over_quota_policy_and_deductions/migration.sql` | Create (via migrate dev) | DDL + one-time data fix |
| `src/lib/leave/over-quota.ts` | Create | Pure: per-minute pay rate, over-quota minutes, deduction amount |
| `src/lib/leave/over-quota.test.ts` | Create | Unit tests |
| `src/lib/advance/period-earnings.ts` | Create | Pure: payroll-period bounds + Daily/Hourly earnings from attendance |
| `src/lib/advance/period-earnings.test.ts` | Create | Unit tests |
| `src/lib/advance/balance.ts` | Modify | rate-based variant gains `available` when earnings supplied |
| `src/lib/advance/balance.test.ts` | Modify (or create if missing) | Cover new branch |
| `src/lib/advance/available.ts` | Create | DB-aware: available amount for one employee (shared by LIFF page + approval guard) |
| `src/lib/leave/admin.ts` | Modify | Approval: compute/freeze over-quota + Block guard |
| `src/lib/leave/approval-preview.ts` | Create | DB-aware preview used by admin modal + LIFF form (policy, remaining, estimated deduction) |
| `src/app/(admin)/admin/leave/leave-review-modal.tsx` (+ its data source) | Modify | Show over-quota panel; disable approve for Block |
| `src/app/(liff)/liff/leave/new/page.tsx` + `leave-new-form.tsx` | Modify | Policy-aware warning + estimated deduction |
| `src/app/(admin)/admin/settings/leave-types/*` | Modify | overQuotaPolicy field on form + action |
| `src/lib/advance/admin.ts` | Modify | Hard over-cap guard on approve |
| `src/app/(liff)/liff/advance/new/advance-new-form.tsx` + `page.tsx` + `balance-card.tsx` | Modify | Daily/Hourly available + over-cap warning |
| `src/lib/payroll/calc.ts` + `calc.test.ts` | Modify | `leaveDeductions` input → `deductLeave` output |
| `src/lib/reports/period.ts` | Create | Parse/normalize report period (month nav + custom range) |
| `src/lib/reports/queries.ts` | Create | Three aggregation queries (advances, attendance, leave) |
| `src/lib/reports/period.test.ts` | Create | Unit tests |
| `src/lib/auth/permissions.ts` + `roles.ts` | Modify | `report.read` permission |
| `src/components/admin/sidebar.tsx` | Modify | "รายงาน" nav item |
| `src/app/(admin)/admin/reports/{page,advance/page,attendance/page,leave/page}.tsx` + `period-picker.tsx` | Create | Report pages |
| `src/app/(liff)/liff/summary/page.tsx` | Create | Worker personal summary |
| `messages/{th,en,my,lo,zh-CN,km}.json` | Modify | New LIFF keys |

---

### Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create (generated): `prisma/migrations/0025_over_quota_policy_and_deductions/migration.sql`

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Add the enum (next to the other enums, e.g. after `LeaveUnit`):

```prisma
/// What happens when an approved leave would exceed the year's entitlement.
enum OverQuotaPolicy {
  Block     // over-quota requests cannot be approved (e.g. vacation)
  DeductPay // approval allowed; the over-quota portion is salary-deducted
}
```

In `model LeaveType`, after `annualQuota Int?`:

```prisma
  overQuotaPolicy OverQuotaPolicy @default(DeductPay)
```

In `model LeaveRequest`, after `chargedMinutes Int?`:

```prisma
  /// Minutes beyond the year entitlement, frozen at approval (0/null = within quota).
  overQuotaMinutes    Int?
  /// Money value of overQuotaMinutes at the employee's per-minute rate, frozen at approval.
  deductAmount        Decimal?  @db.Decimal(12, 2)
  /// Payroll row that swept this deduction (null = not yet deducted). Mirrors CashAdvance.
  deductedInPayrollId String?   @db.Uuid
```

In `model Payroll`, after `deductAttendance`:

```prisma
  deductLeave Decimal @db.Decimal(12, 2) @default(0)
```

- [ ] **Step 2: Generate the migration**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm db:migrate --name over_quota_policy_and_deductions`
Expected: new folder `prisma/migrations/0025_over_quota_policy_and_deductions/` (Prisma prefixes a timestamp unless the repo uses bare numbers — match whatever `migrate dev` produces; the existing folders are `00NN_name`, which means they were renamed manually. If `migrate dev` generates a timestamped folder, rename it to `0025_over_quota_policy_and_deductions` BEFORE applying, or check how 0023/0024 were authored — follow that exact procedure.)

- [ ] **Step 3: Append the one-time data fix to the generated migration.sql**

```sql
-- One-time policy fix: vacation must not exceed quota. Matching by name here is
-- safe because this runs exactly once per environment at migrate-time; runtime
-- code never matches by name (names are admin-editable + localized).
UPDATE "LeaveType" SET "overQuotaPolicy" = 'Block' WHERE "name" IN ('ลาพักร้อน', 'พักร้อน');
```

Then re-apply: `pnpm db:migrate` (applies the edited SQL if the folder was renamed before first apply; otherwise use `pnpm db:reset` only on a LOCAL dev db — never against prod).

- [ ] **Step 4: Regenerate client + typecheck**

Run: `pnpm db:generate && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add prisma
git commit -m "feat(db): OverQuotaPolicy, frozen leave deductions, Payroll.deductLeave"
```

---

### Task 2: Pure over-quota math — `src/lib/leave/over-quota.ts`

**Files:**
- Create: `src/lib/leave/over-quota.ts`
- Test: `src/lib/leave/over-quota.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/leave/over-quota.test.ts
import { describe, expect, it } from 'vitest';
import { deductionForOverQuota, overQuotaMinutesFor, perMinuteRate } from './over-quota';

describe('perMinuteRate', () => {
  // std day = 420 min (09:00–12:00 + 13:00–17:00), workingDaysPerMonth = 30
  it('Monthly: baseSalary / workingDays / stdDayMinutes', () => {
    expect(perMinuteRate('Monthly', 12600, 30, 420)).toBeCloseTo(1); // 12600/30/420
  });
  it('Daily: baseSalary / stdDayMinutes', () => {
    expect(perMinuteRate('Daily', 420, 30, 420)).toBeCloseTo(1);
  });
  it('Hourly: baseSalary / 60', () => {
    expect(perMinuteRate('Hourly', 60, 30, 420)).toBeCloseTo(1);
  });
});

describe('overQuotaMinutesFor', () => {
  it('null remaining (unlimited) → 0', () => {
    expect(overQuotaMinutesFor(420, null)).toBe(0);
  });
  it('within quota → 0', () => {
    expect(overQuotaMinutesFor(420, 840)).toBe(0);
  });
  it('partially over → only the excess', () => {
    expect(overQuotaMinutesFor(840, 420)).toBe(420);
  });
  it('negative remaining (historical over-approval) → whole charge is over', () => {
    expect(overQuotaMinutesFor(420, -100)).toBe(420);
  });
});

describe('deductionForOverQuota', () => {
  it('rounds to 2dp', () => {
    expect(deductionForOverQuota(125, 1.2345)).toBe(154.31);
  });
  it('0 over-quota → 0', () => {
    expect(deductionForOverQuota(0, 99)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test src/lib/leave/over-quota.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/leave/over-quota.ts
/**
 * Pure over-quota leave math. Shared by the worker-form preview, the admin
 * approval guard/freeze, and reports — one formula, three surfaces.
 *
 * Per-minute rate convention (matches the spec):
 *   Monthly: baseSalary / workingDaysPerMonth (PayrollConfig) / stdDayMinutes (LeaveConfig)
 *   Daily:   baseSalary / stdDayMinutes
 *   Hourly:  baseSalary / 60
 */

export type SalaryType = 'Monthly' | 'Daily' | 'Hourly';

export function perMinuteRate(
  salaryType: SalaryType,
  baseSalary: number,
  workingDaysPerMonth: number,
  stdDayMinutes: number,
): number {
  switch (salaryType) {
    case 'Monthly':
      return baseSalary / workingDaysPerMonth / stdDayMinutes;
    case 'Daily':
      return baseSalary / stdDayMinutes;
    case 'Hourly':
      return baseSalary / 60;
  }
}

/** Minutes of `chargedMinutes` that exceed the year entitlement.
 *  `remaining` null = unlimited quota → never over. Negative remaining
 *  (historical over-approval) clamps to 0 so the deduction never
 *  retro-charges previous requests. */
export function overQuotaMinutesFor(chargedMinutes: number, remaining: number | null): number {
  if (remaining == null) return 0;
  return Math.max(0, chargedMinutes - Math.max(0, remaining));
}

/** Baht value of the over-quota minutes, rounded to satang (2dp). */
export function deductionForOverQuota(overQuotaMinutes: number, ratePerMinute: number): number {
  return Math.round(overQuotaMinutes * ratePerMinute * 100) / 100;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test src/lib/leave/over-quota.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/leave/over-quota.ts src/lib/leave/over-quota.test.ts
git commit -m "feat(leave): pure over-quota math (rate, excess minutes, deduction)"
```

---

### Task 3: Period earnings for Daily/Hourly advances

**Files:**
- Create: `src/lib/advance/period-earnings.ts`
- Test: `src/lib/advance/period-earnings.test.ts`
- Modify: `src/lib/advance/balance.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/advance/period-earnings.test.ts
import { describe, expect, it } from 'vitest';
import { payrollPeriodFor, periodEarnings } from './period-earnings';

describe('payrollPeriodFor', () => {
  // cutoffDay=25: period containing 2026-06-10 is [2026-05-26 .. 2026-06-25]
  it('date before/equal cutoff → prev-month 26th to this-month 25th', () => {
    expect(payrollPeriodFor('2026-06-10', 25)).toEqual({ start: '2026-05-26', end: '2026-06-25' });
    expect(payrollPeriodFor('2026-06-25', 25)).toEqual({ start: '2026-05-26', end: '2026-06-25' });
  });
  it('date after cutoff → this-month 26th to next-month 25th', () => {
    expect(payrollPeriodFor('2026-06-26', 25)).toEqual({ start: '2026-06-26', end: '2026-07-25' });
  });
  it('handles January wrap', () => {
    expect(payrollPeriodFor('2026-01-10', 25)).toEqual({ start: '2025-12-26', end: '2026-01-25' });
  });
});

describe('periodEarnings', () => {
  const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
  it('Daily: distinct worked dates × rate', () => {
    const rows = [
      { date: day('2026-06-01'), clockInAt: new Date('2026-06-01T01:00:00Z'), clockOutAt: new Date('2026-06-01T10:00:00Z') },
      { date: day('2026-06-02'), clockInAt: new Date('2026-06-02T01:00:00Z'), clockOutAt: null },
      { date: day('2026-06-02'), clockInAt: new Date('2026-06-02T03:00:00Z'), clockOutAt: null }, // same date, counted once
    ];
    expect(periodEarnings('Daily', 400, rows)).toBe(800);
  });
  it('Hourly: Σ clocked minutes / 60 × rate; rows without clockOut contribute 0', () => {
    const rows = [
      { date: day('2026-06-01'), clockInAt: new Date('2026-06-01T02:00:00Z'), clockOutAt: new Date('2026-06-01T06:30:00Z') }, // 4.5h
      { date: day('2026-06-02'), clockInAt: new Date('2026-06-02T02:00:00Z'), clockOutAt: null },
    ];
    expect(periodEarnings('Hourly', 100, rows)).toBe(450);
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `pnpm test src/lib/advance/period-earnings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/advance/period-earnings.ts
/**
 * Earnings-so-far for Daily/Hourly employees, used as the advance cap
 * ("ไม่เกินเงินเดือน" — for rate-based staff "เงินเดือน" means what they have
 * actually earned this payroll period). Pure; callers fetch attendance.
 *
 * Payroll period = cutoffDay-based: (prevMonth cutoff+1) .. (thisMonth cutoff),
 * matching PayrollConfig.cutoffDay (default 25).
 */

export type PayrollPeriod = { start: string; end: string }; // YYYY-MM-DD inclusive

export function payrollPeriodFor(todayYmd: string, cutoffDay: number): PayrollPeriod {
  const [y, m, d] = todayYmd.split('-').map(Number);
  // Use UTC date arithmetic on day-precision values; no wall-clock involved.
  const afterCutoff = d > cutoffDay;
  const endMonth = afterCutoff ? m + 1 : m;
  const end = new Date(Date.UTC(y, endMonth - 1, cutoffDay));
  const start = new Date(Date.UTC(y, endMonth - 2, cutoffDay + 1));
  const ymd = (dt: Date) => dt.toISOString().slice(0, 10);
  return { start: ymd(start), end: ymd(end) };
}

export type WorkedRow = {
  date: Date; // UTC-midnight @db.Date value
  clockInAt: Date | null;
  clockOutAt: Date | null;
};

/** Daily → distinct worked dates × rate. Hourly → Σ(clockOut−clockIn) minutes
 *  / 60 × rate (open rows contribute 0). Result rounded to 2dp. */
export function periodEarnings(
  salaryType: 'Daily' | 'Hourly',
  rate: number,
  rows: readonly WorkedRow[],
): number {
  if (salaryType === 'Daily') {
    const dates = new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
    return Math.round(dates.size * rate * 100) / 100;
  }
  let minutes = 0;
  for (const r of rows) {
    if (r.clockInAt && r.clockOutAt) {
      minutes += Math.max(0, (r.clockOutAt.getTime() - r.clockInAt.getTime()) / 60_000);
    }
  }
  return Math.round((minutes / 60) * rate * 100) / 100;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test src/lib/advance/period-earnings.test.ts`
Expected: PASS

- [ ] **Step 5: Extend `calculateAdvanceBalance` for rate-based availability**

In `src/lib/advance/balance.ts`:
- Add to `AdvanceBalanceInput`: `periodEarnings?: number | null;` (doc: "Earned-so-far this payroll period for Daily/Hourly; when provided the rate-based variant gains available/overdrawn").
- Change the `rate-based` return-type variant to include `earnings: number | null; available: number | null; overdrawn: boolean;`.
- Replace the final `return` with:

```ts
  const earnings = input.periodEarnings ?? null;
  const available = earnings == null ? null : earnings - reserved;
  return {
    kind: 'rate-based',
    salaryType: input.salaryType,
    ratePerPeriod: baseSalary,
    pending,
    approvedNotDeducted,
    reserved,
    earnings,
    available,
    overdrawn: available != null && available < 0,
  };
```

Add tests in `src/lib/advance/balance.test.ts` (create the file if it doesn't exist, following the vitest style above):

```ts
import { describe, expect, it } from 'vitest';
import { calculateAdvanceBalance } from './balance';

describe('calculateAdvanceBalance rate-based availability', () => {
  it('with periodEarnings: available = earnings − reserved', () => {
    const b = calculateAdvanceBalance({
      baseSalary: 400,
      salaryType: 'Daily',
      reservedAdvances: [{ status: 'Pending', amount: 1000 }],
      periodEarnings: 4000,
    });
    expect(b.kind).toBe('rate-based');
    if (b.kind === 'rate-based') {
      expect(b.available).toBe(3000);
      expect(b.overdrawn).toBe(false);
    }
  });
  it('without periodEarnings: available is null (V1 behavior preserved)', () => {
    const b = calculateAdvanceBalance({
      baseSalary: 400,
      salaryType: 'Hourly',
      reservedAdvances: [],
    });
    if (b.kind === 'rate-based') expect(b.available).toBeNull();
  });
});
```

- [ ] **Step 6: Run the full advance test set + typecheck**

Run: `pnpm test src/lib/advance && pnpm typecheck`
Expected: PASS. Typecheck may flag consumers of the `rate-based` variant (e.g. `balance-card.tsx`) if they destructure exhaustively — fix by handling the new fields (display comes in Task 8).

- [ ] **Step 7: Create the shared DB-aware helper**

```ts
// src/lib/advance/available.ts
import { prisma } from '@/lib/db/prisma';
import { type AdvanceBalance, calculateAdvanceBalance } from './balance';
import { payrollPeriodFor, periodEarnings } from './period-earnings';

/**
 * The one place that answers "how much can this employee still draw?".
 * Used by the LIFF advance page/form AND the admin approval guard so the
 * two can never disagree.
 *
 * @param excludeAdvanceId omit one advance from "reserved" — pass the id of
 *   the advance being approved so it doesn't count against itself.
 */
export async function advanceBalanceFor(
  employeeId: string,
  excludeAdvanceId?: string,
): Promise<AdvanceBalance> {
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { baseSalary: true, salaryType: true },
  });

  const reservedRows = await prisma.cashAdvance.findMany({
    where: {
      employeeId,
      deletedAt: null,
      ...(excludeAdvanceId ? { id: { not: excludeAdvanceId } } : {}),
      OR: [{ status: 'Pending' }, { status: 'Approved', isDeducted: false }],
    },
    select: { status: true, amount: true },
  });

  let earnings: number | null = null;
  if (employee.salaryType !== 'Monthly') {
    const cfg = await prisma.payrollConfig.findFirstOrThrow({ select: { cutoffDay: true } });
    const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    const period = payrollPeriodFor(todayYmd, cfg.cutoffDay);
    const rows = await prisma.attendance.findMany({
      where: {
        employeeId,
        deletedAt: null,
        type: 'CheckIn',
        date: {
          gte: new Date(`${period.start}T00:00:00.000Z`),
          lte: new Date(`${period.end}T00:00:00.000Z`),
        },
      },
      select: { date: true, clockInAt: true, clockOutAt: true },
    });
    // For Daily the "rate" is per worked day; for Hourly per hour. Both live
    // in baseSalary per the Employee model convention.
    earnings = periodEarnings(
      employee.salaryType,
      Number(employee.baseSalary),
      rows,
    );
  }

  return calculateAdvanceBalance({
    baseSalary: employee.baseSalary,
    salaryType: employee.salaryType,
    reservedAdvances: reservedRows as Array<{
      status: 'Pending' | 'Approved';
      amount: typeof reservedRows[number]['amount'];
    }>,
    periodEarnings: earnings,
  });
}
```

Verify `prisma.payrollConfig.findFirstOrThrow` matches how the singleton is read elsewhere (`grep -rn "payrollConfig" src/lib`) and copy that accessor if a helper exists.

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm typecheck`

```bash
git add src/lib/advance
git commit -m "feat(advance): period earnings cap for Daily/Hourly + shared availability helper"
```

---

### Task 4: Freeze over-quota at leave approval + Block guard

**Files:**
- Modify: `src/lib/leave/admin.ts` (`approveLeaveRequest`)
- Create: `src/lib/leave/approval-preview.ts`

- [ ] **Step 1: Extend the approval transaction**

In `approveLeaveRequest` (`src/lib/leave/admin.ts`):

1. Extend the `tx.leaveRequest.findUnique` select: add `leaveType: { select: { name: true, nameByLocale: true, annualQuota: true, overQuotaPolicy: true } }` and `employee: { select: { firstName: true, userId: true, salaryType: true, baseSalary: true } }`.

2. After `chargedMinutes` is computed (line ~248, `const chargedMinutes = segment.minutes * targetDates.length;`) — note this sits AFTER `tx.attendance.createMany`; move the new guard BEFORE `createMany` so a blocked approval inserts nothing. Compute the over-quota numbers (the `cfg` and `std` are already in scope via `getLeaveConfig()`; add `standardDayMinutes` to the existing `./units` import):

```ts
      // ── Entitlement check (frozen at approval) ─────────────────────────
      const chargedMinutes = segment.minutes * targetDates.length;
      const year = req.startDate.getUTCFullYear();
      const std = standardDayMinutes(cfg);
      const ent = await tx.leaveEntitlement.findUnique({
        where: {
          employeeId_leaveTypeId_periodYear: {
            employeeId: req.employeeId,
            leaveTypeId: req.leaveTypeId,
            periodYear: year,
          },
        },
        select: { grantedMinutes: true, carryoverMinutes: true, adjustmentMinutes: true },
      });
      const granted = resolveGrantedMinutes(req.leaveType.annualQuota, ent, std);
      const usedRows = await tx.leaveRequest.findMany({
        where: {
          employeeId: req.employeeId,
          leaveTypeId: req.leaveTypeId,
          status: 'Approved',
          deletedAt: null,
          startDate: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        },
        select: { chargedMinutes: true },
      });
      const used = usedRows.reduce((s, r) => s + (r.chargedMinutes ?? 0), 0);
      const remaining = remainingMinutes(
        {
          grantedMinutes: granted,
          carryoverMinutes: ent?.carryoverMinutes ?? 0,
          adjustmentMinutes: ent?.adjustmentMinutes ?? 0,
        },
        used,
      );
      const overQuota = overQuotaMinutesFor(chargedMinutes, remaining);

      if (overQuota > 0 && req.leaveType.overQuotaPolicy === 'Block') {
        return {
          ok: false as const,
          code: 'over-quota-block' as const,
          message: `เกินสิทธิคงเหลือ (เหลือ ${formatDaysHours(Math.max(0, remaining ?? 0), cfg)}) — ประเภทการลานี้ไม่อนุญาตให้เกินสิทธิ`,
        };
      }

      let deductAmount: number | null = null;
      if (overQuota > 0) {
        const payCfg = await tx.payrollConfig.findFirstOrThrow({
          select: { workingDaysPerMonth: true },
        });
        const rate = perMinuteRate(
          req.employee.salaryType,
          Number(req.employee.baseSalary),
          payCfg.workingDaysPerMonth,
          std,
        );
        deductAmount = deductionForOverQuota(overQuota, rate);
      }
```

3. Add imports at the top of the file: `import { remainingMinutes, resolveGrantedMinutes } from './balance';` and `import { deductionForOverQuota, overQuotaMinutesFor, perMinuteRate } from './over-quota';` and add `formatDaysHours`, `standardDayMinutes` to the `./units` import.

4. In the `tx.leaveRequest.update` data, add:

```ts
          overQuotaMinutes: overQuota > 0 ? overQuota : null,
          deductAmount,
```

5. In the `auditLogTx` `after` payload, add `overQuotaMinutes: overQuota, deductAmount,`.

6. Widen `ApproveResult`'s error `code` union with `'over-quota-block'`.

7. In `notifBox.data`, add `deductAmount: deductAmount,` (type: `number | null`) and pass it through to `sendNotification` as an extra payload field `deductAmount`. Then follow the type error trail: the `leave.approved` event payload type (in `src/lib/inngest/events.ts` or wherever `kind: 'leave.approved'` is defined) gains an optional `deductAmount?: number | null`. Where the LINE/bell message for `leave.approved` is rendered, append a line when `deductAmount` is a positive number, using new i18n key `notifications.leaveApprovedDeduction` (added in Task 6). Keep this minimal — one conditional line in the existing template.

- [ ] **Step 2: Typecheck + run existing tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. The compiler will surface every consumer of `ApproveResult` that needs the new code handled (review modal shows `message` already, so usually no change needed).

- [ ] **Step 3: Create the shared preview helper**

```ts
// src/lib/leave/approval-preview.ts
import { prisma } from '@/lib/db/prisma';
import { remainingMinutes, resolveGrantedMinutes } from './balance';
import { getLeaveConfig } from './leave-config';
import { deductionForOverQuota, overQuotaMinutesFor, perMinuteRate } from './over-quota';
import { standardDayMinutes } from './units';

export type OverQuotaPreview = {
  policy: 'Block' | 'DeductPay';
  /** Remaining minutes for the request's year (null = unlimited). */
  remaining: number | null;
  /** Minutes the request would charge beyond the entitlement. */
  overQuotaMinutes: number;
  /** Estimated deduction at today's salary (the approval freeze recomputes). */
  estimatedDeduction: number;
};

/** Preview what approving `chargedMinutes` of one type would do to the
 *  employee's entitlement. Read-only; used by the admin review modal.
 *  (The worker form computes its own preview client-side from the same
 *  pure functions — see leave-new-form.tsx.) */
export async function overQuotaPreview(
  employeeId: string,
  leaveTypeId: string,
  year: number,
  chargedMinutes: number,
): Promise<OverQuotaPreview> {
  const [cfg, type, ent, employee, payCfg] = await Promise.all([
    getLeaveConfig(),
    prisma.leaveType.findUniqueOrThrow({
      where: { id: leaveTypeId },
      select: { annualQuota: true, overQuotaPolicy: true },
    }),
    prisma.leaveEntitlement.findUnique({
      where: { employeeId_leaveTypeId_periodYear: { employeeId, leaveTypeId, periodYear: year } },
      select: { grantedMinutes: true, carryoverMinutes: true, adjustmentMinutes: true },
    }),
    prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { salaryType: true, baseSalary: true },
    }),
    prisma.payrollConfig.findFirstOrThrow({ select: { workingDaysPerMonth: true } }),
  ]);
  const std = standardDayMinutes(cfg);
  const granted = resolveGrantedMinutes(type.annualQuota, ent, std);
  const usedRows = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      leaveTypeId,
      status: 'Approved',
      deletedAt: null,
      startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
    },
    select: { chargedMinutes: true },
  });
  const used = usedRows.reduce((s, r) => s + (r.chargedMinutes ?? 0), 0);
  const remaining = remainingMinutes(
    {
      grantedMinutes: granted,
      carryoverMinutes: ent?.carryoverMinutes ?? 0,
      adjustmentMinutes: ent?.adjustmentMinutes ?? 0,
    },
    used,
  );
  const over = overQuotaMinutesFor(chargedMinutes, remaining);
  const rate = perMinuteRate(
    employee.salaryType,
    Number(employee.baseSalary),
    payCfg.workingDaysPerMonth,
    std,
  );
  return {
    policy: type.overQuotaPolicy,
    remaining,
    overQuotaMinutes: over,
    estimatedDeduction: deductionForOverQuota(over, rate),
  };
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck`

```bash
git add src/lib/leave src/lib/inngest
git commit -m "feat(leave): freeze over-quota deduction at approval; Block policy guard"
```

---

### Task 5: Admin leave review modal — over-quota panel

**Files:**
- Modify: `src/app/(admin)/admin/leave/leave-review-modal.tsx` and the server component that feeds it (`leave-inbox.tsx` / `page.tsx` — read them first to find where row data is assembled)

- [ ] **Step 1: Read the modal + inbox to find the data path**

Run: `grep -n "leaveDurationLabel\|chargedMinutes\|LeaveRowVM\|segmentFor" "src/app/(admin)/admin/leave/"*.tsx | head -30`
Identify: (a) the row view-model type, (b) where rows are built server-side, (c) the modal's props.

- [ ] **Step 2: Compute the preview server-side per pending row**

Where pending rows are assembled (server side), compute the request's charge estimate the same way the approval does (working days × segment minutes — there is existing code for the duration label; reuse its working-day count) and call `overQuotaPreview(employeeId, leaveTypeId, startDate.getUTCFullYear(), chargeEstimate)`. Add to the row VM:

```ts
  overQuota: {
    policy: 'Block' | 'DeductPay';
    remainingLabel: string; // formatDaysHours(max(0, remaining ?? 0), cfg), or 'ไม่จำกัด' when null
    overLabel: string | null; // formatDaysHours(overQuotaMinutes, cfg) when > 0
    estimatedDeduction: number; // 0 when within quota
    blocksApproval: boolean; // policy === 'Block' && overQuotaMinutes > 0
  } | null; // null for non-Pending rows
```

Only compute for Pending rows (the modal approves only those); `Promise.all` over the page of rows is fine at this scale.

- [ ] **Step 3: Render the panel in the modal**

Inside `leave-review-modal.tsx`, above the note field (admin UI is Thai-only):

```tsx
{row.overQuota && (
  <div
    className={
      row.overQuota.overLabel
        ? 'rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800'
        : 'rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600'
    }
  >
    <p>สิทธิคงเหลือ: {row.overQuota.remainingLabel}</p>
    {row.overQuota.overLabel && (
      <>
        <p className="font-medium">เกินสิทธิ {row.overQuota.overLabel}</p>
        {row.overQuota.blocksApproval ? (
          <p className="text-red-700">ประเภทการลานี้ไม่อนุญาตให้อนุมัติเกินสิทธิ</p>
        ) : (
          <p>หากอนุมัติ จะหักเงินเดือนประมาณ ฿{row.overQuota.estimatedDeduction.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p>
        )}
      </>
    )}
  </div>
)}
```

Disable the approve button when `row.overQuota?.blocksApproval` (keep reject enabled). The server action remains the real guard — the disabled button is UX.

- [ ] **Step 4: Manual verification**

Run: `pnpm dev` and open `/admin/leave` with a seeded over-quota pending request (`pnpm db:seed:leave-advance` then adjust an entitlement in `/admin/employees/[id]/edit` to make a pending request exceed it). Verify panel renders and Block disables approve.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/leave"
git commit -m "feat(admin): over-quota panel + Block guard in leave review modal"
```

---

### Task 6: Worker leave form — policy-aware warning + i18n

**Files:**
- Modify: `src/app/(liff)/liff/leave/new/page.tsx`, `leave-new-form.tsx`
- Modify: `messages/th.json`, `messages/en.json`, `messages/my.json`, `messages/lo.json`, `messages/zh-CN.json`, `messages/km.json`

- [ ] **Step 1: Pass policy + rate to the form**

In `new/page.tsx`: extend the leave-type select to include `overQuotaPolicy: true`; fetch the employee's `salaryType`/`baseSalary` (already available via the page's `requireRole` employee) and `payrollConfig.workingDaysPerMonth`; compute `ratePerMinute = perMinuteRate(...)` server-side and pass one extra prop to `LeaveNewForm`: `ratePerMinute: number`. Extend `LeaveTypeOption` in `leave-new-form.tsx` with `overQuotaPolicy: 'Block' | 'DeductPay'`.

- [ ] **Step 2: Replace the generic warning block**

In `leave-new-form.tsx`, the existing block is (lines ~371-375):

```tsx
        {exceeds && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t('new.exceedsBalance')}
          </p>
        )}
```

Replace with:

```tsx
        {exceeds && selectedType && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {selectedType.overQuotaPolicy === 'Block'
              ? t('new.exceedsBlock')
              : t('new.exceedsDeduct', {
                  over: fmtDuration(overMinutes),
                  amount: formatMoney(overMinutes * ratePerMinute, locale),
                })}
          </p>
        )}
```

with, above it (next to the existing `exceeds` memo):

```ts
  const overMinutes =
    remaining != null && chargePreview != null ? Math.max(0, chargePreview - Math.max(0, remaining)) : 0;
```

Use the same money formatter the LIFF pages already use (`formatMoney` from `@/lib/i18n/format` — it is server-oriented; if it isn't client-safe, format with `new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })` and prefix `฿`, matching `formatMoney`'s output). Get `locale` via `useLocale()` from `next-intl`.

- [ ] **Step 3: Add i18n keys (all 6 files)**

Under `leave.new` keep `exceedsBalance` (still referenced anywhere? if not, remove it in th/en and all locales) and add `exceedsBlock`, `exceedsDeduct`. Under `notifications` add `leaveApprovedDeduction`.

th:
```json
"exceedsBlock": "เกินสิทธิคงเหลือ — ประเภทการลานี้ไม่สามารถอนุมัติส่วนที่เกินได้ คำขออาจถูกปฏิเสธ",
"exceedsDeduct": "เกินสิทธิ {over} — หากอนุมัติ จะถูกหักเงินประมาณ {amount}",
"leaveApprovedDeduction": "หมายเหตุ: ลาเกินสิทธิ จะถูกหักเงิน {amount}"
```
en:
```json
"exceedsBlock": "Exceeds your remaining balance — this leave type cannot be approved over quota. The request may be rejected.",
"exceedsDeduct": "Exceeds balance by {over} — if approved, about {amount} will be deducted from your pay",
"leaveApprovedDeduction": "Note: over-quota leave — {amount} will be deducted from your pay"
```
my:
```json
"exceedsBlock": "ကျန်ရှိသော ခွင့်ထက် ကျော်လွန်နေသည် — ဤခွင့်အမျိုးအစားသည် သတ်မှတ်ထက်ကျော်၍ ခွင့်ပြု၍မရပါ။ တောင်းဆိုချက် ငြင်းပယ်ခံရနိုင်သည်။",
"exceedsDeduct": "ခွင့် {over} ကျော်လွန်နေသည် — ခွင့်ပြုပါက လစာမှ ခန့်မှန်း {amount} ဖြတ်တောက်ခံရမည်",
"leaveApprovedDeduction": "မှတ်ချက် — သတ်မှတ်ခွင့်ထက်ကျော်သောကြောင့် လစာမှ {amount} ဖြတ်တောက်ပါမည်"
```
lo:
```json
"exceedsBlock": "ເກີນສິດທິທີ່ຍັງເຫຼືອ — ປະເພດການລາພັກນີ້ບໍ່ສາມາດອະນຸມັດສ່ວນທີ່ເກີນໄດ້ ຄຳຮ້ອງອາດຖືກປະຕິເສດ",
"exceedsDeduct": "ເກີນສິດທິ {over} — ຖ້າອະນຸມັດ ຈະຖືກຫັກເງິນປະມານ {amount}",
"leaveApprovedDeduction": "ໝາຍເຫດ: ລາພັກເກີນສິດທິ ຈະຖືກຫັກເງິນ {amount}"
```
zh-CN:
```json
"exceedsBlock": "超出剩余额度——该请假类型不允许超额批准，申请可能被拒绝",
"exceedsDeduct": "超出额度 {over}——若获批准，将从工资中扣除约 {amount}",
"leaveApprovedDeduction": "注意：请假超出额度，将从工资中扣除 {amount}"
```
km:
```json
"exceedsBlock": "លើសសិទ្ធិនៅសល់ — ប្រភេទច្បាប់ឈប់សម្រាកនេះមិនអាចអនុម័តលើសកំណត់បានទេ សំណើអាចត្រូវបានបដិសេធ",
"exceedsDeduct": "លើសសិទ្ធិ {over} — បើអនុម័ត នឹងត្រូវកាត់ប្រាក់ប្រមាណ {amount}",
"leaveApprovedDeduction": "ចំណាំ៖ ឈប់សម្រាកលើសសិទ្ធិ នឹងត្រូវកាត់ប្រាក់ {amount}"
```

(my/lo/km/zh-CN are AI drafts pending native review — same status as the rest of those files.)

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add "src/app/(liff)/liff/leave" messages
git commit -m "feat(liff): policy-aware over-quota warning with deduction estimate on leave form"
```

---

### Task 7: Leave-type settings — edit overQuotaPolicy

**Files:**
- Modify: `src/app/(admin)/admin/settings/leave-types/` (form component + server action — read the directory first)

- [ ] **Step 1: Read the existing form/action**

Run: `ls "src/app/(admin)/admin/settings/leave-types/"` and read the form + action files. The form already edits `name`, `nameByLocale`, `isPaid`, `annualQuota`, `allowFullDay/HalfDay/Hourly`.

- [ ] **Step 2: Add the field**

Form (Thai admin UI), next to `annualQuota`:

```tsx
<div>
  <label htmlFor="overQuotaPolicy" className="mb-1.5 block text-sm font-medium text-gray-700">
    เมื่อลาเกินสิทธิ
  </label>
  <select
    id="overQuotaPolicy"
    name="overQuotaPolicy"
    defaultValue={leaveType?.overQuotaPolicy ?? 'DeductPay'}
    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
  >
    <option value="DeductPay">อนุมัติได้ แต่หักเงินเดือนส่วนที่เกิน</option>
    <option value="Block">ไม่อนุญาต (อนุมัติเกินสิทธิไม่ได้)</option>
  </select>
  <p className="mt-1 text-xs text-gray-500">มีผลเฉพาะประเภทที่กำหนดโควต้าต่อปี</p>
</div>
```

Server action: accept `overQuotaPolicy`, validate with `value === 'Block' || value === 'DeductPay'`, persist on create/update, include in the existing audit log payload.

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck`; manual check at `/admin/settings/leave-types`.

```bash
git add "src/app/(admin)/admin/settings/leave-types"
git commit -m "feat(settings): over-quota policy on leave-type form"
```

---

### Task 8: Advance enforcement — hard cap at approval, warning at submit

**Files:**
- Modify: `src/lib/advance/admin.ts` (`approveCashAdvance`)
- Modify: `src/app/(liff)/liff/advance/page.tsx`, `new/page.tsx`, `new/advance-new-form.tsx`, `balance-card.tsx`
- Modify: admin advance review modal (`src/app/(admin)/admin/advance/advance-review-modal.tsx` + its data source)
- Modify: `messages/*.json` (advance warning key)

- [ ] **Step 1: Server-side guard in `approveCashAdvance`**

After the existing not-found/not-pending checks (read the function; insert before the status update), add:

```ts
  // Hard cap: "การเบิก ไม่เกินเงินเดือน". Exclude this advance from its own
  // reserved sum — it is the Pending row being decided.
  const balance = await advanceBalanceFor(advance.employeeId, advance.id);
  const available = balance.available; // both variants expose it (rate-based may be null)
  if (available != null && Number(advance.amount) > available) {
    return {
      ok: false,
      code: 'over-cap',
      message: `เกินวงเงินที่เบิกได้ (คงเหลือ ฿${available.toLocaleString('th-TH', { minimumFractionDigits: 2 })})`,
    };
  }
```

Import `advanceBalanceFor` from `./available`. Widen the result `code` union with `'over-cap'`. Note: when `available` is null (rate-based employee with no computable earnings — shouldn't happen since `advanceBalanceFor` always computes for rate-based, but guard anyway) approval proceeds; log a `console.warn` in that branch.

- [ ] **Step 2: Worker form warning**

`new/page.tsx`: replace its inline reserved-rows + `calculateAdvanceBalance` wiring (if present) with `advanceBalanceFor(employee.id)` and pass `available: number | null` to the form. In `advance-new-form.tsx`, where the amount input changes, add below it:

```tsx
{available != null && amountNumber > available && (
  <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
    {t('new.exceedsCap', { available: formatMoney(available, locale) })}
  </p>
)}
```

(Adapt names to the form's actual state variables after reading it.) Submission stays allowed.

`page.tsx` + `balance-card.tsx`: switch the page to `advanceBalanceFor(employee.id)`; in `balance-card.tsx` render the rate-based variant's new `earnings`/`available` when non-null (reuse the exact layout of the monthly variant's rows; labels: existing keys if present, else add `advance.balance.earned` / reuse `advance.balance.available`).

- [ ] **Step 3: Admin review modal numbers**

Where pending advance rows are assembled for the modal, call `advanceBalanceFor(employeeId, advanceId)` per pending row, attach `{ available: number | null; overCap: boolean }`, render in the modal (Thai):

```tsx
{row.available != null && (
  <p className={row.overCap ? 'text-sm font-medium text-red-700' : 'text-sm text-gray-600'}>
    วงเงินคงเหลือ ฿{row.available.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
    {row.overCap && ' — คำขอนี้เกินวงเงิน ไม่สามารถอนุมัติได้'}
  </p>
)}
```

Disable the approve button when `overCap`.

- [ ] **Step 4: i18n key (6 locales)**

`advance.new.exceedsCap`:
- th: `"เกินวงเงินที่เบิกได้ (คงเหลือ {available}) คำขออาจถูกปฏิเสธ"`
- en: `"Exceeds your available amount ({available} left). The request may be rejected."`
- my: `"ထုတ်ယူနိုင်သော ပမာဏထက် ကျော်လွန်နေသည် (ကျန် {available})။ တောင်းဆိုချက် ငြင်းပယ်ခံရနိုင်သည်။"`
- lo: `"ເກີນວົງເງິນທີ່ເບີກໄດ້ (ເຫຼືອ {available}) ຄຳຮ້ອງອາດຖືກປະຕິເສດ"`
- zh-CN: `"超出可借支额度（剩余 {available}），申请可能被拒绝"`
- km: `"លើសទឹកប្រាក់ដែលអាចបើកបាន (នៅសល់ {available}) សំណើអាចត្រូវបានបដិសេធ"`

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm test src/lib/advance`

```bash
git add src/lib/advance "src/app/(liff)/liff/advance" "src/app/(admin)/admin/advance" messages
git commit -m "feat(advance): hard cap at approval, earnings-based cap for daily/hourly, submit warning"
```

---

### Task 9: calcPayroll — leave deductions input

**Files:**
- Modify: `src/lib/payroll/calc.ts`, `src/lib/payroll/calc.test.ts`

- [ ] **Step 1: Write the failing test** (append to `calc.test.ts`, matching its existing fixture style — read the file first for the canonical fixture shape):

```ts
it('sums leaveDeductions into deductLeave and subtracts from net', () => {
  const draft = calcPayroll({
    ...baseFixture, // reuse the file's existing fixture builder/constants
    leaveDeductions: [{ amount: '500.00' }, { amount: 250 }],
  });
  expect(draft.deductLeave.toFixed(2)).toBe('750.00');
  // net reduced by exactly 750 vs. the same input without leaveDeductions
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm test src/lib/payroll` → FAIL (unknown property).

- [ ] **Step 3: Implement**

In `calc.ts`: add `export type LeaveDeductionForPayroll = { amount: string | number | Decimal };`, add `leaveDeductions?: readonly LeaveDeductionForPayroll[];` to `CalcInput`, add `deductLeave: Decimal;` to `PayrollDraft`, compute `const deductLeave = sumDec((input.leaveDeductions ?? []).map((d) => ({ value: d.amount }))).toDecimalPlaces(2);`, subtract it in `netPay`, return it. Update the module doc-comment: the future payroll pipeline must sweep `LeaveRequest.deductAmount WHERE status=Approved AND deletedAt IS NULL AND deductedInPayrollId IS NULL` (same contract as advances) and stamp `deductedInPayrollId` in the same transaction that creates the Payroll row.

- [ ] **Step 4: Run, verify pass** — `pnpm test src/lib/payroll` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payroll
git commit -m "feat(payroll): deductLeave bucket in calcPayroll for over-quota leave"
```

---

### Task 10: Report period helper + aggregation queries

**Files:**
- Create: `src/lib/reports/period.ts`, `src/lib/reports/period.test.ts`, `src/lib/reports/queries.ts`

- [ ] **Step 1: Failing tests for the period helper**

```ts
// src/lib/reports/period.test.ts
import { describe, expect, it } from 'vitest';
import { resolveReportPeriod } from './period';

describe('resolveReportPeriod', () => {
  const today = '2026-06-10';
  it('defaults to the current Bangkok calendar month', () => {
    expect(resolveReportPeriod({}, today)).toEqual({
      from: '2026-06-01', to: '2026-06-30', month: '2026-06',
    });
  });
  it('m=YYYY-MM selects that month', () => {
    expect(resolveReportPeriod({ m: '2026-02' }, today)).toEqual({
      from: '2026-02-01', to: '2026-02-28', month: '2026-02',
    });
  });
  it('explicit from/to overrides month (custom range)', () => {
    expect(resolveReportPeriod({ from: '2026-05-15', to: '2026-06-14' }, today)).toEqual({
      from: '2026-05-15', to: '2026-06-14', month: null,
    });
  });
  it('garbage input falls back to current month', () => {
    expect(resolveReportPeriod({ from: 'x', to: 'y', m: 'zzz' }, today).month).toBe('2026-06');
  });
  it('inverted range falls back to current month', () => {
    expect(resolveReportPeriod({ from: '2026-06-10', to: '2026-06-01' }, today).month).toBe('2026-06');
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm test src/lib/reports` → FAIL.

- [ ] **Step 3: Implement `period.ts`**

```ts
// src/lib/reports/period.ts
/** Report period resolution: ?m=YYYY-MM (month mode, default current Bangkok
 *  month) or ?from=YYYY-MM-DD&to=YYYY-MM-DD (custom range, month=null).
 *  Pure — callers pass today's Bangkok YYYY-MM-DD. */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;

export type ReportPeriod = { from: string; to: string; month: string | null };

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

export function resolveReportPeriod(
  params: { m?: string; from?: string; to?: string },
  todayYmd: string,
): ReportPeriod {
  const { from, to, m } = params;
  if (from && to && YMD.test(from) && YMD.test(to) && from <= to) {
    return { from, to, month: null };
  }
  const ym = m && YM.test(m) ? m : todayYmd.slice(0, 7);
  return { ...monthBounds(ym), month: ym };
}

/** prev/next month strings for the picker ("2026-06" → "2026-05"/"2026-07"). */
export function adjacentMonths(ym: string): { prev: string; next: string } {
  const [y, m] = ym.split('-').map(Number);
  const fmt = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}`;
  return {
    prev: m === 1 ? fmt(y - 1, 12) : fmt(y, m - 1),
    next: m === 12 ? fmt(y + 1, 1) : fmt(y, m + 1),
  };
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm test src/lib/reports` → PASS. Commit:

```bash
git add src/lib/reports
git commit -m "feat(reports): period resolution helper"
```

- [ ] **Step 5: Implement `queries.ts`**

```ts
// src/lib/reports/queries.ts
/**
 * Aggregation queries behind /admin/reports/* and /liff/summary.
 * Server-only. Dates are UTC-midnight @db.Date semantics; `from`/`to`
 * are inclusive YYYY-MM-DD strings from resolveReportPeriod.
 */
import { prisma } from '@/lib/db/prisma';
import { advanceBalanceFor } from '@/lib/advance/available';
import { remainingByTypeForEmployee } from '@/lib/leave/balance';

const utc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

export type EmployeeFilter = { branchId?: string; departmentId?: string; q?: string };

function employeeWhere(f: EmployeeFilter) {
  return {
    archivedAt: null,
    ...(f.branchId ? { branchId: f.branchId } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.q
      ? {
          OR: [
            { firstName: { contains: f.q, mode: 'insensitive' as const } },
            { lastName: { contains: f.q, mode: 'insensitive' as const } },
            { nickname: { contains: f.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

// ── 1) Advances ───────────────────────────────────────────────────────────
export type AdvanceReportRow = {
  employeeId: string;
  name: string;
  approvedInPeriod: number;
  outstandingNow: number; // Approved & !isDeducted, all-time
  availableNow: number | null;
};

export async function advanceReport(
  period: { from: string; to: string },
  filter: EmployeeFilter,
): Promise<AdvanceReportRow[]> {
  const employees = await prisma.employee.findMany({
    where: employeeWhere(filter),
    orderBy: [{ firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, nickname: true },
  });
  const ids = employees.map((e) => e.id);
  const [inPeriod, outstanding] = await Promise.all([
    prisma.cashAdvance.groupBy({
      by: ['employeeId'],
      where: {
        employeeId: { in: ids },
        deletedAt: null,
        status: 'Approved',
        approvedAt: { gte: utc(period.from), lt: new Date(utc(period.to).getTime() + 86_400_000) },
      },
      _sum: { amount: true },
    }),
    prisma.cashAdvance.groupBy({
      by: ['employeeId'],
      where: { employeeId: { in: ids }, deletedAt: null, status: 'Approved', isDeducted: false },
      _sum: { amount: true },
    }),
  ]);
  const inPeriodBy = new Map(inPeriod.map((g) => [g.employeeId, Number(g._sum.amount ?? 0)]));
  const outstandingBy = new Map(outstanding.map((g) => [g.employeeId, Number(g._sum.amount ?? 0)]));

  const rows: AdvanceReportRow[] = [];
  for (const e of employees) {
    const balance = await advanceBalanceFor(e.id);
    rows.push({
      employeeId: e.id,
      name: e.nickname?.trim() ? e.nickname : `${e.firstName} ${e.lastName}`.trim(),
      approvedInPeriod: inPeriodBy.get(e.id) ?? 0,
      outstandingNow: outstandingBy.get(e.id) ?? 0,
      availableNow: balance.available,
    });
  }
  return rows;
}

// ── 2) Attendance (late / early-leave minutes) ────────────────────────────
export type AttendanceReportRow = {
  employeeId: string;
  name: string;
  lateCount: number;
  lateMinutes: number;
  earlyCount: number;
  earlyMinutes: number;
  absentDays: number;
  otMinutes: number;
};

export async function attendanceReport(
  period: { from: string; to: string },
  filter: EmployeeFilter,
): Promise<AttendanceReportRow[]> {
  const employees = await prisma.employee.findMany({
    where: employeeWhere(filter),
    orderBy: [{ firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, nickname: true },
  });
  const ids = employees.map((e) => e.id);
  const dateRange = { gte: utc(period.from), lte: utc(period.to) };
  const [att, ot] = await Promise.all([
    prisma.attendance.groupBy({
      by: ['employeeId', 'type'],
      where: {
        employeeId: { in: ids },
        deletedAt: null,
        type: { in: ['Late', 'EarlyLeave', 'Absent'] },
        date: dateRange,
      },
      _count: { _all: true },
      _sum: { durationMinutes: true },
    }),
    prisma.overtimeEntry.groupBy({
      by: ['employeeId'],
      where: { employeeId: { in: ids }, deletedAt: null, status: 'Approved', date: dateRange },
      _sum: { minutes: true },
    }),
  ]);
  const otBy = new Map(ot.map((g) => [g.employeeId, g._sum.minutes ?? 0]));
  const attBy = new Map<string, AttendanceReportRow>();
  for (const e of employees) {
    attBy.set(e.id, {
      employeeId: e.id,
      name: e.nickname?.trim() ? e.nickname : `${e.firstName} ${e.lastName}`.trim(),
      lateCount: 0,
      lateMinutes: 0,
      earlyCount: 0,
      earlyMinutes: 0,
      absentDays: 0,
      otMinutes: otBy.get(e.id) ?? 0,
    });
  }
  for (const g of att) {
    const row = attBy.get(g.employeeId);
    if (!row) continue;
    if (g.type === 'Late') {
      row.lateCount = g._count._all;
      row.lateMinutes = g._sum.durationMinutes ?? 0;
    } else if (g.type === 'EarlyLeave') {
      row.earlyCount = g._count._all;
      row.earlyMinutes = g._sum.durationMinutes ?? 0;
    } else if (g.type === 'Absent') {
      row.absentDays = g._count._all;
    }
  }
  return [...attBy.values()];
}

// ── 3) Leave by type ─────────────────────────────────────────────────────
export type LeaveReportCell = {
  usedMinutes: number;
  overQuotaMinutes: number;
  deductAmount: number;
};
export type LeaveReportRow = {
  employeeId: string;
  name: string;
  /** leaveTypeId → cell (in-period usage of Approved requests) */
  byType: Record<string, LeaveReportCell>;
  /** leaveTypeId → annual remaining minutes (null = unlimited) */
  remainingByType: Record<string, number | null>;
};

export async function leaveReport(
  period: { from: string; to: string },
  filter: EmployeeFilter,
  year: number,
): Promise<{ types: Array<{ id: string; name: string }>; rows: LeaveReportRow[] }> {
  const [types, employees] = await Promise.all([
    prisma.leaveType.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.employee.findMany({
      where: employeeWhere(filter),
      orderBy: [{ firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, nickname: true },
    }),
  ]);
  const ids = employees.map((e) => e.id);
  const grouped = await prisma.leaveRequest.groupBy({
    by: ['employeeId', 'leaveTypeId'],
    where: {
      employeeId: { in: ids },
      status: 'Approved',
      deletedAt: null,
      startDate: { gte: utc(period.from), lte: utc(period.to) },
    },
    _sum: { chargedMinutes: true, overQuotaMinutes: true, deductAmount: true },
  });
  const cellBy = new Map<string, LeaveReportCell>();
  for (const g of grouped) {
    cellBy.set(`${g.employeeId}:${g.leaveTypeId}`, {
      usedMinutes: g._sum.chargedMinutes ?? 0,
      overQuotaMinutes: g._sum.overQuotaMinutes ?? 0,
      deductAmount: Number(g._sum.deductAmount ?? 0),
    });
  }
  const rows: LeaveReportRow[] = [];
  for (const e of employees) {
    const remaining = await remainingByTypeForEmployee(e.id, year);
    const byType: Record<string, LeaveReportCell> = {};
    for (const t of types) {
      byType[t.id] = cellBy.get(`${e.id}:${t.id}`) ?? {
        usedMinutes: 0,
        overQuotaMinutes: 0,
        deductAmount: 0,
      };
    }
    rows.push({
      employeeId: e.id,
      name: e.nickname?.trim() ? e.nickname : `${e.firstName} ${e.lastName}`.trim(),
      byType,
      remainingByType: remaining,
    });
  }
  return { types, rows };
}
```

Performance note (acceptable, document in the file header if desired): `advanceBalanceFor`/`remainingByTypeForEmployee` run per-employee (N+1). Headcount here is tens, not thousands; revisit with a batched query only if a report page measures slow.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`

```bash
git add src/lib/reports
git commit -m "feat(reports): advance/attendance/leave aggregation queries"
```

---

### Task 11: Admin report pages + nav + permission

**Files:**
- Modify: `src/lib/auth/permissions.ts`, `src/lib/auth/roles.ts`
- Modify: `src/components/admin/sidebar.tsx`
- Create: `src/app/(admin)/admin/reports/page.tsx`, `reports/period-picker.tsx`, `reports/advance/page.tsx`, `reports/attendance/page.tsx`, `reports/leave/page.tsx`

- [ ] **Step 1: Permission**

`permissions.ts`: add under a new section before LIFF:

```ts
  // ─── Reports ─────────────────────────────────────────────────────────
  'report.read': 'ดูรายงานสรุป',
```

Add to `PERMISSION_GROUPS` (new group `{ key: 'report', label: 'รายงาน', permissions: ['report.read'] }` before `misc`). In `src/lib/auth/roles.ts`, add `'report.read'` to every default role that has `'dashboard.read'` (read the file; mirror placement).

- [ ] **Step 2: Sidebar**

In `SECTIONS` "เมนูหลัก", after the attendance item:

```ts
      { href: '/admin/reports', label: 'รายงาน', Icon: BarChart3, enabled: true },
```

Add `BarChart3` to the lucide import.

- [ ] **Step 3: Shared period picker (client component)**

```tsx
// src/app/(admin)/admin/reports/period-picker.tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { adjacentMonths } from '@/lib/reports/period';

/** Month nav (← มิ.ย. 2569 →) + custom from–to. Admin UI: Thai, Buddhist year. */
export function PeriodPicker({ month, from, to }: { month: string | null; from: string; to: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();

  function withParams(next: Record<string, string | null>): string {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    return `${pathname}?${p.toString()}`;
  }

  const current = month ?? from.slice(0, 7);
  const { prev, next } = adjacentMonths(current);
  const [y, m] = current.split('-').map(Number);
  const monthLabel = `${new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('th-TH', {
    month: 'short',
    timeZone: 'UTC',
  })} ${y + 543}`;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1 py-1">
        <Link href={withParams({ m: prev, from: null, to: null })} className="rounded px-2 py-1 text-sm hover:bg-gray-50" aria-label="เดือนก่อนหน้า">←</Link>
        <span className="min-w-24 px-2 text-center text-sm font-medium">{month ? monthLabel : 'กำหนดเอง'}</span>
        <Link href={withParams({ m: next, from: null, to: null })} className="rounded px-2 py-1 text-sm hover:bg-gray-50" aria-label="เดือนถัดไป">→</Link>
      </div>
      <form
        className="flex items-center gap-2"
        action={(fd: FormData) => {
          router.push(withParams({ from: String(fd.get('from')), to: String(fd.get('to')), m: null }));
        }}
      >
        <input type="date" name="from" defaultValue={from} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <span className="text-sm text-gray-400">–</span>
        <input type="date" name="to" defaultValue={to} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <button type="submit" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">ดูช่วงนี้</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Index page** — tab-style links to the three reports:

```tsx
// src/app/(admin)/admin/reports/page.tsx
import { redirect } from 'next/navigation';

export default function ReportsIndexPage() {
  redirect('/admin/reports/attendance');
}
```

Each report page renders the shared tab strip; to avoid duplication create the layout once:

```tsx
// src/app/(admin)/admin/reports/layout.tsx
import Link from 'next/link';
import { requirePermission } from '@/lib/auth/check-permission';

const TABS = [
  { href: '/admin/reports/attendance', label: 'ลงเวลา' },
  { href: '/admin/reports/leave', label: 'วันลา' },
  { href: '/admin/reports/advance', label: 'เบิกเงิน' },
];

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requirePermission('report.read');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">รายงาน</h1>
      <nav className="flex gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
```

(Check how `requirePermission` behaves on failure — if it returns an error object instead of throwing/redirecting, mirror the handling used by an existing admin page such as `/admin/leave/page.tsx`. Active-tab styling via a small client component is optional polish — plain links are acceptable.)

- [ ] **Step 5: Attendance report page**

```tsx
// src/app/(admin)/admin/reports/attendance/page.tsx
import { resolveReportPeriod } from '@/lib/reports/period';
import { attendanceReport } from '@/lib/reports/queries';
import { PeriodPicker } from '../period-picker';

export default async function AttendanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; from?: string; to?: string; q?: string }>;
}) {
  const params = await searchParams;
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const period = resolveReportPeriod(params, todayYmd);
  const rows = await attendanceReport(period, { q: params.q });

  const totals = rows.reduce(
    (a, r) => ({
      lateMinutes: a.lateMinutes + r.lateMinutes,
      earlyMinutes: a.earlyMinutes + r.earlyMinutes,
      absentDays: a.absentDays + r.absentDays,
      otMinutes: a.otMinutes + r.otMinutes,
    }),
    { lateMinutes: 0, earlyMinutes: 0, absentDays: 0, otMinutes: 0 },
  );

  return (
    <div className="space-y-4">
      <PeriodPicker month={period.month} from={period.from} to={period.to} />
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2.5">พนักงาน</th>
              <th className="px-4 py-2.5 text-right">มาสาย (ครั้ง)</th>
              <th className="px-4 py-2.5 text-right">สาย (นาที)</th>
              <th className="px-4 py-2.5 text-right">ออกก่อน (ครั้ง)</th>
              <th className="px-4 py-2.5 text-right">ออกก่อน (นาที)</th>
              <th className="px-4 py-2.5 text-right">ขาดงาน (วัน)</th>
              <th className="px-4 py-2.5 text-right">OT (นาที)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.employeeId} className="hover:bg-gray-50">
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5 text-right">{r.lateCount}</td>
                <td className="px-4 py-2.5 text-right">{r.lateMinutes.toLocaleString('th-TH')}</td>
                <td className="px-4 py-2.5 text-right">{r.earlyCount}</td>
                <td className="px-4 py-2.5 text-right">{r.earlyMinutes.toLocaleString('th-TH')}</td>
                <td className="px-4 py-2.5 text-right">{r.absentDays}</td>
                <td className="px-4 py-2.5 text-right">{r.otMinutes.toLocaleString('th-TH')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 text-xs font-medium">
            <tr>
              <td className="px-4 py-2.5">รวม {rows.length} คน</td>
              <td />
              <td className="px-4 py-2.5 text-right">{totals.lateMinutes.toLocaleString('th-TH')}</td>
              <td />
              <td className="px-4 py-2.5 text-right">{totals.earlyMinutes.toLocaleString('th-TH')}</td>
              <td className="px-4 py-2.5 text-right">{totals.absentDays}</td>
              <td className="px-4 py-2.5 text-right">{totals.otMinutes.toLocaleString('th-TH')}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
```

(If the repo has an `EmptyState` component, render it when `rows.length === 0` instead of the bare table — check `grep -rn "EmptyState" src/components | head -1` for the import path. Branch/department filter selects can be added with the same `withParams` URL pattern; keep V1 to the name-search `q` input if time-boxed — but then note the omission in the PR description.)

- [ ] **Step 6: Advance report page** — same skeleton, columns: พนักงาน / เบิกอนุมัติในช่วง / ค้างหัก / วงเงินคงเหลือ, using `advanceReport`. Money cells: `฿{n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`; `availableNow == null` renders `—`. Footer totals for the two sum columns.

- [ ] **Step 7: Leave report page** — uses `leaveReport(period, filter, year)` where `year = Number((params.m ?? todayYmd).slice(0, 4))`. Render: first column พนักงาน, then per leave type a column group "ใช้ไป / คงเหลือ" formatted with `formatDaysHours(minutes, cfg)` (fetch `getLeaveConfig()` in the page); over-quota cells get an amber badge `เกิน {formatDaysHours(over, cfg)} (฿{deduct})`. Add the caption: `* "ใช้ไป" นับเฉพาะช่วงเวลาที่เลือก — "คงเหลือ" เป็นสิทธิคงเหลือของทั้งปี {year + 543}`.

- [ ] **Step 8: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm dev` → visit `/admin/reports/{attendance,leave,advance}` with seeded data; check month nav and custom range both work.

```bash
git add src/lib/auth src/components/admin/sidebar.tsx "src/app/(admin)/admin/reports"
git commit -m "feat(admin): reports section — attendance, leave, advance"
```

---

### Task 12: Worker summary page — `/liff/summary`

**Files:**
- Create: `src/app/(liff)/liff/summary/page.tsx`
- Modify: LIFF home/nav (find it: `grep -rn "liff/leave" "src/app/(liff)/liff/page.tsx" src/components 2>/dev/null | head -5` — add a card/link wherever leave/advance entries live)
- Modify: `messages/*.json` (summary section, 6 locales)

- [ ] **Step 1: Page**

```tsx
// src/app/(liff)/liff/summary/page.tsx
/** /liff/summary — "สรุปของฉัน": this month's lateness, annual leave balances
 *  (with over-quota deductions), advance balance. Month nav via ?m=YYYY-MM. */

import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { advanceBalanceFor } from '@/lib/advance/available';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { formatMoney } from '@/lib/i18n/format';
import { remainingByTypeForEmployee } from '@/lib/leave/balance';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { resolveLeaveTypeName } from '@/lib/leave/localized-name';
import { formatDurationParts, splitDaysHours } from '@/lib/leave/units';
import { adjacentMonths, resolveReportPeriod } from '@/lib/reports/period';

export default async function LiffSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { employee } = await requireRole(['Staff']);
  if (!employee) throw new Error('requireRole did not return Employee');
  const params = await searchParams;
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const period = resolveReportPeriod({ m: params.m }, todayYmd);
  const month = period.month ?? todayYmd.slice(0, 7);
  const year = Number(month.slice(0, 4));
  const utc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

  const [t, tUnits, locale, cfg, att, types, remaining, usedAgg, balance] = await Promise.all([
    getTranslations('summary'),
    getTranslations('units'),
    getLocale(),
    getLeaveConfig(),
    prisma.attendance.groupBy({
      by: ['type'],
      where: {
        employeeId: employee.id,
        deletedAt: null,
        type: { in: ['Late', 'EarlyLeave', 'Absent'] },
        date: { gte: utc(period.from), lte: utc(period.to) },
      },
      _count: { _all: true },
      _sum: { durationMinutes: true },
    }),
    prisma.leaveType.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, nameByLocale: true },
    }),
    remainingByTypeForEmployee(employee.id, year),
    prisma.leaveRequest.groupBy({
      by: ['leaveTypeId'],
      where: {
        employeeId: employee.id,
        status: 'Approved',
        deletedAt: null,
        startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      _sum: { chargedMinutes: true, deductAmount: true },
    }),
    advanceBalanceFor(employee.id),
  ]);

  const fmtDur = (minutes: number) =>
    formatDurationParts(splitDaysHours(minutes, cfg), {
      day: (n) => tUnits('day', { n }),
      hour: (n) => tUnits('hour', { n }),
      min: (n) => tUnits('min', { n }),
    });
  const attBy = new Map(att.map((g) => [g.type, g]));
  const usedBy = new Map(usedAgg.map((g) => [g.leaveTypeId, g]));
  const { prev, next } = adjacentMonths(month);
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(
    locale === 'th' ? 'th-TH' : locale,
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  );

  const cardCls = 'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm';
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 pt-8 pb-12">
      <h1 className="text-2xl font-semibold text-gray-900">{t('title')}</h1>

      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-2 py-1.5">
        <Link href={`/liff/summary?m=${prev}`} className="rounded px-3 py-1 text-sm hover:bg-gray-50" aria-label={t('prevMonth')}>←</Link>
        <span className="text-sm font-medium">{monthLabel}</span>
        <Link href={`/liff/summary?m=${next}`} className="rounded px-3 py-1 text-sm hover:bg-gray-50" aria-label={t('nextMonth')}>→</Link>
      </div>

      {/* Attendance this month */}
      <section className={cardCls}>
        <h2 className="text-sm font-semibold text-gray-900">{t('attendance.title')}</h2>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
          {(
            [
              ['Late', t('attendance.late')],
              ['EarlyLeave', t('attendance.early')],
              ['Absent', t('attendance.absent')],
            ] as const
          ).map(([type, label]) => {
            const g = attBy.get(type);
            return (
              <div key={type} className="rounded-lg bg-gray-50 p-3">
                <dt className="text-xs text-gray-500">{label}</dt>
                <dd className="mt-1 text-lg font-semibold text-gray-900">{g?._count._all ?? 0}</dd>
                {type !== 'Absent' && (
                  <dd className="text-[11px] text-gray-500">
                    {t('attendance.minutes', { n: g?._sum.durationMinutes ?? 0 })}
                  </dd>
                )}
              </div>
            );
          })}
        </dl>
      </section>

      {/* Leave balances (annual) */}
      <section className={cardCls}>
        <h2 className="text-sm font-semibold text-gray-900">{t('leave.title', { year })}</h2>
        <ul className="mt-3 divide-y divide-gray-100">
          {types.map((tp) => {
            const used = usedBy.get(tp.id);
            const rem = remaining[tp.id];
            const deduct = Number(used?._sum.deductAmount ?? 0);
            return (
              <li key={tp.id} className="flex items-baseline justify-between gap-2 py-2 text-sm">
                <span className="text-gray-700">{resolveLeaveTypeName(tp, locale)}</span>
                <span className="text-right">
                  <span className="text-gray-900">{fmtDur(used?._sum.chargedMinutes ?? 0)}</span>
                  <span className="block text-[11px] text-gray-500">
                    {rem == null ? t('leave.unlimited') : t('leave.remaining', { d: fmtDur(Math.max(0, rem)) })}
                  </span>
                  {deduct > 0 && (
                    <span className="block text-[11px] text-amber-700">
                      {t('leave.deducted', { amount: formatMoney(deduct, locale) })}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Advance balance */}
      <section className={cardCls}>
        <h2 className="text-sm font-semibold text-gray-900">{t('advance.title')}</h2>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">{t('advance.outstanding')}</dt>
            <dd className="text-gray-900">{formatMoney(balance.reserved, locale)}</dd>
          </div>
          {balance.kind === 'rate-based' && balance.earnings != null && (
            <div className="flex justify-between">
              <dt className="text-gray-500">{t('advance.earned')}</dt>
              <dd className="text-gray-900">{formatMoney(balance.earnings, locale)}</dd>
            </div>
          )}
          {(balance.kind === 'monthly' || balance.available != null) && (
            <div className="flex justify-between font-medium">
              <dt className="text-gray-700">{t('advance.available')}</dt>
              <dd className="text-gray-900">
                {formatMoney(balance.kind === 'monthly' ? balance.available : (balance.available ?? 0), locale)}
              </dd>
            </div>
          )}
        </dl>
      </section>
    </main>
  );
}
```

Check `resolveLeaveTypeName`'s actual signature in `src/lib/leave/localized-name.ts` and adapt the call (it may take `(name, nameByLocale, locale)`). Verify `formatMoney(value, locale)`'s exact signature in `src/lib/i18n/format.ts`.

- [ ] **Step 2: Link from LIFF home**

Find the LIFF home menu (`src/app/(liff)/liff/page.tsx` or equivalent) and add a "สรุปของฉัน" entry pointing at `/liff/summary`, copying the structure of the leave/advance entries exactly (icon, card, translation key `summary.title`).

- [ ] **Step 3: i18n `summary` section (all 6 files)**

th:
```json
"summary": {
  "title": "สรุปของฉัน",
  "prevMonth": "เดือนก่อนหน้า",
  "nextMonth": "เดือนถัดไป",
  "attendance": { "title": "การลงเวลาเดือนนี้", "late": "มาสาย", "early": "ออกก่อน", "absent": "ขาดงาน", "minutes": "{n} นาที" },
  "leave": { "title": "วันลาปี {year}", "remaining": "คงเหลือ {d}", "unlimited": "ไม่จำกัด", "deducted": "หักเงิน {amount}" },
  "advance": { "title": "เบิกเงิน", "outstanding": "ยอดค้างหัก", "earned": "รายได้รอบนี้", "available": "เบิกได้อีก" }
}
```
en:
```json
"summary": {
  "title": "My summary",
  "prevMonth": "Previous month",
  "nextMonth": "Next month",
  "attendance": { "title": "This month's attendance", "late": "Late", "early": "Left early", "absent": "Absent", "minutes": "{n} min" },
  "leave": { "title": "Leave {year}", "remaining": "{d} left", "unlimited": "Unlimited", "deducted": "{amount} deducted" },
  "advance": { "title": "Advances", "outstanding": "Outstanding", "earned": "Earned this period", "available": "Available" }
}
```
my:
```json
"summary": {
  "title": "ကျွန်ုပ်၏ အကျဉ်းချုပ်",
  "prevMonth": "ယခင်လ",
  "nextMonth": "နောက်လ",
  "attendance": { "title": "ယခုလ အချိန်မှတ်တမ်း", "late": "နောက်ကျ", "early": "စောထွက်", "absent": "ပျက်ကွက်", "minutes": "{n} မိနစ်" },
  "leave": { "title": "ခွင့် {year}", "remaining": "ကျန် {d}", "unlimited": "ကန့်သတ်မရှိ", "deducted": "{amount} ဖြတ်တောက်" },
  "advance": { "title": "ကြိုတင်ထုတ်ငွေ", "outstanding": "ကျန်ရှိ ဖြတ်တောက်ရန်", "earned": "ဤကာလ ဝင်ငွေ", "available": "ထုတ်ယူနိုင်သေး" }
}
```
lo:
```json
"summary": {
  "title": "ສະຫຼຸບຂອງຂ້ອຍ",
  "prevMonth": "ເດືອນກ່ອນ",
  "nextMonth": "ເດືອນຕໍ່ໄປ",
  "attendance": { "title": "ການລົງເວລາເດືອນນີ້", "late": "ມາຊ້າ", "early": "ອອກກ່ອນ", "absent": "ຂາດວຽກ", "minutes": "{n} ນາທີ" },
  "leave": { "title": "ວັນລາພັກ {year}", "remaining": "ເຫຼືອ {d}", "unlimited": "ບໍ່ຈຳກັດ", "deducted": "ຫັກເງິນ {amount}" },
  "advance": { "title": "ເບີກເງິນ", "outstanding": "ຍອດຄ້າງຫັກ", "earned": "ລາຍຮັບຮອບນີ້", "available": "ເບີກໄດ້ອີກ" }
}
```
zh-CN:
```json
"summary": {
  "title": "我的汇总",
  "prevMonth": "上个月",
  "nextMonth": "下个月",
  "attendance": { "title": "本月考勤", "late": "迟到", "early": "早退", "absent": "缺勤", "minutes": "{n} 分钟" },
  "leave": { "title": "{year} 年请假", "remaining": "剩余 {d}", "unlimited": "不限", "deducted": "扣款 {amount}" },
  "advance": { "title": "借支", "outstanding": "待扣款", "earned": "本期收入", "available": "可借支" }
}
```
km:
```json
"summary": {
  "title": "សង្ខេបរបស់ខ្ញុំ",
  "prevMonth": "ខែមុន",
  "nextMonth": "ខែបន្ទាប់",
  "attendance": { "title": "វត្តមានខែនេះ", "late": "មកយឺត", "early": "ចេញមុន", "absent": "អវត្តមាន", "minutes": "{n} នាទី" },
  "leave": { "title": "ច្បាប់ឈប់ {year}", "remaining": "នៅសល់ {d}", "unlimited": "គ្មានកំណត់", "deducted": "កាត់ប្រាក់ {amount}" },
  "advance": { "title": "បើកប្រាក់មុន", "outstanding": "នៅជំពាក់", "earned": "ចំណូលរយៈពេលនេះ", "available": "អាចបើកបាន" }
}
```

(AI drafts pending native review, consistent with the rest of those files. Thai display of `{year}` shows the CE year — acceptable; if the page should show Buddhist year for th, compute the label server-side instead of passing raw `year` and add 543 for th only, following `/src/lib/i18n/format.ts` conventions.)

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint`; `pnpm dev` → open `/liff/summary` (use the E2E auth helper or a paired test user).

```bash
git add "src/app/(liff)/liff" messages
git commit -m "feat(liff): personal summary page (attendance, leave, advances)"
```

---

### Task 13: Full verification pass

- [ ] **Step 1: Full test suite** — `pnpm test` → all pass.
- [ ] **Step 2: Typecheck + lint** — `pnpm typecheck && pnpm lint` → clean.
- [ ] **Step 3: E2E smoke (existing suite)** — `pnpm test:e2e` (remember the suite gotchas: a stale app on port 3000 makes tests hit the wrong build; 4 deferred skips are expected). Fix any breakage the schema/UI changes caused in existing specs.
- [ ] **Step 4: Manual walkthrough** — with seeded data: (a) worker submits over-quota DeductPay leave → warning with ฿ amount → admin approves → `LeaveRequest.overQuotaMinutes/deductAmount` set (check Prisma Studio); (b) over-quota Block leave → admin approve button disabled, server action returns `over-quota-block` if forced; (c) advance over cap → admin approve blocked; (d) all three report pages + `/liff/summary` render.
- [ ] **Step 5: Commit any fixes; do NOT push or merge** — integration follows the superpowers:finishing-a-development-branch flow.

---

## Self-review notes (already applied)

- Spec coverage: §1 migration → Task 1; §2 leave enforcement → Tasks 2/4/5/6/7; §2 advance → Tasks 3/8; §2 payroll → Task 9 (scoped: pure calc + data contract only, because no payroll pipeline exists — the sweep contract is documented in calc.ts); §3 reports → Tasks 10/11; §4 worker summary → Task 12; §5 edge cases → encoded in the pure-function tests (Task 2/3/10); §6 testing → per-task TDD + Task 13.
- Deviation from spec: `Payroll.deductLeave` exists and `calcPayroll` computes it, but no production code writes Payroll rows yet — the deduction *sweep* activates when the payroll pipeline lands. `LeaveRequest.deductAmount` + reports still deliver the admin-visible numbers now.
- Type consistency: `overQuotaMinutesFor/deductionForOverQuota/perMinuteRate` names match across Tasks 2/4/6; `advanceBalanceFor(employeeId, excludeAdvanceId?)` matches across Tasks 3/8/10/12; `resolveReportPeriod/adjacentMonths` across Tasks 10/11/12.
