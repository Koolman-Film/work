# Payroll Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin earnings/deductions entry (one-time / monthly / date-range), per-employee SSO toggle, monthly payroll run with net-pay summary, and a LIFF payslip with LINE publish notification.

**Architecture:** New `PayrollAdjustment` model feeds the existing pure calc engine (`src/lib/payroll/calc.ts`) via new `incomeOther`/`deductOther` buckets; a new `run.ts` pipeline gathers inputs and upserts `Payroll` rows (Draft → Published → Locked); admin pages follow the `/admin/employees` Server-Action + Zod pattern; the LIFF payslip follows `/liff/summary` and publish notifications reuse the `sendNotification` → Inngest → LINE Flex pipeline.

**Tech Stack:** Next.js App Router, Prisma + Supabase Postgres, decimal.js, Zod, Inngest, LINE Messaging API, next-intl-style JSON messages (6 locales).

**Spec:** `docs/superpowers/specs/2026-06-11-payroll-management-design.md`

---

### Task 1: Schema — PayrollAdjustment, Employee.hasSso, Payroll.deductOther (migration 0027)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0027_payroll_adjustments/migration.sql`

- [ ] **Step 1: Add to schema.prisma** — `AdjustmentKind` enum, `PayrollAdjustment` model (fields per spec: kind, reason, amount Decimal(12,2), startMonth, endMonth?, note?, deletedAt soft-delete, index `[employeeId, startMonth]`, relation on Employee), `hasSso Boolean @default(true)` on Employee (next to salary fields ~line 393), `deductOther Decimal @db.Decimal(12,2) @default(0)` on Payroll (after deductDebt).
- [ ] **Step 2: Write migration SQL by hand** (project convention: numbered folders). Include `ALTER TABLE "PayrollAdjustment" ENABLE ROW LEVEL SECURITY;` following migration 0019's pattern for new tables.
- [ ] **Step 3: Validate** — `pnpm prisma generate` (or `pnpm exec prisma validate`) passes.
- [ ] **Step 4: Commit** — `feat(payroll): PayrollAdjustment model, Employee.hasSso, Payroll.deductOther`

### Task 2: Calc engine — adjustments + hasSso + deductOther (TDD)

**Files:**
- Modify: `src/lib/payroll/calc.ts`, `src/lib/payroll/calc.test.ts`

- [ ] **Step 1: Failing tests** in calc.test.ts: (a) Income adjustments sum into `incomeOther` and net; (b) Deduction adjustments sum into new `deductOther` and subtract from net; (c) `hasSso: false` → `deductSso` 0; (d) `hasSso: true` unchanged 750 cap behavior.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/payroll/calc.test.ts` — expect FAIL (type errors / missing fields).
- [ ] **Step 3: Implement** — `EmployeeForPayroll` gains `hasSso: boolean`; new `AdjustmentForPayroll = { kind: 'Income' | 'Deduction'; amount: string | number | Decimal }`; `CalcInput.adjustments?: readonly AdjustmentForPayroll[]`; `PayrollDraft.deductOther: Decimal`; incomeOther/deductOther sums; SSO short-circuit; netPay minus deductOther.
- [ ] **Step 4: Run tests** — all pass (existing fixtures updated with `hasSso: true`).
- [ ] **Step 5: Commit** — `feat(payroll): adjustments and per-employee SSO in calc engine`

### Task 3: Adjustment selection helper (TDD)

**Files:**
- Create: `src/lib/payroll/adjustments.ts`, `src/lib/payroll/adjustments.test.ts`

- [ ] **Step 1: Failing tests** for `adjustmentAppliesToMonth(adj, month)`: one-time (start==end==M only), open-ended (M >= start), range inclusive bounds, lexicographic YYYY-MM compare.
- [ ] **Step 2: Implement**:

```ts
export type AdjustmentWindow = { startMonth: string; endMonth: string | null };
export function adjustmentAppliesToMonth(a: AdjustmentWindow, month: string): boolean {
  return a.startMonth <= month && (a.endMonth === null || month <= a.endMonth);
}
```

- [ ] **Step 3: Tests pass → Commit** — `feat(payroll): month-window helper for adjustments`

### Task 4: Payroll run pipeline (gather → calc → upsert Draft; publish transaction)

**Files:**
- Create: `src/lib/payroll/run.ts`
- Test: `src/lib/payroll/run.test.ts` (unit-test pure helpers; DB paths covered by typecheck + manual verify)

- [ ] **Step 1: `runPayrollDraft(month)`** — for each active Monthly employee: fetch attendance rows in the month (deletedAt null), un-stamped Approved CashAdvances, active RecurringDeductions, un-stamped Approved LeaveRequests with deductAmount, applicable PayrollAdjustments, PayrollConfig; call `calcPayroll`; upsert `Payroll` on `(employeeId, month)` **only when existing status is Draft or absent** (never overwrite Published/Locked). Employees whose calc throws (Daily/Hourly) are returned in a `skipped` list, not fatal.
- [ ] **Step 2: `publishPayroll(month)`** — single `prisma.$transaction`: set all Draft rows for month → Published + publishedAt; stamp `deductedInPayrollId` on the swept CashAdvance (`isDeducted: true`) and LeaveRequest rows; decrement `RecurringDeduction.monthsRemaining` (set `endedAt` when 0); return per-employee net for notifications. After the transaction: `sendNotification` per employee + `auditLog`.
- [ ] **Step 3: `lockPayroll(month)`** — Published → Locked.
- [ ] **Step 4: Commit** — `feat(payroll): draft/publish/lock pipeline`

### Task 5: Notification kind `payroll.published`

**Files:**
- Modify: `src/lib/inngest/events.ts` (new kind + payload `{ payrollId, month, employeeFirstName, netPay: string }` + idempotency key `notif:payroll.published:${payrollId}`)
- Modify: `src/lib/line/flex-templates.ts` (+ test in flex-templates.test.ts) — localized bubble "สลิปเงินเดือน {month}" with net pay and a button opening `/liff/payslip?m={month}`
- Modify: `src/lib/inngest/functions/line-push.ts` if it switches on kind

- [ ] Follow the existing per-locale pattern used by leave.approved. Commit — `feat(payroll): LINE payslip-published notification`

### Task 6: Admin adjustments CRUD — `/admin/payroll/adjustments`

**Files:**
- Create: `src/app/(admin)/admin/payroll/adjustments/page.tsx`, `adjustment-schema.ts` (+ `.test.ts`), `actions.ts`, `adjustment-form.tsx`, `new/page.tsx`, `[id]/page.tsx`
- Pattern: `/admin/employees` (requirePermission, Zod readForm, redirect-with-error, auditLog, revalidatePath)

- [ ] **Step 1: Zod schema** — employeeId uuid, kind enum, reason min 1, amount positive decimal string, frequency `'once' | 'monthly' | 'range'` mapped to startMonth/endMonth (`once`→end=start, `monthly`→end=null, `range`→validated start<=end), note optional. Test the mapping.
- [ ] **Step 2: Server Actions** — create/update/softDelete gated by `requirePermission('payroll.run')`; Decimal cast via `new Prisma.Decimal(...)`; auditLog each.
- [ ] **Step 3: Pages** — list with employee + kind + active-in-month filters (formatTHB amounts, Thai labels เงินเพิ่ม/เงินลด, ความถี่); form following employee-form.tsx idioms.
- [ ] **Step 4: Commit** — `feat(admin): payroll adjustments CRUD`

### Task 7: Employee SSO checkbox

**Files:**
- Modify: `src/app/(admin)/admin/employees/employee-schema.ts` (+ test), `employee-form.tsx`, `actions.ts`

- [ ] hasSso boolean (checkbox semantics: present=true), default true on create form; persists on create/update; shown in form near salary fields labeled "ประกันสังคม (หัก 5% จากฐานเงินเดือน)". Commit — `feat(admin): per-employee social security toggle`

### Task 8: Admin payroll run page — `/admin/payroll`

**Files:**
- Create: `src/app/(admin)/admin/payroll/page.tsx`, `actions.ts`, `month-nav.tsx` (or reuse pattern from reports), `run-buttons.tsx`
- Modify: `src/components/admin/sidebar.tsx` (enable `/admin/payroll`, `enabled: true`)

- [ ] **Step 1: Page** — `requirePermission('payroll.read')`; `?m=YYYY-MM` month param (default: current month); table of Payroll rows joined with adjustments breakdown: ฐาน / เงินเพิ่ม / SSO / เบิกล่วงหน้า / ขาด-สาย / หนี้ / ลาเกินสิทธิ์ / เงินลดอื่น / **สุทธิ**; footer row = company totals (requirement #1); status chip per row; skipped employees notice.
- [ ] **Step 2: Actions** — `calculateAction` (payroll.run) → `runPayrollDraft`; `publishAction` (payroll.publish) → `publishPayroll`; `lockAction` (payroll.publish) → `lockPayroll`; revalidatePath. Buttons disabled per current status mix.
- [ ] **Step 3: Sidebar enable + Commit** — `feat(admin): monthly payroll run page`

### Task 9: LIFF payslip — `/liff/payslip`

**Files:**
- Create: `src/app/(liff)/liff/payslip/page.tsx`
- Modify: `messages/{th,en,my,lo,zh-CN,km}.json` (new `payslip` namespace), `src/app/(liff)/liff/summary/page.tsx` (link)

- [ ] **Step 1: Page** — `requireRole(['Staff'])`; `?m=` month nav like summary; fetch own Payroll where `status IN (Published, Locked)`; if none → empty state "สลิปยังไม่ออก"; breakdown lists income lines (base + Income adjustments by reason) and deduction lines (SSO, advance, attendance, debt, leave, Deduction adjustments by reason); net total; formatTHB2.
- [ ] **Step 2: i18n** — th source of truth; translate to en/my/lo/zh-CN/km (AI-draft convention; adjustment `reason` strings render as-is, untranslated).
- [ ] **Step 3: Link from summary page.** Commit — `feat(liff): payslip page in 6 locales`

### Task 10: Verification

- [ ] `pnpm vitest run` — all unit tests pass.
- [ ] `pnpm exec tsc --noEmit` (or project typecheck script) passes.
- [ ] `pnpm lint` passes.
- [ ] Manual sanity via build: `pnpm build`.
- [ ] Final commit / merge prep.

## Self-review notes

- Spec coverage: model (T1), calc (T2–3), run+publish+sweep (T4), notification (T5), adjustments UI (T6), SSO toggle (T7), monthly summary + run page + sidebar (T8), LIFF payslip + i18n (T9). Out-of-scope items untouched.
- Publish must never re-stamp already-stamped rows (`deductedInPayrollId: null` filters) — covered in T4.
- Draft recalculation must include previously-swept rows for the SAME month (stamped with this month's payroll id) so re-running calc after publish-undo isn't needed — V1: recalculation only allowed while Draft, sweep happens at publish; calc preview uses un-stamped rows only. Consistent.
