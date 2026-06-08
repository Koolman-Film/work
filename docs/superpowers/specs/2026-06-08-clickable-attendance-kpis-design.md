# Clickable attendance KPIs → filtered live board

**Date:** 2026-06-08
**Status:** Design — approved, pending spec review
**Author:** brainstormed with Vivatchai Kaveeta

## Summary

On the admin dashboard (`/admin`, the "หน้าหลัก" nav item), the
"การเข้างานวันนี้" hero card shows two big figures: **เข้างานแล้ว**
(checked in) and **ยังไม่เข้า** (not yet checked in). Make each figure a
link that opens the live attendance board (`/admin/attendance/live`)
pre-filtered to the matching list of employees.

To support this, the live board's KPI strip becomes interactive: all five
cards (เข้างานแล้ว / มาสาย / ยังไม่มา / ลา​หยุด / ออกแล้ว) act as filter
toggles driven by a `?filter=` URL param. Two of those states —
**not-checked-in** and **on-leave** — currently exist only as counts, so the
board's data loader gains two new employee lists to back them.

## Goals

- Make the dashboard's เข้างานแล้ว / ยังไม่เข้า figures deep-link into the
  live board, filtered to that state's employee list.
- Turn the live board's five KPI cards into filter toggles, with the active
  filter reflected in the URL (shareable, back-button friendly).
- Show a real **not-checked-in** employee list (the data the board has never
  surfaced — only counted) and a real **on-leave** employee list.
- Keep the dashboard a Server Component with `revalidate = 30` (no
  `searchParams` reads on `/admin`).

## Non-goals

- No new attendance page; we extend the existing live board (decided).
- No write actions from the board (still read-only).
- No change to the other attendance tabs (records / disputed / manual).
- No realtime push for the not-checked-in / on-leave lists beyond what the
  board already does (the existing Supabase channel + 30s poll refetch already
  re-pulls the whole `LiveBoardData`, so the new lists refresh with it for
  free).

## Key decisions

1. **Extend the live board, don't build a parallel page.** The board is the
   canonical "today's attendance" view and already has realtime + branch
   grouping. Both dashboard figures link here.
2. **Clickable KPI cards as the filter UI** (not a separate tab control).
   Clicking a card filters the list below and writes `?filter=` to the URL;
   the dashboard deep-links select the same card. Symmetric and discoverable.
3. **All five cards filter.** `เข้างานแล้ว` / `มาสาย` / `ออกแล้ว` are free
   subsets of the already-fetched check-in rows; `ยังไม่มา` and `ลา​หยุด`
   require two new employee lists from the loader.
4. **Reconcile the roster to `canCheckIn: true`.** The dashboard counts the
   roster as `canCheckIn: true`; the board's `activeCount` does not. Align the
   board to `canCheckIn: true` so the dashboard's "ยังไม่เข้า" and the board's
   "ยังไม่มา" always agree. (`canCheckIn` defaults to `true`, so for most orgs
   no number visibly moves — this just closes the edge case where some
   employees can't check in.)
5. **Permission-gate the dashboard links.** The board requires
   `attendance.live-board`; the dashboard requires `dashboard.read`. Use the
   non-throwing `canDo(user, 'attendance.live-board')` on the dashboard and
   render plain numbers (no link) when the viewer can't open the board — no
   dead links.
6. **Extract `bangkokDateUtcMidnight` to a shared helper.** It is duplicated
   verbatim in `live.ts`, `check-in.ts`, and the dashboard `page.tsx`. Since
   this change already edits `live.ts` and `page.tsx`, extract it to
   `src/lib/attendance/date.ts` and reuse it from all three.
7. **Make `getTodayAttendance` closed-day-aware.** On a Sunday or a holiday
   nobody is *expected* to check in, so the not-checked-in list must be empty
   (you can't be "missing" on a day off). The dashboard already forces
   `notCheckedInCount = 0` on closed days; without matching logic the board
   would list *everyone* and disagree with the dashboard's `0`. So the loader
   looks up today's holiday (as the dashboard does) and returns
   `notCheckedIn = []` on closed days. This also fixes a latent quirk: the
   board's current `notYet = activeCount − present − onLeaveCount` formula
   shows ~everyone as "ยังไม่มา" on Sundays. The KPI count therefore switches
   from that formula to `notCheckedIn.length`.

## Architecture

### Data flow

```
/admin (Server Component, revalidate=30)
  └─ requirePermission('dashboard.read') → user
  └─ canDo(user, 'attendance.live-board') → canViewLiveBoard
  └─ <KpiHero
        checkedIn / notCheckedIn / total / leave
        checkedInHref   = canViewLiveBoard ? '/admin/attendance/live?filter=checkedin'    : undefined
        notCheckedInHref= canViewLiveBoard ? '/admin/attendance/live?filter=notcheckedin' : undefined
     />

/admin/attendance/live (Server Component)
  └─ getTodayAttendance()  → LiveBoardData { rows, notCheckedIn, onLeave, activeCount, onLeaveCount }
  └─ <LiveBoardClient initial={...} />   (reads ?filter= via useSearchParams)
```

### Component / module responsibilities

- **`src/lib/attendance/date.ts`** *(new)* — exports
  `bangkokDateUtcMidnight(d: Date): Date`. Pure. Replaces the three inline
  copies (`live.ts`, `check-in.ts`, `admin/page.tsx`).

- **`src/lib/attendance/live.ts`** *(extend `getTodayAttendance`)* —
  `LiveBoardData` gains two lists. `activeCount` query gains `canCheckIn: true`.
  New queries run inside the existing `Promise.all`:

  ```ts
  export type RosterEmployee = {
    employeeName: string;
    employeeNickname: string | null;
    branchName: string;
  };

  export type OnLeaveEmployee = RosterEmployee & {
    leaveTypeName: string | null;
    startDate: string | null; // ISO date
    endDate: string | null;   // ISO date
  };

  export type LiveBoardData = {
    rows: LiveAttendanceRow[];
    notCheckedIn: RosterEmployee[]; // active, canCheckIn, no CheckIn & no OnLeave today; [] on closed days
    onLeave: OnLeaveEmployee[];     // today's OnLeave rows (name + leave type + range)
    activeCount: number;            // now filtered by canCheckIn: true
    onLeaveCount: number;           // == onLeave.length (kept for the KPI tile)
    isClosedDay: boolean;           // Sunday OR today is a holiday
  };
  ```

  - **Closed-day check:** the `Promise.all` gains a holiday lookup
    (`prisma.holiday.findFirst({ where: { date: today, archivedAt: null } })`,
    same as the dashboard); `isClosedDay = today.getUTCDay() === 0 || holiday !== null`.
  - **notCheckedIn query** (relation filter — no roster diffing in JS). On a
    closed day the result is forced to `[]` (nobody is expected):
    ```ts
    isClosedDay ? [] : prisma.employee.findMany({
      where: {
        archivedAt: null,
        status: { not: 'Archived' },
        canCheckIn: true,
        attendances: {
          none: { date: today, type: { in: ['CheckIn', 'OnLeave'] }, deletedAt: null },
        },
      },
      orderBy: [{ branch: { name: 'asc' } }, { firstName: 'asc' }],
      select: { firstName: true, lastName: true, nickname: true, branch: { select: { name: true } } },
    })
    ```
    (Run the query unconditionally inside `Promise.all`, then `notCheckedIn =
    isClosedDay ? [] : queryResult` — keeps the parallel round-trip simple.)
  - **onLeave query** mirrors the dashboard's existing "ลาวันนี้" query
    (`type: 'OnLeave', date: today, deletedAt: null`) joined to employee +
    leaveRequest.leaveType, ordered by branch then name. `onLeaveCount` becomes
    `onLeave.length` (drops the now-redundant separate `count`).

- **`src/components/ui/stat-card.tsx`** *(extend)* — add optional `onClick`
  and `active` props. When `onClick` is set the card renders as a `<button>`
  (full-width, cursor-pointer, focus ring); `active` adds a highlighted ring.
  Existing display-only usages (no `onClick`) are unchanged.

- **`live-client.tsx`** *(extend)* — the KPI strip cards become filter
  toggles; the list area renders by active filter:
  - the "ยังไม่มา" card value now reads `notCheckedIn.length` (was the derived
    `activeCount − present − onLeaveCount` formula), so the count matches the
    list and is `0` on closed days.
  - filter state initialized from `useSearchParams().get('filter')`, updated on
    card click via `router.replace(pathname + ?filter=…)` (and cleared when the
    active card is clicked again).
  - **checkedin / late / checkedout** → existing chips, subset-filtered from
    `rows` (`late` = `isLate(clockInAt)`, `checkedout` = `clockOutAt != null`).
  - **notcheckedin** → muted chips (name + branch + "ยังไม่เช็คอิน"),
    branch-grouped.
  - **onleave** → chips with name + leave type + range, branch-grouped.
  - default (no/unknown filter) → today's check-in list (current behavior),
    no card highlighted.

- **`src/components/ui/kpi-hero.tsx`** *(extend)* — add optional
  `checkedInHref` / `notCheckedInHref`. When present, wrap that figure's
  number+label column in `next/link` `<Link>` with a hover affordance
  (underline + cursor); when absent, render exactly as today.

- **`src/app/(admin)/admin/page.tsx`** *(extend)* — capture `user` from
  `requirePermission('dashboard.read')`, compute `canViewLiveBoard` via
  `canDo`, pass the two hrefs (or `undefined`) to `KpiHero`. Swap the inline
  `bangkokDateUtcMidnight` for the shared import.

### Filter param vocabulary

| `?filter=` value | Card        | List shown                                   |
|------------------|-------------|----------------------------------------------|
| `checkedin`      | เข้างานแล้ว | check-in rows (default content, highlighted) |
| `late`           | มาสาย       | check-in rows where `isLate`                 |
| `notcheckedin`   | ยังไม่มา    | `notCheckedIn` employees                     |
| `onleave`        | ลา​หยุด     | `onLeave` employees                          |
| `checkedout`     | ออกแล้ว     | check-in rows where `clockOutAt`             |
| *(absent/other)* | —           | check-in rows, no card highlighted           |

## Error handling & edge cases

- **Closed day (Sunday / holiday):** `getTodayAttendance` forces
  `notCheckedIn = []` and `isClosedDay = true`, so the "ยังไม่มา" card shows 0
  and its filtered list shows an empty state — consistent with the dashboard's
  `notCheckedInCount = 0`. (This is a deliberate behavior change from the
  board's current Sunday display, per key decision 7.)
- **Invalid / unknown `?filter=`:** falls through to the default view.
- **Soft-deleted check-ins:** the `notCheckedIn` `none` filter includes
  `deletedAt: null`, so a soft-deleted CheckIn correctly leaves that employee
  in the not-checked-in list.
- **Viewer lacks `attendance.live-board`:** dashboard renders plain (non-link)
  figures; no broken navigation.

## Testing

- **`getTodayAttendance` (unit / integration):** not-checked-in list excludes
  employees who checked in, excludes on-leave employees, excludes
  `canCheckIn: false`, and excludes archived employees; on-leave list carries
  leave type + range; `activeCount` respects `canCheckIn`; on a closed day
  (Sunday or holiday) `notCheckedIn` is `[]` and `isClosedDay` is `true`.
- **`bangkokDateUtcMidnight`:** a focused test that a Bangkok-evening instant
  maps to the correct UTC-midnight date (covers the extraction).
- **Filter→list selection (client logic):** extract the "rows for filter" mapping
  into a pure helper and test each filter value (including unknown → default).
- **`StatCard`:** renders a `<button>` when `onClick` is provided, a static
  element otherwise; `active` applies the highlight.

## Out of scope / future

- Persisting a preferred default filter per admin.
- Making the not-checked-in / on-leave lists individually realtime-granular
  (today they refresh with the whole-board refetch, which is sufficient).
