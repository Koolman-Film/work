# Admin LIFF mobile toolkit — approvals + today + this-month

**Date:** 2026-06-26
**Status:** Design — pending spec review → implementation plan
**Related:** rich-menu work (`feat/capability-rich-menu`), `2026-06-24-admin-employee-unified-identity-design.md`

## Problem / goal

Admins should be able to do their **daily** work from LINE (LIFF) on a phone,
without opening the full web `/admin` panel. The single most important daily task
is **approvals**; secondary daily checks are **today's attendance** and **this
month's numbers**. Everything heavier (payroll, employee CRUD, settings, report
exports) stays on the web.

Today the admin LIFF is only half a tool: `/liff/admin/inbox` lists leave +
advance + disputed check-ins, but only **leave** and **advance** are approvable on
mobile — **overtime** is missing entirely and **disputed check-ins** only deep-link
to the web. There is no LIFF dashboard or report.

## Scope

Three admin LIFF surfaces, each mapped to one admin rich-menu button:

| Button | LIFF page | Purpose |
|---|---|---|
| อนุมัติ (Approvals) | `/liff/admin/inbox` | **act** — approve/reject every pending type |
| ภาพรวม (Dashboard) | `/liff/admin/dashboard` | **check** — today at a glance |
| รายงาน (Reports) | `/liff/admin/report` | **check** — this month at a glance |

**Cross-cutting pattern:** LIFF is *glanceable + the one action you do on a phone*;
each page has a one-tap **"full detail on web"** link. LIFF pages stay small/fast.

## Non-goals (stay on web)

Employee lookup/CRUD, team calendar, payroll runs + adjustments, report exports,
all of settings, net-to-pay figures. (These were considered and deliberately left
to the web panel.)

## Access / dependency note

These pages live under `/liff/admin/*` and are gated by the admin LIFF session
(same `requireRole`/`requirePermission` + LINE-session fallback the existing inbox
uses). They become reachable once an admin is LINE-linked — which depends on the
admin LINE experience being re-enabled (`ADMIN_LINE_LINK_ENABLED`, currently off)
and the capability rich menu shipping. This feature builds the destination; wiring
the rich-menu buttons to these routes is the final step.

## Part 1 — Complete the approvals inbox

`/liff/admin/inbox` becomes the one queue for **all four** pending types, each with
a mobile detail page that approves/rejects by reusing the existing server actions
(no new approval logic):

1. **คำขอลา (Leave)** — unchanged (`/liff/admin/leave/[id]`).
2. **คำขอเบิก (Advance)** — unchanged (`/liff/admin/advance/[id]`).
3. **ทำงานล่วงเวลา (Overtime)** — NEW section + NEW `/liff/admin/overtime/[id]`
   detail. Reuses `approveOt` / `dismissOt` (`src/lib/overtime/actions.ts`). Shows
   employee, date, requested hours/rate, reason.
4. **ลงเวลารอตรวจสอบ (Disputed check-in)** — NEW `/liff/admin/dispute/[id]` detail
   (replaces the web deep-link). Shows the **selfie photo + location/map context +
   flag reason**, approve/reject via `approveDisputed` / `rejectDisputed`
   (`src/lib/attendance/admin-review.ts`).

Inbox query adds the pending OT fetch alongside the existing leave/advance/dispute
fetches; the `empty` state accounts for all four. Each detail page follows the
existing leave/advance LIFF detail template (server component loads the row →
client review-actions component → optimistic decided state).

## Part 2 — Dashboard LIFF (today) — `/liff/admin/dashboard`

Read-only "today at a glance", reusing the web dashboard's existing query logic
(`src/app/(admin)/admin/page.tsx` — extract the shared "today snapshot" into a
reusable helper if it isn't already, rather than duplicating the queries):

- **มาแล้ววันนี้** — checked-in today / expected today (schedule-aware count)
- **ยังไม่มา** — scheduled today but not yet checked in / on leave
- **ลาวันนี้** — on leave today (distinct employees)
- **รออนุมัติ** — total pending across the 4 types → taps through to the inbox
- header: today's Bangkok date + holiday badge if any
- **`ดูแดชบอร์ดเต็ม →`** → web `/admin`

## Part 3 — Report LIFF (this month) — `/liff/admin/report`

Monthly summary for the current month, with a back/forward month toggle. Numbers
reuse the web report data sources (`/admin/reports/{attendance,leave,advance}` and
the OT data), surfaced as headline figures:

- **การลงเวลา (Attendance)** — work days · late count · absent count
- **การลา (Leave)** — leave days taken
- **การเบิก (Advance)** — advances count + ฿ total
- **ล่วงเวลา (Overtime)** — approved OT hours
- **`ดูรายงานเต็ม →`** → web `/admin/reports`

(Net-to-pay and payroll figures intentionally excluded — payroll-sensitive, web only.)

## Part 4 — Rich-menu wiring

The admin row of both the **admin** and **combined** rich menus maps to these three
LIFF routes (via the `?dest=` dispatcher in `/liff/pair/pair-client.tsx` — add
`admin-dashboard` → `/liff/admin/dashboard`, `admin-report` → `/liff/admin/report`;
`admin-inbox` already exists). Tap-area URLs in `setup-admin-rich-menu.ts` /
`setup-combined-rich-menu.ts` updated to those dests.

## Testing

- **Inbox:** integration test asserting all four pending types appear and the
  counts are correct; empty-state when none.
- **OT / dispute detail:** integration tests that the LIFF detail approve/reject
  calls the reused action and flips the row's status; decided rows render read-only.
- **Dashboard:** unit/integration on the today-snapshot helper (checked-in /
  expected / on-leave / pending counts) — reuse/extend the dashboard's existing
  coverage rather than re-deriving.
- **Report:** integration on the monthly aggregates (attendance late/absent, leave
  days, advance total, OT hours) for a seeded month, including the month toggle
  boundary.

## Suggested phasing (for the plan)

1. **Inbox completion** — OT section + `/liff/admin/overtime/[id]` +
   `/liff/admin/dispute/[id]`. (Self-contained; the highest-value daily task.)
2. **Dashboard LIFF** (today) + shared today-snapshot helper.
3. **Report LIFF** (this month).
4. **Rich-menu wiring** — dispatcher dests + setup-script tap areas (depends on the
   rich-menu feature; lands when admin LINE is re-enabled).
