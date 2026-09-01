# Leave-Type Selection UX Implementation Plan

> ## ⛔ SUPERSEDED 2026-09-01 — DO NOT EXECUTE
>
> The customer asked for the OPPOSITE of this plan's goal: a chip picker with
> **no quota shown** — *"เปลี่ยน ประเภทการลา จาก dropdown เป็น ตัวเลือก และไม่ต้อง
> แสดงโควต้า"* (Canva board, confirmed 2026-09-01). This plan exists to *show*
> each type's remaining balance at the moment the employee picks, which is now
> explicitly unwanted.
>
> Shipped instead as Task 4 of
> `docs/superpowers/plans/2026-09-01-canva-board-followups.md` (commit `0341895`):
> chips, no quota figure, with the over-quota ENFORCEMENT deliberately left
> intact — Block still blocks, DeductPay still warns about the deduction.
>
> The part of this plan's reasoning that survives is its diagnosis: the form used
> to silently default to ลากิจ for everyone, and ~฿22,600/year of misfiled leave
> was attributed to that. The chip picker attacks it differently — every type is
> visible up front instead of hidden behind a closed dropdown. If misfiling
> continues, revisit the problem rather than reviving this plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the leave form from silently choosing ลากิจ for everyone, and show each type's remaining balance at the moment the employee picks — so the ~฿22,600/year of misfiled leave stops accruing.

**Architecture:** Display-only. Two forms change (worker LIFF + admin), one pure formatter is fixed so a negative balance stops rendering as `0 ชม.`, and one new pure module holds the label/warning logic so both forms share it. No schema migration, no writes, no change to any money or entitlement formula.

**Tech Stack:** Next.js 16 App Router, React client components, next-intl (6 locales), Vitest (**node environment — no jsdom, no testing-library; test pure functions, not rendered components**), Biome, Prisma.

## Global Constraints

- **Use the wording the app already ships.** Leave types stay `ลาป่วย / ลากิจ / ลาพักร้อน / ลาคลอด`. The balance label reuses the existing key `leave.new.remaining` ("คงเหลือปีนี้:"), which already exists in all six locales. Do not invent plain-language type names.
- **Two new i18n keys**, both added to **all six** message files (`messages/th.json`, `en.json`, `my.json`, `lo.json`, `zh-CN.json`, `km.json`): `leave.new.otherTypeAvailable` (genuinely new copy) and `leave.new.unlimited` (a verbatim copy of the existing `summary.leave.unlimited` value in the same file — the form's `useTranslations('leave')` namespace cannot reach the `summary` one, so it is duplicated rather than translated afresh).
- **No schema migration. No database writes. No change to `calc.ts`, `balance.ts`, `over-quota.ts`, or `recompute.ts`.**
- Tests run in the Vitest **node** environment. Every new test targets a pure function. Do not add jsdom or a component-testing library.
- Locales are `['th','en','my','lo','zh-CN','km']` (`src/lib/i18n/config.ts`).
- Standard leave day is configurable (`standardDayMinutes(cfg)`) — never hardcode 420 in source. Test fixtures may use 420.

## Scope note (read before Task 1)

The spec `docs/superpowers/specs/2026-07-21-leave-type-selection-ux-design.md` declares a dependency on **I-7** — the formatter that renders a negative balance as `0 ชม.`. I-7 is referenced by the handoff and by that spec but **has no section in `2026-07-21-cutoff-window-dispute-quota-design.md`** (verified: that file contains I-4, I-2, I-6 only). I-7 is therefore specified here, in Task 1, because this plan cannot ship a correct balance display without it.

Tasks 1–2 are pure logic. Tasks 3–4 are the two forms. **I-2 / I-4 / I-6 are out of scope** and stay on `fix/cutoff-window-dispute-quota` — they touch payroll-window arithmetic, which is a different risk class from this display-only change.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/leave/units.ts` (modify) | Fix `splitDaysHours` + `formatDurationParts` for negative minutes (I-7) |
| `src/lib/leave/units.test.ts` (modify) | Negative-duration cases |
| `src/lib/leave/balance-label.ts` (create) | Pure: remaining → label parts; "another type has balance" decision |
| `src/lib/leave/balance-label.test.ts` (create) | Both pure functions |
| `messages/*.json` (modify ×6) | One new key; `quotaSuffix` retired from the new form |
| `src/app/(liff)/liff/leave/new/leave-new-form.tsx` (modify) | No default type; buttons instead of `<select>`; balance per option; other-type warning |
| `src/app/(admin)/admin/leave/new/admin-leave-form.tsx` (modify) | No default type; buttons; balance after employee is chosen |
| `src/app/(admin)/admin/leave/new/actions.ts` (create) | Server action: remaining-by-type for one employee |

---

### Task 1: Negative durations render correctly (I-7)

**Why this is first:** every later task displays a balance, and a negative balance currently renders as `0 ชม.` — a wrong number in the exact spot the employee is meant to use for a decision.

Two separate defects in `src/lib/leave/units.ts`:

1. `splitDaysHours(-100, cfg)` with a 420-minute day returns `{days:-1, hours:5, mins:20}` because `Math.floor(-100/420) === -1` leaves a **positive** remainder of 320. It renders as "-1 วัน 5 ชม. 20 น." — wrong magnitude, wrong sign, positive-looking components.
2. `formatDurationParts` gates each unit on `> 0`, so an all-negative split produces an empty list and falls through to `labels.hour(0)` → **"0 ชม."**.

Fix: split on the **magnitude**, carry the sign out to the rendered string as a leading `-`. A bare minus sign needs no translation and works in all six locales.

**Files:**
- Modify: `src/lib/leave/units.ts:47-81`
- Test: `src/lib/leave/units.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `splitDaysHours(minutes, cfg)` gains a `negative: boolean` field on `DurationParts`; `formatDurationParts(parts, labels)` prefixes `-` when `parts.negative` and the magnitude is non-zero. Later tasks call these unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/leave/units.test.ts` (CFG there is a 420-minute day):

```ts
describe('negative durations (I-7)', () => {
  it('splits on magnitude and flags the sign', () => {
    expect(splitDaysHours(-100, CFG)).toEqual({ days: 0, hours: 1, mins: 40, negative: true });
    expect(splitDaysHours(-520, CFG)).toEqual({ days: 1, hours: 1, mins: 40, negative: true });
  });

  it('keeps positive and zero splits unflagged', () => {
    expect(splitDaysHours(600, CFG)).toEqual({ days: 1, hours: 3, mins: 0, negative: false });
    expect(splitDaysHours(0, CFG)).toEqual({ days: 0, hours: 0, mins: 0, negative: false });
  });

  it('renders a negative balance with a minus sign, not "0 ชม."', () => {
    expect(formatDaysHours(-100, CFG)).toBe('-1 ชม. 40 น.');
    expect(formatDaysHours(-520, CFG)).toBe('-1 วัน 1 ชม. 40 น.');
  });

  it('renders zero as "0 ชม." with no sign', () => {
    expect(formatDaysHours(0, CFG)).toBe('0 ชม.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/leave/units.test.ts`
Expected: FAIL — the split assertions fail on the missing `negative` field and wrong components; `formatDaysHours(-100, CFG)` returns `'0 ชม.'`.

- [ ] **Step 3: Implement**

In `src/lib/leave/units.ts`, replace the `DurationParts` type, `splitDaysHours`, and `formatDurationParts`:

```ts
/** Minutes split into days+hours+minutes, using the standard day as the "day"
 *  size. `negative` carries the sign: the numeric fields are always the
 *  magnitude, so callers never have to reason about floor-toward-negative. */
export type DurationParts = { days: number; hours: number; mins: number; negative: boolean };

/**
 * Split minutes into the days+hours+minutes hybrid, using the standard
 * day as the "day" size. Examples (420/day): 600 → {days:1, hours:3, mins:0}.
 *
 * Negative input splits the MAGNITUDE and sets `negative`. Splitting the raw
 * value instead would floor toward negative infinity and leave a positive
 * remainder — −100 would read as "−1 day 5 hr 20 min" rather than "−1 hr 40 min".
 * A leave balance goes negative whenever entitlement is reduced below what was
 * already spent (an attendance-penalty settlement, or a mid-year adjustment).
 *
 * @param minutes Integer count of minutes; may be negative.
 */
export function splitDaysHours(minutes: number, cfg: LeaveUnitConfig): DurationParts {
  const perDay = standardDayMinutes(cfg);
  const negative = minutes < 0;
  const abs = Math.abs(minutes);
  const days = Math.floor(abs / perDay);
  const rem = abs - days * perDay;
  const hours = Math.floor(rem / 60);
  const mins = rem - hours * 60;
  return { days, hours, mins, negative };
}
```

```ts
/** Render duration parts with caller-supplied unit labels ("1 วัน 3 ชม." /
 *  "1 day 3 hr"). A negative duration is prefixed with "-", which needs no
 *  translation and reads the same in all six locales. Zero renders unsigned. */
export function formatDurationParts(parts: DurationParts, labels: DurationUnitLabels): string {
  const out: string[] = [];
  if (parts.days > 0) out.push(labels.day(parts.days));
  if (parts.hours > 0) out.push(labels.hour(parts.hours));
  if (parts.mins > 0) out.push(labels.min(parts.mins));
  if (out.length === 0) return labels.hour(0);
  return `${parts.negative ? '-' : ''}${out.join(' ')}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/leave/units.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Check every construction site of `DurationParts` still compiles**

`DurationParts` gained a required field, so anything building one by hand is now a type error. Run:

```bash
npx tsc --noEmit
```

Expected: PASS. If `src/lib/line/flex-templates.ts` or `src/lib/leave/admin.ts` fails, it is because a `DurationParts` is constructed there literally rather than via `splitDaysHours` — fix by routing it through `splitDaysHours`, **not** by adding `negative: false` by hand (a hand-written `false` is a place the sign can be lost later).

- [ ] **Step 6: Verify the admin surfaces that clamp are unaffected**

These call sites clamp before formatting and must keep their current output — the change must not make a clamped zero render as `-0`:
- `src/app/(admin)/admin/leave/leave-row-vm.ts:140`
- `src/lib/leave/admin.ts:408`
- `src/app/(admin)/admin/reports/leave/page.tsx:97`

Run: `npx vitest run src/app/\(admin\)/admin/leave src/lib/export`
Expected: PASS with no snapshot or assertion changes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/leave/units.ts src/lib/leave/units.test.ts
git commit -m "fix: render negative leave balances instead of collapsing them to 0 ชม."
```

---

### Task 2: Pure label + warning logic

**Files:**
- Create: `src/lib/leave/balance-label.ts`
- Test: `src/lib/leave/balance-label.test.ts`

**Interfaces:**
- Consumes: `DurationParts` and `splitDaysHours` from Task 1.
- Produces:
  - `remainingParts(minutes: number | null, cfg: LeaveUnitConfig): DurationParts | null` — `null` in means unlimited, `null` out means "render the unlimited label".
  - `hasBetterAlternative(selectedTypeId: string, remainingByType: Record<string, number | null>): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/leave/balance-label.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasBetterAlternative, remainingParts } from './balance-label';
import type { LeaveUnitConfig } from './units';

const CFG: LeaveUnitConfig = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

describe('remainingParts', () => {
  it('returns null for an unlimited type so the caller shows "ไม่จำกัด"', () => {
    expect(remainingParts(null, CFG)).toBeNull();
  });

  it('splits a positive balance', () => {
    expect(remainingParts(840, CFG)).toEqual({ days: 2, hours: 0, mins: 0, negative: false });
  });

  it('reports zero as zero, not unlimited', () => {
    expect(remainingParts(0, CFG)).toEqual({ days: 0, hours: 0, mins: 0, negative: false });
  });

  it('preserves a negative balance', () => {
    expect(remainingParts(-100, CFG)).toEqual({ days: 0, hours: 1, mins: 40, negative: true });
  });
});

describe('hasBetterAlternative', () => {
  it('warns when the chosen type is exhausted but another has balance', () => {
    expect(hasBetterAlternative('personal', { personal: 0, sick: 12600 })).toBe(true);
  });

  it('warns when the chosen type is negative', () => {
    expect(hasBetterAlternative('personal', { personal: -420, sick: 12600 })).toBe(true);
  });

  it('does not warn when the chosen type still has balance', () => {
    expect(hasBetterAlternative('personal', { personal: 420, sick: 12600 })).toBe(false);
  });

  it('does not warn when nothing else has balance either — there is no advice to give', () => {
    expect(hasBetterAlternative('personal', { personal: 0, sick: 0 })).toBe(false);
  });

  it('treats an unlimited alternative as available', () => {
    expect(hasBetterAlternative('personal', { personal: 0, unpaid: null })).toBe(true);
  });

  it('does not warn when the chosen type is itself unlimited', () => {
    expect(hasBetterAlternative('unpaid', { unpaid: null, sick: 12600 })).toBe(false);
  });

  it('does not warn when no type is chosen yet', () => {
    expect(hasBetterAlternative('', { personal: 0, sick: 12600 })).toBe(false);
  });

  it('does not warn for a type absent from the map', () => {
    expect(hasBetterAlternative('ghost', { personal: 0, sick: 12600 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/leave/balance-label.test.ts`
Expected: FAIL — `Cannot find module './balance-label'`.

- [ ] **Step 3: Implement**

Create `src/lib/leave/balance-label.ts`:

```ts
/**
 * Pure helpers for showing "what's left" while an employee picks a leave type.
 *
 * Both leave forms (worker LIFF and admin-on-behalf) render the same two
 * things — a per-type remaining balance and a "another type still has
 * balance" nudge — so the decisions live here once, testable without a DOM.
 *
 * Minutes convention matches `remainingByTypeForEmployee`: a number is the
 * remaining minutes (which MAY be negative), and `null` means the type has no
 * quota at all.
 */

import { type DurationParts, type LeaveUnitConfig, splitDaysHours } from './units';

/** Remaining minutes → duration parts, or `null` for an unlimited type.
 *  Zero is a real balance and must not be confused with unlimited. */
export function remainingParts(
  minutes: number | null,
  cfg: LeaveUnitConfig,
): DurationParts | null {
  if (minutes === null) return null;
  return splitDaysHours(minutes, cfg);
}

/**
 * Should we warn that a different leave type would not cost this person money?
 *
 * True only when the chosen type is spent (≤ 0) AND some other type still has
 * balance. When nothing else is available the warning is noise — there is no
 * alternative to point at — and when the chosen type is unlimited there is
 * nothing to warn about. Advisory only: the form never blocks submission,
 * because an employee may have a real reason to use the exhausted type.
 */
export function hasBetterAlternative(
  selectedTypeId: string,
  remainingByType: Record<string, number | null>,
): boolean {
  if (!selectedTypeId || !(selectedTypeId in remainingByType)) return false;
  const selected = remainingByType[selectedTypeId];
  if (selected === null || selected > 0) return false;
  return Object.entries(remainingByType).some(
    ([id, minutes]) => id !== selectedTypeId && (minutes === null || minutes > 0),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/leave/balance-label.test.ts`
Expected: PASS, 12 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leave/balance-label.ts src/lib/leave/balance-label.test.ts
git commit -m "feat: pure helpers for per-type remaining balance and alternative-type nudge"
```

---

### Task 3: Worker LIFF form — no default, buttons, balance, nudge

**Files:**
- Modify: `src/app/(liff)/liff/leave/new/leave-new-form.tsx`
- Modify: `messages/th.json`, `messages/en.json`, `messages/my.json`, `messages/lo.json`, `messages/zh-CN.json`, `messages/km.json`

**Interfaces:**
- Consumes: `remainingParts`, `hasBetterAlternative` (Task 2); `formatDurationParts` (Task 1); existing props `remainingByType: Record<string, number | null>` and `leaveConfig` — **both are already passed to this component; no page or query change is needed.**
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the two new i18n keys to all six message files**

Both go under `leave.new`, beside the existing `remaining` key. The existing `quotaSuffix` key stays in the files (other surfaces may use it) but this form stops calling it.

`unlimited` is a straight copy of that file's own `summary.leave.unlimited` value — no new translation:

```
th "ไม่จำกัด"   en "Unlimited"   my "ကန့်သတ်မရှိ"   lo "ບໍ່ຈຳກັດ"   zh-CN "不限"   km "គ្មានកំណត់"
```

`otherTypeAvailable` is new copy:

`messages/th.json`:
```json
"otherTypeAvailable": "ประเภทการลาอื่นยังมีสิทธิเหลืออยู่ — ตรวจสอบก่อนส่ง",
```
`messages/en.json`:
```json
"otherTypeAvailable": "Another leave type still has balance — check before submitting",
```
`messages/my.json`:
```json
"otherTypeAvailable": "အခြားခွင့်အမျိုးအစားတွင် ကျန်ရှိနေသေးသည် — မတင်မီစစ်ဆေးပါ",
```
`messages/lo.json`:
```json
"otherTypeAvailable": "ປະເພດລາອື່ນຍັງມີສິດເຫຼືອຢູ່ — ກວດສອບກ່ອນສົ່ງ",
```
`messages/zh-CN.json`:
```json
"otherTypeAvailable": "其他请假类型仍有余额 — 提交前请确认",
```
`messages/km.json`:
```json
"otherTypeAvailable": "ប្រភេទឈប់សម្រាកផ្សេងទៀតនៅមានសិទ្ធិសល់ — សូមពិនិត្យមុនដាក់ស្នើ",
```

**Flag for the controller:** the four non-th/en strings are machine-assisted and need a native reviewer before this ships, exactly like every other stub in these files. Do not silently treat them as final.

- [ ] **Step 2: Remove the auto-selection**

`src/app/(liff)/liff/leave/new/leave-new-form.tsx:79` — replace:

```ts
  const [leaveTypeId, setLeaveTypeId] = useState<string>(leaveTypes[0]?.id ?? '');
```

with:

```ts
  // Deliberately empty: pre-selecting the alphabetically-first type made
  // "didn't choose" indistinguishable from "chose ลากิจ", which is how ~฿22,600
  // of leave was filed against the smallest quota in the system. `submitDisabled`
  // already requires a non-empty leaveTypeId, and the server rejects it too
  // (`bad-leave-type`), so an unset value cannot be submitted.
  const [leaveTypeId, setLeaveTypeId] = useState<string>('');
```

- [ ] **Step 3: Add the label renderer and the nudge flag**

Add the imports:

```ts
import { hasBetterAlternative, remainingParts } from '@/lib/leave/balance-label';
```

and, next to the existing `fmtDuration` helper (around line 71), add:

```ts
  // Per-type balance shown on each option button — the number that changes the
  // decision. The annual quota (the old `quotaSuffix`) is identical for every
  // employee regardless of what they've spent, so it never did.
  const fmtRemaining = (typeId: string) => {
    const parts = remainingParts(remainingByType[typeId] ?? null, leaveConfig);
    return parts === null ? t('new.unlimited') : fmtParts(parts);
  };
```

`fmtRemaining` needs a renderer that takes already-split parts, whereas the existing `fmtDuration` takes minutes. Refactor `fmtDuration` (lines 70-76) into two so the label object is written once:

```ts
  // Locale-aware "1 วัน 3 ชม." / "1 day 3 hr" renderer for charge/balance lines.
  const fmtParts = (parts: DurationParts) =>
    formatDurationParts(parts, {
      day: (n) => tUnits('day', { n }),
      hour: (n) => tUnits('hour', { n }),
      min: (n) => tUnits('min', { n }),
    });
  const fmtDuration = (minutes: number) => fmtParts(splitDaysHours(minutes, leaveConfig));
```

and add `type DurationParts,` to the existing `@/lib/leave/units` import block.

Then, after the existing `remaining`/`exceeds` block (around line 147):

```ts
  // Advisory only — never blocks. See hasBetterAlternative for why it stays
  // quiet when no other type has balance.
  const otherTypeAvailable = hasBetterAlternative(leaveTypeId, remainingByType);
```

- [ ] **Step 4: Replace the `<select>` with option buttons**

Replace the whole leave-type block (`leave-new-form.tsx:229-252`, the `<div>` containing `<label htmlFor="leaveTypeId">` through its closing `</div>`) with:

```tsx
        {/* Leave type — buttons, not a <select>. A dropdown hides every option
            the employee didn't open it to see, and <option> cannot render the
            remaining balance legibly. Both reasons point the same way. */}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-gray-700">
            {t('new.field.leaveType')} <span className="text-red-600">*</span>
          </span>
          <div className="grid grid-cols-2 gap-2">
            {leaveTypes.map((tp) => (
              <button
                key={tp.id}
                type="button"
                aria-pressed={leaveTypeId === tp.id}
                onClick={() => setLeaveTypeId(tp.id)}
                className={
                  leaveTypeId === tp.id
                    ? 'rounded-md border border-primary-600 bg-primary-50 px-3 py-2 text-left'
                    : 'rounded-md border border-gray-300 px-3 py-2 text-left'
                }
              >
                <span
                  className={
                    leaveTypeId === tp.id
                      ? 'block text-sm font-medium text-primary-700'
                      : 'block text-sm text-gray-900'
                  }
                >
                  {tp.name}
                  {tp.isPaid ? '' : ` ${t('new.unpaid')}`}
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  {t('new.remaining')} {fmtRemaining(tp.id)}
                </span>
              </button>
            ))}
          </div>
          {selectedType && !selectedType.isPaid && (
            <p className="mt-1 text-xs text-amber-700">{t('new.unpaidNote')}</p>
          )}
        </div>
```

- [ ] **Step 5: Add the nudge next to the existing over-quota warning**

Find where `exceedsDeduct` / `exceedsBlock` are rendered and add, immediately after that block:

```tsx
        {otherTypeAvailable && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t('new.otherTypeAvailable')}
          </p>
        )}
```

- [ ] **Step 6: Typecheck, lint, and run the full suite**

```bash
npx tsc --noEmit && npx biome check src messages && npx vitest run
```

Expected: PASS. Baseline is 1,424 unit + 195 integration tests; the count should only grow.

- [ ] **Step 7: Verify in the browser**

Start the dev server via the preview tooling (never `npm run dev` in a shell) and open `/liff/leave/new`. Confirm, and capture a screenshot of, each of:
- no type is selected on load, and the submit button is disabled
- every type shows a remaining balance, and each matches `/liff/summary` for the same employee
- picking an exhausted type surfaces the "another type still has balance" line
- switching the locale to at least one non-Thai language keeps every label translated

- [ ] **Step 8: Commit**

```bash
git add src/app/\(liff\)/liff/leave/new/leave-new-form.tsx messages
git commit -m "feat: leave form asks the employee to choose, and shows what each type has left"
```

---

### Task 4: Admin on-behalf form — same fix, plus it never showed a balance at all

`src/app/(admin)/admin/leave/new/admin-leave-form.tsx:52` has the identical `leaveTypes[0]` default, and this page shows **no balance anywhere** — an admin files leave for someone without seeing what that person has left. The employee is chosen inside the form, so the balance can only be fetched after that choice.

The admin UI is intentionally Thai-only and untranslated (see `formatDaysHours`'s doc comment) — use `formatDaysHours` here, not the locale-aware renderer, and Thai string literals as the surrounding file already does.

**Files:**
- Create: `src/app/(admin)/admin/leave/new/actions.ts`
- Modify: `src/app/(admin)/admin/leave/new/admin-leave-form.tsx`
- Modify: `src/app/(admin)/admin/leave/new/page.tsx` (pass `leaveConfig` to the form)

**Interfaces:**
- Consumes: `hasBetterAlternative` (Task 2), `formatDaysHours` (Task 1), `remainingByTypeForEmployee` from `@/lib/leave/balance`, `getLeaveConfig` from `@/lib/leave/leave-config`.
- Produces: nothing.

- [ ] **Step 1: Create the server action**

Create `src/app/(admin)/admin/leave/new/actions.ts`:

```ts
'use server';

/**
 * Remaining leave balance for one employee, for the admin's on-behalf form.
 *
 * The employee is picked inside the client form, so this cannot be loaded with
 * the page. Read-only: it writes nothing and returns the same shape the worker
 * form receives as a prop.
 */

import { requirePermission } from '@/lib/auth/check-permission';
import { remainingByTypeForEmployee } from '@/lib/leave/balance';

export async function leaveBalanceForEmployee(
  employeeId: string,
  year: number,
): Promise<Record<string, number | null>> {
  // Same gate as adminCreateLeaveRequest (src/lib/leave/admin.ts:709) — this
  // action exposes one employee's balance, so it must not be reachable by
  // anyone who could not already file leave on their behalf.
  await requirePermission('leave.approve');
  if (!employeeId) return {};
  return remainingByTypeForEmployee(employeeId, year);
}
```

- [ ] **Step 2: Pass the leave config into the form**

In `src/app/(admin)/admin/leave/new/page.tsx`, load `getLeaveConfig()` alongside the existing queries and pass it as a `leaveConfig` prop. Add it to the form's `Props` type.

- [ ] **Step 3: Remove the auto-selection and load the balance on employee change**

In `admin-leave-form.tsx`, replace line 52:

```ts
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? '');
```

with:

```ts
  // Empty by default — same reason as the worker form: a pre-selected type
  // makes "didn't choose" look like a choice.
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [remainingByType, setRemainingByType] = useState<Record<string, number | null>>({});
```

and add, after the existing `useEffect` that snaps the unit:

```ts
  // Load the chosen employee's balance. The response is discarded if the admin
  // has already switched to a different employee, so a slow request for a
  // previous selection can't overwrite the current one.
  useEffect(() => {
    if (!employeeId) {
      setRemainingByType({});
      return;
    }
    let current = true;
    const year = Number(today.slice(0, 4));
    leaveBalanceForEmployee(employeeId, year)
      .then((r) => {
        if (current) setRemainingByType(r);
      })
      .catch(() => {
        if (current) setRemainingByType({});
      });
    return () => {
      current = false;
    };
  }, [employeeId, today]);
```

with imports:

```ts
import { hasBetterAlternative } from '@/lib/leave/balance-label';
import { formatDaysHours } from '@/lib/leave/units';
import { leaveBalanceForEmployee } from './actions';
```

- [ ] **Step 4: Render the type as buttons with the balance**

Replace the leave-type `<select>` in this file with the same button grid as Task 3, using Thai literals and `formatDaysHours`:

```tsx
      <FormField label="ประเภทการลา" htmlFor="leaveTypeId" required>
        <div className="grid grid-cols-2 gap-2">
          {leaveTypes.map((tp) => {
            const minutes = remainingByType[tp.id] ?? null;
            return (
              <button
                key={tp.id}
                type="button"
                aria-pressed={leaveTypeId === tp.id}
                onClick={() => setLeaveTypeId(tp.id)}
                className={
                  leaveTypeId === tp.id
                    ? 'rounded-md border border-primary-600 bg-primary-50 px-3 py-2 text-left'
                    : 'rounded-md border border-gray-300 px-3 py-2 text-left'
                }
              >
                <span className="block text-sm text-gray-900">
                  {tp.name}
                  {tp.isPaid ? '' : ' (ไม่จ่ายเงิน)'}
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  {!employeeId
                    ? 'เลือกพนักงานก่อน'
                    : `คงเหลือปีนี้: ${minutes === null ? 'ไม่จำกัด' : formatDaysHours(minutes, leaveConfig)}`}
                </span>
              </button>
            );
          })}
        </div>
      </FormField>
```

Then add the nudge below the form's error line:

```tsx
      {hasBetterAlternative(leaveTypeId, remainingByType) && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ประเภทการลาอื่นยังมีสิทธิเหลืออยู่ — ตรวจสอบก่อนบันทึก
        </p>
      )}
```

- [ ] **Step 5: Block submit until a type is chosen**

In `onSubmit`, beside the existing `employeeId` guard:

```ts
    if (!leaveTypeId) {
      setError('กรุณาเลือกประเภทการลา');
      return;
    }
```

- [ ] **Step 6: Typecheck, lint, full suite**

```bash
npx tsc --noEmit && npx biome check src && npx vitest run
```
Expected: PASS.

- [ ] **Step 7: Verify in the browser**

Open `/admin/leave/new`. Confirm and screenshot:
- no type selected on load; the buttons read "เลือกพนักงานก่อน"
- picking an employee fills in that person's balances, matching `/admin/reports/leave` for the same person
- submitting with no type chosen shows "กรุณาเลือกประเภทการลา"

- [ ] **Step 8: Commit**

```bash
git add src/app/\(admin\)/admin/leave/new
git commit -m "feat: admin leave form shows the employee's balance and stops pre-picking a type"
```

---

## Verification before merge

- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check src messages` clean
- [ ] `npx vitest run` — full suite green, count ≥ baseline (1,424 unit + 195 integration)
- [ ] Submitting with no leave type is rejected **by the server**, not only by the disabled button — confirm `submitLeaveRequest` returns `bad-leave-type` for an empty id (the check already exists at `src/lib/leave/actions.ts:154-168`; verify, don't rewrite)
- [ ] Screenshots captured for both forms
- [ ] The four machine-assisted translations have been reviewed by a speaker, or the ship decision explicitly accepts them

## Out of scope — do not touch

I-2, I-4, I-6 (`fix/cutoff-window-dispute-quota`); retroactive correction of past leave requests; leave-type renaming; quota values; `overQuotaPolicy`; any money formula.
