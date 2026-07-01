# Spec B5 — Branch-scope enforcement: reports

**Status:** Approved design (2026-07-01)
**Program:** Branch-scoped administration. Prod has A, B1 (attendance), B2a/B2b (employees), B3 (leave). Merged local (un-pushed): B4 (advance), B-LIFF (LIFF admin reads). Built on local main `f6710ef`. This is **B5** — scoping the `/admin/reports` surface, the last read surface before the dashboard (B6).

## Problem

The three report pages (`reports/attendance`, `reports/advance`, `reports/leave`) are gated `report.read` (section `layout.tsx`) and each renders per-employee aggregates. A user-selectable branch filter exists, but it is a **filter, not a scope**:

- Every report resolves a base employee set via `employeeWhere(filter)` in `src/lib/reports/queries.ts`, which applies only the *user-chosen* `branchId`/`departmentId`/`q`. A branch-scoped admin who clears the branch filter — or hand-edits `?branchId=<other-branch>` — sees **all branches'** attendance/advance/leave aggregates (including salary-adjacent advance sums).
- The branch-filter dropdown (`loadReportFilterOptions` in `_load-filter-options.ts`) lists **all** branches, so a scoped admin sees every branch name and can select branches they don't manage.

## Goal (B5)

Every report is scoped to the actor's permitted branches (home ∪ assigned) by the `report.read` permission, and the branch-filter dropdown lists only permitted branches. The user-selectable branch filter continues to work *within* that scope. **Invariant: zero change for global/Superadmin** (`getPermittedBranches → 'all'` ⇒ `employeeBranchScope → {}`; dropdown unfiltered).

Reuses `src/lib/auth/branch-scope.ts` (`getPermittedBranches`, `employeeBranchScope`). **No new helpers, no schema/migration.**

## Non-goals (explicit)

- No change to report math/columns, period logic, or the user-filter semantics (branchId/department/q keep filtering as today, just *within* the permitted set).
- Dashboard + `/admin/calendar` (B6) and payroll (B-payroll-guard) are separate increments.
- No new permission.

## Architecture

`employeeBranchScope(permitted)` returns a `Prisma.EmployeeWhereInput` matching home `branchId` ∪ `assignedBranchIds` (`{}` for `'all'`). Reports resolve their base employee set at exactly one place per function, so scope injects there and every downstream `groupBy`/`aggregate` inherits it.

### Unit 1 — Report queries (`src/lib/reports/queries.ts`)

`employeeWhere` is the **single injection point** — five exported functions resolve their base employee set through it: the three reports (`advanceReport`, `attendanceReport`, `leaveReport`) **and the two per-employee breakdowns** (`advanceDetail`, `leaveDetail`, which the advance/leave pages also call). Add a `permitted: PermittedBranches` parameter to all five and intersect it into the employee-set `where`:

```ts
// employeeWhere gains the permission scope, AND-combined with the user filter:
function employeeWhere(f: EmployeeFilter, permitted: PermittedBranches): Prisma.EmployeeWhereInput {
  const userFilter: Prisma.EmployeeWhereInput = {
    archivedAt: null,
    ...(f.branchId ? { branchId: f.branchId } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.q ? { /* existing name search */ } : {}),
  };
  const scope = employeeBranchScope(permitted); // {} for 'all'
  return Object.keys(scope).length ? { AND: [userFilter, scope] } : userFilter;
}
```

All five functions thread `permitted` into their `prisma.employee.findMany({ where: employeeWhere(filter, permitted) })`. (Preserve the exact current `userFilter` construction — the snippet above is illustrative of the merge, not a rewrite of the filter fields.) The advance page calls `advanceReport` + `advanceDetail`; the leave page calls `leaveReport` + `leaveDetail`; the attendance page calls `attendanceReport` — those three pages are the ONLY callers (verified by grep; `/liff/summary` does not call these).

Result: the employee set is `user filter ∩ permitted branches`. A forged `?branchId=<out-of-scope>` yields an empty set (the branch isn't in `permitted`), so no data leaks — the AND is the load-bearing guard, independent of the UI.

### Unit 2 — Branch-filter dropdown (`_load-filter-options.ts`)

Scope `loadReportFilterOptions` so the branch list is limited to permitted branches:

```ts
export async function loadReportFilterOptions(permitted: PermittedBranches): Promise<{ branches: FilterOption[]; departments: FilterOption[] }> {
  const branchWhere: Prisma.BranchWhereInput =
    permitted === 'all' ? { archivedAt: null } : { archivedAt: null, id: { in: permitted } };
  // ... prisma.branch.findMany({ where: branchWhere, ... }); departments unchanged ...
}
```

(Departments are org-config, never branch-scoped — leave the department list unchanged. `permitted === 'all'` → the branch list is unchanged.)

### Unit 3 — Report pages (`reports/{attendance,advance,leave}/page.tsx`)

Each page captures the user, resolves `permitted` once, and passes it to Unit 1 + Unit 2:

```ts
const { user } = await requirePermission('report.read');
const permitted = await getPermittedBranches(user, 'report.read');
// loadReportFilterOptions(permitted)
// attendance page: attendanceReport(period, filter, permitted)
// advance page:    advanceReport(period, filter, permitted) + advanceDetail(period, filter, permitted)
// leave page:      leaveReport(period, filter, year, permitted) + leaveDetail(period, filter, permitted)
```

(The section `layout.tsx` already gates `report.read`; the per-page `requirePermission('report.read')` both re-affirms the gate and yields `user` — consistent with the leave/advance inbox pages.)

## Testing

New `src/lib/reports/queries.branch.test.ts`, mocking `prisma.employee.findMany` (+ the groupBy/aggregate calls enough to return) and driving the REAL `employeeBranchScope`:
- **Scoped actor:** each report's `prisma.employee.findMany` is called with a `where` containing `AND: [userFilter, { OR: [{ branchId: { in: permitted } }, { assignedBranchIds: { hasSome: permitted } }] }]` — assert the branch scope is present.
- **Out-of-scope forged filter:** `filter.branchId = <not in permitted>` → the employee-set where still AND's the permitted scope (result empty in practice) — assert the scope fragment is applied regardless of the user filter.
- **Global actor:** `permitted = 'all'` → `employeeBranchScope` is `{}` → the where equals the plain user filter (no `AND` wrapper) — assert no branch constraint added.
- **Dropdown:** `loadReportFilterOptions(['b1'])` → `branch.findMany` where includes `id: { in: ['b1'] }`; `'all'` → no `id` filter. (Mock `prisma.branch.findMany`.)
- Full suite + `tsc --noEmit` clean; `next build` green; page-gate guardrail green (no new pages; reports layout gate unchanged).

## Files touched

| File | Change |
|------|--------|
| `src/lib/reports/queries.ts` | `permitted` param on all 5 employee-set fns (advanceReport, attendanceReport, leaveReport, advanceDetail, leaveDetail); `employeeWhere(filter, permitted)` AND's `employeeBranchScope(permitted)` |
| `src/app/(admin)/admin/reports/_load-filter-options.ts` | `loadReportFilterOptions(permitted)` scopes the branch list |
| `src/app/(admin)/admin/reports/attendance/page.tsx` | capture user; pass `permitted` to report fn + loader |
| `src/app/(admin)/admin/reports/advance/page.tsx` | same |
| `src/app/(admin)/admin/reports/leave/page.tsx` | same |
| `src/lib/reports/queries.branch.test.ts` (new) | scope-in-where + dropdown tests |

## Open risks

- **Signature change to shared report functions:** `advanceReport`/`attendanceReport`/`leaveReport` gain a required `permitted` param. All call sites are the three report pages (verify no other callers via grep before finalizing) — the plan checks and updates every caller so tsc stays clean.
- **`employeeWhere` currently spreads fields into one object:** merging via `{ AND: [userFilter, scope] }` only when `scope` is non-empty keeps the global path byte-identical to today (no `AND` wrapper when `'all'`).
- **Reports filter by home `branchId`; scope is home ∪ assigned:** intentional — the user filter narrows by home branch (existing behavior), the permission scope authorizes home ∪ assigned (rotating staff), AND-combined.
- **Blast radius:** all prod admins are global → every report scope is `{}` → zero change in production. Pure-code, reversible, no migration.
