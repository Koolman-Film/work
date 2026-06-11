# Payroll Management — Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

Complete the payroll feature on top of the existing Phase-2 foundation (Payroll model,
PayrollConfig, RecurringDeduction, pure calc engine, payroll.* permissions):

1. Admin entry of earnings/deductions (เงินเพิ่ม/เงินลด) — one-time, monthly recurring,
   or date-range — with a monthly net-pay summary across all employees.
2. Per-employee social security (ประกันสังคม) toggle; when on, SSO is computed from base
   salary per the existing capped formula.
3. Employee payslip page in LINE LIFF, plus a LINE push notification on publish.

## Data model (migration 0027)

### New: `PayrollAdjustment`

```prisma
enum AdjustmentKind {
  Income
  Deduction
}

model PayrollAdjustment {
  id         String         @id @default(uuid()) @db.Uuid
  employeeId String         @db.Uuid
  employee   Employee       @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  kind       AdjustmentKind
  reason     String         // "ค่าคอมมิชชั่น", "หักค่าชุดฟอร์ม", ...
  amount     Decimal        @db.Decimal(12, 2)
  startMonth String         // "YYYY-MM" — first month it applies
  endMonth   String?        // null = open-ended monthly
  note       String?
  deletedAt  DateTime?      // soft-delete (extension filters by default)
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt

  @@index([employeeId, startMonth])
}
```

Frequency mapping (UI offers three choices; storage is the two month fields):

| UI choice | startMonth | endMonth |
|---|---|---|
| รายครั้ง (one-time) | M | M (same) |
| รายเดือน (recurring) | M | null |
| ตามช่วงเวลา (range) | M1 | M2 |

An adjustment applies to month `M` iff `startMonth <= M && (endMonth == null || M <= endMonth)`
(lexicographic compare works for YYYY-MM). Selection by range is idempotent — recalculation
never double-applies, so no stamping (unlike CashAdvance/LeaveRequest sweep-once rows).

### `Employee`: add `hasSso Boolean @default(true)`

Default true preserves current behavior (calc applies SSO to everyone today). Frozen into
the Payroll row at calc time, so published slips never change retroactively.

### `Payroll`: add `deductOther Decimal @db.Decimal(12, 2) @default(0)`

Deduction-kind adjustments get their own bucket; `deductDebt` stays reserved for
RecurringDeduction (loans/installments). Income-kind adjustments fill the existing
`incomeOther` placeholder.

## Calc engine (`src/lib/payroll/calc.ts`)

- `EmployeeForPayroll` gains `hasSso: boolean`.
- `CalcInput` gains `adjustments: readonly { kind: 'Income' | 'Deduction'; amount: ... }[]`.
- `incomeOther` = sum of Income adjustments (replaces hardcoded 0).
- New output field `deductOther` = sum of Deduction adjustments; included in netPay.
- `hasSso === false` → `deductSso = 0`; otherwise existing formula
  `min(min(baseSalary, ssoSalaryCap) × ssoRate, ssoAmountCap)`.
- Remains pure/Decimal-based. New fixture cases in `calc.test.ts`.

## Admin pages

Enable the existing "เงินเดือน" sidebar item (การเงิน group). Reuse existing permissions —
`payroll.read` (view), `payroll.run` (calculate + manage adjustments), `payroll.publish`
(publish/lock). No new permission keys → no RoleDefinition backfill needed.

### `/admin/payroll` — monthly run

- Month picker (`?m=YYYY-MM`, default current period by `cutoffDay`).
- Table: every active employee × base / เงินเพิ่ม / เงินลด / SSO / advances / attendance /
  debt / leave / **net**, with a company-total summary row (requirement #1).
- Actions: **คำนวณ (Draft)** → review → **เผยแพร่ (Publish)** → **ล็อก (Lock)**, gated by
  Payroll.status. Calculation upserts Draft rows via `calcPayroll` per employee.
- Publish runs in one transaction: finalize Payroll rows → stamp `deductedInPayrollId` on
  swept LeaveRequest + CashAdvance rows → decrement RecurringDeduction.monthsRemaining →
  emit `notification.send` events → audit log.

### `/admin/payroll/adjustments` — earnings/deductions CRUD

- List with employee/month/kind filters; create/edit/delete (soft).
- Form: employee select, kind (เพิ่ม/ลด), frequency (3 choices → month fields), amount,
  reason, note. Server Actions + Zod, following the `/admin/employees` pattern. Audit-logged.

### Employee form

- "ประกันสังคม" checkbox on `/admin/employees/[id]` (and new) wired to `hasSso`.

## LIFF payslip + notification

### `/liff/payslip?m=YYYY-MM`

- Staff-only (`requireRole(['Staff'])`); shows own Payroll for the month **only when status
  is Published or Locked** (Drafts invisible).
- Breakdown: income lines (base + each Income adjustment by reason), deduction lines (SSO,
  advances, attendance, debt, leave, each Deduction adjustment by reason), net pay.
- Month navigator like `/liff/summary`. Linked from the summary page / LIFF menu.
- Translated in all 6 locales (`payslip` namespace in `messages/*.json`; th is source of
  truth, my/lo/km/zh-CN AI-drafted pending native review).

### LINE notification on publish

- Per employee: Flex message "สลิปเงินเดือนเดือน X ออกแล้ว — สุทธิ ฿xx,xxx" with a button
  opening the LIFF payslip, via the existing `line-push-notification` Inngest pipeline,
  localized per user locale.

## Out of scope (unchanged V1 limits)

- Daily/Hourly salary types still throw `unsupported-salary-type`.
- OT not yet wired into payroll.
- PDF payslip (`pdfUrl`) not implemented.
- Per-minute attendance deductions (still flat per-event).

## Testing

- Unit: new calc fixtures — adjustments in/out of month range, hasSso off, deductOther in
  net, open-ended vs one-time vs range.
- Integration/E2E: adjustment CRUD, run→publish flow stamps sweep rows exactly once,
  payslip hidden while Draft, visible after Publish.
