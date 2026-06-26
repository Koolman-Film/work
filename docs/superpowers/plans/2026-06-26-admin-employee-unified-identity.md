# Admin-Employee Unified Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one LINE account be both a payroll employee and an admin — gate employee features on the `Employee` record (not the masked `Staff` tier), add a capability-aware combined LIFF home, and give legacy two-account admins a self-serve merge wizard.

**Architecture:** No new identity model — a `User` already may hold an optional `Employee` record *and* multiple `UserRoleAssignment` rows. Phase A removes the "admin ⇒ no employee" assumption by switching employee gates to "has an `Employee` record" and routing on two booleans (`hasEmployee`, `isAdminCapable`). Phase B adds a cross-auth merge (admin email session issues a single-use token; the employee LINE session redeems it) that collapses two legacy `User`s into one.

**Tech Stack:** Next.js App Router (server components + server actions), Prisma + Postgres, Supabase auth, LINE LIFF, next-intl (6 locales), vitest (unit + integration), `jose` (HS256 JWT tokens).

**Spec:** `docs/superpowers/specs/2026-06-24-admin-employee-unified-identity-design.md`

## Global Constraints

- **Source of truth for "is a worker" = the `Employee` record**, never `tier === 'Staff'` (`computeTier` is highest-wins and masks staff for admin-employees). Gate employee features on the presence of `result.employee`.
- **Auth is LINE-only for merged/admin-employees**; pure admins keep email/password login unchanged. Never break pure-admin or pure-worker behavior.
- **All user-facing copy is Thai-first** and added to all **6** locale files: `messages/{th,en,my,lo,zh-CN,km}.json` (th is the source of truth).
- **Tokens** use `jose` HS256 via `PAIRING_JWT_SECRET`, issuer `koolman-work`, audience `pair`, algorithm pinned to `HS256` (mirror `src/lib/pairing/token.ts`).
- **Money** uses `Prisma.Decimal`. **IDs** are `@db.Uuid`. **Tests** live next to source as `*.test.ts` (unit) or under `tests/integration/**/*.integration.test.ts` (integration, serial, `koolman_test` DB).
- **Migrations** are hand-written SQL in `prisma/migrations/<NNNN>_<name>/migration.sql`; next number is **0034**.
- **Phase B depends on Phase A's gate fix shipping first** — adding an admin role to an employee flips their tier to `Admin`, which the old `requireRole(['Staff'])` gate would reject.
- Commands: unit `pnpm test`; integration `pnpm test:integration`; typecheck `pnpm tsc --noEmit` (or `pnpm build`); lint/format Biome via `pnpm check` if present.

---

# PHASE A — Unified identity, Employee-gating, combined home, routing, grant-admin

*Phase A is independently shippable: after it, an admin-employee created via "grant admin to an employee" works end-to-end. Phase B only adds migration of legacy two-account users.*

## File structure (Phase A)

- `src/lib/auth/require-role.ts` — add `requireEmployee()`; rewrite `requireCheckInPermission()` to build on it. (modify)
- `src/lib/auth/require-employee.test.ts` — unit test for `requireEmployee()`. (create)
- Employee-facing gate call sites — swap `requireRole(['Staff'])` → `requireEmployee()`. (modify, enumerated in Task A2)
- `src/app/(liff)/liff/home/page.tsx` — combined capability-aware home. (create)
- `src/app/page.tsx` — root router on `(hasEmployee, isAdminCapable)`. (modify)
- `src/app/(admin)/admin/employees/actions.ts` — add `grantAdminAccess(employeeId)` action. (modify)
- `src/app/(admin)/admin/employees/[id]/edit/admin-access-section.tsx` — grant-admin UI card. (create)
- `src/app/(admin)/admin/employees/[id]/edit/page.tsx` — render the card. (modify)
- `messages/*.json` — `liffHome` + `adminAccess` namespaces (6 files). (modify)
- `tests/integration/admin-employee-gating.integration.test.ts` — admin-employee can use employee services; pure admin cannot. (create)

---

## Task A1: `requireEmployee()` helper

**Files:**
- Modify: `src/lib/auth/require-role.ts`
- Test: `src/lib/auth/require-employee.test.ts`

**Interfaces:**
- Consumes: `requireRole(roles)` → `RequireRoleResult { user, employee?, tier, authUserId }` (existing).
- Produces: `requireEmployee(): Promise<RequireRoleResult & { employee: Employee }>` — authenticated user that **has an `Employee` record**, regardless of tier. `notFound()` otherwise.

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/require-employee.test.ts` (mirrors `require-role-line-fallback.test.ts` mocking):

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireEmployee } from './require-role';

const mockedFindUnique = vi.mocked(prisma.user.findUnique);
const mockedCreateClient = vi.mocked(createClient);

function stubSession(authUser: unknown) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: authUser } }) },
    // biome-ignore lint/suspicious/noExplicitAny: minimal supabase stub
  } as any);
}
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    authUserId: 'auth-1',
    lineUserId: 'line-1',
    archivedAt: null,
    employee: { id: 'emp-1', status: 'Active' },
    roleAssignments: [{ role: { key: 'staff', isSuperadmin: false, archivedAt: null } }],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('requireEmployee', () => {
  it('passes a worker (Staff tier with an Employee)', async () => {
    stubSession({ id: 'auth-1', identities: [] });
    // biome-ignore lint/suspicious/noExplicitAny: prisma mock
    mockedFindUnique.mockResolvedValue(row() as any);
    const r = await requireEmployee();
    expect(r.employee.id).toBe('emp-1');
  });

  it('passes an admin-employee (Admin tier but has an Employee)', async () => {
    stubSession({ id: 'auth-1', identities: [] });
    mockedFindUnique.mockResolvedValue(
      // biome-ignore lint/suspicious/noExplicitAny: prisma mock
      row({
        roleAssignments: [
          { role: { key: 'staff', isSuperadmin: false, archivedAt: null } },
          { role: { key: 'admin', isSuperadmin: false, archivedAt: null } },
        ],
      }) as any,
    );
    const r = await requireEmployee();
    expect(r.tier).toBe('Admin');
    expect(r.employee.id).toBe('emp-1');
  });

  it('rejects a pure admin (no Employee record)', async () => {
    stubSession({ id: 'auth-1', identities: [] });
    mockedFindUnique.mockResolvedValue(
      // biome-ignore lint/suspicious/noExplicitAny: prisma mock
      row({
        employee: null,
        roleAssignments: [{ role: { key: 'admin', isSuperadmin: false, archivedAt: null } }],
      }) as any,
    );
    await expect(requireEmployee()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/auth/require-employee.test.ts`
Expected: FAIL — `requireEmployee` is not exported.

- [ ] **Step 3: Implement `requireEmployee` and rewrite `requireCheckInPermission`**

In `src/lib/auth/require-role.ts`, replace the existing `requireCheckInPermission` block (lines ~149-162) with:

```typescript
/**
 * Any authenticated user that HAS an Employee record — regardless of tier.
 * This is the source-of-truth gate for employee-facing features: an
 * admin-employee computes to tier 'Admin' (computeTier is highest-wins) yet
 * is still a worker, so we must NOT gate on tier === 'Staff'. Pure admins
 * (no Employee) are rejected here exactly as the old Staff gate rejected them.
 */
export async function requireEmployee(): Promise<RequireRoleResult & { employee: Employee }> {
  const result = await requireRole(['Staff', 'Admin', 'Superadmin']);
  if (!result.employee) notFound();
  return { ...result, employee: result.employee };
}

/**
 * Check-in eligibility: an employee who is Active and allowed to check in.
 * Builds on requireEmployee so admin-employees can check in too.
 */
export async function requireCheckInPermission(): Promise<
  RequireRoleResult & { employee: Employee }
> {
  const result = await requireEmployee();
  if (result.employee.status === 'Archived') notFound();
  if (!result.employee.canCheckIn) notFound();
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/auth/require-employee.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/require-role.ts src/lib/auth/require-employee.test.ts
git commit -m "feat(auth): requireEmployee() gates on the Employee record, not Staff tier"
```

---

## Task A2: Migrate employee-facing gates to `requireEmployee()`

**Files (modify each — swap `requireRole(['Staff'])` for `requireEmployee()`):**
- `src/lib/attendance/check-in.ts:134, 159, 429`
- `src/lib/leave/actions.ts:109, 329`
- `src/lib/advance/actions.ts:69, 186`
- `src/lib/employee/profile-actions.ts:78`
- `src/app/(liff)/liff/check-in/page.tsx:25`
- `src/app/(liff)/liff/summary/page.tsx:42`
- `src/app/(liff)/liff/profile/page.tsx:16`
- `src/app/(liff)/liff/calendar/page.tsx:57`
- `src/app/(liff)/liff/leave/page.tsx:59`, `src/app/(liff)/liff/leave/[id]/page.tsx:41`, `src/app/(liff)/liff/leave/new/page.tsx:22`
- `src/app/(liff)/liff/advance/page.tsx:34`, `src/app/(liff)/liff/advance/[id]/page.tsx:36`, `src/app/(liff)/liff/advance/new/page.tsx:6`
- `src/app/(liff)/liff/payslip/page.tsx:39`, `src/app/(liff)/liff/payslip/pdf/route.ts:20`

**Interfaces:**
- Consumes: `requireEmployee()` from Task A1.
- Note: each call currently looks like `const { employee } = await requireRole(['Staff']);` (some also destructure `user`, `authUserId`). `requireEmployee()` returns the same shape with `employee` **non-optional**, so the existing `if (!employee) ...` guards become dead but harmless — leave them or delete per file.

- [ ] **Step 1: Replace the gate in each file**

For every site above, change:

```typescript
const { employee } = await requireRole(['Staff']);
```

to:

```typescript
const { employee } = await requireEmployee();
```

(Preserve any extra destructured fields, e.g. `const { user, employee, authUserId } = await requireEmployee();`.) Update the import on each file: where it imported `requireRole`, import `requireEmployee` instead (or in addition, if `requireRole` is still used elsewhere in that file). For `check-in.ts`, the three check-in *mutation* sites that need eligibility should use `requireCheckInPermission()` instead if they currently re-check `canCheckIn` inline — otherwise `requireEmployee()`. Verify by reading each of the three call sites; use `requireCheckInPermission()` for the actual clock-in/out mutations and `requireEmployee()` for reads like `getCheckInState`.

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS (no type errors; `employee` is now non-optional at these sites).

- [ ] **Step 3: Run the unit suite**

Run: `pnpm test`
Expected: PASS — existing unit tests still green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(liff): gate employee features on Employee record (admin-employees included)"
```

---

## Task A3: Combined LIFF home `/liff/home`

**Files:**
- Create: `src/app/(liff)/liff/home/page.tsx`
- Modify: `messages/th.json`, `messages/en.json`, `messages/my.json`, `messages/lo.json`, `messages/zh-CN.json`, `messages/km.json`

**Interfaces:**
- Consumes: `requireRole(['Staff','Admin','Superadmin'])`, `canDo(user, 'liff.admin')`.
- Produces: the route `/liff/home`, target of the router for admin-employees (Task A4).

- [ ] **Step 1: Add the `liffHome` namespace to all 6 locale files**

In `messages/th.json` add (place near the existing `summary` namespace):

```json
  "liffHome": {
    "greeting": "สวัสดี {name}",
    "employeeGroup": "เมนูพนักงาน",
    "adminGroup": "เมนูผู้ดูแล",
    "checkIn": "ลงเวลา",
    "leave": "ขอลา",
    "advance": "เบิกเงิน",
    "approvals": "อนุมัติ",
    "dashboard": "ภาพรวม",
    "reports": "รายงาน"
  }
```

In `messages/en.json`:

```json
  "liffHome": {
    "greeting": "Hi {name}",
    "employeeGroup": "Employee",
    "adminGroup": "Admin",
    "checkIn": "Check in",
    "leave": "Leave",
    "advance": "Advance",
    "approvals": "Approvals",
    "dashboard": "Dashboard",
    "reports": "Reports"
  }
```

In `messages/my.json`, `messages/lo.json`, `messages/zh-CN.json`, `messages/km.json` add the same keys. Use these translations:

- my (Burmese): greeting `"မင်္ဂလာပါ {name}"`, employeeGroup `"ဝန်ထမ်းမီနူး"`, adminGroup `"အက်ဒမင်မီနူး"`, checkIn `"အချိန်မှတ်"`, leave `"ခွင့်တောင်း"`, advance `"ကြိုတင်ထုတ်"`, approvals `"အတည်ပြု"`, dashboard `"ခြုံငုံ"`, reports `"အစီရင်ခံစာ"`
- lo (Lao): greeting `"ສະບາຍດີ {name}"`, employeeGroup `"ເມນູພະນັກງານ"`, adminGroup `"ເມນູຜູ້ດູແລ"`, checkIn `"ລົງເວລາ"`, leave `"ຂໍລາ"`, advance `"ເບີກເງິນ"`, approvals `"ອະນຸມັດ"`, dashboard `"ພາບລວມ"`, reports `"ລາຍງານ"`
- zh-CN: greeting `"你好 {name}"`, employeeGroup `"员工菜单"`, adminGroup `"管理菜单"`, checkIn `"打卡"`, leave `"请假"`, advance `"预支"`, approvals `"审批"`, dashboard `"概览"`, reports `"报表"`
- km (Khmer): greeting `"សួស្តី {name}"`, employeeGroup `"ម៉ឺនុយបុគ្គលិក"`, adminGroup `"ម៉ឺនុយអ្នកគ្រប់គ្រង"`, checkIn `"ចុះម៉ោង"`, leave `"សុំច្បាប់"`, advance `"បើកប្រាក់"`, approvals `"អនុម័ត"`, dashboard `"ទិដ្ឋភាព"`, reports `"របាយការណ៍"`

- [ ] **Step 2: Create the home page**

Create `src/app/(liff)/liff/home/page.tsx`:

```tsx
/**
 * /liff/home — capability-aware launcher for users who are an employee, an
 * admin, or BOTH. Renders an employee button group when the resolved User has
 * an Employee record, and an admin group when they hold liff.admin. The root
 * router (src/app/page.tsx) sends admin-employees here; pure workers/admins
 * keep their existing landing pages.
 */

import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { canDo } from '@/lib/auth/check-permission';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

const tileCls =
  'flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-2 py-4 text-center text-sm font-medium text-gray-700 shadow-sm transition hover:border-primary-200 hover:text-primary-700';

export default async function LiffHomePage() {
  const { user, employee } = await requireRole(['Staff', 'Admin', 'Superadmin']);
  const hasEmployee = !!employee;
  const isAdmin = await canDo(user, 'liff.admin');
  if (!hasEmployee && !isAdmin) notFound();

  const t = await getTranslations('liffHome');
  const name = employee?.firstName ?? '';

  const pending = isAdmin
    ? await prisma.leaveRequest
        .count({ where: { status: 'Pending', deletedAt: null } })
        .then(async (lv) => lv + (await prisma.cashAdvance.count({ where: { status: 'Pending', deletedAt: null } })))
    : 0;

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 pt-8 pb-12">
      <h1 className="text-2xl font-semibold text-gray-900">{t('greeting', { name })}</h1>

      {hasEmployee && (
        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-700">
            {t('employeeGroup')}
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            <a href="/liff/check-in" className={tileCls}>{t('checkIn')}</a>
            <a href="/liff/leave" className={tileCls}>{t('leave')}</a>
            <a href="/liff/advance" className={tileCls}>{t('advance')}</a>
          </div>
        </section>
      )}

      {isAdmin && (
        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-violet-700">
            {t('adminGroup')}
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            <a href="/liff/admin/inbox" className={`${tileCls} relative`}>
              {pending > 0 && (
                <span className="absolute right-2 top-2 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {pending}
                </span>
              )}
              {t('approvals')}
            </a>
            <a href="/admin" className={tileCls}>{t('dashboard')}</a>
            <a href="/admin/reports" className={tileCls}>{t('reports')}</a>
          </div>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + build the route**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run the dev stack (`pnpm dev`), open `/liff/home` while logged in as a seeded admin-employee; confirm both groups render. (Covered automatically by Task A6 logic + e2e later.)

- [ ] **Step 5: Commit**

```bash
git add src/app/\(liff\)/liff/home/page.tsx messages/
git commit -m "feat(liff): capability-aware combined home (employee + admin groups)"
```

---

## Task A4: Root router on `(hasEmployee, isAdminCapable)`

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `computeTier`, `prisma.user.findUnique` (add `employee` select).
- Produces: routing — admin-employee → `/liff/home`; pure worker → `/liff/check-in`; pure admin → `/admin`.

- [ ] **Step 1: Update the router query + decision**

In `src/app/page.tsx`, replace the `prisma.user.findUnique({...})` + tier/redirect block (lines ~52-72) with:

```typescript
    const user = await prisma.user.findUnique({
      where: { authUserId: authUser.id },
      select: {
        archivedAt: true,
        employee: { select: { id: true } },
        roleAssignments: {
          select: {
            role: { select: { key: true, isSuperadmin: true, archivedAt: true } },
          },
        },
      },
    });
    if (user && !user.archivedAt) {
      const tier = computeTier(user.roleAssignments);
      const hasEmployee = user.employee !== null;
      const isAdminCapable = tier === 'Admin' || tier === 'Superadmin';
      if (hasEmployee && isAdminCapable) redirect('/liff/home');
      if (hasEmployee) redirect('/liff/check-in');
      if (isAdminCapable) redirect('/admin');
      // else: no employee and no admin tier → fall through to /login
    }
```

Remove the now-unused `TIER_HOMES` constant (and update the file's header comment to describe the two-boolean routing).

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Run unit suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(routing): route admin-employees to /liff/home; pure roles unchanged"
```

---

## Task A5: Grant-admin-to-employee onboarding

**Files:**
- Modify: `src/app/(admin)/admin/employees/actions.ts` (add `grantAdminAccess`)
- Create: `src/app/(admin)/admin/employees/[id]/edit/admin-access-section.tsx`
- Modify: `src/app/(admin)/admin/employees/[id]/edit/page.tsx` (render the card)
- Modify: `messages/*.json` (`adminAccess` namespace, 6 files)
- Test: `tests/integration/grant-admin-access.integration.test.ts`

**Interfaces:**
- Consumes: `requirePermission('role.assign')`, `canDo`, `prisma.roleDefinition.findUnique({where:{key:'admin'}})`, `auditLog`, `readRequestContext` (see existing `team/actions.ts` for exact imports).
- Produces: `grantAdminAccess(employeeId: string): Promise<void>` — adds a global `admin` `UserRoleAssignment` to the employee's `User`; redirects back to the employee edit page with `?notice=`/`?error=`. Once granted, the user appears in the existing `/admin/settings/team` list, so **revoke is handled by the existing team UI** (no new revoke needed).

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/grant-admin-access.integration.test.ts` (mirrors `advance-overtime.integration.test.ts` setup; calls the action's core by testing the DB effect — since the action redirects, test the underlying assignment creation by importing a small extracted helper OR assert via a thrown redirect. Here we test the helper `assignAdminRole` that the action wraps):

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { assignAdminRole } from '@/app/(admin)/admin/employees/actions';

async function resetDb() {
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.roleDefinition.deleteMany({});
  await prisma.roleDefinition.create({
    data: { key: 'admin', name: 'Admin', permissions: ['liff.admin'], isSuperadmin: false, isSystem: true },
  });
  await prisma.roleDefinition.create({
    data: { key: 'staff', name: 'Staff', permissions: [], isSuperadmin: false, isSystem: true },
  });
}

async function makeWorker() {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: 'B' } });
  const staff = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'staff' } });
  await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: staff.id, branchId: null } });
  const emp = await prisma.employee.create({
    data: {
      userId: user.id, firstName: 'A', lastName: 'B', branchId: branch.id,
      salaryType: 'Monthly', baseSalary: 20000, status: 'Active', hiredAt: new Date('2026-01-01'),
    },
  });
  return { user, emp };
}

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

describe('assignAdminRole', () => {
  it('adds a global admin assignment to the employee user', async () => {
    const { user, emp } = await makeWorker();
    await assignAdminRole(emp.id);
    const assignments = await prisma.userRoleAssignment.findMany({
      where: { userId: user.id }, include: { role: true },
    });
    const keys = assignments.map((a) => a.role.key).sort();
    expect(keys).toEqual(['admin', 'staff']);
  });

  it('is idempotent (no duplicate admin assignment)', async () => {
    const { user, emp } = await makeWorker();
    await assignAdminRole(emp.id);
    await assignAdminRole(emp.id);
    const count = await prisma.userRoleAssignment.count({
      where: { userId: user.id, role: { key: 'admin' } },
    });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:integration tests/integration/grant-admin-access.integration.test.ts`
Expected: FAIL — `assignAdminRole` not exported.

- [ ] **Step 3: Implement `assignAdminRole` + `grantAdminAccess`**

In `src/app/(admin)/admin/employees/actions.ts` add (match the file's existing imports for `prisma`, `requirePermission`, `canDo`, `auditLog`, `readRequestContext`, `revalidatePath`, `redirect`):

```typescript
/**
 * Core (auth-free, testable): ensure the employee's User holds a GLOBAL admin
 * role assignment. Idempotent — a NULL branch part means we can't use the
 * compound-unique upsert, so guard with findFirst + create (mirrors seed.ts).
 */
export async function assignAdminRole(employeeId: string): Promise<void> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true },
  });
  if (!emp) throw new Error('employee-not-found');
  const adminRole = await prisma.roleDefinition.findUnique({ where: { key: 'admin' } });
  if (!adminRole) throw new Error("System role 'admin' not found — DB seed corrupt?");
  const existing = await prisma.userRoleAssignment.findFirst({
    where: { userId: emp.userId, roleId: adminRole.id, branchId: null },
  });
  if (existing) return;
  await prisma.userRoleAssignment.create({
    data: { userId: emp.userId, roleId: adminRole.id, branchId: null },
  });
}

/**
 * Admin UI action: grant admin access to an employee. Granting a GLOBAL role
 * requires the actor be Superadmin (mirrors team/actions.ts addRoleAssignment).
 */
export async function grantAdminAccess(employeeId: string): Promise<void> {
  const { user: actor, tier } = await requirePermission('role.assign');
  if (tier !== 'Superadmin') {
    redirect(
      `/admin/employees/${employeeId}/edit?error=${encodeURIComponent('ต้องเป็น Superadmin เพื่อมอบสิทธิ์แอดมิน')}`,
    );
  }
  await assignAdminRole(employeeId);
  const ctx = await readRequestContext();
  auditLog({
    actorId: actor.id,
    action: 'roleAssignment.create',
    entityType: 'UserRoleAssignment',
    entityId: employeeId,
    after: { employeeId, roleKey: 'admin', branchId: null, via: 'employee-edit' },
    metadata: { ...ctx, source: 'admin-ui' },
  });
  revalidatePath(`/admin/employees/${employeeId}/edit`);
  redirect(
    `/admin/employees/${employeeId}/edit?notice=${encodeURIComponent('มอบสิทธิ์แอดมินเรียบร้อย')}`,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:integration tests/integration/grant-admin-access.integration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the UI card + i18n + render it**

Add `adminAccess` keys to all 6 `messages/*.json` (th source):

```json
  "adminAccess": {
    "title": "สิทธิ์แอดมิน",
    "description": "ให้พนักงานคนนี้เข้าถึงเครื่องมือผู้ดูแล (อนุมัติคำขอ ฯลฯ) ด้วยบัญชี LINE เดียวกัน",
    "grant": "ให้สิทธิ์แอดมิน",
    "alreadyAdmin": "พนักงานคนนี้เป็นแอดมินอยู่แล้ว — จัดการบทบาทได้ที่หน้า ทีมผู้ดูแล"
  }
```

(en: title `"Admin access"`, description `"Let this employee use admin tools (approvals, etc.) with the same LINE account"`, grant `"Grant admin access"`, alreadyAdmin `"Already an admin — manage roles on the Team page"`. Translate the same 4 keys for my/lo/zh-CN/km.)

Create `src/app/(admin)/admin/employees/[id]/edit/admin-access-section.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { grantAdminAccess } from '../../actions';

export async function AdminAccessSection({
  employeeId,
  isAlreadyAdmin,
}: {
  employeeId: string;
  isAlreadyAdmin: boolean;
}) {
  const t = await getTranslations('adminAccess');
  const action = grantAdminAccess.bind(null, employeeId);
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">{t('title')}</h2>
      <p className="mt-1 text-xs text-gray-500">{t('description')}</p>
      {isAlreadyAdmin ? (
        <p className="mt-3 text-xs text-gray-500">{t('alreadyAdmin')}</p>
      ) : (
        <form action={action} className="mt-3">
          <Button type="submit" variant="secondary">{t('grant')}</Button>
        </form>
      )}
    </section>
  );
}
```

In `src/app/(admin)/admin/employees/[id]/edit/page.tsx`, compute whether the employee's user already has an admin/superadmin assignment and render the card next to the other sections (e.g., after `EntitlementsSection`). Add to the page's data fetch:

```typescript
  const adminAssignment = await prisma.userRoleAssignment.findFirst({
    where: {
      user: { employee: { id } },
      role: { OR: [{ key: 'admin' }, { isSuperadmin: true }], archivedAt: null },
    },
    select: { id: true },
  });
```

and in the JSX:

```tsx
        <AdminAccessSection employeeId={id} isAlreadyAdmin={adminAssignment !== null} />
```

(import `AdminAccessSection` at the top.)

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm tsc --noEmit` → PASS, then:

```bash
git add -A
git commit -m "feat(admin): grant admin access to an employee from the employee edit page"
```

---

## Task A6: Phase-A integration test — admin-employee can use employee services

**Files:**
- Create: `tests/integration/admin-employee-gating.integration.test.ts`

**Interfaces:**
- Consumes: `assignAdminRole` (A5), an employee service that internally calls `requireEmployee()` — but those call `requireRole` which needs a Supabase session. To keep this DB-level and auth-free, assert the **gate logic** via `computeTier` + employee presence rather than the full HTTP path; the full path is covered by e2e.

- [ ] **Step 1: Write the test**

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { computeTier } from '@/lib/auth/user-tier';
import { assignAdminRole } from '@/app/(admin)/admin/employees/actions';

async function resetDb() {
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.roleDefinition.deleteMany({});
  await prisma.roleDefinition.create({ data: { key: 'admin', name: 'Admin', permissions: ['liff.admin'], isSuperadmin: false, isSystem: true } });
  await prisma.roleDefinition.create({ data: { key: 'staff', name: 'Staff', permissions: [], isSuperadmin: false, isSystem: true } });
}
beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

describe('admin-employee gating invariants', () => {
  it('an employee granted admin is tier Admin yet still has an Employee record', async () => {
    const user = await prisma.user.create({ data: {} });
    const branch = await prisma.branch.create({ data: { name: 'B' } });
    const staff = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'staff' } });
    await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: staff.id, branchId: null } });
    const emp = await prisma.employee.create({ data: { userId: user.id, firstName: 'A', lastName: 'B', branchId: branch.id, salaryType: 'Monthly', baseSalary: 20000, status: 'Active', hiredAt: new Date('2026-01-01') } });

    await assignAdminRole(emp.id);

    const reloaded = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { employee: true, roleAssignments: { include: { role: true } } },
    });
    const tier = computeTier(reloaded.roleAssignments.map((a) => ({ role: { key: a.role.key, isSuperadmin: a.role.isSuperadmin, archivedAt: a.role.archivedAt } })));
    expect(tier).toBe('Admin'); // masked — would fail the old Staff gate
    expect(reloaded.employee).not.toBeNull(); // but the source-of-truth gate passes
  });
});
```

- [ ] **Step 2: Run → expect PASS**

Run: `pnpm test:integration tests/integration/admin-employee-gating.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Full regression**

Run: `pnpm test && pnpm test:integration`
Expected: PASS (all suites).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/admin-employee-gating.integration.test.ts
git commit -m "test(auth): admin-employee is tier Admin yet retains Employee gate access"
```

**Phase A is complete and shippable here.** An admin-employee created via "grant admin access" lands on `/liff/home`, uses all employee features, and reaches admin tools.

---

# PHASE B — Self-serve merge wizard for legacy two-account admins

*Depends on Phase A (the Employee-record gate). Migrates the 1–2 legacy people who today have a separate admin `User` and employee `User`.*

## File structure (Phase B)

- `prisma/migrations/0034_user_account_merge/migration.sql` + `prisma/schema.prisma` — `User.mergeToken/mergeTokenExpiresAt/mergePromptDismissedAt`. (create/modify)
- `src/lib/pairing/token.ts` — `mintMergeToken` / `verifyMergeToken` (scope `admin-merge`). (modify)
- `src/lib/auth/merge-admin-into-employee.ts` — merge executor (transaction). (create)
- `src/lib/auth/start-admin-merge.ts` — issue token + QR (admin email session). (create)
- `src/lib/auth/link-merge-accounts.ts` — confirm action (employee LINE session). (create)
- `src/app/(liff)/liff/merge/[token]/page.tsx` + `merge-client.tsx` — LINE confirm screen. (create)
- `src/app/(admin)/admin/_components/merge-prompt-card.tsx` + a `dismissMergePrompt` action — dashboard entry point. (create)
- `src/app/(admin)/admin/page.tsx` — render the card for pure admins. (modify)
- `messages/*.json` — `mergeWizard` namespace (6 files). (modify)
- `tests/integration/merge-admin-into-employee.integration.test.ts` — value-preserving merge. (create)
- `src/lib/pairing/merge-token.test.ts` — token round-trip. (create)

---

## Task B1: Schema — merge columns on `User`

**Files:**
- Create: `prisma/migrations/0034_user_account_merge/migration.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the columns to `schema.prisma`**

In the `User` model, after `lineInviteExpiresAt`:

```prisma
  /// Single-use token for the self-serve account-merge wizard (JWT,
  /// scope='admin-merge', sub=admin User.id). Nulled on consume/regenerate.
  mergeToken             String?   @unique
  mergeTokenExpiresAt    DateTime?
  /// When a pure admin dismissed the "link your employee account" card.
  /// NULL → the card shows. Set on dismiss.
  mergePromptDismissedAt DateTime?
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/0034_user_account_merge/migration.sql`:

```sql
-- Self-serve admin↔employee account merge: single-use token + dismissal flag.
ALTER TABLE "User" ADD COLUMN "mergeToken" TEXT;
ALTER TABLE "User" ADD COLUMN "mergeTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "mergePromptDismissedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_mergeToken_key" ON "User"("mergeToken");
```

- [ ] **Step 3: Apply locally + to test DB**

Run: `pnpm db:migrate` (applies to dev) then `pnpm db:test:deploy` (applies to `koolman_test`).
Expected: migration `0034_user_account_merge` applied; `pnpm prisma generate` regenerates the client (run if not automatic).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0034_user_account_merge/
git commit -m "feat(db): add User merge token + dismissal columns (migration 0034)"
```

---

## Task B2: Merge tokens (`admin-merge` scope)

**Files:**
- Modify: `src/lib/pairing/token.ts`
- Test: `src/lib/pairing/merge-token.test.ts`

**Interfaces:**
- Produces: `mintMergeToken(adminUserId: string): Promise<{ token: string; expiresAt: Date }>` and `verifyMergeToken(token: string): Promise<{ adminUserId: string }>` — mirrors `mintAdminPairingToken`/`verifyAdminPairingToken`, scope `'admin-merge'`, 1h TTL.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pairing/merge-token.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { mintMergeToken, verifyMergeToken } from './token';

describe('merge token', () => {
  it('round-trips the admin user id', async () => {
    const { token, expiresAt } = await mintMergeToken('admin-123');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const { adminUserId } = await verifyMergeToken(token);
    expect(adminUserId).toBe('admin-123');
  });

  it('rejects an admin-pair-scoped token', async () => {
    const { mintAdminPairingToken } = await import('./token');
    const { token } = await mintAdminPairingToken('admin-123');
    await expect(verifyMergeToken(token)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL** (`mintMergeToken` not exported).

Run: `pnpm test src/lib/pairing/merge-token.test.ts`

- [ ] **Step 3: Implement in `token.ts`** (mirror the admin-pair functions; reuse `getSecret()`, issuer/audience constants):

```typescript
const MERGE_TTL_SECONDS = 3600;

export async function mintMergeToken(
  adminUserId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + MERGE_TTL_SECONDS;
  const token = await new SignJWT({ scope: 'admin-merge' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('koolman-work')
    .setAudience('pair')
    .setSubject(adminUserId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSecret());
  return { token, expiresAt: new Date(exp * 1000) };
}

export async function verifyMergeToken(token: string): Promise<{ adminUserId: string }> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: 'koolman-work',
    audience: 'pair',
    algorithms: ['HS256'],
  });
  if (payload.scope !== 'admin-merge') throw new Error('wrong-scope');
  if (!payload.sub) throw new Error('no-subject');
  return { adminUserId: payload.sub };
}
```

(Ensure `SignJWT` and `jwtVerify` are already imported in the file — they are, used by the existing functions.)

- [ ] **Step 4: Run → PASS.** `pnpm test src/lib/pairing/merge-token.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/pairing/token.ts src/lib/pairing/merge-token.test.ts
git commit -m "feat(auth): admin-merge JWT mint/verify (mirrors admin-pair token)"
```

---

## Task B3: Merge executor

**Files:**
- Create: `src/lib/auth/merge-admin-into-employee.ts`
- Test: `tests/integration/merge-admin-into-employee.integration.test.ts`

**Interfaces:**
- Produces: `mergeAdminIntoEmployee(input: { adminUserId: string; employeeUserId: string }): Promise<{ ok: true } | { ok: false; code: 'same-user' | 'admin-not-pure' | 'employee-no-record' | 'not-found' }>` — copies admin role onto the employee `User`, re-points attribution + notifications, archives the admin `User`. Value-preserving (never edits Employee data). Idempotent at the caller via token consumption.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/merge-admin-into-employee.integration.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { mergeAdminIntoEmployee } from '@/lib/auth/merge-admin-into-employee';

async function resetDb() {
  await prisma.attendance.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.roleDefinition.deleteMany({});
  await prisma.roleDefinition.create({ data: { key: 'admin', name: 'Admin', permissions: ['liff.admin'], isSuperadmin: false, isSystem: true } });
  await prisma.roleDefinition.create({ data: { key: 'staff', name: 'Staff', permissions: [], isSuperadmin: false, isSystem: true } });
}
beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

async function seedPair() {
  const adminRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'admin' } });
  const staffRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'staff' } });
  const branch = await prisma.branch.create({ data: { name: 'B' } });
  // Ua: pure admin (email, no employee)
  const ua = await prisma.user.create({ data: { email: 'boss@x.co', authUserId: crypto.randomUUID(), lineUserId: 'line-admin' } });
  await prisma.userRoleAssignment.create({ data: { userId: ua.id, roleId: adminRole.id, branchId: null } });
  // Ue: worker (employee LINE)
  const ue = await prisma.user.create({ data: { authUserId: crypto.randomUUID(), lineUserId: 'line-emp' } });
  await prisma.userRoleAssignment.create({ data: { userId: ue.id, roleId: staffRole.id, branchId: null } });
  const emp = await prisma.employee.create({ data: { userId: ue.id, firstName: 'A', lastName: 'B', branchId: branch.id, salaryType: 'Monthly', baseSalary: 20000, status: 'Active', hiredAt: new Date('2026-01-01') } });
  // An attendance the admin created manually (attribution points at Ua)
  await prisma.attendance.create({ data: { employeeId: emp.id, date: new Date('2026-06-01'), type: 'Absent', createdById: ua.id } });
  return { ua, ue, emp };
}

describe('mergeAdminIntoEmployee', () => {
  it('moves admin role to the employee user, re-points attribution, archives the admin', async () => {
    const { ua, ue, emp } = await seedPair();
    const res = await mergeAdminIntoEmployee({ adminUserId: ua.id, employeeUserId: ue.id });
    expect(res.ok).toBe(true);

    const ueRoles = await prisma.userRoleAssignment.findMany({ where: { userId: ue.id }, include: { role: true } });
    expect(ueRoles.map((r) => r.role.key).sort()).toEqual(['admin', 'staff']);

    const att = await prisma.attendance.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(att.createdById).toBe(ue.id); // re-pointed

    const archivedUa = await prisma.user.findUniqueOrThrow({ where: { id: ua.id } });
    expect(archivedUa.archivedAt).not.toBeNull();
    expect(archivedUa.email).toBeNull();
    expect(archivedUa.lineUserId).toBeNull();
  });

  it('preserves headcount (exactly one Employee before and after)', async () => {
    const { ua, ue } = await seedPair();
    const before = await prisma.employee.count();
    await mergeAdminIntoEmployee({ adminUserId: ua.id, employeeUserId: ue.id });
    const after = await prisma.employee.count();
    expect(after).toBe(before);
  });

  it('rejects when the employee user has no Employee record', async () => {
    const { ua } = await seedPair();
    const lonely = await prisma.user.create({ data: { lineUserId: 'line-x' } });
    const res = await mergeAdminIntoEmployee({ adminUserId: ua.id, employeeUserId: lonely.id });
    expect(res).toEqual({ ok: false, code: 'employee-no-record' });
  });
});
```

- [ ] **Step 2: Run → FAIL** (module missing).

Run: `pnpm test:integration tests/integration/merge-admin-into-employee.integration.test.ts`

- [ ] **Step 3: Implement the executor**

Create `src/lib/auth/merge-admin-into-employee.ts`:

```typescript
import { prisma } from '@/lib/db/prisma';

type Result =
  | { ok: true }
  | { ok: false; code: 'same-user' | 'admin-not-pure' | 'employee-no-record' | 'not-found' };

/**
 * Collapse a legacy two-account admin-employee into ONE User. Keeps the
 * employee User (all Employee-FK'd data stays put); copies the admin role,
 * re-points attribution + notifications from the admin User, then archives it.
 * Value-preserving: never edits Employee/attendance/leave/advance VALUES.
 */
export async function mergeAdminIntoEmployee(input: {
  adminUserId: string;
  employeeUserId: string;
}): Promise<Result> {
  const { adminUserId, employeeUserId } = input;
  if (adminUserId === employeeUserId) return { ok: false, code: 'same-user' };

  const [admin, employeeUser] = await Promise.all([
    prisma.user.findUnique({
      where: { id: adminUserId },
      include: { employee: { select: { id: true } }, roleAssignments: { include: { role: true } } },
    }),
    prisma.user.findUnique({
      where: { id: employeeUserId },
      include: { employee: { select: { id: true } } },
    }),
  ]);
  if (!admin || !employeeUser) return { ok: false, code: 'not-found' };
  if (admin.employee !== null) return { ok: false, code: 'admin-not-pure' };
  if (employeeUser.employee === null) return { ok: false, code: 'employee-no-record' };

  const adminRoles = admin.roleAssignments.filter(
    (a) => a.role.key === 'admin' || a.role.isSuperadmin,
  );

  await prisma.$transaction(async (tx) => {
    // 1. Copy admin role assignments onto the employee user (dedupe; NULL
    //    branch can't use compound-unique upsert — guard with findFirst).
    for (const a of adminRoles) {
      const exists = await tx.userRoleAssignment.findFirst({
        where: { userId: employeeUserId, roleId: a.roleId, branchId: a.branchId },
      });
      if (!exists) {
        await tx.userRoleAssignment.create({
          data: { userId: employeeUserId, roleId: a.roleId, branchId: a.branchId },
        });
      }
    }
    // 2. Re-point admin attribution (unconstrained UUID columns) + notifications.
    await tx.attendance.updateMany({ where: { createdById: adminUserId }, data: { createdById: employeeUserId } });
    await tx.leaveRequest.updateMany({ where: { reviewedById: adminUserId }, data: { reviewedById: employeeUserId } });
    await tx.cashAdvance.updateMany({ where: { approvedById: adminUserId }, data: { approvedById: employeeUserId } });
    await tx.overtimeEntry.updateMany({ where: { reviewedById: adminUserId }, data: { reviewedById: employeeUserId } });
    await tx.overtimeEntry.updateMany({ where: { createdById: adminUserId }, data: { createdById: employeeUserId } });
    await tx.notification.updateMany({ where: { userId: adminUserId }, data: { userId: employeeUserId } });
    // 3. Retire the admin User: remove its assignments, archive, free uniques.
    await tx.userRoleAssignment.deleteMany({ where: { userId: adminUserId } });
    await tx.user.update({
      where: { id: adminUserId },
      data: {
        archivedAt: new Date(),
        email: null,
        authUserId: null,
        lineUserId: null,
        lineInviteToken: null,
        mergeToken: null,
        mergeTokenExpiresAt: null,
      },
    });
  });

  return { ok: true };
}
```

- [ ] **Step 4: Run → PASS** (3 tests).

Run: `pnpm test:integration tests/integration/merge-admin-into-employee.integration.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/merge-admin-into-employee.ts tests/integration/merge-admin-into-employee.integration.test.ts
git commit -m "feat(auth): value-preserving merge executor (admin User → employee User)"
```

---

## Task B4: Issue the merge token (admin email session)

**Files:**
- Create: `src/lib/auth/start-admin-merge.ts`

**Interfaces:**
- Consumes: `requireRole(['Admin'])`, `mintMergeToken` (B2), `process.env.NEXT_PUBLIC_LIFF_ID`, `appBaseUrl()`, `QRCode.toDataURL` (mirror `admin-line-pairing-actions.ts`).
- Produces: `startAdminMerge(): Promise<{ ok: true; url: string; qrDataUrl: string; expiresAt: Date } | { ok: false; message: string }>` — only for a **pure admin** (no employee); stores the token on the admin `User`.

- [ ] **Step 1: Implement (mirror `createMyLinePairingLink`)**

Create `src/lib/auth/start-admin-merge.ts`:

```typescript
'use server';

import QRCode from 'qrcode';
import { requireRole } from '@/lib/auth/require-role';
import { mintMergeToken } from '@/lib/pairing/token';
import { prisma } from '@/lib/db/prisma';
import { appBaseUrl } from '@/lib/util/base-url';

export async function startAdminMerge(): Promise<
  { ok: true; url: string; qrDataUrl: string; expiresAt: Date } | { ok: false; message: string }
> {
  const { user } = await requireRole(['Admin']);
  if (user.employee) {
    return { ok: false, message: 'บัญชีนี้เป็นพนักงานอยู่แล้ว ไม่จำเป็นต้องเชื่อมบัญชี' };
  }
  const { token, expiresAt } = await mintMergeToken(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { mergeToken: token, mergeTokenExpiresAt: expiresAt },
  });
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const url = liffId
    ? `https://liff.line.me/${liffId}?liff.state=${encodeURIComponent(`?merge=${token}`)}`
    : `${appBaseUrl()}/liff/merge/${token}`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 256, margin: 2, errorCorrectionLevel: 'M' });
  return { ok: true, url, qrDataUrl, expiresAt };
}
```

Note: `requireRole` returns a plain `User` (employee stripped). Re-fetch the employee flag here:

```typescript
  const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { employee: { select: { id: true } } } });
  if (fresh?.employee) { return { ok: false, message: 'บัญชีนี้เป็นพนักงานอยู่แล้ว ไม่จำเป็นต้องเชื่อมบัญชี' }; }
```

(Use this re-fetch instead of `user.employee`; delete the `if (user.employee)` line. Confirm `appBaseUrl` lives at `src/lib/util/base-url.ts` — search for its definition and import from the correct path.)

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm tsc --noEmit` → PASS.

```bash
git add src/lib/auth/start-admin-merge.ts
git commit -m "feat(auth): startAdminMerge issues a single-use merge token + QR (pure admins)"
```

---

## Task B5: LINE confirm flow (employee session) + confirm action

**Files:**
- Create: `src/lib/auth/link-merge-accounts.ts`
- Create: `src/app/(liff)/liff/merge/[token]/page.tsx`
- Create: `src/app/(liff)/liff/merge/[token]/merge-client.tsx`
- Modify: `messages/*.json` (`mergeWizard` namespace)

**Interfaces:**
- Consumes: `createClient` (Supabase server), `verifyMergeToken` (B2), `mergeAdminIntoEmployee` (B3), `liffBootstrap` (`src/lib/liff/init.ts`).
- Produces: `linkMergeAccounts(input: { mergeToken: string }): Promise<{ ok: true } | { ok: false; code: string; message: string }>`.

- [ ] **Step 1: Implement the confirm action**

Create `src/lib/auth/link-merge-accounts.ts`:

```typescript
'use server';

import { mergeAdminIntoEmployee } from '@/lib/auth/merge-admin-into-employee';
import { verifyMergeToken } from '@/lib/pairing/token';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';

type Out = { ok: true } | { ok: false; code: string; message: string };

export async function linkMergeAccounts(input: { mergeToken: string }): Promise<Out> {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return { ok: false, code: 'no-session', message: 'ไม่พบเซสชัน กรุณาลองใหม่' };

  const lineSub = (authUser.identities ?? []).find((i) => i.provider === 'custom:line')?.id;
  if (!lineSub) return { ok: false, code: 'not-line', message: 'ต้องเข้าสู่ระบบด้วยบัญชี LINE ของพนักงาน' };

  // The employee User is whoever this LINE account belongs to.
  const employeeUser = await prisma.user.findUnique({
    where: { lineUserId: lineSub },
    select: { id: true, employee: { select: { id: true } } },
  });
  if (!employeeUser || !employeeUser.employee) {
    return { ok: false, code: 'not-employee', message: 'บัญชี LINE นี้ไม่ใช่พนักงานในระบบ' };
  }

  let adminUserId: string;
  try {
    ({ adminUserId } = await verifyMergeToken(input.mergeToken));
  } catch {
    return { ok: false, code: 'invalid-token', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' };
  }

  // Single-use + not-expired: the live token must still be on the admin row.
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { mergeToken: true, mergeTokenExpiresAt: true, archivedAt: true },
  });
  if (!admin || admin.archivedAt) return { ok: false, code: 'admin-gone', message: 'ไม่พบบัญชีผู้ดูแล' };
  if (admin.mergeToken !== input.mergeToken) {
    return { ok: false, code: 'consumed', message: 'ลิงก์ถูกใช้ไปแล้ว กรุณาสร้างใหม่' };
  }
  if (!admin.mergeTokenExpiresAt || admin.mergeTokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'expired', message: 'ลิงก์หมดอายุ กรุณาสร้างใหม่' };
  }

  const res = await mergeAdminIntoEmployee({ adminUserId, employeeUserId: employeeUser.id });
  if (!res.ok) return { ok: false, code: res.code, message: 'ไม่สามารถเชื่อมบัญชีได้' };
  return { ok: true };
}
```

- [ ] **Step 2: Add the `mergeWizard` namespace to all 6 locale files** (th source):

```json
  "mergeWizard": {
    "working": "กำลังเชื่อมบัญชี...",
    "successTitle": "เชื่อมบัญชีเรียบร้อย",
    "successBody": "ตอนนี้คุณใช้บัญชี LINE นี้เข้าถึงทั้งเมนูพนักงานและผู้ดูแลได้แล้ว",
    "errorTitle": "เชื่อมบัญชีไม่สำเร็จ",
    "retry": "ลองใหม่",
    "openHome": "ไปที่หน้าหลัก"
  }
```

(en: working `"Linking your accounts…"`, successTitle `"Accounts linked"`, successBody `"You can now use this LINE account for both employee and admin tools."`, errorTitle `"Couldn't link accounts"`, retry `"Try again"`, openHome `"Go to home"`. Translate for my/lo/zh-CN/km.)

- [ ] **Step 3: Create the page + client (mirror `pair-admin/[token]`)**

`src/app/(liff)/liff/merge/[token]/page.tsx`:

```tsx
import MergeClient from './merge-client';

type Params = Promise<{ token: string }>;

export default async function LiffMergePage({ params }: { params: Params }) {
  const { token } = await params;
  return <MergeClient mergeToken={token} />;
}
```

`src/app/(liff)/liff/merge/[token]/merge-client.tsx` (mirror `pair-admin-client.tsx`: `liffBootstrap()` → on success call `linkMergeAccounts({ mergeToken })`; render working/success/error with a retry button and an "open home" link on success). Use `useTranslations('mergeWizard')`. Reference the exact `pair-admin-client.tsx` structure for the bootstrap error mapping and state machine.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm tsc --noEmit` → PASS.

```bash
git add src/lib/auth/link-merge-accounts.ts src/app/\(liff\)/liff/merge/ messages/
git commit -m "feat(liff): merge confirm flow — employee LINE session redeems merge token"
```

---

## Task B6: Admin dashboard entry point + dismiss

**Files:**
- Create: `src/app/(admin)/admin/_components/merge-prompt-card.tsx` (client; calls `startAdminMerge` + `dismissMergePrompt`, shows QR/URL)
- Create/Modify: a `dismissMergePrompt` server action (e.g. in `src/lib/auth/start-admin-merge.ts`)
- Modify: `src/app/(admin)/admin/page.tsx` (render the card for pure admins who haven't dismissed)
- Modify: `messages/*.json` (`mergeWizard` extra keys for the card)

**Interfaces:**
- Consumes: `startAdminMerge` (B4).
- Produces: `dismissMergePrompt(): Promise<void>` — sets `mergePromptDismissedAt` on the current admin `User`.

- [ ] **Step 1: Add `dismissMergePrompt`** to `src/lib/auth/start-admin-merge.ts`:

```typescript
export async function dismissMergePrompt(): Promise<void> {
  const { user } = await requireRole(['Admin']);
  await prisma.user.update({ where: { id: user.id }, data: { mergePromptDismissedAt: new Date() } });
}
```

- [ ] **Step 2: Add card copy** to all 6 locale files under `mergeWizard`:

```json
    "cardTitle": "เชื่อมบัญชีพนักงานของคุณ",
    "cardBody": "ถ้าคุณเป็นพนักงานในระบบด้วย เชื่อมบัญชีเพื่อใช้ LINE เดียวเข้าถึงทั้งสองเมนู",
    "cardCta": "เชื่อมบัญชี",
    "dismiss": "ไม่ใช่ตอนนี้",
    "scanHint": "เปิดลิงก์นี้ด้วยบัญชี LINE ของพนักงาน"
```

(en: cardTitle `"Link your employee account"`, cardBody `"If you're also an employee here, link accounts to use one LINE for both menus."`, cardCta `"Link account"`, dismiss `"Not now"`, scanHint `"Open this with your employee LINE account."` Translate for my/lo/zh-CN/km.)

- [ ] **Step 3: Build `MergePromptCard`** (`'use client'`): a card with title/body, a "Link account" button that calls `startAdminMerge()` and renders the returned `qrDataUrl` + `url`, and a "Not now" button calling `dismissMergePrompt()`. Use `useTranslations('mergeWizard')` and the `Button` component.

- [ ] **Step 4: Render it for eligible admins** in `src/app/(admin)/admin/page.tsx`. Fetch the current user's `employee` + `mergePromptDismissedAt`:

```typescript
  const me = await prisma.user.findUnique({
    where: { authUserId: /* current session auth id from requireRole/createClient */ },
    select: { employee: { select: { id: true } }, mergePromptDismissedAt: true },
  });
  const showMergeCard = me !== null && me.employee === null && me.mergePromptDismissedAt === null;
```

Render `{showMergeCard && <MergePromptCard />}` near the top of the dashboard. (Use the page's existing session/user lookup; the admin layout already ran `requireRole(['Admin','Superadmin'])`.)

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm tsc --noEmit` → PASS.

```bash
git add -A
git commit -m "feat(admin): dismissible 'link your employee account' card on the dashboard"
```

---

## Task B7: End-to-end regression + docs

**Files:**
- Modify: none (verification task)

- [ ] **Step 1: Full suite**

Run: `pnpm test && pnpm test:integration`
Expected: PASS (all unit + integration).

- [ ] **Step 2: Typecheck/build**

Run: `pnpm tsc --noEmit` (and `pnpm build` if quick)
Expected: PASS.

- [ ] **Step 3: Manual two-session smoke (dev)**

Seed a pure-admin `User` and a separate worker `User` with distinct LINE accounts. As the admin (email login) open the dashboard → "Link account" → scan with the worker's LINE → confirm. Verify: admin role now on the worker `User`, the old admin `User` archived with nulled identity, attendance attribution re-pointed, and `/liff/home` shows both groups.

- [ ] **Step 4: Commit (if any doc/cleanup)**

```bash
git add -A
git commit -m "test: full regression for admin-employee unified identity + merge wizard"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** §1 identity (no migration) → Tasks A1–A2, A5; §2 Employee-gating → A1–A2; §3 combined home → A3; §4 routing → A4; §6 onboarding → A5; §7 merge wizard → B1–B6; data/calc safety → preserved (executor never edits values; A6/B3 assert headcount + attribution). Pure-admin support (populations table) → A4 + B6 (card only for pure admins, dismissible).
- **`liff.admin` permission** already exists on the `admin` role (migration 0029 backfill) — no permission migration needed for the combined home / merge.
- **Ordering:** do Phase A before Phase B (Global Constraints) — B's merge adds an admin role that flips tier to `Admin`, which only A's gate tolerates.
- **`appBaseUrl` / `liffBootstrap` paths:** confirm exact import paths by reading `src/lib/auth/admin-line-pairing-actions.ts` and `src/lib/liff/init.ts` before implementing B4/B5.
