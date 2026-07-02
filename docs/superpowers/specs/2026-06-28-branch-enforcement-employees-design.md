# Spec B2a — Branch-scope enforcement: Employees (read filtering + act-on gating)

**Status:** Approved design (2026-06-28)
**Program:** Branch-scoped administration. Spec A (create+landing) and Spec B1 (foundation + attendance) are in production (`2613b2d`). This is **B2a** — the Employees surface, READ filtering + act-on mutation gating. The thorny branch-**setting** half (create placement, edit `branchId`/`assignedBranchIds` rules, out-of-scope preservation, branch-picker filtering) is carved out to **B2b** (its own spec).

## Problem

Branch scope is enforced for attendance (B1) but not employees. The employees admin surface is fully global today:
- `employees/page.tsx` `findMany` has no branch filter (optional `?branchId=` is cosmetic UX); its branch-filter dropdown lists all branches.
- `employees/[id]/edit/page.tsx` loads any employee with no branch check.
- Mutation actions (`updateEmployee`/`archiveEmployee`/`deleteEmployee`/`unlinkLineFromEmployee` in `actions.ts`; `locale-actions.ts`; `entitlements-actions.ts`) gate on the permission only — no `{ branchId }` / branch check.
- The on-behalf employee pickers in `attendance/manual`, `advance/new`, `leave/new` load the full active roster.

## Goal (B2a)

1. **Read filtering** — scope the employees list (+ its branch dropdown), the edit-page access, and the on-behalf pickers to the actor's permitted branches.
2. **Act-on gating** — the employee mutation actions deny acting on an employee outside the actor's permitted branches.
3. **Invariant** — zero change for global/Superadmin admins (`getPermittedBranches → 'all'` → no filter / `canActOnEmployeeBranches → true`).

Reuses the shipped foundation `src/lib/auth/branch-scope.ts`: `getPermittedBranches(user, perm)`, `employeeBranchScope(permitted)` (Employee where-fragment, `{}` for `'all'`, matches home `branchId` ∪ `assignedBranchIds`), `canActOnEmployeeBranches(permitted, employeeBranchIds)`.

## Non-goals (explicit — deferred to B2b or later)

- **`createEmployee`** and the **create/edit branch *picker* + `branchId`/`assignedBranchIds` setting validation** (incl. preserving an edited employee's out-of-scope branches, home-branch reassignment rules). B2a gates *access to* the edit page and *acting on* the employee, but does NOT validate branch *changes* the form submits — that's B2b.
- `grantAdminAccess` stays Superadmin-only (about admin roles, not branch data) — unchanged.
- No schema/migration. No change to org-config or non-employee surfaces beyond the three named on-behalf pickers.

## Architecture

Same two mechanisms as B1, applied to the employees surface. `getPermittedBranches` is computed once per page/action from the authenticated user.

### Unit 1 — Read filtering

**`employees/page.tsx`:**
- After `requirePermission('employee.read')` (capture `user`), `const permitted = await getPermittedBranches(user, 'employee.read')`.
- Merge `employeeBranchScope(permitted)` into the list `where` (it already builds a `where` object; spread the fragment — it has an `OR` only when scoped, and the existing `where` has no top-level `OR`, so the spread is safe; if a pre-existing `OR` is ever added, wrap with `AND`).
- The branch-filter **dropdown**: when `permitted !== 'all'`, filter the `branch.findMany` to `{ id: { in: permitted } }` (so the actor only sees/selects their branches); `'all'` → unchanged.
- The total/count used for pagination must use the same `where` (it already derives from the same `where`).

**`employees/[id]/edit/page.tsx`:**
- The load already selects `branchId` + `assignedBranchIds`. After loading, gate: `if (!canActOnEmployeeBranches(await getPermittedBranches(user, 'employee.read'), [emp.branchId, ...emp.assignedBranchIds])) notFound()`. (Capture `user` from the page's `requirePermission('employee.read')`.)

**On-behalf pickers** — each scopes its `employee.findMany` by the FORM'S action permission:
- `attendance/manual/page.tsx` → `employeeBranchScope(getPermittedBranches(user, 'attendance.manual-create'))`
- `advance/new/page.tsx` → `…'advance.approve'`
- `leave/new/page.tsx` → `…'leave.approve'`
(Each page already calls `requirePermission(<that perm>)` — capture `user`, compute permitted, spread the fragment into the roster `where`.)

### Unit 2 — Act-on mutation gating

Each action loads the target employee's branch set (add `branchId` + `assignedBranchIds` to its `select` if missing) and gates BEFORE mutating, mirroring B1:
```ts
const { user } = await requirePermission('<perm>');
const emp = await prisma.employee.findUnique({ where: { id }, select: { …, branchId: true, assignedBranchIds: true } });
if (!emp) { /* existing not-found path */ }
if (!canActOnEmployeeBranches(await getPermittedBranches(user, '<perm>'), [emp.branchId, ...emp.assignedBranchIds])) notFound();
// … existing logic …
```
Actions:
- `updateEmployee` (`employee.update`) — `actions.ts`
- `archiveEmployee` (`employee.archive`) — `actions.ts`
- `deleteEmployee` (`employee.delete`) — `actions.ts` (keeps its existing related-records check)
- `unlinkLineFromEmployee` (`employee.line-unlink`) — `actions.ts`
- `locale-actions.ts` (`employee.update`)
- `entitlements-actions.ts` (`leave.entitlement.manage`)

Ordering: load employee → gate → mutate (no DB write before the gate). The not-found path uses each action's existing convention (typed result or `notFound()` as that action already does); the branch-deny uses `notFound()` (opaque), consistent with B1.

> **B2a boundary note (in code comment):** `updateEmployee` gates "can act on this employee" but does NOT yet validate the submitted `branchId`/`assignedBranchIds` changes — a scoped admin could still reassign branches; B2b adds that validation. Leave a `// Phase B2b:` comment where the branch-change validation will go.

## Testing

- **Act-on gating integration tests** (mirror B1's `*.branch.test.ts`): for `updateEmployee`, `archiveEmployee`, `deleteEmployee`, `unlinkLineFromEmployee` — out-of-branch employee → `notFound()` AND no mutation; rotating employee (home outside, assigned includes actor's branch) → gate passes; global actor → passes. Mock boundaries (auth `requirePermission`+`getUserAssignments`, prisma, next/navigation) as the existing tests do; drive the REAL `getPermittedBranches`/`canActOnEmployeeBranches`.
- The page-gate guardrail test already covers the employees pages (no new page added).
- Read-filter wiring (list/edit-page/pickers) verified by `tsc` + `next build` + manual smoke (consistent with B1's read-filter approach; the foundation fragments are unit-tested).
- Full suite + `tsc --noEmit` clean; `next build` green.

## Files touched

| File | Change |
|------|--------|
| `src/app/(admin)/admin/employees/page.tsx` | list `where` + branch dropdown scoped |
| `src/app/(admin)/admin/employees/[id]/edit/page.tsx` | act-on access gate (notFound if out of scope) |
| `src/app/(admin)/admin/employees/actions.ts` | act-on gate on update/archive/delete/line-unlink |
| `src/app/(admin)/admin/employees/[id]/edit/locale-actions.ts` | act-on gate |
| `src/app/(admin)/admin/employees/[id]/edit/entitlements-actions.ts` | act-on gate |
| `src/app/(admin)/admin/attendance/manual/page.tsx` | picker roster scoped (attendance.manual-create) |
| `src/app/(admin)/admin/advance/new/page.tsx` | picker roster scoped (advance.approve) |
| `src/app/(admin)/admin/leave/new/page.tsx` | picker roster scoped (leave.approve) |
| `src/lib/attendance/employees-*.branch.test.ts` (or co-located) | act-on gating integration tests |

## Open risks

- **B2a/B2b boundary leak:** B2a lets a scoped admin *act on* an in-scope employee but doesn't validate branch *reassignment* — so until B2b ships, a scoped admin editing an in-scope employee could move them to another branch. This is a known, time-boxed gap (writes are still act-on-gated; only the branch-change field is unvalidated). Document it; B2b closes it. It is not a *new* exposure vs today (today everything is global); B2a strictly tightens.
- **On-behalf picker permission choice:** each picker is scoped by the form's action permission, not `employee.read` — an actor with `leave.approve` scoped to A sees only A's employees in the leave-on-behalf picker. Intentional.
- **Count/dropdown consistency:** the list count and the records must use the same `where`; the dropdown filters independently to permitted branches. Called out in Unit 1.
