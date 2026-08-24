# Attendance Row Merge & Time Correction — Implementation Plan (Workstream B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one line per employee-day in the admin attendance table with late status on it, and let an admin correct a check-in or check-out time.

**Architecture:** The merge is presentational — `CheckIn` and `Late` stay separate rows in the database (decision B0.1). A pure grouping function turns the flat row list into day-groups; nothing in payroll changes. Time correction is a new server action built to the shape of `waiveLeaveDeduction`, because editing a clock time moves money.

**Tech Stack:** Next.js 16 Server Components · Prisma 6 · Vitest

**Spec:** `docs/superpowers/plans/2026-08-24-finnix-hr-backlog.md` §B0.

---

## Global Constraints

The master plan's Global Constraints apply. Specific to this workstream:

- **Tasks 1-2 need no schema change.** `CheckIn` and `Late` remain distinct rows enforced by the partial unique index on `(employeeId, date, type) WHERE deletedAt IS NULL` (migration 0014, raw SQL — Prisma cannot express partial-unique). If a task appears to need that index changed, the design is wrong.
- **Task 3 DOES carry DDL.** It needs a new permission (see below), and a permission is added by a backfill migration. That means **Task 3 must ship in the same deploy as `0041` and `0042`**, and it inherits the permission-strip rollback trap in `docs/runbooks/deploy-rollback.md`. Tasks 1-2 are free of this and can ship on their own at any time.
- **`payroll/calc.ts` counts ROWS** to build `absentCount` and `lateRows`. Nothing here may change what rows exist, only how they are displayed — with the single exception of Task 3, which changes a time and must therefore recompute the penalty.
- **Task 3 is money-critical.** Changing `clockInAt` changes how late someone was, which changes `deductAttendance`. Treat it with the same care as a payroll change.

---

## A correction to carry into Task 1

The master plan's B0 note said the table "pages by row" and warned about a day straddling a page boundary. That is not quite what the code does. `src/app/(admin)/admin/attendance/page.tsx:108-121` runs a **month-scoped query with a flat `take: 200`** — there is no page 1 / page 2.

The real consequence is worse, and it already exists:

```
9 employees x ~30 days x 1-2 rows  =  roughly 270-540 rows per month
take: 200                          =  the table already truncates a full month
```

**Admins are probably not seeing the whole month today, silently.** Grouping makes this more visible, not less: 200 rows collapse to ~100-150 day-lines and the cut lands mid-day, so the last visible day can show a check-in whose `Late` row was cut off — displaying "on time" for someone who was late. Task 1 must handle the boundary; Task 2 should not ship without it.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/attendance/day-groups.ts` | pure: flat rows → day groups | create |
| `src/lib/attendance/day-groups.test.ts` | its tests | create |
| `src/app/(admin)/admin/attendance/page.tsx` | query + render | group, fix the cap |
| `src/app/(admin)/admin/attendance/attendance-row-vm.ts` | per-row VM | unchanged; grouping wraps it |
| `src/lib/attendance/correct-time.ts` | the time-correction action | create |
| `tests/integration/correct-attendance-time.integration.test.ts` | its integration test | create |

---

## Task 1: Group rows into days

**Files:**
- Create: `src/lib/attendance/day-groups.ts`, `src/lib/attendance/day-groups.test.ts`

**Interfaces:**
- Produces: `groupByEmployeeDay<T extends GroupableRow>(rows: readonly T[]): DayGroup<T>[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { groupByEmployeeDay } from './day-groups';

const row = (employeeId: string, date: string, type: string, id = `${employeeId}-${date}-${type}`) => ({
  id,
  employeeId,
  date: new Date(`${date}T00:00:00.000Z`),
  type,
});

describe('groupByEmployeeDay', () => {
  it('puts a check-in and its late row in one group', () => {
    const g = groupByEmployeeDay([
      row('e1', '2026-08-20', 'CheckIn'),
      row('e1', '2026-08-20', 'Late'),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.rows).toHaveLength(2);
  });

  it('keeps different employees on the same date apart', () => {
    const g = groupByEmployeeDay([
      row('e1', '2026-08-20', 'CheckIn'),
      row('e2', '2026-08-20', 'CheckIn'),
    ]);
    expect(g).toHaveLength(2);
  });

  it('keeps the same employee on different dates apart', () => {
    const g = groupByEmployeeDay([
      row('e1', '2026-08-20', 'CheckIn'),
      row('e1', '2026-08-21', 'CheckIn'),
    ]);
    expect(g).toHaveLength(2);
  });

  it('preserves the incoming order of groups', () => {
    // The page orders by date desc; the grouped view must not silently re-sort.
    const g = groupByEmployeeDay([
      row('e1', '2026-08-21', 'CheckIn'),
      row('e1', '2026-08-20', 'CheckIn'),
    ]);
    expect(g[0]!.ymd).toBe('2026-08-21');
    expect(g[1]!.ymd).toBe('2026-08-20');
  });

  it('an OnLeave day with no check-in is still a group', () => {
    const g = groupByEmployeeDay([row('e1', '2026-08-20', 'OnLeave')]);
    expect(g).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/attendance/day-groups.test.ts`
Expected: FAIL — cannot resolve `./day-groups`.

- [ ] **Step 3: Implement**

```ts
/**
 * Collapse a flat attendance row list into one group per (employee, date).
 *
 * The admin table shows a check-in and its Late row as separate lines today,
 * so an admin reads the same day twice. This groups them for DISPLAY only —
 * `CheckIn` and `Late` remain separate rows in the database, because
 * `payroll/calc.ts` counts rows to build absentCount and lateRows.
 *
 * Insertion order is preserved: the page orders by date desc and the grouped
 * view must not silently re-sort into a different order than the filters imply.
 *
 * Pure and generic over the row shape so it composes with buildAttendanceRowVM
 * rather than duplicating any of it.
 */
export type GroupableRow = { employeeId: string; date: Date };

export type DayGroup<T> = {
  /** `${employeeId}|${ymd}` — stable React key. */
  key: string;
  employeeId: string;
  /** UTC date of the group, YYYY-MM-DD. */
  ymd: string;
  rows: T[];
};

export function groupByEmployeeDay<T extends GroupableRow>(
  rows: readonly T[],
): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  const index = new Map<string, DayGroup<T>>();
  for (const r of rows) {
    const ymd = r.date.toISOString().slice(0, 10);
    const key = `${r.employeeId}|${ymd}`;
    const existing = index.get(key);
    if (existing) {
      existing.rows.push(r);
    } else {
      const group: DayGroup<T> = { key, employeeId: r.employeeId, ymd, rows: [r] };
      index.set(key, group);
      out.push(group);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/attendance/day-groups.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/attendance/day-groups.ts src/lib/attendance/day-groups.test.ts
git commit -m "feat(attendance): pure employee-day grouping for the records table"
```

---

## Task 2: Render one line per day, with late status

**Files:** Modify `src/app/(admin)/admin/attendance/page.tsx`

- [ ] **Step 1: Fix the truncation boundary FIRST**

Before grouping, stop the `take: 200` cutting a day in half. Raise the cap and drop any trailing partial day:

```ts
// Rows are ordered date desc, so the LAST group in the list is the one the cap
// may have cut in half. Dropping it is better than rendering a day whose Late
// row was truncated away — that would show "on time" for someone who was late.
const RECORD_CAP = 600;   // ~9 employees x 30 days x 2 rows, one full month
```

After grouping, if the number of rows returned equals `RECORD_CAP`, discard the final group and surface a "showing the most recent N days" note. **Do not skip this step.** Silently displaying a wrong late status is worse than the honest truncation that exists today.

- [ ] **Step 2: Group and render**

Build the per-row VMs as today, then `groupByEmployeeDay(vms)`. For each group render one line:

- employee name, date
- clock-in / clock-out times from the group's `CheckIn` row
- a late badge with minutes when the group contains a `Late` row (`durationMinutes`)
- the existing status chips for `OnLeave` / `Absent` / `EarlyLeave` rows in the group

The detail modal keeps working per underlying row — a group with two rows offers both.

- [ ] **Step 3: Handle the type filter**

`baseWhere` supports `typeFilter`. Filtering to `Late` and then grouping produces day-lines containing only the `Late` row, so the check-in times render blank and the line looks broken. Either hide the times when the group has no `CheckIn`, or exempt the filtered view from grouping. Pick one and comment which and why.

- [ ] **Step 4: Verify**

```bash
npm test && npm run typecheck && npm run lint
```

Note: this page sits behind an admin login, so it cannot be verified in a browser from here. Say so when reporting — do not claim visual confirmation.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/attendance/page.tsx
git commit -m "feat(attendance): one line per employee-day with late status"
```

---

## Task 3: Admin corrects a check-in or check-out time

Nothing in the codebase updates `clockInAt` or `clockOutAt` today — `attendance/manual.ts` exports only `createManualAttendance`. This is a new write path onto money.

**Files:**
- Create: `src/lib/attendance/correct-time.ts`
- Create: `tests/integration/correct-attendance-time.integration.test.ts`
- Modify: `src/lib/audit/log.ts` (add `attendance.correct-time` to `AuditAction`), `src/lib/audit/labels.ts`

**Interfaces:**
- Produces: `correctAttendanceTime(input: { attendanceId: string; clockInAt: Date | null; clockOutAt: Date | null; reason: string }): Promise<CorrectResult>`

- [ ] **Step 1: Copy the shape, not the code**

Read `src/lib/leave/waive-deduction.ts` first. It is the closest existing analogue — an admin editing a value that payroll consumes — and its guard ORDER is deliberate:

1. **Branch scope BEFORE any state-specific error**, so an out-of-branch admin cannot learn a row's existence or its paid state from which message comes back.
2. **Refuse if already swept into a published payroll.** Frozen money is reversed by the runbook procedure, never by an edit.
3. **A reason is required.** An unexplained change to a time that moves money is exactly what an audit trail exists to prevent.

- [ ] **Step 2: Write the failing integration test**

The test DB must be up: `docker start supabase_db_koolman_hr`, wait for healthy, `npm run db:test:deploy`.

Cover, at minimum:

```
- corrects clockInAt on an unswept row and writes an audit entry carrying the OLD time
- recomputes lateness: a 09:40 check-in corrected to 09:05 (grace 15) leaves no Late row
- creates lateness: an 09:05 check-in corrected to 09:40 produces one
- refuses when the row is already swept into a published payroll
- refuses an empty reason
- refuses a row outside the actor's permitted branches, with the SAME message as "not found"
- clockOutAt before clockInAt is refused
```

- [ ] **Step 3: Implement, mutation and audit in ONE transaction**

```ts
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.attendance.updateMany({
        where: { id: input.attendanceId, deletedAt: null },
        data: { clockInAt: input.clockInAt, clockOutAt: input.clockOutAt, isOverridden: true, overrideNote: reason },
      });
      if (count === 0) throw new Error('STALE');
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'attendance.correct-time',
        entityType: 'Attendance',
        entityId: input.attendanceId,
        before: { clockInAt: row.clockInAt, clockOutAt: row.clockOutAt },
        after: { clockInAt: input.clockInAt, clockOutAt: input.clockOutAt },
        metadata: { ...(await reqMeta()), source: 'admin-ui' },
      });
      // recompute lateness HERE — see Step 4
    });
```

**The audit must be inside the transaction.** This is an in-place overwrite with no on-row record of the prior value, so the audit entry is the ONLY evidence the time was ever different. A fire-and-forget audit that fails leaves a silently altered time. This is the exact defect fixed in `backfill-leave-late.ts` — do not reintroduce it.

`entityId` must be the row's UUID. `src/lib/audit/log.ts` asserts this outside production because composite ids were silently rejected 306 times over six weeks.

- [ ] **Step 4: Recompute lateness in the same transaction**

A corrected time that leaves a stale `Late` row means the row and its penalty disagree until the next payroll draft — and if that draft never reruns, the employee is charged for lateness that no longer exists.

Derive the new lateness from the corrected `clockInAt` against the employee's schedule (or `PayrollConfig.workStartTime` + `lateGraceMinutes` when unscheduled), then create, update, or soft-delete the day's `Late` row to match. Reuse `src/lib/attendance/evaluate.ts`; do not write a second lateness rule.

Mind the partial unique index: creating a `Late` row for a day that already has one violates it. Update-or-create, never blind create.

- [ ] **Step 5: Run the integration test**

```bash
npm run test:integration -- correct-attendance-time
```

Expected: all pass.

- [ ] **Step 6: Wire the UI**

Add the correction control to the attendance detail modal — a time pair plus a required reason, matching the waiver section's layout in `src/app/(admin)/admin/leave/waive-deduction-section.tsx`.

- [ ] **Step 7: Full verification and commit**

```bash
npm test && npm run test:integration && npm run typecheck && npm run lint
git add src/lib/attendance/correct-time.ts tests/integration/correct-attendance-time.integration.test.ts src/lib/audit/ src/app/\(admin\)/admin/attendance/
git commit -m "feat(attendance): let an admin correct clock times, on the record"
```

---

## Self-review notes

- **Spec coverage.** "one record on the table" → Tasks 1-2. "show the late status" → Task 2. "admin able to correct check in and out time" → Task 3.
- **Task 1 has no dependency on Task 3** and can ship alone. Task 3 is independently valuable and could ship first if the customer cares more about correction than about the merge — ask before assuming the written order is the priority order.
- **The truncation finding is pre-existing, not introduced here.** The `take: 200` cap already hides part of a month. Task 2 Step 1 fixes it because grouping would otherwise turn a silent omission into a visibly wrong late status, but it is worth reporting to the customer separately as something they have been living with.
- **The permission question is RESOLVED, and it costs a migration.** There is no `attendance.write`. The full set is `attendance.read`, `attendance.manual-create`, `attendance.dispute-resolve`, `attendance.live-board`, `attendance.void`, `attendance.overtime.manage` (`src/lib/auth/permissions.ts:45-50`).

  `attendance.manual-create` is the closest but is semantically wrong: it authorises CREATING a hand-keyed entry, whereas correction EDITS an existing record — including LIFF check-ins the employee submitted themselves, with a selfie and GPS attached. Those are different powers and should not share a grant.

  **Add `attendance.correct-time`**, backfilled onto the `admin` role by a numbered migration mirroring `0030`/`0038`/`0040`/`0041`. Consequence: Task 3 joins the batched DDL deploy. Split the branch so Tasks 1-2 can ship independently of it.
