# Create-admin Assignment Builder + Permission-only Landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin be created with one or more `(role @ branch)` assignments (system or custom, e.g. `Checker01 @ Branch A`) directly on the create form, and make a permission-only admin land on a usable page instead of a 404.

**Architecture:** Extract the risky logic into pure, tested helpers (`firstAccessibleAdminPath`, `parseAssignmentRows`, `systemRoleGrantError`), then wire them into a rewritten `createTeamMember` action, a multi-row client form, the home router, the `/admin` dashboard, and the sidebar. The edit page's `AssignmentsSection` is untouched and reused conceptually.

**Tech Stack:** Next.js (App Router, Server Components + Server Actions, client components), Prisma, Supabase auth, Vitest, Biome.

## Global Constraints

- **Test runner:** `npx vitest run <path>`. Typecheck: `npx tsc --noEmit`. Build: `npx next build`. All must be clean before a task is done.
- **Invariant — no visible change for Admin/Superadmin:** every gate/nav/landing path must resolve identically for system `Admin` (holds all 41 perms) and `Superadmin` (bypasses via `isSuperadmin`). Verify per task.
- **Reuse, don't re-invent guards:** per-assignment privilege checks must match `addRoleAssignment` exactly (only Superadmin grants `superadmin`; `canManageSystemRole` for system roles; global grant ⇒ Superadmin; branch-scoped grant ⇒ `canDo(actor,'role.assign',{branchId})`).
- **Thai UI copy**, match surrounding tone. Opaque rejection stays `notFound()`/redirect-with-error as the existing code does.
- **Prisma `Role` enum unchanged** (`Staff | Admin | Superadmin`). **No DB migration** in this plan.
- **NON-GOAL:** branch-scope *enforcement* (filtering what a scoped user sees). A `Checker01 @ Branch A` user still sees all branches on the live board after this plan — that is Spec B.
- **FormData arrays** use `formData.getAll('roleId')` / `formData.getAll('branchId')`, aligned by index (matches `roles/actions.ts` and `employee-schema.ts`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/auth/admin-landing.ts` (new) | `firstAccessibleAdminPath(permissions)` — pure |
| `src/lib/auth/admin-landing.test.ts` (new) | Tests for the above |
| `src/lib/auth/team-assignment.ts` (new) | `parseAssignmentRows(roleIds, branchIds)` — pure parse/dedupe/validate |
| `src/lib/auth/team-assignment.test.ts` (new) | Tests for the above |
| `src/lib/auth/team-guards.ts` (modify) | Add pure `systemRoleGrantError(actorRole, role)` |
| `src/lib/auth/team-guards.test.ts` (modify) | Tests for `systemRoleGrantError` |
| `src/app/(admin)/admin/settings/team/actions.ts` (modify) | Rewrite `createTeamMember`; refactor `addRoleAssignment`'s static checks to use the shared helper |
| `src/app/(admin)/admin/settings/team/actions.create.test.ts` (new) | Focused action test (happy + reject) |
| `src/app/(admin)/admin/settings/team/team-form.tsx` (modify) | Multi-row `(role @ branch)` client builder |
| `src/app/(admin)/admin/settings/team/new/page.tsx` (modify) | Fetch roles + branches; pass to form |
| `src/app/page.tsx` (modify) | Home router → `firstAccessibleAdminPath` |
| `src/app/(admin)/admin/page.tsx` (modify) | Graceful redirect instead of 404 when no `dashboard.read` |
| `src/components/admin/sidebar.tsx` (modify) | "ลงเวลา" visible on `attendance.read` OR `attendance.live-board`; href fallback |
| `src/lib/auth/persona-access.test.ts` (modify) | Extend with live-board-only landing/nav assertions |

---

### Task 1: Permission-only landing (`firstAccessibleAdminPath` + wiring)

**Files:**
- Create: `src/lib/auth/admin-landing.ts`, `src/lib/auth/admin-landing.test.ts`
- Modify: `src/app/page.tsx`, `src/app/(admin)/admin/page.tsx`

**Interfaces:**
- Consumes: `Permission` from `@/lib/auth/permissions`; `requireAdminArea` from `@/lib/auth/admin-area`; `permissionsFromAssignments` from `@/lib/auth/check-permission` (already used by `page.tsx`).
- Produces: `firstAccessibleAdminPath(permissions: ReadonlySet<Permission>): string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/admin-landing.test.ts
import { describe, expect, it } from 'vitest';
import { firstAccessibleAdminPath } from './admin-landing';
import type { Permission } from './permissions';
const s = (...p: Permission[]) => new Set<Permission>(p);

describe('firstAccessibleAdminPath', () => {
  it('dashboard.read → /admin', () => {
    expect(firstAccessibleAdminPath(s('dashboard.read', 'attendance.read'))).toBe('/admin');
  });
  it('live-board only → the live board', () => {
    expect(firstAccessibleAdminPath(s('attendance.live-board'))).toBe('/admin/attendance/live');
  });
  it('no dashboard, has leave.read → /admin/leave (nav order)', () => {
    expect(firstAccessibleAdminPath(s('leave.read', 'advance.read'))).toBe('/admin/leave');
  });
  it('settings-only → first settings section', () => {
    expect(firstAccessibleAdminPath(s('settings.holiday.manage'))).toBe('/admin/settings/holidays');
  });
  it('empty set → /admin fallback', () => {
    expect(firstAccessibleAdminPath(s())).toBe('/admin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/admin-landing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `admin-landing.ts`**

```ts
// src/lib/auth/admin-landing.ts
import type { Permission } from './permissions';

/**
 * First admin path the user can actually open, in sidebar order. Used so a
 * permission-only admin (e.g. a custom role without dashboard.read) lands on a
 * real page instead of /admin's 404. Returns '/admin' only when the user holds
 * dashboard.read (or as a defensive fallback for an empty set, which
 * requireAdminArea already prevents from reaching here).
 */
const LANDING_ORDER: ReadonlyArray<readonly [Permission, string]> = [
  ['dashboard.read', '/admin'],
  ['attendance.read', '/admin/attendance'],
  ['attendance.live-board', '/admin/attendance/live'],
  ['leave.read', '/admin/leave'],
  ['advance.read', '/admin/advance'],
  ['employee.read', '/admin/employees'],
  ['report.read', '/admin/reports'],
  ['payroll.read', '/admin/payroll'],
  ['settings.branch.manage', '/admin/settings/branches'],
  ['settings.department.manage', '/admin/settings/departments'],
  ['settings.accounting-group.manage', '/admin/settings/accounting-groups'],
  ['settings.leave-type.manage', '/admin/settings/leave-types'],
  ['settings.leave-config.manage', '/admin/settings/leave-config'],
  ['settings.holiday.manage', '/admin/settings/holidays'],
  ['settings.work-schedule.manage', '/admin/settings/work-schedules'],
  ['settings.attendance.manage', '/admin/settings/attendance'],
  ['team.read', '/admin/settings/team'],
  ['role.read', '/admin/settings/roles'],
];

export function firstAccessibleAdminPath(permissions: ReadonlySet<Permission>): string {
  for (const [perm, path] of LANDING_ORDER) {
    if (permissions.has(perm)) return path;
  }
  return '/admin';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/admin-landing.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Wire the home router**

In `src/app/page.tsx`, add the import and replace the admin redirect. The file already computes `permissions` via `permissionsFromAssignments(user.roleAssignments)` (added in the prior change). Change:

```tsx
// add import
import { firstAccessibleAdminPath } from '@/lib/auth/admin-landing';
// ...
// replace:  if (isAdminCapable) redirect('/admin');
if (isAdminCapable) redirect(firstAccessibleAdminPath(permissions));
```

If `page.tsx` does not currently build a `permissions` set in scope, add `const permissions = permissionsFromAssignments(user.roleAssignments);` next to the existing `isAdminCapable` computation (the import is already present from the prior change; verify and add if missing).

- [ ] **Step 6: Wire the `/admin` dashboard graceful redirect**

In `src/app/(admin)/admin/page.tsx`, replace the hard gate (`const { user } = await requirePermission('dashboard.read');` at line ~85) with an admit-then-redirect:

```tsx
import { redirect } from 'next/navigation';
import { requireAdminArea } from '@/lib/auth/admin-area';
import { firstAccessibleAdminPath } from '@/lib/auth/admin-landing';
// ...
const { user, permissions } = await requireAdminArea();
if (!permissions.has('dashboard.read')) {
  redirect(firstAccessibleAdminPath(permissions));
}
```
Keep the rest of the dashboard body unchanged (it already uses `canDo`/`user` for `canViewLiveBoard` etc.). Remove the now-unused `requirePermission` import from this file only if nothing else in it uses it (check; the body uses `canDo`, which is a different import).

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.
```bash
git add src/lib/auth/admin-landing.ts src/lib/auth/admin-landing.test.ts "src/app/page.tsx" "src/app/(admin)/admin/page.tsx"
git commit -m "feat(admin): permission-only admins land on first accessible page, not a 404"
```

---

### Task 2: Pure assignment-parsing + shared static grant guard

**Files:**
- Create: `src/lib/auth/team-assignment.ts`, `src/lib/auth/team-assignment.test.ts`
- Modify: `src/lib/auth/team-guards.ts`, `src/lib/auth/team-guards.test.ts`

**Interfaces:**
- Consumes: `Role` from `@prisma/client`; `canManageSystemRole` from `./team-guards`.
- Produces:
  ```ts
  // team-assignment.ts
  export type ParsedAssignment = { roleId: string; branchId: string | null };
  export type ParseResult = { ok: true; assignments: ParsedAssignment[] } | { ok: false; error: string };
  export function parseAssignmentRows(roleIds: string[], branchIds: string[]): ParseResult;
  // team-guards.ts
  export function systemRoleGrantError(
    actorRole: Role | null,
    role: { isSuperadmin: boolean; isSystem: boolean },
  ): string | null;
  ```
  `parseAssignmentRows`: zips the two arrays by index; `branchId === 'global'` → `null`; drops rows with an empty `roleId`; dedupes identical `(roleId, branchId)`; returns `{ok:false}` with `'กรุณาเลือกบทบาทอย่างน้อยหนึ่งรายการ'` if no valid rows, or `'ข้อมูลบทบาทไม่ถูกต้อง'` if the array lengths differ.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/auth/team-assignment.test.ts
import { describe, expect, it } from 'vitest';
import { parseAssignmentRows } from './team-assignment';

describe('parseAssignmentRows', () => {
  it('zips role+branch, maps global→null', () => {
    const r = parseAssignmentRows(['r1', 'r2'], ['global', 'b1']);
    expect(r).toEqual({ ok: true, assignments: [
      { roleId: 'r1', branchId: null }, { roleId: 'r2', branchId: 'b1' },
    ] });
  });
  it('dedupes identical (role,branch) pairs', () => {
    const r = parseAssignmentRows(['r1', 'r1'], ['b1', 'b1']);
    expect(r).toEqual({ ok: true, assignments: [{ roleId: 'r1', branchId: 'b1' }] });
  });
  it('drops empty-role rows', () => {
    const r = parseAssignmentRows(['', 'r1'], ['global', 'b1']);
    expect(r).toEqual({ ok: true, assignments: [{ roleId: 'r1', branchId: 'b1' }] });
  });
  it('errors when no valid rows', () => {
    expect(parseAssignmentRows([''], ['global'])).toEqual({ ok: false, error: 'กรุณาเลือกบทบาทอย่างน้อยหนึ่งรายการ' });
  });
  it('errors on length mismatch', () => {
    expect(parseAssignmentRows(['r1'], [])).toEqual({ ok: false, error: 'ข้อมูลบทบาทไม่ถูกต้อง' });
  });
});
```

```ts
// append to src/lib/auth/team-guards.test.ts
import { systemRoleGrantError } from './team-guards';
describe('systemRoleGrantError', () => {
  const sys = (isSuperadmin = false) => ({ isSuperadmin, isSystem: true });
  it('blocks non-Superadmin from granting the superadmin role', () => {
    expect(systemRoleGrantError('Admin', sys(true))).toBe('ต้องเป็น Superadmin เพื่อมอบบทบาท Superadmin');
  });
  it('blocks tier-less/Staff from granting a system role', () => {
    expect(systemRoleGrantError(null, sys())).toBe('ต้องมีสิทธิ์ระดับผู้ดูแลเพื่อมอบบทบาทระบบ');
    expect(systemRoleGrantError('Staff', sys())).toBe('ต้องมีสิทธิ์ระดับผู้ดูแลเพื่อมอบบทบาทระบบ');
  });
  it('allows Admin/Superadmin to grant a system role; anyone to grant a custom role', () => {
    expect(systemRoleGrantError('Admin', sys())).toBeNull();
    expect(systemRoleGrantError('Superadmin', sys(true))).toBeNull();
    expect(systemRoleGrantError(null, { isSuperadmin: false, isSystem: false })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/auth/team-assignment.test.ts src/lib/auth/team-guards.test.ts`
Expected: FAIL — `team-assignment` missing; `systemRoleGrantError` not exported.

- [ ] **Step 3: Implement both**

```ts
// src/lib/auth/team-assignment.ts
export type ParsedAssignment = { roleId: string; branchId: string | null };
export type ParseResult =
  | { ok: true; assignments: ParsedAssignment[] }
  | { ok: false; error: string };

/** Zip aligned roleId[]/branchId[] form arrays into deduped assignment rows.
 *  'global' branch maps to null. Empty-role rows are dropped. */
export function parseAssignmentRows(roleIds: string[], branchIds: string[]): ParseResult {
  if (roleIds.length !== branchIds.length) {
    return { ok: false, error: 'ข้อมูลบทบาทไม่ถูกต้อง' };
  }
  const seen = new Set<string>();
  const assignments: ParsedAssignment[] = [];
  for (let i = 0; i < roleIds.length; i++) {
    const roleId = roleIds[i]?.trim();
    if (!roleId) continue;
    const raw = branchIds[i] ?? 'global';
    const branchId = raw === 'global' ? null : raw;
    const key = `${roleId}::${branchId ?? 'global'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assignments.push({ roleId, branchId });
  }
  if (assignments.length === 0) {
    return { ok: false, error: 'กรุณาเลือกบทบาทอย่างน้อยหนึ่งรายการ' };
  }
  return { ok: true, assignments };
}
```

```ts
// add to src/lib/auth/team-guards.ts (Role already imported)
/**
 * Static (non-branch) grant guard shared by createTeamMember and
 * addRoleAssignment: a Superadmin role may only be granted by a Superadmin,
 * and any system (tier-conferring) role requires the actor to hold an admin
 * tier. Returns a Thai error string to surface, or null if allowed on these
 * grounds. Branch/global authority is checked separately by the caller.
 */
export function systemRoleGrantError(
  actorRole: Role | null,
  role: { isSuperadmin: boolean; isSystem: boolean },
): string | null {
  if (role.isSuperadmin && actorRole !== 'Superadmin') {
    return 'ต้องเป็น Superadmin เพื่อมอบบทบาท Superadmin';
  }
  if (!canManageSystemRole(actorRole, role)) {
    return 'ต้องมีสิทธิ์ระดับผู้ดูแลเพื่อมอบบทบาทระบบ';
  }
  return null;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/auth/team-assignment.test.ts src/lib/auth/team-guards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/team-assignment.ts src/lib/auth/team-assignment.test.ts src/lib/auth/team-guards.ts src/lib/auth/team-guards.test.ts
git commit -m "feat(auth): pure assignment-row parser + shared systemRoleGrantError guard"
```

---

### Task 3: Rewrite `createTeamMember` for N assignments

**Files:**
- Modify: `src/app/(admin)/admin/settings/team/actions.ts`
- Create: `src/app/(admin)/admin/settings/team/actions.create.test.ts`

**Interfaces:**
- Consumes: `parseAssignmentRows` (Task 2), `systemRoleGrantError` (Task 2), existing `canDo`, `requirePermission`, `prisma`, `getSupabaseAdminClient`, `auditLog`, `readRequestContext`.
- Produces: `createTeamMember(formData: FormData): Promise<void>` reading `email`, `password`, `roleId[]`, `branchId[]`.

- [ ] **Step 1: Write the failing action test (mock scaffold)**

```ts
// src/app/(admin)/admin/settings/team/actions.create.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn() }));

const createUser = vi.fn();
const deleteUser = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdminClient: () => ({ auth: { admin: { createUser, deleteUser } } }),
}));

const requirePermission = vi.fn();
const canDo = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  canDo: (...a: unknown[]) => canDo(...a),
}));

const userFindUnique = vi.fn();
const roleFindMany = vi.fn();
const branchFindUnique = vi.fn();
const userCreate = vi.fn();
const assignmentCreateMany = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a), create: (...a: unknown[]) => userCreate(...a) },
    roleDefinition: { findMany: (...a: unknown[]) => roleFindMany(...a) },
    branch: { findUnique: (...a: unknown[]) => branchFindUnique(...a) },
    userRoleAssignment: { createMany: (...a: unknown[]) => assignmentCreateMany(...a) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({
      user: { create: (...a: unknown[]) => userCreate(...a) },
      userRoleAssignment: { createMany: (...a: unknown[]) => assignmentCreateMany(...a) },
    }),
  },
}));

import { createTeamMember } from './actions';

function fd(email: string, password: string, rows: [string, string][]) {
  const f = new FormData();
  f.set('email', email);
  f.set('password', password);
  for (const [roleId, branchId] of rows) { f.append('roleId', roleId); f.append('branchId', branchId); }
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindUnique.mockResolvedValue(null); // email not taken
  userCreate.mockResolvedValue({ id: 'u-new' });
  assignmentCreateMany.mockResolvedValue({ count: 1 });
  createUser.mockResolvedValue({ data: { user: { id: 'auth-new' } }, error: null });
});

describe('createTeamMember', () => {
  it('Superadmin creates a custom role @ branch → createMany with the row, redirect to edit', async () => {
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, tier: 'Superadmin' });
    canDo.mockResolvedValue(true);
    roleFindMany.mockResolvedValue([{ id: 'r-check', key: 'checker01', isSuperadmin: false, isSystem: false, archivedAt: null }]);
    branchFindUnique.mockResolvedValue({ id: 'b1', archivedAt: null });

    await expect(createTeamMember(fd('a@x.io', 'password1', [['r-check', 'b1']])))
      .rejects.toThrow('REDIRECT:/admin/settings/team/u-new/edit');
    expect(createUser).toHaveBeenCalledOnce();
    expect(assignmentCreateMany).toHaveBeenCalledWith({
      data: [{ userId: 'u-new', roleId: 'r-check', branchId: 'b1' }],
    });
  });

  it('Admin granting the superadmin role is rejected before any auth user is created', async () => {
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, tier: 'Admin' });
    roleFindMany.mockResolvedValue([{ id: 'r-sa', key: 'superadmin', isSuperadmin: true, isSystem: true, archivedAt: null }]);

    await expect(createTeamMember(fd('a@x.io', 'password1', [['r-sa', 'global']])))
      .rejects.toThrow(/REDIRECT:.*error=/);
    expect(createUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "src/app/(admin)/admin/settings/team/actions.create.test.ts"`
Expected: FAIL — current `createTeamMember` reads a single `role` enum, so the createMany/redirect assertions don't match.

- [ ] **Step 3: Rewrite `createTeamMember`**

Replace the existing `createTeamMember` body (and the `RoleSchema`/`CreateSchema` it used — keep `EmailSchema`, `PasswordSchema`) with:

```ts
import { parseAssignmentRows } from '@/lib/auth/team-assignment';
import { systemRoleGrantError } from '@/lib/auth/team-guards';

const NewAccountSchema = z.object({ email: EmailSchema, password: PasswordSchema });

export async function createTeamMember(formData: FormData): Promise<void> {
  const { user: actor, tier: actorTier } = await requirePermission('team.create');

  const base = NewAccountSchema.safeParse({
    email: formData.get('email') ?? undefined,
    password: formData.get('password') ?? undefined,
  });
  if (!base.success) {
    const msg = base.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/admin/settings/team/new?error=${encodeURIComponent(msg)}`);
  }
  const { email, password } = base.data;

  const parsed = parseAssignmentRows(
    formData.getAll('roleId').map(String),
    formData.getAll('branchId').map(String),
  );
  if (!parsed.ok) {
    redirect(`/admin/settings/team/new?error=${encodeURIComponent(parsed.error)}&email=${encodeURIComponent(email)}`);
  }
  const rows = parsed.assignments;

  // Load + validate every referenced role.
  const roles = await prisma.roleDefinition.findMany({
    where: { id: { in: rows.map((r) => r.roleId) } },
    select: { id: true, key: true, isSuperadmin: true, isSystem: true, archivedAt: true },
  });
  const roleById = new Map(roles.map((r) => [r.id, r]));

  for (const row of rows) {
    const role = roleById.get(row.roleId);
    if (!role || role.archivedAt) {
      redirect(`/admin/settings/team/new?error=${encodeURIComponent('ไม่พบบทบาทที่เลือก')}&email=${encodeURIComponent(email)}`);
    }
    // Static grant guard (superadmin-only role; system-role tier requirement).
    const staticErr = systemRoleGrantError(actorTier, role);
    if (staticErr) {
      redirect(`/admin/settings/team/new?error=${encodeURIComponent(staticErr)}&email=${encodeURIComponent(email)}`);
    }
    // Branch/global authority (mirrors addRoleAssignment).
    if (row.branchId === null) {
      if (actorTier !== 'Superadmin') {
        redirect(`/admin/settings/team/new?error=${encodeURIComponent('ไม่มีสิทธิ์มอบบทบาทระดับทุกสาขา (Global)')}&email=${encodeURIComponent(email)}`);
      }
    } else {
      const branch = await prisma.branch.findUnique({ where: { id: row.branchId } });
      if (!branch || branch.archivedAt) {
        redirect(`/admin/settings/team/new?error=${encodeURIComponent('ไม่พบสาขาที่เลือก')}&email=${encodeURIComponent(email)}`);
      }
      if (!(await canDo(actor, 'role.assign', { branchId: row.branchId }))) {
        redirect(`/admin/settings/team/new?error=${encodeURIComponent('ไม่มีสิทธิ์มอบบทบาทในสาขานี้')}&email=${encodeURIComponent(email)}`);
      }
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    redirect(`/admin/settings/team/new?error=${encodeURIComponent('อีเมลนี้ถูกใช้แล้ว')}&email=${encodeURIComponent(email)}`);
  }

  const sb = getSupabaseAdminClient();
  const { data: created, error: createErr } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (createErr || !created.user) {
    redirect(`/admin/settings/team/new?error=${encodeURIComponent(createErr?.message ?? 'สร้างบัญชีไม่สำเร็จ')}&email=${encodeURIComponent(email)}`);
  }
  const authUserId = created.user.id;

  let newUserId: string;
  try {
    newUserId = await prisma.$transaction(async (tx) => {
      const dbUser = await tx.user.create({ data: { authUserId, email }, select: { id: true } });
      await tx.userRoleAssignment.createMany({
        data: rows.map((r) => ({ userId: dbUser.id, roleId: r.roleId, branchId: r.branchId })),
      });
      return dbUser.id;
    });
  } catch (err) {
    console.error('[team.create] prisma write failed after auth user; rolling back', err);
    await sb.auth.admin.deleteUser(authUserId).catch((e) => console.error('[team.create] rollback failed', e));
    redirect(`/admin/settings/team/new?error=${encodeURIComponent('บันทึกบัญชีไม่สำเร็จ ลองใหม่อีกครั้ง')}`);
  }

  const ctx = await readRequestContext();
  auditLog({
    actorId: actor.id,
    action: 'user.create',
    entityType: 'User',
    entityId: newUserId,
    after: {
      email,
      authUserId,
      assignments: rows.map((r) => ({ roleKey: roleById.get(r.roleId)?.key, branchId: r.branchId })),
    },
    metadata: { ...ctx, source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/team');
  redirect(`/admin/settings/team/${newUserId}/edit?notice=${encodeURIComponent('สร้างบัญชีเรียบร้อย')}`);
}
```

Then refactor `addRoleAssignment`'s two static checks to use the shared helper (DRY, prevents drift). Replace its inline `if (role.isSuperadmin && actorTier !== 'Superadmin') {...}` and `if (!canManageSystemRole(actorTier, role)) {...}` blocks with:

```ts
const staticErr = systemRoleGrantError(actorTier, role);
if (staticErr) {
  redirect(`/admin/settings/team/${userId}/edit?error=${encodeURIComponent(staticErr)}`);
}
```
Leave `addRoleAssignment`'s branch/global authority blocks unchanged.

- [ ] **Step 4: Run the action test + the guard/persona tests**

Run: `npx vitest run "src/app/(admin)/admin/settings/team/actions.create.test.ts" src/lib/auth/team-guards.test.ts src/lib/auth/persona-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.
```bash
git add "src/app/(admin)/admin/settings/team/actions.ts" "src/app/(admin)/admin/settings/team/actions.create.test.ts"
git commit -m "feat(admin): createTeamMember accepts multiple (role @ branch) assignments"
```

---

### Task 4: Multi-row assignment builder on the create form

**Files:**
- Modify: `src/app/(admin)/admin/settings/team/team-form.tsx`, `src/app/(admin)/admin/settings/team/new/page.tsx`

**Interfaces:**
- Consumes: server-fetched `roles: {id,name,isSuperadmin,isSystem}[]` and `branches: {id,name}[]`.
- Produces: a client form that POSTs `email`, `password`, and aligned `roleId`/`branchId` repeated fields to `createTeamMember`.

- [ ] **Step 1: Fetch roles + branches in `new/page.tsx`**

```tsx
// src/app/(admin)/admin/settings/team/new/page.tsx
import { prisma } from '@/lib/db/prisma';
// ... inside the component, after requirePermission('team.create'):
const [roles, branches] = await Promise.all([
  prisma.roleDefinition.findMany({
    where: { archivedAt: null },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, isSuperadmin: true, isSystem: true },
  }),
  prisma.branch.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
]);
```
Pass `roles={roles}` and `branches={branches}` to `<TeamCreateForm>`. Drop the old `availableRoles` prop.

- [ ] **Step 2: Rewrite `team-form.tsx` as a client multi-row builder**

Make it `'use client'`. Keep email + password fields. Replace the role `<select>` with a dynamic list. Each row appends `roleId` and `branchId` form fields so `createTeamMember`'s `getAll` reads them aligned. Use React state for the rows.

```tsx
'use client';
import { useState } from 'react';
// ...existing Card/Button/FormField/Input imports...

type RoleOpt = { id: string; name: string; isSuperadmin: boolean; isSystem: boolean };
type BranchOpt = { id: string; name: string };
type Props = {
  action: (formData: FormData) => Promise<void>;
  error?: string | null;
  email?: string | null;
  roles: RoleOpt[];
  branches: BranchOpt[];
};

export function TeamCreateForm({ action, error, email, roles, branches }: Props) {
  const [rows, setRows] = useState<{ roleId: string; branchId: string }[]>([{ roleId: '', branchId: 'global' }]);
  const addRow = () => setRows((r) => [...r, { roleId: '', branchId: 'global' }]);
  const removeRow = (i: number) => setRows((r) => (r.length === 1 ? r : r.filter((_, idx) => idx !== i)));
  const setRow = (i: number, patch: Partial<{ roleId: string; branchId: string }>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  return (
    <form action={action}>
      {/* Card + error + email + password fields unchanged */}
      {/* Assignment rows: */}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <select name="roleId" required value={row.roleId}
              onChange={(e) => setRow(i, { roleId: e.target.value })}
              className="...select classes...">
              <option value="" disabled>เลือกบทบาท...</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.isSuperadmin ? ' (Superadmin)' : ''}{!r.isSystem ? ' [กำหนดเอง]' : ''}
                </option>
              ))}
            </select>
            <select name="branchId" required value={row.branchId}
              onChange={(e) => setRow(i, { branchId: e.target.value })}
              className="...select classes...">
              <option value="global">ทุกสาขา (Global)</option>
              {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
            </select>
            <button type="button" onClick={() => removeRow(i)} aria-label="เอาออก"
              className="...icon button..." disabled={rows.length === 1}>✕</button>
          </div>
        ))}
        <button type="button" onClick={addRow} className="...">+ เพิ่มแถว</button>
      </div>
      {/* Footer: ยกเลิก + สร้างบัญชี (unchanged) */}
    </form>
  );
}
```
(Match the existing Tailwind classes used in `assignments-section.tsx` for the selects and the card chrome already in this file. Keep `defaultValue={email ?? ''}` on the email input.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` → clean. Run: `npx next build` → succeeds (the route compiles).
Expected: no type errors; `/admin/settings/team/new` builds.

- [ ] **Step 4: Manual smoke (note in report)**

On the local stack: open เพิ่มผู้ดูแล, confirm the role dropdown lists custom roles (e.g. Checker01 `[กำหนดเอง]`) + system roles; add a second row; create an account; confirm it lands on the new user's edit page with the assignments present. (If the local stack isn't available, state so and rely on tsc+build+action test.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/settings/team/team-form.tsx" "src/app/(admin)/admin/settings/team/new/page.tsx"
git commit -m "feat(admin): create-admin form is a multi-row (role @ branch) builder"
```

---

### Task 5: Sidebar "ลงเวลา" visibility for live-board-only users

**Files:**
- Modify: `src/components/admin/sidebar.tsx`

**Interfaces:**
- Consumes: existing `allowedPermissions: Permission[]` prop + the existing `anyOf` filter support.

- [ ] **Step 1: Update the attendance nav item + href resolution**

Change the attendance item from `{ href: '/admin/attendance', ..., permission: 'attendance.read' }` to use `anyOf` and resolve its href against the allowed set:

```tsx
// in SECTIONS, the งานประจำวัน attendance item:
{ href: '/admin/attendance', label: 'ลงเวลา', Icon: Clock, enabled: true, badgeKey: 'attendance',
  anyOf: ['attendance.read', 'attendance.live-board'] },
```
Then, where the item is rendered into a `<Link>`, compute the effective href for this item:
```tsx
const href =
  item.href === '/admin/attendance' && !allowed.has('attendance.read')
    ? '/admin/attendance/live'
    : item.href;
```
Use `href` in the `<Link href=...>` and in the `isActive(href)` check. (The existing `canSee`/`anyOf` filter already shows the item when the user has either permission; Admin holds `attendance.read` → href stays `/admin/attendance`, unchanged.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/sidebar.tsx
git commit -m "feat(admin): show ลงเวลา nav for live-board-only users (href falls back to live board)"
```

---

### Task 6: Extend persona test + full verification

**Files:**
- Modify: `src/lib/auth/persona-access.test.ts`

**Interfaces:**
- Consumes: `firstAccessibleAdminPath` (Task 1).

- [ ] **Step 1: Add landing assertions to the persona matrix**

```ts
// append to src/lib/auth/persona-access.test.ts
import { firstAccessibleAdminPath } from './admin-landing';

describe('Permission-only landing', () => {
  it('a live-board-only role lands on the live board', () => {
    const perms = permissionsFromAssignments(CHECKER01_LIVE);
    expect(firstAccessibleAdminPath(perms)).toBe('/admin/attendance/live');
  });
  it('Admin still lands on the dashboard (unchanged)', () => {
    expect(firstAccessibleAdminPath(permissionsFromAssignments(ADMIN))).toBe('/admin');
  });
  it('Superadmin still lands on the dashboard (unchanged)', () => {
    expect(firstAccessibleAdminPath(permissionsFromAssignments(SUPERADMIN))).toBe('/admin');
  });
});
```
Add a `CHECKER01_LIVE` fixture next to the existing persona fixtures: `[assign('checker01', false, ['attendance.live-board'])]`. (Reuse the file's existing `assign` helper and `permissionsFromAssignments` import; if `permissionsFromAssignments` isn't imported in this file yet, add it from `./check-permission`.)

- [ ] **Step 2: Run the persona test**

Run: `npx vitest run src/lib/auth/persona-access.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 3: Full verification**

Run: `npx vitest run` → all green.
Run: `npx tsc --noEmit` → clean.
Run: `npx next build` → succeeds.
Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/persona-access.test.ts
git commit -m "test(auth): persona landing — live-board-only lands on live board, system tiers unchanged"
```

---

## Self-Review

**Spec coverage:**
- Multi-row create builder → Task 4 (UI) + Task 3 (action) + Task 2 (parse). ✓
- Per-assignment guards identical to addRoleAssignment → Task 2 (`systemRoleGrantError`) + Task 3 (branch/global authority + refactor addRoleAssignment to share the helper). ✓
- `firstAccessibleAdminPath` + home router + `/admin` graceful redirect → Task 1. ✓
- Sidebar "ลงเวลา" anyOf + href fallback → Task 5. ✓
- Redirect to edit page after create → Task 3. ✓
- Audit shape `assignments[]` → Task 3. ✓
- Tests (landing pure, parse pure, guard pure, action happy+reject, persona landing) → Tasks 1,2,3,6. ✓
- Invariant (Admin/Superadmin unchanged) → asserted in Tasks 1/5/6; `next build` in Tasks 4/6. ✓
- Non-goal (no branch enforcement) → no task touches read/list queries. ✓

**Placeholder scan:** none — every code step has full code; the only prose-only step is Task 4 Step 4 (manual smoke), which is a verification action, not code.

**Type consistency:** `firstAccessibleAdminPath(ReadonlySet<Permission>): string` (Task 1) consumed in Task 6 with `permissionsFromAssignments(...)` (returns `Set<Permission>`). `parseAssignmentRows(string[], string[]): ParseResult` (Task 2) consumed in Task 3 with `formData.getAll(...).map(String)`. `systemRoleGrantError(Role|null, {isSuperadmin,isSystem}): string|null` (Task 2) consumed in Task 3 for both createTeamMember and addRoleAssignment. Form emits `roleId`/`branchId` repeated fields (Task 4) read by `getAll('roleId')`/`getAll('branchId')` (Task 3). Consistent.
