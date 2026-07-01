# Branch Enforcement — Dashboard + Calendar (Spec B6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope the dashboard (`/admin`) and calendar (`/admin/calendar`) reads to the acting admin's permitted branches, per-domain permission, with the shared `getOrgCalendarData` scoped once for all calendar consumers.

**Architecture:** `getOrgCalendarData` (src/lib/leave/team-calendar.ts) is the calendar linchpin (3 callers) — thread `permitted` into its employee-set `where` (Task 1). Scope the dashboard's inline widget reads by their domain permission (Task 2). Scope the calendar branch dropdown + convert the two detail `findUnique→findFirst`+scope (Task 3). Global/Superadmin resolve to `'all'` → `{}` → inert.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Prisma, Vitest, Biome, pnpm.

## Global Constraints

- **No new helpers, no schema/migration.** Use `employeeBranchScope`, `viaEmployeeBranchScope`, `getPermittedBranches`, `permittedBranchesFromAssignments`, type `PermittedBranches` from `src/lib/auth/branch-scope.ts`; `getUserAssignments` from `@/lib/auth/check-permission`.
- **Invariant — zero change for global/Superadmin:** `'all'` → `employeeBranchScope`/`viaEmployeeBranchScope` = `{}` → no filter added.
- **Per-domain scoping key:** pending-leave → `leave.read`; pending-advance → `advance.read`; today's-attendance + roster → `attendance.read`; shared calendar (`getOrgCalendarData`) + calendar branch dropdown → `dashboard.read`; calendar day-detail rows → the function's existing gate (`leave.approve` / `advance.approve`).
- **Org-config reads NOT scoped:** `holiday.findFirst`/`findMany`, branch-name lists for display.
- **Reads-only.** No mutation/gate change. `requireAdminArea()` on the dashboard is unchanged (it already redirects when `dashboard.read` is absent — page.tsx:89-91).
- **`server-only`:** `team-calendar.ts` imports `server-only`; the new test must `vi.mock('server-only', () => ({}))` (default vitest config has no alias).
- **Branch base:** local main `4d8727c` (B3+B4+B-LIFF+B5). Branch: `claude/spec-b6-dashboard-branch-enforcement`. tsc baseline: 0 errors.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run commands from the worktree root: `/Users/tong/Works/fai/work/.claude/worktrees/practical-satoshi-2a56f0`.

## File Structure

- `src/lib/leave/team-calendar.ts` — `getOrgCalendarData` gains `permitted` (Task 1).
- `src/app/(admin)/admin/page.tsx` — calendar card arg (Task 1) + dashboard widget scoping (Task 2).
- `src/app/(admin)/admin/calendar/page.tsx` — calendar card arg + user capture (Task 1) + branch dropdown (Task 3).
- `src/app/(admin)/admin/_calendar/actions.ts` — `loadAdminCalendar` arg (Task 1) + detail `findFirst` (Task 3).
- `src/lib/leave/team-calendar.branch.test.ts` — new (Task 1).

---

## Task 1: Scope `getOrgCalendarData` (the calendar linchpin) + its 3 callers

**Files:**
- Modify: `src/lib/leave/team-calendar.ts`
- Modify: `src/app/(admin)/admin/page.tsx`, `calendar/page.tsx`, `_calendar/actions.ts` (the `getOrgCalendarData` call sites only)
- Create: `src/lib/leave/team-calendar.branch.test.ts`

**Interfaces:**
- Consumes: `employeeBranchScope(permitted)`, `getPermittedBranches(user, 'dashboard.read')`, `type PermittedBranches`.
- Produces: `getOrgCalendarData({ monthStart, monthEnd, branchId?, permitted })`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/leave/team-calendar.branch.test.ts`:

```ts
/** Branch-scope of getOrgCalendarData's employee set (Spec B6). */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const employeeFindMany = vi.fn(async () => [] as unknown[]);
const holidayFindMany = vi.fn(async () => [] as unknown[]);
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: { findMany: (...a: unknown[]) => employeeFindMany(...a) },
    holiday: { findMany: (...a: unknown[]) => holidayFindMany(...a) },
    leaveRequest: { findMany: vi.fn(async () => []) },
    cashAdvance: { findMany: vi.fn(async () => []) },
  },
}));

import { getOrgCalendarData } from './team-calendar';

const BRANCH_A = '00000000-0000-0000-0000-00000000000a';
const M = { monthStart: new Date('2026-07-01'), monthEnd: new Date('2026-07-31') };

describe('getOrgCalendarData — permission branch scope', () => {
  it('scoped actor: AND-combines the base employee filter with employeeBranchScope', async () => {
    await getOrgCalendarData({ ...M, permitted: [BRANCH_A] });
    expect(employeeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { archivedAt: null, status: { not: 'Archived' } },
            { OR: [{ branchId: { in: [BRANCH_A] } }, { assignedBranchIds: { hasSome: [BRANCH_A] } }] },
          ],
        },
      }),
    );
  });

  it("global actor ('all'): plain base filter, no AND wrapper", async () => {
    employeeFindMany.mockClear();
    await getOrgCalendarData({ ...M, permitted: 'all' });
    expect(employeeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null, status: { not: 'Archived' } } }),
    );
  });

  it('user branchId filter still AND's the permitted scope', async () => {
    employeeFindMany.mockClear();
    await getOrgCalendarData({ ...M, branchId: BRANCH_A, permitted: [BRANCH_A] });
    const arg = employeeFindMany.mock.calls[0][0] as { where: { AND: unknown[] } };
    expect(arg.where.AND).toHaveLength(2);
    expect(arg.where.AND[0]).toMatchObject({ OR: [{ branchId: BRANCH_A }, { assignedBranchIds: { hasSome: [BRANCH_A] } }] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/leave/team-calendar.branch.test.ts`
Expected: FAIL — `getOrgCalendarData` has no `permitted` param and doesn't AND the scope.

- [ ] **Step 3: Scope `getOrgCalendarData`**

In `src/lib/leave/team-calendar.ts`, add the import (near the other `@/lib/auth` / prisma imports at the top; `Prisma` type is already imported in this file):

```ts
import { employeeBranchScope, type PermittedBranches } from '@/lib/auth/branch-scope';
```

Replace the `getOrgCalendarData` signature + employee-where block (lines 182-200):

```ts
export async function getOrgCalendarData(args: {
  monthStart: Date;
  monthEnd: Date;
  branchId?: string | null;
  permitted: PermittedBranches;
}): Promise<TeamCalendarData> {
  const { monthStart, monthEnd, branchId, permitted } = args;

  const base: Prisma.EmployeeWhereInput = {
    archivedAt: null,
    status: { not: 'Archived' },
  };
  if (branchId) {
    base.OR = [{ branchId }, { assignedBranchIds: { hasSome: [branchId] } }];
  }
  const scope = employeeBranchScope(permitted); // {} for 'all'
  const where: Prisma.EmployeeWhereInput = Object.keys(scope).length ? { AND: [base, scope] } : base;

  const employees = await prisma.employee.findMany({
    where,
    select: { id: true, firstName: true, lastName: true, nickname: true, dateOfBirth: true },
  });
```

(Leave the rest of the function — `loadEntriesAndHolidays`, the advance query, etc. — unchanged.)

- [ ] **Step 4: Update the three callers to pass `permitted` (dashboard.read)**

Each caller adds the `permitted` argument, sourced from `dashboard.read`:

**`src/app/(admin)/admin/page.tsx`** — add the import `import { getPermittedBranches } from '@/lib/auth/branch-scope';`, then before the `Promise.all` (after the `calMonth` guard, ~line 100) add:

```ts
  const calPermitted = await getPermittedBranches(user, 'dashboard.read');
```

and change the `getOrgCalendarData` call (line 187) to:

```ts
    getOrgCalendarData({ monthStart: calMonth.start, monthEnd: calMonth.end, permitted: calPermitted }),
```

**`src/app/(admin)/admin/calendar/page.tsx`** — add imports `import { getPermittedBranches } from '@/lib/auth/branch-scope';`; change line 22 `await requirePermission('dashboard.read');` to `const { user } = await requirePermission('dashboard.read');`, add `const calPermitted = await getPermittedBranches(user, 'dashboard.read');` after the `calMonth` guard, and change the call (line 34) to `getOrgCalendarData({ monthStart: calMonth.start, monthEnd: calMonth.end, permitted: calPermitted })`.

**`src/app/(admin)/admin/_calendar/actions.ts`** `loadAdminCalendar` — add imports `import { getPermittedBranches } from '@/lib/auth/branch-scope';`; change `await requirePermission('dashboard.read');` (line 29) to `const { user } = await requirePermission('dashboard.read');`, then:

```ts
  const permitted = await getPermittedBranches(user, 'dashboard.read');
  return getOrgCalendarData({
    monthStart: parsed.start,
    monthEnd: parsed.end,
    branchId: input.branchId,
    permitted,
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/leave/team-calendar.branch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors (all three callers updated together).

- [ ] **Step 7: Commit**

```bash
git add src/lib/leave/team-calendar.ts "src/app/(admin)/admin/page.tsx" "src/app/(admin)/admin/calendar/page.tsx" "src/app/(admin)/admin/_calendar/actions.ts" src/lib/leave/team-calendar.branch.test.ts
git commit -m "$(printf 'feat(dashboard): branch-scope getOrgCalendarData by dashboard.read (B6)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Scope the dashboard widget reads (page.tsx)

Wiring — scope the 8 inline dashboard reads by their domain permission. No new unit test (Server-Component read wiring; verified by tsc + build + the final review, per the spec).

**Files:**
- Modify: `src/app/(admin)/admin/page.tsx`

**Interfaces:**
- Consumes: `getUserAssignments(user.id)`, `permittedBranchesFromAssignments(assignments, perm)`, `viaEmployeeBranchScope`, `employeeBranchScope`.

- [ ] **Step 1: Load assignments once + compute the domain scopes**

In `src/app/(admin)/admin/page.tsx`, add imports:

```ts
import { employeeBranchScope, permittedBranchesFromAssignments, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { getUserAssignments } from '@/lib/auth/check-permission';
```

Replace the Task-1 line `const calPermitted = await getPermittedBranches(user, 'dashboard.read');` with a single assignment load computing all four scopes (this consolidates the calendar-card permission too, so remove the now-unused `getPermittedBranches` import if nothing else uses it):

```ts
  const assignments = await getUserAssignments(user.id);
  const leaveScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'leave.read'));
  const advScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'advance.read'));
  const attPermitted = permittedBranchesFromAssignments(assignments, 'attendance.read');
  const attScope = viaEmployeeBranchScope(attPermitted);
  const rosterScope = employeeBranchScope(attPermitted);
  const calPermitted = permittedBranchesFromAssignments(assignments, 'dashboard.read');
```

(The `getOrgCalendarData({ ..., permitted: calPermitted })` call from Task 1 stays — `calPermitted` is now sourced from the shared load.)

- [ ] **Step 2: Spread the scopes into the widget reads**

Merge each scope into its `where` in the `Promise.all` (each `where` has no pre-existing `employee`/`OR` key, so a plain spread is safe):

- `prisma.leaveRequest.count` (line 122): `where: { status: 'Pending', ...leaveScope }`
- `prisma.cashAdvance.count` (line 123): `where: { status: 'Pending', ...advScope }`
- `prisma.attendance.findMany` CheckIn today (line 124): `where: { type: 'CheckIn', date: today, ...attScope }`
- `prisma.employee.findMany` roster (line 129): `where: { archivedAt: null, status: { not: 'Archived' }, canCheckIn: true, ...rosterScope }`
- `prisma.attendance.findMany` OnLeave today (line 138): `where: { type: 'OnLeave', date: today, deletedAt: null, ...attScope }`
- `prisma.leaveRequest.findMany` recent (line 147): `where: { status: 'Pending', ...leaveScope }`
- `prisma.cashAdvance.findMany` recent (line 160): `where: { status: 'Pending', ...advScope }`
- `prisma.attendance.findMany` OnLeave detail (line 171): `where: { type: 'OnLeave', date: today, deletedAt: null, ...attScope }`
- `prisma.holiday.findFirst` (line 143): UNCHANGED (org-config)
- `prisma.user.findUnique` (line 118): UNCHANGED (self lookup)

(`rosterScope` is `employeeBranchScope(...)` — a direct-Employee `{ OR: [...] }` (or `{}`); spread into the roster where, whose top-level fields AND with the OR. `attScope`/`leaveScope`/`advScope` are `viaEmployeeBranchScope(...)` — `{ employee: {...} }` (or `{}`).)

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/page.tsx"
git commit -m "$(printf 'feat(dashboard): branch-scope the dashboard widget reads by domain permission (B6)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Scope the calendar branch dropdown + detail actions

Wiring — scope the calendar page's branch-filter dropdown, and convert the two detail `findUnique→findFirst`+scope. No new unit test (Server-Component/action read wiring; verified by tsc + build + final review).

**Files:**
- Modify: `src/app/(admin)/admin/calendar/page.tsx`
- Modify: `src/app/(admin)/admin/_calendar/actions.ts`

**Interfaces:**
- Consumes: `getPermittedBranches(user, perm)`, `viaEmployeeBranchScope`, type `PermittedBranches`.

- [ ] **Step 1: Scope the calendar branch dropdown**

In `src/app/(admin)/admin/calendar/page.tsx` (which already has `user` + `calPermitted` from Task 1), add the import `import type { Prisma } from '@prisma/client';` if not present, and scope the branch `findMany` (line 28-32):

```ts
    prisma.branch.findMany({
      where:
        calPermitted === 'all'
          ? { archivedAt: null }
          : { archivedAt: null, id: { in: calPermitted } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
```

- [ ] **Step 2: Scope `getLeaveReviewRow` (findFirst + leave.approve scope)**

In `src/app/(admin)/admin/_calendar/actions.ts`, add the import `import { getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';`. In `getLeaveReviewRow` (line 47), change `await requirePermission('leave.approve');` to `const { user } = await requirePermission('leave.approve');`, then change the `leaveRequest.findUnique` (line 51) to:

```ts
  const permitted = await getPermittedBranches(user, 'leave.approve');
  const [row, holidays, cfg] = await Promise.all([
    prisma.leaveRequest.findFirst({
      where: { id: leaveRequestId, ...viaEmployeeBranchScope(permitted) },
      select: LEAVE_SELECT,
    }),
    prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } }),
    getLeaveConfig(),
  ]);
  if (!row) return null;
```

(The existing `if (!row) return null` now also hides out-of-scope requests.)

- [ ] **Step 3: Scope `getAdvanceReviewRow` (findFirst + advance.approve scope)**

In `getAdvanceReviewRow` (line 76), change `await requirePermission('advance.approve');` to `const { user } = await requirePermission('advance.approve');`, then change the `cashAdvance.findUnique` (line 79) to:

```ts
  const permitted = await getPermittedBranches(user, 'advance.approve');
  const row = await prisma.cashAdvance.findFirst({
    where: { id: cashAdvanceId, ...viaEmployeeBranchScope(permitted) },
    select: ADVANCE_SELECT,
  });
  if (!row) return null;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/calendar/page.tsx" "src/app/(admin)/admin/_calendar/actions.ts"
git commit -m "$(printf 'feat(calendar): branch-scope the branch dropdown + day-detail review reads (B6)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm exec vitest run`
Expected: all green (existing suite + 3 new team-calendar tests). No regressions.

- [ ] **Step 2: Typecheck the whole project**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Confirm the page-gate guardrail still passes**

Run: `pnpm exec vitest run "src/app/(admin)/admin/admin-page-gates.test.ts"`
Expected: PASS (no new pages; the dashboard/calendar gates unchanged).

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: build succeeds (validates the dashboard + calendar Server Components + the `findUnique → findFirst` type changes).

---

## Self-Review (completed during planning)

- **Spec coverage:** Unit 1 (getOrgCalendarData) → Task 1; Unit 2 (dashboard widgets) → Task 2; Unit 3 (calendar page + dropdown) → Tasks 1+3; Unit 4 (calendar actions) → Tasks 1 (loadAdminCalendar) + 3 (details). All four spec units mapped.
- **Placeholder scan:** none — every step carries exact code/commands.
- **Type consistency:** `getOrgCalendarData({..., permitted})` matches all three call sites; dashboard widgets use `viaEmployeeBranchScope` (via-relation reads) vs `employeeBranchScope` (direct roster); calendar dropdown mirrors B5's `id: { in: permitted }` shape; detail actions use `findFirst` + `viaEmployeeBranchScope` + existing `return null`. Permission strings per domain (`leave.read`/`advance.read`/`attendance.read`/`dashboard.read`/`leave.approve`/`advance.approve`).
- **tsc-green-per-task:** Task 1 changes `getOrgCalendarData`'s signature and updates all three callers together. Tasks 2/3 are additive scoping on already-compiling files.
- **Caller completeness:** grep confirmed `getOrgCalendarData`'s only callers are the three updated in Task 1.
- **Known gap stated:** only `getOrgCalendarData` is unit-tested; the page/action wiring rides on tsc + build + final review (the tracked read-filter-harness gap).
