# Canva Board Follow-ups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the one live money bug on the customer's Canva board (a late-penalty
deduction taken for a day the employee was on approved leave), and remediate the
฿400 already withheld from a published payslip.

**Architecture:** The fix is four lines in a pure function. `computeLatePenalty`
already exempts *severe* lates on leave days from their penalty but counts
*ordinary* lates unconditionally — and ordinary lates are what drive the
three-strike rule. The fix mirrors the existing `severeNoLeave` pattern exactly,
so the shape of the function does not change.

**Tech Stack:** TypeScript, Vitest, Prisma/Postgres, decimal.js for money.

**Spec:** The customer's Canva whiteboard "ระบบ HR koolman"
(https://canva.link/8qgpthor6bwkia5), item: *"ตัวอย่างการมาสาย — เดือน ส.ค. ชื่อ ฟ้า
มาสาย 2 ครั้ง แต่ระบบนับเป็น 3 ครั้ง เลยหักเงินออก 1 วัน. สายจริง วันที่ 15 ส.ค. / 25 ส.ค.
สาย แต่ มีการลา 1 ชม. วันที่ 20 ส.ค. (ต้องไม่นับเป็นสาย)"*

## Global Constraints

Inherited verbatim from `docs/superpowers/plans/2026-08-24-finnix-hr-backlog.md`:

- **TDD.** Failing test first, watch it fail, minimal implementation, watch it pass, commit. No exceptions for "simple" changes.
- **Never `git add -A`.** The repo contains un-gitignored local files (`todo_finnix_hr.txt`, `payslip-samples/`, `user_request_1.pdf`). Stage explicit paths only.
- **Branch per task**, merged with `--no-ff`. Never commit to `main` directly.
- **Money math uses `decimal.js`**, never IEEE floats. Follow `src/lib/payroll/calc.ts`.
- **i18n changes touch all six locale files**: `messages/{th,en,my,lo,zh-CN,km}.json`.
- Verify with `pnpm test`, `pnpm typecheck`, `pnpm lint`. Integration tests need the
  test DB up: `pnpm db:test:deploy` then `pnpm test:integration`.
- **A migration must never change computed money** (established 2026-08-31). No DDL
  in this plan.

---

## Evidence this bug is live

Queried production 2026-09-01:

| Fact | Value |
|---|---|
| ญาณิกา (ฟ้า) `Late` rows, Aug 2026 | **2026-08-15, 2026-08-20, 2026-08-25** |
| Leave on 2026-08-20 | `Hourly` **09:00–10:00**, `Approved`, not deleted |
| Shift start (`PayrollConfig.workStartTime`) | `09:00` |
| Aug payroll | **Published** 2026-08-31 03:28, `deductAttendance` **฿400**, net ฿10,800 on ฿12,000 base |

Three tier-1 lates ÷ `lateThreeStrikeCount` 3 = 1 strike day. Her day-rate is
฿12,000 ÷ 30 = ฿400. So ฿400 was deducted on the strength of a late that occurred
on a day she had approved leave covering the shift start.

Root cause, `src/lib/payroll/calc.ts:322-337`: `leaveDates` is consulted only in
the `isSevere` branch. The `else` branch increments `tier1` unconditionally, and
`threeStrikeDays = Math.floor(tier1 / cfg.threeStrikeCount)`.

---

### Task 1: Ordinary lates on a leave day must not count toward the three-strike

**Files:**
- Modify: `src/lib/payroll/calc.ts:316-341` (`computeLatePenalty`)
- Test: `src/lib/payroll/calc.test.ts` (append to the existing
  `describe('computeLatePenalty (C9)')` block, which starts at line 352)

**Interfaces:**
- Consumes: existing `LatePolicyConfig`, and the test helpers `late(date, minutes)`,
  `noLeave`, and `ON` already defined in that describe block.
- Produces: no signature change. `LatePenaltyResult.tier1Count` keeps its current
  meaning (every ordinary late, for display); only `threeStrikeDays` changes.

- [ ] **Step 1: Write the failing test**

Append inside `describe('computeLatePenalty (C9)', ...)` in `src/lib/payroll/calc.test.ts`:

```ts
  // ฟ้า, August 2026 (customer Canva board). Late on the 15th, 20th and 25th,
  // but the 20th had an approved 09:00–10:00 leave. Two real lates, so no
  // strike — the system charged her ฿400 for a third that should not count.
  it('does NOT count an ordinary late on a leave day toward the three-strike', () => {
    const lates = [late('2026-08-15', 10), late('2026-08-20', 10), late('2026-08-25', 10)];
    const r = computeLatePenalty(lates, new Set(['2026-08-20']), ON);
    expect(r.threeStrikeDays).toBe(0);
    // tier1Count still reports every ordinary late — the slip shows what happened,
    // the penalty reflects what is chargeable.
    expect(r.tier1Count).toBe(3);
  });

  it('still strikes when three ordinary lates fall on days with no leave', () => {
    const lates = [late('2026-08-15', 10), late('2026-08-20', 10), late('2026-08-25', 10)];
    expect(computeLatePenalty(lates, noLeave, ON).threeStrikeDays).toBe(1);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/lib/payroll/calc.test.ts -t "leave day toward the three-strike"`

Expected: FAIL — `expected 1 to be 0`.

- [ ] **Step 3: Make the minimal change**

In `src/lib/payroll/calc.ts`, inside `computeLatePenalty`, mirror the existing
`severe` / `severeNoLeave` pair for tier 1:

```ts
  let tier1 = 0;
  let tier1NoLeave = 0;
  let severe = 0;
  let severeNoLeave = 0;
  for (const l of lates) {
    const isSevere = cfg.severeEnabled && l.minutesLate > cfg.severeThresholdMin;
    if (isSevere) {
      severe++;
      if (!leaveDates.has(l.date)) severeNoLeave++;
    } else {
      tier1++;
      // A late on a day with approved leave is not chargeable: the leave
      // deduction already covers that day. Mirrors severeNoLeave above.
      if (!leaveDates.has(l.date)) tier1NoLeave++;
    }
  }
  const threeStrikeDays =
    cfg.threeStrikeEnabled && cfg.threeStrikeCount > 0
      ? Math.floor(tier1NoLeave / cfg.threeStrikeCount)
      : 0;
```

Leave the `return` block unchanged — `tier1Count: tier1` still reports every
ordinary late.

Also update the function's doc comment (line ~313) so it stops saying leave
exempts only severe lates:

```
 * employee's Late rows ({date, minutesLate}); `leaveDates` is the set of period
 * dates with an approved leave (any unit). A late on one of those dates is not
 * chargeable — it counts toward neither the severe penalty nor the N-lates
 * three-strike, because the leave deduction already covers that day.
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm vitest run src/lib/payroll/calc.test.ts`

Expected: PASS, including every pre-existing case in that describe block.

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm test`

Expected: clean, all unit tests pass. The prose at
`src/lib/leave/admin.ts:287-288` currently claims "`leaveDates` never exempts an
Absent or a LateThreeStrike" — that sentence is now wrong. Fix it in the same
commit:

```
  // `leaveDates` never exempts an Absent. It DOES exempt a late (ordinary or
  // severe) that falls on a leave day — see computeLatePenalty.
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/payroll/calc.ts src/lib/payroll/calc.test.ts src/lib/leave/admin.ts
git commit -m "fix(payroll): a late on a leave day no longer counts toward the three-strike"
```

---

### Task 2: Repay ญาณิกา (ฟ้า) the ฿400 taken in August

**Files:** none — this is a data action taken through the admin UI, recorded by
the app's own audit log. No script.

**Interfaces:**
- Consumes: Task 1 merged and deployed, so the September draft recomputes correctly.
- Produces: nothing code depends on.

August is **Published** and the payslip was issued, so the month must not be
recomputed — `runPayrollDraft` only touches Draft rows by design, and rewriting an
issued slip breaks the "published payroll is immutable" invariant the whole
feature rests on.

- [ ] **Step 1: Confirm the amount is still ฿400 and August is still Published**

```sql
select e.nickname, p.month, p.status, p."deductAttendance", p."netPay"
from "Payroll" p join "Employee" e on e.id = p."employeeId"
where e.nickname = 'ฟ้า' and p.month = '2026-08';
```

Expected: `Published`, `deductAttendance` 400.00. If it is no longer Published or
the amount differs, stop and re-check before crediting anything.

- [ ] **Step 2: Add the correction as a September income adjustment**

In `/admin/payroll` → September → ญาณิกา's row → **เพิ่ม/ลด** → add an **Income**
adjustment:

- amount: **400.00**
- reason: `คืนเงินหักมาสาย ส.ค. (ลา 20 ส.ค.)`

This routes through `createRowAdjustment`, which audit-logs the change and
recalculates the draft — so the correction is attributable, unlike a direct
database edit.

- [ ] **Step 3: Verify the September draft absorbed it**

```sql
select e.nickname, p.month, p.status, p."incomeOther", p."netPay"
from "Payroll" p join "Employee" e on e.id = p."employeeId"
where e.nickname = 'ฟ้า' and p.month = '2026-09';
```

Expected: `incomeOther` 400.00, `netPay` up by 400.00.

- [ ] **Step 4: Check nobody else was hit by the same bug**

```sql
-- Employees with a Late on a day they also had approved, non-deleted leave,
-- in any month whose payroll is already Published.
select e.nickname, a.date::text, p.month, p.status::text, p."deductAttendance"
from "Attendance" a
join "Employee" e on e.id = a."employeeId"
join "LeaveRequest" lr on lr."employeeId" = a."employeeId"
     and lr.status = 'Approved' and lr."deletedAt" is null
     and a.date between lr."startDate" and lr."endDate"
left join "Payroll" p on p."employeeId" = a."employeeId"
     and p.month = to_char(a.date, 'YYYY-MM')
where a.type = 'Late'
order by a.date;
```

Every row is a candidate. A candidate only cost money if that employee's
chargeable lates that month reached `lateThreeStrikeCount` (3) *because of* it —
check each against `deductAttendance` before crediting. Credit each confirmed case
the same way as Step 2.

- [ ] **Step 5: Record the outcome**

Append the list of employees credited, with amounts and months, to
`docs/private/` (gitignored — it names real employees and their pay).

---

## Not in this plan, and why

**Auto-absence** (customer: *"พนักงาน ไม่มาทำงาน (ไม่ได้เช็คอิน / ไม่ลา) แต่ระบบไม่ขึ้นว่า
ขาดงาน"*). A design already exists —
`docs/superpowers/specs/2026-08-10-auto-absence-design.md` — with decisions locked
but **status "NOT yet approved — awaiting sign-off"**. It is also inert until work
schedules are assigned (nine employees still have none, per the backlog plan). It
needs sign-off and schedules before an implementation plan is worth writing, and
it changes money for everyone, so it deserves its own plan.

**Leave-type picker → chips, hide quota** (customer: *"เปลี่ยน ประเภทการลา จาก
dropdown เป็น ตัวเลือก และไม่ต้องแสดงโควต้า"*). This **contradicts an existing
unexecuted plan**: `docs/superpowers/plans/2026-07-21-leave-type-selection-ux.md`
(34 unchecked steps) exists specifically to *show each type's remaining balance at
the moment the employee picks*, justified by ~฿22,600/year of misfiled leave. The
customer has now asked for the opposite. Confirm which they want before either
plan proceeds — building both wastes the work.

**Desktop "mark paid" button.** `markAdvancePaid` exists and is correct
(`src/lib/advance/admin.ts:319`) but has no call site in the desktop `(admin)` app;
only LIFF (`liff/admin/advance/[id]/advance-review-actions.tsx:132,193`) can
perform step 2. Small and well-understood, but it needs the desktop modal and its
server actions read first to specify real code rather than a sketch.

**เงินเพิ่ม/เงินลด reason catalog.** Today the reason is free text with a combobox
over hardcoded `PRESET_REASONS` plus previously-used values
(`adjustment-form.tsx:13-26`, `_reason-options.ts`). A true admin-managed catalog
needs a new model and a CRUD screen — a design decision (who may edit, are presets
per-kind, what happens to historical rows using a deleted option) that should be
answered before planning.

**Leave balance in hours.** Balances are stored in minutes and rendered as a
days+hours hybrid ("1 วัน 3 ชม.", `units.ts:73-100`). The request is a pure-hours
view; a day/hour toggle already exists but only for entitlement *adjustments*
(`adjustment-input.tsx:36-80`). Needs a decision on which surfaces get the toggle.

**Selfie gallery blocking — CLOSED, no action.** Decided 2026-09-01: keep current
behaviour. Forcing `Disputed` on fallback captures was removed on 2026-07-21 after
a **16% false-dispute rate** (`src/lib/attendance/selfie-provenance.ts:5-32`).
Provenance is still recorded to the audit log. Re-tightening would trade false
accusations against staff for stricter provenance, and the measured data argues
against it.

**"มาสาย เกิน 3 ครั้ง" wording.** One string, `reconcile-rows.tsx:81`
(`LateThreeStrike: 'มาสายครบกำหนด'`). Worth folding into whichever UI task ships
next rather than a branch of its own — but confirm the exact replacement wording
with the customer first, since the complaint was that staff find the current term
alarming.
