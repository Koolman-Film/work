# Shared Buddhist-Era Date Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared `DateField` (single) + `DateRangeField` (range calendar) that replace the ~12 native `type="date"` inputs across 8 admin files, showing Buddhist-era years for Thai / Gregorian otherwise, posting ISO `YYYY-MM-DD` so server contracts are unchanged.

**Architecture:** Pure `be-calendar` core (reuses `team-calendar-shape` grid helpers, adds min/max/today) → a shared `CalendarMonth` popover internal → the two public components → migrate 8 files.

**Tech Stack:** Next.js 16 App Router (client components), Tailwind v4, Vitest (node), Biome. No new dependency.

## Global Constraints

- **ISO value contract:** every field posts/emits `YYYY-MM-DD` (range: two ISO values). Server actions and URL params are UNCHANGED — migrations are drop-in.
- **Locale-aware display only:** trigger + header render via `formatShortDate(date, locale)` / BE year; the stored value is always locale-agnostic ISO.
- **Custom everywhere** (no native `type="date"`), touch-friendly.
- **No new dependency**; unit tests run in the existing **node** env (no jsdom) — only the pure `be-calendar` core is unit-tested; components are browser-smoked.
- **Reuse, don't duplicate:** compose `buildMonthGrid`, `ymd`, `parseMonth`, `shiftMonth`, `formatThaiMonthLabel` from `@/lib/leave/team-calendar-shape`; format display via `@/lib/i18n/format`.
- **Reduced-motion:** popover open/close uses the motion tokens (already shipped), degrading to instant under the global guard.

---

### Task 1: `be-calendar` pure core + tests

**Files:**
- Create: `src/lib/date/be-calendar.ts`
- Test: `src/lib/date/be-calendar.test.ts`

**Interfaces:**
- Consumes: `buildMonthGrid`, `ymd`, `parseMonth`, `type GridDay` from `@/lib/leave/team-calendar-shape`.
- Produces: `type ISODate`, `type DayCell`, `buildDayGrid(year, month0, opts?)`, `parseISO`, `beYear`, `clampRange`, `isDisabled`, `shiftMonth0`. Consumed by Tasks 2–4.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/date/be-calendar.test.ts
import { describe, expect, it } from 'vitest';
import { beYear, buildDayGrid, clampRange, isDisabled, parseISO, shiftMonth0 } from './be-calendar';

describe('be-calendar', () => {
  it('beYear adds 543', () => {
    expect(beYear(2026)).toBe(2569);
  });

  it('parseISO parses / rejects', () => {
    expect(parseISO('2026-07-12')).toEqual({ year: 2026, month0: 6, day: 12 });
    expect(parseISO('nope')).toBeNull();
    expect(parseISO('2026-13-01')).toBeNull();
  });

  it('shiftMonth0 wraps year at boundaries', () => {
    expect(shiftMonth0(2026, 11, 1)).toEqual({ year: 2027, month0: 0 }); // Dec -> Jan
    expect(shiftMonth0(2026, 0, -1)).toEqual({ year: 2025, month0: 11 }); // Jan -> Dec
    expect(shiftMonth0(2026, 6, 0)).toEqual({ year: 2026, month0: 6 });
  });

  it('clampRange swaps when end < start', () => {
    expect(clampRange('2026-07-10', '2026-07-01')).toEqual({ from: '2026-07-01', to: '2026-07-10' });
    expect(clampRange('2026-07-01', '2026-07-10')).toEqual({ from: '2026-07-01', to: '2026-07-10' });
  });

  it('isDisabled respects min/max (inclusive)', () => {
    expect(isDisabled('2026-07-12', '2026-07-12', undefined)).toBe(false); // == min ok
    expect(isDisabled('2026-07-11', '2026-07-12', undefined)).toBe(true);
    expect(isDisabled('2026-07-13', undefined, '2026-07-12')).toBe(true);
    expect(isDisabled('2026-07-12', undefined, undefined)).toBe(false);
  });

  it('buildDayGrid: 42 cells, marks today + disabled + inMonth', () => {
    const grid = buildDayGrid(2026, 6, { today: '2026-07-12', min: '2026-07-05', max: '2026-07-20' });
    expect(grid).toHaveLength(42);
    const jul12 = grid.find((c) => c.iso === '2026-07-12');
    expect(jul12).toMatchObject({ day: 12, inMonth: true, today: true, disabled: false });
    const jul01 = grid.find((c) => c.iso === '2026-07-01');
    expect(jul01).toMatchObject({ inMonth: true, disabled: true }); // before min
    const jun28 = grid.find((c) => c.iso === '2026-06-28'); // leading pad
    expect(jun28?.inMonth).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail** — `npx vitest run src/lib/date/` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/lib/date/be-calendar.ts
import { buildMonthGrid } from '@/lib/leave/team-calendar-shape';

export type ISODate = string; // 'YYYY-MM-DD'
export type DayCell = {
  iso: ISODate;
  day: number;
  inMonth: boolean;
  today: boolean;
  disabled: boolean;
};

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISO(s: string): { year: number; month0: number; day: number } | null {
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  const day = Number(m[3]);
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
  return { year, month0: month1 - 1, day };
}

export function beYear(gregorianYear: number): number {
  return gregorianYear + 543;
}

export function isDisabled(iso: ISODate, min?: ISODate, max?: ISODate): boolean {
  if (min && iso < min) return true;
  if (max && iso > max) return true;
  return false;
}

export function clampRange(from: ISODate, to: ISODate): { from: ISODate; to: ISODate } {
  return to < from ? { from: to, to: from } : { from, to };
}

export function shiftMonth0(year: number, month0: number, delta: number): { year: number; month0: number } {
  const total = year * 12 + month0 + delta;
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
}

/**
 * A month's 6×7 grid as DayCells. Composes team-calendar-shape's buildMonthGrid
 * (ISO-safe, Sunday-first, includes leading/trailing pad) and layers today +
 * min/max disabling. `today` is injected for deterministic tests.
 */
export function buildDayGrid(
  year: number,
  month0: number,
  opts?: { min?: ISODate; max?: ISODate; today?: ISODate },
): DayCell[] {
  return buildMonthGrid(year, month0).map((g) => ({
    iso: g.date,
    day: g.day,
    inMonth: g.inMonth,
    today: opts?.today === g.date,
    disabled: isDisabled(g.date, opts?.min, opts?.max),
  }));
}
```

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run src/lib/date/` → PASS (6 tests).
- [ ] **Step 5: tsc + lint + commit**

```bash
npx tsc --noEmit && npx biome check src/lib/date/
git add src/lib/date/
git commit -m "feat(date): be-calendar pure core (day grid, BE year, range clamp)"
```

---

### Task 2: `CalendarMonth` shared popover internal

**Files:**
- Create: `src/components/ui/calendar-month.tsx`

**Interfaces:**
- Consumes: `buildDayGrid`, `shiftMonth0`, `beYear`, `parseISO`, `type ISODate`, `type DayCell` (Task 1); `formatThaiMonthLabel` (`@/lib/leave/team-calendar-shape`) for the Thai month label, or `formatMonthYear` (`@/lib/i18n/format`) for locale-aware; `useLocale` from `next-intl`.
- Produces: `CalendarMonth` (client) — a self-contained month view + navigation.

**Spec:**
- `'use client'`. Props: `viewYear`, `viewMonth0`, `selected?: ISODate | null`, `rangeFrom?`, `rangeTo?`, `hover?: ISODate | null`, `min?`, `max?`, `today: ISODate`, `onPick(iso)`, `onHover(iso | null)?`, `onNavMonth(delta: number)`.
- Header: `‹ [monthLabel] ›`. For `th`, year is Buddhist (use `formatThaiMonthLabel(viewYear, viewMonth0)` which already renders พ.ศ.); for other locales use `formatMonthYear(\`${viewYear}-${String(viewMonth0+1).padStart(2,'0')}\`, locale)`. `‹`/`›` call `onNavMonth(-1|1)`.
- Weekday header row: for `th` the Thai abbreviations (อา จ อ พ พฤ ศ ส); for others `Intl` weekday shorts. Sunday-first (matches `buildMonthGrid`).
- Grid: `buildDayGrid(viewYear, viewMonth0, { min, max, today })`. Each cell is a `<button type="button">`:
  - dimmed when `!inMonth`; muted + `disabled` when `disabled`;
  - `today` → ring; `selected` (or an endpoint of range) → filled primary; in-range (between `rangeFrom`/`rangeTo`, or `rangeFrom`..`hover` while picking) → tinted bg.
  - `onClick={() => onPick(iso)}`, `onMouseEnter={() => onHover?.(iso)}`.
  - `role="gridcell"`, `aria-selected`, `aria-label` = localized full date.
- Keyboard: the container is `role="grid"`; arrow keys move a `focusedIso` (±1 day / ±7 week; crossing a month edge calls `onNavMonth`), PageUp/Down = `onNavMonth(∓1)`, Enter = `onPick(focusedIso)`. (Esc/open/close is owned by the field.)
- Styling: match `month-picker.tsx`'s panel (rounded, border, shadow, `bg-white`, `p-*`), and the calendar page's day-cell vocabulary.

- [ ] **Step 1: Build `CalendarMonth`** per spec. Reduced-motion inherited (no bespoke code).
- [ ] **Step 2: tsc + lint** (`npx tsc --noEmit && npx biome check src/components/ui/calendar-month.tsx`) → clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(date): CalendarMonth shared popover grid"`

---

### Task 3: `DateField` (single date)

**Files:**
- Create: `src/components/ui/date-field.tsx`

**Interfaces:**
- Consumes: `CalendarMonth` (Task 2); `formatShortDate` (`@/lib/i18n/format`); `parseISO`, `type ISODate`, `currentMonthYM`-equivalent (`@/lib/leave/team-calendar-shape` `ymd(new Date())` for today); `useLocale` (`next-intl`).
- Produces: `DateField` (client).

**Spec (mirror `month-picker.tsx`'s open/outside-click/hidden-input pattern):**
- Props per the design spec: `name?`, `defaultValue?`, `value?`, `onChange?`, `min?`, `max?`, `required?`, `disabled?`, `clearable?`, `placeholder?`, `id?`, `aria-label?`.
- Internal `value` state seeded from `value ?? defaultValue ?? null` (controlled if `value !== undefined`); `open` state; `rootRef` for outside-click close (copy the month-picker's `useEffect` outside-click + Esc).
- Trigger: an Input-styled `<button>` showing `value ? formatShortDate(new Date(value+'T00:00:00'), locale) : placeholder`. `aria-haspopup`, `aria-expanded={open}`.
- Hidden input `<input type="hidden" name={name} value={value ?? ''} />` when `name` given.
- Popover: `<CalendarMonth today={ymd(new Date())} viewYear/viewMonth0 from value||today selected={value} min max onPick={pick} onNavMonth=…/>`. `pick(iso)` → set value, close, fire `onChange?.(iso)`.
- `clearable` + value → a small "ล้าง" button that sets null + `onChange?.(null)`.
- `today` shortcut optional (skip in v1 if it complicates; keep minimal).
- Reduced-motion: popover uses the motion tokens.

- [ ] **Step 1: Build `DateField`.**
- [ ] **Step 2: tsc + lint** → clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(date): DateField single-date component"`

---

### Task 4: `DateRangeField` (range calendar)

**Files:**
- Create: `src/components/ui/date-range-field.tsx`

**Interfaces:**
- Consumes: `CalendarMonth` (Task 2); `clampRange`, `type ISODate` (Task 1); `formatShortDate`; `useLocale`.
- Produces: `DateRangeField` (client).

**Spec:**
- Props: `fromName?`, `toName?`, `defaultFrom?`, `defaultTo?`, `value?: {from,to}`, `onChange?`, `min?`, `max?`, `disabled?`.
- State: `from`, `to` (seeded from value/defaults), `open`, `picking: 'idle' | 'start'`, `hover: ISODate | null`.
- Trigger shows `from && to ? \`${fmt(from)} – ${fmt(to)}\` : placeholder`.
- Two hidden inputs (`fromName`/`toName`) when provided.
- Popover `CalendarMonth` with `rangeFrom={from}`, `rangeTo={picking==='start' ? hover : to}`, `hover`, `onHover`, `onPick`:
  - `onPick(iso)`: if `picking==='idle'` → set `from=iso`, `to=null`, `picking='start'`; else → `{from,to}=clampRange(from, iso)`, `picking='idle'`, close, `onChange?.({from,to})` + commit hidden inputs.
- `min`/`max` bound both endpoints.
- Reduced-motion inherited.

- [ ] **Step 1: Build `DateRangeField`.**
- [ ] **Step 2: tsc + lint** → clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(date): DateRangeField range calendar component"`

---

### Task 5: Migrate the single-date inputs (5 files)

**Files (Modify):**
- `src/app/(admin)/admin/employees/employee-form.tsx` (DOB)
- `src/app/(admin)/admin/employees/hired-at-field.tsx` (hiredAt)
- `src/app/(admin)/admin/settings/holidays/holiday-form.tsx` (date)
- `src/app/(admin)/admin/attendance/manual/manual-form.tsx` (date)
- `src/app/(admin)/admin/attendance/overtime/page.tsx` (date)

**Spec:**
- For each `<input type="date" name="X" defaultValue={...} .../>`, replace with `<DateField name="X" defaultValue={...} min/max as today-applicable />`, preserving the exact `name`, the default value (already `YYYY-MM-DD`), and required/optional. Keep the surrounding `FormField` label.
- These forms submit to server actions expecting `YYYY-MM-DD` — DateField's hidden input keeps that contract. Do NOT change the actions.
- `hired-at-field.tsx` and `overtime/page.tsx` may be client wrappers already — reconcile with their real structure (some may be controlled; use `value`/`onChange` mode if so).
- Read each file first; match its default-value source and whether it's form-mode or controlled.

- [ ] **Step 1: Migrate the 5 files.** `npx tsc --noEmit && npx biome check` on them → clean.
- [ ] **Step 2: Run the existing tests** touching these areas + `pnpm test` → green (proves the server contract holds).
- [ ] **Step 3: Commit** — `git commit -m "refactor(date): single-date fields → DateField (5 admin forms)"`

---

### Task 6: Migrate the range filters + leave form (3 files)

**Files (Modify):**
- `src/app/(admin)/admin/reports/period-picker.tsx` (from/to range, controlled → URL)
- `src/app/(admin)/admin/audit/audit-filters.tsx` (from/to range, controlled → URL)
- `src/app/(admin)/admin/leave/new/admin-leave-form.tsx` (start/end range + any standalone date)

**Spec:**
- **reports/period-picker + audit/audit-filters:** these build a URL via `URLSearchParams` (audit uses `router.push`). Replace the two `type="date"` inputs with a `DateRangeField` in **controlled mode** (`value={{from,to}}`, `onChange` updates the same params/state that currently drive the URL). Preserve the exact param names (`from`/`to` or whatever they use) and the "apply/ดูช่วงนี้" behavior. Keep the BE month-stepper if the page has one — OR, if the stepper and the date inputs were redundant, the plan-executor may consolidate to just the `DateRangeField` (note it in the report; do not remove server behavior).
- **leave/new/admin-leave-form:** read it first. Map start/end to a `DateRangeField` (or two `DateField`s if the form logic needs them independent), and any standalone date (e.g. a single effective date) to `DateField`. Preserve every `name`/value the leave-create action expects.
- Read each file fully; match controlled vs form mode and exact param/field names.

- [ ] **Step 1: Migrate the 3 files.** `npx tsc --noEmit && npx biome check` → clean.
- [ ] **Step 2: Run existing tests** (audit + reports have integration tests; leave has tests) + full `pnpm test` + `pnpm test:integration` → green.
- [ ] **Step 3: Commit** — `git commit -m "refactor(date): range filters + leave form → DateRangeField/DateField"`

---

## Done criteria

- `be-calendar.test.ts` green; full `pnpm test` + `pnpm test:integration` green; `npx tsc --noEmit` + `npx biome check` clean (0 warnings).
- No native `type="date"` remains in `src/app/(admin)` (grep check).
- Every migrated form/filter still posts/uses `YYYY-MM-DD` (server contracts unchanged) — verified by the existing tests staying green.
- No new dependency (`package.json` unchanged); no schema/migration/writes.
- Browser smoke (final): a single `DateField` (BE header, pick a day) and a `DateRangeField` (start→end with hover preview) + a reduced-motion pass.
