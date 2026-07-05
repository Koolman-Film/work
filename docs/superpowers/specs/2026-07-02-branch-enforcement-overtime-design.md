# Spec B-OT — Branch-scope enforcement: overtime (+ scope-presence guardrail + sidebar badges)

**Status:** Approved design (2026-07-02)
**Program:** Branch-scoped administration. The full program (A, B1–B6, B-LIFF, B-payroll-guard) shipped/merged; a whole-program completeness audit then found the **Overtime module was never scoped** — a real leak in the same class the program closes. Built on local main `3d60019`. This increment closes it, adds a guardrail so the class can't recur, and fixes an inconsistency the audit flagged.

## Problem

`attendance.overtime.manage` is a **branch-grantable** permission (`permissions.ts`), so a branch-scoped admin can hold it — but the entire Overtime surface ignores branch scope (audit-confirmed: zero scope-primitive references in `src/lib/overtime/**` or `src/app/(admin)/admin/attendance/overtime/**`):

- **Reads** (`overtime/page.tsx` + `lib/overtime/candidates.ts`): `getOtCandidates` (`attendance.findMany` joined to employee names/rates/schedule), the month OT-history (`overtimeEntry.findMany`), and the manual-add picker (`employee.findMany`, every non-archived employee) — all **all-branch**.
- **Writes** (`lib/overtime/actions.ts`): `approveOt` / `dismissOt` create an `OvertimeEntry` for the posted `employeeId`, `voidOt` soft-deletes by `id`, `priceOt` reads any employee's `salaryType`/`baseSalary` — none gate on the target employee's branches. A scoped admin can create/void OT (a payable amount) and read salary for **out-of-branch** employees by posting their id.

**Why it shipped:** the `admin-page-gates` guardrail only asserts a gate *string* exists, not that reads are *scoped* — the OT page passes it while leaking. "Gated but unscoped."

Not prod-exploitable today (all prod admins are global), but a genuine hole.

## Goal

1. Scope every Overtime read + gate every Overtime write to the actor's permitted branches, by `attendance.overtime.manage` (the surface's gate), matching an employee's home ∪ assigned branches — same pattern as attendance/advance.
2. Add a **scope-presence guardrail** that fails CI if any admin file reads an employee-linked model without referencing a scope primitive (minus a documented exemption allowlist) — so this class can't recur.
3. Fix the **sidebar badge counts** (`(admin)/layout.tsx`) to be branch-scoped (audit Minor).

**Invariant: zero change for global/Superadmin** (`getPermittedBranches → 'all'` ⇒ `{}`/inert). Reuses `src/lib/auth/branch-scope.ts`. No new permission, no schema/migration.

## Non-goals

- No change to OT detection math (`rate.ts`), the OT rate model, or the payroll consumption of OT.
- No new permission. Worker-facing surfaces are untouched (OT is admin-only).

## Architecture

Primitives: `getPermittedBranches(user, 'attendance.overtime.manage')`, `viaEmployeeBranchScope(permitted)` (read fragment via the `employee` relation, `{}` for `'all'`), `employeeBranchScope(permitted)` (direct Employee where), `canActOnEmployeeBranches(permitted, [home, ...assigned])` (write gate). `OvertimeEntry` links to `Employee` via `employeeId` (no own branchId) — scope via the relation.

### Unit 1 — OT reads (`lib/overtime/candidates.ts` + `overtime/page.tsx`)

`getOtCandidates(args, permitted: PermittedBranches)`: merge the scope into its `attendance.findMany` `where` (spread `...viaEmployeeBranchScope(permitted)`; the where has no pre-existing `employee` key) and into the decided-entries `overtimeEntry.findMany` (via the `employee` relation). Both `{}` for `'all'`.

`overtime/page.tsx`: capture `user` (currently `await requirePermission('attendance.overtime.manage')` discards it) → `const permitted = await getPermittedBranches(user, 'attendance.overtime.manage')`. Pass `permitted` to `getOtCandidates`. Scope the OT-history `overtimeEntry.findMany` (`...viaEmployeeBranchScope(permitted)`) and the manual-add-picker `employee.findMany` (`AND` with `employeeBranchScope(permitted)`, since it has top-level Employee fields).

### Unit 2 — OT writes (`lib/overtime/actions.ts`)

- **`approveOt`** / **`dismissOt`**: after `requirePermission(...)` capture `user`; compute `permitted = getPermittedBranches(user, 'attendance.overtime.manage')`; load the posted employee's branch set (`employee.findUnique({ where: { id: employeeId }, select: { branchId, assignedBranchIds } })`); if `!emp || !canActOnEmployeeBranches(permitted, [emp.branchId, ...emp.assignedBranchIds])` → `redirect(backUrl(ym, 'ไม่พบพนักงาน'))`. Place this **before** `priceOt` (approveOt) so the salary read is also protected, and before the `create`.
- **`voidOt`**: load the entry with its employee branch set (`overtimeEntry.findUnique({ where: { id }, select: { employee: { select: { branchId, assignedBranchIds } } } })`); if `!row || !canActOnEmployeeBranches(permitted, [...])` → `redirect(backUrl(ym, 'ไม่พบรายการ'))` before the soft-delete update. Mirrors `lib/advance/void.ts` / `lib/leave/void.ts`.

(`priceOt` itself needs no gate — its only caller `approveOt` gates the same `employeeId` first.)

### Unit 3 — Scope-presence guardrail (`src/app/(admin)/admin/scope-presence.test.ts`, new)

A test that walks `src/app/(admin)/admin/**` (`.ts`/`.tsx`, excluding `*.test.ts`) plus the `src/lib/**` service modules those pages call for employee-linked data, and for any file containing a read of an employee-linked model (regex: `prisma(Raw)?\.(attendance|leaveRequest|cashAdvance|employee|overtimeEntry)\.(findMany|findFirst|findUnique|count|groupBy|aggregate)`), asserts the file ALSO references a scope primitive (`getPermittedBranches|employeeBranchScope|viaEmployeeBranchScope|canActOnEmployeeBranches|requireGlobalPermission`) OR is in an explicit `EXEMPT` allowlist. The allowlist is seeded from the audit's confirmed exemptions (settings dependency-count actions, org-config, self-record files, worker self-service) with a one-line justification each. Failure message names the offending file and says "scope it, or add to EXEMPT with a reason." This catches an OT-class gap at CI time.

### Unit 4 — Sidebar badge counts (`src/app/(admin)/layout.tsx`)

`requireAdminArea()` already yields `user`. Load assignments once and scope the three counts by domain perm: `leaveRequest.count` → `...viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments,'leave.read'))`; `cashAdvance.count` → `advance.read`; `attendance.count` (Disputed) → `attendance.read`. `{}` for global → unchanged.

## Testing

- **`src/lib/overtime/overtime.branch.test.ts`** (new), mocking boundaries + driving the real helpers (mirrors `advance-branch-enforcement.test.ts`):
  - `getOtCandidates`: scoped actor → `attendance.findMany` where carries the branch scope; global → no scope.
  - `approveOt` / `dismissOt`: scoped actor on an out-of-scope employee → `redirect(...error)`, no `overtimeEntry.create`; in-scope → creates; global → any; rotating-staff (assigned-branch match) → allowed.
  - `voidOt`: out-of-scope entry → redirect, no update; in-scope → soft-deletes; global → any.
- **Unit 3** guardrail test runs against the tree (green after Unit 1–2 scope OT).
- Full suite + `tsc --noEmit` clean; `next build` green; `admin-page-gates` + `payroll-gates` + the new scope-presence guardrail all green.

## Files touched

| File | Change |
|------|--------|
| `src/lib/overtime/candidates.ts` | `getOtCandidates` gains `permitted`; scope the attendance + decided reads |
| `src/app/(admin)/admin/attendance/overtime/page.tsx` | capture user+permitted; scope candidates + history + picker |
| `src/lib/overtime/actions.ts` | act-on gate in `approveOt` / `dismissOt` / `voidOt` |
| `src/app/(admin)/layout.tsx` | scope the 3 sidebar badge counts by domain perm |
| `src/app/(admin)/admin/scope-presence.test.ts` (new) | scope-presence guardrail + EXEMPT allowlist |
| `src/lib/overtime/overtime.branch.test.ts` (new) | OT read + write branch tests |

## Open risks

- **Guardrail allowlist maintenance:** Unit 3 needs a new genuinely-exempt read added to `EXEMPT` (with a reason) or it fails CI. That friction is intentional — it forces a conscious "is this really exempt?" decision, the check that OT bypassed. Seed the allowlist from the audit's verified exemptions.
- **Guardrail false-negative on new dirs:** the walk covers `src/app/(admin)/admin/**` + the known service-lib modules; a brand-new employee-linked read placed in an unexpected `src/lib` path not reached by a caller under `(admin)` could slip. Mitigated by also scanning `src/lib/{overtime,reports,leave,advance,attendance}` explicitly.
- **Blast radius:** all prod admins are global → every OT scope is `{}` and every gate `true` → zero change in production. Pure-code, reversible, no migration.
