# Calendar: reimbursements + clickable review modals — design

**Date:** 2026-06-08
**Status:** Approved
**Topic:** Make the `/admin/calendar` right-hand day-detail list clickable so each row
opens the matching review modal (`ตรวจสอบคำขอลา` / `ตรวจสอบคำขอเบิก`), and surface
cash-advance (เบิก) requests on the calendar so they can be reviewed there too.

## Problem

`/admin/calendar` shows a month grid with a right-hand day-detail panel
(`detailPosition="right"`) listing everyone on leave for the selected day. Two
gaps:

1. The right-panel rows are inert — an admin who spots a pending leave there has to
   leave the page and find it in `/admin/leave` to act on it.
2. Cash-advance (เบิก) requests don't appear on the calendar at all; its data model
   is leave-only.

Goal: show เบิก on the calendar and make every right-panel row open the right
review modal in place (approve / reject / void), without changing the employee
LIFF calendar that shares the same grid component.

## Key decisions

- **Anchor date for เบิก:** `CashAdvance.requestedAt` (the created/requested date). A
  cash advance is point-in-time, so it marks exactly one day cell.
- **Grid marker for เบิก:** a money-colored (green) `฿`-prefixed chip rendered in the
  same bar stack as leave bars, sharing the existing "up to 2, then +N" budget.
- **Statuses on the calendar:** Pending + Approved only (matches leave today — these
  are the actionable ones: approve/reject for Pending, void for Approved).
- **Admin-only:** advances load only in the org (admin) calendar loader and the
  click-to-review behavior is opt-in. The employee LIFF calendar is byte-for-byte
  unchanged in behavior.
- **Open the modal via fetch-on-click:** the slim calendar entry can't fill a review
  modal (needs signed attachment/receipt URLs, working-days math), so clicking a row
  calls a permission-checked server action that builds the full VM for just that one
  record, then opens the existing review modal.

## Architecture / data flow

```
getOrgCalendarData (admin)         getTeamCalendarData (LIFF employee)
   │  leaves + holidays + ADVANCES     │  leaves + holidays + advances:[]
   ▼                                   ▼
TeamCalendarData { entries, holidays, advances }
   │
   ▼
AdminCalendarCard (client) ──passes entries/holidays/advances + onLeaveClick/onAdvanceClick──▶ CalendarGrid
   │                                                                                              │
   │  row click → server action getLeaveReviewRow / getAdvanceReviewRow → full VM                 │ renders ฿ chips
   ▼                                                                                              │ + clickable rows
LeaveReviewModal / AdvanceReviewModal (extracted, shared with inbox pages)
```

LIFF `CalendarGrid` receives `advances: []` and no click callbacks → renders exactly
as today (no chips, inert rows).

## Components & changes

### 1. Shape + helpers — `src/lib/leave/team-calendar-shape.ts`
- Add type:
  ```ts
  export type TeamCalendarAdvance = {
    cashAdvanceId: string;
    employeeId: string;
    employeeName: string;
    shortLabel: string;       // nickname || firstName, for the cell chip
    amountLabel: string;      // pre-formatted THB, e.g. "฿1,500.00"
    status: 'Pending' | 'Approved';
    date: string;             // YYYY-MM-DD = requestedAt (Bangkok day)
  };
  ```
- `TeamCalendarData` gains `advances: TeamCalendarAdvance[]`.
- Add pure helper `indexAdvancesByDate(advances): Map<string, TeamCalendarAdvance[]>`
  (single-day keys; mirrors `indexEntriesByDate`).

### 2. Loaders — `src/lib/leave/team-calendar.ts`
- `loadEntriesAndHolidays` keeps loading leaves + holidays and now returns
  `advances: []` (so the LIFF path carries the field but no data).
- `getOrgCalendarData` additionally loads advances for the resolved employee set:
  `prisma.cashAdvance.findMany({ where: { employeeId in set, status in [Pending,
  Approved], deletedAt: null, requestedAt within [monthStart, monthEnd] } })`,
  formats `amountLabel` (THB) + `date` (Bangkok YYYY-MM-DD from `requestedAt`), and
  merges them into the returned `TeamCalendarData`.
- Month-window note: leave uses an overlap window on `startDate/endDate`; advances
  use a point-in-time window on `requestedAt` (gte monthStart 00:00, lt next-month).
  Convert `requestedAt` to the Bangkok calendar day for `date`.

### 3. Grid — `src/app/(liff)/liff/calendar/calendar-grid.tsx`
- New optional props:
  ```ts
  advances?: TeamCalendarAdvance[];           // default []
  onLeaveClick?: (leaveRequestId: string) => void;
  onAdvanceClick?: (cashAdvanceId: string) => void;
  busyId?: string | null;                      // row showing a loading state
  ```
- `useMemo` an `advancesByDate` index. Per cell, after the ≤2 leave/advance markers
  budget: render leave bars then ฿ chips, combined cap 2, "+N" for the rest. ฿ chip
  styling: green money palette, truncate, `฿{amountLabel-or-shortLabel}`.
- aria-label extended: `(มีลา N)` plus `(เบิก M)` when present.
- Right panel: render leave rows (as today) then advance rows. Each row is a
  `<button>` when its click callback is provided, else a plain `<div>`/`<li>`
  (LIFF). Advance row shows person + `amountLabel` + status badge. Disabled +
  spinner affordance when `busyId` matches. Empty state text → `ไม่มีรายการวันนี้`
  when neither leaves nor advances exist (keep holiday sub-note).

### 4. Server actions — `src/app/(admin)/admin/_calendar/actions.ts`
- `getLeaveReviewRow(leaveRequestId): Promise<LeaveRowVM | null>` —
  `requirePermission('leave.approve')`, load the single leave with the shared
  `select`, build VM via shared builder (incl. signed attachment URL + working-days).
- `getAdvanceReviewRow(cashAdvanceId): Promise<AdvanceRowVM | null>` —
  `requirePermission('advance.approve')`, build `AdvanceRowVM` via shared builder
  (incl. signed receipt URL).
- Permission rationale: these read the full review record so an admin can act from
  the calendar, so they enforce the same permission as the corresponding mutation
  (`approveLeaveRequest` → `leave.approve` in `src/lib/leave/admin.ts`;
  `approveCashAdvance` → `advance.approve` in `src/lib/advance/admin.ts`).

### 5. Extract review modals (de-dup)
- `src/app/(admin)/admin/leave/leave-review-modal.tsx` — `LeaveReviewModal({ row,
  open, onClose })` wrapping `ReviewModal` + `LeaveBody` + approve/reject/void wiring
  (moved out of `leave-inbox.tsx`). `LeaveInbox` becomes: list of buttons + this modal.
- `src/app/(admin)/admin/advance/advance-review-modal.tsx` — `AdvanceReviewModal({
  row, open, onClose })` owning the receipt-upload state + money-confirm approve +
  reject/void (moved out of `advance-inbox.tsx`). `AdvanceInbox` becomes: list of
  buttons + this modal.
- `LeaveRowVM` / `AdvanceRowVM` type definitions live in the **client** modal modules
  (`leave-review-modal.tsx` / `advance-review-modal.tsx`, both `'use client'`), so any
  client consumer (inbox, calendar card) imports one client-safe definition. The
  server-only VM builders import the type with `import type` (erased at runtime — no
  server→client value import). This mirrors the repo's `team-calendar-shape` (client
  types) vs `team-calendar` (`server-only` loader) split.

### 6. Shared VM builders (single source of truth)
- `buildLeaveRowVM(record, { resolveAttachment, expandedHolidays }): LeaveRowVM` and
  its Prisma `select`, extracted from `leave/page.tsx`. Used by the page and
  `getLeaveReviewRow`.
- `buildAdvanceRowVM(record, { resolveReceipt }): AdvanceRowVM` and its `select`,
  extracted from `advance/page.tsx`. Used by the page and `getAdvanceReviewRow`.
- Location (chosen): colocate next to the pages as server-only modules —
  `src/app/(admin)/admin/leave/leave-row-vm.ts` and
  `src/app/(admin)/admin/advance/advance-row-vm.ts`. The
  `formatRange/formatDateTime/formatMoney/STATUS_INFO` helpers move alongside the
  builder. The `LeaveRowVM`/`AdvanceRowVM` type definitions live in the client modal
  modules (§5); the builders here import them with `import type`.

### 7. Admin card wiring — `src/app/(admin)/admin/_calendar/admin-calendar-card.tsx`
- Thread `data.advances` into `CalendarGrid`.
- State: `openLeave: LeaveRowVM | null`, `openAdvance: AdvanceRowVM | null`,
  `busyId: string | null`.
- `onLeaveClick(id)`: set busy, `await getLeaveReviewRow(id)`, on success set
  `openLeave` + clear busy (on null → small inline error/toast). Same for advances.
- Render `<LeaveReviewModal>` + `<AdvanceReviewModal>`; their internal
  `router.refresh()` on success also refreshes the calendar server component.

### 8. Page loader — `src/app/(admin)/admin/calendar/page.tsx`
- No signature change; `getOrgCalendarData` now returns `advances`, passed straight
  through `initialData`.

## Testing

- **Unit (vitest):** `indexAdvancesByDate` — single-day keys, multiple advances per
  day, empty input. Add to `team-calendar.test.ts` or a sibling.
- **Unit (vitest):** loader test that `getOrgCalendarData` includes advances and
  `getTeamCalendarData` returns `advances: []` (mock prisma as existing tests do).
- **E2E (playwright):** on `/admin/calendar`, select a day with a pending เบิก, click
  the advance row, assert `ตรวจสอบคำขอเบิก` modal opens, approve, assert it leaves the
  pending set. Mirror the existing `admin-advance-approval.spec.ts` patterns.

## Out of scope

- Rejected/Cancelled advances on the calendar (only Pending+Approved shown).
- เบิก on the employee LIFF calendar (admin-only).
- Any change to grid layout beyond the new ฿ chips.

## Risks / notes

- `CalendarGrid` is shared with LIFF — all new behavior is opt-in via props; verify
  the LIFF caller (`/liff/calendar`) and the employee grid render unchanged.
- Extracting modals/VM builders touches the existing inbox pages — keep behavior
  identical; the existing `admin-leave-approval` / `admin-advance-approval` /
  `review-modal` e2e specs must still pass as regression guards.
- Fresh worktree: run `pnpm install` + copy `.env.local` before tests/build.
