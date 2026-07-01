# Spec B6 — Branch-scope enforcement: dashboard + calendar

**Status:** Approved design (2026-07-01)
**Program:** Branch-scoped administration. Prod has A, B1, B2a/b, B3. Merged local (un-pushed): B4, B-LIFF, B5. Built on local main `4d8727c`. This is **B6** — the dashboard (`/admin`) and calendar (`/admin/calendar`), the last read surfaces in the program. After B6, only payroll remains (B-payroll-guard, enforce global-only).

## Problem

Two overview surfaces show employee-linked data with no branch filter:

- **Dashboard** (`/admin/page.tsx`), gated by `requireAdminArea()` (admission only — any admin-class user): renders **unscoped** pending-leave/advance counts + lists, today's check-ins, today's on-leave, the active check-in roster, and a month **calendar card**.
- **Calendar** (`/admin/calendar/page.tsx` + `_calendar/actions.ts`), gated `dashboard.read`: renders the month calendar (leave + advance + holidays per day), a branch-filter dropdown, and click-to-review day details.

A branch-scoped admin sees org-wide totals, rosters, and calendar entries across all branches.

The calendar everywhere is driven by **one shared function**, `getOrgCalendarData` in `src/lib/leave/team-calendar.ts` — consumed by the dashboard card (`page.tsx:187`), the calendar page (`calendar/page.tsx:34`), and the calendar nav action (`_calendar/actions.ts` `loadAdminCalendar`). It resolves an employee set (all active, or one branch when `branchId` given) then aggregates leave+advance+holidays. Scoping it once covers the calendar on all three.

## Goal (B6)

Every dashboard + calendar read is scoped to the actor's permitted branches (home ∪ assigned) by **per-domain permission** (approved decision):

- pending-**leave** count/list → `leave.read`; pending-**advance** count/list → `advance.read`; today's **attendance** + roster → `attendance.read`; the shared **calendar** (`getOrgCalendarData`) + its branch dropdown → `dashboard.read`; calendar day-detail review rows → the function's existing gate (`leave.approve` / `advance.approve`).

**Invariant: zero change for global/Superadmin** (`getPermittedBranches → 'all'` ⇒ `employeeBranchScope`/`viaEmployeeBranchScope → {}`, inert). Reuses `src/lib/auth/branch-scope.ts`. **No new helpers, no schema/migration.** Org-config reads (holidays, branch names for display) are never scoped.

## Non-goals

- No new permission; `requireAdminArea()` admission on the dashboard is unchanged (B6 adds per-widget scoping, not a new page gate).
- Payroll (B-payroll-guard) is separate. The LIFF calendar (`getTeamCalendarData`, a different function, already viewer-scoped) is untouched.
- No change to widget layout or calendar math.

## Architecture

`employeeBranchScope(permitted)` (`{}` for `'all'`) and `viaEmployeeBranchScope(permitted)` (`{ employee: ... }` or `{}`). Load assignments once per page and resolve several permissions purely (`permittedBranchesFromAssignments`), since these pages fan out multiple reads.

### Unit 1 — `getOrgCalendarData` scope (`src/lib/leave/team-calendar.ts`) — the linchpin

Add a required `permitted: PermittedBranches` to its args and AND it into the employee-set `where` (the single injection point at `team-calendar.ts:189-197`); everything downstream keys off the resolved employee ids, so scope propagates:

```ts
const base: Prisma.EmployeeWhereInput = { archivedAt: null, status: { not: 'Archived' } };
if (branchId) base.OR = [{ branchId }, { assignedBranchIds: { hasSome: [branchId] } }];
const scope = employeeBranchScope(permitted); // {} for 'all'
const where = Object.keys(scope).length ? { AND: [base, scope] } : base;
const employees = await prisma.employee.findMany({ where, select: { ... } });
```

All three callers pass `getPermittedBranches(user, 'dashboard.read')`. (The existing `branchId` user-filter continues to work *within* the permitted set — same AND pattern as B5.)

### Unit 2 — Dashboard widgets (`src/app/(admin)/admin/page.tsx`)

`requireAdminArea()` already yields `user`. Load assignments once and resolve four scopes:

```ts
const assignments = await getUserAssignments(user.id);
const leaveScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'leave.read'));
const advScope   = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'advance.read'));
const attScope   = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'attendance.read'));
const calPermitted = permittedBranchesFromAssignments(assignments, 'dashboard.read');
```

Merge into each read's `where`:
- pending **leave** `count` + `findMany` → `...leaveScope`
- pending **advance** `count` + `findMany` → `...advScope`
- today's **attendance** `findMany` (CheckIn today, OnLeave today ×2) → `...attScope`
- **employee** roster `findMany` (active, `canCheckIn`) → `AND` with `employeeBranchScope(...attendance.read)` (direct Employee query, not via-relation)
- **`getOrgCalendarData({ ..., permitted: calPermitted })`** for the dashboard card
- `holiday.findMany` → unchanged (org-config)

(Each `where` here has no pre-existing `employee` key, so spreading `viaEmployeeBranchScope` is safe; the employee roster query needs an `AND` because it already has top-level Employee fields.)

### Unit 3 — Calendar page + branch dropdown (`src/app/(admin)/admin/calendar/page.tsx`)

Capture `user`; `const calPermitted = await getPermittedBranches(user, 'dashboard.read')`. Pass `permitted: calPermitted` to `getOrgCalendarData`. Scope the branch-filter `prisma.branch.findMany` to permitted branches (`{ archivedAt: null, id: { in: permitted } }` when scoped; unfiltered for `'all'`) — same as B5's dropdown.

### Unit 4 — Calendar actions (`src/app/(admin)/admin/_calendar/actions.ts`)

- `loadAdminCalendar`: capture the `user` from its existing `requirePermission('dashboard.read')`, compute `permitted`, pass to `getOrgCalendarData`.
- `getLeaveReviewRow` (gated `leave.approve`) / `getAdvanceReviewRow` (gated `advance.approve`): switch `findUnique → findFirst`, add `...viaEmployeeBranchScope(getPermittedBranches(user, '<that gate perm>'))` to the `where`; the existing `if (!row) return null` hides out-of-scope rows.

## Testing

- **`getOrgCalendarData`** (Unit 1) — new `src/lib/leave/team-calendar.branch.test.ts` mocking prisma + `server-only`, driving the real `employeeBranchScope`: scoped actor → `employee.findMany` where contains the `AND: [base, employeeBranchScope]`; global `'all'` → plain base (no AND); the user `branchId` filter still AND's the permitted scope (forged out-of-scope → empty). (Mirrors B5's `queries.branch.test.ts`; note team-calendar.ts imports `server-only`.)
- **Dashboard + calendar page/actions** (Units 2–4) — read-filter wiring in Server Components / actions (the program-wide untested-by-nature bucket, like B-LIFF); verified by `tsc` + `next build` + the helper tests + the final review. The two detail actions' `findFirst`+scope follow the proven B-LIFF pattern.
- Full suite + `tsc --noEmit` clean; `next build` green; page-gate guardrail green.

## Files touched

| File | Change |
|------|--------|
| `src/lib/leave/team-calendar.ts` | `getOrgCalendarData` gains `permitted`; AND `employeeBranchScope` into the employee `where` |
| `src/app/(admin)/admin/page.tsx` | scope leave/advance/attendance/roster widgets (domain perms) + pass `dashboard.read` permitted to the calendar card |
| `src/app/(admin)/admin/calendar/page.tsx` | pass `dashboard.read` permitted to `getOrgCalendarData`; scope the branch dropdown |
| `src/app/(admin)/admin/_calendar/actions.ts` | `loadAdminCalendar` passes permitted; `getLeaveReviewRow`/`getAdvanceReviewRow` → `findFirst`+scope |
| `src/lib/leave/team-calendar.branch.test.ts` (new) | `getOrgCalendarData` scope tests |

## Open risks

- **`getOrgCalendarData` required-param change:** its three callers all update in the same increment; grep confirms no other caller. tsc guards it.
- **Dashboard card vs dashboard admission:** the calendar card is scoped by `dashboard.read`; an admin admitted via `requireAdminArea` but lacking `dashboard.read` sees an empty card (correct per the per-domain decision). The rest of their dashboard scopes by their held domain perms.
- **Detail actions scoped by the approve perm:** `getLeaveReviewRow`/`getAdvanceReviewRow` reuse their existing `leave.approve`/`advance.approve` gate as the scope key (they're approve-context reads), not `leave.read` — deliberate, matches the function's own gate.
- **Partial test coverage:** only `getOrgCalendarData` is unit-tested; the page/action wiring rides on tsc + build + final review (the tracked read-filter-harness gap). Stated plainly.
- **Blast radius:** all prod admins are global → every scope is `{}` → zero change in production. Pure-code, reversible, no migration.
