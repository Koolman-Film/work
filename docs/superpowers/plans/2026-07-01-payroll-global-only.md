# Payroll Global-Only Enforcement (Spec B-payroll-guard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make payroll accessible only via a global grant — Layer 1 (`requireGlobalPermission` on every payroll gate) + Layer 2 (reject branch-scoped assignment of any payroll-bearing role).

**Architecture:** A new `requireGlobalPermission(perm)` = `requirePermission(perm)` + assert `getPermittedBranches(user, perm) === 'all'` else `notFound()`, in its OWN module to avoid a check-permission ↔ branch-scope circular import. A pure `payrollRoleBranchScopeError(role, branchId)` mirrors the existing `systemRoleGrantError`, wired into the two assignment paths. Global admins hold global payroll grants → both layers inert.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Prisma, Vitest, Biome, pnpm.

## Global Constraints

- **No new permission, no schema/migration.** Reuse `getPermittedBranches` from `src/lib/auth/branch-scope.ts`.
- **Invariant — zero change for global admins/Superadmins:** they hold global payroll grants (`getPermittedBranches → 'all'`) and assign globally, so Layer 1 passes and Layer 2 never triggers.
- **`PAYROLL_PERMISSIONS`** = `['payroll.read', 'payroll.run', 'payroll.publish', 'settings.payroll.manage']`, exported from `src/lib/auth/permissions.ts`.
- **Circular-import avoidance:** `requireGlobalPermission` lives in a NEW file `src/lib/auth/require-global-permission.ts` (imports `requirePermission` from `check-permission`, `getPermittedBranches` from `branch-scope`). Do NOT add it to `check-permission.ts` (that would make check-permission import branch-scope, which already imports check-permission → cycle).
- **Layer 2 error copy (Thai, verbatim):** `'บทบาทที่มีสิทธิ์เงินเดือนต้องกำหนดแบบทั้งองค์กร (ไม่ระบุสาขา)'`.
- **Branch base:** local main `9e5d925` (B3+B4+B-LIFF+B5+B6). Branch: `claude/spec-bpg-payroll-global-only`. tsc baseline: 0 errors.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run commands from the worktree root: `/Users/tong/Works/fai/work/.claude/worktrees/practical-satoshi-2a56f0`.

## File Structure

- `src/lib/auth/permissions.ts` — export `PAYROLL_PERMISSIONS` (Task 1).
- `src/lib/auth/require-global-permission.ts` — new; `requireGlobalPermission` (Task 1).
- `src/lib/auth/require-global-permission.test.ts` — new (Task 1).
- 9 payroll gate files — `requirePermission → requireGlobalPermission` (Task 2).
- `src/app/(admin)/admin/payroll/payroll-gates.test.ts` — new guardrail (Task 2).
- `src/lib/auth/team-guards.ts` — `payrollRoleBranchScopeError` (Task 3).
- `src/lib/auth/team-guards.test.ts` — extend (Task 3).
- `src/app/(admin)/admin/settings/team/actions.ts` — wire the guard (Task 4).

---

## Task 1: `PAYROLL_PERMISSIONS` + `requireGlobalPermission`

**Files:**
- Modify: `src/lib/auth/permissions.ts`
- Create: `src/lib/auth/require-global-permission.ts`, `src/lib/auth/require-global-permission.test.ts`

**Interfaces:**
- Consumes: `requirePermission` (`@/lib/auth/check-permission`) → `Promise<{ user: User; authUserId: string; tier: Role | null }>`; `getPermittedBranches` (`@/lib/auth/branch-scope`); `notFound` (`next/navigation`).
- Produces: `PAYROLL_PERMISSIONS` (readonly string tuple); `requireGlobalPermission(permission: Permission): Promise<{ user: User; authUserId: string; tier: Role | null }>`.

- [ ] **Step 1: Add `PAYROLL_PERMISSIONS` to permissions.ts**

At the end of `src/lib/auth/permissions.ts` add:

```ts
/** Permissions that may only ever be held/exercised GLOBALLY (never
 *  branch-scoped). Payroll is an org-wide operation — see B-payroll-guard. */
export const PAYROLL_PERMISSIONS = [
  'payroll.read',
  'payroll.run',
  'payroll.publish',
  'settings.payroll.manage',
] as const;
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/auth/require-global-permission.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const requirePermission = vi.fn();
const getUserAssignments = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
}));

import { requireGlobalPermission } from './require-global-permission';

const globalGrant = [{ branchId: null, role: { permissions: ['payroll.read'], isSuperadmin: false, archivedAt: null } }];
const scopedGrant = [{ branchId: 'b1', role: { permissions: ['payroll.read'], isSuperadmin: false, archivedAt: null } }];
const superadmin = [{ branchId: null, role: { permissions: [], isSuperadmin: true, archivedAt: null } }];

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { id: 'u1' }, authUserId: 'a1', tier: 'Admin' });
});

describe('requireGlobalPermission', () => {
  it('global grant → returns the result', async () => {
    getUserAssignments.mockResolvedValue(globalGrant);
    const r = await requireGlobalPermission('payroll.read');
    expect(r).toMatchObject({ user: { id: 'u1' } });
  });

  it('branch-scoped grant only → notFound', async () => {
    getUserAssignments.mockResolvedValue(scopedGrant);
    await expect(requireGlobalPermission('payroll.read')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('global Superadmin (branchId=null, isSuperadmin) → returns (getPermittedBranches → all)', async () => {
    getUserAssignments.mockResolvedValue(superadmin);
    const r = await requireGlobalPermission('payroll.read');
    expect(r).toMatchObject({ user: { id: 'u1' } });
  });

  it('branch-scoped Superadmin assignment (branchId set) → notFound (not global)', async () => {
    getUserAssignments.mockResolvedValue([
      { branchId: 'b1', role: { permissions: [], isSuperadmin: true, archivedAt: null } },
    ]);
    await expect(requireGlobalPermission('payroll.read')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
```

(Note: `beforeEach` needs importing — add `beforeEach` to the vitest import.)

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/auth/require-global-permission.test.ts`
Expected: FAIL — module/function does not exist.

- [ ] **Step 4: Implement `requireGlobalPermission`**

Create `src/lib/auth/require-global-permission.ts`:

```ts
import type { Role, User } from '@prisma/client';
import { notFound } from 'next/navigation';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import type { Permission } from '@/lib/auth/permissions';

/**
 * Like `requirePermission`, but ALSO requires the grant to be GLOBAL
 * (branchId=null / Superadmin). A merely branch-scoped grant → notFound().
 * For global-only surfaces (payroll). Superadmin resolves to 'all', so
 * Superadmins always pass.
 */
export async function requireGlobalPermission(
  permission: Permission,
): Promise<{ user: User; authUserId: string; tier: Role | null }> {
  const result = await requirePermission(permission);
  const permitted = await getPermittedBranches(result.user, permission);
  if (permitted !== 'all') notFound();
  return result;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm exec vitest run src/lib/auth/require-global-permission.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/permissions.ts src/lib/auth/require-global-permission.ts src/lib/auth/require-global-permission.test.ts
git commit -m "$(printf 'feat(auth): requireGlobalPermission + PAYROLL_PERMISSIONS (B-payroll-guard L1)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Convert every payroll gate to `requireGlobalPermission` (Layer 1)

**Files:**
- Modify (payroll gates): `src/app/(admin)/admin/payroll/layout.tsx`, `payroll/page.tsx`, `payroll/actions.ts`, `payroll/adjustments/actions.ts`, `payroll/preview-html/route.ts`, `src/app/(admin)/admin/settings/payroll/page.tsx`, `settings/payroll/actions.ts`, `src/app/(admin)/admin/tools/recompute-leave/page.tsx`, `tools/recompute-leave/actions.ts`
- Create: `src/app/(admin)/admin/payroll/payroll-gates.test.ts` (guardrail)

**Interfaces:**
- Consumes: `requireGlobalPermission` from `@/lib/auth/require-global-permission` (Task 1).

- [ ] **Step 1: Write the guardrail test**

Create `src/app/(admin)/admin/payroll/payroll-gates.test.ts`:

```ts
/**
 * Guardrail: payroll surfaces must gate with requireGlobalPermission, never
 * a bare requirePermission (which would admit a branch-scoped payroll grant
 * and leak all-branch salary). Locks B-payroll-guard Layer 1.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ADMIN = path.resolve(__dirname, '..'); // src/app/(admin)/admin
const DIRS = ['payroll', 'settings/payroll', 'tools/recompute-leave'].map((d) => path.join(ADMIN, d));
const PAYROLL_PERM_RE = /requirePermission\(\s*['"](payroll\.[a-z-]+|settings\.payroll\.manage)['"]/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('payroll global-only gate guardrail', () => {
  it('no payroll surface uses a bare requirePermission for a payroll permission', () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const f of walk(dir)) {
        if (PAYROLL_PERM_RE.test(fs.readFileSync(f, 'utf8'))) offenders.push(path.relative(ADMIN, f));
      }
    }
    expect(
      offenders,
      `These payroll files still use requirePermission for a payroll permission — use requireGlobalPermission:\n${offenders.join('\n')}`,
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run "src/app/(admin)/admin/payroll/payroll-gates.test.ts"`
Expected: FAIL — lists the payroll files still using `requirePermission('payroll.*')`.

- [ ] **Step 3: Convert each payroll gate**

In each of the 9 files, replace the payroll `requirePermission(...)` call(s) with `requireGlobalPermission(...)` and update the import. The permission argument and the `const { user } = ` / bare-await form stay identical — only the function name changes.

- Replace `import { requirePermission } from '@/lib/auth/check-permission';` with (or add) `import { requireGlobalPermission } from '@/lib/auth/require-global-permission';`. If a file uses `requirePermission` for a NON-payroll permission too, keep both imports and only swap the payroll call(s).
- The specific calls to convert (verify by grepping each file for `requirePermission('payroll` / `requirePermission('settings.payroll.manage'`):
  - `payroll/layout.tsx`: `requirePermission('payroll.read')` → `requireGlobalPermission('payroll.read')`
  - `payroll/page.tsx`: `requirePermission('payroll.read')` → `requireGlobalPermission('payroll.read')`
  - `payroll/actions.ts`: all `requirePermission('payroll.run'|'payroll.publish'|'payroll.read')` → `requireGlobalPermission(...)` (6 sites)
  - `payroll/adjustments/actions.ts`: all `requirePermission('payroll.run')` → `requireGlobalPermission('payroll.run')` (3 sites)
  - `payroll/preview-html/route.ts`: `requirePermission('payroll.read')` → `requireGlobalPermission('payroll.read')`
  - `settings/payroll/page.tsx`: `requirePermission('settings.payroll.manage')` → `requireGlobalPermission('settings.payroll.manage')`
  - `settings/payroll/actions.ts`: `requirePermission('settings.payroll.manage')` → `requireGlobalPermission('settings.payroll.manage')`
  - `tools/recompute-leave/page.tsx`: `requirePermission('payroll.publish')` → `requireGlobalPermission('payroll.publish')`
  - `tools/recompute-leave/actions.ts`: `requirePermission('payroll.publish')` → `requireGlobalPermission('payroll.publish')`

Before finishing, run `grep -rn "requirePermission('payroll\.\|requirePermission('settings.payroll.manage'" "src/app/(admin)/admin"` and confirm ZERO results (belt-and-suspenders with the guardrail test).

- [ ] **Step 3b: Teach the admin-page-gates guardrail about `requireGlobalPermission`**

Converting the payroll **pages** (`payroll/page.tsx`, `settings/payroll/page.tsx`, `tools/recompute-leave/page.tsx`) to `requireGlobalPermission` will make the existing `src/app/(admin)/admin/admin-page-gates.test.ts` FAIL, because its `GATE_RE` only recognizes `requirePermission(|requireRole(|requireAdminArea(|requireEmployee(`. Add `requireGlobalPermission(` to that regex:

```ts
const GATE_RE = /requirePermission\(|requireGlobalPermission\(|requireRole\(|requireAdminArea\(|requireEmployee\(/;
```

(One-line change in `admin-page-gates.test.ts` — `requireGlobalPermission` is a strictly stronger gate, so it must count as an effective gate.)

- [ ] **Step 4: Run the guardrail + full check**

Run: `pnpm exec vitest run "src/app/(admin)/admin/payroll/payroll-gates.test.ts" "src/app/(admin)/admin/admin-page-gates.test.ts"`
Expected: PASS both (payroll guardrail green; admin-page-gates green now that `GATE_RE` accepts `requireGlobalPermission`).

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/payroll" "src/app/(admin)/admin/settings/payroll" "src/app/(admin)/admin/tools/recompute-leave" "src/app/(admin)/admin/admin-page-gates.test.ts"
git commit -m "$(printf 'feat(payroll): gate every payroll surface with requireGlobalPermission (B-payroll-guard L1)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: `payrollRoleBranchScopeError` guard (Layer 2 helper)

**Files:**
- Modify: `src/lib/auth/team-guards.ts`
- Modify: `src/lib/auth/team-guards.test.ts`

**Interfaces:**
- Consumes: `PAYROLL_PERMISSIONS` from `@/lib/auth/permissions` (Task 1).
- Produces: `payrollRoleBranchScopeError(role: { permissions: ReadonlyArray<string> }, branchId: string | null): string | null`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/auth/team-guards.test.ts` (import `payrollRoleBranchScopeError` from `./team-guards`):

```ts
describe('payrollRoleBranchScopeError', () => {
  const payrollRole = { permissions: ['leave.read', 'payroll.read'] };
  const plainRole = { permissions: ['leave.read', 'advance.read'] };

  it('global assignment (branchId=null) → null for any role', () => {
    expect(payrollRoleBranchScopeError(payrollRole, null)).toBeNull();
    expect(payrollRoleBranchScopeError(plainRole, null)).toBeNull();
  });

  it('branch-scoped assignment of a payroll-bearing role → error', () => {
    expect(payrollRoleBranchScopeError(payrollRole, 'b1')).toBe(
      'บทบาทที่มีสิทธิ์เงินเดือนต้องกำหนดแบบทั้งองค์กร (ไม่ระบุสาขา)',
    );
  });

  it('branch-scoped assignment of a non-payroll role → null', () => {
    expect(payrollRoleBranchScopeError(plainRole, 'b1')).toBeNull();
  });

  it('each payroll permission triggers the guard', () => {
    for (const p of ['payroll.read', 'payroll.run', 'payroll.publish', 'settings.payroll.manage']) {
      expect(payrollRoleBranchScopeError({ permissions: [p] }, 'b1')).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/auth/team-guards.test.ts -t "payrollRoleBranchScopeError"`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement the guard**

In `src/lib/auth/team-guards.ts`, add the import at the top:

```ts
import { PAYROLL_PERMISSIONS } from './permissions';
```

and add the function (near `systemRoleGrantError`):

```ts
/**
 * A payroll-bearing role may only be assigned GLOBALLY. Returns a Thai error
 * string when a branch-scoped assignment (branchId != null) targets a role
 * whose permissions include any PAYROLL_PERMISSIONS; null when allowed.
 * Payroll is an org-wide surface (see B-payroll-guard) — a branch-scoped
 * payroll grant is both inert (requireGlobalPermission blocks it) and
 * forbidden here so the confusing state never exists.
 */
export function payrollRoleBranchScopeError(
  role: { permissions: ReadonlyArray<string> },
  branchId: string | null,
): string | null {
  if (branchId === null) return null;
  const hasPayroll = role.permissions.some((p) =>
    (PAYROLL_PERMISSIONS as ReadonlyArray<string>).includes(p),
  );
  return hasPayroll ? 'บทบาทที่มีสิทธิ์เงินเดือนต้องกำหนดแบบทั้งองค์กร (ไม่ระบุสาขา)' : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/lib/auth/team-guards.test.ts`
Expected: PASS (existing team-guards tests + 4 new).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` → 0 errors.

```bash
git add src/lib/auth/team-guards.ts src/lib/auth/team-guards.test.ts
git commit -m "$(printf 'feat(auth): payrollRoleBranchScopeError guard (B-payroll-guard L2)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Wire the assignment guard into the two assignment paths (Layer 2)

**Files:**
- Modify: `src/app/(admin)/admin/settings/team/actions.ts`

**Interfaces:**
- Consumes: `payrollRoleBranchScopeError` from `@/lib/auth/team-guards` (Task 3).

- [ ] **Step 1: Import the guard**

In `src/app/(admin)/admin/settings/team/actions.ts`, add `payrollRoleBranchScopeError` to the existing import from `@/lib/auth/team-guards` (which already imports `canManageSystemRole`, `systemRoleGrantError`).

- [ ] **Step 2: `createTeamMember` — add `permissions` to the role select + the guard**

The role select (line ~162-165) currently selects `{ id, key, isSuperadmin, isSystem, archivedAt }`. Add `permissions: true`:

```ts
  const roles = await prisma.roleDefinition.findMany({
    where: { id: { in: rows.map((r) => r.roleId) } },
    select: { id: true, key: true, isSuperadmin: true, isSystem: true, archivedAt: true, permissions: true },
  });
```

In the per-row validation loop, immediately after the `systemRoleGrantError` block (after line ~183, before the `if (row.branchId === null)` block), add:

```ts
    const payrollErr = payrollRoleBranchScopeError(role, row.branchId);
    if (payrollErr) {
      redirect(
        `/admin/settings/team/new?error=${encodeURIComponent(payrollErr)}&email=${encodeURIComponent(email)}`,
      );
    }
```

- [ ] **Step 3: `addRoleAssignment` — add the guard**

`addRoleAssignment` loads the full role via `findUnique` (line ~639), so `role.permissions` is already available. Immediately after the `systemRoleGrantError` block (after line ~651, before the `if (branchId === null)` block), add:

```ts
  const payrollErr = payrollRoleBranchScopeError(role, branchId);
  if (payrollErr) {
    redirect(`/admin/settings/team/${userId}/edit?error=${encodeURIComponent(payrollErr)}`);
  }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/settings/team/actions.ts"
git commit -m "$(printf 'feat(team): reject branch-scoped assignment of payroll-bearing roles (B-payroll-guard L2)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm exec vitest run`
Expected: all green (existing suite + new require-global-permission, payroll-gates guardrail, team-guards payroll tests).

- [ ] **Step 2: Typecheck the whole project**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Confirm the page-gate guardrail still passes**

Run: `pnpm exec vitest run "src/app/(admin)/admin/admin-page-gates.test.ts" "src/app/(admin)/admin/payroll/payroll-gates.test.ts"`
Expected: PASS both (admin-page-gates `GATE_RE` was taught `requireGlobalPermission(` in Task 2 Step 3b; the payroll guardrail confirms no bare payroll `requirePermission` remains).

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: build succeeds.

---

## Self-Review (completed during planning)

- **Spec coverage:** Layer 1 helper → Task 1; Layer 1 wiring + guardrail → Task 2; Layer 2 guard → Task 3; Layer 2 wiring → Task 4; verification → Task 5. `PAYROLL_PERMISSIONS` → Task 1. All spec units mapped.
- **Circular import:** `requireGlobalPermission` in its own module (Task 1) — the plan's Global Constraints call this out explicitly.
- **admin-page-gates interaction (flagged):** the existing guardrail (`admin-page-gates.test.ts`) matches `requirePermission(|requireRole(|requireAdminArea(|requireEmployee(`. Converting payroll pages (`payroll/page.tsx`, `settings/payroll/page.tsx`, `tools/recompute-leave/page.tsx`) to `requireGlobalPermission` would make them FAIL that guardrail unless `requireGlobalPermission(` is added to its `GATE_RE`. Task 5 Step 3 catches this; the implementer must extend `GATE_RE` in `admin-page-gates.test.ts` if the run fails. (This is a required fix, not optional — folded into Task 5's verification because it only surfaces when the full guardrail runs against the converted pages.)
- **Placeholder scan:** none.
- **Type consistency:** `requireGlobalPermission` returns the same shape as `requirePermission`; `payrollRoleBranchScopeError(role, branchId)` signature identical in Tasks 3 + 4; `PAYROLL_PERMISSIONS` tuple used in both the guard and (conceptually) the gate.
