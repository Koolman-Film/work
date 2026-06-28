# Spec B1 — Branch-scope enforcement: foundation + attendance

**Status:** Approved design (2026-06-28)
**Part of program:** Branch-scoped administration. Spec A (create + landing, shipped, prod `574c097`) is the "write" side — it records `UserRoleAssignment.branchId`. Spec B is the "enforce" side. This document is the **first increment (B1)**: the shared foundation + the attendance surface. Later increments (B2 employees, B3 leave, B4 advance, B5 reports, B6 dashboard) each reuse the foundation and get their own spec → plan → cycle.

## Problem

Branch scope is **recorded but not enforced**. A `Checker01 @ Branch A` assignment grants `attendance.live-board`, but every admin data query is global, so that user still sees **all branches**. The `check-permission.ts` header and the assignments-section UI both flag this as the pending Phase-3 work.

Confirmed by codebase map:
- **Branch-linked data:** `Employee` (direct `branchId` + `assignedBranchIds String[]` for rotating staff), and *via* `Employee`: Attendance, LeaveRequest, CashAdvance, Payroll, OvertimeEntry, LeaveEntitlement, RecurringDeduction.
- **Company-global config (NO branch field, enforcement does NOT apply):** Department, AccountingGroup, LeaveType, LeaveConfig, Holiday, WorkSchedule, RoleDefinition, User. All `/admin/settings/*` org-config pages stay permission-only.
- **Plumbing half-present:** `checkAssignments(assignments, perm, ctx?)` already does branch-scope intersection on `ctx.branchId`; `void.ts` actions already pass `{ branchId }`. **Missing:** a "which branches may this user exercise permission X in" helper, and any list-query filtering.

## Goal (this increment)

1. Build the reusable **foundation**: resolve a user's permitted branches for a permission, and a Prisma where-fragment that filters Employee-linked rows to those branches (handling multi-branch staff).
2. **Enforce it on the attendance surface**: live board, attendance list, disputed list (read filtering) + the per-record attendance actions (write gating).
3. **Invariant:** zero change for global / Superadmin admins — they resolve to "all branches" and queries are unfiltered, identical to today.

## Non-goals (explicit)

- Employees, leave, advance, reports, dashboard enforcement — later increments (B2–B6).
- **Payroll** — per product decision, payroll stays **global-only**: `payroll.run`/`.publish`/`.lock` require a *global* grant; a branch-scoped admin gets at most a filtered read. Not touched in B1.
- No schema/migration change. No change to org-config (settings) pages.
- No change to how scope is *recorded* (Spec A owns that).

## Architecture

Two units. The foundation is pure-core + IO-wrapper (mirrors `computeTier`/`getUserTier` and `checkAssignments`/`canDo`).

### Unit 1 — Foundation (`src/lib/auth/branch-scope.ts` + test)

```ts
import type { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import type { Permission } from './permissions';
import type { AuthedAssignment } from './require-role';

/** 'all' = the user holds `permission` via a global (branchId=null) assignment.
 *  Otherwise the de-duped list of branchIds whose scoped assignment grants it.
 *  Empty array = the user cannot exercise the permission anywhere. */
export type PermittedBranches = 'all' | string[];

/** Pure: resolve permitted branches for a permission from in-memory assignments.
 *  isSuperadmin assignments count as granting every permission (global ⇒ 'all'). */
export function permittedBranchesFromAssignments(
  assignments: ReadonlyArray<AuthedAssignment>,
  permission: Permission,
): PermittedBranches;

/** IO wrapper — loads the user's assignments once (via resolveAuthedUser) and
 *  delegates to the pure function. */
export function getPermittedBranches(
  user: Pick<User, 'id'>,
  permission: Permission,
): Promise<PermittedBranches>;

/** Prisma where-fragment selecting Employees in the permitted branches.
 *  '{}' (no filter) when 'all'; matches home branch OR assignedBranchIds for
 *  multi-branch staff; an impossible match (`{ id: { in: [] } }`) when the
 *  permitted list is empty so a no-grant actor sees nothing. */
export function employeeBranchScope(permitted: PermittedBranches): Prisma.EmployeeWhereInput;

/** Convenience for via-Employee models (Attendance/Leave/Advance/…): returns
 *  `{}` when 'all', else `{ employee: employeeBranchScope(permitted) }`. */
export function viaEmployeeBranchScope(permitted: PermittedBranches): { employee?: Prisma.EmployeeWhereInput };
```

Semantics of `permittedBranchesFromAssignments`:
- Walk active (non-archived) assignments. For each assignment whose role grants `permission` (or `isSuperadmin`): if `branchId === null` → return `'all'` immediately; else collect `branchId`.
- After the walk, return the de-duped collected list (possibly empty).

`employeeBranchScope`:
- `'all'` → `{}` (no filter — the global/Superadmin invariant).
- non-empty `string[]` → `{ OR: [{ branchId: { in: permitted } }, { assignedBranchIds: { hasSome: permitted } }] }`.
- `[]` → `{ id: { in: [] } }` (matches nothing — defensive; a properly-gated page won't reach here).

### Unit 2 — Attendance enforcement

`getPermittedBranches` is computed once per request from the page/lib's existing authenticated user, then folded into the existing `where` clauses. The per-record actions add a `{ branchId }` ctx to their existing `requirePermission`, exactly like `void.ts`.

**Live board — `src/lib/attendance/live.ts`** (`getTodayAttendance`):
- After `requirePermission('attendance.live-board')`, get the user and compute `const permitted = await getPermittedBranches(user, 'attendance.live-board')`.
- Apply `viaEmployeeBranchScope(permitted)` to the check-in query (`Attendance` via employee) and the on-leave query; apply `employeeBranchScope(permitted)` to the roster `employee.findMany`. (`requirePermission` currently returns `{ user }` — use it; it already resolves the user.)

**Attendance list — `src/app/(admin)/admin/attendance/page.tsx`:**
- After `requirePermission('attendance.read')` (capture `user`), compute `permitted = getPermittedBranches(user, 'attendance.read')`.
- Merge `viaEmployeeBranchScope(permitted)` into `baseWhere` for the records query (and the trash query); apply `employeeBranchScope(permitted)` to the employee-filter dropdown query; scope the disputed `count` with `{ ...where, employee: employeeBranchScope(permitted) }` (only when not `'all'`).

**Disputed list — `src/app/(admin)/admin/attendance/disputed/page.tsx`:** same pattern, gated by `attendance.read`.

**Per-record actions** (`src/lib/attendance/manual.ts` `attendance.manual-create`; `src/lib/attendance/admin-review.ts` `attendance.dispute-resolve`): add `{ branchId: <employee.branchId> }` to their `requirePermission` call so a scoped admin cannot create/resolve for an employee outside their branches. For `manual-create` the employee is the form's target; for `dispute-resolve` it's the disputed record's employee. (`attendance.void` already does this — no change.)

## Data flow

```
request → requirePermission('attendance.read') (authn + perm)
        → getPermittedBranches(user, 'attendance.read')  ('all' | branchId[])
        → employeeBranchScope / viaEmployeeBranchScope → Prisma where-fragment
        → existing findMany/count with the fragment merged into `where`
```

For a global/Superadmin admin the fragment is `{}` and the queries are byte-identical to today.

## Testing

- **`branch-scope.test.ts` (pure):**
  - `permittedBranchesFromAssignments`: global grant → `'all'`; two scoped grants → de-duped union; isSuperadmin global → `'all'`; no grant → `[]`; archived role ignored.
  - `employeeBranchScope`: `'all'` → `{}`; `['b1','b2']` → the `OR` of `branchId in` + `assignedBranchIds hasSome`; `[]` → `{ id: { in: [] } }`.
  - `viaEmployeeBranchScope`: `'all'` → `{}`; scoped → `{ employee: {...} }`.
- **Attendance application:** a focused test (or extension of an existing attendance-lib test) asserting the live-board query receives a branch filter for a scoped actor and **no** filter for a global actor. If a full lib test is disproportionate (heavy prisma mocking), at minimum unit-test the `where`-builder seam by extracting the fragment composition so it's assertable without a DB.
- Full suite + `tsc --noEmit` clean; `next build` green.

## Files touched

| File | Change |
|------|--------|
| `src/lib/auth/branch-scope.ts` (new) | Foundation helpers |
| `src/lib/auth/branch-scope.test.ts` (new) | Pure tests |
| `src/lib/attendance/live.ts` | Filter live board by permitted branches |
| `src/app/(admin)/admin/attendance/page.tsx` | Filter list + dropdown + disputed count |
| `src/app/(admin)/admin/attendance/disputed/page.tsx` | Filter disputed list |
| `src/lib/attendance/manual.ts` | `{ branchId }` ctx on `attendance.manual-create` |
| `src/lib/attendance/admin-review.ts` | `{ branchId }` ctx on `attendance.dispute-resolve` |

## Open risks

- **`requirePermission` returns `{ user }` but not the assignments**, so `getPermittedBranches` does a second assignment load (one extra cheap query per page). Acceptable; a future optimization could return assignments from `requirePermission`. Not worth coupling now.
- **Multi-branch staff** (`assignedBranchIds`) must be matched with `hasSome` — a home-branch-only filter would wrongly hide rotating workers. Covered by a foundation test.
- **Empty permitted set:** a properly permission-gated page never reaches a query with `[]` (the gate `notFound()`s first), but `employeeBranchScope([])` returns a match-nothing fragment as defense-in-depth rather than silently returning all rows.
- **Counts/aggregates:** the disputed badge count must use the same fragment as the list, or the badge and list disagree. Called out in Unit 2.
