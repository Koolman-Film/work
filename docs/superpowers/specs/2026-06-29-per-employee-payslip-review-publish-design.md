# Per-employee payslip review + publish — design

**Date:** 2026-06-29
**Status:** Approved (pending implementation plan)

## Problem

The payslip feature is built but publish is **all-or-nothing**. The admin payroll
run page ([src/app/(admin)/admin/payroll/page.tsx](../../../src/app/(admin)/admin/payroll/page.tsx))
exposes a single month-wide button — `เผยแพร่สลิป + แจ้งเตือน LINE (N คน)` — that fires
`publishPayroll(month)` over **every** Draft row and pushes LINE to everyone at once.
There is no way to:

1. Review *how* one employee's net pay was computed before releasing it, or
2. Publish + notify a single employee while leaving the rest as Draft.

## Goals

- **Per-employee publish**: click one person, review, release their slip + LINE
  notification — without touching anyone else. Keep the month-wide bulk button.
- **Detail modal**: clicking a row opens a full **formula-level** breakdown of how
  each number was reached, ending in net pay.
- **Confirmation on both**: the bulk button *and* the per-person publish each route
  through a confirm dialog before firing the irreversible LINE push.

## Non-goals

- Per-employee **calculate** or **lock** — those stay month-wide. Only publish gains
  a per-person path.
- Proration / partial-month income changes.
- Editing numbers from inside the modal (adjustments already have their own per-row
  `+ เพิ่ม/ลด` flow).

## Decisions (locked during brainstorming)

1. **Keep the bulk button**, add a per-row path alongside it — not a replacement.
2. **Both** publish buttons (bulk + per-person) get a `ConfirmDialog`.
3. The per-person action lives **inside the detail modal**, behind its own confirm.
4. **"lock-in and send" = Published** (Draft → Published, fires LINE). The month-wide
   `ล็อกงวด` (Published → Locked) stays a separate bulk finalization; per-person does
   **not** lock.
5. **Full-formula breakdown is for Draft rows only.** Published/Locked rows open the
   modal read-only from their frozen stored buckets — no live recompute (the frozen
   numbers stay authoritative), no publish button.
6. **Full formula** depth (not just itemized) — the calc engine is expanded to expose
   the computed sub-amounts.

## Architecture

Four layers, each with one job. The split keeps the pure calc engine pure and assembles
itemized line lists where their source rows already live.

### A. Calc engine — expand `CalcBreakdown`

File: [src/lib/payroll/calc.ts](../../../src/lib/payroll/calc.ts)

Today `breakdown` carries only three counts (`absentCount`, `lateCount`,
`earlyLeaveCount`). Grow it to carry the **computed sub-amounts and their inputs**, so
the modal renders each formula line without re-deriving anything client-side:

```ts
type CalcBreakdown = {
  // existing counts retained for back-compat with callers/tests
  absentCount: number;
  lateCount: number;
  earlyLeaveCount: number;

  sso: {
    cappedBase: Decimal;   // min(baseSalary, ssoSalaryCap)
    rate: Decimal;
    rawAmount: Decimal;    // cappedBase × rate
    amountCap: Decimal;
    applied: Decimal;      // min(rawAmount, amountCap) — equals deductSso
  };
  attendance: {
    absent:    { count: number; perDay: Decimal; money: Decimal };
    lateTier1: {
      mode: 'threeStrike' | 'flat';
      count: number;            // tier-1 (non-severe) late count
      threeStrikeCount?: number;// N, when mode === 'threeStrike'
      days?: number;            // floor(count / N), when mode === 'threeStrike'
      perUnit: Decimal;         // perDay (threeStrike) or lateDeduction (flat)
      money: Decimal;
    };
    lateSevere: { days: number; perDay: Decimal; money: Decimal };
    earlyLeave: { count: number; perUnit: Decimal; money: Decimal };
  };
};
```

These map 1:1 to the math already at [calc.ts:280-360](../../../src/lib/payroll/calc.ts)
(`calcSso` + the attendance block). We are **surfacing values already computed and
currently discarded** — no behavioural change to any bucket or to net pay. Existing unit
tests stay valid; add cases asserting the new sub-amounts (SSO cap paths, threeStrike vs
flat tier-1, severe days, early-leave).

The engine owns *computed* numbers only (SSO caps, late-penalty tiers — the sole
non-obvious math). Itemized line lists (advances, debts, adjustments, leave) are
assembled in layer B, where the source rows with ids/reasons exist.

### B. Per-employee detail data source

File: [src/lib/payroll/run.ts](../../../src/lib/payroll/run.ts)

Refactor `gatherAndCalc(db, month)` to optionally scope to one `employeeId` (the
employee `findMany` gains a `{ id }` filter; everything downstream already keys by
employee). Add an exported:

```ts
export async function payrollRowDetail(
  month: string,
  employeeId: string,
): Promise<PayrollRowDetail | null>
```

returning a **fully serialized** view-model (no `Decimal` crosses to the client — the
same rule [row-adjust.tsx `RowAdjustment`](../../../src/app/(admin)/admin/payroll/row-adjust.tsx)
already follows):

```ts
type PayrollRowDetail = {
  // pre-formatted strings for display + the expanded breakdown (numbers/strings)
  incomeBase: string;
  adjustments: { reason: string; kind: 'Income' | 'Deduction'; amount: string }[];
  advances: { amount: string }[];
  debts: { amount: string }[];              // recurring deductions
  leaveDeductions: { deduct: string; overMinutes: number }[];
  breakdown: SerializedCalcBreakdown;       // sub-amounts as strings
  netPay: string;
  // bucket totals (strings) for the section subtotals
};
```

For a Draft row this comes from the same engine `runPayrollDraft` uses, so the modal's
numbers exactly match what publish would stamp.

### C. Per-employee publish

File: [src/lib/payroll/run.ts](../../../src/lib/payroll/run.ts) +
[actions.ts](../../../src/app/(admin)/admin/payroll/actions.ts)

`publishPayroll` already loops row-by-row idempotently and only touches `Draft` rows.
Add an optional filter:

```ts
export async function publishPayroll(
  month: string,
  opts?: { employeeId?: string },
): Promise<PublishResult>
```

When `employeeId` is set, `gatherAndCalc` scopes to that one employee; the
advance/leave sweep, recurring decrement, and PDF invalidation run for that row only.
`notifyPublishedSlips` already maps over an array — pass the single published slip.

New server action, returning `ActionResult` so `ConfirmDialog` drives it:

```ts
export async function publishOnePayrollAction(
  employeeId: string,
  month: string,
): Promise<ActionResult>
```

It re-enforces `payroll.publish`, keeps the **future-month guard** verbatim, writes an
audit log (`payroll.publish`, metadata `{ via: 'per-employee', employeeId }`), and
revalidates `/admin/payroll`.

**Safety basis:** publishing person A then B sequentially yields the identical end state
as the bulk button — the `deductedInPayrollId: null` guards (run.ts:372-391) make
double-sweeps impossible. This narrows an existing proven path; it is not a new one.

### D. UI

File: [src/app/(admin)/admin/payroll/page.tsx](../../../src/app/(admin)/admin/payroll/page.tsx)
+ a new client component (e.g. `row-detail.tsx`) following the `row-adjust.tsx` pattern.

1. **Row click** opens a detail `Dialog`. Sections mirror the employee payslip layout
   (รายได้ / รายการหัก / สุทธิ) but each line shows its **formula**, e.g.:
   - `ประกันสังคม: ฿15,000 × 5% = ฿750` (with cap note when the cap binds)
   - `ขาดงาน 2 วัน × ฿500 = ฿1,000`
   - `มาสาย 3 ครั้ง → 1 วัน × ฿500 = ฿500` (threeStrike) or `มาสาย 3 ครั้ง × ฿100` (flat)
   - `ออกก่อน 1 ครั้ง × ฿500`
   - advances / debts / เงินเพิ่ม / เงินลด each itemized with their reason
   - leave over-quota lines with their minutes
2. For `Draft` rows **and** `payroll.publish` permission: a **"เผยแพร่ + ส่งสลิป"**
   button inside the modal, wrapped in `ConfirmDialog` (`tone: 'primary'`,
   description names the employee + that LINE will be sent), calling
   `publishOnePayrollAction`.
3. The existing **bulk** publish button is wrapped in `ConfirmDialog` too — same
   confirm-before-LINE protection.
4. For `Published`/`Locked` rows: modal opens **read-only** from frozen stored buckets,
   itemized but **without** the recomputed formula section; no publish button.

## Components & interfaces summary

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `CalcBreakdown` (calc.ts) | Expose computed SSO + attendance sub-amounts | nothing (pure) |
| `payrollRowDetail` (run.ts) | One-employee serialized view-model | `gatherAndCalc`, calc engine |
| `publishPayroll(month, {employeeId})` (run.ts) | Idempotent publish, optionally one row | existing sweep/notify logic |
| `publishOnePayrollAction` (actions.ts) | Permission + audit + future-month guard | `publishPayroll`, `notifyPublishedSlips` |
| `row-detail.tsx` (UI) | Detail modal + per-person confirm publish | `ConfirmDialog`, `Dialog`, the action |
| bulk button wrap (page.tsx) | Confirm before month-wide publish | `ConfirmDialog` |

## Data flow

```
Row click ─▶ payrollRowDetail(month, empId) ─▶ serialized VM ─▶ Dialog (formula view)
                                                                   │
                                            [Draft + perm] ──▶ ConfirmDialog
                                                                   │ confirm
                                          publishOnePayrollAction(empId, month)
                                                                   │
                                  publishPayroll(month,{employeeId}) ─▶ notifyPublishedSlips([slip])
                                                                   │
                                                        revalidate /admin/payroll
```

## Error handling

- `publishOnePayrollAction` returns `{ ok:false, message }` (shown inline by
  `ConfirmDialog`, modal stays open) on: missing permission, future month, row no
  longer Draft (already published/locked by a concurrent action), or calc error.
- `payrollRowDetail` returns `null` if the employee has no row/draft for the month →
  modal shows an empty state rather than throwing.
- LINE push failure must never fail publish (existing fire-and-forget pattern retained).

## Testing

- **calc.ts unit**: new `CalcBreakdown` sub-amounts — SSO below/at/above both caps;
  tier-1 threeStrike (exact multiple + remainder) vs flat; severe days with/without
  covering leave; early-leave; all-zero attendance. Assert sub-amounts reconcile to the
  existing bucket totals (`absent.money + lateTier1.money + lateSevere.money +
  earlyLeave.money === deductAttendance`).
- **run.ts integration**: `publishPayroll(month, {employeeId})` publishes exactly one
  row, sweeps only that employee's advances/leaves, decrements only their recurring
  deductions, leaves others Draft; second call is a no-op (idempotent). Bulk publish
  after a per-person publish skips the already-published row.
- **payrollRowDetail**: returns serialized strings (no Decimal), line lists match the
  source rows, breakdown reconciles to net pay; returns null when no row exists.
- **action gating**: `publishOnePayrollAction` rejects without `payroll.publish` and on
  future month; writes the audit entry on success.
```
