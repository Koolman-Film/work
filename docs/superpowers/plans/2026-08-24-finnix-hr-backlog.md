# Finnix HR Backlog — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all eight items in `todo_finnix_hr.txt`, in an order that stops the customer re-reporting closed work before any new code is written.

**Architecture:** Four independent workstreams, sequenced cheapest-and-most-unblocking first. C and D are fully specified below and executable today. A and B end at a **decision gate** — their implementation tasks cannot be written until the customer answers the questions in A0/B0, because those answers change the schema and the money math. Each gets its own plan document once answered.

**Tech Stack:** Next.js 16 App Router · Prisma 6 · Postgres (Supabase) · Inngest crons · LINE Messaging API · next-intl (6 locales) · Vitest · Biome

**Spec:** No separate spec file — the source requirements are `todo_finnix_hr.txt` (repo root, untracked) and the Canva board `DAHLmaiCPAg`. Verification of each item against the codebase was done 2026-08-24 and is recorded in the "Verified status" table below.

---

## Global Constraints

- **TDD.** Failing test first, watch it fail, minimal implementation, watch it pass, commit. No exceptions for "simple" changes.
- **Never `git add -A`.** The repo contains un-gitignored local files (`todo_finnix_hr.txt`, `payslip-samples/`, `user_request_1.pdf`). Stage explicit paths only.
- **Branch per workstream task**, merged with `--no-ff`. Never commit to `main` directly.
- **Push is HTTPS + gh helper** (SSH is denied):
  `git -c credential.helper='!gh auth git-credential' push https://github.com/Koolman-Film/work.git main:main`
- **Batch DDL.** Every migration in this plan must ship in ONE deploy together with the already-pending `0041`, per `docs/runbooks/deploy-rollback.md` — a rollback across a DDL boundary strips permissions added by the migration and re-deploying does not restore them.
- **After merging anything that touches `schema.prisma`, run `npx prisma generate`** or the local typecheck fails on columns that exist only in the merged schema.
- **Money math uses `decimal.js`**, never IEEE floats. Follow `src/lib/payroll/calc.ts`.
- **i18n changes touch all six locale files**: `messages/{th,en,my,lo,zh-CN,km}.json`.
- **LINE has a 300 message/month cap.** Any change that sends more messages must state its expected monthly cost. `src/lib/line/quota.ts` holds the guard.
- Verify with `npm test`, `npm run typecheck`, `npm run lint`. Integration tests need the test DB: `docker start supabase_db_koolman_hr` then `npm run db:test:deploy`.

---

## Verified status of all eight items (checked against code, 2026-08-24)

| # | Item | Status | Evidence |
|---|---|---|---|
| 2 | #17 half-morning leave shows as late | **DONE, live** | `b710840` 2026-07-24, ancestor of `origin/main` |
| 4 | Admin notification ไม่เข้า | **Works as designed** | Per-event admin pushes deliberately removed — 65% of July's 464 messages vs a 300 cap. Replaced by one 08:30 digest. See `src/lib/notifications/admin-line.ts` header |
| 4b | เพิ่มวันเกิด | **Partly done** | `birthday-reminder.ts` exists but posts an **in-app bell only** — never LINE |
| 7 | Advance net of SSO / adjustments / leave / floor | **Half done** | SSO ✓ and recurring ✓ in `advance/available.ts`. `PayrollAdjustment` ✗, leave ✗ (excluded on purpose), floor ✗ |
| 1 | Check-in + late as one row | **Open** | Partial unique index on `(employeeId, date, type)` makes them separate rows by design |
| 1b | Admin corrects check-in/out time | **Open** | `attendance/manual.ts` exports only `createManualAttendance`; nothing updates `clockInAt`/`clockOutAt` |
| 5 | เงินประจำตำแหน่ง | **Open, needs schema** | `Employee` has `baseSalary` only |
| 6 | Advance cap from salary + allowance | **Open**, depends on 5 | `calculateAdvanceBalance` uses `baseSalary` |
| 8 | Advance blackout window | **Open** | Nothing exists. `settle-window.ts` is unrelated (notification timing) |
| 3 | "18. หักเงินไปเลย" | **Unanswerable** | Deduct what, from when? |

---

# Workstream C — Notifications (items 4, 4b)

Cheapest, and it stops the loudest complaint. Fully specified.

## C0: DECIDED — a birthday alone DOES send (answered 2026-08-24)

**Question was:** should a birthday alone trigger the LINE digest on a day with nothing else
pending?

**Answer: YES.**

Cost, derived properly: a birthday fires on two consecutive days (`daysUntil` 1 then 0), so
each employee contributes 2 birthday-days per YEAR — not per month.

```
9 employees x 2 days      =  18 birthday-days/year  (~1.5/month)
x N LINE-linked admins    =  18N messages/year
only on days that would       most days already have pending work, and on those
otherwise send NOTHING        the birthday line rides along for free
```

At 3 linked admins: ~54 messages/year, under 5 a month, realistically 2-3. Against a
300/month cap that is noise. An earlier draft of this section recommended NO on the basis of
"~18 extra sends/month" — that figure was per year, wrong by a factor of twelve.

**Consequence for C3b:** `shouldSendDigest` gains a `birthdays` count and its tests assert a
birthday alone returns true.

**Revisit if C1 finds consumption still near the cap.**

- [x] **C0.1** Answered: YES.

## C1: Prove the digest is actually landing

Before telling the customer "working as designed", confirm it. If the quota guard is suppressing sends, the complaint is real and this whole workstream changes shape.

**Files:** none — this is evidence gathering.

- [ ] **Step 1: Check the LINE quota**

```bash
# .env.local holds LINE_CHANNEL_ACCESS_TOKEN (Vercel marks it sensitive).
curl -s -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" \
  https://api.line.me/v2/bot/message/quota
curl -s -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" \
  https://api.line.me/v2/bot/message/quota/consumption
```

Expected: `{"type":"limited","value":300}` and a consumption number. **If consumption is at or near 300 − `QUOTA_RESERVE`, the guard in `src/lib/line/quota.ts` is dropping messages and the customer is right.**

- [ ] **Step 2: Check the cron actually ran**

In the Inngest dashboard, confirm `admin-daily-digest` has runs on recent weekdays and that `notified > 0` on days with pending work. A run returning `{notified: 0, admins: 0}` every day means no admin is LINE-linked and holding `liff.admin` — check `linePushAdminIds()`'s predicate against the real admin rows.

- [ ] **Step 3: Record the finding** in this file under C1 before proceeding. If the digest is NOT landing, stop and re-plan — C3 would be adding a line to a message nobody receives.

## C2: Fix the stale digest time in the docs

`src/lib/notifications/admin-line.ts:11` says the digest runs at **09:30**. The cron is `TZ=Asia/Bangkok 30 8` — **08:30**. 09:30 was a rejected draft. A future reader debugging "why didn't it arrive at 09:30" would waste an hour.

**Files:** Modify `src/lib/notifications/admin-line.ts:11`

- [ ] **Step 1: Fix the comment**

```
 * with the number of admins rather than the amount of work, so linking a
 * third admin was enough to exhaust the quota. It was replaced by the 08:30
 * digest (`admin-daily-digest.ts`), which sends each admin one message
```

- [ ] **Step 2: Verify no other file repeats the wrong time**

```bash
grep -rn "09:30" src/ docs/
```

Expected: only the rejected-draft discussion inside `admin-daily-digest.ts`, which is correct as written.

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications/admin-line.ts
git commit -m "docs(notifications): the digest runs at 08:30, not 09:30"
```

## C3: Add birthdays to the admin daily digest

**Files:**
- Create: `src/lib/notifications/due-birthdays.ts`
- Create: `src/lib/notifications/due-birthdays.test.ts`
- Modify: `src/lib/inngest/functions/birthday-reminder.ts` (switch to the shared query)
- Modify: `src/lib/inngest/functions/admin-daily-digest.ts`
- Modify: `src/lib/inngest/functions/admin-daily-digest.test.ts`
- Modify: `src/lib/inngest/events.ts` (digest payload type)
- Modify: `src/lib/line/flex-templates.ts:351-374`
- Modify: `messages/{th,en,my,lo,zh-CN,km}.json`

**Interfaces:**
- Consumes: `birthdayTargets(now: Date): BirthdayTargets` from `src/lib/inngest/functions/birthday-targets.ts` (already exists, already tested)
- Produces: `dueBirthdays(t: BirthdayTargets): Promise<DueBirthday[]>` where `DueBirthday = { id: string; displayName: string; daysUntil: 0 | 1 }`. **Takes targets, not `now`** — see the replay note in C3a Step 3.
- Produces: `shouldSendDigest(c: { leave: number; advance: number; attendance: number }): boolean` — **signature unchanged**; birthdays deliberately do not affect it (decision C0)

### C3a: Extract the birthday query so two callers share it

The SQL currently lives inline in the cron. The digest needs the same rows. Extract first, prove behaviour is unchanged, then reuse — do not copy the query.

- [ ] **Step 1: Write the failing test**

`src/lib/notifications/due-birthdays.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { formatBirthdayName } from './due-birthdays';

describe('formatBirthdayName', () => {
  it('prefers the nickname when it has content', () => {
    expect(formatBirthdayName({ firstName: 'EMP-A', lastName: 'ทองดี', nickname: 'EMP-A' })).toBe('EMP-A');
  });

  it('falls back to first + last when the nickname is blank', () => {
    expect(formatBirthdayName({ firstName: 'EMP-B', lastName: 'EMP-B', nickname: '   ' })).toBe(
      'EMP-B',
    );
  });

  it('falls back when the nickname is null', () => {
    expect(formatBirthdayName({ firstName: 'พี่', lastName: 'แดง', nickname: null })).toBe('EMP-C');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/notifications/due-birthdays.test.ts`
Expected: FAIL — cannot resolve `./due-birthdays`.

- [ ] **Step 3: Create the shared module**

`src/lib/notifications/due-birthdays.ts`:

```ts
import 'server-only';

import { prisma } from '@/lib/db/prisma';
import type { BirthdayTargets } from '@/lib/inngest/functions/birthday-targets';

/** Nickname when it has content, otherwise "First Last". Pure — exported so
 *  the naming rule is tested without touching the database. */
export function formatBirthdayName(e: {
  firstName: string;
  lastName: string;
  nickname: string | null;
}): string {
  return e.nickname?.trim() ? e.nickname.trim() : `${e.firstName} ${e.lastName}`.trim();
}

export type DueBirthday = { id: string; displayName: string; daysUntil: 0 | 1 };

type DueRow = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  daysUntil: number;
};

/**
 * Employees whose birthday is today or tomorrow in the Bangkok calendar.
 *
 * Raw SQL because a birthday recurs every year: the match is on month/day,
 * which Prisma's query API cannot express. Feb-29 birthdays only fire in
 * leap years — accepted, unchanged from the original cron.
 *
 * Takes `BirthdayTargets` rather than a Date ON PURPOSE. Both callers are
 * Inngest crons, and `birthday-reminder` deliberately memoizes the targets
 * in their own `step.run('compute-targets')` so a replay crossing midnight
 * reuses the same today/tomorrow values instead of drifting and mismatching
 * its per-employee step keys. Computing `new Date()` in here would defeat
 * that. Callers own the memoization; this function stays a pure read.
 *
 * Shared by `birthday-reminder` (in-app bell) and `admin-daily-digest`
 * (LINE line item) so the two can never disagree about who has a birthday.
 */
export async function dueBirthdays(t: BirthdayTargets): Promise<DueBirthday[]> {
  const rows = await prisma.$queryRaw<DueRow[]>`
    SELECT id, "firstName", "lastName", nickname,
      CASE
        WHEN EXTRACT(MONTH FROM "dateOfBirth") = ${t.todMonth}
         AND EXTRACT(DAY   FROM "dateOfBirth") = ${t.todDay}
        THEN 0 ELSE 1
      END AS "daysUntil"
    FROM "Employee"
    WHERE "archivedAt" IS NULL
      AND status::text <> 'Archived'
      AND "dateOfBirth" IS NOT NULL
      AND (
        (EXTRACT(MONTH FROM "dateOfBirth") = ${t.todMonth} AND EXTRACT(DAY FROM "dateOfBirth") = ${t.todDay})
        OR
        (EXTRACT(MONTH FROM "dateOfBirth") = ${t.tomMonth} AND EXTRACT(DAY FROM "dateOfBirth") = ${t.tomDay})
      )`;
  return rows.map((r) => ({
    id: r.id,
    displayName: formatBirthdayName(r),
    daysUntil: Number(r.daysUntil) === 0 ? 0 : 1,
  }));
}
```

The column is `dateOfBirth` (NOT `birthDate`), and `status::text <> 'Archived'` is a
second archived-guard alongside `archivedAt IS NULL` — both are in the live query and
both must be carried across. This block is copied from
`src/lib/inngest/functions/birthday-reminder.ts` as it stands on 2026-08-24.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/notifications/due-birthdays.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Switch the existing cron to the shared query**

In `src/lib/inngest/functions/birthday-reminder.ts`, keep the existing
`step.run('compute-targets', ...)` exactly as it is, then replace the `step.run('find-due', ...)`
body with:

```ts
    const due = await step.run('find-due', () =>
      dueBirthdays({ todMonth, todDay, tomMonth, tomDay }),
    );
```

Build the bell payload from `DueBirthday` fields. `displayName` now comes from the shared
helper, so delete the local nickname-fallback expression. The `birthday` string (`MM-DD`)
passed to `notifyAdminsInApp` keeps its current format, derived from the same memoized
targets as today. Note this cron runs at **09:00** (`0 9`), separate from the digest's 08:30 —
do not consolidate them.

- [ ] **Step 6: Verify nothing changed**

Run: `npm test`
Expected: all pass, including the existing `birthday-targets.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifications/due-birthdays.ts src/lib/notifications/due-birthdays.test.ts src/lib/inngest/functions/birthday-reminder.ts
git commit -m "refactor(notifications): share the due-birthday query between cron and digest"
```

### C3b: Carry birthdays through the digest payload and template

- [ ] **Step 1: Write the failing test**

Append to `src/lib/inngest/functions/admin-daily-digest.test.ts`:

```ts
  it('a birthday alone wakes an otherwise silent day', () => {
    expect(shouldSendDigest({ leave: 0, advance: 0, attendance: 0, birthdays: 1 })).toBe(true);
  });

  it('a fully silent day still sends nothing', () => {
    expect(shouldSendDigest({ leave: 0, advance: 0, attendance: 0, birthdays: 0 })).toBe(false);
  });

  it('still sends when real work is pending and no birthday', () => {
    expect(shouldSendDigest({ leave: 1, advance: 0, attendance: 0, birthdays: 0 })).toBe(true);
  });
```

Every existing call site in this test file must gain `birthdays: 0` — that is the point of
making the field required rather than optional-with-default. An optional field would let a
future caller forget it and silently lose birthday sends.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/inngest/functions/admin-daily-digest.test.ts`
Expected: FAIL — the object literal is not assignable, `birthdays` does not exist.

Then widen the predicate:

```ts
/** Pure send/skip decision — kept separate from I/O so it's testable under
 *  Vitest's node environment without touching Prisma or Inngest.
 *
 *  `birthdays` is REQUIRED, not optional-with-default: this predicate is the
 *  only thing standing between the digest and the 300/month LINE cap, and an
 *  optional field lets a call site be missed. A missed call site here does not
 *  fail loudly — it silently stops sending birthday reminders on quiet days,
 *  which is exactly the feature this field exists to deliver. */
export function shouldSendDigest(c: {
  leave: number;
  advance: number;
  attendance: number;
  birthdays: number;
}): boolean {
  return c.leave + c.advance + c.attendance + c.birthdays > 0;
}
```

Run again. Expected: PASS.

- [ ] **Step 3: Add the birthday line to the flex template**

In `src/lib/line/flex-templates.ts`, inside `case 'admin.daily-digest'`, extend `lines`:

```ts
        payload.birthdays.length > 0
          ? t('adminDailyDigest.birthdayLine', { names: payload.birthdays.join(', ') })
          : null,
```

Add `birthdays: string[]` to the `admin.daily-digest` payload type in `src/lib/inngest/events.ts`.

- [ ] **Step 4: Add the i18n key to all six locales**

`messages/th.json` → `notifications.adminDailyDigest`:

```json
      "birthdayLine": "🎂 วันเกิด {names}"
```

Add the same key to `en.json` (`"🎂 Birthday: {names}"`), `my.json`, `lo.json`, `zh-CN.json`, `km.json`. **All six or the template throws at render time for that locale.**

- [ ] **Step 5: Wire it into the cron**

In `admin-daily-digest.ts`, fetch once outside the per-admin loop (birthdays are not branch-scoped):

```ts
    // Same memoize-then-read split as birthday-reminder: targets in their own
    // step so a replay across midnight reuses them.
    const targets = await step.run('compute-targets', () => birthdayTargets(new Date()));
    const birthdays = await step.run('due-birthdays', async () =>
      (await dueBirthdays(targets)).map((b) => b.displayName),
    );
```

and pass `birthdays` into `sendNotification(adminId, { kind: 'admin.daily-digest', ...counts, birthdays })`.

- [ ] **Step 6: Full verification**

```bash
npm test && npm run typecheck && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/inngest/functions/admin-daily-digest.ts src/lib/inngest/functions/admin-daily-digest.test.ts src/lib/inngest/events.ts src/lib/line/flex-templates.ts messages/
git commit -m "feat(notifications): show today's and tomorrow's birthdays in the admin digest"
```

---

# Workstream D — Close the stale items (items 2, 3)

No code. This is the highest-value hour in the plan: **seven** items are already shipped, and until the customer knows, they keep re-reporting and we keep re-investigating.

**Files:** Create `docs/customer/2026-08-24-status-reply.md`

- [ ] **D1: List every verified-done item with its date**

Confirmed shipped and live: SSO cap 17,500 · branch/department/accounting-group filters · birthday reminder + admin reminder + calendar · #17 half-morning leave (`b710840`, 24 Jul) · advance ฿9,200 vs payroll ฿9,700 (`e2a1a9a`, 22 Jun — the extra ฿500 was an absence, not an advance error) · EMP-B absence day-rate (`cf980d4`, 19 Jul — flat ฿500/day replaced by each employee's own day rate) · per-row +เพิ่ม/ลด modal (`e08693d`, 11 Jun).

- [ ] **D2: Explain the notification change in plain Thai**

Not "it is broken" — per-event admin pushes were removed because they consumed 65% of a 300/month LINE cap and the cost grew with every admin added. They now get one 08:30 digest instead. Include what C1 found about current quota consumption.

- [ ] **D3: Ask the four outstanding clarifications**

1. **"18. หักเงินไปเลย"** — deduct what, from whom, from which month? Too terse to act on.
2. **Camera-only selfie** — `selfie-step.tsx` falls back to `<input type=file capture=user>` when `getUserMedia` fails. That fallback IS the gallery route they want removed; removing it breaks check-in whenever camera permission is denied. Their call.
3. **เงินประจำตำแหน่ง** — does it count toward the SSO base? Toward the over-quota leave day-rate? Toward the absence day-rate? (This is the A0 gate — the answer decides the schema.)
4. **Two-step advance approval** — exactly which two states, and who may perform each?

- [ ] **D4: Ask which screen showed half-afternoon leave as a full day**

The write path is verified correct — `leave/admin.ts` stores `durationMinutes: 240` with real 13:00–17:00 clock times. The fault is downstream. Need to know: LIFF leave list, admin calendar, leave report, or payslip? Without that this cannot be reproduced.

- [ ] **D5: Commit the reply document**

```bash
git add docs/customer/2026-08-24-status-reply.md
git commit -m "docs(customer): status reply — seven shipped items, four clarifications"
```

---

# Workstream A — Advance & position allowance (items 5, 6, 7, 8)

The bulk of the real work, and the only workstream that needs a migration. **Blocked on A0.**

## A0: DECIDED (answered 2026-08-24)

- [x] **A0.1 — Is เงินประจำตำแหน่ง part of the salary base?**

**Answer: a new `Employee` column, counting toward income and the advance cap ONLY.**

Rejected: reusing `PayrollAdjustment{kind: Income, endMonth: null}`. It already pays correctly
and needs no migration, but it cannot satisfy item 6 — the advance cap is built from
`baseSalary` and an adjustment is not part of it.

Rejected: folding the allowance into `baseSalary` everywhere. Three formulas key off
`baseSalary`, and two of them are DEDUCTIONS:

| Formula | Where | Effect if allowance joined the base |
|---|---|---|
| `calcSso` | `payroll/calc.ts:357` | capped at ฿17,500 — no effect at or above it |
| `perMinuteRate` | `leave/over-quota.ts:17` | over-quota leave costs MORE per minute |
| `dailyRateFor` | `payroll/day-rate.ts:57` | every absence and late penalty costs MORE per day |

Worked example — EMP-A at ฿13,500 with a ฿3,000 allowance: SSO ฿675 → ฿825, and her day rate
฿450 → ฿550, so one absence would cost ฿100 more. **Nobody asked to be penalised harder for
holding an allowance.** So the allowance raises pay and the advance cap; `perMinuteRate` and
`dailyRateFor` keep reading `baseSalary` unchanged.

> **OPEN, and NOT an engineering decision.** Whether a regularly-paid position allowance counts
> as ค่าจ้าง for ประกันสังคม is a Thai labour-law compliance question. Implementation assumes
> **excluded from the SSO base** until the customer's accountant confirms. Ask it explicitly in
> workstream D — do not let this ship as a silent default.

- [x] **A0.2 — Should the advance cap move mid-month?**

**Answer: add `PayrollAdjustment` now. Leave is DEFERRED until the ฿27,450 is diagnosed.**

Adjustments are bounded, admin-keyed and month-scoped, and the treatment is symmetric —
`Income` raises the cap, `Deduction` lowers it.

Leave is neither. `computeLiveLeaveCharges` has **no date filter at all** and returns every
un-swept over-quota charge from all time — the same root cause behind the ฿27,450 row. Wiring
it into the cap today would give EMP-A (฿13,500 salary, ฿27,450 live leave charge) a permanently
negative available balance: she could never draw an advance again, on the back of a bug we
already know about. **Gate: open `/admin/tools/leave-backlog` first.**

- [x] **A0.3 — What is the "ขั้นต่ำเงินเหลือ" floor?**

**Answer: a fixed baht amount, global, on `PayrollConfig`.**

Implemented as a REDUCTION OF `available`, not as a new gate:

```
available = baseSalary + allowance − deductions − reserved − floor
```

`isOverCap` already backs both the LIFF request form and the admin approval guard, so
subtracting the floor enforces it on both surfaces for free and the employee sees an honest
number instead of a rejection after the fact. This is the preventive twin of the negative-net
publish guard: that one catches an empty payslip at publish, this one prevents it at request.

Default carried forward unless the customer says otherwise: **no admin override.** `isOverCap`
is currently absolute; an escape hatch needs its own permission and audit trail.

- [x] **A0.4 — What exactly does the blackout window block?**

**Answer: N days relative to `cutoffDay` — one `PayrollConfig` integer.** Blocks the N days up
to and including the cutoff. Aligned with payroll by construction and stays correct if
`cutoffDay` changes; a fixed day-of-month range would silently de-align the day someone edits
the cutoff.

Scope: **blocks requesting, not approving** — their words are ห้ามกด, and freezing the admin
side would strand in-flight requests for days.

**The guard belongs in the server action** (`src/lib/advance/actions.ts`), not only in the
form. A disabled button is presentation; a LIFF page held open across midnight, or a replayed
request, walks straight through it. Build both — the button explains, the server enforces.

## A1–A4: Implementation (gate cleared — tasks to be written next)

A0 is answered, so these can now be written in full. The file map:

| Task | Files |
|---|---|
| A1 Schema | `prisma/schema.prisma`, `prisma/migrations/0042_*/migration.sql` — **must deploy together with `0041`** |
| A2 Cap includes allowance | `src/lib/advance/balance.ts` (`AdvanceBalanceInput`, `calculateAdvanceBalance`), `src/lib/advance/available.ts` |
| A3 Net of adjustments / leave / floor | `src/lib/advance/available.ts` (add a `PayrollAdjustment` query alongside the existing recurring one), `src/lib/advance/balance.ts` |
| A4 Blackout window | `PayrollConfig` columns, guard in `src/lib/advance/actions.ts`, matching UI state on `src/app/(liff)/liff/advance/new/advance-new-form.tsx` |

**Carry into that plan:** `balance.ts` is the shared source of truth for the LIFF form AND the admin approval guard (`isOverCap`). Any change lands on both surfaces at once — that is the point of the file. A blackout or floor implemented in only one of them is a bug, not a partial rollout.

---

# Workstream B — Attendance row merge + time correction (item 1)

Last because it is independent of everything above and the "one record" half needs a decision.

## B0: DECIDED — display merge (answered 2026-08-24)

- [x] **B0.1 — Merge in display, or in storage?**

**Answer: display merge.** Group by `(employeeId, date)` in the admin table and render one
line: check-in/out times with a late badge and minutes. No schema change, no migration, no
payroll impact, reversible if the customer dislikes it.

Rejected: storage merge. `CheckIn` and `Late` are separate rows enforced by a partial unique
index on `(employeeId, date, type) WHERE deletedAt IS NULL` (migration 0014, raw SQL —
Prisma cannot express partial-unique). `payroll/calc.ts` counts **rows** to build
`absentCount` and `lateRows`, so collapsing the types breaks payroll, the three-strike engine,
`attendanceReport`'s `lateCount`/`lateMinutes`, and requires migrating every historical row —
a payroll-wide change to answer a complaint about a table.

> **Must be handled, not discovered: PAGINATION.** The table pages by ROW today. Group after
> paging and a day's two rows can straddle a page boundary — a check-in on page 1, its
> lateness on page 2, which is worse than the current behaviour. The query must page by DAY.
> Write that test first.

## B1–B2: Implementation (gate cleared — tasks to be written next)

| Task | Files |
|---|---|
| B1 Merged row + late status | `src/app/(admin)/admin/attendance/attendance-row-vm.ts`, `src/app/(admin)/admin/attendance/page.tsx` |
| B2 Admin time correction | New update path beside `src/lib/attendance/manual.ts`, audit action in `src/lib/audit/log.ts` + `labels.ts`, recompute via `src/lib/attendance/evaluate.ts` |

**B2 is money-critical and must be planned as such.** Correcting `clockInAt` changes how late the employee was, which changes `deductAttendance`. Three requirements carry over from the leave-waiver work (`src/lib/leave/waive-deduction.ts`) — copy its shape:

1. **Refuse if already swept into a published payroll.** Frozen money is reversed by the runbook procedure, not by an edit.
2. **Mutation and audit in ONE transaction.** An in-place time overwrite leaves no on-row record of the prior value — the audit entry is the only evidence it ever had a different one. `auditLogTx`, never a fire-and-forget write.
3. **Recompute lateness in the same transaction**, or the row and its penalty disagree until the next payroll draft.

---

## Recommended execution order

1. **C1** — prove the digest lands. If it does not, C and D both change shape.
2. **D** — send the customer the reply. Unblocks A0 and B0 by asking the questions inside it.
3. **C0 → C2 → C3** — the only code in this plan that needs nobody's answer.
4. **A0 answers arrive → write the A plan → implement.** Ship `0042` with `0041` in one deploy.
5. **B0 answer arrives → write the B plan → implement.**

## Self-review notes

- **Spec coverage:** all eight items appear in the status table; each is either marked done with evidence, assigned to a workstream task, or listed as a D3 clarification. Item 3 has no implementation task by design — it is unanswerable as written.
- **Deliberately not planned:** auto-absence (`docs/superpowers/specs/2026-08-10-auto-absence-design.md`) is unapproved and does nothing until work schedules are assigned; the ฿27,450 diagnosis still needs `/admin/tools/leave-backlog` opened.
- **A and B carry no implementation steps on purpose.** Writing TDD steps for them today would mean inventing the customer's policy answers, and those answers change the schema. That is a gate, not a placeholder.
