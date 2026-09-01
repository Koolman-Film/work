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

### Task 3: Desktop "mark paid" button (step 2 of advance approval)

**Files:**
- Create: `src/lib/advance/payment-state.ts`
- Create: `src/lib/advance/payment-state.test.ts`
- Modify: `src/app/(admin)/admin/advance/advance-row-vm.ts:117-124` (use the helper, expose the flag)
- Modify: `src/app/(admin)/admin/advance/advance-review-modal.tsx:90`, `:114-152` (`AdvanceRowVM` type, `doMarkPaid`, wiring)

**Interfaces:**
- Consumes: `markAdvancePaid({ cashAdvanceId: string; receiptKey?: string | null }): Promise<MarkPaidResult>` — `src/lib/advance/admin.ts:319`. Already permission-gated on `advance.approve` + branch scope; do not add another gate.
- Produces: `isAwaitingPayment(r: { status: string; paidAt: Date | null }): boolean`, and `AdvanceRowVM.awaitingPayment: boolean`.

`markAdvancePaid` is correct and used by LIFF; it simply has no desktop call site.
The pure decision goes in its own module because `advance-row-vm.ts` starts with
`import 'server-only'`, and **only `vitest.integration.config.ts` aliases
`server-only`** (`vitest.integration.config.ts:32`) — a unit test cannot import it.
A standalone pure helper keeps this testable in the fast unit suite, matching how
`shouldSendDigest` and `computeLatePenalty` are already split out.

- [ ] **Step 1: Write the failing test**

Create `src/lib/advance/payment-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAwaitingPayment } from './payment-state';

describe('isAwaitingPayment', () => {
  it('Approved with no paidAt is awaiting payment (รอจ่ายเงิน)', () => {
    expect(isAwaitingPayment({ status: 'Approved', paidAt: null })).toBe(true);
  });

  it('Approved and already paid is NOT awaiting payment (จ่ายเงินแล้ว)', () => {
    expect(isAwaitingPayment({ status: 'Approved', paidAt: new Date('2026-08-01') })).toBe(false);
  });

  it('a Pending row is not awaiting payment — it is awaiting approval', () => {
    expect(isAwaitingPayment({ status: 'Pending', paidAt: null })).toBe(false);
  });

  it('Rejected and Cancelled are never awaiting payment', () => {
    expect(isAwaitingPayment({ status: 'Rejected', paidAt: null })).toBe(false);
    expect(isAwaitingPayment({ status: 'Cancelled', paidAt: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/lib/advance/payment-state.test.ts`

Expected: FAIL — cannot resolve `./payment-state`.

- [ ] **Step 3: Create the helper**

Create `src/lib/advance/payment-state.ts` (no `server-only` import — that is the point):

```ts
/**
 * Is this advance approved but not yet paid?
 *
 * "Approved" is two user-facing states, per the customer's two-step payment
 * request: อนุมัติ → รอจ่ายเงิน, then จ่ายเงินแล้ว. Pure and free of
 * `server-only` so both the row VM and the unit suite can use it.
 */
export function isAwaitingPayment(r: { status: string; paidAt: Date | null }): boolean {
  return r.status === 'Approved' && r.paidAt === null;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm vitest run src/lib/advance/payment-state.test.ts` — Expected: 4 passing.

- [ ] **Step 5: Expose the flag on the row VM**

In `src/app/(admin)/admin/advance/advance-row-vm.ts`, import the helper and reuse it
for the label so the two can never disagree:

```ts
import { isAwaitingPayment } from '@/lib/advance/payment-state';
```

Replace the `paid` / `statusLabel` lines (currently `:117-121`) with:

```ts
  const awaitingPayment = isAwaitingPayment(r);
  const paid = r.status === 'Approved' && !awaitingPayment;
  const statusLabel = r.status === 'Approved' ? (paid ? 'จ่ายเงินแล้ว' : 'รอจ่ายเงิน') : info.label;
```

and add to the returned object, next to `statusLabel`:

```ts
    awaitingPayment,
```

- [ ] **Step 6: Add the field to the VM type**

In `src/app/(admin)/admin/advance/advance-review-modal.tsx`, add to `AdvanceRowVM`:

```ts
  /** Approved but not yet paid — the desktop modal offers step 2 only then. */
  awaitingPayment: boolean;
```

- [ ] **Step 7: Wire the payment action into the modal**

In the same file, import `markAdvancePaid` alongside the existing admin imports:

```ts
import { approveCashAdvance, markAdvancePaid, rejectCashAdvance } from '@/lib/advance/admin';
```

Add `doMarkPaid` directly below the existing `doApprove` (which ends at `:137`),
mirroring it — the receipt upload machinery (`receiptFile`, `compressToJpeg`,
`uploadAdvanceReceipt`, `Dropzone`) is already present in this component:

```ts
  /** Upload the slip (if any) then record payment — ReviewModal's onApprove
   *  when the row is awaiting payment. The slip is evidence, not a gate:
   *  "แนบสลิปโอนเงิน (ไม่บังคับ)". */
  async function doMarkPaid(): Promise<ActionResult> {
    if (!row) return { ok: false, message: 'ไม่พบรายการ' };
    try {
      let storageKey: string | undefined;
      if (receiptFile) {
        const supabase = createClient();
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user) return { ok: false, message: 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่' };
        const compressed = await compressToJpeg(receiptFile);
        const uploaded = await uploadAdvanceReceipt(supabase, compressed, authData.user.id, row.id);
        storageKey = uploaded.key;
      }
      const result = await markAdvancePaid({ cashAdvanceId: row.id, receiptKey: storageKey ?? null });
      return result.ok ? { ok: true } : { ok: false, message: result.message };
    } catch (err) {
      const message =
        typeof err === 'object' && err !== null && 'kind' in err
          ? uploadErrorMessage(err as { kind: string; message?: string })
          : err instanceof Error
            ? err.message
            : 'เกิดข้อผิดพลาด';
      return { ok: false, message };
    }
  }
```

Then change the three `ReviewModal` props (currently `:145-149`) so the same
primary button serves both steps, labelled for whichever step the row is at:

```tsx
      approveLabel={
        row?.awaitingPayment ? `บันทึกการจ่ายเงิน ${row.amount}` : row ? `อนุมัติ ${row.amount}` : 'อนุมัติ'
      }
      onApprove={isPending ? doApprove : row?.awaitingPayment ? doMarkPaid : undefined}
      approveDisabled={isPending ? row?.advanceGuard?.overCap : false}
```

Leave `onReject` and `moneyConfirm` gated on `isPending` as they are — rejecting is
not available after approval, and the money confirmation belongs to the approval step.

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`

Then check by hand at `/admin/advance`: a `รอจ่ายเงิน` row must show
**บันทึกการจ่ายเงิน**, and after using it must read `จ่ายเงินแล้ว`; a `รออนุมัติ` row
must still show **อนุมัติ**; a `จ่ายเงินแล้ว` row must offer neither. The bank block
(`:188-205`) already renders — confirm it is visible at the payment step, since
that is what the admin copies the transfer from.

- [ ] **Step 9: Commit**

```bash
git add src/lib/advance/payment-state.ts src/lib/advance/payment-state.test.ts \
        "src/app/(admin)/admin/advance/advance-row-vm.ts" \
        "src/app/(admin)/admin/advance/advance-review-modal.tsx"
git commit -m "feat(advance): mark-paid step in the desktop review modal"
```

---

### Task 4: Leave-type picker → chips, and hide the quota

**Files:**
- Modify: `src/app/(liff)/liff/leave/new/leave-new-form.tsx:233-250` (picker), `:378-381` (remaining line)
- Modify: `messages/{th,en,my,lo,zh-CN,km}.json` — only if the keys become unused

**Interfaces:**
- Consumes: existing `leaveTypes`, `leaveTypeId`, `setLeaveTypeId`, `selectedType` (`:79`, `:106`).
- Produces: no exported change. Purely presentational.

**Supersedes** `docs/superpowers/plans/2026-07-21-leave-type-selection-ux.md`, which
was written to *show* each type's remaining balance at pick time. The customer has
since asked for the opposite (*"ไม่ต้องแสดงโควต้า"*), confirmed 2026-09-01. That plan
should be marked superseded rather than executed.

**Do not remove the enforcement.** Hiding the number must not disable the rules
built on it: `remaining` (`:147`), `exceeds` (`:148`), `overMinutes` (`:149`) and
`blockedOverQuota` (`:204`) all stay exactly as they are, as does the over-quota
warning at `:383-386`. The customer asked not to *display a quota*; they did not ask
to stop blocking over-quota วันพักร้อน or to stop warning that leave will be
deducted. Only the numeric quota/remaining displays go.

**No TDD step here, and that is deliberate:** this repo's unit runner is
`environment: 'node'` with no DOM (`vitest.config.ts:13-14` — "Add 'happy-dom' later
if we test React components"), so a React component has nowhere to be tested.
Adding a DOM environment for one presentational change is out of scope. Verification
is typecheck + lint + a real check in LIFF, plus a grep proving the enforcement
symbols are untouched.

- [ ] **Step 1: Replace the `<select>` with a chip radiogroup**

Replace the block at `:233-250` (the `<label>` + `<select>`). Follow the visual
treatment in `src/components/ui/day-chip.tsx`; keep it inline rather than extracting
a shared component — there is one call site (YAGNI):

```tsx
        <fieldset>
          <legend className="mb-1.5 block text-sm font-medium text-ink-2">
            {t('new.leaveType')}
          </legend>
          <div role="radiogroup" aria-label={t('new.leaveType')} className="flex flex-wrap gap-2">
            {leaveTypes.map((tp) => {
              const selected = tp.id === leaveTypeId;
              return (
                <button
                  key={tp.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setLeaveTypeId(tp.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    selected
                      ? 'border-primary bg-primary text-white'
                      : 'border-line bg-surface text-ink-2'
                  }`}
                >
                  {tp.name}
                </button>
              );
            })}
          </div>
        </fieldset>
```

Note the label is now `{tp.name}` alone — the `t('new.quotaSuffix', …)` that was
appended at `:247` is gone. Keep the unpaid-type note at `:251-255` unchanged.

- [ ] **Step 2: Remove the remaining-balance line**

Delete the block at `:378-381`:

```tsx
        {remaining != null && (
          <p …>{t('new.remaining')} <strong>{fmtDuration(remaining)}</strong></p>
        )}
```

Leave the `exceeds` warning immediately below it in place.

- [ ] **Step 3: Confirm the enforcement is genuinely untouched**

Run: `grep -n "exceeds\|blockedOverQuota\|overMinutes\|remaining" "src/app/(liff)/liff/leave/new/leave-new-form.tsx"`

Expected: `remaining` still computed at `:147` and still feeding `exceeds`,
`overMinutes` and `blockedOverQuota`; the only removals are the two display sites.
If `blockedOverQuota` no longer appears in the submit guard, stop — the change went
too far.

- [ ] **Step 4: Retire the now-unused i18n keys**

Run: `grep -rn "quotaSuffix\|new\.remaining" src/`

If neither key has any remaining usage, remove `quotaSuffix` and `remaining` from
the `leave.new` block of **all six** locale files — the locale-drift test
(`2e3ea30`) fails if they diverge. If either is still used elsewhere, leave both.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`

Then in LIFF: the type picker shows chips with no numbers, selecting a chip still
switches the allowed units (`:112-119`), a วันพักร้อน request over quota is still
blocked, and a ลากิจ request over quota still shows the deduction warning.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(liff)/liff/leave/new/leave-new-form.tsx" messages/
git commit -m "feat(leave): chip picker for leave type, quota no longer displayed"
```

- [ ] **Step 7: Mark the superseded plan**

Add at the top of `docs/superpowers/plans/2026-07-21-leave-type-selection-ux.md`:

```markdown
> **SUPERSEDED 2026-09-01.** The customer asked for the opposite of this plan's
> goal — chips with no quota shown (*"ไม่ต้องแสดงโควต้า"*). Implemented as Task 4
> of `2026-09-01-canva-board-followups.md`. Do not execute this plan.
```

```bash
git add docs/superpowers/plans/2026-07-21-leave-type-selection-ux.md
git commit -m "docs(plan): mark leave-type-selection-ux superseded"
```

---

## Not in this plan, and why

**Auto-absence** (customer: *"พนักงาน ไม่มาทำงาน (ไม่ได้เช็คอิน / ไม่ลา) แต่ระบบไม่ขึ้นว่า
ขาดงาน"*). A design already exists —
`docs/superpowers/specs/2026-08-10-auto-absence-design.md` — with decisions locked
but **status "NOT yet approved — awaiting sign-off"**. It is also inert until work
schedules are assigned (nine employees still have none, per the backlog plan). It
needs sign-off and schedules before an implementation plan is worth writing, and
it changes money for everyone, so it deserves its own plan.

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

**"มาสาย เกิน 3 ครั้ง" wording — CLOSED, no action.** Decided 2026-09-01: the
existing `'มาสายครบกำหนด'` (`reconcile-rows.tsx:81`) is fine and stays. The board
item is answered; no string change.
