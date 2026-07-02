# Branch-scope Enforcement: Foundation + Attendance (Spec B1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce branch scope on the attendance surface — a `Checker01 @ Branch A` admin sees and acts on only Branch A — via a reusable foundation, with zero change for global/Superadmin admins.

**Architecture:** A pure foundation (`permittedBranchesFromAssignments` + Prisma where-fragment builders) plus an IO wrapper `getPermittedBranches` built on the existing `getUserAssignments`. Attendance reads merge the fragment into existing `where` clauses; attendance per-record actions pass `{ branchId }` to `requirePermission` (the `void.ts` pattern). Global/Superadmin resolve to `'all'` → empty fragment → unchanged queries.

**Tech Stack:** Next.js (Server Components + Server Actions), Prisma, Supabase auth, Vitest, Biome.

## Global Constraints

- **Test:** `npx vitest run <path>`. Typecheck: `npx tsc --noEmit`. Build: `npx next build`. All clean before a task is done.
- **Invariant — zero change for global/Superadmin admins:** they hold the permission via a global (branchId=null) assignment (or `isSuperadmin`) → `getPermittedBranches` returns `'all'` → fragment is `{}` → queries identical to today. Verify per task.
- **No schema/migration change. No DB write changes.** Reads gain a filter; actions gain an authz check. Prisma `Role` enum untouched.
- **Multi-branch staff:** an employee belongs to `branchId` (home) ∪ `assignedBranchIds[]`; the filter must match either (`hasSome`).
- **NON-GOALS (do not touch):** employees/leave/advance/reports/dashboard surfaces; payroll (stays global-only); any `/admin/settings/*` org-config page (company-global, no branch field).
- **Scope-resolution semantics:** walk active assignments; a global (branchId=null) grant of the permission ⇒ `'all'`; otherwise the de-duped set of scoped branchIds granting it; none ⇒ `[]`.
- Biome runs on the pre-commit hook (ordered imports).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/auth/branch-scope.ts` (new) | `PermittedBranches`, `permittedBranchesFromAssignments`, `getPermittedBranches`, `employeeBranchScope`, `viaEmployeeBranchScope` |
| `src/lib/auth/branch-scope.test.ts` (new) | Pure tests + `getPermittedBranches` wrapper test |
| `src/lib/attendance/live.ts` (modify) | Filter live-board queries by permitted branches |
| `src/app/(admin)/admin/attendance/page.tsx` (modify) | Filter records + employee dropdown + disputed count |
| `src/app/(admin)/admin/attendance/disputed/page.tsx` (modify) | Filter disputed list |
| `src/lib/attendance/manual.ts` (modify) | `{ branchId }` ctx on `attendance.manual-create` |
| `src/lib/attendance/admin-review.ts` (modify) | `{ branchId }` ctx on `attendance.dispute-resolve` |

---

### Task 1: Foundation — `branch-scope.ts`

**Files:**
- Create: `src/lib/auth/branch-scope.ts`, `src/lib/auth/branch-scope.test.ts`

**Interfaces:**
- Consumes: `AssignmentForCheck`, `getUserAssignments` from `@/lib/auth/check-permission`; `Permission` from `@/lib/auth/permissions`; `Prisma`, `User` from `@prisma/client`.
- Produces:
  ```ts
  export type PermittedBranches = 'all' | string[];
  export function permittedBranchesFromAssignments(
    assignments: ReadonlyArray<AssignmentForCheck>, permission: Permission): PermittedBranches;
  export function getPermittedBranches(
    user: Pick<User, 'id'>, permission: Permission): Promise<PermittedBranches>;
  export function employeeBranchScope(permitted: PermittedBranches): Prisma.EmployeeWhereInput;
  export function viaEmployeeBranchScope(permitted: PermittedBranches): { employee?: Prisma.EmployeeWhereInput };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/auth/branch-scope.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { AssignmentForCheck } from './check-permission';
import {
  employeeBranchScope,
  permittedBranchesFromAssignments,
  viaEmployeeBranchScope,
} from './branch-scope';

const a = (branchId: string | null, perms: string[], isSuperadmin = false): AssignmentForCheck => ({
  branchId,
  role: { permissions: perms, isSuperadmin, archivedAt: null },
});

describe('permittedBranchesFromAssignments', () => {
  it("global grant → 'all'", () => {
    expect(permittedBranchesFromAssignments([a(null, ['attendance.read'])], 'attendance.read')).toBe('all');
  });
  it("isSuperadmin global → 'all'", () => {
    expect(permittedBranchesFromAssignments([a(null, [], true)], 'attendance.read')).toBe('all');
  });
  it('scoped grants → de-duped union', () => {
    const res = permittedBranchesFromAssignments(
      [a('b1', ['attendance.read']), a('b2', ['attendance.read']), a('b1', ['attendance.read'])],
      'attendance.read',
    );
    expect(res).toEqual(['b1', 'b2']);
  });
  it('no grant → []', () => {
    expect(permittedBranchesFromAssignments([a('b1', ['leave.read'])], 'attendance.read')).toEqual([]);
  });
  it('archived role ignored', () => {
    const res = permittedBranchesFromAssignments(
      [{ branchId: 'b1', role: { permissions: ['attendance.read'], isSuperadmin: false, archivedAt: new Date() } }],
      'attendance.read',
    );
    expect(res).toEqual([]);
  });
});

describe('employeeBranchScope', () => {
  it("'all' → no filter", () => {
    expect(employeeBranchScope('all')).toEqual({});
  });
  it('scoped → home branch OR assignedBranchIds', () => {
    expect(employeeBranchScope(['b1', 'b2'])).toEqual({
      OR: [{ branchId: { in: ['b1', 'b2'] } }, { assignedBranchIds: { hasSome: ['b1', 'b2'] } }],
    });
  });
  it('empty → matches nothing', () => {
    expect(employeeBranchScope([])).toEqual({ id: { in: [] } });
  });
});

describe('viaEmployeeBranchScope', () => {
  it("'all' → {}", () => {
    expect(viaEmployeeBranchScope('all')).toEqual({});
  });
  it('scoped → { employee: {...} }', () => {
    expect(viaEmployeeBranchScope(['b1'])).toEqual({
      employee: { OR: [{ branchId: { in: ['b1'] } }, { assignedBranchIds: { hasSome: ['b1'] } }] },
    });
  });
});

describe('getPermittedBranches (wrapper)', () => {
  it('loads assignments then resolves', async () => {
    vi.resetModules();
    vi.doMock('./check-permission', () => ({
      getUserAssignments: vi.fn().mockResolvedValue([a('b1', ['attendance.read'])]),
    }));
    const { getPermittedBranches } = await import('./branch-scope');
    const res = await getPermittedBranches({ id: 'u1' }, 'attendance.read');
    expect(res).toEqual(['b1']);
    vi.doUnmock('./check-permission');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/branch-scope.test.ts`
Expected: FAIL — module `./branch-scope` not found.

- [ ] **Step 3: Implement `branch-scope.ts`**

```ts
// src/lib/auth/branch-scope.ts
import type { Prisma, User } from '@prisma/client';
import { type AssignmentForCheck, getUserAssignments } from './check-permission';
import type { Permission } from './permissions';

/** 'all' = holds the permission via a global (branchId=null) assignment.
 *  Otherwise the de-duped scoped branchIds granting it; [] = nowhere. */
export type PermittedBranches = 'all' | string[];

/** Pure: which branches may these assignments exercise `permission` in? */
export function permittedBranchesFromAssignments(
  assignments: ReadonlyArray<AssignmentForCheck>,
  permission: Permission,
): PermittedBranches {
  const branchIds = new Set<string>();
  for (const a of assignments) {
    if (a.role.archivedAt) continue;
    const grants = a.role.isSuperadmin || a.role.permissions.includes(permission);
    if (!grants) continue;
    if (a.branchId === null) return 'all'; // global grant trumps everything
    branchIds.add(a.branchId);
  }
  return [...branchIds];
}

/** IO wrapper — one assignment load, then the pure resolution. */
export async function getPermittedBranches(
  user: Pick<User, 'id'>,
  permission: Permission,
): Promise<PermittedBranches> {
  const assignments = await getUserAssignments(user.id);
  return permittedBranchesFromAssignments(assignments, permission);
}

/** Employee where-fragment for the permitted branches. {} = no filter (global).
 *  Matches home branch OR assignedBranchIds (multi-branch staff). [] = nothing. */
export function employeeBranchScope(permitted: PermittedBranches): Prisma.EmployeeWhereInput {
  if (permitted === 'all') return {};
  if (permitted.length === 0) return { id: { in: [] } };
  return {
    OR: [{ branchId: { in: permitted } }, { assignedBranchIds: { hasSome: permitted } }],
  };
}

/** For via-Employee models (Attendance/Leave/Advance/...). {} when 'all'. */
export function viaEmployeeBranchScope(
  permitted: PermittedBranches,
): { employee?: Prisma.EmployeeWhereInput } {
  if (permitted === 'all') return {};
  return { employee: employeeBranchScope(permitted) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/branch-scope.test.ts`
Expected: PASS (all). Then `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/branch-scope.ts src/lib/auth/branch-scope.test.ts
git commit -m "feat(auth): branch-scope foundation — getPermittedBranches + employee where-fragments"
```

---

### Task 2: Attendance read filtering (live board, list, disputed)

**Files:**
- Modify: `src/lib/attendance/live.ts`, `src/app/(admin)/admin/attendance/page.tsx`, `src/app/(admin)/admin/attendance/disputed/page.tsx`

**Interfaces:**
- Consumes: `getPermittedBranches`, `employeeBranchScope`, `viaEmployeeBranchScope` (Task 1).

- [ ] **Step 1: Live board — `src/lib/attendance/live.ts`**

Capture the user from the gate, resolve permitted branches, and merge the fragment into the three data queries. Add the import `import { getPermittedBranches, employeeBranchScope, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';`.

```ts
const { user } = await requirePermission('attendance.live-board');
const permitted = await getPermittedBranches(user, 'attendance.live-board');
const today = bangkokDateUtcMidnight(new Date());

const [checkInRows, rosterRows, onLeaveRows, holiday] = await Promise.all([
  prisma.attendance.findMany({
    where: { type: 'CheckIn', date: today, ...viaEmployeeBranchScope(permitted) },
    orderBy: { clockInAt: 'desc' },
    select: { /* unchanged */ },
  }),
  prisma.employee.findMany({
    where: { archivedAt: null, status: { not: 'Archived' }, canCheckIn: true, ...employeeBranchScope(permitted) },
    orderBy: [{ branch: { name: 'asc' } }, { firstName: 'asc' }],
    select: { /* unchanged */ },
  }),
  prisma.attendance.findMany({
    where: { type: 'OnLeave', date: today, deletedAt: null, ...viaEmployeeBranchScope(permitted) },
    orderBy: [{ employee: { branch: { name: 'asc' } } }, { employee: { firstName: 'asc' } }],
    select: { /* unchanged */ },
  }),
  prisma.holiday.findFirst({ where: { date: today, archivedAt: null }, select: { id: true } }),
]);
```
(Keep the existing `select` blocks verbatim — only the `where` and the two new lines change. `employeeBranchScope`/`viaEmployeeBranchScope` return `{}` for `'all'`, so the spread is a no-op for global/Superadmin. The roster `where` has no pre-existing `OR`, so spreading `employeeBranchScope`'s `OR` is safe.)

- [ ] **Step 2: Attendance list — `src/app/(admin)/admin/attendance/page.tsx`**

Capture the user, resolve permitted branches for `attendance.read`, fold the via-employee fragment into `baseWhere`, scope the employee dropdown and the disputed count. Add the import.

```ts
const { user } = await requirePermission('attendance.read');
// ... existing ym/month/filter parsing ...
const permitted = await getPermittedBranches(user, 'attendance.read');
const branchScope = viaEmployeeBranchScope(permitted); // {} or { employee: {...} }

const baseWhere = {
  date: { gte: month.start, lte: month.end },
  ...(employeeFilter ? { employeeId: employeeFilter } : {}),
  ...(typeFilter ? { type: typeFilter } : {}),
  ...branchScope,
};
// records query + trash query already spread baseWhere — no further change.

// employee dropdown:
prisma.employee.findMany({
  where: { archivedAt: null, ...employeeBranchScope(permitted) },
  orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  select: { id: true, firstName: true, lastName: true, nickname: true },
}),
// disputed count:
prisma.attendance.count({
  where: { type: 'CheckIn', checkInStatus: 'Disputed', deletedAt: null, ...branchScope },
}),
```

- [ ] **Step 3: Disputed list — `src/app/(admin)/admin/attendance/disputed/page.tsx`**

Read the file. It gates on `attendance.read` and runs an `attendance.findMany` (disputed check-ins). Apply the identical pattern: `const { user } = await requirePermission('attendance.read');` → `const permitted = await getPermittedBranches(user, 'attendance.read');` → merge `...viaEmployeeBranchScope(permitted)` into that query's `where` (and any disputed count it computes). Add the import. Do not change `select`/ordering.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx next build` → succeeds (`/admin/attendance`, `/admin/attendance/live`, `/admin/attendance/disputed` compile).

- [ ] **Step 5: Manual smoke (note in report)**

On the local stack: as a global Admin the live board + list show all branches (unchanged). As a `Checker01 @ Branch A` user (custom role with `attendance.live-board`/`attendance.read` scoped to Branch A), the live board + list show only Branch A's employees/records, including a rotating employee whose `assignedBranchIds` contains Branch A. If the local stack is unavailable, state so; the foundation tests + tsc + build stand in.

- [ ] **Step 6: Commit**

```bash
git add src/lib/attendance/live.ts "src/app/(admin)/admin/attendance/page.tsx" "src/app/(admin)/admin/attendance/disputed/page.tsx"
git commit -m "feat(attendance): filter live board, list, and disputed to the actor's permitted branches"
```

---

### Task 3: Attendance write gating (manual-create, dispute-resolve)

**Files:**
- Modify: `src/lib/attendance/manual.ts`, `src/lib/attendance/admin-review.ts`

**Interfaces:**
- Consumes: existing `requirePermission` (with its `ctx.branchId` parameter). No new imports.

This mirrors the established `void.ts` pattern: load the target employee's `branchId` first, then gate with `{ branchId }` so a scoped admin can't act on an out-of-branch record.

- [ ] **Step 1: `manual.ts` — gate by the target employee's branch**

The current code calls `requirePermission('attendance.manual-create')` first, then loads `emp`. Reorder so the employee (with `branchId`) loads first, then gate. Add `branchId` to the `emp` select.

```ts
export async function createManualAttendance(input: CreateManualInput): Promise<CreateManualResult> {
  // Load the target employee first so we can branch-gate (mirrors void.ts).
  const emp = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, archivedAt: true, status: true, branchId: true },
  });
  if (!emp) {
    return { ok: false, code: 'employee-not-found', message: 'ไม่พบพนักงาน' };
  }

  const { user } = await requirePermission('attendance.manual-create', { branchId: emp.branchId });

  if (emp.archivedAt || emp.status === 'Archived') {
    return { ok: false, code: 'employee-archived', message: 'พนักงานคนนี้พ้นสภาพแล้ว' };
  }
  // ... rest unchanged (date validation, duration, create) ...
}
```

- [ ] **Step 2: `admin-review.ts` — gate dispute resolution by the record's branch**

In `review(...)`, before `requirePermission('attendance.dispute-resolve')`, load the disputed record's employee branch and pass it as ctx.

```ts
async function review(input: ReviewInput, decision: 'approve' | 'reject'): Promise<ReviewResult> {
  const target = await prisma.attendance.findUnique({
    where: { id: input.attendanceId },
    select: { employee: { select: { branchId: true } } },
  });
  if (!target) {
    return { ok: false, code: 'not-found', message: 'ไม่พบรายการลงเวลา' };
  }

  const { user } = await requirePermission('attendance.dispute-resolve', {
    branchId: target.employee.branchId,
  });
  // ... rest unchanged (note validation, transaction, etc.) ...
}
```
(`ReviewResult` already has a `not-found`/`forbidden` code shape — use `not-found` if present; otherwise reuse the existing not-found code the transaction returns. Read the type and match it.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` → clean. Run: `npx next build` → succeeds.

- [ ] **Step 4: Manual smoke (note in report)**

As a `Checker01 @ Branch A` admin with `attendance.dispute-resolve` scoped to Branch A: resolving a Branch-A dispute succeeds; attempting an out-of-branch record's action `notFound()`s. Global Admin unaffected. (State if the local stack is unavailable.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/attendance/manual.ts src/lib/attendance/admin-review.ts
git commit -m "feat(attendance): branch-gate manual-create and dispute-resolve actions"
```

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npx vitest run` → all green (foundation tests added; no regressions).
Run: `npx tsc --noEmit` → clean.
Run: `npx next build` → succeeds.

- [ ] **Step 2: Confirm the invariant in code**

Re-read the diff: every attendance query change is a spread of a fragment that is `{}` when `permitted === 'all'`. Confirm no query lost its existing `select`/`orderBy`, and no `where` gained a second `OR` key (the only `OR` introduced is via `employeeBranchScope` into clauses that had none).

- [ ] **Step 3: Commit any verification fixes (only if needed)**

```bash
git add -A && git commit -m "test: verify branch enforcement on attendance"
```

---

## Self-Review

**Spec coverage:**
- Foundation `getPermittedBranches` + `employeeBranchScope`/`viaEmployeeBranchScope` → Task 1. ✓
- Live board / list / disputed read filtering → Task 2. ✓
- manual-create / dispute-resolve write gating (void already done) → Task 3. ✓
- Multi-branch staff (`hasSome`) → Task 1 (`employeeBranchScope`) + Task 1 test. ✓
- Invariant (global/Superadmin → `'all'` → `{}`) → Task 1 semantics + Task 4 Step 2. ✓
- Disputed count uses the same fragment as its list → Task 2 Step 2. ✓
- Non-goals (employees/leave/advance/reports/dashboard/payroll/settings untouched) → no task references them. ✓

**Placeholder scan:** Task 2 Step 3 (disputed page) and Task 3 Step 2's `ReviewResult` code-shape are described as "apply the shown pattern / match the existing type" rather than literal final code, because the exact current source of those two spots wasn't quoted here — both are fully-specified transformations (same fragment merge / same `{ branchId }` ctx as the quoted siblings), not open-ended work. Everything else is literal code.

**Type consistency:** `PermittedBranches = 'all' | string[]` produced by Task 1, consumed by `employeeBranchScope`/`viaEmployeeBranchScope` (Task 1) and the Task 2/3 callsites. `getPermittedBranches(user, permission)` returns `Promise<PermittedBranches>`; callers `await` it. `viaEmployeeBranchScope` returns `{ employee?: ... }` spread into via-employee `where`s; `employeeBranchScope` returns `Prisma.EmployeeWhereInput` spread into employee `where`s. Consistent.
