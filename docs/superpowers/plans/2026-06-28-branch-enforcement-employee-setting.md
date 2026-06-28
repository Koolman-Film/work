# Branch Enforcement: Employee create placement + edit branch-setting (Spec B2b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A branch-scoped admin can only place a new employee in branches they manage (create), and cannot reassign branch membership on edit (read-only; global/Superadmin only). Global/Superadmin unchanged.

**Architecture:** Add a subset helper `canSetEmployeeBranches`. Create: filter the picker to permitted + validate the submitted set ⊆ permitted server-side. Edit: render branch fields read-only for scoped admins (disabled display + hidden inputs carrying current values so the required field still submits) AND, authoritatively, `updateEmployee` preserves the employee's existing branches for any non-global actor.

**Tech Stack:** Next.js (Server Components + Server Actions), Prisma, Vitest, Biome.

## Global Constraints

- **Test:** `npx vitest run <path>`. Typecheck: `npx tsc --noEmit`. Build: `npx next build`. All clean before a task is done.
- **Invariant — zero change for global/Superadmin:** `getPermittedBranches → 'all'` → create allows any branch, edit applies submitted branch changes, picker shows all branches. Verify per task.
- **No schema/migration.**
- **Server is authoritative:** the read-only edit UI is UX; `updateEmployee` preserving existing branches for non-global actors is the real guard (defends a forged POST). `createEmployee` validates server-side even though the picker is filtered.
- **Required-field gotcha:** `branchId` is required by `readForm`. The read-only edit form MUST still submit the employee's current `branchId`/`assignedBranchIds` (via hidden inputs) so validation passes; disabled inputs alone would drop the field.
- **Out of scope:** the pre-existing `updateEmployee` staff-`UserRoleAssignment` resync drift (tracked as a separate task) — do NOT address it here.
- Biome runs on the pre-commit hook (ordered imports).

---

## File Structure

| File | Change |
|------|--------|
| `src/lib/auth/branch-scope.ts` | add `canSetEmployeeBranches` (subset) |
| `src/lib/auth/branch-scope.test.ts` | tests for it |
| `src/app/(admin)/admin/employees/new/page.tsx` | filter picker branches to permitted |
| `src/app/(admin)/admin/employees/actions.ts` | `createEmployee` subset validation; `updateEmployee` preserve-existing-branches for scoped actors |
| `src/app/(admin)/admin/employees/[id]/edit/page.tsx` | compute + pass `branchReadOnly` |
| `src/app/(admin)/admin/employees/employee-form.tsx` | `branchReadOnly` prop: disabled fields + hidden current-value inputs |
| `src/app/(admin)/admin/employees/employee-set.branch.test.ts` (new) | create + update branch-setting integration tests |

---

### Task 1: Foundation — `canSetEmployeeBranches`

**Files:**
- Modify: `src/lib/auth/branch-scope.ts`, `src/lib/auth/branch-scope.test.ts`

**Interfaces:**
- Produces: `export function canSetEmployeeBranches(permitted: PermittedBranches, branchIds: ReadonlyArray<string>): boolean;`

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/lib/auth/branch-scope.test.ts
import { canSetEmployeeBranches } from './branch-scope';

describe('canSetEmployeeBranches (subset)', () => {
  it("'all' allows any set (incl. empty)", () => {
    expect(canSetEmployeeBranches('all', ['b1', 'b2'])).toBe(true);
    expect(canSetEmployeeBranches('all', [])).toBe(true);
  });
  it('true only when every chosen branch is permitted', () => {
    expect(canSetEmployeeBranches(['b1', 'b2'], ['b1'])).toBe(true);
    expect(canSetEmployeeBranches(['b1', 'b2'], ['b1', 'b2'])).toBe(true);
  });
  it('false when any chosen branch is not permitted', () => {
    expect(canSetEmployeeBranches(['b1'], ['b1', 'b2'])).toBe(false);
    expect(canSetEmployeeBranches([], ['b1'])).toBe(false);
  });
  it('empty chosen set is vacuously true', () => {
    expect(canSetEmployeeBranches(['b1'], [])).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/auth/branch-scope.test.ts`
Expected: FAIL — `canSetEmployeeBranches` not exported.

- [ ] **Step 3: Implement**

```ts
// add to src/lib/auth/branch-scope.ts
/**
 * SUBSET check — may an actor with `permitted` branches SET an employee's
 * branch membership to exactly `branchIds`? 'all' ⇒ yes; otherwise every
 * chosen branch must be permitted. (Contrast canActOnEmployeeBranches, which
 * is overlap/act-on. SETTING requires the stricter subset.)
 */
export function canSetEmployeeBranches(
  permitted: PermittedBranches,
  branchIds: ReadonlyArray<string>,
): boolean {
  if (permitted === 'all') return true;
  return branchIds.every((b) => permitted.includes(b));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/auth/branch-scope.test.ts`
Expected: PASS. Then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/branch-scope.ts src/lib/auth/branch-scope.test.ts
git commit -m "feat(auth): canSetEmployeeBranches (subset check for branch placement)"
```

---

### Task 2: Create — scoped branch placement

**Files:**
- Modify: `src/app/(admin)/admin/employees/new/page.tsx`, `src/app/(admin)/admin/employees/actions.ts`
- Create/extend test: `src/app/(admin)/admin/employees/employee-set.branch.test.ts`

**Interfaces:**
- Consumes: `getPermittedBranches`, `canSetEmployeeBranches` (Task 1).

- [ ] **Step 1: Filter the create picker (`new/page.tsx`)**

```tsx
import { getPermittedBranches } from '@/lib/auth/branch-scope';
// ...
const { user } = await requirePermission('employee.create');
const { error } = await searchParams;
const options = await loadEmployeeFormOptions();
const permitted = await getPermittedBranches(user, 'employee.create');
if (permitted !== 'all') {
  options.branches = options.branches.filter((b) => permitted.includes(b.id));
}
// existing "no branches" guard runs AFTER filtering (a scoped admin with zero
// permitted branches correctly sees the no-branches message).
```

- [ ] **Step 2: Validate in `createEmployee` (failing test first)**

Add to `employee-set.branch.test.ts` (mirror the scaffold in `employee-gates.branch.test.ts` — mock `next/navigation` redirect→throw `REDIRECT:`, `next/cache`, `next/headers`, `@/lib/audit/log`, `@/lib/auth/check-permission` `requirePermission`+`getUserAssignments`, `@/lib/db/prisma` incl. `$transaction`, `roleDefinition.findUnique`, `user.create`, `employee.create`, `userRoleAssignment.createMany`, and `@/lib/supabase/admin` if create touches it):

```ts
import { createEmployee } from './actions';
// helper to build FormData for a create with given branches:
function createFd(branchId: string, assigned: string[]) {
  const f = new FormData();
  f.set('firstName', 'A'); f.set('lastName', 'B'); f.set('nickname', '');
  f.set('branchId', branchId);
  for (const b of assigned) f.append('assignedBranchIds', b);
  f.set('salaryType', 'Monthly'); f.set('baseSalary', '10000'); f.set('status', 'Active');
  // ...any other required fields readForm needs — read employee-schema to complete...
  return f;
}

describe('createEmployee — branch placement (subset)', () => {
  it('scoped actor (A) creating in branch B is rejected, no employee created', async () => {
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    getUserAssignments.mockResolvedValue([{ branchId: 'branch-A', role: { permissions: ['employee.create'], isSuperadmin: false, archivedAt: null } }]);
    await expect(createEmployee(createFd('branch-B', ['branch-B']))).rejects.toThrow(/REDIRECT:.*error=/);
    expect(employeeCreate).not.toHaveBeenCalled();
  });
  it('scoped actor (A) creating in branch A succeeds (reaches create)', async () => {
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    getUserAssignments.mockResolvedValue([{ branchId: 'branch-A', role: { permissions: ['employee.create'], isSuperadmin: false, archivedAt: null } }]);
    await createEmployee(createFd('branch-A', ['branch-A'])).catch(() => {});
    expect(employeeCreate).toHaveBeenCalled();
  });
  it('global actor can create in any branch', async () => {
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    getUserAssignments.mockResolvedValue([{ branchId: null, role: { permissions: ['employee.create'], isSuperadmin: false, archivedAt: null } }]);
    await createEmployee(createFd('branch-Z', ['branch-Z'])).catch(() => {});
    expect(employeeCreate).toHaveBeenCalled();
  });
});
```
(Complete `createFd` with every field `readForm`/`employee-schema` marks required so the parse succeeds — read `employee-schema.ts`. The create path runs inside `prisma.$transaction`; mock it to invoke the callback with a tx stub exposing `roleDefinition.findUnique`, `user.create`, `employee.create` (→ `employeeCreate` mock), `userRoleAssignment.createMany`.)

Run it: `npx vitest run "src/app/(admin)/admin/employees/employee-set.branch.test.ts"` → FAIL (no validation yet; deny test doesn't redirect).

- [ ] **Step 3: Add the validation to `createEmployee`**

After `const assignedBranchIds = normalizeAssigned(data.branchId, data.assignedBranchIds);`:
```ts
import { canSetEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
// ...
const permitted = await getPermittedBranches(user, 'employee.create');
if (!canSetEmployeeBranches(permitted, assignedBranchIds)) {
  redirect(
    `/admin/employees/new?error=${encodeURIComponent('ไม่มีสิทธิ์สร้างพนักงานในสาขาที่เลือก')}`,
  );
}
```
(`assignedBranchIds` already includes home via `normalizeAssigned`, covering both.)

- [ ] **Step 4: Run + typecheck**

Run: `npx vitest run "src/app/(admin)/admin/employees/employee-set.branch.test.ts"` → PASS. `npx tsc --noEmit` → clean. `npx next build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/employees/new/page.tsx" "src/app/(admin)/admin/employees/actions.ts" "src/app/(admin)/admin/employees/employee-set.branch.test.ts"
git commit -m "feat(employees): scoped create — picker filtered + chosen branches must be permitted"
```

---

### Task 3: Edit — branch reassignment is global-only

**Files:**
- Modify: `src/app/(admin)/admin/employees/employee-form.tsx`, `src/app/(admin)/admin/employees/[id]/edit/page.tsx`, `src/app/(admin)/admin/employees/actions.ts`
- Extend test: `src/app/(admin)/admin/employees/employee-set.branch.test.ts`

**Interfaces:**
- Consumes: `getPermittedBranches` (Task 1 module).
- Produces: `EmployeeForm` gains optional prop `branchReadOnly?: boolean` (default false).

- [ ] **Step 1: `employee-form.tsx` — read-only branch fields that still submit**

Add `branchReadOnly?: boolean` to the form's props (default `false`). In the branch section:
- Home `<select id="branchId" name="branchId">`: add `disabled={branchReadOnly}`. Immediately after it, when `branchReadOnly`, render a hidden input so the required value still submits:
```tsx
{branchReadOnly && <input type="hidden" name="branchId" value={initial?.branchId ?? ''} />}
```
- `assignedBranchIds` checkboxes: add `disabled={branchReadOnly}` to each checkbox `<input>`. After the checkbox list, when `branchReadOnly`, emit a hidden input for each currently-assigned branch:
```tsx
{branchReadOnly &&
  (initial?.assignedBranchIds ?? []).map((bid) => (
    <input key={`hidden-${bid}`} type="hidden" name="assignedBranchIds" value={bid} />
  ))}
```
- Optional UX hint near the branch field when `branchReadOnly`: `<p className="text-xs text-ink-4">การย้ายสาขาต้องให้ Superadmin ดำเนินการ</p>` (only render when `branchReadOnly`).

(Disabled inputs don't submit; the hidden inputs carry the current values so `readForm` validation passes. The server still preserves authoritatively in Step 3.)

- [ ] **Step 2: `[id]/edit/page.tsx` — compute and pass `branchReadOnly`**

The page already captures `user` and gates with `requirePermission('employee.read')`. Add:
```tsx
import { getPermittedBranches } from '@/lib/auth/branch-scope';
// ...
const branchReadOnly = (await getPermittedBranches(user, 'employee.update')) !== 'all';
// ...
<EmployeeForm mode="edit" action={updateEmployeeBound} options={options} initial={...} branchReadOnly={branchReadOnly} error={...} />
```
(Keep `options.branches` = all branches on the edit page so a scoped admin's disabled select can display the employee's current branch name even if out-of-scope. Disabled fields can't change/submit, so this is display-only — no leak.)

- [ ] **Step 3: `updateEmployee` — preserve existing branches for non-global actors (the real guard)**

Replace the `// Phase B2b:` marker. Hoist the permitted lookup (currently inline in the act-on gate) so it's reused:
```ts
const before = await prisma.employee.findUnique({ where: { id } });
if (!before) redirect('/admin/employees');
const permitted = await getPermittedBranches(user, 'employee.update');
if (!canActOnEmployeeBranches(permitted, [before.branchId, ...before.assignedBranchIds])) {
  notFound();
}
// Branch reassignment is global-only: scoped actors keep the employee's
// existing branch membership regardless of what the form submitted.
const nextBranchId = permitted === 'all' ? data.branchId : before.branchId;
const nextAssignedBranchIds =
  permitted === 'all' ? assignedBranchIds : before.assignedBranchIds;
```
Then in the `prisma.employee.update` `data`, use `branchId: nextBranchId` and `assignedBranchIds: nextAssignedBranchIds` (replacing `data.branchId` / `assignedBranchIds`).

- [ ] **Step 4: Extend the test with update cases (failing first if added before Step 3)**

Add to `employee-set.branch.test.ts`:
```ts
import { updateEmployee } from './actions';
function editFd(branchId: string, assigned: string[]) {
  const f = createFd(branchId, assigned); // reuse; createFd builds all required fields
  return f;
}
describe('updateEmployee — branch reassignment is global-only', () => {
  it('scoped actor cannot change branches: update persists EXISTING branches', async () => {
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    getUserAssignments.mockResolvedValue([{ branchId: 'branch-A', role: { permissions: ['employee.update'], isSuperadmin: false, archivedAt: null } }]);
    employeeFindUnique.mockResolvedValue({ id: 'e1', branchId: 'branch-A', assignedBranchIds: ['branch-A'] /* + other fields update reads */ });
    await updateEmployee('e1', editFd('branch-B', ['branch-B'])).catch(() => {});
    expect(employeeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ branchId: 'branch-A', assignedBranchIds: ['branch-A'] }),
    }));
  });
  it('global actor can change branches: submitted values applied', async () => {
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    getUserAssignments.mockResolvedValue([{ branchId: null, role: { permissions: ['employee.update'], isSuperadmin: false, archivedAt: null } }]);
    employeeFindUnique.mockResolvedValue({ id: 'e1', branchId: 'branch-A', assignedBranchIds: ['branch-A'] });
    await updateEmployee('e1', editFd('branch-B', ['branch-B'])).catch(() => {});
    expect(employeeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ branchId: 'branch-B' }),
    }));
  });
});
```
(`employeeFindUnique` must return all fields `updateEmployee` reads from `before`; `employeeUpdate` is the `prisma.employee.update` mock. The scoped case proves the submitted branch-B is IGNORED and branch-A persists.)

Run: `npx vitest run "src/app/(admin)/admin/employees/employee-set.branch.test.ts"` → PASS.

- [ ] **Step 5: Typecheck + build + commit**

Run: `npx tsc --noEmit` → clean. `npx next build` → succeeds.
```bash
git add "src/app/(admin)/admin/employees/employee-form.tsx" "src/app/(admin)/admin/employees/[id]/edit/page.tsx" "src/app/(admin)/admin/employees/actions.ts" "src/app/(admin)/admin/employees/employee-set.branch.test.ts"
git commit -m "feat(employees): edit branch reassignment is global-only (read-only UI + server preserve)"
```

---

### Task 4: Full verification

**Files:** none.

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npx vitest run` → all green. `npx tsc --noEmit` → clean. `npx next build` → succeeds.

- [ ] **Step 2: Confirm invariant + boundary in code**

Re-read the diff: `'all'` actors are unaffected (create allows any branch; `updateEmployee` uses `data.branchId`; picker unfiltered). Scoped create is subset-validated server-side; scoped update preserves `before` branches. The staff-assignment resync drift was NOT touched. `branchReadOnly` form still submits valid current values via hidden inputs.

- [ ] **Step 3: Commit any verification fixes (only if needed)**

```bash
git add -A && git commit -m "test: verify employee branch-setting enforcement"
```

---

## Self-Review

**Spec coverage:**
- `canSetEmployeeBranches` subset helper → Task 1. ✓
- Create picker filtered + `createEmployee` subset validation → Task 2. ✓
- Edit branch fields read-only (form) + `branchReadOnly` from page → Task 3 Steps 1-2. ✓
- `updateEmployee` preserves existing branches for non-global (the authoritative guard) → Task 3 Step 3. ✓
- Required-field gotcha (hidden inputs so read-only form still submits) → Task 3 Step 1 + Global Constraints. ✓
- Invariant (global/Superadmin unchanged) → Task 4 Step 2 + per-task. ✓
- Drift out of scope → Global Constraints + Task 4 Step 2. ✓
- Tests: helper unit; create deny/allow/global; update scoped-ignored/global-applied → Tasks 1-3. ✓

**Placeholder scan:** Task 2's `createFd` says "complete with every required field — read employee-schema.ts" — that's necessary adaptation to the real schema, not a placeholder (the test's assertions + structure are fully specified; only the exhaustive required-field list must be filled from the schema). No TBDs elsewhere.

**Type consistency:** `canSetEmployeeBranches(PermittedBranches, ReadonlyArray<string>): boolean` (Task 1) consumed by `createEmployee` (Task 2). `getPermittedBranches(user, perm): Promise<'all'|string[]>` reused in create + edit. `branchReadOnly?: boolean` produced by `employee-form.tsx` (Task 3 S1), passed by edit page (Task 3 S2). `updateEmployee` preserve uses `before.branchId`/`before.assignedBranchIds`. Consistent.
