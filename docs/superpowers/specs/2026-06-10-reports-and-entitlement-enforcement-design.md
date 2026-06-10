# Reports & Entitlement Enforcement — Design

**Date:** 2026-06-10
**Status:** Approved by user

## Background

Admin request (translated from Thai):

1. Report menu: advances (amount drawn, remaining), time tracking (minutes late / left early), leave (days/hours by leave type).
2. Enforce entitlements: leave has two tiers — (a) cannot exceed quota (vacation / พักร้อน), (b) may exceed quota but warns and deducts salary (personal, sick, maternity, other); advances must not exceed salary.
3. Numbers must be visible on both the worker (LIFF) pages and the admin pages.

Decisions made during brainstorming:

- **Enforcement point:** warn at worker submission (never block submit); decide at admin approval. Block-policy types cannot be *approved* over quota; deduct-policy types can, with an automatic salary deduction.
- **Deduction handling:** computed automatically into payroll (not a manual admin step), shown to both worker and admin in advance.
- **Report periods:** calendar-month navigation plus custom from–to range. Leave entitlement remains annual.
- **Advance cap for Daily/Hourly employees:** computed from actual earnings in the current payroll period (attendance × rate), not an estimate from baseSalary.

## 1. Data model (one migration)

### New enum

```prisma
enum OverQuotaPolicy {
  Block      // over-quota requests cannot be approved (vacation)
  DeductPay  // over-quota approved with automatic salary deduction
}
```

### Field additions

- `LeaveType.overQuotaPolicy OverQuotaPolicy @default(DeductPay)`
  - Editable on the existing admin leave-type settings form.
  - Data migration sets `Block` on the existing พักร้อน row **by id** (one-time fix; no runtime name-matching — names are admin-editable and localized).
  - Types with `annualQuota = null` (unlimited) are unaffected: no quota means never over quota.
- `LeaveRequest.overQuotaMinutes Int?` — frozen at approval, like `chargedMinutes`. Null/0 for within-quota requests.
- `LeaveRequest.deductAmount Decimal? @db.Decimal(12, 2)` — frozen at approval. Money value of `overQuotaMinutes` at the employee's per-minute rate.
- `LeaveRequest.deductedInPayrollId String? @db.Uuid` — mirrors `CashAdvance.isDeducted`/`deductedInPayrollId` pattern so payroll picks up each deduction exactly once.
- `Payroll.deductLeave Decimal @db.Decimal(12, 2) @default(0)` — its own line ("หักลาเกินสิทธิ"), kept separate from `deductAttendance` for payslip/report transparency.

### Per-minute rate

- Monthly: `baseSalary / workingDaysPerMonth (PayrollConfig) / standardDayMinutes (LeaveConfig)`
- Daily: `baseSalary / standardDayMinutes`
- Hourly: `baseSalary / 60`

Implemented once in `src/lib/payroll/` (or `src/lib/leave/`) as a pure function shared by the warning preview (worker form, admin modal) and the approval freeze.

## 2. Enforcement flow

### Leave — worker submit (LIFF form)

The form already shows live remaining balance per type. Add a warning banner when requested duration > remaining:

- `DeductPay` type: "เกินสิทธิ X — จะถูกหักเงินประมาณ ฿Y" (X formatted via existing `splitDaysHours`; Y from the per-minute rate).
- `Block` type: "เกินสิทธิ — ส่วนที่เกินไม่สามารถอนุมัติได้".
- Submission is **never blocked**.
- Banner strings localized in all 6 locales.

### Leave — admin approval

The review modal shows: current remaining, requested minutes, over-quota minutes, estimated deduction.

- `Block` policy and over quota → approve button disabled with explanation. Admin rejects (or worker resubmits shorter dates). Reject flow unchanged.
- `DeductPay` policy and over quota → approval freezes `overQuotaMinutes` + `deductAmount` inside the existing approval transaction. Over-quota = `max(0, chargedMinutes − max(0, remaining))` computed against the year balance at approval time.
- Audit log (`leave.approve`) gains over-quota metadata. Worker notification (in-app + LINE) mentions the deduction when one applies.
- Admin manual leave creation (`/admin/leave/new`) gets the same warning treatment.

### Advance

- Cap = available balance:
  - Monthly (unchanged): `baseSalary − reserved`.
  - Daily/Hourly (new): `periodEarnings(employeeId, currentPayrollPeriod) − reserved`, where `periodEarnings` sums worked attendance in the current cutoff period × rate, reusing the attendance-to-pay logic in `src/lib/payroll/calc.ts`. Payroll period boundaries come from `PayrollConfig.cutoffDay`.
- Worker form: warning when requested amount > available (currently the form shows the balance card; add explicit over-cap warning). Submission allowed.
- Admin approval: **hard block** over cap ("ไม่เกินเงินเดือน" is a hard rule). Approve button disabled with the numbers shown.

### Payroll integration

During payroll generation: sum `deductAmount` of all Approved, non-deleted leave requests with `deductedInPayrollId = null` (regardless of leave month — exactly how undeducted advances are swept today), write the total to `Payroll.deductLeave`, and stamp `deductedInPayrollId`. `netPay` subtracts the new field. Payslip rendering shows the line only when nonzero.

## 3. Admin reports — `/admin/reports`

New nav section, permission-gated (new permission key in the existing catalog, e.g. `reports.view`). Three pages sharing one period-picker component: month navigation (← มิ.ย. 2569 →) + custom from–to; filters for branch, department, name search. Buddhist-year formatting for Thai per existing conventions.

1. **เบิกเงิน** — per employee: approved total in period, already deducted, outstanding (approved-not-deducted), current cap, remaining. Footer totals.
2. **ลงเวลา** — per employee: late count + Σ late minutes, early-leave count + Σ minutes, absent days, OT minutes. Pure aggregation over `Attendance` (`type` + `durationMinutes`, non-deleted).
3. **วันลา** — per employee × leave type: used in period (days/hours via `splitDaysHours`), year remaining, over-quota minutes + deduction in period. Period scopes "used"; "remaining" is always the annual balance — labeled clearly.

Server components with Prisma `groupBy`/aggregation; row view-model types per existing list conventions; `EmptyState` when no rows. CSV/Excel export is explicitly out of scope (YAGNI).

## 4. Worker summary — `/liff/summary`

One new LIFF page ("สรุปของฉัน"), same month navigation, scoped to the logged-in employee:

- This month: late/early-leave minutes and counts.
- Leave: used/remaining per type (annual), plus any over-quota deduction incurred.
- Advance: drawn this period, remaining cap.

Linked from the LIFF home/rich-menu area. Translated in all 6 locales (my/lo/km/zh-CN as AI drafts per the multilingual initiative's convention).

## 5. Error handling & edge cases

- Unlimited quota (`grantedMinutes`/`annualQuota` null): never over quota; no warnings.
- Negative remaining from historical over-approval: over-quota math uses `max(0, remaining)` so existing negative balances don't produce negative deductions.
- Leave spanning a year boundary: charged to the year of `startDate` (existing rule); unchanged.
- Cancelled/rejected/soft-deleted requests excluded everywhere (existing convention).
- Approved-then-deleted leave whose deduction already hit a payroll: deletion flow warns admin if `deductedInPayrollId` is set (mirrors advance behavior).
- Daily/Hourly employee with zero attendance in period: cap is 0 minus reserved → available 0; worker sees warning on any request.

## 6. Testing

- Unit: per-minute rate per salary type; over-quota freeze math (within, partially over, fully over, unlimited, negative remaining); `periodEarnings` for Daily/Hourly incl. cutoff boundaries; payroll `deductLeave` pickup + once-only stamping; report aggregation functions.
- E2E (Playwright, existing suite conventions): reports pages render with seeded data; LIFF leave form shows over-quota warning; admin modal blocks Block-policy approval; DeductPay approval shows deduction.

## Out of scope

- CSV/Excel/PDF export of reports.
- Per-employee work-week in working-day expansion (existing limitation, unchanged).
- Changing the annual entitlement period model.
- Admin panel translation (intentionally Thai-only, unchanged).
