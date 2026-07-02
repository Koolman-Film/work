# Branch Enforcement: Employees — read + act-on (Spec B2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope the Employees admin surface to the actor's permitted branches — list/edit-page/on-behalf-pickers filtered, and mutation actions gated so a scoped admin can only act on employees they manage. Global/Superadmin unchanged.

**Architecture:** Reuse the shipped `src/lib/auth/branch-scope.ts` foundation. Reads merge `employeeBranchScope(getPermittedBranches(user, perm))` into existing `where` clauses; mutations load the employee's branch set and gate with `canActOnEmployeeBranches(...)` → `notFound()` before mutating (the B1 pattern). No new foundation code.

**Tech Stack:** Next.js (Server Components + Server Actions), Prisma, Vitest, Biome.

## Global Constraints

- **Test:** `npx vitest run <path>`. Typecheck: `npx tsc --noEmit`. Build: `npx next build`. All clean before a task is done.
- **Invariant — zero change for global/Superadmin:** they hold the permission globally → `getPermittedBranches → 'all'` → `employeeBranchScope` returns `{}` and `canActOnEmployeeBranches` returns `true`. Verify per task.
- **No schema/migration. No DB write-shape change** — reads gain a filter; actions gain an authz check before the existing mutation.
- **Multi-branch staff:** gate against `[emp.branchId, ...emp.assignedBranchIds]` (the foundation handles overlap + `hasSome`).
- **Branch-deny is opaque:** use `notFound()` (matches B1).
- **B2a boundary (do NOT exceed):** do NOT touch `createEmployee`, the create/edit branch *picker* options, or validate submitted `branchId`/`assignedBranchIds` *changes* — that's B2b. Leave a `// Phase B2b:` marker in `updateEmployee` where branch-change validation will go.
- **OR-merge caution:** `employeeBranchScope` returns `{ OR: [...] }` when scoped — only spread into a `where` with no pre-existing top-level `OR`; else wrap with `AND`.
- Biome runs on the pre-commit hook (ordered imports).

---

## File Structure

| File | Change |
|------|--------|
| `src/app/(admin)/admin/employees/page.tsx` | list `where` + branch dropdown scoped |
| `src/app/(admin)/admin/employees/[id]/edit/page.tsx` | act-on access gate |
| `src/app/(admin)/admin/employees/actions.ts` | act-on gate on update/archive/delete/line-unlink |
| `src/app/(admin)/admin/employees/[id]/edit/locale-actions.ts` | act-on gate |
| `src/app/(admin)/admin/employees/[id]/edit/entitlements-actions.ts` | act-on gate |
| `src/app/(admin)/admin/employees/employee-gates.branch.test.ts` (new) | act-on gating integration tests |
| `src/app/(admin)/admin/attendance/manual/page.tsx` | picker roster scoped |
| `src/app/(admin)/admin/advance/new/page.tsx` | picker roster scoped |
| `src/app/(admin)/admin/leave/new/page.tsx` | picker roster scoped |

---

### Task 1: Employees list + edit-page read filtering

**Files:**
- Modify: `src/app/(admin)/admin/employees/page.tsx`, `src/app/(admin)/admin/employees/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `getPermittedBranches`, `employeeBranchScope`, `canActOnEmployeeBranches` from `@/lib/auth/branch-scope`; `notFound` from `next/navigation`.

- [ ] **Step 1: Scope the list page**

In `employees/page.tsx`: capture `user`, compute permitted branches, fold the fragment into the list `where`, and filter the branch dropdown.

```tsx
import { employeeBranchScope, getPermittedBranches } from '@/lib/auth/branch-scope';
// ...
const { user } = await requirePermission('employee.read');
const permitted = await getPermittedBranches(user, 'employee.read');
// existing: const where: Prisma.EmployeeWhereInput = { ...statusWhere(status) };
//           if (branchId) where.branchId = branchId;  if (departmentId) where.departmentId = departmentId;
Object.assign(where, employeeBranchScope(permitted));
// branch dropdown — only the actor's branches when scoped:
prisma.branch.findMany({
  where: { archivedAt: null, ...(permitted === 'all' ? {} : { id: { in: permitted } }) },
  orderBy: { name: 'asc' },
  select: { id: true, name: true },
}),
```
Note: `Object.assign(where, employeeBranchScope(permitted))` adds nothing for `'all'` (`{}`), and adds the `OR` for scoped (the `where` has no pre-existing top-level `OR`). The existing `?branchId=` UX filter still applies within the permitted set (it's a separate `branchId` equality the scoped `OR` AND-combines with). The pagination total already derives from this `where`.

- [ ] **Step 2: Gate the edit/detail page**

In `employees/[id]/edit/page.tsx` (the load already selects `branchId` + `assignedBranchIds`):

```tsx
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { notFound } from 'next/navigation';
// ...
const { user } = await requirePermission('employee.read');
// ... existing emp = await prisma.employee.findUnique({ where: { id }, select: { ... branchId, assignedBranchIds ... } });
// (existing not-found handling stays)
if (!canActOnEmployeeBranches(await getPermittedBranches(user, 'employee.read'), [emp.branchId, ...emp.assignedBranchIds])) {
  notFound();
}
```
Place the gate immediately after the existing `emp` load + its not-found check.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` → clean. Run: `npx next build` → succeeds (`/admin/employees`, `/admin/employees/[id]/edit` compile).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/employees/page.tsx" "src/app/(admin)/admin/employees/[id]/edit/page.tsx"
git commit -m "feat(employees): scope list + branch dropdown + edit-page access to permitted branches"
```

---

### Task 2: Employee mutation act-on gating (actions.ts)

**Files:**
- Modify: `src/app/(admin)/admin/employees/actions.ts`
- Create: `src/app/(admin)/admin/employees/employee-gates.branch.test.ts`

**Interfaces:**
- Consumes: `canActOnEmployeeBranches`, `getPermittedBranches`; `notFound` from `next/navigation`.

- [ ] **Step 1: Write the failing integration test (one scaffold, four actions)**

```ts
// src/app/(admin)/admin/employees/employee-gates.branch.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND'); },
  redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn() }));

const requirePermission = vi.fn();
const getUserAssignments = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
  canDo: vi.fn(),
}));

const empFindUnique = vi.fn();
const empUpdate = vi.fn();
const transactionFn = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: { findUnique: (...a: unknown[]) => empFindUnique(...a), update: (...a: unknown[]) => empUpdate(...a) },
    $transaction: (...a: unknown[]) => transactionFn(...a),
  },
}));

import { archiveEmployee } from './actions';

const scoped = (branchId: string) => [{ branchId, role: { permissions: ['employee.archive'], isSuperadmin: false, archivedAt: null } }];
const global = () => [{ branchId: null, role: { permissions: ['employee.archive'], isSuperadmin: false, archivedAt: null } }];

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { id: 'actor' } });
  transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({ employee: { update: (...a: unknown[]) => empUpdate(...a) } }),
  );
  empUpdate.mockResolvedValue({});
});

describe('archiveEmployee — branch act-on gate', () => {
  it('denies a scoped actor (A) acting on an employee home=B assigned=[] — no mutation', async () => {
    getUserAssignments.mockResolvedValue(scoped('branch-A'));
    empFindUnique.mockResolvedValue({ id: 'e1', archivedAt: null, branchId: 'branch-B', assignedBranchIds: [] });
    await expect(archiveEmployee('e1')).rejects.toThrow('NOT_FOUND');
    expect(empUpdate).not.toHaveBeenCalled();
    expect(transactionFn).not.toHaveBeenCalled();
  });
  it('allows a scoped actor (A) on a rotating employee home=B assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scoped('branch-A'));
    empFindUnique.mockResolvedValue({ id: 'e1', archivedAt: null, branchId: 'branch-B', assignedBranchIds: ['branch-A'] });
    await archiveEmployee('e1').catch(() => {});
    // gate passed → the action proceeded to its mutation path
    expect(empUpdate).toHaveBeenCalled();
  });
  it('allows a global actor on any employee', async () => {
    getUserAssignments.mockResolvedValue(global());
    empFindUnique.mockResolvedValue({ id: 'e1', archivedAt: null, branchId: 'branch-Z', assignedBranchIds: [] });
    await archiveEmployee('e1').catch(() => {});
    expect(empUpdate).toHaveBeenCalled();
  });
});
```
(If `archiveEmployee` archives via `employee.update` directly rather than a transaction, the allow assertion `empUpdate.toHaveBeenCalled()` still holds; adjust the tx stub only if the real action uses `$transaction`. Read the action to confirm which mutation it calls and assert that one.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "src/app/(admin)/admin/employees/employee-gates.branch.test.ts"`
Expected: FAIL — `archiveEmployee` has no branch gate yet (denial test's `NOT_FOUND` not thrown).

- [ ] **Step 3: Add the act-on gate to each mutation**

For each action, after loading the employee (and before any mutation), insert the gate. Add `branchId`/`assignedBranchIds` to the `select` where the load uses a narrow select.

`updateEmployee` (loads `before = prisma.employee.findUnique({ where: { id } })` — full row, has the fields):
```ts
const before = await prisma.employee.findUnique({ where: { id } });
if (!before) redirect('/admin/employees');
if (!canActOnEmployeeBranches(await getPermittedBranches(user, 'employee.update'), [before.branchId, ...before.assignedBranchIds])) {
  notFound();
}
// Phase B2b: validate the SUBMITTED data.branchId / assignedBranchIds against permitted branches here.
```

`archiveEmployee` (loads `before = prisma.employee.findUnique({ where: { id } })` — full row):
```ts
if (!before) redirect('/admin/employees');
if (!canActOnEmployeeBranches(await getPermittedBranches(user, 'employee.archive'), [before.branchId, ...before.assignedBranchIds])) {
  notFound();
}
```

`deleteEmployee` (loads `emp = findUnique({ where: { id }, select: {...} })` — ADD `branchId: true, assignedBranchIds: true` to that select):
```ts
if (!emp) redirect('/admin/employees');
if (!canActOnEmployeeBranches(await getPermittedBranches(user, 'employee.delete'), [emp.branchId, ...emp.assignedBranchIds])) {
  notFound();
}
```

`unlinkLineFromEmployee` (loads `emp = findUnique({ where: { id }, select: {...} })` — ADD `branchId: true, assignedBranchIds: true`):
```ts
if (!emp) redirect('/admin/employees');
if (!canActOnEmployeeBranches(await getPermittedBranches(actor, 'employee.line-unlink'), [emp.branchId, ...emp.assignedBranchIds])) {
  notFound();
}
```
(Use the existing variable name for the loaded employee + the existing not-found redirect in each action; only ADD the gate line and any missing select fields. Add imports: `canActOnEmployeeBranches`, `getPermittedBranches` from `@/lib/auth/branch-scope`; ensure `notFound` is imported from `next/navigation`.)

- [ ] **Step 4: Run the test + extend to the other three actions**

Extend `employee-gates.branch.test.ts` with analogous deny/allow/global cases for `updateEmployee` (mutation mock `empUpdate`), `deleteEmployee` (mock `employee.delete` → add `empDelete = vi.fn()` to the prisma mock; the action also reads `_count` — stub it on the returned row), and `unlinkLineFromEmployee` (it touches supabase admin + user update — mock `@/lib/supabase/admin` like B1's team test; assert the gate denies before those). For deny cases assert the mutation is NOT called; for allow assert the gate is passed (mutation/au reached).

Run: `npx vitest run "src/app/(admin)/admin/employees/employee-gates.branch.test.ts"`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.
```bash
git add "src/app/(admin)/admin/employees/actions.ts" "src/app/(admin)/admin/employees/employee-gates.branch.test.ts"
git commit -m "feat(employees): branch act-on gate on update/archive/delete/line-unlink"
```

---

### Task 3: Sub-action act-on gating (locale + entitlements)

**Files:**
- Modify: `src/app/(admin)/admin/employees/[id]/edit/locale-actions.ts`, `src/app/(admin)/admin/employees/[id]/edit/entitlements-actions.ts`

**Interfaces:**
- Consumes: `canActOnEmployeeBranches`, `getPermittedBranches`; `notFound`.

- [ ] **Step 1: Gate `locale-actions.ts`**

It gates `requirePermission('employee.update')` then loads the employee. Add `branchId`/`assignedBranchIds` to that load's select (or load them) and gate:
```ts
const { user } = await requirePermission('employee.update');
const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, branchId: true, assignedBranchIds: true, /* existing fields */ } });
if (!emp) { /* existing not-found path */ }
if (!canActOnEmployeeBranches(await getPermittedBranches(user, 'employee.update'), [emp.branchId, ...emp.assignedBranchIds])) {
  notFound();
}
```

- [ ] **Step 2: Gate `entitlements-actions.ts`**

It gates `requirePermission('leave.entitlement.manage')`. Load the target employee's branch set (by the form's `employeeId`) before the upsert and gate:
```ts
const { user } = await requirePermission('leave.entitlement.manage');
const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, branchId: true, assignedBranchIds: true } });
if (!emp) { /* existing not-found / redirect path */ }
if (!canActOnEmployeeBranches(await getPermittedBranches(user, 'leave.entitlement.manage'), [emp.branchId, ...emp.assignedBranchIds])) {
  notFound();
}
// ... existing entitlement upsert ...
```
(Read each file first; reuse its existing employee-id source + not-found convention. Add the branch-scope + notFound imports.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` → clean. Run: `npx next build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/employees/[id]/edit/locale-actions.ts" "src/app/(admin)/admin/employees/[id]/edit/entitlements-actions.ts"
git commit -m "feat(employees): branch act-on gate on locale + entitlements sub-actions"
```

---

### Task 4: On-behalf employee pickers

**Files:**
- Modify: `src/app/(admin)/admin/attendance/manual/page.tsx`, `src/app/(admin)/admin/advance/new/page.tsx`, `src/app/(admin)/admin/leave/new/page.tsx`

**Interfaces:**
- Consumes: `getPermittedBranches`, `employeeBranchScope`.

- [ ] **Step 1: Scope each picker roster by its form's action permission**

Each page already calls `requirePermission(<perm>)` and runs `prisma.employee.findMany({ where: { archivedAt: null, status: { not: 'Archived' } } })`. Capture `user`, compute permitted for that perm, spread the fragment:

- `attendance/manual/page.tsx` (`attendance.manual-create`):
```tsx
const { user } = await requirePermission('attendance.manual-create');
const permitted = await getPermittedBranches(user, 'attendance.manual-create');
prisma.employee.findMany({ where: { archivedAt: null, status: { not: 'Archived' }, ...employeeBranchScope(permitted) }, /* unchanged */ });
```
- `advance/new/page.tsx` (`advance.approve`): same shape with `'advance.approve'`.
- `leave/new/page.tsx` (`leave.approve`): same shape with `'leave.approve'`.

Add `import { employeeBranchScope, getPermittedBranches } from '@/lib/auth/branch-scope';` to each. Keep each query's `select`/`orderBy` verbatim. The roster `where` has no pre-existing `OR`, so the spread is safe.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` → clean. Run: `npx next build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/attendance/manual/page.tsx" "src/app/(admin)/admin/advance/new/page.tsx" "src/app/(admin)/admin/leave/new/page.tsx"
git commit -m "feat(employees): scope on-behalf employee pickers to the form's permitted branches"
```

---

### Task 5: Full verification

**Files:** none.

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npx vitest run` → all green. Run: `npx tsc --noEmit` → clean. Run: `npx next build` → succeeds.

- [ ] **Step 2: Confirm the invariant + boundary in code**

Re-read the diff: every read fragment is `{}` for `'all'`; every mutation gate is `canActOnEmployeeBranches(...)` returning `true` for `'all'`; the `// Phase B2b:` marker is present in `updateEmployee`; `createEmployee` and the form pickers are untouched.

- [ ] **Step 3: Commit any verification fixes (only if needed)**

```bash
git add -A && git commit -m "test: verify employees branch read + act-on enforcement"
```

---

## Self-Review

**Spec coverage:**
- List + branch dropdown scoped → Task 1. ✓
- Edit-page access gate → Task 1. ✓
- update/archive/delete/line-unlink act-on gate → Task 2. ✓
- locale + entitlements sub-actions act-on gate → Task 3. ✓
- On-behalf pickers scoped by form permission → Task 4. ✓
- Invariant (global/Superadmin unchanged) → Global Constraints + Task 5 Step 2. ✓
- B2a boundary (no create / no branch-setting validation) → Global Constraints + `// Phase B2b:` marker (Task 2) + Task 5 Step 2. ✓
- Act-on integration tests (deny+no-mutation, rotating allow, global allow) → Task 2 (+ Task 3 best-effort via the same pattern). ✓

**Placeholder scan:** Tasks 2/3 say "read each file first; reuse its existing not-found convention / employee-id source" — this is necessary adaptation to per-action structure, not a placeholder: the exact gate line + imports + which fields to add are fully specified; only the surrounding variable name differs per action. The integration-test scaffold is concrete for `archiveEmployee`; extending to the other three is the same pattern with named mocks.

**Type consistency:** `getPermittedBranches(user, perm): Promise<'all' | string[]>` → consumed by `employeeBranchScope` (read fragments, `Prisma.EmployeeWhereInput`) and `canActOnEmployeeBranches(permitted, string[])` (gates). Employee branch set is always `[emp.branchId, ...emp.assignedBranchIds]`. `notFound()` for deny throughout. Consistent across tasks.
