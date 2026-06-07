# Admin dashboard work calendar (ปฏิทินงาน)

**Date:** 2026-06-08
**Status:** Design — approved, pending spec review
**Author:** brainstormed with Vivatchai Kaveeta

## Summary

Add a month work-calendar card (**ปฏิทินงาน**) to the bottom of the admin
dashboard (`/admin`, the "หน้าหลัก" nav item), reusing the same calendar grid
that employees see on `/liff/calendar` (the "พนักงาน" side). The card shows who
is on leave plus public holidays, defaults to all branches with a branch
selector to filter, and supports month navigation (prev / next / today) and the
tap-a-day detail panel — full parity with the employee calendar.

## Goals

- Surface the team-leave month view on the admin home page, below the existing
  pending-requests / on-leave-today panels.
- Reuse the existing `CalendarGrid` client component verbatim so the dashboard
  calendar looks and behaves exactly like the employee one.
- Show org-wide data (all branches) by default — matching the dashboard's
  "ภาพรวมทุกสาขา" framing — with an optional single-branch filter.
- Preserve the dashboard's documented `revalidate = 30` ISR caching.

## Non-goals

- No change to the employee-facing `/liff/calendar` page or its behavior.
- No new work-schedule / shift data — "ปฏิทินงาน" reuses the existing leave +
  holiday data set (the only calendar data the app has today).
- No write actions from the dashboard calendar (read-only, like the employee
  view).

## Key decisions

1. **Transport: Server Action** (not a `?ym=` URL param, not a route handler).
   The dashboard page must not read `searchParams` or it becomes dynamic and
   loses `revalidate = 30`. The calendar is therefore a client "island" that
   calls a `'use server'` action for each month/branch change. This matches the
   repo convention (every settings CRUD uses `'use server'` actions gated by
   `requirePermission`).
2. **Data scope: all branches by default + branch selector.** New all-branches
   data loader; the selector filters to a single branch on demand.
3. **Detail panel included.** Reuse `CalendarGrid` as-is, which already renders
   the tap-a-day detail panel.
4. **Title "ปฏิทินงาน" + clarifying subtitle.** The grid shows leave + holidays,
   so the card carries a subtitle: `วันลาและวันหยุด — ทุกสาขา`, swapping the
   tail to the branch name when filtered (`… — สาขาสีลม`).
5. **Refactor `getTeamCalendarData` to share logic.** Extract the leave→entry
   mapping + holiday query into a private helper reused by both the existing
   team loader and the new org loader. Public signature of
   `getTeamCalendarData` is unchanged; only the internals move.

## Architecture

### Data flow

```
/admin (Server Component, revalidate=30)
  └─ Promise.all([... existing KPIs ..., branches, getOrgCalendarData(currentMonth, all)])
       └─ <AdminCalendarCard branches initialYm initialData />   (client island)
            ├─ buildMonthGrid(ym)                 (pure, client-safe)
            ├─ <CalendarGrid key={ym} grid entries holidays />   (REUSED as-is)
            └─ on prev/next/today/branch-change:
                 startTransition → loadAdminCalendar({ ym, branchId })  ('use server')
                      └─ requirePermission('dashboard.read')
                      └─ getOrgCalendarData({ monthStart, monthEnd, branchId })
                           └─ loadEntriesAndHolidays(...)         (shared private helper)
```

### Units

#### 1. `src/lib/leave/team-calendar.ts` (edit)

Extract a private helper and add the org loader:

```ts
// Private — shared by both public loaders.
async function loadEntriesAndHolidays(args: {
  employees: { id: string; firstName: string; lastName: string; nickname: string | null }[];
  monthStart: Date;
  monthEnd: Date;
  viewerEmployeeId: string | null;   // null on admin → every entry isMine=false
}): Promise<TeamCalendarData>
```

- Loads `LeaveRequest`s (status in `Pending`/`Approved`, range-overlapping the
  month) for the given employee IDs, maps to `TeamCalendarEntry[]`, and loads
  holidays for the month.
- **Always loads holidays**, even when `employees` is empty (fixes the current
  early-return that drops holidays for an empty team/branch).
- `isMine = viewerEmployeeId !== null && entry.employeeId === viewerEmployeeId`.

```ts
// NEW — all branches (branchId omitted/null) or one branch (branchId set).
export async function getOrgCalendarData(args: {
  monthStart: Date; monthEnd: Date; branchId?: string | null;
}): Promise<TeamCalendarData>
```

- Resolves the employee set:
  - no `branchId` → `archivedAt: null, status: { not: 'Archived' }` (all active).
  - `branchId` set → above **and** `OR: [{ branchId }, { assignedBranchIds: { hasSome: [branchId] } }]`
    (who actually works at that branch — same semantics as the team loader).
- Calls `loadEntriesAndHolidays({ employees, monthStart, monthEnd, viewerEmployeeId: null })`.

`getTeamCalendarData` keeps its exact public signature; it resolves teammates
(branch-intersection to the viewer) then delegates to `loadEntriesAndHolidays`
with `viewerEmployeeId` set.

#### 2. `src/lib/leave/team-calendar-shape.ts` (edit)

Add one pure, client-safe, unit-tested helper:

```ts
/** "มิถุนายน 2569" — Thai month name + Buddhist year. */
export function formatThaiMonthLabel(year: number, month0: number): string
```

#### 3. `src/app/(admin)/admin/_calendar/actions.ts` (new)

```ts
'use server';
export async function loadAdminCalendar(input: { ym: string; branchId: string | null }):
  Promise<TeamCalendarData> {
  await requirePermission('dashboard.read');
  const parsed = parseMonth(input.ym) ?? parseMonth(currentMonthYM())!;
  return getOrgCalendarData({
    monthStart: parsed.start, monthEnd: parsed.end, branchId: input.branchId,
  });
}
```

Returns plain serializable `TeamCalendarData`. Gated by the same permission as
the page.

#### 4. `src/app/(admin)/admin/_calendar/admin-calendar-card.tsx` (new, `'use client'`)

- **Props:** `branches: { id: string; name: string }[]`, `initialYm: string`,
  `initialData: TeamCalendarData`.
- **State:** `ym`, `branchId` (`''` = all), `data`, `isPending` (`useTransition`).
- Derives `grid = buildMonthGrid(year, month0)` and the header label via
  `formatThaiMonthLabel`, both from `ym` (client-safe).
- Handlers `goPrev` / `goNext` / `goToday` / `onBranchChange`: update
  `ym`/`branchId` immediately (grid + label repaint at once), then
  `startTransition(async () => setData(await loadAdminCalendar({ ym, branchId: branchId || null })))`.
  Grid gets `aria-busy` + reduced opacity while `isPending`.
- **Render** inside the Sapphire `Card`:
  - `CardHeader`: title **ปฏิทินงาน** + subtitle (`วันลาและวันหยุด — ทุกสาขา`
    / `… — <branch name>`), branch `<select>` (styled like
    `employee-filters.tsx` `FilterSelect`, first option `สาขาทั้งหมด`), month
    navigator `‹ <label> ›`, and a `วันนี้` button (shown when not on the
    current month).
  - `CardBody`: `<CalendarGrid key={ym} grid={grid} entries={data.entries} holidays={data.holidays} />`.
    `key={ym}` forces a remount on month change so `CalendarGrid`'s internal
    `selected` day resets to today/first-of-month. Branch changes keep the same
    `key`, so the selected day persists and only the detail panel refreshes
    (its `entriesByDate` is a `useMemo` over the new `entries`).

#### 5. `src/app/(admin)/admin/page.tsx` (edit)

- Add to the existing `Promise.all`:
  - `branches` — `prisma.branch.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' }, select: { id, name } })`.
  - `initialCalendar` — `getOrgCalendarData` for the current Bangkok month
    (`parseMonth(currentMonthYM())`), all branches.
- Render `<AdminCalendarCard branches={branches} initialYm={currentMonthYM()} initialData={initialCalendar} />`
  as a new full-width section below the two-column panels.
- Keep `export const revalidate = 30`. The page reads no `searchParams`, so ISR
  is preserved; only the island's action path is dynamic.

## Error handling

- **Action authorization:** `loadAdminCalendar` calls
  `requirePermission('dashboard.read')`, which `notFound()`s unauthorized
  callers (same opaque-rejection pattern as the page and the CRUD actions).
- **Bad `ym`:** the action falls back to the current month
  (`parseMonth(input.ym) ?? parseMonth(currentMonthYM())`), never throws on a
  malformed string — mirrors the LIFF page's defensive parse.
- **Empty branch / no leave:** `loadEntriesAndHolidays` still returns holidays;
  `CalendarGrid` already renders the "ไม่มีคนลาวันนี้" empty state in the detail
  panel.
- **Action in flight:** `useTransition` keeps the previous month visible
  (dimmed) until new data arrives — no flash of empty grid.

## Testing

- **Unit:** `formatThaiMonthLabel` — month names + Buddhist-year offset across a
  few months and a year boundary (added to the existing `team-calendar.test.ts`
  / `-shape` suite).
- **Existing tests:** unchanged and still green — they cover only the pure
  `-shape` helpers, so the `getTeamCalendarData` internal extraction can't
  regress them.
- **Manual:** load `/admin` → "ปฏิทินงาน" card renders for the current month,
  all branches; prev/next swaps the month label and bars; `วันนี้` returns;
  branch selector filters; tapping a day updates the detail panel. Load
  `/liff/calendar` to confirm the employee calendar is unaffected.
- **Optional e2e (Playwright):** assert `/admin` shows the card heading and that
  prev/next changes the visible month label — consistent with the existing
  admin specs.

## File summary

- **New:** `_calendar/actions.ts`, `_calendar/admin-calendar-card.tsx`.
- **Edit:** `lib/leave/team-calendar.ts`, `lib/leave/team-calendar-shape.ts`,
  `admin/page.tsx`, `lib/leave/team-calendar.test.ts`.
- **Reused as-is:** `calendar-grid.tsx` (`CalendarGrid`).
- **Untouched:** `/liff/calendar` page.
