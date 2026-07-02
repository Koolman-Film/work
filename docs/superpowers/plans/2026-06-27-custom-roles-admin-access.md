# Custom Roles Confer Admin Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user who holds only a custom role (e.g. `Checker01`, `isSystem=false`) log into the admin app and see/use exactly the menus and pages their permissions allow — i.e. custom roles confer back-office admission like system tiers do, but permission-scoped.

**Architecture:** The permission layer (`canDo`/`checkAssignments`/`getPermissionsFor`) already evaluates custom roles correctly. The only blockers are **tier gates that run before permission checks** and **static navs that show every item**. We (1) extract session resolution so it no longer forces a tier, (2) admit users by *permission* not tier at the admin shell + `requirePermission`, (3) gate each nav item on its backing permission. `computeTier` keeps returning `null` for custom-only users — its meaning is unchanged; `null` just stops being fatal for permission-gated entry. Because system Admin holds an explicit permission for every nav destination, existing Admin/Superadmin behaviour is visually unchanged.

**Tech Stack:** Next.js (App Router, Server Components + Server Actions), Prisma, Supabase auth, Vitest.

## Global Constraints

- **Test runner:** `npx vitest run <path>` (script: `npm test` = `vitest run`). Vitest ^3.
- **No new tier:** the Prisma `Role` enum stays `Staff | Admin | Superadmin`. Custom-only users have `tier === null`; do not invent a 4th enum member.
- **No visual change for system roles:** Admin (`src/lib/auth/roles.ts:54`) holds 35 explicit permissions covering every nav item; Superadmin bypasses via `isSuperadmin`. Nav-gating must be a no-op for both.
- **Opaque rejection:** unauthorized access uses `notFound()` (never a "you exist but can't" message) — matches the existing pattern in `require-role.ts`.
- **Thai UI copy:** all user-facing strings are Thai; match the surrounding tone.
- **Don't bulk-migrate `requireRole`:** `check-permission.ts` warns that bulk sweeps caused regressions (commits 577328e, 7793322). Touch only the callsites named in this plan.
- **Single-query auth:** the new `resolveAuthedUser()` must load assignments **with `permissions`** so `computeTier` and `checkAssignments` both run in-memory — no extra round-trip versus today.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/lib/auth/require-role.ts` | Modify | Extract `resolveAuthedUser()` (session + user + assignments, **no** tier gate). `requireRole` reimplemented on top — behaviour unchanged. |
| `src/lib/auth/admin-area.ts` | Create | `hasAdminAreaAccess()` policy predicate + `requireAdminArea()` gate. The "what counts as back-office access" decision lives here. |
| `src/lib/auth/check-permission.ts` | Modify | `requirePermission` no longer pre-gates on tier; returns `tier: Role \| null`. Reuses `resolveAuthedUser`. |
| `src/lib/auth/team-guards.ts` | Modify | `canActOnRole` accepts `Role \| null` (null actor → denies). |
| `src/app/(admin)/layout.tsx` | Modify | Admit via `requireAdminArea()`; pass the user's permission set to `Sidebar`. |
| `src/components/admin/sidebar.tsx` | Modify | Each `NavItem` declares its backing permission; filter to the allowed set; hide empty sections. |
| `src/app/(admin)/admin/settings/layout.tsx` | Modify | Compute the permission set; pass to `SettingsNav`. |
| `src/app/(admin)/admin/settings/settings-nav.tsx` | Modify | Each settings item declares its permission; filter to allowed. |
| `src/app/page.tsx` | Modify | Home router sends users with admin-area access (incl. custom-only) to `/admin`. |
| `src/app/(admin)/admin/profile/page.tsx` | Modify | Always-visible topbar link; admit any admin-area user; badge tolerates `null` tier. |
| `src/app/(admin)/admin/payroll/page.tsx` | Modify | Replace double-gate `requireRole(['Admin','Superadmin'])` with `requirePermission('payroll.read')` to match its own layout. |

**Out of scope (follow-up, not blockers):** migrating the remaining `requireRole`-gated admin actions (`notifications/actions.ts`, `payroll/actions.ts` already permission-gated, `settings/line` feature-flagged off, owner area). A custom user without those permissions never reaches them because the nav hides the routes. Also out of scope: whether custom-role holders *receive* in-app bell notifications (`notifyAdminsInApp` recipient set) and assigning custom roles **at creation time** on the team form (the original report — once this lands, the edit-page assignment flow already works; the create form can be revisited separately).

---

### Task 1: Extract `resolveAuthedUser()` from `requireRole`

**Files:**
- Modify: `src/lib/auth/require-role.ts`
- Test: `src/lib/auth/require-role-line-fallback.test.ts` (existing — must still pass), `src/lib/auth/resolve-authed-user.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export type AuthedAssignment = {
    branchId: string | null;
    role: {
      key: string;
      name: string;
      isSuperadmin: boolean;
      archivedAt: Date | null;
      permissions: string[];
    };
  };
  export type AuthedSession = {
    user: User;          // plain User (relations stripped)
    authUserId: string;  // session auth.users.id
    assignments: AuthedAssignment[];
  };
  export async function resolveAuthedUser(): Promise<AuthedSession>;
  ```
  `resolveAuthedUser` performs steps 1–3 of today's `requireRole` (Supabase session → User lookup by `authUserId` → LIFF `custom:line` fallback → archived check → `notFound()` if no/archived user) but **does not** compute or gate on tier. The include selects `permissions` so downstream pure functions need no extra query.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/resolve-authed-user.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the Supabase server client + prisma exactly as require-role-line-fallback.test.ts does.
// (Copy its vi.mock setup for '@/lib/supabase/server' and '@/lib/db/prisma'.)
import { resolveAuthedUser } from './require-role';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe('resolveAuthedUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a custom-only user (tier-less) without throwing', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1', identities: [] } } }) },
    });
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u1', email: 'checker@x.io', authUserId: 'auth-1', archivedAt: null,
      employee: null,
      roleAssignments: [
        { branchId: null, role: { key: 'checker01', name: 'Checker01', isSuperadmin: false, archivedAt: null, permissions: ['attendance.read'] } },
      ],
    });

    const res = await resolveAuthedUser();
    expect(res.user.id).toBe('u1');
    expect(res.authUserId).toBe('auth-1');
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0].role.permissions).toEqual(['attendance.read']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/resolve-authed-user.test.ts`
Expected: FAIL — `resolveAuthedUser is not exported` / not a function.

- [ ] **Step 3: Refactor `require-role.ts`**

Extract the session/user resolution. Add `permissions` and `name` to the `role` select so the assignments carry everything `computeTier` and `checkAssignments` need.

```ts
// In src/lib/auth/require-role.ts — add ABOVE requireRole:

export type AuthedAssignment = {
  branchId: string | null;
  role: {
    key: string;
    name: string;
    isSuperadmin: boolean;
    archivedAt: Date | null;
    permissions: string[];
  };
};

export type AuthedSession = {
  user: User;
  authUserId: string;
  assignments: AuthedAssignment[];
};

const AUTHED_INCLUDE = {
  employee: true,
  roleAssignments: {
    select: {
      branchId: true,
      role: {
        select: {
          key: true,
          name: true,
          isSuperadmin: true,
          archivedAt: true,
          permissions: true,
        },
      },
    },
  },
} as const;

/**
 * Resolve the authenticated user WITHOUT requiring a system tier.
 * Session → User (by authUserId, with LIFF custom:line fallback) →
 * archived check. notFound() on no/archived user. Tier is NOT computed
 * or gated here — callers decide what tier-less means.
 */
export async function resolveAuthedUser(): Promise<AuthedSession> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) notFound();

  let user = await prisma.user.findUnique({
    where: { authUserId: authUser.id },
    include: AUTHED_INCLUDE,
  });

  if (!user) {
    const lineSub = (authUser.identities ?? []).find((i) => i.provider === 'custom:line')?.id;
    if (lineSub) {
      user = await prisma.user.findUnique({
        where: { lineUserId: lineSub },
        include: AUTHED_INCLUDE,
      });
    }
  }

  if (!user) notFound();
  if (user.archivedAt !== null) notFound();

  const { employee: _employee, roleAssignments, ...userOnly } = user;
  return {
    user: userOnly as User,
    authUserId: authUser.id,
    assignments: roleAssignments as AuthedAssignment[],
  };
}
```

Then reimplement `requireRole` on top of it. It still needs `employee` (for `requireEmployee`), so keep its own query OR have `resolveAuthedUser` also surface employee. To minimise change, keep `requireRole`'s existing body but note: `computeTier` accepts the narrower shape and `AuthedAssignment` is a superset, so passing `resolveAuthedUser().assignments` to `computeTier` type-checks. **Keep `requireRole`'s current employee handling intact** — do not regress `requireEmployee`. Concretely: leave `requireRole`'s existing query/return as-is for `employee`, but swap its assignment-bearing query to reuse `AUTHED_INCLUDE` so there is one include shape. The tier computation + allowlist check at the end is unchanged.

- [ ] **Step 4: Run the new test + the existing auth tests**

Run: `npx vitest run src/lib/auth/resolve-authed-user.test.ts src/lib/auth/require-role-line-fallback.test.ts src/lib/auth/require-employee.test.ts src/lib/auth/user-tier.test.ts`
Expected: PASS (all). The line-fallback and employee tests prove `requireRole`/`requireEmployee` behaviour is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/require-role.ts src/lib/auth/resolve-authed-user.test.ts
git commit -m "refactor(auth): extract resolveAuthedUser (tier-less session resolution)"
```

---

### Task 2: Admin-area admission policy + `requireAdminArea()`

> **★ Learning contribution:** `hasAdminAreaAccess` encodes the product policy "what lets you into the back office?" Multiple valid definitions exist (whitelist of admin perms? blacklist of staff perms? require a specific `admin.*` perm?). You'll write this predicate — see Step 3.

**Files:**
- Create: `src/lib/auth/admin-area.ts`
- Test: `src/lib/auth/admin-area.test.ts`

**Interfaces:**
- Consumes: `resolveAuthedUser` (Task 1); `permissionsFromAssignments` (`check-permission.ts`); `computeTier` (`user-tier.ts`); `Permission`, `PERMISSIONS` (`permissions.ts`).
- Produces:
  ```ts
  /** Permissions a Staff/LIFF self-service user may hold that DON'T grant back-office access. */
  export const STAFF_SELF_SERVICE_PERMISSIONS: ReadonlySet<Permission>;
  export function hasAdminAreaAccess(permissions: ReadonlySet<Permission>, tier: Role | null): boolean;
  export async function requireAdminArea(): Promise<{
    user: User; authUserId: string; tier: Role | null; permissions: Set<Permission>;
  }>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/admin-area.test.ts
import { describe, expect, it } from 'vitest';
import { hasAdminAreaAccess } from './admin-area';
import type { Permission } from './permissions';

const set = (...p: Permission[]) => new Set<Permission>(p);

describe('hasAdminAreaAccess', () => {
  it('admits a custom role with an admin permission', () => {
    expect(hasAdminAreaAccess(set('attendance.read'), null)).toBe(true);
  });
  it('admits Admin/Superadmin tiers even with empty perms (defensive)', () => {
    expect(hasAdminAreaAccess(set(), 'Admin')).toBe(true);
    expect(hasAdminAreaAccess(set(), 'Superadmin')).toBe(true);
  });
  it('denies a pure staff/LIFF user', () => {
    expect(hasAdminAreaAccess(set('liff.check-in', 'liff.leave-submit'), 'Staff')).toBe(false);
  });
  it('denies a user with no permissions and no tier', () => {
    expect(hasAdminAreaAccess(set(), null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/admin-area.test.ts`
Expected: FAIL — module `./admin-area` not found.

- [ ] **Step 3: Implement `admin-area.ts`** — *you write `hasAdminAreaAccess`*

I'll scaffold the module and the constant; **you implement the predicate body** (the `// TODO` block). The intended policy: a user has back-office access if their tier is `Admin`/`Superadmin`, OR they hold at least one permission that is NOT purely staff self-service. The four staff self-service perms are `liff.check-in`, `liff.leave-submit`, `liff.advance-submit`, `liff.profile-edit` (note: `liff.admin` is a back-office perm and must NOT be in this set).

```ts
// src/lib/auth/admin-area.ts
import type { Role, User } from '@prisma/client';
import { notFound } from 'next/navigation';
import { permissionsFromAssignments } from './check-permission';
import type { Permission } from './permissions';
import { resolveAuthedUser } from './require-role';
import { computeTier } from './user-tier';

/**
 * Permissions that a Staff/LIFF self-service user may hold which do NOT
 * by themselves justify access to the /admin back office. Anything
 * OUTSIDE this set is a back-office capability.
 */
export const STAFF_SELF_SERVICE_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'liff.check-in',
  'liff.leave-submit',
  'liff.advance-submit',
  'liff.profile-edit',
]);

/**
 * Does this user belong in the /admin back office?
 *
 * Trade-off you're deciding: a *blacklist* (any perm outside the staff
 * self-service set) auto-includes future admin permissions without
 * edits — but mis-classifying a new staff-only perm would leak access.
 * A *whitelist* is safer but needs maintenance. We default to blacklist
 * because the staff set is tiny, closed, and unlikely to grow.
 */
export function hasAdminAreaAccess(
  permissions: ReadonlySet<Permission>,
  tier: Role | null,
): boolean {
  // TODO(you): return true when tier is 'Admin' or 'Superadmin',
  // OR when `permissions` contains at least one entry that is NOT in
  // STAFF_SELF_SERVICE_PERMISSIONS. Otherwise false.
}

/**
 * Back-office admission gate. Admits Admin/Superadmin tiers AND custom
 * roles that carry any back-office permission. notFound() otherwise.
 * Returns the permission set so the layout can drive nav visibility.
 */
export async function requireAdminArea(): Promise<{
  user: User;
  authUserId: string;
  tier: Role | null;
  permissions: Set<Permission>;
}> {
  const { user, authUserId, assignments } = await resolveAuthedUser();
  const permissions = permissionsFromAssignments(assignments);
  const tier = computeTier(assignments);
  if (!hasAdminAreaAccess(permissions, tier)) notFound();
  return { user, authUserId, tier, permissions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/admin-area.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/admin-area.ts src/lib/auth/admin-area.test.ts
git commit -m "feat(auth): admin-area admission by permission (admits custom roles)"
```

---

### Task 3: Decouple `requirePermission` from the tier pre-gate

**Files:**
- Modify: `src/lib/auth/check-permission.ts`
- Modify: `src/lib/auth/team-guards.ts`
- Test: `src/lib/auth/check-permission.test.ts` (extend if exists, else create), `src/lib/auth/team-guards.test.ts` (extend if exists, else create)

**Interfaces:**
- Consumes: `resolveAuthedUser` (Task 1), `checkAssignments`/`permissionsFromAssignments` (existing in this file), `computeTier`.
- Produces:
  ```ts
  export async function requirePermission(
    permission: Permission, ctx?: { branchId?: string | null },
  ): Promise<{ user: User; authUserId: string; tier: Role | null }>;  // tier now nullable
  export function canActOnRole(actorRole: Role | null, targetRole: Role): boolean; // null actor → false
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/team-guards.test.ts  (add case; create file if absent)
import { describe, expect, it } from 'vitest';
import { canActOnRole } from './team-guards';

describe('canActOnRole with null actor', () => {
  it('a tier-less (custom-only) actor cannot act on any tier', () => {
    expect(canActOnRole(null, 'Admin')).toBe(false);
    expect(canActOnRole(null, 'Superadmin')).toBe(false);
  });
  it('existing behaviour preserved', () => {
    expect(canActOnRole('Superadmin', 'Superadmin')).toBe(true);
    expect(canActOnRole('Admin', 'Admin')).toBe(true);
    expect(canActOnRole('Admin', 'Superadmin')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/team-guards.test.ts`
Expected: FAIL — `canActOnRole(null, …)` is a type error / wrong result (currently typed `Role`, not `Role | null`).

- [ ] **Step 3: Update `canActOnRole` then `requirePermission`**

`team-guards.ts`:
```ts
export function canActOnRole(actorRole: Role | null, targetRole: Role): boolean {
  if (actorRole === 'Superadmin') return true;
  if (actorRole === 'Admin') return targetRole === 'Admin';
  return false; // null or 'Staff': no team jurisdiction
}
```

`check-permission.ts` — reimplement `requirePermission` (drop the `requireRole([...])` pre-gate, reuse the in-memory assignments; return nullable tier):
```ts
import { computeTier } from './user-tier';
import { resolveAuthedUser } from './require-role';

export async function requirePermission(
  permission: Permission,
  ctx?: { branchId?: string | null },
): Promise<{ user: User; authUserId: string; tier: Role | null }> {
  const { user, authUserId, assignments } = await resolveAuthedUser();
  if (!checkAssignments(assignments, permission, ctx)) notFound();
  const tier = computeTier(assignments);
  return { user, authUserId, tier };
}
```
Keep `canDo`, `getUserAssignments`, `checkAssignments`, `permissionsFromAssignments` exactly as-is — other code still imports them. (`checkAssignments` already accepts the `AuthedAssignment` shape: it reads `branchId`, `role.permissions`, `role.isSuperadmin`, `role.archivedAt`.)

- [ ] **Step 4: Write + run the requirePermission behaviour test**

```ts
// src/lib/auth/check-permission.test.ts  (add; mirror resolve-authed-user mock setup)
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

import { requirePermission } from './check-permission';

function mockUserWith(perms: string[]) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'a1', identities: [] } } }) },
  });
  (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'u1', email: 'c@x.io', authUserId: 'a1', archivedAt: null, employee: null,
    roleAssignments: [{ branchId: null, role: { key: 'checker01', name: 'Checker01', isSuperadmin: false, archivedAt: null, permissions: perms } }],
  });
}

describe('requirePermission for a custom-only user', () => {
  beforeEach(() => vi.clearAllMocks());
  it('passes when the custom role grants the permission (tier null)', async () => {
    mockUserWith(['attendance.read']);
    const res = await requirePermission('attendance.read');
    expect(res.user.id).toBe('u1');
    expect(res.tier).toBeNull();
  });
  it('notFound() when the permission is absent', async () => {
    mockUserWith(['attendance.read']);
    await expect(requirePermission('payroll.read')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
```

Run: `npx vitest run src/lib/auth/check-permission.test.ts src/lib/auth/team-guards.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the nullable-tier ripple, then commit**

Run: `npx tsc --noEmit`
Expected: errors ONLY where `actorTier` (now `Role | null`) is passed somewhere expecting non-null. Fix each by either (a) it flows into `canActOnRole` — now accepts null ✓, or (b) a `=== 'Superadmin'` comparison — still valid on `null`. Do NOT silence with `!`. The known callsites: `team/actions.ts` (uses `canActOnRole`, `=== 'Superadmin'` — both null-safe), `team/page.tsx`, `team/new/page.tsx`, `team/[id]/edit/page.tsx`, `employees/actions.ts:616`. Confirm each compiles; the `as 'Admin' | 'Superadmin'` cast in `edit/page.tsx:118` may need narrowing — see Task notes.

```bash
git add src/lib/auth/check-permission.ts src/lib/auth/team-guards.ts src/lib/auth/check-permission.test.ts src/lib/auth/team-guards.test.ts
git commit -m "feat(auth): requirePermission no longer pre-gates on tier; canActOnRole accepts null"
```

> **Note on `edit/page.tsx:118`** — `actorRole={actorTier as 'Admin' | 'Superadmin'}` feeds `AssignmentsSection`. A custom user reaching the team edit page must hold `team.update`; they have no system tier so `actorTier` is null. Narrow safely: pass `actorRole={actorTier === 'Superadmin' ? 'Superadmin' : 'Admin'}` (a tier-less actor with `team.update` is treated as Admin-level for the assignment UI's Superadmin-hiding logic; the server action re-checks every grant). Apply this small edit here so tsc passes.

---

### Task 4: Admit custom users at the admin shell

**Files:**
- Modify: `src/app/(admin)/layout.tsx`

**Interfaces:**
- Consumes: `requireAdminArea` (Task 2).
- Produces: passes `allowedPermissions: Permission[]` to `<Sidebar>` (Task 5 consumes).

- [ ] **Step 1: Update the layout gate + thread permissions**

```tsx
// src/app/(admin)/layout.tsx
import { requireAdminArea } from '@/lib/auth/admin-area';
// ...
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, permissions } = await requireAdminArea();
  const [leave, advance, attendance] = await Promise.all([
    prisma.leaveRequest.count({ where: { status: 'Pending' } }),
    prisma.cashAdvance.count({ where: { status: 'Pending' } }),
    prisma.attendance.count({ where: { type: 'CheckIn', checkInStatus: 'Disputed' } }),
  ]);
  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar badges={{ leave, advance, attendance }} allowedPermissions={[...permissions]} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userLabel={user.email ?? 'Admin'} userId={user.id} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
```
Update the layout's doc comment: the gate is now permission-based (admits custom roles with back-office permissions), not tier-based.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: one error — `Sidebar` doesn't yet accept `allowedPermissions`. Resolved in Task 5. (If executing strictly task-by-task, do Task 5 before re-running tsc.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/layout.tsx"
git commit -m "feat(admin): admit custom-role users at the admin shell via requireAdminArea"
```

---

### Task 5: Permission-gate the main sidebar

**Files:**
- Modify: `src/components/admin/sidebar.tsx`

**Interfaces:**
- Consumes: `allowedPermissions: Permission[]` from the layout (Task 4).
- Produces: a sidebar that renders only items whose backing permission is allowed; sections with no visible items are hidden.

Nav → permission mapping (Admin holds all of these, so no Admin-visible change): `/admin`→`dashboard.read`, `/admin/calendar`→`dashboard.read`, `/admin/attendance`→`attendance.read`, `/admin/leave`→`leave.read`, `/admin/advance`→`advance.read`, `/admin/employees`→`employee.read`, `/admin/reports`→`report.read`, `/admin/payroll`→`payroll.read`, `/admin/settings`→**anyOf** the settings/team/role perms, `/admin/accounting` & `/admin/audit`→disabled (unchanged). 

- [ ] **Step 1: Add permission metadata + filtering**

```tsx
// src/components/admin/sidebar.tsx — types
import type { Permission } from '@/lib/auth/permissions';

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  enabled?: boolean;
  badgeKey?: keyof SidebarBadges;
  /** Backing permission; item shows only if the user holds it. Omit = always show. */
  permission?: Permission;
  /** Show if the user holds ANY of these (used for hub items like Settings). */
  anyOf?: ReadonlyArray<Permission>;
};
```

Annotate `SECTIONS`:
```tsx
{ href: '/admin', label: 'หน้าหลัก', Icon: Home, enabled: true, permission: 'dashboard.read' },
{ href: '/admin/calendar', label: 'ปฏิทินงาน', Icon: CalendarDays, enabled: true, permission: 'dashboard.read' },
// งานประจำวัน:
{ href: '/admin/attendance', label: 'ลงเวลา', Icon: Clock, enabled: true, badgeKey: 'attendance', permission: 'attendance.read' },
{ href: '/admin/leave', label: 'คำขอลา', Icon: CalendarOff, enabled: true, badgeKey: 'leave', permission: 'leave.read' },
{ href: '/admin/advance', label: 'คำขอเบิก', Icon: Banknote, enabled: true, badgeKey: 'advance', permission: 'advance.read' },
// ข้อมูล & รายงาน:
{ href: '/admin/employees', label: 'พนักงาน', Icon: Users, enabled: true, permission: 'employee.read' },
{ href: '/admin/reports', label: 'รายงาน', Icon: BarChart3, enabled: true, permission: 'report.read' },
// การเงิน:
{ href: '/admin/payroll', label: 'เงินเดือน', Icon: FileText, enabled: true, permission: 'payroll.read' },
{ href: '/admin/accounting', label: 'บัญชี', Icon: Calculator }, // disabled — unchanged
// ระบบ:
{ href: '/admin/settings', label: 'ตั้งค่า', Icon: Settings, enabled: true, anyOf: [
  'settings.branch.manage','settings.department.manage','settings.accounting-group.manage',
  'settings.leave-type.manage','settings.leave-config.manage','settings.holiday.manage',
  'settings.work-schedule.manage','settings.attendance.manage','team.read','role.read',
] },
{ href: '/admin/audit', label: 'Audit log', Icon: History }, // disabled — unchanged
```

Accept the prop and filter (a `Set` for O(1) lookups). Disabled items (`enabled === false`) still render disabled regardless of permission — they're "coming soon" placeholders, not access-gated. Hide a section if it has zero visible items.

```tsx
export function Sidebar({ badges, allowedPermissions }: { badges: SidebarBadges; allowedPermissions: Permission[] }) {
  const allowed = new Set(allowedPermissions);
  const canSee = (item: NavItem) => {
    if (item.enabled === false) return true; // placeholder, always shown disabled
    if (item.anyOf) return item.anyOf.some((p) => allowed.has(p));
    if (item.permission) return allowed.has(item.permission);
    return true;
  };
  const visibleSections = SECTIONS
    .map((s) => ({ ...s, items: s.items.filter(canSee) }))
    .filter((s) => s.items.length > 0);
  // ...render visibleSections instead of SECTIONS...
}
```
Replace the `SECTIONS.map(...)` in the render with `visibleSections.map(...)`.

- [ ] **Step 2: Typecheck + build the component**

Run: `npx tsc --noEmit`
Expected: PASS (Task 4's error now resolved).

- [ ] **Step 3: Manual smoke (deferred to Task 10 verification) + Commit**

```bash
git add src/components/admin/sidebar.tsx
git commit -m "feat(admin): permission-gate sidebar nav items"
```

---

### Task 6: Permission-gate the settings sub-nav

**Files:**
- Modify: `src/app/(admin)/admin/settings/layout.tsx`
- Modify: `src/app/(admin)/admin/settings/settings-nav.tsx`

**Interfaces:**
- Consumes: `getPermissionsFor` (`check-permission.ts`) + the session user. The settings layout is a Server Component; compute the permission set there and pass `allowedPermissions: Permission[]` into `<SettingsNav>`.

- [ ] **Step 1: Compute perms in the settings layout**

```tsx
// src/app/(admin)/admin/settings/layout.tsx
import { requireAdminArea } from '@/lib/auth/admin-area';
import { SettingsNav } from './settings-nav';
// inside the component (it's async):
const { permissions } = await requireAdminArea();
// ...
<SettingsNav allowedPermissions={[...permissions]} />
```
(`requireAdminArea` re-runs once here — one extra cheap query, acceptable; it also re-asserts admission for the settings subtree.)

- [ ] **Step 2: Filter items in `settings-nav.tsx`**

```tsx
import type { Permission } from '@/lib/auth/permissions';
type Item = { href: string; label: string; desc: string; Icon: LucideIcon; permission: Permission };
```
Add `permission` to each `ITEMS` entry: branches→`settings.branch.manage`, departments→`settings.department.manage`, accounting-groups→`settings.accounting-group.manage`, leave-types→`settings.leave-type.manage`, leave-config→`settings.leave-config.manage`, holidays→`settings.holiday.manage`, work-schedules→`settings.work-schedule.manage`, attendance→`settings.attendance.manage`, team→`team.read`, roles→`role.read`, line (flagged)→`team.read`.

```tsx
export function SettingsNav({ allowedPermissions }: { allowedPermissions: Permission[] }) {
  const allowed = new Set(allowedPermissions);
  const visible = ITEMS.filter((i) => allowed.has(i.permission));
  // ...map over `visible` instead of ITEMS...
}
```

- [ ] **Step 3: Typecheck + Commit**

Run: `npx tsc --noEmit`
Expected: PASS.
```bash
git add "src/app/(admin)/admin/settings/layout.tsx" "src/app/(admin)/admin/settings/settings-nav.tsx"
git commit -m "feat(admin): permission-gate settings sub-nav"
```

---

### Task 7: Route custom users to /admin from the home router

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `hasAdminAreaAccess` + `permissionsFromAssignments` + `computeTier`.

- [ ] **Step 1: Extend the home query + routing predicate**

The query (line 42) selects `roleAssignments.role { key, isSuperadmin, archivedAt }`. Add `permissions` and `branchId` so `permissionsFromAssignments` works:
```tsx
roleAssignments: {
  select: {
    branchId: true,
    role: { select: { key: true, isSuperadmin: true, archivedAt: true, permissions: true } },
  },
},
```
Then:
```tsx
import { hasAdminAreaAccess } from '@/lib/auth/admin-area';
import { permissionsFromAssignments } from '@/lib/auth/check-permission';
// ...
const tier = computeTier(user.roleAssignments);
const permissions = permissionsFromAssignments(user.roleAssignments);
const hasEmployee = user.employee !== null;
const isAdminCapable = hasAdminAreaAccess(permissions, tier);
if (hasEmployee && isAdminCapable) redirect('/liff/home');
if (hasEmployee) redirect('/liff/check-in');
if (isAdminCapable) redirect('/admin');
```
Update the doc comment: `isAdminCapable` now means "has back-office access (system tier OR a custom role with admin permissions)".

- [ ] **Step 2: Typecheck + Commit**

Run: `npx tsc --noEmit`
Expected: PASS.
```bash
git add src/app/page.tsx
git commit -m "feat(routing): send custom-role admins to /admin from home router"
```

---

### Task 8: Fix the always-visible Profile link for custom users

**Files:**
- Modify: `src/app/(admin)/admin/profile/page.tsx`

The profile link is in the topbar user menu — visible to **every** admin-area user. It currently gates on `requireRole(['Admin','Superadmin'])`, so a custom user clicking "โปรไฟล์ของฉัน" hits a 404.

- [ ] **Step 1: Admit any admin-area user; tolerate null tier**

```tsx
import { requireAdminArea } from '@/lib/auth/admin-area';
// ...
const { user, tier } = await requireAdminArea();
```
Replace the role badge so it doesn't mislabel a custom user as "Admin":
```tsx
<Row label="บทบาท" value={<RoleBadge tier={tier} />} />
// ...
function RoleBadge({ tier }: { tier: 'Admin' | 'Superadmin' | 'Staff' | null }) {
  if (tier === 'Superadmin')
    return <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">Superadmin</span>;
  if (tier === 'Admin')
    return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Admin</span>;
  return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">บทบาทกำหนดเอง</span>;
}
```

- [ ] **Step 2: Typecheck + Commit**

Run: `npx tsc --noEmit`
Expected: PASS.
```bash
git add "src/app/(admin)/admin/profile/page.tsx"
git commit -m "fix(admin): profile page admits custom-role users; badge tolerates null tier"
```

---

### Task 9: Align the payroll page double-gate

**Files:**
- Modify: `src/app/(admin)/admin/payroll/page.tsx`

`payroll/layout.tsx` already gates on `requirePermission('payroll.read')`, but `payroll/page.tsx:80` re-gates on `requireRole(['Admin','Superadmin'])` — a custom user with `payroll.read` would pass the layout then 404 on the page. Align them.

- [ ] **Step 1: Swap the gate**

```tsx
import { requirePermission } from '@/lib/auth/check-permission';
// replace requireRole(['Admin','Superadmin']) with:
const { user } = await requirePermission('payroll.read');
```
If the page used `tier` from the result, derive what it needs from permissions instead, or drop it if unused. (Verify usage of the destructured result before editing.)

- [ ] **Step 2: Typecheck + Commit**

Run: `npx tsc --noEmit`
Expected: PASS.
```bash
git add "src/app/(admin)/admin/payroll/page.tsx"
git commit -m "fix(admin): payroll page gates on payroll.read (matches its layout)"
```

---

### Task 10: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS (no regressions; new auth tests green).

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Manual end-to-end (local stack)**

Bring up the local stack (see memory: Koolman local stack bring-up). Then:
1. As Superadmin, create custom role `Checker01` with exactly `attendance.read` + `attendance.dispute-resolve` (the "ควบคุมดูแลการเข้า-ออกงาน" intent).
2. Create a team member as Admin tier, then on their **edit** page assign `Checker01` and **remove** the Admin assignment — leaving the user custom-only. (Or seed a custom-only user directly.)
3. Log in as that user. Expected: lands on `/admin`; sidebar shows only **ภาพรวม → (none unless dashboard.read)** and **งานประจำวัน → ลงเวลา**; no Employees/Payroll/Reports/Settings. Visiting `/admin/payroll` directly → 404. Visiting `/admin/attendance` → works. Topbar "โปรไฟล์ของฉัน" → works, shows "บทบาทกำหนดเอง".
4. Log in as a normal **Admin**. Expected: sidebar identical to before this change (all items present).

- [ ] **Step 4: Commit any verification fixes, then hand off**

```bash
git add -A && git commit -m "test: verify custom-role admin access end-to-end" # only if fixes were needed
```

---

## Self-Review

**Spec coverage:**
- "Custom roles can log in" → Tasks 1–4, 7 (resolve without tier, admit by permission, route home). ✓
- "Only see the menu options they got permission for" → Tasks 5, 6 (sidebar + settings-nav gating). ✓
- "Only access pages they have permission for" → Task 3 (requirePermission works for custom users; pages already gated). ✓
- No regression for system roles → Global Constraints + Task 5/6 mapping (Admin has every backing perm) + Task 10 step 3.4. ✓
- Always-visible Profile link not broken → Task 8. ✓
- Payroll double-gate consistency → Task 9. ✓

**Placeholder scan:** The only intentional `TODO` is the designated learning contribution in Task 2 Step 3 (`hasAdminAreaAccess` body), with the exact behaviour specified in prose immediately above it. No other placeholders.

**Type consistency:** `resolveAuthedUser` → `AuthedSession.assignments: AuthedAssignment[]` consumed by `computeTier` (subset shape ✓), `checkAssignments`/`permissionsFromAssignments` (needs `branchId`,`role.permissions`,`role.isSuperadmin`,`role.archivedAt` — all present ✓). `requirePermission` returns `tier: Role | null` consumed by `canActOnRole(Role | null, …)` ✓ and `=== 'Superadmin'` comparisons (null-safe ✓). `allowedPermissions: Permission[]` produced by Task 4/6 layouts, consumed by `Sidebar`/`SettingsNav` (Task 5/6) ✓.
