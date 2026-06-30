# Spec B3 — Branch-scope enforcement: leave inbox + mutations

**Status:** Approved design (2026-06-30)
**Program:** Branch-scoped administration. Prod has A, B1 (attendance, `2613b2d`), B2a (employees read + act-on, `d395bbc`), B2b (employee branch-setting, `f694d5b`). Built on current main `90edf53` (after the payroll/payslip + branch-letterhead drift, which did **not** touch the auth foundation or the leave surface). This is **B3** — applying the existing `branch-scope.ts` primitives to the `/admin/leave` surface.

## Problem

A branch-scoped admin (e.g. a role with `leave.read`/`leave.approve`/`leave.void` granted at one branch) currently sees and acts on leave requests **across all branches**:

- **Inbox read** (`leave/page.tsx`): gated `leave.read` (admission + authz) but the `LeaveRequest` query has **no branch filter** — a scoped admin reads every employee's leave (incl. the soft-deleted trash view).
- **approve / reject** (`lib/leave/admin.ts`): gated `leave.approve`, but **no branch check** — a scoped admin can approve/reject any employee's request.
- **on-behalf create** (`adminCreateLeaveRequest`): the picker on `leave/new` is **already** branch-filtered (B2a), but the server action validates only `leave.approve` — a forged POST with an out-of-scope `employeeId` succeeds. (Same picker-filtered-but-server-open gap B2b closed for employee create.)
- **void / restore** (`lib/leave/void.ts`): has a **partial** check — `requirePermission('leave.void', { branchId: row.employee.branchId })` gates on the employee's **home branch only**. For rotating staff (whose `assignedBranchIds` include branches beyond home), a scoped admin managing an *assigned* branch is wrongly blocked, and the mechanism diverges from the rest of the program. (This is the B1 rotating-staff asymmetry, still present here.)

## Goal (B3)

Every `/admin/leave` surface — inbox read (incl. trash), approve, reject, on-behalf create, void, restore — is scoped to the actor's permitted branches, matching an employee's full branch set (home `branchId` ∪ `assignedBranchIds`). **Invariant: zero change for global/Superadmin** (`getPermittedBranches → 'all'` ⇒ `{}` read filter and `canActOnEmployeeBranches → true`).

Reuses `src/lib/auth/branch-scope.ts` as-is. **No new helpers, no schema/migration.**

## Non-goals (explicit)

- **Dashboard & `/admin/calendar` leave widgets** (consumers of `lib/leave/team-calendar.ts` / `balance.ts`): deferred to **B6** (dashboard). The employee-edit `entitlements-section` balance is already scoped by B2a's employee-edit act-on gate, so it needs nothing here.
- **Worker-facing leave** (`lib/leave/actions.ts`: `submitLeaveRequest` / `cancelLeaveRequest`): self-service, scoped to the worker's own record — out of scope.
- No change to leave math (working-days, over-quota, balance, charged minutes), perms, or UI beyond what enforcement requires.

## Architecture

All four units use helpers that already exist in `src/lib/auth/branch-scope.ts`:
`getPermittedBranches(user, perm) → 'all' | string[]`, `viaEmployeeBranchScope(permitted)` (read fragment, `{}` for `'all'`), `canActOnEmployeeBranches(permitted, [home, ...assigned])` (write gate).

### Unit 1 — Inbox read filter (`leave/page.tsx`)

Capture the user (currently `await requirePermission('leave.read')` discards it) and intersect the query:

```ts
const { user } = await requirePermission('leave.read');
const permitted = await getPermittedBranches(user, 'leave.read');
const scope = viaEmployeeBranchScope(permitted); // {} for 'all'
```

Merge `scope.employee` into the existing `where` (which already may carry a status filter and/or a name-search `where.employee`):

```ts
if (scope.employee) {
  where.employee = where.employee ? { AND: [where.employee, scope.employee] } : scope.employee;
}
```

Apply the same to the **trash** read (the `prismaRaw.leaveRequest.findMany` + `count` for `deletedAt != null`) so soft-deleted leave is also branch-scoped:

```ts
const trashWhere: Prisma.LeaveRequestWhereInput = { deletedAt: { not: null } };
if (scope.employee) trashWhere.employee = scope.employee;
```

`count` already mirrors `findMany`'s `where` exactly — keep that.

### Unit 2 — approve / reject act-on gate (`lib/leave/admin.ts`)

`approveLeaveRequest` and `rejectLeaveRequest` already load the request inside their transaction/lookup. Ensure the loaded request's `employee` select includes `branchId` + `assignedBranchIds`, then gate **before** mutating:

```ts
const permitted = await getPermittedBranches(user, 'leave.approve');
if (!canActOnEmployeeBranches(permitted, [emp.branchId, ...emp.assignedBranchIds])) {
  notFound(); // matches B2a/B2b: hide existence, block before mutation
}
```

Place the gate after the request/employee is loaded but before any state change (status write, attendance-row expansion for approve).

### Unit 3 — on-behalf create server validation (`adminCreateLeaveRequest`)

The `leave/new` picker is already branch-filtered (B2a). Close the **server** gap (B2b-style): the action already loads the target employee — extend that select with `branchId` + `assignedBranchIds`, and after the existing not-found / archived checks, add:

```ts
const permitted = await getPermittedBranches(user, 'leave.approve');
if (!canActOnEmployeeBranches(permitted, [employee.branchId, ...employee.assignedBranchIds])) {
  return { ok: false, code: 'employee-not-found', message: 'ไม่พบพนักงาน' };
}
```

Reuse the existing `employee-not-found` result code (don't leak that the employee exists but is out of scope; the friendly Thai message is unchanged).

### Unit 4 — void / restore: fix partial scope (`lib/leave/void.ts`)

Replace the home-branch-only mechanism in both `voidLeaveRequest` and `restoreLeaveRequest`. The row lookup already selects `employee.branchId`; add `employee.assignedBranchIds`. Then:

```ts
const { user } = await requirePermission('leave.void'); // was: { branchId: row.employee.branchId }
const permitted = await getPermittedBranches(user, 'leave.void');
if (!canActOnEmployeeBranches(permitted, [row.employee.branchId, ...row.employee.assignedBranchIds])) {
  notFound();
}
```

This converges void/restore on the same primitive as the rest of the program and fixes the rotating-staff asymmetry (an assigned-branch match now authorizes correctly).

## Testing

New `src/lib/leave/leave-branch-enforcement.test.ts` (colocated with the mutations under test in `admin.ts` + `void.ts`), mocking only boundaries (`next/navigation`, `next/cache`, `next/headers`, audit, `@/lib/auth/check-permission`'s `requirePermission` + `getUserAssignments`, prisma, supabase/admin) and driving the **real** `getPermittedBranches` / `canActOnEmployeeBranches`. Mirrors `employees/employee-set.branch.test.ts`.

Cases:
- **approve / reject** — scoped actor, in-scope employee → mutates; out-of-scope → `notFound`, **no** status write / no attendance expansion; global actor → any.
- **void / restore** — same matrix; plus the **rotating-staff regression**: employee whose *home* branch is out of the actor's scope but an *assigned* branch is in scope → authorized (would have been blocked by the old home-only check).
- **adminCreateLeaveRequest** — out-of-scope employee → `employee-not-found`, no create; in-scope → creates; global → any.
- **Read filter (Unit 1):** covered by the existing `branch-scope.ts` helper tests for `viaEmployeeBranchScope` + the `AND`-merge asserted at the unit level where feasible; full page wiring is tsc/build/manual (consistent with the known read-filter test-harness gap, tracked separately — call it out, don't silently skip).
- Full suite + `tsc --noEmit` clean; `next build` green; page-gate guardrail still green (no new pages).

## Files touched

| File | Change |
|------|--------|
| `src/app/(admin)/admin/leave/page.tsx` | capture user; merge `viaEmployeeBranchScope` into live + trash `where` |
| `src/lib/leave/admin.ts` | `approveLeaveRequest` / `rejectLeaveRequest` act-on gate (+ employee branch select) |
| `src/lib/leave/admin.ts` | `adminCreateLeaveRequest` server-side act-on validation (+ employee branch select) |
| `src/lib/leave/void.ts` | `voidLeaveRequest` / `restoreLeaveRequest` → full `canActOnEmployeeBranches` (replace home-only) |
| `src/lib/leave/leave-branch-enforcement.test.ts` (new) | act-on + create-validation + rotating-staff regression tests |

## Open risks

- **Read-filter wiring lacks an integration harness** (pre-existing program gap): the page read-filter is verified by helper tests + tsc/build, not an end-to-end render test. Stated explicitly; not newly introduced by B3.
- **`notFound()` vs error-code divergence:** mutations that are server actions returning a result object (`adminCreateLeaveRequest`) use the existing result code; request lookups that already `notFound()` on missing rows (approve/reject/void) use `notFound()` for out-of-scope too. Both hide existence; the choice per call-site matches that site's existing missing-row behavior.
- **void mechanism change:** moving off `requirePermission(..., { branchId })` means the assignment-level branch check is no longer applied at the permission layer for void; the `canActOnEmployeeBranches` gate replaces it with the (broader, correct) home-∪-assigned semantics. Behavior strictly widens for legitimate rotating-staff cases and stays identical for home-branch and global actors.
- **Blast radius:** all prod admins are global assignments → enforcement is a no-op for them; only future branch-scoped leave roles are affected. Pure-code, fully reversible, no migration.
