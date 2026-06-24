# Admin-Employee Unified Identity + Combined LIFF Home

**Date:** 2026-06-24
**Status:** Approved design — ready for implementation plan

## Problem

Some people are **both** an admin **and** a real employee on payroll (e.g. an
owner-manager or HR lead who checks in daily *and* approves others' requests).

Today the system structurally forbids this:

- A `User` is **either** Staff (has a 1:1 `Employee` record) **or** Admin/Superadmin
  (has **no** `Employee` record).
- `User.lineUserId` is `@unique` — one LINE account maps to exactly one `User`.
- The admin-pairing flow actively rejects the overlap with a Thai error:
  *"one LINE account can connect to only one user — admins who are also employees
  must use a separate LINE account"* (`src/lib/auth/link-line-to-admin.ts`).

So an admin-employee must carry **two LINE accounts** and switch between them. We
want them to use **one** LINE account and see **both** their employee features and
their admin tools.

## Goal

An admin-employee, on a single LINE account:

- Performs **full employee actions** — check in/out, submit their own leave &
  advance requests, view their own payslip/salary (they are on payroll).
- Performs **admin actions** — approve requests, view the admin dashboard & reports.
- Sees a **combined LIFF home**: an employee button group on top, an admin button
  group below.

## Chosen approach: unify at the `User` level (Approach A)

An admin-employee is simply a `User` that has **both** an `Employee` record **and**
an `Admin`/`Superadmin` role assignment. The Prisma schema already supports this:

- `User.employee` is an **optional** 1:1 relation.
- `UserRoleAssignment` is a **many-to-many** join — a `User` can hold multiple roles.

So **no schema migration is required** for the core. The work is *removing* the
assumption that "admin ⇒ no employee" and fixing the access gates and routing that
encode it.

Rejected alternatives:

- **B — two linked `User`s:** fights `lineUserId @unique`, needs two synced rows.
  This is today's two-account pain with a link bolted on.
- **C — everyone is an Employee, admin is just a role:** biggest migration; forces
  payroll/attendance semantics onto people who only administer (e.g. an external
  accountant or owner not on payroll).

## Design

### 1. Identity & auth — one LINE session resolves both capabilities

The admin-employee authenticates once via LINE OIDC in the LIFF. Their single
`User` row carries:

- `lineUserId` = their LINE `sub` (bound at pairing),
- an `Employee` record (so `getCurrentEmployee` and employee flows work),
- `admin`/`superadmin` role assignment(s) (so `requireRole` and `canDo` work).

The existing `requireRole` **LIFF fallback** (`require-role.ts:97-105`) already
resolves a LINE-minted session to the `User` row via `lineUserId` when the primary
`authUserId` lookup misses. That same fallback is what lets one LINE-only
admin-employee resolve to one `User` that has both an employee and admin roles. The
admin web pages (dashboard/reports) open in LINE's in-app browser carrying that
same Supabase session.

**Auth decision: LINE-only.** No second email/password web account is required for
an admin-employee. (Pure admins keep their existing email login unchanged.)

### 2. Decouple employee-feature access from tier — THE load-bearing change

`computeTier` is **highest-wins and single-valued** (`src/lib/auth/user-tier.ts`):
a user holding both a `staff` and an `admin` assignment computes to tier **`Admin`**
(or `Superadmin`), **never `Staff`**.

The worker LIFF is currently gated on `requireRole(['Staff'])` — e.g.
`requireCheckInPermission` (`require-role.ts:154-162`). `requireRole` deliberately
does **not** auto-elevate Admin/Superadmin into `Staff` gates (`require-role.ts:130-134`).
Therefore, without change, an admin-employee (tier `Admin`) would be **locked out**
of check-in, leave, and advance — the opposite of the goal.

**Fix:** gate employee features on *"has an `Employee` record"*, not on
`tier === 'Staff'`. `requireRole` already eagerly loads `employee` for every tier
(`require-role.ts:79`), so the change is mechanical:

- `requireCheckInPermission` (and the other employee LIFF gates) change from
  `requireRole(['Staff'])` to `requireRole(['Staff', 'Admin', 'Superadmin'])`
  followed by the existing `if (!result.employee) notFound()` and the eligibility
  checks (`status`, `canCheckIn`).
- Net effect: "any authenticated user **with an employee record**, who is allowed
  to check in" — which now correctly includes admin-employees, and is unchanged for
  pure staff (who have an employee record) and pure admins (who don't, so they're
  still excluded from check-in, as today).

**Implementation note:** the plan must **audit every `requireRole(['Staff'])` call
site** and every employee-facing LIFF route guard (`/liff/check-in`, `/liff/leave`,
`/liff/advance`, `/liff/payslip`, `/liff/summary`, `/liff/calendar`,
`/liff/profile`) and apply this widen-then-require-employee pattern consistently.
Consider extracting a single `requireEmployee()` helper so the rule lives in one
place rather than being copy-pasted.

### 3. Combined LIFF home — capability-aware screen

A new LIFF home route (proposed `/liff/home`) renders **capability groups**:

- **Employee group** (teal) — shown when the resolved `User` **has an `Employee`
  record**. Buttons: **ลงเวลา** (check-in/out → `/liff/check-in`), **ขอลา**
  (leave → `/liff/leave`), **เบิกเงิน** (advance → `/liff/advance`).
- **Admin group** (purple) — shown when the resolved `User` has the `liff.admin`
  permission (`canDo(user, 'liff.admin')`). Buttons: **อนุมัติ** (approvals inbox →
  `/liff/admin/inbox`, with a pending-count badge), **ภาพรวม** (admin dashboard →
  `/admin`), **รายงาน** (reports → `/admin/reports`).

Rendering rule:

- Has employee only → employee group only (pure staff).
- Has `liff.admin` only → admin group only (pure admin who opens the LIFF).
- Both → both groups (admin-employee). This is the target case.

The same screen serves everyone; there is no separate "admin-employee" component.
The "ภาพรวม"/"รายงาน" buttons deep-link to the existing admin web pages, which open
in LINE's in-app browser under the same session.

### 4. Routing

The bare-domain router (`src/app/page.tsx`) currently maps tier → home via
`TIER_HOMES` (`Admin`/`Superadmin` → `/admin`, `Staff` → `/liff/check-in`). It
selects only `roleAssignments`, not `employee`.

Change: extend the root-router query to also know whether the user has an
`Employee` record, and route:

- tier `Admin`/`Superadmin` **and** has employee → `/liff/home` (combined home).
- tier `Admin`/`Superadmin` **and** no employee → `/admin` (unchanged — pure admin).
- tier `Staff` → `/liff/check-in` (unchanged — pure staff land directly on their
  most common action; no added friction).

Pure-staff landing is intentionally left unchanged (YAGNI). Making `/liff/home` the
universal landing for staff too is a trivial future toggle if desired, but it adds a
tap before check-in, so it is out of scope here.

### 5. Pairing flow — stop rejecting the overlap

`src/lib/auth/link-line-to-admin.ts` (and the worker-side
`link-line-to-employee.ts`) reject binding a LINE account when the `User` already
plays the "other" role. Since one `User` may now legitimately be both, the pairing
logic must permit binding `lineUserId` to a `User` that has both an `Employee`
record and admin role assignments, while still rejecting the genuine collision case
(a LINE account already bound to a **different** `User`). The `lineUserId @unique`
"already bound to a different user" guard stays.

### 6. Onboarding — grant admin *to* an existing employee

The supported path to create an admin-employee is to **start from a real employee
and grant them an admin role** — add an `admin`/`superadmin` `UserRoleAssignment` to
the employee's existing `User`, from the admin UI (the
`src/app/(admin)/admin/employees/[id]/edit/page.tsx` page and/or the
`src/app/(admin)/admin/settings/team/page.tsx` page).

The reverse (taking a bare admin and creating payroll/attendance data for them) is
**out of scope** — it risks fabricating salary/attendance semantics for someone who
may not belong on payroll. If a pure admin needs to become an employee, they are
created as an employee first, then granted admin.

## Out of scope (YAGNI)

- Second-account linking or any two-`User` model.
- Per-mode preference memory / "remember my last choice" switching.
- Reverse onboarding (bare admin → create employee).
- Making `/liff/home` the universal landing for pure staff.
- Any change to how pure-admins or pure-employees work today.

## Affected files (for the implementation plan)

- `src/lib/auth/require-role.ts` — widen `requireCheckInPermission` / Staff gates;
  consider a shared `requireEmployee()` helper.
- All employee-facing LIFF route guards under `src/app/(liff)/liff/*`.
- `src/app/page.tsx` — root-router: detect admin-employee, route to `/liff/home`.
- `src/app/(liff)/liff/home/` — **new** combined home screen (capability-aware).
- `src/lib/auth/link-line-to-admin.ts`, `src/lib/auth/link-line-to-employee.ts` —
  permit the legitimate both-roles binding; keep the cross-user collision guard.
- `src/app/(admin)/admin/employees/[id]/edit/page.tsx` and/or
  `src/app/(admin)/admin/settings/team/page.tsx` — grant-admin-to-employee UI.
- i18n message catalogs — labels for the combined home groups/buttons (per the
  existing 6-locale setup).

## Testing

- **Unit:** `computeTier` already covered; add coverage for the new
  "has-employee" gate helper (admin-employee passes; pure admin without employee
  fails; pure staff passes).
- **Integration:** an admin-employee `User` (employee + admin assignment) can hit
  the check-in / leave / advance server actions; a pure admin still cannot.
- **e2e (developer-facing):** the combined `/liff/home` renders both groups for an
  admin-employee, employee-only for a pure staff, admin-only for a pure admin.
