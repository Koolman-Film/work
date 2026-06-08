# Partial-day leave, per-employee entitlements & overtime

**Date:** 2026-06-08
**Status:** Design — approved, pending spec review
**Author:** brainstormed with Vivatchai Kaveeta

## Summary

Three related additions to the admin/leave/attendance surface, built as three
sequential phases sharing one set of time-unit conventions:

1. **Partial-day leave** — leave can be taken as a **full day**, a **morning
   half**, an **afternoon half**, or an **hourly** time-segment. Each leave type
   (`ประเภทการลา`) declares which granularities it permits. A new company-wide
   `LeaveConfig` defines the morning/afternoon time windows (so "how many hours
   is a half day" is configurable, per the request). Internally everything is
   stored in **minutes**; the UI shows the hybrid **"X วัน Y ชม."** form.

2. **Per-employee leave entitlements** — a new `LeaveEntitlement` table holds
   each employee's per-type, per-year allowance, **seeded from the leave type's
   `annualQuota` default but individually editable**. This makes onboarding
   ("กรอกสิทธิวันลาเอง") possible, including mid-year hires who already used
   leave before go-live (an explicit opening **adjustment**). Remaining =
   `granted + carryover + adjustment − used`, where `used` is the sum of
   approved leave (now in minutes).

3. **Overtime (OT)** — a new `OvertimeEntry` table plus a dedicated admin OT
   menu. The system **auto-surfaces candidate days** where clock-out beat the
   scheduled end, and the admin approves each as OT (or dismisses it) and can
   also add OT manually. Each entry's pay rate is either a **manual ฿/hour** or
   a **×multiplier of the derived hourly wage** — selectable per entry, with a
   per-employee default. Approved OT flows into payroll as a new income line.

These map to the existing nav: leave-type/config under `/admin/settings`, OT
under `/admin/attendance`, entitlements on the employee edit page.

## Goals

- Let employees request **less than a full day** of leave (morning/afternoon
  half, or an arbitrary hourly segment) where the leave type allows it.
- Make "what a half day is worth" **configurable** company-wide, not hardcoded.
- Track leave precisely in **minutes**, presented as a readable **days+hours**
  hybrid everywhere quotas/balances appear.
- Give every employee an **editable per-year entitlement** per leave type, so
  admins can onboard real balances by hand and correct for prior usage.
- Surface **OT candidates automatically** from existing clock-out data and let
  admins confirm/price them, with both flat-rate and multiplier pricing.
- Feed **approved OT into payroll** as an income line.

## Non-goals

- **No multi-day partial leave** (e.g. "Mon full + Tue morning"). Half/hourly
  leave is **single-date only**; multi-day leave stays full-day. (Future.)
- **No carryover automation.** `carryoverMinutes` exists and is manually set;
  year-end roll-forward logic is out of scope.
- **No hard balance enforcement.** Over-balance requests are **soft-warned** at
  submit and flagged to the approver, never blocked (matches today's
  unenforced quotas).
- **No holiday/rest-day OT tiers** (Thai 1×/2×/3× holiday work). v1 OT is
  "worked past the scheduled end of a normal working day." (Future.)
- **No change to the Monthly-only payroll limitation.** Daily/Hourly base-pay
  calc still throws; OT is recorded for all salary types but only enters a
  payslip when payroll runs (Monthly today).
- No employee self-service editing of their own entitlement (admin-only).

## Key decisions

1. **Minutes are the canonical unit; days+hours is a display layer.**
   `Attendance.durationMinutes` already exists, so storing leave duration in
   minutes is natural and dodges floating-point drift. A single helper converts
   minutes ↔ "X วัน Y ชม." using the derived standard-day length.

2. **A full leave day = exactly one standard day, decoupled from the
   employee's actual shift.** Leave is accounted in standard days (company-wide
   `LeaveConfig`), so a full day off always costs `standardDayMinutes` of
   balance regardless of whether the person works an 8h or 12h shift. This keeps
   balances comparable across employees and avoids "one day off = 1.5 days."

3. **`standardDayMinutes` is derived from the half-day windows**
   (`morning window + afternoon window`), so "morning-half + afternoon-half =
   one full day" always holds and there is a single source of truth.

4. **Per-type granularity flags.** Each `LeaveType` carries
   `allowFullDay / allowHalfDay / allowHourly`. The LIFF picker offers only what
   the chosen type permits — this is the "generic & flexible" mechanism.

5. **Partial leave is modeled as a time segment** (`startTime`–`endTime` on one
   date). Morning/afternoon halves are **presets** that fill the segment from
   `LeaveConfig`; hourly lets the employee pick it. Keeping the time window
   (not a bare hour count) lets OT/attendance reconcile "who was actually here."

6. **`chargedMinutes` is frozen on the request at approval.** Balance math and
   reporting read this stored value, so changing `LeaveConfig` later never
   retroactively rewrites historical balances.

7. **Entitlements seed from the type default but are per-employee rows.**
   `LeaveType.annualQuota` stays the company default; `LeaveEntitlement` holds
   the per-employee, per-year grant. `grantedMinutes` is nullable — `null`
   mirrors `annualQuota = null` (unlimited, no enforcement/warning).

8. **Onboarding prior-usage uses a signed `adjustmentMinutes`, not a fudged
   grant.** `granted` stays honest at policy; the adjustment (e.g. −3 days)
   expresses "already used before the system existed." All edits go through the
   existing `auditLog` (before/after + actor), so no separate ledger table.

9. **OT is its own table, not an `AttType` variant.** OT carries pay semantics
   (rate mode, amount, approval state) that don't belong on an attendance row.
   `Attendance` stays about *presence*; `OvertimeEntry` about *compensation*.

10. **OT candidates are computed live; only decisions are persisted.** No
    background job — the OT page computes candidates from `Attendance` on each
    load (mirroring how the live board already works). Approving creates an
    `OvertimeEntry{status:Approved}`; dismissing creates `{status:Rejected}` so
    that date stops re-surfacing.

11. **`computedAmount` is frozen at approval.** A multiplier-mode entry snapshots
    the derived wage at decision time, so later salary changes don't rewrite
    historical OT pay.

12. **Both OT rate modes, selectable per entry.** `rateType ∈ {PerHourAmount,
    Multiplier}`; the employee's `defaultOt*` fields prefill new entries, each
    overridable. Satisfies "enter the rate yourself" *and* labor-law multipliers.

---

## Shared foundation (built in Phase 1, used by all)

### `LeaveConfig` — new singleton

Follows the `PayrollConfig` singleton pattern (model allows many rows; app reads
the first via `findFirst()`; seed creates one).

```prisma
/// Company-wide leave-unit configuration (singleton — read via findFirst()).
/// Defines the morning/afternoon half-day windows; the standard day length
/// is derived from them. Edited on /admin/settings/leave-config.
model LeaveConfig {
  id             String   @id @default(uuid()) @db.Uuid
  /// "HH:MM" 24-hour, app-validated (same convention as WorkScheduleDay).
  morningStart   String   @default("09:00")
  morningEnd     String   @default("12:00")
  afternoonStart String   @default("13:00")
  afternoonEnd   String   @default("17:00")
  updatedAt      DateTime @updatedAt
}
```

### `PayrollConfig` — extended (Phase 3 needs these, added in the OT migration)

```prisma
+ workingDaysPerMonth Int @default(30)   // derive hourly wage from a monthly salary
+ otThresholdMinutes  Int @default(30)   // clock-out must beat schedule by this to be an OT candidate
  // existing otMultiplier stays — it's the default value offered for Multiplier-mode entries
```

### `src/lib/leave/units.ts` — new pure helper (the unit brain)

```ts
export type LeaveUnitTimes = { morningStart, morningEnd, afternoonStart, afternoonEnd }; // from LeaveConfig

minutesOf(hhmm: string): number                     // "13:30" → 810
windowMinutes(start, end): number                   // end − start
morningMinutes(cfg), afternoonMinutes(cfg): number
standardDayMinutes(cfg): number                     // morning + afternoon
segmentFor(unit, cfg, startTime?, endTime?):        // resolve a request to a concrete segment
  { startTime, endTime, minutes }                   // FullDay → null times, minutes per-day handled by caller
formatDaysHours(minutes, cfg): string               // 420/day → 600 → "1 วัน 3 ชม." (also "3 ชม." / "1 วัน")
```

Pure and unit-tested. The single place that knows how minutes map to days.

---

## Phase 1 — Partial-day leave

### Data model

```prisma
enum LeaveUnit { FullDay  HalfMorning  HalfAfternoon  Hourly }

model LeaveType {
  // ...existing...
+ allowFullDay Boolean @default(true)
+ allowHalfDay Boolean @default(false)
+ allowHourly  Boolean @default(false)
}

model LeaveRequest {
  // ...existing (startDate, endDate, ...) ...
+ unit           LeaveUnit @default(FullDay)
+ startTime      String?   // "HH:MM" — set for HalfMorning/HalfAfternoon/Hourly
+ endTime        String?
+ chargedMinutes Int?      // finalized at approval; the amount deducted from balance
}
```

Migration `0016_partial_day_leave`: add the enum, the three `LeaveType`
booleans (existing rows default to full-day-only — safe), the `LeaveRequest`
columns, create the `LeaveConfig` table + seed one row, and **replace the
`Attendance` partial-unique index to exclude `OnLeave`** (raw SQL — drop
`Attendance_employeeId_date_type_live_key`, recreate it `WHERE deletedAt IS NULL
AND type <> 'OnLeave'`) so a date can hold multiple OnLeave rows. Backfill
`LeaveRequest.unit = 'FullDay'` for existing rows (the default handles it).

### Flows

**Submit (`src/lib/leave/actions.ts::submitLeaveRequest`)** — accepts
`unit`, optional `startTime`/`endTime`. New validation:
- The chosen `unit` must be permitted by the leave type's flags.
- `FullDay` → existing multi-day path unchanged.
- `HalfMorning`/`HalfAfternoon`/`Hourly` → enforce `startDate === endDate`
  (single date) and that the date is a working day (not Sunday/holiday — a
  partial leave on a closed day is meaningless). `Hourly` requires a valid
  `startTime < endTime` within the working day; halves derive times from
  `LeaveConfig` and ignore any posted times.
- `chargedMinutes` is **not** trusted from the client — computed server-side.

**Approval (`src/lib/leave/admin.ts::approveLeaveRequest`)** — the working-day
expansion gains unit-awareness:
- `FullDay`: one `Attendance{OnLeave}` per working day (as today), each with
  `durationMinutes = standardDayMinutes`. `chargedMinutes = workingDays.length ×
  standardDayMinutes`.
- Partial (single date): one `Attendance{OnLeave}` row with
  `durationMinutes = segment.minutes`, `clockInAt`/`clockOutAt` set to the
  segment's times on that date (so the row reconciles with a same-day check-in
  for the other half). `chargedMinutes = segment.minutes`.
- **Per-date cap (over-allocation guard):** before inserting, sum the
  `durationMinutes` of existing non-deleted `OnLeave` rows for each target date;
  reject the whole request if existing + new would exceed `standardDayMinutes`
  on any date (message names the date). This replaces the old
  `skipDuplicates`-on-unique approach — `OnLeave` is no longer in the unique
  index, so half+half on a date coexist as two rows while full+anything is
  capped out.
- The stored `chargedMinutes` is written to the `LeaveRequest` inside the same
  transaction. Audit `after` payload gains `unit` + `chargedMinutes`.

> **Multiple partial leaves per date (supported).** A single date may hold
> **more than one** `OnLeave` row — e.g. a morning-half and an afternoon-half
> from two **separate** requests, which is realistic (an employee may ask for
> them at different times). To allow this, Phase 1 changes the `Attendance`
> partial-unique to **exclude `OnLeave`** (`... WHERE deletedAt IS NULL AND type
> <> 'OnLeave'`), and approval instead enforces a **per-date cap**: existing +
> new `OnLeave` minutes for any date must not exceed `standardDayMinutes`. So
> half+half is fine; half+full or full+full on the same date is rejected with a
> message naming the conflicting date. Each request keeps its **own** OnLeave
> rows (linked by `leaveRequestId`), so voiding one request removes only its
> rows.

### UI

- **`leave-type-form.tsx` + `actions.ts`** (settings) — three checkboxes
  (`เต็มวัน / ครึ่งวัน / รายชั่วโมง`); Zod schema + `normalize()` gain the
  booleans; audit before/after includes them. At least one must be checked.
- **`/admin/settings/leave-config`** *(new)* — a small Server Component page +
  form + `actions.ts` editing the four time windows, guarded by a new
  `settings.leave-config.manage` permission; shows the derived standard day
  ("วันทำงานมาตรฐาน = 7 ชม."). Added to `settings-nav.tsx`.
- **`leave-new-form.tsx`** (LIFF) — after the type select, a **unit selector**
  rendering only the type's allowed units. Choosing `Hourly` reveals from/to
  time inputs; halves show their fixed window read-only. The date inputs collapse
  to a single date when unit ≠ FullDay. The preview switches from "X วันทำงาน"
  to `formatDaysHours(chargedMinutes)` ("ลา 3 ชม."). `LeaveTypeOption` carries
  the three flags; the page loader selects them.

### Testing
- `units.ts`: window math, `standardDayMinutes`, `segmentFor` for each unit,
  `formatDaysHours` boundaries (0, <1 day, exact day, day+hours).
- `submitLeaveRequest`: rejects a disallowed unit; rejects multi-date partial;
  rejects hourly with `start ≥ end`; rejects partial on Sunday/holiday; accepts
  a valid hourly/half.
- `approveLeaveRequest`: full-day charges `days × standardDayMinutes` and writes
  per-day rows; partial charges the segment and writes one timed OnLeave row;
  morning-half + afternoon-half on the same date (two separate requests) both
  approve as two rows; half + full (or full + full) on the same date is rejected
  by the per-date cap.

---

## Phase 2 — Per-employee entitlements

### Data model

```prisma
model LeaveEntitlement {
  id               String    @id @default(uuid()) @db.Uuid
  employeeId       String    @db.Uuid
  employee         Employee  @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  leaveTypeId      String    @db.Uuid
  leaveType        LeaveType @relation(fields: [leaveTypeId], references: [id], onDelete: Restrict)
  periodYear       Int       // calendar year
  grantedMinutes   Int?      // seeded from annualQuota × standardDayMinutes; null = unlimited
  carryoverMinutes Int       @default(0)
  adjustmentMinutes Int      @default(0)  // signed; opening balance / corrections
  note             String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@unique([employeeId, leaveTypeId, periodYear])
  @@index([employeeId, periodYear])
}
```

Add the back-relation `entitlements LeaveEntitlement[]` to both `Employee` and
`LeaveType`. Migration `0017_leave_entitlements`.

### `src/lib/leave/balance.ts` — new helper

```ts
usedMinutes(employeeId, leaveTypeId, year): Promise<number>
  // Σ chargedMinutes of Approved, non-deleted LeaveRequests
  // bucketed by the request's startDate year (v1: a year-spanning
  // multi-day leave counts wholly in its start year — noted limitation).

remaining(entitlement, used): number | null   // null granted → null (unlimited)
  // (granted ?? ∞) + carryover + adjustment − used
```

### Seeding

`getOrSeedEntitlements(employeeId, year)` — when the employee-edit entitlements
section first renders a year with no rows, create one row per **active**
`LeaveType` with `grantedMinutes = annualQuota != null ? annualQuota ×
standardDayMinutes : null`, `carryover = adjustment = 0`. Idempotent (skip types
that already have a row). Runs in a transaction; not audit-logged (seeding the
default is not a manual change — only subsequent edits are).

### UI

- **Employee edit page** (`/admin/employees/[id]/edit`) gains a
  **"สิทธิวันลา"** section below the form: a year selector (default current
  Bangkok year) and a table — one row per leave type showing
  *Granted / Carryover / Adjustment / Used / Remaining* in the days+hours
  format, with inline-editable Granted / Carryover / Adjustment / Note.
- A `upsertEntitlement` server action (new `entitlements/actions.ts`) guarded by
  `leave.entitlement.manage`, audit-logged (before/after). Inputs use the same
  **days + hours** hybrid widget as the display (consistent with Phase 1), so an
  admin can grant "6 วัน" or a "−3 วัน 4 ชม." adjustment; values convert to
  minutes via `standardDayMinutes` for storage.
- **Adjustment column, explained.** `adjustmentMinutes` defaults to **0** and is
  non-zero only when an admin types it. Two uses: (a) **onboarding prior usage** —
  a mid-year/migrated employee who already took leave before go-live has no
  system `used`, so the admin enters a **negative** adjustment (e.g. −3 วัน 4 ชม.)
  to make Remaining reflect reality; (b) **one-off grants** — a **positive**
  adjustment (e.g. +2 วัน) without changing the policy `granted`. It appears in the
  table's Adjustment column and is audit-logged on change. Most employees show 0.
- **Create page stays lean** — entitlements auto-seed on first edit-page visit;
  no entitlement fields on the create form.

### LIFF balance display & soft-warn (closes the loop with Phase 1)

- `leave-new-form.tsx` page loader fetches the current-year `remaining` for each
  leave type and passes it on `LeaveTypeOption`. The form shows
  "คงเหลือ: X วัน Y ชม." for the selected type.
- If `chargedMinutes > remaining` (and remaining is not unlimited), the form
  shows an amber warning ("เกินสิทธิคงเหลือ … แอดมินจะพิจารณาอีกครั้ง") but the
  submit stays enabled. The approver's review panel surfaces the same flag.

### Testing
- `balance.ts`: used excludes Pending/Rejected/Cancelled/deleted; remaining math
  including null-granted (unlimited) and negative-after-adjustment.
- Seeding: creates one row per active type; unlimited types → null granted;
  idempotent re-run adds nothing; archived types skipped.
- `upsertEntitlement`: days→minutes conversion; audit before/after; permission.

---

## Phase 3 — Overtime

### Data model

```prisma
enum OtRateType { PerHourAmount  Multiplier }
enum OtStatus   { Approved  Rejected }

model OvertimeEntry {
  id                 String       @id @default(uuid()) @db.Uuid
  employeeId         String       @db.Uuid
  employee           Employee     @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  date               DateTime     @db.Date
  minutes            Int
  rateType           OtRateType
  ratePerHour        Decimal?     @db.Decimal(12, 2)  // when PerHourAmount
  multiplier         Decimal?     @db.Decimal(3, 2)   // when Multiplier (matches PayrollConfig.otMultiplier)
  computedAmount     Decimal      @db.Decimal(12, 2)  // frozen pay at approval
  status             OtStatus
  sourceAttendanceId String?      @db.Uuid
  sourceAttendance   Attendance?  @relation(fields: [sourceAttendanceId], references: [id], onDelete: SetNull)
  note               String?
  reviewedById       String?      @db.Uuid
  reviewedAt         DateTime?
  deletedAt          DateTime?
  deletedById        String?      @db.Uuid
  deleteReason       String?
  createdAt          DateTime     @default(now())
  createdById        String       @db.Uuid

  @@index([employeeId, date])
  @@index([status])
  @@index([deletedAt])
  // PARTIAL unique (employeeId, date) WHERE deletedAt IS NULL — raw SQL in the
  // migration (Prisma DSL can't express partial unique; see Attendance 0014).
}

model Employee {
  // ...existing...
+ defaultOtRateType    OtRateType?
+ defaultOtRatePerHour Decimal?    @db.Decimal(12, 2)
+ defaultOtMultiplier  Decimal?    @db.Decimal(3, 2)
}

model Payroll {
+ incomeOt Decimal @db.Decimal(12, 2) @default(0)   // approved OT for the month
}
```

Migration `0018_overtime`: enums, `OvertimeEntry` + its **partial-unique index
via raw SQL**, `Employee.defaultOt*`, `Payroll.incomeOt`, `PayrollConfig`
extensions (`workingDaysPerMonth`, `otThresholdMinutes`). Register
`OvertimeEntry` in `src/lib/db/soft-delete-extension.ts` so default queries hide
voided rows (it has `deletedAt`).

> Add the back-relation field `overtimeEntries OvertimeEntry[]` to `Attendance`
> (the other side of the `sourceAttendance` FK) so Prisma can infer the relation.

### `src/lib/overtime/rate.ts` — pure pricing

```ts
hourlyWage(employee, cfg): Decimal
  // Hourly → baseSalary
  // Daily  → baseSalary / standardDayHours
  // Monthly→ baseSalary / (workingDaysPerMonth × standardDayHours)
  //   standardDayHours = standardDayMinutes(LeaveConfig)/60

computeOtAmount({ minutes, rateType, ratePerHour?, multiplier?, wage }): Decimal
  // PerHourAmount → (minutes/60) × ratePerHour
  // Multiplier    → (minutes/60) × wage × multiplier
```

`decimal.js` throughout (consistent with `payroll/calc.ts`).

### `src/lib/overtime/candidates.ts` — live detection

`getOtCandidates({ ym, employeeId? })` — finds `Attendance` rows
(`type: CheckIn`, non-deleted, with `clockOutAt`) in the month whose `clockOutAt`
exceeds the employee's `WorkScheduleDay.endTime` for that weekday by ≥
`otThresholdMinutes`, **excluding** dates that already have an `OvertimeEntry`
(Approved or Rejected). Returns `{ employee, date, minutesOver, suggestedRate }`
where `suggestedRate` is built from the employee's `defaultOt*` (falling back to
`PayrollConfig.otMultiplier`).

### UI & actions

- **`/admin/attendance/overtime`** *(new)* — guarded by
  `attendance.overtime.manage`, added to the attendance sub-nav. Three regions:
  - **ผู้เข้าข่าย OT (candidates):** the live list. Each row → an approve form
    prefilled with `minutesOver` + the suggested rate (both editable: rate mode
    toggle, hours, ฿/hr or ×) and a **dismiss** button.
  - **+ เพิ่ม OT เอง (manual add):** pick employee + date + hours + rate.
  - **ประวัติ (history):** Approved/Rejected entries for the month with void.
- **Actions** (`overtime/actions.ts`): `approveOt` (create
  `OvertimeEntry{Approved}`, snapshot `computedAmount` via `rate.ts`),
  `dismissOt` (create `{Rejected}`), `addManualOt`, `voidOt` (soft-delete). All
  audit-logged; all re-check the date's partial-unique before insert.
- **Employee edit page** — a small **"OT (ค่าล่วงเวลา)"** section: default rate
  mode + value (`defaultOt*`), saved through the existing employee update action
  (extend its Zod schema), audit-logged with the rest of the employee edit.

### Payroll integration

- **`payroll/calc.ts`** gains `overtime: { amount }[]` (or a pre-summed
  `incomeOt`) in `CalcInput`, an `incomeOt: Decimal` output, and includes it in
  `netPay` (`incomeBase + incomeOther + incomeOt − deductions`). Pure-function
  contract preserved (caller passes the figure in).
- The **payroll run** (caller that assembles `CalcInput`) fetches the month's
  `OvertimeEntry{status:Approved, deletedAt:null}` for the employee, sums
  `computedAmount`, and passes it. Persists to `Payroll.incomeOt`. Payslip PDF
  gains an OT line.
- Because base calc is Monthly-only today, OT only reaches a payslip for Monthly
  employees — consistent with current behavior; OT is still recorded for all.

### Permissions
Add to the catalog + the `attendance` group + `roles.ts` defaults:
- `attendance.overtime.manage` → `'จัดการ OT/ค่าล่วงเวลา'`
And for the leave phases:
- `settings.leave-config.manage` → `'จัดการการตั้งค่าการลา'` (settings group)
- `leave.entitlement.manage` → `'จัดการสิทธิวันลาของพนักงาน'` (leave group)

### Testing
- `rate.ts`: wage per salary type; `computeOtAmount` for both modes; rounding.
- `candidates.ts`: flags only over-threshold clock-outs; excludes decided dates;
  respects per-day schedule end; handles employees with no schedule (skip).
- `approveOt`/`dismissOt`: create the right status; snapshot amount; partial
  unique blocks a second live entry for a date; void frees it.
- `calc.ts`: `incomeOt` flows into `netPay`; zero when no OT.

---

## Cross-cutting: error handling & edge cases

- **Closed-day partial leave** — rejected at submit (no working day to charge).
- **Year-spanning multi-day leave** — counted wholly in its start year for
  balance (documented limitation; full-day multi-day across Dec→Jan is rare).
- **Unlimited types** (`annualQuota = null`) — `grantedMinutes = null`; no
  remaining figure, no soft-warn.
- **`LeaveConfig` change after approvals** — historical `chargedMinutes` /
  `computedAmount` are frozen, so past balances/payslips are unaffected; only
  new requests use the new windows.
- **Employee without a `workSchedule`** — excluded from OT candidate detection
  (no scheduled end to compare); manual OT add still works.
- **OnLeave counting is per-employee, not per-row.** Because a date can now hold
  two `OnLeave` rows (a morning + an afternoon half), the live board
  (`lib/attendance/live.ts`) and the dashboard "ลาวันนี้" count/list must be
  **distinct by employee** (an employee on two halves is one person on leave, not
  two). Existence-based logic (the not-checked-in `none` filter) is unaffected.
  *(This adjustment ships in Phase 1, since that's when multi-row dates become
  possible.)*
- **Soft-deleted OT / leave** — excluded from `used`, candidates, and payroll
  sums via the soft-delete extension + explicit `deletedAt: null` filters.
- **Permission gaps** — each new page/action guarded; pages the viewer can't
  access don't render their nav entry (existing settings-nav pattern).

## Phasing & delivery

Each phase is an independent spec→plan→build cycle under this umbrella; merge
order is 1 → 2 → 3 (2 depends on Phase 1's `units.ts` + `chargedMinutes`; 3 is
schema-independent of 1–2 but reuses `units.ts` for wage derivation).

| Phase | Migration | New tables/cols | Key files |
|-------|-----------|-----------------|-----------|
| 1 | `0016_partial_day_leave` | `LeaveConfig`; `LeaveType.allow*`; `LeaveRequest.unit/startTime/endTime/chargedMinutes`; `LeaveUnit` | `lib/leave/units.ts`, `leave/admin.ts`, `leave/actions.ts`, leave-type form, `settings/leave-config/*`, `liff/leave/new/*` |
| 2 | `0017_leave_entitlements` | `LeaveEntitlement` | `lib/leave/balance.ts`, employee edit entitlements section + `actions.ts`, LIFF balance/soft-warn |
| 3 | `0018_overtime` | `OvertimeEntry`; `Employee.defaultOt*`; `Payroll.incomeOt`; `PayrollConfig.workingDaysPerMonth/otThresholdMinutes`; `OtRateType`/`OtStatus` | `lib/overtime/{rate,candidates,actions}.ts`, `admin/attendance/overtime/*`, employee OT section, `payroll/calc.ts` |

## Out of scope / future

- Multi-day partial leave (start-half / end-half of a range).
- Automatic year-end carryover roll-forward and expiry.
- Hard balance enforcement / negative-balance blocking.
- Holiday/rest-day OT multiplier tiers (1×/2×/3×) and pre-shift (early-start) OT.
- Daily/Hourly base-pay payroll support (unblocks OT payslips for those types).
- Employee self-service view of their own remaining balance in LIFF beyond the
  request form (a dedicated "my leave balance" screen).
- A full per-line entitlement adjustments ledger (if audit-log before/after
  proves insufficient).
