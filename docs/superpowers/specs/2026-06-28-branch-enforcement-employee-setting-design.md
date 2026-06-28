# Spec B2b — Branch-scope enforcement: employee create placement + edit branch-setting

**Status:** Approved design (2026-06-28)
**Program:** Branch-scoped administration. Prod has A, B1 (attendance, `2613b2d`), B2a (employees read + act-on, `d395bbc`). This is **B2b** — the deferred branch-**SETTING** half of employees: who may *place* an employee in which branches (create) and *reassign* branch membership (edit).

## Problem

B2a gates *acting on* existing employees but explicitly deferred branch-**setting** (a `// Phase B2b:` marker sits in `updateEmployee`). Today:
- The create form (`new/page.tsx` → `employee-form.tsx`) shows ALL branches in the home `<select>` + `assignedBranchIds` checkboxes; `createEmployee` accepts whatever branches are submitted with no scope validation.
- The edit form shows ALL branches editable; `updateEmployee` (post-B2a) gates "can act on this employee" but does NOT validate the *submitted* `branchId`/`assignedBranchIds` — a scoped admin could reassign an in-scope employee to a branch they don't manage (including self-removing it from their own visibility).

## Goal (B2b)

1. **Create:** a branch-scoped admin may only place an employee in branches they manage. Picker filtered to permitted; `createEmployee` validates the chosen set ⊆ permitted (server-side, defends a forged POST).
2. **Edit:** branch reassignment is **global-only**. A scoped admin sees the branch fields **read-only**; `updateEmployee` **preserves** the employee's existing branch membership for non-global actors regardless of what is submitted. Global/Superadmin retain full branch editing.
3. **Invariant:** zero change for global/Superadmin (`getPermittedBranches → 'all'`).

Reuses `src/lib/auth/branch-scope.ts`; adds one helper.

## Non-goals (explicit)

- The **staff-assignment resync drift** in `updateEmployee` (Employee branch fields change but the Staff `UserRoleAssignment` rows don't) — a pre-existing data-consistency bug, tracked as a SEPARATE task, NOT fixed here. B2b is authorization only.
- No scoped-admin branch reassignment with out-of-scope preservation (the rejected alternative) — edit is global-only.
- No schema/migration. No change to other surfaces.

## Architecture

### Unit 1 — Foundation helper (`branch-scope.ts` + test)

```ts
/** SUBSET check: may an actor with `permitted` branches SET an employee's
 *  branch membership to exactly `branchIds`? 'all' ⇒ yes; otherwise every
 *  chosen branch must be permitted. (Distinct from canActOnEmployeeBranches,
 *  which is overlap/act-on.) */
export function canSetEmployeeBranches(
  permitted: PermittedBranches,
  branchIds: ReadonlyArray<string>,
): boolean {
  if (permitted === 'all') return true;
  return branchIds.every((b) => permitted.includes(b));
}
```
Tests: `'all'` → true (incl. empty); all chosen permitted → true; any chosen not permitted → false; empty chosen → true (vacuous; create always has ≥1 since home is required, so not a real path).

### Unit 2 — Create (scoped placement)

**`new/page.tsx`:** capture `user` from `requirePermission('employee.create')`; `const permitted = await getPermittedBranches(user, 'employee.create')`; pass `permitted` (or a filtered branch list) to the form so the home `<select>` + `assignedBranchIds` checkboxes only show permitted branches when scoped (`'all'` → all branches, unchanged).

**`createEmployee`:** after `readForm` + `normalizeAssigned` (which guarantees home ∈ assignedBranchIds), validate:
```ts
const permitted = await getPermittedBranches(user, 'employee.create');
if (!canSetEmployeeBranches(permitted, assignedBranchIds)) {
  redirect(`/admin/employees/new?error=${encodeURIComponent('ไม่มีสิทธิ์สร้างพนักงานในสาขาที่เลือก')}`);
}
```
(`assignedBranchIds` already includes home via `normalizeAssigned`, so this covers both home + assigned.) Then proceed unchanged (the per-branch Staff assignment creation stays).

### Unit 3 — Edit (global-only branch reassignment)

**`employee-form.tsx`:** add a `branchReadOnly?: boolean` prop. When true: the home `<select>` and each `assignedBranchIds` checkbox render **disabled** (still showing the employee's current values from `initial`). Disabled inputs are not submitted — which the server rule below relies on. (Add a short helper note in the UI, e.g. the existing field hint, that branch changes require a Superadmin — optional Thai copy.)

**`[id]/edit/page.tsx`:** `const branchReadOnly = (await getPermittedBranches(user, 'employee.update')) !== 'all';` pass to `<EmployeeForm branchReadOnly={branchReadOnly} />`. (Create renders with `branchReadOnly={false}` + the filtered options from Unit 2.) For a scoped editor, also ensure the form's branch options include the employee's CURRENT branches (so disabled fields display correct names even if out-of-scope) — simplest: for the edit page pass all branches for display when read-only (inputs are disabled, so no leak/escalation).

**`updateEmployee`:** replace the `// Phase B2b:` marker with server-side enforcement (the real guard; UI read-only is cosmetic):
```ts
const permitted = await getPermittedBranches(user, 'employee.update'); // already loaded for the act-on gate (reuse)
let branchId = data.branchId;
let assignedBranchIds = normalizeAssigned(data.branchId, data.assignedBranchIds);
if (permitted !== 'all') {
  // Scoped admins cannot reassign branch membership — preserve existing.
  branchId = before.branchId;
  assignedBranchIds = before.assignedBranchIds;
}
// ... use branchId / assignedBranchIds in the update ...
```
(`before` is the already-loaded employee from B2a's act-on gate; reuse the same `getPermittedBranches` call rather than calling twice.)

## Testing

- **`canSetEmployeeBranches`** unit tests (Unit 1).
- **`createEmployee`** integration tests (extend the existing employee test scaffold): scoped actor choosing an out-of-permitted branch → redirect-with-error AND no `employee.create`/User create; scoped actor choosing only permitted branches → creates; global actor → any branches create. Drive the REAL `getPermittedBranches`/`canSetEmployeeBranches`.
- **`updateEmployee`** integration tests: scoped actor submitting a CHANGED `branchId`/`assignedBranchIds` for an in-scope employee → the update persists the EXISTING branches (submitted change ignored); global actor → submitted change applied. (Assert the `prisma.employee.update` `data` carries the preserved vs new branch values.)
- Full suite + `tsc --noEmit` clean; `next build` green. (The page-gate guardrail test already covers these pages.)

## Files touched

| File | Change |
|------|--------|
| `src/lib/auth/branch-scope.ts` | add `canSetEmployeeBranches` |
| `src/lib/auth/branch-scope.test.ts` | tests for it |
| `src/app/(admin)/admin/employees/new/page.tsx` | filter branch picker options to permitted |
| `src/app/(admin)/admin/employees/actions.ts` | `createEmployee` subset validation; `updateEmployee` preserve-existing-branches for scoped actors |
| `src/app/(admin)/admin/employees/[id]/edit/page.tsx` | compute + pass `branchReadOnly` |
| `src/app/(admin)/admin/employees/employee-form.tsx` | `branchReadOnly` prop disables branch fields |
| `src/app/(admin)/admin/employees/employee-set.branch.test.ts` (new) | create + update branch-setting integration tests |

## Open risks

- **Disabled-input reliance:** the read-only UI uses disabled inputs (don't submit), but the SERVER guard (`updateEmployee` preserves existing for non-global) is the real enforcement — a scoped admin forging a POST with branch fields is ignored. Both layers are specified; the server one is authoritative.
- **Create error UX:** an out-of-scope create is blocked server-side with a redirect+error even though the filtered picker shouldn't allow it — defense in depth for forged posts; the friendly Thai error covers the rare case.
- **Edit form options when read-only:** passing all branches for display (inputs disabled) is safe — disabled fields can't change state and don't submit; it only lets the scoped admin SEE the employee's true (possibly out-of-scope) branch names, which they already could via B2a's act-on access.
- **Drift (out of scope):** since scoped admins can no longer change branches, the staff-assignment resync drift now only affects global admins (who already have full control); still tracked + fixed separately.
