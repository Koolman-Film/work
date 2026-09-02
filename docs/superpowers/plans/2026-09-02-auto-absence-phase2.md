# Auto-absence Phase 2: Derived Absence Becomes Money — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Payroll charges for days an employee was scheduled, didn't check in, and had no leave — instead of only charging what an admin keyed by hand.

**Architecture:** Whole-day derivation only. A day with ANY approved leave derives nothing, so `absentCount` stays an integer and the settlement path is untouched. A new nullable `PayrollConfig.absenceDerivedFrom` is the master switch: `null` = OFF, and no date before it ever derives.

**Spec:** `docs/superpowers/specs/2026-08-10-auto-absence-design.md`
**Phase 1:** shipped in `7ac5e51` + `7876688` (pure core, read-only preview).

## Global Constraints

- **Whole days only.** Decision revised 2026-09-02 with production data: partial-leave-plus-no-check-in happens ~once per 4 months (one case: ฟิล์ม, 25 Jun, 1hr leave). Fractional absence would force fractional days through `actualDaysFromAttendance` and the `publishPayroll` settled-vs-actual guard — the path the `penalty-settlement.integration.test.ts` race tests protect. Not worth it for one case. **Do NOT touch `reconcile-settlement.ts`.**
- **A day with any approved leave derives nothing.** Under-charging is the safe direction and matches how phase 1 already treats unknown leave duration.
- **`absenceDerivedFrom` is the master switch.** `null` = feature off, and no date before it derives. It must ship in the SAME deploy as the money change.
- Published payrolls are never recomputed — every write in `run.ts` is gated on `status: 'Draft'`. Do not weaken that.
- Manual `Absent` rows win: a date with one derives nothing, so the two can never both charge.
- Full gate before each commit: `npx biome check src/ tests/`, `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `pnpm db:test:deploy && pnpm test:integration`.

---

### Task 1: The master switch (migration + config)

**Files:**
- Create: `prisma/migrations/0047_absence_derived_from/migration.sql`
- Modify: `prisma/schema.prisma` (PayrollConfig)
- Modify: `src/lib/payroll/money-config.ts`
- Modify: `src/app/(admin)/admin/settings/payroll/page.tsx`, `actions.ts`

**Interfaces:**
- Produces: `PayrollConfig.absenceDerivedFrom: DateTime? @db.Date`. `null` means the feature is OFF.

- [ ] **Step 1: Write the migration by hand**

Hand-author it — `migrate dev --create-only` emits spurious DROP DEFAULTs on this schema.

```sql
-- prisma/migrations/0047_absence_derived_from/migration.sql
-- Master switch for derived absence. NULL = feature OFF, which is the state
-- every existing row takes, so this deploy changes nobody's pay. No date before
-- this one ever derives an absence: the lower bound the leave sweep never had
-- (see the ฿27,450 incident, 2026-08-03).
ALTER TABLE "PayrollConfig" ADD COLUMN "absenceDerivedFrom" DATE;
```

- [ ] **Step 2: Mirror it in the schema**

In `model PayrollConfig`, add with the doc comment:

```prisma
  /// Derived absence starts here. NULL = the feature is OFF and nothing is
  /// derived at all. Nothing before this date is ever charged, so switching the
  /// feature on cannot reach back into history.
  absenceDerivedFrom    DateTime? @db.Date
```

- [ ] **Step 3: Apply locally and verify it is additive**

```bash
pnpm db:deploy
pnpm db:test:deploy
```
Expected: applies cleanly; existing rows get `NULL`.

- [ ] **Step 4: Expose it in payroll settings**

Add to the zod schema in `money-config.ts` as an optional date string (empty → `null`), and to the settings form as a date input labelled `เริ่มคิดวันขาดงานอัตโนมัติตั้งแต่วันที่` with the hint `เว้นว่าง = ปิดการคิดอัตโนมัติ ระบบจะนับขาดงานเฉพาะที่แอดมินคีย์เอง — วันก่อนหน้าวันนี้จะไม่ถูกคิดย้อนหลัง`. Follow the existing `leaveDeductMaxPercent` field exactly.

- [ ] **Step 5: Gate and commit**

```bash
npx biome check --write src/ && npx tsc --noEmit -p tsconfig.json && npx vitest run && pnpm test:integration
git add prisma/ src/
git commit -m "feat(payroll): absenceDerivedFrom master switch (null = off)"
```

---

### Task 2: Whole-day derivation in the pure core

**Files:**
- Modify: `src/lib/attendance/derive-absence.ts`
- Modify: `src/lib/attendance/derive-absence.test.ts`
- Modify: `src/lib/attendance/absence-preview.ts` (keep the preview identical to payroll)

**Interfaces:**
- Produces: `deriveAbsentMinutes` gains no new parameter; `leaveMinutes` semantics change — ANY non-zero or unknown leave now yields 0.

- [ ] **Step 1: Change the failing tests first**

Replace the fractional expectations in `derive-absence.test.ts`:

```ts
  it('derives NOTHING when any approved leave touches the day', () => {
    // Revised 2026-09-02 with production data: the partial-leave-plus-no-show
    // case happens ~once per four months, and charging it fractionally would
    // force fractional days through the publishPayroll settlement guard. A day
    // the employee had any approved leave on is left alone instead.
    expect(deriveAbsentMinutes(day({ leaveMinutes: 180 }))).toBe(0);
    expect(deriveAbsentMinutes(day({ leaveMinutes: 480 }))).toBe(0);
    expect(deriveAbsentMinutes(day({ leaveMinutes: 1 }))).toBe(0);
    expect(deriveAbsentMinutes(day({ leaveMinutes: null }))).toBe(0);
  });

  it('still derives the whole scheduled day when there is no leave at all', () => {
    expect(deriveAbsentMinutes(day({ leaveMinutes: 0 }))).toBe(480);
  });
```

Delete the now-obsolete `derives only the uncovered part`, `derives nothing when leave covers the whole scheduled day` and `clamps to zero when leave exceeds` cases — they described the fractional behaviour.

- [ ] **Step 2: Run, confirm the fractional tests fail**

Run: `npx vitest run src/lib/attendance/derive-absence.test.ts`
Expected: FAIL on `leaveMinutes: 180` (returns 300, expected 0).

- [ ] **Step 3: Implement**

Replace the tail of `deriveAbsentMinutes`:

```ts
  // ANY approved leave on the day means the day is not derivable. Whole days
  // only: charging the uncovered part would make absentCount fractional, and
  // fractional days must then flow through actualDaysFromAttendance and the
  // publishPayroll settled-vs-actual guard or that guard misfires. Production
  // sees this case about once every four months (one instance in four months of
  // data), which does not justify disturbing the most delicate money path in
  // the system. Under-charging is the safe direction, and it matches how an
  // unknown leave duration is already treated.
  if (input.leaveMinutes === null || input.leaveMinutes > 0) return 0;
  return Math.max(0, input.scheduledMinutes);
```

- [ ] **Step 4: Run both suites**

Run: `npx vitest run && pnpm test:integration`
Expected: the preview integration test `derives only the uncovered part of a half-day leave` now fails — REPLACE it with:

```ts
  it('derives nothing at all for a day with partial leave', async () => {
    const { employee, userId } = await seed();
    await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: new Date('2026-06-01'),
        type: 'OnLeave',
        source: 'Manual',
        createdById: userId,
        durationMinutes: 180,
      },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });
```

- [ ] **Step 5: Gate and commit**

```bash
git add src/lib/attendance/ tests/integration/absence-preview.integration.test.ts
git commit -m "feat(attendance): whole-day derivation; any leave exempts the day"
```

---

### Task 3: The money — derived absences reach payroll

**Files:**
- Modify: `src/lib/payroll/calc.ts` (`CalcInput`, `CalcBreakdown`, the absent block)
- Modify: `src/lib/payroll/run.ts` (compute derived days, pass them in)
- Test: `src/lib/payroll/calc.test.ts`, `tests/integration/payroll-derived-absence.integration.test.ts` (create)

**Interfaces:**
- Consumes: `deriveAbsentMinutes` (Task 2); `absenceDerivedFrom` (Task 1).
- Produces: `CalcInput.derivedAbsentDays?: number` (whole days, default 0) and `CalcBreakdown.attendance.absent.derivedDays: number`.

- [ ] **Step 1: Failing unit test in `calc.test.ts`**

```ts
it('charges derived absent days alongside keyed Absent rows, without double counting', () => {
  const out = calcPayroll({
    ...baseInput,
    attendances: [{ date: new Date('2026-06-02'), type: 'Absent', durationMinutes: null }],
    derivedAbsentDays: 2,
  });
  // 1 keyed + 2 derived = 3 days at the employee's own daily rate.
  expect(out.breakdown.attendance.absent.count).toBe(3);
  expect(out.breakdown.attendance.absent.derivedDays).toBe(2);
});

it('treats a missing derivedAbsentDays as zero — the pre-feature behaviour', () => {
  const out = calcPayroll({ ...baseInput, attendances: [] });
  expect(out.breakdown.attendance.absent.count).toBe(0);
});
```

Match `baseInput` to whatever the existing tests in that file already build; do not invent a new fixture shape.

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run src/lib/payroll/calc.test.ts`
Expected: FAIL — `derivedAbsentDays` is not a known property.

- [ ] **Step 3: Implement in `calc.ts`**

Add to `CalcInput`:

```ts
  /**
   * Whole days of absence DERIVED from the schedule (scheduled day, no
   * check-in, no leave, no keyed Absent row, on or after
   * PayrollConfig.absenceDerivedFrom). Omit → 0, which is the pre-feature
   * behaviour and what every caller did before this existed. Whole days by
   * construction: see derive-absence.ts for why it is never fractional.
   */
  derivedAbsentDays?: number;
```

In the absent block, after the `for` loop over `input.attendances`:

```ts
  // Derived days are ADDED to the keyed ones. They can never overlap: the
  // derivation skips any date that already has a manual Absent row, so the
  // admin's explicit statement and the inference never charge the same day.
  const derivedAbsentDays = Math.max(0, Math.trunc(input.derivedAbsentDays ?? 0));
  absentCount += derivedAbsentDays;
```

`absentCount` must be `let`, and `derivedAbsentDays` must be surfaced on the breakdown's `attendance.absent` object.

- [ ] **Step 4: Wire `run.ts`**

`run.ts` already builds `leaveDatesByEmp` (the per-employee set of leave-covered dates in the window) and already loads attendance per employee. Add, before the `calcPayroll` call, a per-employee derived count that:
- returns 0 when `config.absenceDerivedFrom` is null,
- iterates the window from `max(windowStart, employee.hiredAt, absenceDerivedFrom)` to `min(windowEnd, today)`,
- skips employees with no `workScheduleId`,
- skips dates in `leaveDatesByEmp`, dates with a CheckIn, and dates with a keyed Absent,
- counts a day when `isScheduledWorkday(dows, dow, isHoliday)`.

Reuse `deriveAbsentMinutes` so payroll and the preview can never disagree; count a day when it returns > 0.

- [ ] **Step 5: Integration test — the guard that matters most**

Create `tests/integration/payroll-derived-absence.integration.test.ts` asserting, against a real DB:
1. `absenceDerivedFrom = null` ⇒ `deductAttendance` is byte-identical to today's value (**the deploy-safety test**).
2. With a cutoff set, a scheduled no-show day after it is charged exactly one day at `dailyRateFor`.
3. A day BEFORE the cutoff is never charged.
4. A day with approved leave is never charged.
5. A day with a keyed `Absent` row is charged exactly once, not twice.
6. A **Published** payroll is not recomputed when the cutoff changes.

- [ ] **Step 6: Gate and commit**

```bash
npx biome check --write src/ tests/ && npx tsc --noEmit -p tsconfig.json && npx vitest run && pnpm test:integration
git add src/lib/payroll/ tests/integration/payroll-derived-absence.integration.test.ts
git commit -m "feat(payroll): charge derived absence days"
```

---

### Task 4: Prove it against production before enabling

- [ ] **Step 1: Deploy with `absenceDerivedFrom` still NULL**

The feature is inert. Confirm via SQL that the column exists and every row is `NULL`.

- [ ] **Step 2: Recompute a DRAFT month and diff**

With the switch still off, recompute the current Draft month and confirm every `deductAttendance` is unchanged from before the deploy. This is the real proof that a null switch changes nothing.

- [ ] **Step 3: Read the preview for the month you intend to enable**

`/admin/tools/absence-preview`. Every row must be explainable. A total near an employee's salary means derivation is wrong for them, not merely expensive — stop and investigate.

- [ ] **Step 4: Set the cutoff to a FUTURE date, never a past one**

Set `absenceDerivedFrom` to the start of the next pay period, so the first charged month is one nobody has been paid for yet. **Never set it to a past date**: that would reach back into months employees have already been paid for.

## Not in this phase

- Fractional absence (revised out above — revisit only if the partial-leave-no-show case becomes common).
- The "record presence without a late penalty" checkbox on the manual-entry form (spec decision #3) — independent of the money change and can ship separately.
