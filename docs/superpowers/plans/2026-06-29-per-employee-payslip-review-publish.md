# Per-employee Payslip Review + Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a payroll admin click one employee on the run page, review a full formula-level breakdown of how their net pay was computed, and publish + LINE-notify just that person — without touching anyone else's Draft.

**Architecture:** Expand the pure calc engine's `CalcBreakdown` to surface the SSO and attendance sub-amounts it already computes (no behavior change). Add a one-employee serialized view-model (`payrollRowDetail`) and an optional `employeeId` filter on the already-idempotent `publishPayroll`. UI gets a row-click detail modal (formula view) with an in-modal confirm-publish button; the existing bulk button also gains a confirm dialog.

**Tech Stack:** Next.js App Router (server components + server actions), Prisma, `decimal.js`, Vitest (unit + integration against `koolman_test`), next-intl, Tailwind. Existing UI primitives: `Dialog`, `ConfirmDialog` (`ActionResult` contract), `Button`.

## Global Constraints

- **No `Decimal` crosses to the client.** Server view-models pre-format money to strings (the pattern `RowAdjustment` in `row-adjust.tsx` already follows).
- **Engine stays pure & behavior-preserving.** Expanding `CalcBreakdown` must not change any bucket value or `netPay`. Existing `calc.test.ts` assertions must keep passing unchanged.
- **Publish idempotency is sacred.** The `deductedInPayrollId: null` guards (run.ts) and "only touch `Draft` rows" rule must hold for the per-employee path exactly as for the bulk path.
- **Permission split:** `payroll.run` → calculate; `payroll.publish` → publish/lock. Per-employee publish requires `payroll.publish`. Server actions re-enforce regardless of UI.
- **Future-month guard:** publishing a month later than the current Bangkok month is rejected — carry verbatim into the per-employee action.
- **Locked decisions:** per-person action = **Published** (Draft→Published, fires LINE), NOT Locked. Full-formula view is for **Draft rows only**; Published/Locked open read-only from frozen buckets with no recomputed formula.
- **Commits:** project uses a `lint-staged` pre-commit hook. If it errors with `Command "lint-staged" not found`, run `pnpm install` first (Task 0). Co-author trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Test commands:** unit `pnpm test`, integration `pnpm test:integration`.

**Spec:** `docs/superpowers/specs/2026-06-29-per-employee-payslip-review-publish-design.md`

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/lib/payroll/calc.ts` | Expand `CalcBreakdown` type + populate sub-amounts in `calcPayroll` | 1 |
| `src/lib/payroll/calc.test.ts` | Unit cases asserting new sub-amounts reconcile to buckets | 1 |
| `src/lib/payroll/run.ts` | Scope `gatherAndCalc` to one employee; `payrollRowDetail`; `publishPayroll(month, opts)` | 2, 3 |
| `tests/integration/payroll-pipeline.integration.test.ts` | Per-employee publish + `payrollRowDetail` integration cases | 2, 3 |
| `src/app/(admin)/admin/payroll/actions.ts` | `publishOnePayrollAction` server action | 4 |
| `src/app/(admin)/admin/payroll/row-detail.tsx` | Detail modal (formula view) + in-modal confirm publish | 5 |
| `src/app/(admin)/admin/payroll/page.tsx` | Wire row → modal; add confirm to bulk button | 5, 6 |
| `src/app/(admin)/admin/payroll/run-action-form.tsx` | Optional `confirm` prop gating submit | 6 |

---

### Task 0: Ensure dev dependencies are installed

**Files:** none (environment only)

- [ ] **Step 1: Install deps so the pre-commit hook works**

Run: `pnpm install`
Expected: completes; `node_modules/.bin/lint-staged` now exists. (If the repo is already fully installed and `git commit` succeeds without the `lint-staged not found` error, this task is a no-op.)

---

### Task 1: Expand `CalcBreakdown` with computed sub-amounts

**Files:**
- Modify: `src/lib/payroll/calc.ts` (type at `:151-158`; `calcPayroll` return at `:381-394`)
- Test: `src/lib/payroll/calc.test.ts`

**Interfaces:**
- Consumes: existing `calcPayroll(input: CalcInput): PayrollDraft`, `calcSso`, `computeLatePenalty`.
- Produces: the expanded `CalcBreakdown` shape below (later tasks read `draft.breakdown.sso.*` and `draft.breakdown.attendance.*`).

```ts
export type CalcBreakdown = {
  absentCount: number;
  lateCount: number;
  earlyLeaveCount: number;
  sso: {
    cappedBase: Decimal;
    rate: Decimal;
    rawAmount: Decimal;
    amountCap: Decimal;
    applied: Decimal;
  };
  attendance: {
    absent: { count: number; perDay: Decimal; money: Decimal };
    lateTier1: {
      mode: 'threeStrike' | 'flat';
      count: number;
      threeStrikeCount?: number;
      days?: number;
      perUnit: Decimal;
      money: Decimal;
    };
    lateSevere: { days: number; perDay: Decimal; money: Decimal };
    earlyLeave: { count: number; perUnit: Decimal; money: Decimal };
  };
};
```

- [ ] **Step 1: Write failing tests for the new sub-amounts**

Add to `src/lib/payroll/calc.test.ts` (uses the existing `DEFAULT_CONFIG` + `calcPayroll` import already in the file):

```ts
describe('CalcBreakdown sub-amounts', () => {
  const base = {
    employee: { id: 'e1', salaryType: 'Monthly' as const, baseSalary: '20000', hasSso: true },
    advances: [],
    recurringDeductions: [],
    config: DEFAULT_CONFIG,
    month: '2026-06',
  };

  it('SSO: salary above the cap binds cappedBase + amountCap', () => {
    const d = calcPayroll({ ...base, attendances: [] });
    expect(d.breakdown.sso.cappedBase.toString()).toBe('15000'); // min(20000,15000)
    expect(d.breakdown.sso.rate.toString()).toBe('0.05');
    expect(d.breakdown.sso.rawAmount.toString()).toBe('750');
    expect(d.breakdown.sso.applied.toString()).toBe(d.deductSso.toString());
  });

  it('attendance sub-amounts reconcile to deductAttendance (flat lateness)', () => {
    const atts: AttendanceForPayroll[] = [
      { date: new Date('2026-06-02'), type: 'Absent', durationMinutes: null },
      { date: new Date('2026-06-03'), type: 'Late', durationMinutes: 10 },
      { date: new Date('2026-06-04'), type: 'EarlyLeave', durationMinutes: 20 },
    ];
    const d = calcPayroll({ ...base, attendances: atts });
    const b = d.breakdown.attendance;
    expect(b.absent.money.toString()).toBe('500');      // 1 × 500
    expect(b.lateTier1.mode).toBe('flat');
    expect(b.lateTier1.money.toString()).toBe('100');    // 1 × 100
    expect(b.earlyLeave.money.toString()).toBe('100');   // 1 × 100
    const sum = b.absent.money
      .plus(b.lateTier1.money).plus(b.lateSevere.money).plus(b.earlyLeave.money);
    expect(sum.toString()).toBe(d.deductAttendance.toString());
  });

  it('threeStrike mode: 3 tier-1 lates → 1 day, remainder carries no charge', () => {
    const atts: AttendanceForPayroll[] = [1, 2, 3, 6].map((day) => ({
      date: new Date(`2026-06-0${day}`),
      type: 'Late' as const,
      durationMinutes: 5, // below severe threshold
    }));
    const d = calcPayroll({
      ...base,
      attendances: atts,
      config: { ...DEFAULT_CONFIG, lateThreeStrikeEnabled: true, lateThreeStrikeCount: 3 },
    });
    const t1 = d.breakdown.attendance.lateTier1;
    expect(t1.mode).toBe('threeStrike');
    expect(t1.count).toBe(4);
    expect(t1.threeStrikeCount).toBe(3);
    expect(t1.days).toBe(1);                 // floor(4/3)
    expect(t1.money.toString()).toBe('500'); // 1 day × 500
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test src/lib/payroll/calc.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'cappedBase')` (breakdown lacks `sso`).

- [ ] **Step 3: Refactor `calcSso` to expose its components, and populate the breakdown**

In `src/lib/payroll/calc.ts`, add a helper that returns the SSO parts (keep `calcSso` as-is for its other callers/tests by having it delegate):

```ts
export function calcSsoParts(
  baseSalary: Decimal,
  config: Pick<ConfigForPayroll, 'ssoRate' | 'ssoSalaryCap' | 'ssoAmountCap'>,
): { cappedBase: Decimal; rate: Decimal; rawAmount: Decimal; amountCap: Decimal; applied: Decimal } {
  const cappedBase = Decimal.min(baseSalary, toDec(config.ssoSalaryCap));
  const rate = toDec(config.ssoRate);
  const rawAmount = cappedBase.times(rate);
  const amountCap = toDec(config.ssoAmountCap);
  const applied = Decimal.min(rawAmount, amountCap).toDecimalPlaces(2);
  return { cappedBase, rate, rawAmount, amountCap, applied };
}

export function calcSso(
  baseSalary: Decimal,
  config: Pick<ConfigForPayroll, 'ssoRate' | 'ssoSalaryCap' | 'ssoAmountCap'>,
): Decimal {
  return calcSsoParts(baseSalary, config).applied;
}
```

Then in `calcPayroll`, replace the SSO line and assemble the breakdown. The attendance money pieces already exist as locals (`dayAmount`, `tier1LateMoney`, `severeLateMoney`, `absentCount`, `earlyLeaveCount`); reuse them:

```ts
// SSO deduction — compute parts once, use `.applied` as the bucket.
const ssoParts = input.employee.hasSso
  ? calcSsoParts(baseSalary, input.config)
  : { cappedBase: new Decimal(0), rate: toDec(input.config.ssoRate), rawAmount: new Decimal(0), amountCap: toDec(input.config.ssoAmountCap), applied: new Decimal(0) };
const deductSso = ssoParts.applied;
```

```ts
// ...after deductAttendance is computed, before `return`:
const earlyLeaveMoney = toDec(cfg.earlyLeaveDeduction).times(earlyLeaveCount);
const breakdown: CalcBreakdown = {
  absentCount,
  lateCount,
  earlyLeaveCount,
  sso: ssoParts,
  attendance: {
    absent: { count: absentCount, perDay: dayAmount, money: dayAmount.times(absentCount).toDecimalPlaces(2) },
    lateTier1: latePolicy.threeStrikeEnabled
      ? {
          mode: 'threeStrike',
          count: latePenalty.tier1Count,
          threeStrikeCount: latePolicy.threeStrikeCount,
          days: latePenalty.threeStrikeDays,
          perUnit: dayAmount,
          money: tier1LateMoney.toDecimalPlaces(2),
        }
      : {
          mode: 'flat',
          count: latePenalty.tier1Count,
          perUnit: toDec(cfg.lateDeduction),
          money: tier1LateMoney.toDecimalPlaces(2),
        },
    lateSevere: { days: latePenalty.severeDays, perDay: dayAmount, money: severeLateMoney.toDecimalPlaces(2) },
    earlyLeave: { count: earlyLeaveCount, perUnit: toDec(cfg.earlyLeaveDeduction), money: earlyLeaveMoney.toDecimalPlaces(2) },
  },
};
```

Update the `return` object's `breakdown:` field to use this `breakdown` constant (replacing `breakdown: { absentCount, lateCount, earlyLeaveCount }`).

- [ ] **Step 4: Run the full calc suite, verify pass**

Run: `pnpm test src/lib/payroll/calc.test.ts`
Expected: PASS — new cases green AND all pre-existing cases still green (no bucket/net changed).

- [ ] **Step 5: Commit**

```bash
git add src/lib/payroll/calc.ts src/lib/payroll/calc.test.ts
git commit -m "feat(payroll): expose SSO + attendance sub-amounts on CalcBreakdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Scope `gatherAndCalc` to one employee + add `payrollRowDetail`

**Files:**
- Modify: `src/lib/payroll/run.ts` (`gatherAndCalc` at `:61`; add `PayrollRowDetail` type + `payrollRowDetail`)
- Test: `tests/integration/payroll-pipeline.integration.test.ts`

**Interfaces:**
- Consumes: expanded `draft.breakdown` from Task 1; existing `gatherAndCalc` internals (advances, recurring, leave sweep, adjustments per employee).
- Produces:
```ts
export type SerializedBreakdown = {
  sso: { cappedBase: string; rate: string; rawAmount: string; amountCap: string; applied: string; capped: boolean };
  attendance: {
    absent: { count: number; perDay: string; money: string };
    lateTier1: { mode: 'threeStrike' | 'flat'; count: number; threeStrikeCount?: number; days?: number; perUnit: string; money: string };
    lateSevere: { days: number; perDay: string; money: string };
    earlyLeave: { count: number; perUnit: string; money: string };
  };
};
export type PayrollRowDetail = {
  employeeId: string;
  month: string;
  incomeBase: string;
  incomeOther: string;
  adjustments: { reason: string; kind: 'Income' | 'Deduction'; amount: string }[];
  deductSso: string;
  advances: { amount: string }[];
  debts: { amount: string }[];
  leaveDeductions: { deduct: string; overMinutes: number }[];
  deductAttendance: string;
  deductLeave: string;
  netPay: string;
  breakdown: SerializedBreakdown;
};
export async function payrollRowDetail(month: string, employeeId: string): Promise<PayrollRowDetail | null>;
```

- [ ] **Step 1: Add an optional employee scope to `gatherAndCalc`**

In `src/lib/payroll/run.ts`, change the signature and the employee query:

```ts
async function gatherAndCalc(db: Tx | typeof prisma, month: string, employeeId?: string) {
  // ...
  const employees = await db.employee.findMany({
    where: { status: { not: 'Archived' }, ...(employeeId ? { id: employeeId } : {}) },
    select: { /* unchanged */ },
  });
  // ...everything downstream already keys by employee id — no other change.
}
```

(The `adjustments`/`advances`/etc. queries filter by `employeeId: { in: empIds }`, which is now a 1-element list when scoped — correct and cheap.)

- [ ] **Step 2: Write the failing integration test for `payrollRowDetail`**

Add to `tests/integration/payroll-pipeline.integration.test.ts` (reuses `reset()`, `makeEmployee`, `MONTH`, `inMonth`, `uid` already in the file; import `payrollRowDetail` from `@/lib/payroll/run`):

```ts
describe('payrollRowDetail', () => {
  beforeEach(reset);

  it('returns a serialized VM (no Decimal) whose lines reconcile to net', async () => {
    const emp = await makeEmployee({ baseSalary: 20000, hasSso: true });
    await prisma.attendance.create({
      data: { employeeId: emp.id, date: inMonth, type: 'Absent', durationMinutes: null },
    });
    await prisma.payrollAdjustment.create({
      data: { employeeId: emp.id, kind: 'Income', reason: 'ค่าคอม', amount: new Prisma.Decimal(1000), startMonth: MONTH, endMonth: MONTH },
    });

    const detail = await payrollRowDetail(MONTH, emp.id);
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(typeof detail.netPay).toBe('string'); // serialized
    expect(detail.adjustments).toEqual([{ reason: 'ค่าคอม', kind: 'Income', amount: '1000.00' }]);
    expect(detail.breakdown.sso.applied).toBe('750.00');
    expect(detail.breakdown.attendance.absent.money).toBe('500.00');
    // 20000 + 1000 - 750(sso) - 500(absent) = 19750
    expect(detail.netPay).toBe('19750.00');
  });

  it('returns null when the employee has no computable row', async () => {
    expect(await payrollRowDetail(MONTH, uid())).toBeNull();
  });
});
```

- [ ] **Step 3: Run it, verify failure**

Run: `pnpm test:integration tests/integration/payroll-pipeline.integration.test.ts -t payrollRowDetail`
Expected: FAIL — `payrollRowDetail is not a function` / import error.

- [ ] **Step 4: Implement `payrollRowDetail`**

Add to `src/lib/payroll/run.ts`. It gathers the single employee, then maps the draft + its source rows to formatted strings. A small `money(d)` helper formats to 2dp:

```ts
// Structural param avoids importing decimal.js's Decimal type into run.ts —
// both Prisma.Decimal and decimal.js Decimal satisfy { toString(): string }.
const money = (d: { toString(): string }) => new Prisma.Decimal(d.toString()).toFixed(2);

export async function payrollRowDetail(
  month: string,
  employeeId: string,
): Promise<PayrollRowDetail | null> {
  const { drafts } = await gatherAndCalc(prisma, month, employeeId);
  const entry = drafts[0];
  if (!entry) return null;
  const { draft } = entry;
  const b = draft.breakdown;

  // Source-row line lists (the calc engine only sees amounts; reasons/ids live here).
  const adjustments = (
    await prisma.payrollAdjustment.findMany({
      where: {
        employeeId,
        startMonth: { lte: month },
        OR: [{ endMonth: null }, { endMonth: { gte: month } }],
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, reason: true, amount: true, startMonth: true, endMonth: true },
    })
  )
    .filter((a) => adjustmentAppliesToMonth(a, month))
    .map((a) => ({ reason: a.reason, kind: a.kind as 'Income' | 'Deduction', amount: money(a.amount) }));

  return {
    employeeId,
    month,
    incomeBase: money(draft.incomeBase),
    incomeOther: money(draft.incomeOther),
    adjustments,
    deductSso: money(draft.deductSso),
    advances: (entry.sweptAdvanceIds.length
      ? await prisma.cashAdvance.findMany({ where: { id: { in: entry.sweptAdvanceIds } }, select: { amount: true } })
      : []
    ).map((a) => ({ amount: money(a.amount) })),
    debts: (entry.appliedRecurring.length
      ? await prisma.recurringDeduction.findMany({ where: { id: { in: entry.appliedRecurring.map((r) => r.id) } }, select: { monthlyAmount: true } })
      : []
    ).map((r) => ({ amount: money(r.monthlyAmount) })),
    leaveDeductions: entry.sweptLeaves.map((l) => ({ deduct: money(l.deduct), overMinutes: l.over })),
    deductAttendance: money(draft.deductAttendance),
    deductLeave: money(draft.deductLeave),
    netPay: money(draft.netPay),
    breakdown: {
      sso: {
        cappedBase: money(b.sso.cappedBase),
        rate: b.sso.rate.toString(),
        rawAmount: money(b.sso.rawAmount),
        amountCap: money(b.sso.amountCap),
        applied: money(b.sso.applied),
        capped: b.sso.rawAmount.greaterThan(b.sso.amountCap),
      },
      attendance: {
        absent: { count: b.attendance.absent.count, perDay: money(b.attendance.absent.perDay), money: money(b.attendance.absent.money) },
        lateTier1: {
          mode: b.attendance.lateTier1.mode,
          count: b.attendance.lateTier1.count,
          threeStrikeCount: b.attendance.lateTier1.threeStrikeCount,
          days: b.attendance.lateTier1.days,
          perUnit: money(b.attendance.lateTier1.perUnit),
          money: money(b.attendance.lateTier1.money),
        },
        lateSevere: { days: b.attendance.lateSevere.days, perDay: money(b.attendance.lateSevere.perDay), money: money(b.attendance.lateSevere.money) },
        earlyLeave: { count: b.attendance.earlyLeave.count, perUnit: money(b.attendance.earlyLeave.perUnit), money: money(b.attendance.earlyLeave.money) },
      },
    },
  };
}
```

Add the `PayrollRowDetail` / `SerializedBreakdown` type exports (from the Interfaces block) near the other exported types in `run.ts`. Ensure `adjustmentAppliesToMonth` is already imported (it is, at the top of `run.ts`).

- [ ] **Step 5: Run the integration test, verify pass**

Run: `pnpm test:integration tests/integration/payroll-pipeline.integration.test.ts -t payrollRowDetail`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/payroll/run.ts tests/integration/payroll-pipeline.integration.test.ts
git commit -m "feat(payroll): payrollRowDetail one-employee serialized view-model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Add an `employeeId` filter to `publishPayroll`

**Files:**
- Modify: `src/lib/payroll/run.ts` (`publishPayroll` at `:344`)
- Test: `tests/integration/payroll-pipeline.integration.test.ts`

**Interfaces:**
- Consumes: scoped `gatherAndCalc` from Task 2.
- Produces: `publishPayroll(month: string, opts?: { employeeId?: string }): Promise<PublishResult>` — when `opts.employeeId` is set, exactly that one Draft row is published; others stay Draft.

- [ ] **Step 1: Write the failing integration test**

Add to `tests/integration/payroll-pipeline.integration.test.ts`:

```ts
describe('publishPayroll per-employee', () => {
  beforeEach(reset);

  it('publishes one employee, leaves the other as Draft', async () => {
    const a = await makeEmployee({ baseSalary: 20000, hasSso: true });
    const b = await makeEmployee({ baseSalary: 18000, hasSso: true });
    await runPayrollDraft(MONTH);

    const res = await publishPayroll(MONTH, { employeeId: a.id });
    expect(res.published.map((p) => p.employeeId)).toEqual([a.id]);

    const rowA = await prisma.payroll.findUnique({ where: { employeeId_month: { employeeId: a.id, month: MONTH } } });
    const rowB = await prisma.payroll.findUnique({ where: { employeeId_month: { employeeId: b.id, month: MONTH } } });
    expect(rowA?.status).toBe('Published');
    expect(rowB?.status).toBe('Draft');
  });

  it('only sweeps the targeted employee advances; re-publish is a no-op', async () => {
    const a = await makeEmployee({ baseSalary: 20000, hasSso: false });
    const b = await makeEmployee({ baseSalary: 20000, hasSso: false });
    const advA = await prisma.cashAdvance.create({ data: { employeeId: a.id, amount: new Prisma.Decimal(1000), status: 'Approved', isDeducted: false } });
    const advB = await prisma.cashAdvance.create({ data: { employeeId: b.id, amount: new Prisma.Decimal(1000), status: 'Approved', isDeducted: false } });

    await publishPayroll(MONTH, { employeeId: a.id });
    expect((await prisma.cashAdvance.findUnique({ where: { id: advA.id } }))?.isDeducted).toBe(true);
    expect((await prisma.cashAdvance.findUnique({ where: { id: advB.id } }))?.isDeducted).toBe(false);

    const again = await publishPayroll(MONTH, { employeeId: a.id });
    expect(again.published).toHaveLength(0); // already Published — skipped
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `pnpm test:integration tests/integration/payroll-pipeline.integration.test.ts -t "publishPayroll per-employee"`
Expected: FAIL — `publishPayroll` ignores the 2nd arg, publishes both → `toEqual([a.id])` fails.

- [ ] **Step 3: Thread `opts.employeeId` into `publishPayroll`**

In `src/lib/payroll/run.ts`, change the signature and pass it to `gatherAndCalc`:

```ts
export async function publishPayroll(
  month: string,
  opts?: { employeeId?: string },
): Promise<PublishResult> {
  const result = await prisma.$transaction(async (tx) => {
    const { drafts, skipped } = await gatherAndCalc(tx, month, opts?.employeeId);
    // ...unchanged body...
  });
  // ...unchanged PDF invalidation + return...
}
```

No other change — the existing loop already publishes whatever `drafts` contains and skips non-Draft rows.

- [ ] **Step 4: Run the test, verify pass; then run the WHOLE integration file to confirm no regression**

Run: `pnpm test:integration tests/integration/payroll-pipeline.integration.test.ts`
Expected: PASS — new per-employee cases green, all pre-existing publish/sweep/idempotency cases still green (bulk `publishPayroll(month)` calls `gatherAndCalc(tx, month, undefined)` → unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add src/lib/payroll/run.ts tests/integration/payroll-pipeline.integration.test.ts
git commit -m "feat(payroll): optional employeeId filter on publishPayroll

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `publishOnePayrollAction` server action

**Files:**
- Modify: `src/app/(admin)/admin/payroll/actions.ts` (add action; import `ActionResult` type)
- Test: covered by the integration test in Task 3 for the engine; the action itself is a thin permission/guard wrapper validated by the existing gate-test pattern + manual run in Task 6.

**Interfaces:**
- Consumes: `publishPayroll(month, { employeeId })`, `notifyPublishedSlips`, `requirePermission('payroll.publish')`, `auditLog`.
- Produces: `publishOnePayrollAction(employeeId: string, month: string): Promise<ActionResult>` where `ActionResult = { ok: true } | { ok: false; message: string }` (re-exported from `@/components/ui/confirm-dialog`).

- [ ] **Step 1: Implement the action**

Add to `src/app/(admin)/admin/payroll/actions.ts` (note: this action returns `ActionResult` and is driven by `ConfirmDialog`, so it does NOT `redirect` — it `revalidatePath` + returns):

```ts
import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/components/ui/confirm-dialog';
// (publishPayroll, notifyPublishedSlips already imported from '@/lib/payroll/run')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function publishOnePayrollAction(
  employeeId: string,
  month: string,
): Promise<ActionResult> {
  const { user } = await requirePermission('payroll.publish');
  if (!MONTH_RE.test(month)) return { ok: false, message: 'เดือนไม่ถูกต้อง' };
  if (!UUID_RE.test(employeeId)) return { ok: false, message: 'พนักงานไม่ถูกต้อง' };
  if (month > currentMonthBkk()) {
    return { ok: false, message: 'ยังเผยแพร่เดือนล่วงหน้าไม่ได้ — เผยแพร่ได้ไม่เกินเดือนปัจจุบัน' };
  }

  const result = await publishPayroll(month, { employeeId });
  if (result.published.length === 0) {
    return { ok: false, message: 'ไม่มีสลิปฉบับร่างให้เผยแพร่ (อาจเผยแพร่ไปแล้ว)' };
  }
  await notifyPublishedSlips(month, result.published);

  auditLog({
    actorId: user.id,
    action: 'payroll.publish',
    entityType: 'Payroll',
    entityId: month,
    metadata: { source: 'admin-ui', via: 'per-employee', employeeId, published: result.published.length },
  });

  revalidatePath('/admin/payroll');
  return { ok: true };
}
```

(`MONTH_RE` and `currentMonthBkk` already exist in this file.)

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no type errors). If `pnpm exec tsc` is not wired, run `pnpm lint` or the repo's typecheck script.

- [ ] **Step 3: Commit**

```bash
git add src/app/(admin)/admin/payroll/actions.ts
git commit -m "feat(payroll): publishOnePayrollAction (per-employee publish + audit)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Detail modal with formula view + in-modal confirm publish

**Files:**
- Create: `src/app/(admin)/admin/payroll/row-detail.tsx`
- Modify: `src/app/(admin)/admin/payroll/page.tsx` (load detail per row; render `RowDetail` in the table `actions` or row-click)
- Modify: `messages/en.json`, `messages/th.json` (modal copy) — match existing `payslip`/`payrollPdf` key style

**Interfaces:**
- Consumes: `PayrollRowDetail` (Task 2), `publishOnePayrollAction` (Task 4), `ConfirmDialog`, `Dialog`, `Button`.
- Produces: `<RowDetail ... detail={PayrollRowDetail | null} frozen={FrozenSlipVM | null} canPublish={boolean} publishAction={...} />`.
- Defines `FrozenSlipVM` — the **stored-row** view for Published/Locked (no live recompute, no formula, decision #5):
```ts
export type FrozenSlipVM = {
  incomeBase: string;
  incomeOther: string;   // '0.00' when none
  deductSso: string;
  deductAttendance: string;
  deductLeave: string;
  deductAdvance: string;
  deductDebt: string;
  deductOther: string;
  netPay: string;
};
```
The page builds `FrozenSlipVM` **inline from the persisted `Payroll` row `r`** (all buckets already on it) — no engine call. Draft rows get `detail` (live, with formula); Published/Locked rows get `frozen`.

- [ ] **Step 1: Build the `RowDetail` client component**

Create `src/app/(admin)/admin/payroll/row-detail.tsx`. It mirrors the `row-adjust.tsx` shape (a trigger button/cell + a `Dialog`), renders the formula lines from `detail.breakdown`, and — only when `canPublish && status === 'Draft'` — a `ConfirmDialog`-wrapped publish button:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { type ActionResult, ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';

export type RowDetailVM = import('@/lib/payroll/run').PayrollRowDetail;
export type FrozenSlipVM = {
  incomeBase: string; incomeOther: string;
  deductSso: string; deductAttendance: string; deductLeave: string;
  deductAdvance: string; deductDebt: string; deductOther: string;
  netPay: string;
};

type Props = {
  employeeName: string;
  status: 'Draft' | 'Published' | 'Locked';
  monthLabel: string;
  month: string;
  employeeId: string;
  /** Live, formula-bearing view — Draft rows only. */
  detail: RowDetailVM | null;
  /** Frozen stored buckets — Published/Locked rows only (no recompute). */
  frozen: FrozenSlipVM | null;
  canPublish: boolean;
  publishAction: (employeeId: string, month: string) => Promise<ActionResult>;
};

function Line({ label, formula, value }: { label: string; formula?: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <div className="min-w-0">
        <span className="text-ink-1">{label}</span>
        {formula && <span className="ml-2 text-[11px] text-ink-4">{formula}</span>}
      </div>
      <span className="shrink-0 font-mono text-ink-2">{value}</span>
    </div>
  );
}

export function RowDetail({ employeeName, status, monthLabel, month, employeeId, detail, canPublish, publishAction }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        ดูรายละเอียด
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`สลิปเงินเดือน — ${employeeName}`} className="sm:max-w-lg">
        <p className="mt-1 text-xs text-ink-3">งวด {monthLabel}</p>
        {status === 'Draft' && detail ? (
          <div className="mt-4 space-y-4">
            {/* รายได้ */}
            <section>
              <h3 className="text-xs font-semibold text-ink-3">รายได้</h3>
              <Line label="ฐานเงินเดือน" value={detail.incomeBase} />
              {detail.adjustments.filter((a) => a.kind === 'Income').map((a, i) => (
                <Line key={`inc-${i}`} label={a.reason} value={`+${a.amount}`} />
              ))}
            </section>
            {/* รายการหัก — with formulas */}
            <section className="border-t border-gray-100 pt-3">
              <h3 className="text-xs font-semibold text-ink-3">รายการหัก</h3>
              {detail.breakdown.sso.applied !== '0.00' && (
                <Line
                  label="ประกันสังคม"
                  formula={`${detail.breakdown.sso.cappedBase} × ${detail.breakdown.sso.rate}${detail.breakdown.sso.capped ? ` (สูงสุด ${detail.breakdown.sso.amountCap})` : ''}`}
                  value={`-${detail.breakdown.sso.applied}`}
                />
              )}
              {detail.breakdown.attendance.absent.money !== '0.00' && (
                <Line label="ขาดงาน" formula={`${detail.breakdown.attendance.absent.count} วัน × ${detail.breakdown.attendance.absent.perDay}`} value={`-${detail.breakdown.attendance.absent.money}`} />
              )}
              {detail.breakdown.attendance.lateTier1.money !== '0.00' && (
                <Line
                  label="มาสาย"
                  formula={detail.breakdown.attendance.lateTier1.mode === 'threeStrike'
                    ? `${detail.breakdown.attendance.lateTier1.count} ครั้ง → ${detail.breakdown.attendance.lateTier1.days} วัน × ${detail.breakdown.attendance.lateTier1.perUnit}`
                    : `${detail.breakdown.attendance.lateTier1.count} ครั้ง × ${detail.breakdown.attendance.lateTier1.perUnit}`}
                  value={`-${detail.breakdown.attendance.lateTier1.money}`}
                />
              )}
              {detail.breakdown.attendance.lateSevere.money !== '0.00' && (
                <Line label="มาสายรุนแรง" formula={`${detail.breakdown.attendance.lateSevere.days} วัน × ${detail.breakdown.attendance.lateSevere.perDay}`} value={`-${detail.breakdown.attendance.lateSevere.money}`} />
              )}
              {detail.breakdown.attendance.earlyLeave.money !== '0.00' && (
                <Line label="ออกก่อนเวลา" formula={`${detail.breakdown.attendance.earlyLeave.count} ครั้ง × ${detail.breakdown.attendance.earlyLeave.perUnit}`} value={`-${detail.breakdown.attendance.earlyLeave.money}`} />
              )}
              {detail.advances.map((a, i) => (<Line key={`adv-${i}`} label="หักเบิกล่วงหน้า" value={`-${a.amount}`} />))}
              {detail.debts.map((d, i) => (<Line key={`debt-${i}`} label="หักหนี้/ผ่อน" value={`-${d.amount}`} />))}
              {detail.leaveDeductions.map((l, i) => (<Line key={`lv-${i}`} label="ลาเกินสิทธิ" formula={`เกิน ${l.overMinutes} นาที`} value={`-${l.deduct}`} />))}
              {detail.adjustments.filter((a) => a.kind === 'Deduction').map((a, i) => (<Line key={`ded-${i}`} label={a.reason} value={`-${a.amount}`} />))}
            </section>
            {/* สุทธิ */}
            <section className="flex items-baseline justify-between border-t border-gray-200 pt-3">
              <span className="text-sm font-semibold text-ink-1">เงินสุทธิ</span>
              <span className="font-mono text-lg font-bold text-primary-700">{detail.netPay}</span>
            </section>
          </div>
        ) : frozen ? (
          /* Published/Locked — frozen stored buckets, no formula, no recompute. */
          <div className="mt-4 space-y-4">
            <section>
              <h3 className="text-xs font-semibold text-ink-3">รายได้</h3>
              <Line label="ฐานเงินเดือน" value={frozen.incomeBase} />
              {frozen.incomeOther !== '0.00' && <Line label="เงินเพิ่ม" value={`+${frozen.incomeOther}`} />}
            </section>
            <section className="border-t border-gray-100 pt-3">
              <h3 className="text-xs font-semibold text-ink-3">รายการหัก</h3>
              {frozen.deductSso !== '0.00' && <Line label="ประกันสังคม" value={`-${frozen.deductSso}`} />}
              {frozen.deductAttendance !== '0.00' && <Line label="หักขาด/ลา/สาย" value={`-${frozen.deductAttendance}`} />}
              {frozen.deductLeave !== '0.00' && <Line label="ลาเกินสิทธิ" value={`-${frozen.deductLeave}`} />}
              {frozen.deductAdvance !== '0.00' && <Line label="หักเบิกล่วงหน้า" value={`-${frozen.deductAdvance}`} />}
              {frozen.deductDebt !== '0.00' && <Line label="หักหนี้/ผ่อน" value={`-${frozen.deductDebt}`} />}
              {frozen.deductOther !== '0.00' && <Line label="หักอื่น ๆ" value={`-${frozen.deductOther}`} />}
            </section>
            <section className="flex items-baseline justify-between border-t border-gray-200 pt-3">
              <span className="text-sm font-semibold text-ink-1">เงินสุทธิ</span>
              <span className="font-mono text-lg font-bold text-primary-700">{frozen.netPay}</span>
            </section>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-3">ไม่มีข้อมูลการคำนวณสำหรับงวดนี้</p>
        )}

        {canPublish && status === 'Draft' && detail && (
          <div className="mt-5 flex justify-end border-t border-gray-100 pt-4">
            <ConfirmDialog
              trigger={(openConfirm) => (
                <Button type="button" onClick={openConfirm}>เผยแพร่ + ส่งสลิป</Button>
              )}
              title="เผยแพร่สลิปและส่ง LINE?"
              description={`เผยแพร่สลิปของ ${employeeName} งวด ${monthLabel} และส่งแจ้งเตือน LINE ถึงพนักงาน — ดำเนินการแล้วย้อนกลับไม่ได้`}
              confirmLabel="เผยแพร่ + ส่ง LINE"
              tone="primary"
              action={() => publishAction(employeeId, month)}
            />
          </div>
        )}
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Wire the modal into the page**

In `src/app/(admin)/admin/payroll/page.tsx`:
1. Import `RowDetail` and `payrollRowDetail`, and `publishOnePayrollAction` from `./actions`.
2. After `visibleRows` is computed, load **live detail for Draft rows only** (Published/Locked use frozen buckets — decision #5). The run table is per-month, so this is bounded:

```ts
import { type FrozenSlipVM } from './row-detail';
import { payrollRowDetail } from '@/lib/payroll/run';
import { publishOnePayrollAction } from './actions';
import { RowDetail } from './row-detail';
// ...
// Live recompute ONLY for Draft rows.
const draftDetailByEmp = new Map(
  await Promise.all(
    visibleRows
      .filter((r) => r.status === 'Draft')
      .map(async (r) => [r.employeeId, await payrollRowDetail(month, r.employeeId)] as const),
  ),
);
// Frozen buckets straight off the persisted row — NO engine call.
const frozenOf = (r: (typeof rows)[number]): FrozenSlipVM => ({
  incomeBase: r.incomeBase.toFixed(2),
  incomeOther: r.incomeOther.toFixed(2),
  deductSso: r.deductSso.toFixed(2),
  deductAttendance: r.deductAttendance.toFixed(2),
  deductLeave: r.deductLeave.toFixed(2),
  deductAdvance: r.deductAdvance.toFixed(2),
  deductDebt: r.deductDebt.toFixed(2),
  deductOther: r.deductOther.toFixed(2),
  netPay: r.netPay.toFixed(2),
});
```

3. In the `ResponsiveTable` `actions={(r) => ...}`, render `RowDetail` alongside the existing `RowAdjust` (keep both):

```tsx
actions={(r) => (
  <div className="flex items-center gap-2">
    <RowDetail
      employeeName={`${r.employee.firstName} ${r.employee.lastName}`}
      status={r.status as 'Draft' | 'Published' | 'Locked'}
      monthLabel={monthLabelTh(month)}
      month={month}
      employeeId={r.employeeId}
      detail={r.status === 'Draft' ? (draftDetailByEmp.get(r.employeeId) ?? null) : null}
      frozen={r.status === 'Draft' ? null : frozenOf(r)}
      canPublish={mayPublish}
      publishAction={publishOnePayrollAction}
    />
    {r.status === 'Draft' && mayRun ? (
      <RowAdjust /* ...existing props unchanged... */ />
    ) : null}
  </div>
)}
```

- [ ] **Step 3: i18n — keep copy inline (no message keys)**

The admin payroll surface is Thai-only and inline: `page.tsx`, `row-adjust.tsx`, and `run-action-form.tsx` all hard-code Thai strings rather than using `next-intl` keys. Follow that established pattern — keep the modal/confirm copy inline as written in Steps 1–2. **No `messages/*.json` edits.** (The employee-facing LIFF payslip uses keys because it is bilingual; the admin run page is not.)

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/payroll/row-detail.tsx src/app/\(admin\)/admin/payroll/page.tsx
git commit -m "feat(payroll): per-employee detail modal with formula view + confirm publish

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wrap the bulk publish button in a confirm dialog + manual verification

**Files:**
- Modify: `src/app/(admin)/admin/payroll/page.tsx` (the bulk `publishPayrollAction` button at `:423-431`)
- Modify (if needed): `src/app/(admin)/admin/payroll/run-action-form.tsx` (add an optional `confirm` prop)

**Interfaces:**
- Consumes: existing `RunActionForm` + `publishPayrollAction`.
- Produces: the bulk publish button now shows a confirm before submitting.

- [ ] **Step 1: Add an optional confirm to `RunActionForm`**

`run-action-form.tsx` is a `<form action={serverAction}>` with a hidden `month` input and a `useFormStatus` submit button that shows a blocking modal while the action runs (do NOT lose that modal). Add an optional `confirm` prop. When present, the submit button becomes a plain button that opens a confirm `Dialog`; confirming calls `form.requestSubmit()` so the real server-action submit (and its existing pending modal) still fire. Edit `run-action-form.tsx` to this:

```tsx
'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DialogFooter } from '@/components/ui/dialog-footer';

type Confirm = { title: string; description: string; confirmLabel: string };

type Props = {
  action: (formData: FormData) => Promise<void>;
  month: string;
  label: string;
  pendingLabel: string;
  variant?: 'primary' | 'secondary';
  attention?: boolean;
  /** When set, a confirm dialog gates the submit. */
  confirm?: Confirm;
};

function Inner({
  label,
  pendingLabel,
  variant,
  attention,
  confirm,
}: Omit<Props, 'action' | 'month'>) {
  const { pending } = useFormStatus();
  const [ask, setAsk] = useState(false);

  return (
    <>
      {confirm ? (
        <Button
          type="button"
          variant={attention ? 'attention' : variant}
          disabled={pending}
          onClick={() => setAsk(true)}
        >
          {attention ? `⚠ ${label}` : label}
        </Button>
      ) : (
        <Button type="submit" variant={attention ? 'attention' : variant} disabled={pending}>
          {attention ? `⚠ ${label}` : label}
        </Button>
      )}

      {confirm && (
        <Dialog open={ask} onClose={() => setAsk(false)} title={confirm.title} className="sm:max-w-md">
          <p className="mt-2 text-sm text-ink-2">{confirm.description}</p>
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAsk(false)}>
              ยกเลิก
            </Button>
            {/* Real submit: closing first lets the pending modal below take over. */}
            <Button type="submit" size="sm" onClick={() => setAsk(false)}>
              {confirm.confirmLabel}
            </Button>
          </DialogFooter>
        </Dialog>
      )}

      <Dialog open={pending} onClose={() => {}} dismissable={false}>
        <div className="flex flex-col items-center gap-4 py-4">
          <span
            className="size-10 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-ink-1">{pendingLabel}</p>
          <p className="text-xs text-ink-3">กรุณารอสักครู่ อย่าปิดหน้านี้</p>
        </div>
      </Dialog>
    </>
  );
}

export function RunActionForm({ action, month, label, pendingLabel, variant, attention, confirm }: Props) {
  return (
    <form action={action}>
      <input type="hidden" name="month" value={month} />
      <Inner label={label} pendingLabel={pendingLabel} variant={variant} attention={attention} confirm={confirm} />
    </form>
  );
}
```

Note: the confirm dialog's confirm button is itself a `type="submit"` **inside the same form**, so clicking it submits the server action directly. `setAsk(false)` runs first so only the pending modal remains visible. The no-confirm path (คำนวณ/ล็อก) is unchanged.

- [ ] **Step 2: Apply the confirm to the bulk publish button only**

In `page.tsx`, pass the `confirm` config to the bulk publish `RunActionForm` (the `calculatePayrollAction` and `lockPayrollAction` buttons stay confirm-free):

```tsx
<RunActionForm
  action={publishPayrollAction}
  month={month}
  label={`เผยแพร่สลิป + แจ้งเตือน LINE (${statusCounts.Draft} คน)`}
  pendingLabel="กำลังเผยแพร่สลิปและส่งแจ้งเตือน…"
  variant="primary"
  confirm={{
    title: 'เผยแพร่สลิปทั้งงวด?',
    description: `เผยแพร่สลิป ${statusCounts.Draft} คน และส่งแจ้งเตือน LINE ถึงทุกคนพร้อมกัน — ดำเนินการแล้วย้อนกลับไม่ได้`,
    confirmLabel: 'เผยแพร่ทั้งหมด',
  }}
/>
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Manual verification (local stack)**

Bring up the local stack per the project memory (`supabase start → db:deploy → seeds → dev`). Then:
1. Go to `/admin/payroll`, pick a month, press `คำนวณเงินเดือน`.
2. Click `ดูรายละเอียด` on a Draft row → modal shows income/deduction lines WITH formulas (SSO `× 0.05`, absent `× ฿500`, etc.) and a net that equals the table's net.
3. Press `เผยแพร่ + ส่งสลิป` → confirm dialog appears → confirm → that row flips to `เผยแพร่แล้ว`, others remain `ฉบับร่าง`, employee gets a LINE push.
4. Press the bulk `เผยแพร่สลิป + แจ้งเตือน LINE` → confirm dialog appears before sending.
5. Open a Published row's `ดูรายละเอียด` → read-only, no publish button.

Expected: all five behave as described.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/payroll/page.tsx src/app/\(admin\)/admin/payroll/run-action-form.tsx
git commit -m "feat(payroll): confirm dialog before bulk publish

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Full regression sweep

**Files:** none (verification)

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: PASS (calc + all others).

- [ ] **Step 2: Run the full integration suite**

Run: `pnpm test:integration`
Expected: PASS (payroll pipeline incl. new per-employee + detail cases).

- [ ] **Step 3: Final typecheck + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS. Fix anything surfaced, re-run, then the feature is complete.
