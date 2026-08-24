# Advance & Position Allowance — Implementation Plan (Workstream A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a nameable position allowance that counts toward pay and the advance cap, and make the advance cap respect keyed adjustments, a minimum-remaining floor, and a blackout window around the payroll cutoff.

**Architecture:** One migration (`0042`) carrying five columns. All advance-cap logic funnels through `calculateAdvanceBalance` in `src/lib/advance/balance.ts`, which is the single source of truth already shared by the LIFF request form and the admin approval guard via `isOverCap` — nothing in this plan adds a second gate anywhere. The allowance deliberately does NOT enter `calcSso`, `perMinuteRate`, or `dailyRateFor`.

**Tech Stack:** Prisma 6 · Postgres · Next.js 16 server actions · decimal.js · Vitest

**Spec:** `docs/superpowers/plans/2026-08-24-finnix-hr-backlog.md` §A0 — the four decisions, with the reasoning that produced them. Read A0 before Task 1; several steps below only make sense against it.

---

## Global Constraints

Everything in the master plan's Global Constraints applies. Additionally, specific to this workstream:

- **`0042` MUST deploy in the same release as `0041`.** Two un-deployed migrations across separate deploys doubles the rollback surface, and `docs/runbooks/deploy-rollback.md` documents that rolling back across a DDL boundary strips permissions the migration added without restoring them on re-deploy.
- **The allowance never touches a deduction formula.** `calcSso` (`payroll/calc.ts:357`), `perMinuteRate` (`leave/over-quota.ts:17`) and `dailyRateFor` (`payroll/day-rate.ts:57`) keep reading `baseSalary` alone. Decision A0.1: folding it in would make an employee pay more per absence for holding an allowance. If a step below appears to require changing one of these, STOP — the design is wrong, not the formula.
- **SSO treatment is OPEN.** This plan assumes the allowance is excluded from the ประกันสังคม base. That is a Thai labour-law question routed to the customer's accountant in workstream D. Do not treat it as settled.
- **Leave is NOT part of the advance cap in this plan.** Decision A0.2 defers it until `/admin/tools/leave-backlog` explains the ฿27,450. Do not add `computeLiveLeaveCharges` to `available.ts`.
- **Money fields on `AdvanceBalanceInput` are REQUIRED, not optional-with-default** — same reasoning as `ReplayEntitlement.penaltyMinutes` (`leave/over-quota.ts:55-62`). An optional floor lets a call site be missed, and a missed floor silently lets an employee draw past the very limit the floor exists to enforce. Required turns that into a compile error. Expect to update every existing call site and every existing test; that IS the safety mechanism.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `prisma/schema.prisma` | model definitions | +2 `Employee`, +2 `PayrollConfig`, +1 `Payroll` |
| `prisma/migrations/0042_position_allowance_and_advance_limits/migration.sql` | the DDL | create |
| `src/lib/advance/balance.ts` | THE advance-cap formula | allowance, adjustments, floor |
| `src/lib/advance/available.ts` | fetches inputs for the formula | +2 queries, pass-through |
| `src/lib/advance/blackout.ts` | pure cutoff-window predicate | create |
| `src/lib/advance/actions.ts` | request submission | blackout guard |
| `src/lib/payroll/calc.ts` | payroll money | allowance as its own income line |
| `src/lib/payroll/run.ts` | persists the draft | carry `incomeAllowance` |
| `src/app/(admin)/admin/employees/...edit` | admin form | label + amount fields |
| `src/app/(liff)/liff/advance/new/advance-new-form.tsx` | request form | explain the blackout |

---

## Task 1: Migration 0042

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0042_position_allowance_and_advance_limits/migration.sql`

**Interfaces:**
- Produces: `Employee.allowanceLabel: string | null`, `Employee.allowanceAmount: Decimal`, `PayrollConfig.advanceMinRemaining: Decimal`, `PayrollConfig.advanceBlackoutDays: number`, `Payroll.incomeAllowance: Decimal`

**Why label + amount, not a single `positionAllowance` column:** the request is *"เพิ่มเงินพิเศษ (ที่กำหนดชื่อได้) เงินประจำตำแหน่ง"* — nameable extra pay, of which position allowance is the first example. A column called `positionAllowance` answers the example and not the request; the next allowance they want would need another migration.

- [ ] **Step 1: Add the fields to `schema.prisma`**

On `model Employee`, beside `baseSalary`:

```prisma
  /// Nameable recurring extra pay — "เงินประจำตำแหน่ง" is the first use, but the
  /// label is the admin's to set. Counts toward payroll income AND the cash-advance
  /// cap, and deliberately NOT toward calcSso, perMinuteRate, or dailyRateFor:
  /// folding it into the deduction rates would charge an employee more per absence
  /// for holding an allowance. See plan 2026-08-24-finnix-hr-backlog.md §A0.1.
  /// SSO treatment is an OPEN compliance question with the customer's accountant.
  allowanceLabel       String?
  allowanceAmount      Decimal     @default(0) @db.Decimal(12, 2)
```

On `model PayrollConfig`:

```prisma
  /// Baht that must remain after an advance — subtracted from `available` in
  /// calculateAdvanceBalance so the existing isOverCap enforces it on BOTH the
  /// LIFF request form and the admin approval guard. The preventive twin of the
  /// negative-net publish guard. 0 = no floor.
  advanceMinRemaining  Decimal @default(0) @db.Decimal(12, 2)
  /// Days before and including `cutoffDay` during which employees cannot submit
  /// a cash-advance request. Expressed relative to the cutoff so it stays aligned
  /// if cutoffDay changes. 0 = no blackout. Blocks REQUESTING only; admins can
  /// still approve requests already in flight.
  advanceBlackoutDays  Int     @default(0)
```

On `model Payroll`, beside `incomeOther`:

```prisma
  /// Frozen allowance amount for this payslip. Its own column rather than folded
  /// into incomeOther so the payslip can show it as a named line. The AMOUNT is
  /// frozen here; the LABEL renders from Employee.allowanceLabel at read time, so
  /// renaming an allowance re-labels historical payslip VIEWS (never their money).
  /// Archived payslip PDFs are already immutable and unaffected.
  incomeAllowance  Decimal @default(0) @db.Decimal(12, 2)
```

- [ ] **Step 2: Hand-author the migration**

Do NOT run `prisma migrate dev --create-only` — it emits spurious `DROP DEFAULT` statements against this schema (see the memory note on migrate-dev drift). Write it by hand:

```sql
-- Position allowance: nameable recurring extra pay.
ALTER TABLE "Employee"
  ADD COLUMN "allowanceLabel"  TEXT,
  ADD COLUMN "allowanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Advance limits.
ALTER TABLE "PayrollConfig"
  ADD COLUMN "advanceMinRemaining" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "advanceBlackoutDays" INTEGER       NOT NULL DEFAULT 0;

-- Frozen allowance on the payslip.
ALTER TABLE "Payroll"
  ADD COLUMN "incomeAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0;
```

Every column is additive with a default, so a rollback leaves existing rows valid. **This migration adds no permission**, which is what keeps it clear of the permission-strip trap in `docs/runbooks/deploy-rollback.md` — do not add one here without re-reading that runbook.

- [ ] **Step 3: Apply and regenerate**

```bash
npm run db:deploy && npx prisma generate
```

- [ ] **Step 4: Verify the client sees the columns**

```bash
npm run typecheck
```

Expected: exit 0. If it fails on the new fields, `prisma generate` did not run.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0042_position_allowance_and_advance_limits
git commit -m "feat(schema): nameable allowance, advance floor and blackout (0042)"
```

---

## Task 2: The allowance is paid

Payroll must pay the allowance before anything else uses it as a cap basis — otherwise the advance cap would let someone draw against money that never arrives.

**Files:**
- Modify: `src/lib/payroll/calc.ts`
- Modify: `src/lib/payroll/calc.test.ts`
- Modify: `src/lib/payroll/run.ts`

**Interfaces:**
- Consumes: `Employee.allowanceAmount` (Task 1)
- Produces: `PayrollDraft.incomeAllowance: Decimal`; `EmployeeForPayroll.allowanceAmount: string | number | Decimal` (**required**)

- [ ] **Step 1: Write the failing test**

Append to `src/lib/payroll/calc.test.ts` (match the existing fixture helper in that file rather than the shape sketched here):

```ts
  it('pays the allowance as its own income line', () => {
    const d = calcPayroll(baseInput({ baseSalary: 13_500, allowanceAmount: 3_000, hasSso: true }));
    expect(d.incomeBase.toNumber()).toBe(13_500);
    expect(d.incomeAllowance.toNumber()).toBe(3_000);
  });

  it('the allowance does NOT raise the SSO deduction', () => {
    // Decision A0.1: allowance is excluded from the ประกันสังคม base pending the
    // customer's accountant. 13,500 x 5% = 675 either way — if this ever reads
    // 825, someone folded the allowance into calcSso.
    const without = calcPayroll(baseInput({ baseSalary: 13_500, allowanceAmount: 0, hasSso: true }));
    const with_ = calcPayroll(baseInput({ baseSalary: 13_500, allowanceAmount: 3_000, hasSso: true }));
    expect(with_.deductSso.toNumber()).toBe(without.deductSso.toNumber());
  });

  it('the allowance reaches net pay', () => {
    const without = calcPayroll(baseInput({ baseSalary: 13_500, allowanceAmount: 0, hasSso: true }));
    const with_ = calcPayroll(baseInput({ baseSalary: 13_500, allowanceAmount: 3_000, hasSso: true }));
    expect(with_.netPay.minus(without.netPay).toNumber()).toBe(3_000);
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/payroll/calc.test.ts`
Expected: FAIL — `allowanceAmount` is not a property of `EmployeeForPayroll`.

- [ ] **Step 3: Implement**

In `calc.ts`, add to `EmployeeForPayroll`:

```ts
  /** Nameable recurring allowance. REQUIRED, not optional-with-default: this is
   *  money owed to the employee, and an optional field lets a caller be missed,
   *  which silently underpays. Excluded from calcSso / dailyRateFor by design. */
  allowanceAmount: string | number | Decimal;
```

Add `incomeAllowance: Decimal` to `PayrollDraft`, and in `calcPayroll`, beside `incomeBase`:

```ts
  const incomeAllowance = toDec(input.employee.allowanceAmount).toDecimalPlaces(2);
```

Add `incomeAllowance` to the net-pay sum. **Leave `calcSsoParts(baseSalary, …)` exactly as it is** — that call taking `baseSalary` and not the total is the decision, not an oversight.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/payroll/calc.test.ts`
Expected: PASS. Other tests in this file will fail to compile until each fixture gains `allowanceAmount` — add `allowanceAmount: 0` to each. That churn is the required-field mechanism working.

- [ ] **Step 5: Persist it**

In `run.ts`, add `allowanceAmount: true` to the employee `select`, pass it into the calc input, and add `incomeAllowance: new Prisma.Decimal(draft.incomeAllowance.toFixed(2))` to `draftValues`.

- [ ] **Step 6: Full verification**

```bash
npm test && npm run typecheck && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/payroll/calc.ts src/lib/payroll/calc.test.ts src/lib/payroll/run.ts
git commit -m "feat(payroll): pay the position allowance as its own income line"
```

---

## Task 3: The allowance raises the advance cap

**Files:**
- Modify: `src/lib/advance/balance.ts`
- Modify: `src/lib/advance/balance.test.ts`
- Modify: `src/lib/advance/available.ts`

**Interfaces:**
- Produces: `AdvanceBalanceInput.allowanceAmount` (**required**), surfaced on both `AdvanceBalance` variants as `allowance: number`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/advance/balance.test.ts`:

```ts
  it('the allowance raises the monthly cap', () => {
    const r = calculateAdvanceBalance({
      baseSalary: 13_500,
      allowanceAmount: 3_000,
      salaryType: 'Monthly',
      reservedAdvances: [],
      monthlyDeductions: 0,
      minRemaining: 0,
    });
    if (r.kind !== 'monthly') throw new Error('expected monthly');
    expect(r.available).toBe(16_500);
  });

  it('the allowance is reported separately from base salary', () => {
    const r = calculateAdvanceBalance({
      baseSalary: 13_500,
      allowanceAmount: 3_000,
      salaryType: 'Monthly',
      reservedAdvances: [],
      monthlyDeductions: 0,
      minRemaining: 0,
    });
    if (r.kind !== 'monthly') throw new Error('expected monthly');
    expect(r.baseSalary).toBe(13_500);
    expect(r.allowance).toBe(3_000);
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/advance/balance.test.ts`
Expected: FAIL — `allowanceAmount` does not exist on the input type.

- [ ] **Step 3: Implement**

Add to `AdvanceBalanceInput`:

```ts
  /** Nameable recurring allowance — part of the cap basis (item 6:
   *  "เวลาเบิกให้คิดยอดรวมจาก เงินเดือน + เงินประจำตำแหน่ง"). REQUIRED for the same
   *  reason as `minRemaining` below. */
  allowanceAmount: Prisma.Decimal | string | number;
```

In `calculateAdvanceBalance`, `const allowance = toNumber(input.allowanceAmount);` and use `baseSalary + allowance` as the monthly cap basis. Add `allowance` to both returned variants.

**Rate-based (Daily/Hourly) employees:** the cap basis is `periodEarnings`, not `baseSalary`. Add the allowance there too — it is a monthly amount and does not vary with days worked. Write a test asserting a Daily employee's `available` includes it.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/advance/balance.test.ts`
Expected: PASS, after every existing call in the file gains `allowanceAmount`.

- [ ] **Step 5: Feed it from the database**

In `available.ts`, add `allowanceAmount: true` to the `employee` select and pass it into `calculateAdvanceBalance`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/advance/balance.ts src/lib/advance/balance.test.ts src/lib/advance/available.ts
git commit -m "feat(advance): count the position allowance toward the cap"
```

---

## Task 4: Keyed adjustments move the cap

**Files:** Modify `src/lib/advance/available.ts`, `src/lib/advance/balance.ts`, `src/lib/advance/balance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('a Deduction adjustment lowers the cap and an Income adjustment raises it', () => {
    const r = calculateAdvanceBalance({
      baseSalary: 20_000,
      allowanceAmount: 0,
      salaryType: 'Monthly',
      reservedAdvances: [],
      // net effect of this month's เงินเพิ่ม/เงินลด: +1,000 − 3,000 = −2,000
      monthlyDeductions: 2_000,
      minRemaining: 0,
    });
    if (r.kind !== 'monthly') throw new Error('expected monthly');
    expect(r.available).toBe(18_000);
  });
```

- [ ] **Step 2: Run it**

Expected: PASS — `monthlyDeductions` already flows through. **This test pins the arithmetic; the real work is Step 3, which supplies the number.**

- [ ] **Step 3: Query the adjustments**

In `available.ts`, add a fourth query to the existing `Promise.all`, mirroring the payroll sweep's window in `run.ts` so the two agree about which month an adjustment belongs to:

```ts
    prisma.payrollAdjustment.findMany({
      where: {
        employeeId,
        deletedAt: null,
        startMonth: { lte: currentMonth },
        OR: [{ endMonth: null }, { endMonth: { gte: currentMonth } }],
      },
      select: { kind: true, amount: true },
    }),
```

where `currentMonth` is the payroll month containing today, derived from `payrollPeriodFor(todayYmd, cfg.cutoffDay).end.slice(0, 7)` — NOT `todayYmd.slice(0,7)`. Near the cutoff those differ, and using the calendar month would apply next month's adjustments a few days early.

Then fold into `monthlyDeductions`:

```ts
  const adjustmentNet = adjustments.reduce(
    (sum, a) => sum + (a.kind === 'Deduction' ? Number(a.amount) : -Number(a.amount)),
    0,
  );
  const monthlyDeductions = ssoDeduction + recurringDeduction + adjustmentNet;
```

`adjustmentNet` can be negative when income adjustments dominate — that correctly RAISES the cap. Note `calculateAdvanceBalance` currently clamps with `Math.max(0, input.monthlyDeductions ?? 0)`; **that clamp must be removed** or a net-income month is silently ignored. Write a test for exactly that case before removing it.

- [ ] **Step 4: Verify, then commit**

```bash
npm test && npm run typecheck
git add src/lib/advance/available.ts src/lib/advance/balance.ts src/lib/advance/balance.test.ts
git commit -m "feat(advance): keyed adjustments move the available cap"
```

---

## Task 5: The minimum-remaining floor

**Files:** Modify `src/lib/advance/balance.ts`, `src/lib/advance/balance.test.ts`, `src/lib/advance/available.ts`, plus the admin payroll-settings form

- [ ] **Step 1: Write the failing test**

```ts
  it('the floor reduces what can be drawn', () => {
    const r = calculateAdvanceBalance({
      baseSalary: 10_000,
      allowanceAmount: 0,
      salaryType: 'Monthly',
      reservedAdvances: [],
      monthlyDeductions: 0,
      minRemaining: 2_000,
    });
    if (r.kind !== 'monthly') throw new Error('expected monthly');
    expect(r.available).toBe(8_000);
  });

  it('the floor never turns a positive balance into a fake overdraft', () => {
    // available floors at 0, not at -minRemaining: the employee is not in debt,
    // they simply cannot draw. `overdrawn` means "reserved exceeds entitlement"
    // and must not be triggered by a policy floor.
    const r = calculateAdvanceBalance({
      baseSalary: 1_000,
      allowanceAmount: 0,
      salaryType: 'Monthly',
      reservedAdvances: [],
      monthlyDeductions: 0,
      minRemaining: 5_000,
    });
    if (r.kind !== 'monthly') throw new Error('expected monthly');
    expect(r.available).toBe(0);
    expect(r.overdrawn).toBe(false);
  });
```

The second test is the one that matters. Without it the obvious implementation returns `-4_000` and flags the employee as overdrawn, which would show a scary red state on the LIFF page for someone who owes nothing.

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL — `minRemaining` does not exist on the input.

- [ ] **Step 3: Implement**

```ts
  /** Baht that must remain undrawn (PayrollConfig.advanceMinRemaining).
   *  REQUIRED, not optional-with-default: an optional floor lets a call site be
   *  missed, and a missed floor silently lets an employee draw past the exact
   *  limit this field exists to enforce. */
  minRemaining: Prisma.Decimal | string | number;
```

Apply it AFTER reserved, and clamp at zero without touching `overdrawn`:

```ts
  const floor = Math.max(0, toNumber(input.minRemaining));
  const rawAvailable = baseSalary + allowance - deductions - reserved;
  const overdrawn = rawAvailable < 0;            // entitlement, not policy
  const available = Math.max(0, rawAvailable - floor);
```

Apply the same treatment to the rate-based branch.

- [ ] **Step 4: Feed it and surface it**

`available.ts`: add `advanceMinRemaining` to the `payrollConfig` select and pass it through. Add the field to the admin payroll-settings form beside `absentDeductionPerDay`.

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/lib/advance/ src/app/\(admin\)/admin/settings/
git commit -m "feat(advance): minimum-remaining floor, enforced through available"
```

---

## Task 6: The blackout window

**Files:**
- Create: `src/lib/advance/blackout.ts`, `src/lib/advance/blackout.test.ts`
- Modify: `src/lib/advance/actions.ts`, `src/app/(liff)/liff/advance/new/advance-new-form.tsx`

- [ ] **Step 1: Write the failing test**

`src/lib/advance/blackout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isInAdvanceBlackout } from './blackout';

describe('isInAdvanceBlackout', () => {
  it('0 days disables the feature entirely', () => {
    expect(isInAdvanceBlackout('2026-08-25', 25, 0)).toBe(false);
  });

  it('blocks the cutoff day itself', () => {
    expect(isInAdvanceBlackout('2026-08-25', 25, 3)).toBe(true);
  });

  it('blocks the N-1 days before the cutoff', () => {
    expect(isInAdvanceBlackout('2026-08-23', 25, 3)).toBe(true);
    expect(isInAdvanceBlackout('2026-08-24', 25, 3)).toBe(true);
  });

  it('does not block the day before the window opens', () => {
    expect(isInAdvanceBlackout('2026-08-22', 25, 3)).toBe(false);
  });

  it('does not block the day after the cutoff', () => {
    expect(isInAdvanceBlackout('2026-08-26', 25, 3)).toBe(false);
  });

  it('a window longer than the cutoff day does not wrap into the previous month', () => {
    // cutoffDay 3 with a 5-day window: days 1-3 blocked, and 27-31 of the
    // PREVIOUS month are NOT — they belong to a different payroll period, and
    // wrapping would silently block a week nobody configured.
    expect(isInAdvanceBlackout('2026-08-01', 3, 5)).toBe(true);
    expect(isInAdvanceBlackout('2026-08-03', 3, 5)).toBe(true);
    expect(isInAdvanceBlackout('2026-07-30', 3, 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/advance/blackout.test.ts`
Expected: FAIL — cannot resolve `./blackout`.

- [ ] **Step 3: Implement**

```ts
/**
 * Is `todayYmd` inside the advance-request blackout?
 *
 * The window is the `blackoutDays` days ending ON `cutoffDay` inclusive, so it
 * is expressed relative to the cutoff and stays aligned if the cutoff moves
 * (decision A0.4). `blackoutDays` of 0 disables it.
 *
 * Deliberately does NOT wrap into the previous month. A window longer than the
 * cutoff day simply starts at day 1: those earlier days belong to a different
 * payroll period, and silently blocking a week nobody configured is worse than
 * a short window.
 *
 * Pure — takes a YYYY-MM-DD string the caller resolved in Asia/Bangkok.
 */
export function isInAdvanceBlackout(
  todayYmd: string,
  cutoffDay: number,
  blackoutDays: number,
): boolean {
  if (!Number.isInteger(blackoutDays) || blackoutDays <= 0) return false;
  const day = Number(todayYmd.slice(8, 10));
  if (!Number.isFinite(day)) return false;
  const from = Math.max(1, cutoffDay - blackoutDays + 1);
  return day >= from && day <= cutoffDay;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/advance/blackout.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Guard the server action**

In `submitCashAdvance` (`actions.ts`), before the over-cap check:

```ts
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  if (isInAdvanceBlackout(todayYmd, cfg.cutoffDay, cfg.advanceBlackoutDays)) {
    return { ok: false, message: 'ช่วงนี้ปิดรับคำขอเบิกล่วงหน้า กรุณาลองใหม่หลังวันตัดรอบ' };
  }
```

**This server-side check is the guard.** Disabling the button is presentation: a LIFF page held open across midnight, or a replayed submission, walks straight past the UI. Build both — the button explains, the action enforces.

- [ ] **Step 6: Explain it in the form**

In `advance-new-form.tsx`, when the blackout is active, disable submit and show the same message. The page is a Server Component boundary away from the config — pass the flag down as a prop rather than re-querying on the client.

- [ ] **Step 7: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/lib/advance/blackout.ts src/lib/advance/blackout.test.ts src/lib/advance/actions.ts src/app/\(liff\)/liff/advance/new/advance-new-form.tsx
git commit -m "feat(advance): blackout window around the payroll cutoff"
```

---

## Task 7: Admin edits the allowance

**Files:** the employee edit form and its server action under `src/app/(admin)/admin/employees/`

- [ ] **Step 1: Add the fields**

A text input for `allowanceLabel` (placeholder `เงินประจำตำแหน่ง`) and a money input for `allowanceAmount`, beside `baseSalary` — the customer's request names that exact page.

- [ ] **Step 2: Validate the pair**

An amount above zero with no label renders as an unnamed line on the payslip. Require a label whenever the amount is non-zero, and treat a zero amount as "no allowance" regardless of label.

- [ ] **Step 3: Audit the change**

Salary-adjacent edits must be auditable. Follow the existing employee-update audit path; the `before`/`after` must carry both fields. If the existing action does not audit `baseSalary` changes, **stop and raise it** — that is a bigger finding than this task.

- [ ] **Step 4: Verify and commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/app/\(admin\)/admin/employees/
git commit -m "feat(admin): edit the position allowance on the employee form"
```

---

## Self-review notes

- **Spec coverage.** Item 5 → Tasks 1, 2, 7. Item 6 → Task 3. Item 7 → Tasks 4 and 5 (leave deliberately excluded per A0.2). Item 8 → Task 6.
- **Ordering is load-bearing.** Task 2 (pay it) precedes Task 3 (lend against it). Reversed, the cap would let an employee draw against money payroll does not yet pay.
- **Two traps recorded as tests, not prose:** the `Math.max(0, monthlyDeductions)` clamp in Task 4 that would silently swallow a net-income month, and the floor turning a positive balance into a fake `overdrawn` state in Task 5.
- **Not in this plan:** leave in the advance cap (gated on `/admin/tools/leave-backlog`), and the SSO treatment of the allowance (with the customer's accountant).
