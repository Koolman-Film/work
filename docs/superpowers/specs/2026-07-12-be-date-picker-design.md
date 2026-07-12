# Shared Buddhist-Era Date Picker — Design

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with Claude

## Summary

A shared, locale-aware date-picker family for the admin app — a single-date
**`DateField`** and a range **`DateRangeField`** — replacing the ~12 native
`type="date"` inputs across 8 admin files. Both render a **custom calendar
popover** (no native picker) that shows **Buddhist-era years for Thai** and
Gregorian for other locales, using the existing `formatDate(date, locale)`
helpers. The value posted/stored stays locale-agnostic ISO `YYYY-MM-DD`, so
every server action's contract is unchanged — the migration is drop-in.

This closes the most jarring UI inconsistency found in the admin visual audit:
native inputs render Gregorian `26/06/2026` right next to the app's custom
Buddhist-era pickers (`ก.ค. 2569`). It also directly serves the chosen
long-term direction (fully internationalize the admin) — the components are
locale-correct in *every* locale, not pinned to Thai.

## Context (what exists)

- **Custom BE month-picker precedent:** `src/components/ui/month-picker.tsx` — a
  popover with a `‹ Buddhist-year ›` header + Thai month grid, posting `YYYY-MM`
  via a hidden input. Built explicitly because native pickers show Gregorian and
  Safari desktop lacks a month picker. This is the pattern to mirror at day level.
- **Locale-aware date formatters:** `src/lib/i18n/format.ts` — `formatDate(date,
  locale)`, `formatShortDate(date, locale)`, `formatMonthYear(month, locale)`
  already render BE for `th` / Gregorian for other locales. `src/lib/format.ts`
  has `formatThaiDate`, `monthLabelTh`.
- **Calendar grid precedent:** the LIFF `CalendarGrid`
  (`src/app/(liff)/liff/calendar/calendar-grid.tsx`, reused by the admin
  calendar) renders a month grid; `src/lib/leave/team-calendar-shape.ts` has
  `buildMonthGrid(year, month0)`, `shiftMonth`, `parseMonth`, `currentMonthYM`.
  Reuse these grid primitives where they fit rather than reinventing.
- **Motion tokens:** the popover open/close reuses the motion tokens shipped in
  the admin-motion feature, degrading to instant under the reduced-motion guard.
- **The 12 native `type="date"` inputs (8 files):**
  - Single: `employees/employee-form` (DOB), `employees/hired-at-field`,
    `settings/holidays/holiday-form`, `attendance/manual/manual-form`,
    `attendance/overtime/page`.
  - Range: `reports/period-picker` (from/to), `audit/audit-filters` (from/to).
  - `leave/new/admin-leave-form` (3 inputs) — mapped exactly at plan time
    (start/end range + any standalone date).

## Decisions

1. **Two components + a shared internal.** Public `DateField` (single) and
   `DateRangeField` (range calendar) in `src/components/ui/`; a private
   `CalendarMonth` grid does the rendering both share.
2. **Custom everywhere** (desktop + mobile/touch) — matches the month-picker,
   guarantees BE display, one consistent look. Touch-friendly tap targets.
3. **Dedicated range calendar** for `DateRangeField`: click start → click end,
   span highlighted, hover-preview between the endpoints.
4. **Locale-aware display, ISO value.** Trigger + header localize via
   `formatDate`/BE-year; the hidden-input/`onChange` value is always ISO
   `YYYY-MM-DD` (range: two ISO values). No server/action changes.
5. **Two usage modes**, mirroring the month-picker: **form mode** (hidden
   input(s), name prop) and **controlled mode** (`value` + `onChange`, for
   URL-driven filters).
6. **Pure date logic extracted** to `src/lib/date/be-calendar.ts`, unit-tested
   with an injected "today"; components stay thin.

## Non-goals (explicit YAGNI)

- No time-of-day / datetime picker (dates only).
- No presets ("last 7 days") on the range picker in v1.
- No dual-month range panel (single month grid; navigate to cross months).
- No new date-formatting locale logic — reuse `@/lib/i18n/format`.
- Not touching the existing `month-picker` (month selection stays as-is) or the
  LIFF calendar.
- No jsdom/component-test dependency added — component behavior is browser-smoke
  + the pure core is unit-tested (matches the codebase's test posture).

## Architecture

### Pure core — `src/lib/date/be-calendar.ts` (unit-tested)

```ts
export type ISODate = string; // 'YYYY-MM-DD'
export type DayCell = { iso: ISODate; day: number; inMonth: boolean; disabled: boolean };

// 6×7 grid for a month, with dimmed leading/trailing days, min/max disabling,
// and today flagged by the caller-supplied `today`.
export function buildDayGrid(year: number, month0: number, opts?: {
  min?: ISODate; max?: ISODate; today?: ISODate;
}): DayCell[];

export function toISO(d: Date): ISODate;
export function parseISO(s: string): { year: number; month0: number; day: number } | null;
export function beYear(gregorianYear: number): number; // + 543
export function clampRange(from: ISODate, to: ISODate): { from: ISODate; to: ISODate }; // swap if to < from
export function isDisabled(iso: ISODate, min?: ISODate, max?: ISODate): boolean;
export function shiftMonth(year: number, month0: number, delta: number): { year: number; month0: number };
```

(Where `buildMonthGrid`/`shiftMonth`/`parseMonth` from `team-calendar-shape.ts`
already suffice, reuse them instead of duplicating; the plan pins which.)

### Shared UI — `src/components/ui/calendar-month.tsx` (client, private)

- Renders one month: `‹ [MonthYear, BE for th] ›` header, locale weekday
  headers, the 6×7 `DayCell` grid. Props: `viewYear`/`viewMonth0`,
  `selected`/`rangeFrom`/`rangeTo`/`hover`, `min`/`max`, `today`, and callbacks
  (`onPick`, `onHover`, `onNavMonth`). Today ring-highlighted; selected filled;
  in-range tinted; disabled muted. `role="grid"`, `aria-selected`,
  per-day `aria-label`.
- Keyboard: arrows (±1 day / ±7 week), PageUp/Down (±month), Enter (pick), Esc
  (close, handled by the field). Focus enters the grid on open, returns to the
  trigger on close (reuse the Dialog/month-picker focus discipline).

### Public — `src/components/ui/date-field.tsx`

```ts
type DateFieldProps = {
  // form mode
  name?: string;            // hidden input name
  defaultValue?: ISODate;
  // controlled mode
  value?: ISODate | null;
  onChange?: (iso: ISODate | null) => void;
  // shared
  min?: ISODate; max?: ISODate;
  required?: boolean; disabled?: boolean; clearable?: boolean;
  placeholder?: string; id?: string; 'aria-label'?: string;
};
```
Trigger looks like an `Input`, shows `formatDate(value, locale)` or the
placeholder; opens `CalendarMonth`; picking a day closes + commits (hidden input
or `onChange`). Optional "ล้าง" (clear) when `clearable` + value; optional
"วันนี้" (today) shortcut.

### Public — `src/components/ui/date-range-field.tsx`

```ts
type DateRangeFieldProps = {
  fromName?: string; toName?: string;       // form mode (two hidden inputs)
  defaultFrom?: ISODate; defaultTo?: ISODate;
  value?: { from: ISODate | null; to: ISODate | null }; // controlled
  onChange?: (r: { from: ISODate | null; to: ISODate | null }) => void;
  min?: ISODate; max?: ISODate; disabled?: boolean;
};
```
One trigger showing `from – to` (localized). Popover: first click sets `from`
(and provisional `to = from`); pointer move previews the hovered span; second
click sets `to` (auto-swap via `clampRange` if before `from`); a third click
starts over. `min`/`max` bound the whole range.

## Migration (8 files, drop-in)

- **`DateField`:** `employees/employee-form` (DOB), `employees/hired-at-field`,
  `settings/holidays/holiday-form`, `attendance/manual/manual-form`,
  `attendance/overtime/page`.
- **`DateRangeField`:** `reports/period-picker`, `audit/audit-filters`.
- **`leave/new/admin-leave-form`:** map at plan time — start/end as a
  `DateRangeField`, plus any standalone date as a `DateField`.
- Each swap preserves the exact `name`/value contract (server still receives
  `YYYY-MM-DD`); filters keep their controlled `onChange` → URL behavior.

## Error / empty / edge states

- Empty/optional value → placeholder; `clearable` shows a clear affordance.
- `min`/`max` disable out-of-range days and clamp typed/paste (no free text in
  v1 — selection only).
- Range with `to < from` → auto-swap on commit.
- Invalid stored value → treated as empty (placeholder), never crash.
- Reduced-motion → popover appears/closes instantly (global guard).

## Testing

- **Unit (`be-calendar.test.ts`, thorough):** `buildDayGrid` (leading/trailing
  days across month boundaries incl. a 6-row month, BE year, min/max disabling,
  today flag with a fixed date), `parseISO`/`toISO` round-trip, `clampRange`
  swap, `isDisabled` boundaries, `shiftMonth` year-wrap (Dec→Jan).
- **Migration safety:** each swapped file — tsc + lint + the existing tests
  green (reports/audit have integration tests; forms have unit tests), proving
  the server contract is unchanged (still `YYYY-MM-DD`).
- **Browser smoke:** open a `DateField`, pick a day (BE header), verify the
  posted value; a `DateRangeField` start→end select with hover-preview; a
  reduced-motion pass. (Component behavior isn't unit-tested — no jsdom; matches
  the codebase posture.)

## Files

**New**
- `src/lib/date/be-calendar.ts` (+ `be-calendar.test.ts`).
- `src/components/ui/calendar-month.tsx` — shared grid popover internal.
- `src/components/ui/date-field.tsx` — single-date field.
- `src/components/ui/date-range-field.tsx` — range field.

**Modified (migration)**
- `src/app/(admin)/admin/reports/period-picker.tsx`
- `src/app/(admin)/admin/audit/audit-filters.tsx`
- `src/app/(admin)/admin/employees/employee-form.tsx`
- `src/app/(admin)/admin/employees/hired-at-field.tsx`
- `src/app/(admin)/admin/settings/holidays/holiday-form.tsx`
- `src/app/(admin)/admin/attendance/manual/manual-form.tsx`
- `src/app/(admin)/admin/attendance/overtime/page.tsx`
- `src/app/(admin)/admin/leave/new/admin-leave-form.tsx`

## Sequencing (one plan, two phases)

1. **Build phase:** `be-calendar` core (+ tests) → `CalendarMonth` → `DateField`
   → `DateRangeField`.
2. **Migrate phase:** swap the 8 files (single-date files, then the two range
   filters, then `leave/new`), each verified against its existing tests.

## Phase 2 (deferred, no rework implied)

- Range presets ("7 วันล่าสุด", "เดือนนี้") on `DateRangeField`.
- Optional free-text typed entry with parse.
- Converge the existing `month-picker` onto the same `CalendarMonth` internal.
