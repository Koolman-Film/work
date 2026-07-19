# Penalty Settled With Leave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin decide, per incident, that an attendance penalty is paid with the employee's leave entitlement instead of money.

**Architecture:** The admin's decision is stored as its own row (`AttendancePenaltySettlement`). Payroll and the leave balance both **read** it — neither writes it. Because the payroll calculation writes nothing, recalculating any number of times can never double-charge; that safety comes from the shape of the data flow, not from guards someone has to remember.

**Tech Stack:** Next.js 16 App Router, Prisma/Postgres (Supabase), decimal.js, Vitest (**node environment — no jsdom, no testing-library**), Biome, Zod, next-intl.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-19-penalty-settled-with-leave-design.md` — read it before Task 1.
- **Branch:** `feat/penalty-settled-with-leave` (already created, spec already committed).
- **Never `git add -A`** — this repo contains untracked local artifacts. Stage explicit paths only.
- **Migrations are hand-authored**, numbered `NNNN_snake_case` under `prisma/migrations/`. Do **not** run `prisma migrate dev --create-only` — it emits spurious `DROP DEFAULT` statements in this repo.
- **Money math uses `decimal.js`**, never JS floats. Leave math uses **integer minutes**.
- **`calc.ts` must stay pure** — it takes an input object and returns a result. It must never query the database.
- **No row is ever written to `AttendancePenaltySettlement` by payroll calculation or by `run.ts`.** Only explicit admin actions write it. A reviewer should reject any task that violates this.
- **Permissions:** settlement writes require `payroll.run`; the `LeaveType` flag requires `settings.leave-type.manage`.
- Three penalty kinds only: `Absent`, `LateThreeStrike`, `SevereLate`. The flat `lateDeduction` mode (used when `lateThreeStrikeEnabled` is false) is a per-occurrence fine, **not** a "1 day" unit, and is out of scope.
- Thai is the admin UI language — all admin-facing copy in this feature is Thai.
- Test commands: `npm test` (unit), `npm run test:integration`, `npm run typecheck`, `npm run lint`.

---

## File Structure

**Create**
| File | Responsibility |
|---|---|
| `src/lib/payroll/penalty-settlement.ts` | Pure: `SettlementDays`, `EMPTY_SETTLEMENT`, `moneyDaysFor` |
| `src/lib/payroll/penalty-settlement.test.ts` | Unit tests for the above |
| `src/lib/payroll/penalty-settlement-load.ts` | IO: load a month's settlements for `run.ts` |
| `src/lib/payroll/penalty-settlement-admin.ts` | Server actions that write settlements, with all guards |
| `src/lib/leave/penalty-minutes.ts` | IO: penalty minutes per (employee, type, year), single + bulk |
| `prisma/migrations/0039_penalty_settlement/migration.sql` | Hand-authored migration |

**Modify**
| File | Change |
|---|---|
| `prisma/schema.prisma` | `PenaltyKind` enum, `AttendancePenaltySettlement` model, `LeaveType.penaltySettlementAllowed` |
| `src/lib/payroll/calc.ts:136-160, 421-427` | `CalcInput.penaltySettlement?`, use `moneyDaysFor`, extend breakdown |
| `src/lib/payroll/run.ts` | Load settlements, pass into each `CalcInput` |
| `src/lib/leave/balance.ts:17-20, 119-131, 194-206, 231-243` | `remainingMinutes` 3rd **required** param; all call sites |
| `src/lib/leave/admin.ts:282` | Pass penalty minutes |
| `src/lib/leave/approval-preview.ts:46` | Pass penalty minutes |
| `src/lib/payslip/document.ts` | Show "หักจากสิทธิ<ประเภท>" when settled |
| `src/app/(admin)/admin/settings/leave-types/{leave-type-form.tsx,actions.ts}` | Checkbox for the flag |
| `src/app/(admin)/admin/attendance/manual/manual-form.tsx` | Money/leave choice on absences |
| `src/app/(admin)/admin/payroll/reconcile/reconcile-rows.tsx` | Settlement editor + over-settlement flag |

---

## Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0039_penalty_settlement/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model `AttendancePenaltySettlement`, enum `PenaltyKind` (`Absent | LateThreeStrike | SevereLate`), field `LeaveType.penaltySettlementAllowed: boolean`.

- [ ] **Step 1: Add the enum and model to the schema**

Add near the other enums in `prisma/schema.prisma`:

```prisma
enum PenaltyKind {
  Absent
  LateThreeStrike
  SevereLate
}
```

Add the model (place it directly after `model Payroll`):

```prisma
/// One admin decision: "this month's <kind> penalty for this employee is paid
/// with leave entitlement, not money."
///
/// No row = paid entirely with money = the behaviour that existed before this
/// feature. Payroll calculation READS this table and never writes it, which is
/// what makes recalculating safe: a calculation that wrote entitlement would
/// consume a day of leave on every run, silently.
///
/// `days` and `minutes` describe the same penalty in two units and are BOTH
/// frozen when the admin decides. `minutes = days * standardDayMinutes` is
/// computed once, at write time, from the LeaveConfig in force then — never
/// re-derived on read, so editing LeaveConfig later cannot retroactively change
/// a settled penalty. The money side reads `days`; the leave side reads
/// `minutes`; neither is ever computed from the other.
model AttendancePenaltySettlement {
  id          String      @id @default(uuid()) @db.Uuid
  employeeId  String      @db.Uuid
  employee    Employee    @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  /// Pay-period month "YYYY-MM" — the same label as Payroll.month.
  month       String
  kind        PenaltyKind
  leaveTypeId String      @db.Uuid
  leaveType   LeaveType   @relation(fields: [leaveTypeId], references: [id], onDelete: Restrict)
  /// Whole days withheld from the money penalty. Decimal to match the payroll
  /// module's money types, not to allow fractional days.
  days        Decimal     @db.Decimal(5, 2)
  /// Minutes charged against the leave entitlement.
  minutes     Int
  /// Leave year charged = calendar year of `month`'s label. Stored, never
  /// re-derived, so a period spanning a year boundary can't be bucketed two
  /// different ways by two different readers.
  periodYear  Int
  note        String?
  createdById String?     @db.Uuid
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  deletedAt   DateTime?

  @@unique([employeeId, month, kind])
  @@index([employeeId, periodYear, leaveTypeId])
  @@index([month])
  @@index([deletedAt])
}
```

- [ ] **Step 2: Add the back-relations and the LeaveType flag**

In `model Employee`, add:

```prisma
  penaltySettlements AttendancePenaltySettlement[]
```

In `model LeaveType`, add the back-relation and the flag:

```prisma
  penaltySettlements AttendancePenaltySettlement[]

  /// May this leave type be spent to pay an attendance penalty?
  ///
  /// Defaults to false so a leave type added later is excluded until an admin
  /// opts it in. Forgetting to enable a type is a visible inconvenience an
  /// admin fixes in seconds; forgetting to disable one means the system can
  /// consume an employee's sick or maternity leave as a punishment. The two
  /// mistakes do not cost the same, so the default protects against the worse
  /// one. Seeded true for ลากิจ and ลาพักร้อน only.
  penaltySettlementAllowed Boolean @default(false)
```

- [ ] **Step 3: Hand-author the migration**

Create `prisma/migrations/0039_penalty_settlement/migration.sql`:

```sql
-- Attendance penalties may be settled with leave entitlement instead of money.

CREATE TYPE "PenaltyKind" AS ENUM ('Absent', 'LateThreeStrike', 'SevereLate');

CREATE TABLE "AttendancePenaltySettlement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "kind" "PenaltyKind" NOT NULL,
    "leaveTypeId" UUID NOT NULL,
    "days" DECIMAL(5,2) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "AttendancePenaltySettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendancePenaltySettlement_employeeId_month_kind_key"
    ON "AttendancePenaltySettlement" ("employeeId", "month", "kind");
CREATE INDEX "AttendancePenaltySettlement_employeeId_periodYear_leaveTypeId_idx"
    ON "AttendancePenaltySettlement" ("employeeId", "periodYear", "leaveTypeId");
CREATE INDEX "AttendancePenaltySettlement_month_idx"
    ON "AttendancePenaltySettlement" ("month");
CREATE INDEX "AttendancePenaltySettlement_deletedAt_idx"
    ON "AttendancePenaltySettlement" ("deletedAt");

ALTER TABLE "AttendancePenaltySettlement"
    ADD CONSTRAINT "AttendancePenaltySettlement_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendancePenaltySettlement"
    ADD CONSTRAINT "AttendancePenaltySettlement_leaveTypeId_fkey"
    FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Which leave types may be spent on a penalty. Default false; only the two
-- discretionary types are opted in. Sick and maternity leave must never be
-- consumable as a punishment.
ALTER TABLE "LeaveType"
    ADD COLUMN "penaltySettlementAllowed" BOOLEAN NOT NULL DEFAULT false;

UPDATE "LeaveType" SET "penaltySettlementAllowed" = true
    WHERE "name" IN ('ลากิจ', 'ลาพักร้อน');
```

- [ ] **Step 4: Apply the migration and regenerate the client**

Run: `npm run db:deploy && npm run db:generate`
Expected: migration `0039_penalty_settlement` applied, Prisma Client regenerated with no errors.

- [ ] **Step 5: Verify the seed data landed**

Run:
```bash
dotenv -e .env.local -- npx prisma db execute --stdin <<'SQL'
SELECT name, "penaltySettlementAllowed" FROM "LeaveType" ORDER BY name;
SQL
```
Expected: `ลากิจ` and `ลาพักร้อน` are `true`; `ลาป่วย` and `ลาคลอด` are `false`.

- [ ] **Step 6: Confirm nothing regressed**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all existing tests pass (baseline 1,374 unit).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0039_penalty_settlement/migration.sql
git commit -m "feat(payroll,leave): schema for settling attendance penalties with leave"
```

---

## Task 2: The money-offset function

**Files:**
- Create: `src/lib/payroll/penalty-settlement.ts`
- Test: `src/lib/payroll/penalty-settlement.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports beyond types).
- Produces:
  - `type PenaltyKindKey = 'Absent' | 'LateThreeStrike' | 'SevereLate'`
  - `type SettlementDays = Record<PenaltyKindKey, number>`
  - `const EMPTY_SETTLEMENT: SettlementDays`
  - `function moneyDaysFor(actualDays: number, settledDays: number): number`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/payroll/penalty-settlement.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_SETTLEMENT, moneyDaysFor } from './penalty-settlement';

describe('moneyDaysFor', () => {
  it('subtracts the settled days from the actual days', () => {
    expect(moneyDaysFor(3, 1)).toBe(2);
  });

  it('returns 0 when the whole penalty is settled with leave', () => {
    expect(moneyDaysFor(1, 1)).toBe(0);
  });

  it('never returns a negative day count when the penalty disappeared', () => {
    // An admin settles one absent day with leave, then voids the attendance
    // row. Without the clamp the caller multiplies -1 by the day rate and the
    // "penalty" pays the employee an extra day's wages.
    expect(moneyDaysFor(0, 1)).toBe(0);
    expect(moneyDaysFor(1, 3)).toBe(0);
  });

  it('is a no-op when nothing was settled', () => {
    expect(moneyDaysFor(2, 0)).toBe(2);
    expect(moneyDaysFor(0, 0)).toBe(0);
  });
});

describe('EMPTY_SETTLEMENT', () => {
  it('is zero for every penalty kind', () => {
    expect(EMPTY_SETTLEMENT).toEqual({ Absent: 0, LateThreeStrike: 0, SevereLate: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/payroll/penalty-settlement.test.ts`
Expected: FAIL — `Failed to resolve import "./penalty-settlement"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/payroll/penalty-settlement.ts`:

```ts
/**
 * How much of an attendance penalty is still owed in money after the part the
 * admin chose to settle with leave entitlement.
 *
 * Pure and DB-free on purpose: the payroll calculation must be able to run any
 * number of times without side effects, so the settlement reaches it as data.
 */

export type PenaltyKindKey = 'Absent' | 'LateThreeStrike' | 'SevereLate';

/** Days of each penalty kind settled with leave, for one employee in one month. */
export type SettlementDays = Record<PenaltyKindKey, number>;

/** No settlement at all — the pre-feature behaviour, and the default. */
export const EMPTY_SETTLEMENT: SettlementDays = {
  Absent: 0,
  LateThreeStrike: 0,
  SevereLate: 0,
};

/**
 * Days still charged as money.
 *
 * Clamped at zero because a settlement can outlive the penalty that justified
 * it: an admin settles an absence with leave, then voids the attendance row.
 * The subtraction alone would go negative, and callers multiply this by the
 * employee's daily rate — so a deleted absence would quietly become a bonus.
 * Callers surface the leftover settlement to the admin separately; this
 * function's job is to make sure the arithmetic can never pay anyone.
 */
export function moneyDaysFor(actualDays: number, settledDays: number): number {
  return Math.max(0, actualDays - settledDays);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/payroll/penalty-settlement.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payroll/penalty-settlement.ts src/lib/payroll/penalty-settlement.test.ts
git commit -m "feat(payroll): pure money-offset for penalties settled with leave"
```

---

## Task 3: Wire the offset into the payroll calculation

**Files:**
- Modify: `src/lib/payroll/calc.ts` (input type ~136-160; attendance block ~421-427; breakdown type ~178-190)
- Modify: `src/lib/payroll/run.ts`
- Create: `src/lib/payroll/penalty-settlement-load.ts`
- Test: `src/lib/payroll/calc.test.ts`

**Interfaces:**
- Consumes: `moneyDaysFor`, `SettlementDays`, `EMPTY_SETTLEMENT` from `./penalty-settlement`.
- Produces:
  - `CalcInput.penaltySettlement?: SettlementDays`
  - `CalcBreakdown.attendance.settledDays: SettlementDays`
  - `loadSettlementsForMonth(month: string): Promise<Map<string, SettlementDays>>` (key = employeeId)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/payroll/calc.test.ts`. Follow the existing fixture helpers in that file for building a `CalcInput`; the assertions below are the new behaviour:

```ts
describe('penalties settled with leave', () => {
  it('charges no money for an absence settled with leave', () => {
    // Monthly ฿30,000 with workingDaysPerMonth 30 → ฿1,000/day.
    const base = calcInputWith({ absentDays: 1, baseSalary: '30000' });
    expect(calcPayroll(base).value.deductAttendance.toString()).toBe('1000');

    const settled = calcPayroll({
      ...base,
      penaltySettlement: { Absent: 1, LateThreeStrike: 0, SevereLate: 0 },
    });
    expect(settled.value.deductAttendance.toString()).toBe('0');
  });

  it('charges only the unsettled days', () => {
    const r = calcPayroll({
      ...calcInputWith({ absentDays: 3, baseSalary: '30000' }),
      penaltySettlement: { Absent: 1, LateThreeStrike: 0, SevereLate: 0 },
    });
    expect(r.value.deductAttendance.toString()).toBe('2000');
  });

  it('never pays the employee when the settlement outlives the penalty', () => {
    const r = calcPayroll({
      ...calcInputWith({ absentDays: 0, baseSalary: '30000' }),
      penaltySettlement: { Absent: 1, LateThreeStrike: 0, SevereLate: 0 },
    });
    expect(r.value.deductAttendance.toString()).toBe('0');
  });

  it('behaves exactly as before when no settlement is supplied', () => {
    const base = calcInputWith({ absentDays: 2, baseSalary: '30000' });
    expect(calcPayroll(base).value.deductAttendance.toString()).toBe('2000');
  });

  it('reports the settled days in the breakdown so the slip can explain itself', () => {
    const r = calcPayroll({
      ...calcInputWith({ absentDays: 1, baseSalary: '30000' }),
      penaltySettlement: { Absent: 1, LateThreeStrike: 0, SevereLate: 0 },
    });
    expect(r.value.breakdown.attendance.settledDays.Absent).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/payroll/calc.test.ts`
Expected: FAIL — `penaltySettlement` is not a known property of `CalcInput`.

- [ ] **Step 3: Extend the input and breakdown types**

In `src/lib/payroll/calc.ts`, add the import:

```ts
import { EMPTY_SETTLEMENT, moneyDaysFor, type SettlementDays } from './penalty-settlement';
```

Add to `CalcInput` (after `leaveDates`):

```ts
  /**
   * Days of each penalty kind the admin chose to settle with leave instead of
   * money. Omit → nothing settled, which is the pre-feature behaviour and the
   * state of almost every employee. Optional deliberately: "absent" here is the
   * normal case with a correct default, unlike remainingMinutes' penalty
   * argument, where a forgotten value would silently overstate a balance.
   */
  penaltySettlement?: SettlementDays;
```

Add to `CalcBreakdown.attendance`:

```ts
    /** Days of each kind paid with leave rather than money. */
    settledDays: SettlementDays;
```

- [ ] **Step 4: Use the offset in the attendance block**

In `src/lib/payroll/calc.ts`, replace the three day-count multiplications. The `dayAmount` line stays unchanged:

```ts
  const settled = input.penaltySettlement ?? EMPTY_SETTLEMENT;
  const absentMoneyDays = moneyDaysFor(absentCount, settled.Absent);
  const strikeMoneyDays = moneyDaysFor(latePenalty.threeStrikeDays, settled.LateThreeStrike);
  const severeMoneyDays = moneyDaysFor(latePenalty.severeDays, settled.SevereLate);

  // Tier-1 lates: the N-strikes rule charges a 1-day amount per completed group;
  // when the rule is off, fall back to the legacy flat per-late charge. The flat
  // charge is per occurrence, not a "1 day" unit, so it is never settleable.
  const tier1LateMoney = latePolicy.threeStrikeEnabled
    ? new Decimal(strikeMoneyDays).times(dayAmount)
    : new Decimal(latePenalty.tier1Count).times(toDec(cfg.lateDeduction));
  const severeLateMoney = new Decimal(severeMoneyDays).times(dayAmount);
  const earlyLeaveMoney = toDec(cfg.earlyLeaveDeduction).times(earlyLeaveCount);

  const deductAttendance = dayAmount
    .times(absentMoneyDays)
    .plus(tier1LateMoney)
    .plus(severeLateMoney)
    .plus(earlyLeaveMoney)
    .toDecimalPlaces(2);
```

Then set `settledDays: settled` inside the `attendance` breakdown object.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/lib/payroll/calc.test.ts`
Expected: PASS — the 5 new tests and every pre-existing test in the file.

If a pre-existing test now fails, **stop and report it** rather than editing its expected numbers. A changed number in an existing payroll test means this change did something it was not supposed to do.

- [ ] **Step 6: Write the settlement loader**

Create `src/lib/payroll/penalty-settlement-load.ts`:

```ts
/**
 * Reads the month's settlements for run.ts. Separate from penalty-settlement.ts
 * so that module stays pure and trivially testable.
 */

import { prisma } from '@/lib/db/prisma';
import { EMPTY_SETTLEMENT, type SettlementDays } from './penalty-settlement';

/**
 * employeeId → what this month's penalties were settled with.
 *
 * `days` feeds the calculation, which is numeric and must stay so. The leave
 * type NAMES travel beside it rather than inside it because only the payslip
 * needs them — folding a display string into the arithmetic type would push
 * presentation into the money path for no benefit.
 */
export type MonthSettlement = {
  days: SettlementDays;
  leaveTypeNames: Partial<Record<PenaltyKindKey, string>>;
};

export async function loadSettlementsForMonth(
  month: string,
): Promise<Map<string, MonthSettlement>> {
  const rows = await prisma.attendancePenaltySettlement.findMany({
    where: { month, deletedAt: null },
    select: {
      employeeId: true,
      kind: true,
      days: true,
      leaveType: { select: { name: true } },
    },
  });

  const out = new Map<string, MonthSettlement>();
  for (const r of rows) {
    const cur = out.get(r.employeeId) ?? { days: { ...EMPTY_SETTLEMENT }, leaveTypeNames: {} };
    cur.days[r.kind] = Number(r.days);
    cur.leaveTypeNames[r.kind] = r.leaveType.name;
    out.set(r.employeeId, cur);
  }
  return out;
}
```

Update the import line at the top of this file to include the key type:

```ts
import {
  EMPTY_SETTLEMENT,
  type PenaltyKindKey,
  type SettlementDays,
} from './penalty-settlement';
```

- [ ] **Step 7: Pass settlements through run.ts**

In `src/lib/payroll/run.ts`, load once before the per-employee loop:

```ts
import { loadSettlementsForMonth } from './penalty-settlement-load';

const settlements = await loadSettlementsForMonth(month);
```

and add to the `CalcInput` object built for each employee:

```ts
      penaltySettlement: settlements.get(employee.id)?.days,
```

Keep `settlements` in scope where the payslip data for each employee is
assembled — Task 5 reads `settlements.get(employee.id)?.leaveTypeNames` there.

Do **not** add any write to `AttendancePenaltySettlement` here. `run.ts` reads only.

- [ ] **Step 8: Verify the whole suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/payroll/calc.ts src/lib/payroll/calc.test.ts src/lib/payroll/run.ts src/lib/payroll/penalty-settlement-load.ts
git commit -m "feat(payroll): charge only the days not settled with leave"
```

---

## Task 4: Subtract settled minutes from the leave balance

**Files:**
- Create: `src/lib/leave/penalty-minutes.ts`
- Modify: `src/lib/leave/balance.ts` (signature at 17-20; call sites at ~129, ~194, ~237)
- Modify: `src/lib/leave/admin.ts:282`
- Modify: `src/lib/leave/approval-preview.ts:46`
- Test: `src/lib/leave/balance.test.ts`

**Interfaces:**
- Consumes: the `AttendancePenaltySettlement` model from Task 1.
- Produces:
  - `remainingMinutes(ent: EntitlementForBalance, used: number, penalty: number): number | null` — **third parameter is required**
  - `penaltyMinutes(employeeId: string, leaveTypeId: string, year: number, db?: TxClient): Promise<number>`
  - `penaltyMinutesBy(employeeIds: readonly string[], year: number): Promise<Map<string, number>>` — key `` `${employeeId}:${leaveTypeId}` ``

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/leave/balance.test.ts`:

```ts
describe('remainingMinutes with penalty minutes', () => {
  const ent = { grantedMinutes: 2880, carryoverMinutes: 0, adjustmentMinutes: 0 }; // 6 days

  it('subtracts penalty minutes from the remaining balance', () => {
    expect(remainingMinutes(ent, 480, 480)).toBe(1920); // 6 − 1 used − 1 penalty = 4 days
  });

  it('is unchanged when no penalty applies', () => {
    expect(remainingMinutes(ent, 480, 0)).toBe(2400);
  });

  it('still reports unlimited quota as null regardless of penalties', () => {
    expect(
      remainingMinutes({ grantedMinutes: null, carryoverMinutes: 0, adjustmentMinutes: 0 }, 0, 480),
    ).toBeNull();
  });

  it('may go negative when entitlement is cut after a penalty was settled', () => {
    expect(remainingMinutes({ ...ent, grantedMinutes: 480 }, 480, 480)).toBe(-480);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/leave/balance.test.ts`
Expected: FAIL — `Expected 2 arguments, but got 3`.

- [ ] **Step 3: Make the third parameter required**

In `src/lib/leave/balance.ts`, replace `remainingMinutes`:

```ts
/** Remaining minutes = (granted) + carryover + adjustment − used − penalty.
 *  Returns null when granted is null (unlimited — no cap, no warning).
 *  May be negative.
 *
 *  `penalty` is REQUIRED, not optional with a zero default, on purpose. This
 *  function has five call sites; an optional parameter lets one of them be
 *  missed, and a missed call site reports a balance that is too high — the
 *  employee is then allowed to book leave they no longer have, silently. A
 *  required parameter turns that mistake into a compile error. */
export function remainingMinutes(
  ent: EntitlementForBalance,
  used: number,
  penalty: number,
): number | null {
  if (ent.grantedMinutes == null) return null;
  return ent.grantedMinutes + ent.carryoverMinutes + ent.adjustmentMinutes - used - penalty;
}
```

- [ ] **Step 4: Confirm the compiler lists every unfixed call site**

Run: `npm run typecheck`
Expected: FAIL, with exactly five `Expected 3 arguments, but got 2` errors — in `balance.ts` (three), `leave/admin.ts`, and `leave/approval-preview.ts`. **This list is the task's checklist; every entry must be fixed before the task is done.**

- [ ] **Step 5: Write the penalty-minutes queries**

Create `src/lib/leave/penalty-minutes.ts`:

```ts
/**
 * Minutes of leave entitlement consumed by attendance penalties an admin chose
 * to settle with leave. The mirror of usedMinutes (balance.ts): same shape,
 * same year bucketing, different source table.
 *
 * Two variants because the balance module reads two ways — per-type inside a
 * loop, and one grouped query for report pages. Each caller uses the variant
 * matching how it already fetches `used`, so this adds no new query pattern.
 */

import { prisma } from '@/lib/db/prisma';

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Penalty minutes for one employee, one leave type, one leave year. */
export async function penaltyMinutes(
  employeeId: string,
  leaveTypeId: string,
  year: number,
  db: TxClient = prisma,
): Promise<number> {
  const rows = await db.attendancePenaltySettlement.findMany({
    where: { employeeId, leaveTypeId, periodYear: year, deletedAt: null },
    select: { minutes: true },
  });
  return rows.reduce((sum, r) => sum + r.minutes, 0);
}

/** Bulk variant for report pages. Key: `${employeeId}:${leaveTypeId}`. */
export async function penaltyMinutesBy(
  employeeIds: readonly string[],
  year: number,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (employeeIds.length === 0) return out;

  const grouped = await prisma.attendancePenaltySettlement.groupBy({
    by: ['employeeId', 'leaveTypeId'],
    where: { employeeId: { in: [...employeeIds] }, periodYear: year, deletedAt: null },
    _sum: { minutes: true },
  });
  for (const g of grouped) {
    out.set(`${g.employeeId}:${g.leaveTypeId}`, g._sum.minutes ?? 0);
  }
  return out;
}
```

- [ ] **Step 6: Fix the three call sites in balance.ts**

`entitlementRowsForEmployee` (~line 119) — inside the `for (const e of ents)` loop:

```ts
    const used = await usedMinutes(employeeId, e.leaveTypeId, year);
    const penalty = await penaltyMinutes(employeeId, e.leaveTypeId, year);
```

and pass `penalty` as the third argument to `remainingMinutes(e, used, penalty)`.

`remainingByTypeForEmployees` (~line 194) — fetch once before the employee loop and read from the map:

```ts
  const penaltyBy = await penaltyMinutesBy(employeeIds, year);
```

then inside the loop:

```ts
      const penalty = penaltyBy.get(`${empId}:${t.id}`) ?? 0;
      byType[t.id] = remainingMinutes({ /* …unchanged… */ }, used, penalty);
```

`remainingByTypeForEmployee` (~line 237) — inside the `for (const t of types)` loop:

```ts
    const used = await usedMinutes(employeeId, t.id, year);
    const penalty = await penaltyMinutes(employeeId, t.id, year);
    out[t.id] = remainingMinutes({ /* …unchanged… */ }, used, penalty);
```

Add the import at the top of `balance.ts`:

```ts
import { penaltyMinutes, penaltyMinutesBy } from './penalty-minutes';
```

- [ ] **Step 7: Fix the two remaining call sites**

In `src/lib/leave/admin.ts` (~line 282) and `src/lib/leave/approval-preview.ts` (~line 46), fetch the penalty for the same employee/type/year already in scope at each site and pass it as the third argument:

```ts
import { penaltyMinutes } from './penalty-minutes';

const penalty = await penaltyMinutes(employeeId, leaveTypeId, year);
const remaining = remainingMinutes(ent, used, penalty);
```

Use whatever the local variable names for employee, leave type, and year already are at each site — do not rename them.

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm test`
Expected: typecheck clean (zero remaining argument-count errors); all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/leave/penalty-minutes.ts src/lib/leave/balance.ts src/lib/leave/balance.test.ts src/lib/leave/admin.ts src/lib/leave/approval-preview.ts
git commit -m "feat(leave): subtract penalty-settled minutes from remaining balance"
```

---

## Task 5: Say so on the payslip

**Files:**
- Modify: `src/lib/payslip/document.ts`
- Test: `src/lib/payslip/document.test.ts`

**Interfaces:**
- Consumes: `CalcBreakdown.attendance.settledDays` (Task 3) for the day counts,
  and `MonthSettlement.leaveTypeNames` (Task 3's loader, already in scope in
  `run.ts` where payslip data is assembled) for the type name.
- Produces: the payslip input gains
  `settledLeaveTypeNames?: Partial<Record<PenaltyKindKey, string>>`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/payslip/document.test.ts`, following that file's existing fixture builders:

```ts
it('states that a penalty was paid with leave instead of showing nothing', () => {
  const doc = buildPayslipDocument(
    payslipInputWith({
      absentCount: 1,
      absentMoney: '0',
      settledDays: { Absent: 1, LateThreeStrike: 0, SevereLate: 0 },
      settledLeaveTypeName: 'ลาพักร้อน',
    }),
  );
  const attendance = doc.sections.find((s) => s.key === 'attendance');
  expect(JSON.stringify(attendance)).toContain('ลาพักร้อน');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/payslip/document.test.ts`
Expected: FAIL — the rendered attendance section does not contain the leave type name.

- [ ] **Step 3: Render the settled note**

In `src/lib/payslip/document.ts`, where the absent/late-strike/severe attendance lines are built, append a note when that kind has `settledDays > 0`:

```ts
// A settled penalty shows ฿0. Without saying why, the employee reads "no
// deduction" on the slip and only discovers the missing leave days later —
// which is a complaint, not a saving.
const settledNote = (days: number, leaveTypeName: string | null) =>
  days > 0 ? ` — หักจากสิทธิ${leaveTypeName ?? 'วันลา'} ${days} วัน` : '';
```

Apply it to the absent, late-three-strike, and severe-late line labels, reading
the day count from `breakdown.attendance.settledDays[kind]` and the name from
the new `settledLeaveTypeNames[kind]`.

In `run.ts`, populate that new field where payslip data is assembled:

```ts
      settledLeaveTypeNames: settlements.get(employee.id)?.leaveTypeNames,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/payslip/document.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payslip/document.ts src/lib/payslip/document.test.ts
git commit -m "feat(payslip): explain a zero penalty that was paid with leave"
```

---

## Task 6: Admin flag on the leave type

**Files:**
- Modify: `src/app/(admin)/admin/settings/leave-types/leave-type-form.tsx` (checkbox group ~150-165)
- Modify: `src/app/(admin)/admin/settings/leave-types/actions.ts` (schema ~32-45, parse ~63-70, write ~104, audit ~190)

**Interfaces:**
- Consumes: `LeaveType.penaltySettlementAllowed` from Task 1.
- Produces: admins can toggle the flag; the value is audited like its neighbours.

- [ ] **Step 1: Add the field to the Zod schema**

In `actions.ts`, alongside `allowHourly`:

```ts
  penaltySettlementAllowed: z
    .literal('on')
    .optional()
    .transform((v) => v === 'on'),
```

- [ ] **Step 2: Read it from the form data**

In the same file, alongside the other `formData.get` calls:

```ts
    penaltySettlementAllowed: formData.get('penaltySettlementAllowed') ?? undefined,
```

- [ ] **Step 3: Persist it and audit it**

In the create/update payload builder, alongside `allowHourly`:

```ts
    penaltySettlementAllowed: parsed.penaltySettlementAllowed ?? false,
```

and add `penaltySettlementAllowed: before.penaltySettlementAllowed,` to the audit "before" snapshot next to `allowHourly`.

- [ ] **Step 4: Add the checkbox**

In `leave-type-form.tsx`, add `penaltySettlementAllowed: boolean;` to the `initial` prop type, then add a checkbox below the unit checkboxes (it is a separate concern from leave units, so give it its own labelled row rather than adding it to that group):

```tsx
<label className="flex items-start gap-2">
  <input
    type="checkbox"
    name="penaltySettlementAllowed"
    defaultChecked={initial?.penaltySettlementAllowed ?? false}
    className="mt-1"
  />
  <span>
    <span className="font-medium">ใช้จ่ายค่าปรับได้</span>
    <span className="block text-sm text-ink-2">
      อนุญาตให้แอดมินหักสิทธิลาประเภทนี้แทนการหักเงิน เมื่อพนักงานขาดงานหรือมาสาย
    </span>
  </span>
</label>
```

Make sure the page that renders this form selects `penaltySettlementAllowed` in its Prisma query.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/admin/settings/leave-types"
git commit -m "feat(settings): let admins choose which leave types can pay a penalty"
```

---

## Task 7: The server action that writes a settlement

**Files:**
- Create: `src/lib/payroll/penalty-settlement-admin.ts`
- Test: `tests/integration/penalty-settlement.test.ts`

**Interfaces:**
- Consumes: `standardDayMinutes` (`@/lib/leave/units`), `getLeaveConfig` (`@/lib/leave/leave-config`), `remainingByTypeForEmployee` (`@/lib/leave/balance`), `requirePermission` (`@/lib/auth/check-permission`).
- Produces:
  - `setPenaltySettlement(input: { employeeId: string; month: string; kind: PenaltyKindKey; leaveTypeId: string; days: number; note?: string }): Promise<{ ok: true } | { ok: false; error: string }>`
  - `clearPenaltySettlement(input: { employeeId: string; month: string; kind: PenaltyKindKey }): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/penalty-settlement.test.ts`, following the setup helpers used by the other files in `tests/integration/`:

```ts
describe('setPenaltySettlement', () => {
  it('deducts leave once no matter how many times payroll recalculates', async () => {
    await setPenaltySettlement({
      employeeId, month: '2026-07', kind: 'Absent', leaveTypeId: vacationTypeId, days: 1,
    });

    const before = await remainingByTypeForEmployee(employeeId, 2026);
    await runPayroll('2026-07');
    await runPayroll('2026-07');
    await runPayroll('2026-07');
    const after = await remainingByTypeForEmployee(employeeId, 2026);

    // Three runs, one day gone — this is the whole point of the design.
    expect(before[vacationTypeId]! - after[vacationTypeId]!).toBe(0);
    expect(after[vacationTypeId]).toBe(before[vacationTypeId]);
  });

  it('refuses a leave type that is not allowed to pay penalties', async () => {
    const r = await setPenaltySettlement({
      employeeId, month: '2026-07', kind: 'Absent', leaveTypeId: sickTypeId, days: 1,
    });
    expect(r).toEqual({ ok: false, error: 'leave-type-not-allowed' });
  });

  it('refuses when the remaining balance is smaller than the penalty', async () => {
    const r = await setPenaltySettlement({
      employeeId, month: '2026-07', kind: 'Absent', leaveTypeId: vacationTypeId, days: 99,
    });
    expect(r).toEqual({ ok: false, error: 'insufficient-balance' });
  });

  it('refuses to touch a month whose payroll is already published', async () => {
    await publishPayroll('2026-06', employeeId);
    const r = await setPenaltySettlement({
      employeeId, month: '2026-06', kind: 'Absent', leaveTypeId: vacationTypeId, days: 1,
    });
    expect(r).toEqual({ ok: false, error: 'period-closed' });
  });

  it('refuses to clear a settlement in a published month', async () => {
    const r = await clearPenaltySettlement({ employeeId, month: '2026-06', kind: 'Absent' });
    expect(r).toEqual({ ok: false, error: 'period-closed' });
  });

  it('keeps counting an existing settlement after its leave type is disallowed', async () => {
    // Turning the flag off is a policy change going forward, not a rewrite of
    // history: leave already spent stays spent, money already withheld stays
    // withheld. Only NEW selections are blocked.
    await setPenaltySettlement({
      employeeId, month: '2026-07', kind: 'Absent', leaveTypeId: vacationTypeId, days: 1,
    });
    const before = await remainingByTypeForEmployee(employeeId, 2026);

    await prisma.leaveType.update({
      where: { id: vacationTypeId },
      data: { penaltySettlementAllowed: false },
    });

    const after = await remainingByTypeForEmployee(employeeId, 2026);
    expect(after[vacationTypeId]).toBe(before[vacationTypeId]);

    const retry = await setPenaltySettlement({
      employeeId, month: '2026-07', kind: 'SevereLate', leaveTypeId: vacationTypeId, days: 1,
    });
    expect(retry).toEqual({ ok: false, error: 'leave-type-not-allowed' });
  });
});
```

Note the first test asserts the balance is measured **after** the settlement exists, so the three payroll runs must move it by zero. Read the balance before the runs and after, not before the settlement.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration -- tests/integration/penalty-settlement.test.ts`
Expected: FAIL — module `penalty-settlement-admin` not found.

- [ ] **Step 3: Write the action**

Create `src/lib/payroll/penalty-settlement-admin.ts`:

```ts
/**
 * Writing a settlement is the ONLY way entitlement gets spent on a penalty.
 * Payroll never writes here — see penalty-settlement.ts for why that matters.
 *
 * Every guard below is enforced server-side even though the UI also prevents
 * it: the UI disables options for usability, this function is what makes them
 * impossible.
 */

'use server';

import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { remainingByTypeForEmployee } from '@/lib/leave/balance';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { standardDayMinutes } from '@/lib/leave/units';
import type { PenaltyKindKey } from './penalty-settlement';

type Result = { ok: true } | { ok: false; error: string };

/** The leave year a pay-period month charges against: the year in its label.
 *  Stored on the row so no other reader re-derives it differently. */
function periodYearOf(month: string): number {
  return Number(month.slice(0, 4));
}

/** A month is closed once any payroll row for it has left Draft. Money is
 *  frozen then, but leave balance is always live — allowing an edit here would
 *  return the leave while the published slip keeps the money, and the two sides
 *  would disagree permanently with no way to reconcile them. */
async function isPeriodClosed(employeeId: string, month: string): Promise<boolean> {
  const row = await prisma.payroll.findFirst({
    where: { employeeId, month, status: { not: 'Draft' } },
    select: { id: true },
  });
  return row != null;
}

export async function setPenaltySettlement(input: {
  employeeId: string;
  month: string;
  kind: PenaltyKindKey;
  leaveTypeId: string;
  days: number;
  note?: string;
}): Promise<Result> {
  const { user } = await requirePermission('payroll.run');

  if (!Number.isInteger(input.days) || input.days <= 0) {
    return { ok: false, error: 'invalid-days' };
  }
  if (await isPeriodClosed(input.employeeId, input.month)) {
    return { ok: false, error: 'period-closed' };
  }

  const leaveType = await prisma.leaveType.findUnique({
    where: { id: input.leaveTypeId },
    select: { penaltySettlementAllowed: true, archivedAt: true },
  });
  if (!leaveType || leaveType.archivedAt || !leaveType.penaltySettlementAllowed) {
    return { ok: false, error: 'leave-type-not-allowed' };
  }

  const year = periodYearOf(input.month);
  const std = standardDayMinutes(await getLeaveConfig());
  const minutes = input.days * std;

  const remaining = await remainingByTypeForEmployee(input.employeeId, year);
  const available = remaining[input.leaveTypeId];
  // null = unlimited quota. Spending from something with no ceiling is
  // meaningless, so it is refused rather than silently allowed.
  if (available == null) return { ok: false, error: 'leave-type-not-allowed' };

  // The row being replaced already counts against `available`; add it back so
  // editing 1 day to 2 days is judged on the true headroom, not on headroom
  // that already excludes the day being replaced.
  const existing = await prisma.attendancePenaltySettlement.findUnique({
    where: {
      employeeId_month_kind: {
        employeeId: input.employeeId,
        month: input.month,
        kind: input.kind,
      },
    },
    select: { minutes: true, leaveTypeId: true, deletedAt: true },
  });
  const creditBack =
    existing && !existing.deletedAt && existing.leaveTypeId === input.leaveTypeId
      ? existing.minutes
      : 0;

  if (minutes > available + creditBack) return { ok: false, error: 'insufficient-balance' };

  await prisma.attendancePenaltySettlement.upsert({
    where: {
      employeeId_month_kind: {
        employeeId: input.employeeId,
        month: input.month,
        kind: input.kind,
      },
    },
    create: {
      employeeId: input.employeeId,
      month: input.month,
      kind: input.kind,
      leaveTypeId: input.leaveTypeId,
      days: input.days,
      minutes,
      periodYear: year,
      note: input.note ?? null,
      createdById: user.id,
    },
    update: {
      leaveTypeId: input.leaveTypeId,
      days: input.days,
      minutes,
      periodYear: year,
      note: input.note ?? null,
      deletedAt: null,
    },
  });

  return { ok: true };
}

export async function clearPenaltySettlement(input: {
  employeeId: string;
  month: string;
  kind: PenaltyKindKey;
}): Promise<Result> {
  await requirePermission('payroll.run');

  if (await isPeriodClosed(input.employeeId, input.month)) {
    return { ok: false, error: 'period-closed' };
  }

  await prisma.attendancePenaltySettlement.updateMany({
    where: { employeeId: input.employeeId, month: input.month, kind: input.kind, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:integration -- tests/integration/penalty-settlement.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify nothing else broke**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: all pass (baseline 1,374 unit + 118 integration, plus the new ones).

- [ ] **Step 6: Commit**

```bash
git add src/lib/payroll/penalty-settlement-admin.ts tests/integration/penalty-settlement.test.ts
git commit -m "feat(payroll): guarded server action for settling a penalty with leave"
```

---

## Task 8: Choose at manual entry

**Files:**
- Modify: `src/app/(admin)/admin/attendance/manual/manual-form.tsx`
- Modify: `src/app/(admin)/admin/attendance/manual/page.tsx` (supply allowed types + balances)

**Interfaces:**
- Consumes: `setPenaltySettlement` (Task 7), `remainingByTypeForEmployee` (Task 4).
- Produces: no new exports.

- [ ] **Step 1: Load the eligible types on the page**

In `manual/page.tsx`, fetch the leave types that may pay a penalty, and the current employee balances:

```ts
const penaltyLeaveTypes = await prisma.leaveType.findMany({
  where: { archivedAt: null, penaltySettlementAllowed: true },
  select: { id: true, name: true },
  orderBy: { name: 'asc' },
});
```

Also compute the selected employee's remaining balance per type, converted to
whole days so the option labels can show it:

```ts
const std = standardDayMinutes(await getLeaveConfig());
const remainingByType = await remainingByTypeForEmployee(employeeId, new Date().getFullYear());
const remainingDaysByType: Record<string, number> = {};
for (const t of penaltyLeaveTypes) {
  const mins = remainingByType[t.id];
  // null = unlimited quota, which is not selectable — report 0 so the option
  // renders disabled rather than appearing to offer infinite headroom.
  remainingDaysByType[t.id] = mins == null ? 0 : Math.floor(mins / std);
}
```

Pass `penaltyLeaveTypes`, `remainingDaysByType`, and a `canSettle` boolean
(whether the signed-in admin holds `payroll.run`) to `ManualForm`.

- [ ] **Step 2: Add the choice to the form**

In `manual-form.tsx`, when the selected outcome is ขาดงาน **and** `canSettle` is true, render below the existing deduction preview:

```tsx
<fieldset className="mt-3 space-y-2">
  <legend className="text-sm font-medium">วิธีหัก</legend>
  <label className="flex items-center gap-2">
    <input type="radio" name="settleWith" value="money" defaultChecked />
    <span>หักเงิน {absentDayRate ? `฿${absentDayRate.toFixed(2)}` : ''}</span>
  </label>
  <label className="flex items-center gap-2">
    <input type="radio" name="settleWith" value="leave" />
    <span>หักสิทธิวันลา 1 วัน</span>
  </label>
  <select name="settleLeaveTypeId" className="w-full rounded border px-2 py-1">
    {penaltyLeaveTypes.map((t) => {
      const left = remainingDaysByType[t.id] ?? 0;
      return (
        <option key={t.id} value={t.id} disabled={left < 1}>
          {t.name} (เหลือ {left} วัน){left < 1 ? ' — สิทธิไม่พอ' : ''}
        </option>
      );
    })}
  </select>
</fieldset>
```

When `canSettle` is false, render nothing here — the admin records the absence and someone with payroll rights settles it on the reconcile page. Do not show a disabled control with no explanation.

- [ ] **Step 3: Call the action after the attendance row is created**

In the form's submit handler, after the manual attendance action succeeds and `settleWith === 'leave'`, call:

```ts
const res = await setPenaltySettlement({
  employeeId,
  month: payrollMonthFor(date),
  kind: 'Absent',
  leaveTypeId: settleLeaveTypeId,
  days: 1,
});
```

If it returns `{ ok: false }`, surface the message to the admin — **the attendance row still exists and is charged as money**, which is the safe fallback. Say that explicitly in the message rather than implying the whole entry failed.

Use the existing helper that maps a date to its pay-period month (the same one the manual action already uses for `cutoffDay` arithmetic); do not re-derive the cutoff logic here.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/attendance/manual"
git commit -m "feat(attendance): choose money or leave when keying an absence"
```

---

## Task 9: Review and edit on the reconcile page

**Files:**
- Modify: `src/app/(admin)/admin/payroll/reconcile/page.tsx`
- Modify: `src/app/(admin)/admin/payroll/reconcile/reconcile-rows.tsx`

**Interfaces:**
- Consumes: `setPenaltySettlement`, `clearPenaltySettlement` (Task 7); `CalcBreakdown.attendance.settledDays` (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Load settlements and eligible types**

In `reconcile/page.tsx`, load the month's settlements (reuse `loadSettlementsForMonth` from Task 3) plus the eligible leave types and each employee's remaining balance, and pass them to `ReconcileRows`.

- [ ] **Step 2: Render the settlement control per penalty kind**

For each employee row that has any of the three penalties, show one line per kind with its current settlement and a control to change it. Disable every control when that employee's payroll row for the month is not `Draft`, with the reason shown:

```tsx
{!isDraft && (
  <p className="text-sm text-ink-2">
    เดือนนี้เผยแพร่แล้ว — แก้วิธีหักไม่ได้ ต้องออกใบแก้ไข
  </p>
)}
```

- [ ] **Step 3: Flag settlements larger than the penalty**

When `settledDays[kind] > actualDays[kind]` for a row, show a warning:

```tsx
<p className="text-sm text-warn-1">
  มีการหักสิทธิ {settled} วัน แต่เดือนนี้เหลือโทษจริง {actual} วัน — รายการที่เกินไม่ถูกนำมาคิด
  กรุณาตรวจสอบ
</p>
```

This is the visible half of the clamp in `moneyDaysFor`: the arithmetic is already safe, but a settlement that no longer matches any penalty means an employee lost leave for something that was voided — silence there would hide a real mistake.

- [ ] **Step 4: Verify in the browser**

Start the dev server via `preview_start` and open `/admin/payroll/reconcile` for a month with a draft payroll. Confirm: the control appears for penalised employees; choosing a leave type updates the money column after recalculation; a published month shows the read-only message.

- [ ] **Step 5: Verify the suite**

Run: `npm run typecheck && npm test && npm run test:integration && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/admin/payroll/reconcile"
git commit -m "feat(payroll): review and edit penalty settlements on the reconcile page"
```

---

## Done criteria

- `npm run typecheck && npm test && npm run test:integration && npm run lint` all pass.
- An absence settled with leave shows ฿0 on the payslip **with** the leave type named.
- Running payroll repeatedly moves the leave balance exactly once.
- Sick and maternity leave cannot be selected, and are refused by the server if requested directly.
- A published month rejects both `setPenaltySettlement` and `clearPenaltySettlement`.
- No code path outside `penalty-settlement-admin.ts` writes to `AttendancePenaltySettlement`.
