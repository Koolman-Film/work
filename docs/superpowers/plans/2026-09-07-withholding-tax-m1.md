# Withholding Tax — M1 (schema + engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record withholding tax as a first-class payroll figure — entered as a `Tax`-kind adjustment, summed into `Payroll.deductTax`, and subtracted from `netPay` only when the employee bears it.

**Architecture:** Tax enters through `PayrollAdjustment` (an *input*), never as a field typed onto the `Payroll` row (an *output*). `calcPayroll` stays a pure `CalcInput → PayrollDraft`, so recalculating a month remains idempotent. M1 ships the schema for all four milestones in one migration but wires up only the engine; the UI (M2), journal lines (M3) and ภ.ง.ด.1 (M4) come later.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Prisma + Postgres (Supabase), decimal.js, Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-09-07-withholding-tax-design.md`

## Global Constraints

- Branch: `feat/accounting-exports`, based at `0783065`.
- **Hand-author the migration.** `prisma migrate dev --create-only` emits spurious `DROP DEFAULT` statements against this schema. Write `migration.sql` by hand.
- Next migration number is **`0051`**. Directory: `prisma/migrations/0051_withholding_tax/migration.sql`.
- Money is `Decimal(12, 2)` in Postgres and `decimal.js` in the engine. Never `number`.
- **Never `git add -A`** — the repo holds un-gitignored local files. Stage explicit paths only.
- Gate before every commit: `npx vitest run`, `pnpm typecheck`, `npx biome check src`.
- New required fields are required *on purpose* (see Task 2). Do not "fix" a type error by making them optional.
- Local Supabase runs on ports **54421/54422**, config in `.env.local` at repo root.

---

### Task 1: Migration 0051 + schema

**Files:**
- Create: `prisma/migrations/0051_withholding_tax/migration.sql`
- Modify: `prisma/schema.prisma` (enums `AdjustmentKind`, `JournalLineKind`; models `Payroll`, `PayrollConfig`, `Employee`, `Branch`)

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma client types `AdjustmentKind.Tax`, `Payroll.deductTax`, `PayrollConfig.whtEnabled`, `Employee.taxBorneByEmployer`, `Branch.taxId`, `Branch.taxBranchNo`, `JournalLineKind.WhtPayable`, `JournalLineKind.WhtExpense`.

- [ ] **Step 1: Write the migration SQL**

Create `prisma/migrations/0051_withholding_tax/migration.sql`:

```sql
-- Withholding tax (ภาษีหัก ณ ที่จ่าย), phase 1: record it, do not compute it.
--
-- Tax enters as a PayrollAdjustment kind rather than a column an admin types
-- into directly. calcPayroll is pure and recalculation is idempotent only
-- because every admin-entered amount arrives as an INPUT selected by month
-- range; a hand-typed value on the Payroll row would force recalc to read its
-- own prior output to avoid destroying it.
--
-- ALTER TYPE ... ADD VALUE is safe inside Prisma's transaction on PG 12+ so
-- long as the new value is not USED in the same transaction. Nothing here
-- backfills using these values, so this is fine. Do not add a backfill to this
-- file — put it in its own migration.

ALTER TYPE "AdjustmentKind" ADD VALUE 'Tax';

ALTER TYPE "JournalLineKind" ADD VALUE 'WhtPayable';
ALTER TYPE "JournalLineKind" ADD VALUE 'WhtExpense';

-- Tax remitted to the Revenue Department for this employee-month, REGARDLESS
-- of who bears it. netPay subtracts it only when the employee bears it.
ALTER TABLE "Payroll"
  ADD COLUMN "deductTax" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Global kill switch. Default false so deploying this changes no behaviour
-- until an admin turns it on.
ALTER TABLE "PayrollConfig"
  ADD COLUMN "whtEnabled" BOOLEAN NOT NULL DEFAULT false;

-- นายจ้างออกภาษีให้ — the company bears the tax instead of withholding it.
-- Default false: withholding is the norm, and being wrong in that direction
-- shows up as a payslip discrepancy rather than a filing error.
ALTER TABLE "Employee"
  ADD COLUMN "taxBorneByEmployer" BOOLEAN NOT NULL DEFAULT false;

-- Employer tax identity. Nullable because it is unknown until an admin enters
-- it; the ภ.ง.ด.1 route must refuse to emit a file without it (pre-flight 422)
-- rather than emit a blank field.
ALTER TABLE "Branch"
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "taxBranchNo" TEXT;
```

- [ ] **Step 2: Mirror the changes in `prisma/schema.prisma`**

In `enum AdjustmentKind`, add `Tax` after `Deduction`.

In `enum JournalLineKind`, add `WhtPayable` and `WhtExpense` at the end.

In `model Payroll`, after `deductOther`:

```prisma
  /// Tax remitted to the Revenue Department for this employee-month,
  /// regardless of who bears it. `netPay` subtracts it only when the employee
  /// bears it — see Employee.taxBorneByEmployer.
  deductTax        Decimal @default(0) @db.Decimal(12, 2)
```

In `model PayrollConfig`, after `ssoAmountCap`:

```prisma
  /// Master switch for withholding tax. False = `deductTax` is always 0 and
  /// Tax adjustments are ignored, so shipping the feature changes nothing
  /// until an admin turns it on.
  whtEnabled            Boolean @default(false)
```

In `model Employee`, after `hasSso`:

```prisma
  /// นายจ้างออกภาษีให้ — the company pays this person's PIT rather than
  /// withholding it. The tax is still reported and still reaches the ledger;
  /// only take-home is unaffected.
  taxBorneByEmployer Boolean @default(false)
```

In `model Branch`, after `ssoBranchNo`:

```prisma
  /// 13-digit employer tax ID (เลขประจำตัวผู้เสียภาษี). Nullable until entered.
  taxId             String?
  /// 5-digit RD branch number; "00000" is head office. Nullable until entered.
  taxBranchNo       String?
```

- [ ] **Step 3: Apply and verify the migration locally**

Run:
```bash
npx prisma format --schema prisma/schema.prisma
npx prisma validate --schema prisma/schema.prisma
pnpm db:deploy
```
Expected: migration `0051_withholding_tax` applies cleanly; `prisma validate` reports the schema is valid.

- [ ] **Step 4: Confirm the schema matches the database**

Run: `npx prisma migrate status`
Expected: "Database schema is up to date!" — no drift, and no migration Prisma wants to create.

- [ ] **Step 5: Verify generated types exist**

Run: `pnpm typecheck`
Expected: passes. (`AdjustmentKind.Tax` etc. now exist on the client; nothing uses them yet.)

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0051_withholding_tax/migration.sql
git commit -m "feat(payroll): schema for withholding tax, phase 1

Adds AdjustmentKind.Tax, Payroll.deductTax, PayrollConfig.whtEnabled,
Employee.taxBorneByEmployer, Branch.taxId/taxBranchNo and the
WhtPayable/WhtExpense journal kinds.

One migration for all four milestones' schema, per the spec: the columns
are inert until the engine and UI land, and three separate migrations
would cost three deploys for no benefit.

Hand-authored — 'prisma migrate dev --create-only' emits spurious DROP
DEFAULTs against this schema.

Spec: docs/superpowers/specs/2026-09-07-withholding-tax-design.md"
```

---

### Task 2: `calc.ts` accepts Tax adjustments and the new inputs

**Files:**
- Modify: `src/lib/payroll/calc.ts` (types `AdjustmentForPayroll`, `EmployeeForPayroll`, `ConfigForPayroll`, `PayrollDraft`)
- Modify: `src/lib/payroll/calc.test.ts` (fixtures), `src/lib/payroll/calc-invariant.test.ts` (fixtures)

**Interfaces:**
- Consumes: Task 1's Prisma types.
- Produces:
  - `AdjustmentForPayroll.kind: 'Income' | 'Deduction' | 'Tax'`
  - `EmployeeForPayroll.taxBorneByEmployer: boolean` (**required**)
  - `ConfigForPayroll.whtEnabled: boolean` (**required**)
  - `PayrollDraft.deductTax: Decimal`

This task is types only — it deliberately compiles before the logic lands, so the type errors it produces are the checklist for Task 3.

- [ ] **Step 1: Widen `AdjustmentForPayroll`**

In `src/lib/payroll/calc.ts`, replace the `AdjustmentForPayroll` type and its doc comment:

```ts
/**
 * An admin-entered earning/deduction (PayrollAdjustment) already filtered
 * to this pay-period month by the caller (see adjustments.ts). Income kinds
 * sum into incomeOther; Deduction kinds into deductOther; Tax kinds into
 * deductTax.
 *
 * Tax is its own kind rather than a Deduction with a special reason because
 * ภ.ง.ด.1 has to be able to ask "what tax was withheld from this person this
 * month" and get an exact number. A free-text reason cannot answer that.
 */
export type AdjustmentForPayroll = {
  kind: 'Income' | 'Deduction' | 'Tax';
  amount: string | number | Decimal;
};
```

- [ ] **Step 2: Add the required employee field**

In `EmployeeForPayroll`, after `hasSso`:

```ts
  /**
   * นายจ้างออกภาษีให้ — the company bears this person's withholding tax
   * rather than deducting it from their pay.
   *
   * REQUIRED, not optional-with-default, for the same reason as `hasSso` and
   * `allowanceAmount`. A missed call site here silently OVERPAYS the employee
   * and under-reports to the Revenue Department — two failures that surface
   * months apart, at filing time. There is exactly one non-test caller
   * (run.ts), so requiring it costs one line and buys a compile error.
   */
  taxBorneByEmployer: boolean;
```

- [ ] **Step 3: Add the required config field**

In `ConfigForPayroll`, after `ssoAmountCap`:

```ts
  /**
   * `PayrollConfig.whtEnabled`. When false, `deductTax` is 0 and Tax-kind
   * adjustments are ignored entirely.
   *
   * Required rather than defaulting to false: a default would make "tax
   * silently not applied" the behaviour of a forgotten call site, which is
   * indistinguishable from "this employee owes no tax".
   */
  whtEnabled: boolean;
```

- [ ] **Step 4: Add the draft field**

In `PayrollDraft`, after `deductOther`:

```ts
  /** Tax remitted to the RD (ภาษีหัก ณ ที่จ่าย), whoever bears it. */
  deductTax: Decimal;
```

- [ ] **Step 5: Run typecheck to enumerate every fixture that needs updating**

Run: `pnpm typecheck`
Expected: FAIL. Errors list every object literal missing `taxBorneByEmployer` or `whtEnabled` — roughly 21 employee literals across `calc.test.ts` and `calc-invariant.test.ts`, plus `DEFAULT_CONFIG`, plus `calcPayroll`'s own return (missing `deductTax`) and `run.ts:386`. **This list is the task.**

- [ ] **Step 6: Add `whtEnabled: false` to the shared config fixture**

In `src/lib/payroll/calc.test.ts`, in `DEFAULT_CONFIG`:

```ts
const DEFAULT_CONFIG = {
  ssoRate: '0.05',
  ssoSalaryCap: '15000',
  ssoAmountCap: '750',
  absentDeductionPerDay: '500',
  lateDeduction: '100',
  earlyLeaveDeduction: '100',
  // Existing cases predate withholding tax and must keep asserting the same
  // numbers, so the switch is off for all of them. Tax has its own file.
  whtEnabled: false,
};
```

- [ ] **Step 7: Add `taxBorneByEmployer: false` to every employee literal the typechecker named**

For each error, add the field next to the existing `hasSso`:

```ts
        hasSso: true,
        taxBorneByEmployer: false,
```

Do the same for any inline `config:` literal in `calc-invariant.test.ts` that does not spread `DEFAULT_CONFIG` — add `whtEnabled: false`.

- [ ] **Step 8: Satisfy the one real call site**

In `src/lib/payroll/run.ts`, in the `calcPayroll({ ... })` call at ~line 386, add to `employee`:

```ts
          hasSso: emp.hasSso,
          taxBorneByEmployer: emp.taxBorneByEmployer,
```

and to `config`:

```ts
          ssoAmountCap: config.ssoAmountCap.toString(),
          whtEnabled: config.whtEnabled,
```

If `emp` or `config` is fetched with an explicit Prisma `select`, add `taxBorneByEmployer: true` / `whtEnabled: true` to it. Find the selects with:

```bash
grep -n "hasSso: true\|ssoAmountCap: true" src/lib/payroll/run.ts
```

- [ ] **Step 9: Typecheck — one error should remain**

Run: `pnpm typecheck`
Expected: exactly one remaining error, in `calc.ts`: the returned draft is missing `deductTax`. Task 3 fixes it. If other errors remain, finish Step 7 first.

- [ ] **Step 10: Commit**

```bash
git add src/lib/payroll/calc.ts src/lib/payroll/calc.test.ts src/lib/payroll/calc-invariant.test.ts src/lib/payroll/run.ts
git commit -m "refactor(payroll): thread withholding-tax inputs into the calc

Types only. Adds the Tax adjustment kind, the required
Employee.taxBorneByEmployer and PayrollConfig.whtEnabled inputs, and the
deductTax field on PayrollDraft.

Both new fields are REQUIRED rather than optional-with-default, matching
the reasoning already applied to hasSso and allowanceAmount: a missed
call site would silently overpay the employee and under-report to the
RD. With one non-test caller, requiring them costs a line and buys a
compile error."
```

---

### Task 3: Sum Tax adjustments into `deductTax`, gated by `whtEnabled`

**Files:**
- Modify: `src/lib/payroll/calc.ts:~424` (the adjustment-summing block) and the draft return
- Create: `src/lib/payroll/calc-wht.test.ts`

**Interfaces:**
- Consumes: `AdjustmentForPayroll.kind === 'Tax'`, `ConfigForPayroll.whtEnabled`, `PayrollDraft.deductTax` (Task 2).
- Produces: `PayrollDraft.deductTax` populated. `netPay` is **not** yet adjusted — that is Task 4.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/payroll/calc-wht.test.ts`:

```ts
/**
 * Withholding tax (ภาษีหัก ณ ที่จ่าย) in the pure calc.
 *
 * Phase 1 RECORDS tax; it does not compute it. So there is no arithmetic to
 * test here beyond bucketing and the bearer rule — which is exactly why those
 * two need pinning: they are the whole feature.
 */

import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { type CalcInput, calcPayroll } from './calc';

const CONFIG = {
  ssoRate: '0.05',
  ssoSalaryCap: '15000',
  ssoAmountCap: '750',
  absentDeductionPerDay: '500',
  lateDeduction: '100',
  earlyLeaveDeduction: '100',
  whtEnabled: true,
};

/** A salaried employee with no attendance events — so every number below is
 *  attributable to the adjustments under test and nothing else. */
function input(over: {
  taxBorneByEmployer?: boolean;
  whtEnabled?: boolean;
  adjustments?: CalcInput['adjustments'];
}): CalcInput {
  return {
    month: '2026-06',
    employee: {
      id: 'e1',
      salaryType: 'Monthly',
      baseSalary: '30000',
      hasSso: false,
      taxBorneByEmployer: over.taxBorneByEmployer ?? false,
      allowanceAmount: '0',
    },
    attendances: [],
    advances: [],
    recurringDeductions: [],
    leaveDeductions: [],
    leaveDates: [],
    derivedAbsentDays: 0,
    adjustments: over.adjustments ?? [],
    config: { ...CONFIG, whtEnabled: over.whtEnabled ?? true },
  };
}

describe('withholding tax — bucketing', () => {
  it('sums Tax-kind adjustments into deductTax', () => {
    const d = calcPayroll(input({ adjustments: [{ kind: 'Tax', amount: '1250.50' }] }));
    expect(d.deductTax.toString()).toBe('1250.5');
  });

  it('sums multiple Tax adjustments', () => {
    const d = calcPayroll(
      input({ adjustments: [{ kind: 'Tax', amount: '1000' }, { kind: 'Tax', amount: '250.25' }] }),
    );
    expect(d.deductTax.toString()).toBe('1250.25');
  });

  it('keeps Tax out of deductOther, and Deduction out of deductTax', () => {
    const d = calcPayroll(
      input({
        adjustments: [
          { kind: 'Tax', amount: '1000' },
          { kind: 'Deduction', amount: '300' },
        ],
      }),
    );
    // The whole reason Tax is its own kind: ภ.ง.ด.1 must be able to ask what
    // tax was withheld and get a number that is only tax.
    expect(d.deductTax.toString()).toBe('1000');
    expect(d.deductOther.toString()).toBe('300');
  });

  it('is zero when there are no Tax adjustments', () => {
    const d = calcPayroll(input({ adjustments: [{ kind: 'Income', amount: '500' }] }));
    expect(d.deductTax.toString()).toBe('0');
  });

  it('ignores Tax adjustments entirely when whtEnabled is false', () => {
    const d = calcPayroll(
      input({ whtEnabled: false, adjustments: [{ kind: 'Tax', amount: '1250' }] }),
    );
    expect(d.deductTax.toString()).toBe('0');
  });

  it('still applies Income and Deduction adjustments when whtEnabled is false', () => {
    const d = calcPayroll(
      input({
        whtEnabled: false,
        adjustments: [
          { kind: 'Tax', amount: '1250' },
          { kind: 'Deduction', amount: '300' },
          { kind: 'Income', amount: '500' },
        ],
      }),
    );
    // The switch governs tax only. A regression that made it gate the whole
    // adjustment pipeline would be invisible in the tests above.
    expect(d.deductTax.toString()).toBe('0');
    expect(d.deductOther.toString()).toBe('300');
    expect(d.incomeOther.toString()).toBe('500');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/lib/payroll/calc-wht.test.ts`
Expected: FAIL — `deductTax` is `undefined` (the draft does not yet carry it), so `.toString()` throws.

- [ ] **Step 3: Implement the bucket**

In `src/lib/payroll/calc.ts`, immediately after the `deductOther` block (~line 424):

```ts
  // Tax-kind adjustments (ภาษีหัก ณ ที่จ่าย) get their own bucket, never
  // folded into deductOther: ภ.ง.ด.1 asks what tax was withheld from this
  // person this month and has to get a number that is only tax.
  //
  // The switch is checked HERE rather than at the call site so that turning
  // withholding off cannot leave a half-applied figure anywhere downstream.
  const deductTax = input.config.whtEnabled
    ? sumDec(
        adjustments.filter((a) => a.kind === 'Tax').map((a) => ({ value: a.amount })),
      ).toDecimalPlaces(2)
    : new Decimal(0);
```

Then add `deductTax` to the returned draft object, after `deductOther`:

```ts
    deductOther,
    deductTax,
    netPay,
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/lib/payroll/calc-wht.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Confirm no existing behaviour moved**

Run: `npx vitest run src/lib/payroll && pnpm typecheck`
Expected: all payroll suites pass; typecheck clean. `netPay` is deliberately unchanged in this task — every pre-existing assertion must still hold.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payroll/calc.ts src/lib/payroll/calc-wht.test.ts
git commit -m "feat(payroll): sum Tax adjustments into deductTax

Tax gets its own bucket rather than folding into deductOther, because
ภ.ง.ด.1 has to ask what tax was withheld from one person in one month
and get a number that is only tax.

whtEnabled is checked inside the calc rather than at the call site, so
turning withholding off cannot leave a half-applied figure downstream.

netPay is deliberately untouched here — the bearer rule is its own
commit, so this one cannot change anyone's take-home."
```

---

### Task 4: Apply the bearer rule to `netPay`

**Files:**
- Modify: `src/lib/payroll/calc.ts` (the `netPay` assembly, ~line 516)
- Modify: `src/lib/payroll/calc-wht.test.ts`

**Interfaces:**
- Consumes: `deductTax` (Task 3), `employee.taxBorneByEmployer` (Task 2).
- Produces: `netPay` reduced by `deductTax` only when the employee bears the tax.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/payroll/calc-wht.test.ts`:

```ts
describe('withholding tax — who bears it', () => {
  it('reduces netPay when the employee bears the tax', () => {
    const d = calcPayroll(
      input({ taxBorneByEmployer: false, adjustments: [{ kind: 'Tax', amount: '1250' }] }),
    );
    expect(d.netPay.toString()).toBe('28750'); // 30000 − 1250
  });

  it('leaves netPay alone when the company bears the tax', () => {
    const d = calcPayroll(
      input({ taxBorneByEmployer: true, adjustments: [{ kind: 'Tax', amount: '1250' }] }),
    );
    expect(d.netPay.toString()).toBe('30000');
  });

  it('records the same deductTax either way', () => {
    const withheld = calcPayroll(
      input({ taxBorneByEmployer: false, adjustments: [{ kind: 'Tax', amount: '1250' }] }),
    );
    const borne = calcPayroll(
      input({ taxBorneByEmployer: true, adjustments: [{ kind: 'Tax', amount: '1250' }] }),
    );
    // deductTax is what was remitted to the RD, not what came off the payslip.
    // ภ.ง.ด.1 reports it in both cases; only take-home differs.
    expect(withheld.deductTax.toString()).toBe('1250');
    expect(borne.deductTax.toString()).toBe('1250');
    expect(withheld.netPay.toString()).not.toBe(borne.netPay.toString());
  });

  it('does not touch netPay when whtEnabled is false, whoever bears it', () => {
    const d = calcPayroll(
      input({
        whtEnabled: false,
        taxBorneByEmployer: false,
        adjustments: [{ kind: 'Tax', amount: '1250' }],
      }),
    );
    expect(d.netPay.toString()).toBe('30000');
  });

  it('stacks with other deductions rather than replacing them', () => {
    const d = calcPayroll(
      input({
        adjustments: [
          { kind: 'Tax', amount: '1250' },
          { kind: 'Deduction', amount: '300' },
        ],
      }),
    );
    expect(d.netPay.toString()).toBe('28450'); // 30000 − 1250 − 300
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/lib/payroll/calc-wht.test.ts`
Expected: FAIL on "reduces netPay when the employee bears the tax" — `expected '30000' to be '28750'`. The employer-borne cases pass already (netPay is currently never reduced), which is why the failing one is the meaningful signal.

- [ ] **Step 3: Implement the bearer rule**

In `src/lib/payroll/calc.ts`, immediately before the `const netPay = ...` assembly:

```ts
  // Whoever bears the tax, `deductTax` records what was remitted to the RD.
  // Only the employee-borne case comes off take-home; when the company bears
  // it (นายจ้างออกภาษีให้) the amount is still reported on ภ.ง.ด.1 and still
  // reaches the ledger, as an expense rather than a deduction.
  const taxWithheldFromPay = input.employee.taxBorneByEmployer
    ? new Decimal(0)
    : deductTax;
```

Then add one line to the `netPay` chain, after `.minus(deductOther)`:

```ts
    .minus(deductOther)
    .minus(taxWithheldFromPay)
    .toDecimalPlaces(2);
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/lib/payroll/calc-wht.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run && pnpm typecheck && npx biome check src`
Expected: all pass. Pre-existing payroll tests all use `whtEnabled: false`, so no previously-asserted `netPay` can move. If one did, that is a real regression — investigate rather than updating the expectation.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payroll/calc.ts src/lib/payroll/calc-wht.test.ts
git commit -m "feat(payroll): withheld tax comes off take-home; borne tax does not

deductTax records what was remitted to the Revenue Department in both
cases — ภ.ง.ด.1 reports it either way. Only the employee-borne case
reduces netPay; under นายจ้างออกภาษีให้ the company pays it and
take-home is untouched.

Grossing up (a tax the employer pays is itself taxable income) is out of
scope for phase 1: we are recording the accountant's figure and they
have already grossed up."
```

---

### Task 5: Persist `deductTax` and prove recalculation is idempotent

**Files:**
- Modify: `src/lib/payroll/run.ts` (`draftValues`, ~line 490)
- Modify: `src/lib/payroll/calc-wht.test.ts`

**Interfaces:**
- Consumes: `PayrollDraft.deductTax` (Task 3).
- Produces: `deductTax` written on every payroll upsert.

- [ ] **Step 1: Write the failing idempotency test**

Append to `src/lib/payroll/calc-wht.test.ts`:

```ts
describe('withholding tax — recalculation', () => {
  it('is idempotent: recalculating a month yields the same figures', () => {
    // The property the whole adjustment-as-input design exists to protect.
    // If tax ever moves onto the Payroll row, this is the test that breaks.
    const args = input({ adjustments: [{ kind: 'Tax', amount: '1250' }] });
    const first = calcPayroll(args);
    const second = calcPayroll(args);
    expect(second.deductTax.toString()).toBe(first.deductTax.toString());
    expect(second.netPay.toString()).toBe(first.netPay.toString());
  });

  it('rounds a fractional tax figure to satang, once', () => {
    const d = calcPayroll(input({ adjustments: [{ kind: 'Tax', amount: '1250.555' }] }));
    expect(d.deductTax.toString()).toBe('1250.56');
    expect(d.netPay.toString()).toBe('28749.44'); // 30000 − 1250.56
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/lib/payroll/calc-wht.test.ts`
Expected: both PASS. Neither drives implementation — they are regression guards.

The idempotency case passes because the calc is pure. The rounding case passes because `decimal.js` defaults to `ROUND_HALF_UP` and this repo never calls `Decimal.set`, so `1250.555 → 1250.56` and `30000 − 1250.56 = 28749.44` (verified directly against the installed library, not assumed).

**If either fails, that is a real finding — do not adjust the expectation to match the output.** A failing idempotency case means something impure crept into the calc; a failing rounding case means the rounding mode changed globally, which would silently shift every money figure in the system.

- [ ] **Step 3: Persist the column**

In `src/lib/payroll/run.ts`, in `draftValues`, after the `deductOther` line:

```ts
    deductOther: new Prisma.Decimal(draft.deductOther.toFixed(2)),
    deductTax: new Prisma.Decimal(draft.deductTax.toFixed(2)),
```

- [ ] **Step 4: Verify every write path carries it**

Run:
```bash
grep -n "deductOther" src/lib/payroll/run.ts
```
Expected: every site that writes `deductOther` either goes through `draftValues` or now also writes `deductTax`. Any `payroll.create`/`upsert` building its columns inline needs the field added too — a write path that omits it silently stores 0.

- [ ] **Step 5: Full gate**

Run: `npx vitest run && pnpm typecheck && npx biome check src`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payroll/run.ts src/lib/payroll/calc-wht.test.ts
git commit -m "feat(payroll): persist deductTax on every payroll write

Plus a regression guard for the property the adjustment-as-input design
exists to protect: recalculating a month twice yields identical figures.
If tax ever migrates onto the Payroll row, that is the test that breaks."
```

---

## Self-Review

**Spec coverage.** §4.1 schema → Task 1 (all six changes plus both journal enum values). §4.2 bucketing and the bearer rule → Tasks 3 and 4. §4.2 `whtEnabled` gate → Task 3, Steps 1/3. §6 testing: bucketing, bearer, disabled-switch, idempotency → Tasks 3–5; journal balance is M3, not here.

**Deliberately deferred, and why:** §4.3 journal lines (M3), §4.4 the misfiled-`Deduction` guard (M2 — it lives in the adjustment form, which M1 does not touch), §5 M2/M4 UI and exports. The Task 1 migration ships their schema early on purpose: the columns are inert, and three migrations would cost three deploys.

**One risk M1 leaves open.** After M1, `Tax` is a valid `AdjustmentKind` in the database but nothing in the UI can create one, and `whtEnabled` defaults to `false` — so the feature is unreachable and inert until M2. That is intended, but it means M1 cannot be validated end-to-end against a real payroll run; its correctness rests on the unit tests.

**Type consistency.** `deductTax` is the name in the migration, `schema.prisma`, `PayrollDraft`, the calc, the tests and `draftValues`. `taxBorneByEmployer` and `whtEnabled` likewise. The intermediate `taxWithheldFromPay` (Task 4) is local to `calcPayroll` and intentionally distinct from `deductTax` — conflating them is the bug the bearer tests catch.

**No placeholders.** Every step carries the literal SQL, TypeScript, test code or command to run, and every expectation states what should happen.
