# Spec B-payroll-guard — Enforce payroll is global-only

**Status:** Approved design (2026-07-01)
**Program:** Branch-scoped administration, final increment. Prod has A, B1, B2a/b, B3. Merged local (un-pushed): B4, B-LIFF, B5, B6. Built on local main `9e5d925`. B1–B6 made surfaces *branch-scopable*; this increment makes **payroll explicitly un-scopable** — closing the last salary-leak vector.

## Problem

Payroll is "global-only by design" but only by **convention**, not enforced. The four payroll permissions (`payroll.read`, `payroll.run`, `payroll.publish`, `settings.payroll.manage`) are gated with `requirePermission(...)`, which admits **any** grant — including a branch-scoped one. So if a custom role carrying `payroll.read` were ever assigned at a branch (`payroll.read @ branchA`), that admin would reach the payroll surface and see **all branches'** salary data — the most sensitive leak, and the only one B1–B6 do not close (payroll reads are org-wide, not branch-filtered).

Nothing today prevents creating such a grant, and nothing at the gate requires the grant to be global.

## Goal

Payroll is accessible **only** via a **global** grant, enforced at two layers:

- **Layer 1 (gate, load-bearing):** every payroll entry point requires a global payroll grant; a branch-scoped grant → `notFound()`. Closes the leak regardless of how any grant was created.
- **Layer 2 (assignment guard, defense-in-depth):** creating a **branch-scoped** assignment of a **CUSTOM** role is rejected when the role carries any payroll permission. Built-in **system** roles (`admin`/`superadmin`/`staff`) are exempt — branch-scoped `admin` is a supported config, and Layer 1 still protects payroll. Prevents the custom-role misconfiguration from existing.

**Invariant: zero change for global admins/Superadmins** — they hold global payroll grants (`getPermittedBranches → 'all'`) and assign roles globally, so both layers are inert for them. Reuses `src/lib/auth/branch-scope.ts`. **No new permission, no schema/migration.**

## Non-goals

- **No branch-scoped payroll feature** (the rejected alternative). Payroll stays a single global surface.
- No change to payroll computation, publishing, or the money-config page's own logic.
- Worker-facing payslip (`/liff/payslip`, the employee's own slip) is self-service — out of scope.

## Architecture

Define the payroll permission set once, in `src/lib/auth/permissions.ts` (the shared home of `Permission`, imported by both the gate helper and the assignment guard):

```ts
// the permissions that may only ever be held/exercised globally
export const PAYROLL_PERMISSIONS = [
  'payroll.read', 'payroll.run', 'payroll.publish', 'settings.payroll.manage',
] as const;
```

### Layer 1 — `requireGlobalPermission` (gate)

A new helper alongside `requirePermission` (in `src/lib/auth/check-permission.ts`):

```ts
/** Like requirePermission, but ALSO requires the grant to be GLOBAL
 *  (branchId=null). A branch-scoped grant → notFound(). For global-only
 *  surfaces (payroll). */
export async function requireGlobalPermission(permission: Permission): Promise<RequirePermissionResult> {
  const result = await requirePermission(permission);           // admits any grant (tier-decoupled)
  const permitted = await getPermittedBranches(result.user, permission);
  if (permitted !== 'all') notFound();                          // scoped grant → hide the surface
  return result;
}
```

Replace every payroll gate — the ~9 files carrying `requirePermission('payroll.read'|'payroll.run'|'payroll.publish'|'settings.payroll.manage')` — with `requireGlobalPermission(...)`: `payroll/layout.tsx`, `payroll/page.tsx`, `payroll/actions.ts`, `payroll/adjustments/actions.ts`, `payroll/preview-html/route.ts` (and any sibling preview route), `settings/payroll/page.tsx`, `settings/payroll/actions.ts`, `tools/recompute-leave/page.tsx`, `tools/recompute-leave/actions.ts`. (The plan greps exhaustively so no gate is missed.)

### Layer 2 — assignment guard

A pure guard mirroring the existing `systemRoleGrantError` in `src/lib/auth/team-guards.ts`.
It guards only **CUSTOM roles** (`isSystem: false`). The built-in **system roles**
(`admin`/`superadmin`/`staff`) are **exempt**: assigning `admin` scoped to a branch
is the supported "branch admin" configuration, and Layer 1
(`requireGlobalPermission`) still denies that branch-scoped assignment payroll
access regardless. Layer 2 exists to catch a *custom* role author bundling
payroll perms into a branch grant — not to block the platform-managed roles.

```ts
/** A payroll-bearing CUSTOM role may only be assigned GLOBALLY. Returns an
 *  error message when a branch-scoped assignment (branchId != null) targets
 *  a CUSTOM role whose permissions include any PAYROLL_PERMISSIONS; null when
 *  allowed (global assignment, or a system role — exempt, see above). */
export function payrollRoleBranchScopeError(
  role: { permissions: ReadonlyArray<string>; isSystem: boolean },
  branchId: string | null,
): string | null {
  if (branchId === null || role.isSystem) return null; // global, or exempt system role
  const hasPayroll = role.permissions.some((p) => (PAYROLL_PERMISSIONS as readonly string[]).includes(p));
  return hasPayroll
    ? 'บทบาทที่มีสิทธิ์เงินเดือนต้องกำหนดแบบทั้งองค์กร (ไม่ระบุสาขา)'
    : null;
}
```

Wire it into the two user-facing assignment-creation paths in `src/app/(admin)/admin/settings/team/actions.ts`, alongside the existing per-row `systemRoleGrantError` validation:
- **`createTeamMember`** — in the per-row validation loop (where `systemRoleGrantError` already runs), reject if `payrollRoleBranchScopeError(role, row.branchId)` is non-null.
- **`addRoleAssignment`** — after resolving the role + `branchId`, reject if the guard is non-null.

(Other assignment sites are safe and need no guard: `assignAdminRole` always uses `branchId: null` (global); `createEmployee`'s staff-role assignments use the `staff` system role, which has no payroll permissions. The plan verifies `merge-admin-into-employee.ts`'s assignment is global/non-payroll too.)

## Testing

- **`requireGlobalPermission`** (mock `requirePermission` + `getUserAssignments`): global grant → returns; branch-scoped grant → `notFound()`; Superadmin (isSuperadmin) → returns. (Extend `check-permission.test.ts` or a new file.)
- **`payrollRoleBranchScopeError`** (pure): branchId=null → null (any role); branchId set + role has a payroll perm → error; branchId set + role without payroll perms → null; each of the 4 payroll perms triggers it. (In `team-guards.test.ts`.)
- **A guardrail-style assertion** (optional but recommended): a test that every payroll gate file uses `requireGlobalPermission` (not bare `requirePermission`) for payroll perms — mirrors the `admin-page-gates` guardrail, preventing a future payroll gate from regressing to `requirePermission`.
- Full suite + `tsc --noEmit` clean; `next build` green; page-gate guardrail green.

## Files touched

| File | Change |
|------|--------|
| `src/lib/auth/permissions.ts` | export `PAYROLL_PERMISSIONS` |
| `src/lib/auth/check-permission.ts` | add `requireGlobalPermission` |
| `src/lib/auth/team-guards.ts` | add `payrollRoleBranchScopeError` |
| 9 payroll gate files (payroll/{layout,page,actions,adjustments/actions,preview-html/route}, settings/payroll/{page,actions}, tools/recompute-leave/{page,actions}) | `requirePermission → requireGlobalPermission` for payroll perms |
| `src/app/(admin)/admin/settings/team/actions.ts` | call `payrollRoleBranchScopeError` in `createTeamMember` + `addRoleAssignment` |
| test files (`check-permission.test.ts`/new, `team-guards.test.ts`, optional gate guardrail) | Layer 1 + Layer 2 tests |

## Open risks

- **Exhaustive gate coverage:** Layer 1's value depends on converting EVERY payroll entry point. The plan greps all `requirePermission('payroll.*'|'settings.payroll.manage')` sites (currently 9 files) and the optional guardrail test locks it so a new payroll gate can't regress. A missed gate = the leak stays open there.
- **`requireGlobalPermission` double assignment load:** it calls `requirePermission` (loads assignments) then `getPermittedBranches` (loads again). Acceptable (payroll pages are low-traffic); a future optimization could resolve both from one load, but not needed here.
- **Layer 2 mixed roles:** a **custom** role bundling payroll + non-payroll perms can now only be assigned globally (branch-scoped assignment rejected with a clear Thai error). This is the intended constraint; document it. The built-in **system** roles (`admin`/`superadmin`/`staff`) are exempt from Layer 2 — branch-scoped `admin` is the supported branch-admin configuration, and Layer 1 still blocks that assignment's payroll access.
- **Blast radius:** all prod admins are global with global payroll grants → both layers are inert in production (Layer 1 passes, Layer 2 never triggers). Pure-code, reversible, no migration.
