# Auto-absence (derived) — Design

**Date:** 2026-08-10
**Status:** Decisions locked, design presented, **NOT yet approved** — awaiting sign-off
**Origin:** Customer request (Canva board + `todo_finnix_hr.txt`)

---

## The problem

Customer reported:

> "พนักงาน ไม่มาทำงาน (ไม่ได้เช็คอิน / ไม่ลา) แต่ระบบไม่ขึ้นว่า ขาดงาน"
> "วันที่ 4, 6, 7 ไม่ลงเวลา"

Investigated and it is **not a bug — the feature does not exist**:

- `Absent` rows are created in exactly ONE place: `src/lib/attendance/manual-preview.ts`
  (the admin manual-entry form). Nothing else, anywhere.
- No scheduled job creates one. `attendance-late-check` (Inngest, daily 10:00 Bangkok)
  only sends a summary bell notification — it writes nothing.
- Payroll counts `Absent` **rows** (`calc.ts:416` → `absentCount`) to compute
  `deductAttendance`.

So absence only ever exists when an admin keys it by hand, and payroll only ever
deducts what was keyed.

## Decisions locked (answered by the user, 2026-08-10)

| # | Question | Decision |
|---|---|---|
| 1 | Store absences or derive them? | **Derive at payroll time.** No stored rows for derived absences. Self-corrects when leave is approved retroactively. Matches the existing derive-on-read model for leave charges (`computeLiveLeaveCharges`). |
| 2 | Which days, on ship? | **Cutoff date + a preview page first.** Nothing before the cutoff ever counts. |
| 3 | "Worked but couldn't check in" (broken phone) | **Add a "no penalty" option to manual entry** — records presence without generating a `Late` row. |
| 4 | Partial leave + no show | **Absent for the uncovered part** (fractional absence). Requires new money math. |

## Design

### Pure core

Follows the codebase's pure-core pattern (`over-quota.ts`, `late-policy.ts`).

`src/lib/attendance/derive-absence.ts`

```ts
deriveAbsentMinutes({ scheduledMinutes, leaveMinutes, hasCheckIn, isWorkday }): number
```

- not a scheduled workday (Sunday / holiday / not in their schedule) → `0`
- `hasCheckIn` → `0` (they turned up; lateness + early-leave handle the rest)
- otherwise → `max(0, scheduledMinutes − leaveMinutes)`

Covers all four cases: no leave + no show = full day; half-morning leave + no show =
the afternoon; full-day leave = 0; half-day taken and worked = 0.

`isScheduledWorkday(scheduleDows, dow, hasHoliday)` already exists in
`src/lib/attendance/schedule.ts` and handles holidays plus the Mon–Sat fallback.

### Money change (the significant part)

Today: `absentCount` (whole rows) × `absentDeductionPerDay` (flat).

New:
```
absentDays = uncoveredMinutes / standardDayMinutes
deduction  = absentDays × absentDeductionPerDay
```

Two consequences:

1. **Manual rows win.** Admins can still key `Absent` by hand. If a manual row exists
   for a date, derivation **skips that date entirely** — the admin's explicit statement
   beats the inference. Prevents double-counting.
2. **It touches the publish guard.** `actualDaysFromAttendance`
   (`payroll/reconcile-settlement.ts`) returns whole days today. Absences can be settled
   with leave, and `publishPayroll` blocks when `settled > actual`. Fractions must flow
   through it or that guard misfires. This is the same guard the race tests in
   `penalty-settlement.integration.test.ts` cover — treat as money-critical.

### Three safety guards

1. **Cutoff date** — new nullable `PayrollConfig.absenceDerivedFrom`. `null` = feature
   OFF. Nothing derives until a date is set; nothing before it ever counts. This is the
   lower bound the leave sweep never had (see the ฿27,450 incident, 2026-08-03).
2. **Skip employees with no `WorkSchedule`.** With none, the system assumes Mon–Sat, so
   deriving would deduct a day's pay for every real day off. Derivation refuses to run
   for them at all — they are already flagged by the existing UI banner. Turns a footgun
   into a no-op. **Consequence: with all 9 employees currently unset, the feature does
   nothing until schedules are assigned.** That is deliberate but must be understood.
3. **Preview page** `/admin/tools/absence-preview` — read-only, mirrors
   `/admin/tools/leave-backlog`. Shows what would be derived and what it would cost,
   per employee, before the cutoff is set live.

### What ships

| Piece | Notes |
|---|---|
| Migration | one nullable column `PayrollConfig.absenceDerivedFrom` |
| Pure core + unit tests | the formula above |
| Payroll integration | fractional absence, manual-row precedence, settlement-guard fractions |
| Manual form | "record presence without a late penalty" checkbox (no schema change — the `Late` row is separate; just don't create it) |
| Preview page | read-only, `payroll.read` gated |

### Testing

- Unit: `deriveAbsentMinutes` — all four cases, clamping, holidays, no-schedule.
- Integration: payroll derives correctly; manual `Absent` does not double count; cutoff
  respected; retroactively-approved leave removes the absence; settlement guard with
  fractional days.

## Open risks (raised, not yet resolved)

1. **Fractional absence is the biggest money change in the backlog.** It alters
   `deductAttendance` for potentially every employee, because the settlement guard
   shifts underneath it. The preview page covers derivation but NOT the settlement
   interaction — that needs hard testing.
2. **"Skip no-schedule employees" means it silently does nothing today.** Safe by
   default, but it makes assigning schedules the switch that turns the feature on.
   User should confirm they want silence rather than a loud error.

## Next step

Design was presented in chat and **not yet approved**. On approval → `writing-plans`
skill to produce the implementation plan. Do NOT write code before approval.
