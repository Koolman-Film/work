# Branch Enforcement — Leave Inbox + Mutations (Spec B3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope every `/admin/leave` surface (inbox read incl. trash, approve, reject, on-behalf create, void, restore) to the acting admin's permitted branches, matching an employee's home ∪ assigned branches.

**Architecture:** Reuse the existing `src/lib/auth/branch-scope.ts` primitives unchanged. Reads merge `viaEmployeeBranchScope(permitted)` into the Prisma `where`; writes load the target employee's branch set and gate with `canActOnEmployeeBranches(permitted, [home, ...assigned])` before mutating. Global/Superadmin actors resolve to `'all'` → `{}` filter / `true` gate, so behavior is unchanged for them.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Prisma, Vitest, Biome, pnpm.

## Global Constraints

- **No new helpers, no schema/migration.** Use `getPermittedBranches`, `viaEmployeeBranchScope`, `canActOnEmployeeBranches` from `src/lib/auth/branch-scope.ts` exactly as they exist.
- **Invariant — zero change for global/Superadmin:** `getPermittedBranches → 'all'`.
- **Per-permission scoping:** compute permitted branches with the *action's own* permission — `leave.read` for the inbox, `leave.approve` for approve/reject/on-behalf create, `leave.void` for void/restore.
- **Hide existence:** out-of-scope requests return the call-site's existing "missing" signal — the result-object code `'not-found'` (admin.ts approve/reject, void.ts) or `'employee-not-found'` (adminCreate). Never a distinct "forbidden/wrong branch" message.
- **Branch base:** built on current main `90edf53`. Branch: `claude/spec-b3-leave-branch-enforcement`.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run all commands from the worktree root: `/Users/tong/Works/fai/work/.claude/worktrees/practical-satoshi-2a56f0`. Ensure deps are installed once (`pnpm install`) before running tests.

## File Structure

- `src/app/(admin)/admin/leave/page.tsx` — inbox read filter (Task 1).
- `src/lib/leave/admin.ts` — `approveLeaveRequest` / `rejectLeaveRequest` act-on gate (Task 2); `adminCreateLeaveRequest` server validation (Task 3).
- `src/lib/leave/void.ts` — `voidLeaveRequest` / `restoreLeaveRequest` full-scope fix (Task 4).
- `src/lib/leave/leave-branch-enforcement.test.ts` — new; mutation-gate tests, built up across Tasks 2–4.

---

## Task 1: Inbox read filter (page.tsx)

Wiring change — branch-filter the live inbox + trash reads. No unit test (page-level read-filter wiring is verified by `tsc` + `next build` + the existing `viaEmployeeBranchScope` helper tests in `src/lib/auth/branch-scope.test.ts`; the missing read-filter integration harness is a known, separately-tracked program gap, not introduced here).

**Files:**
- Modify: `src/app/(admin)/admin/leave/page.tsx`

**Interfaces:**
- Consumes: `getPermittedBranches(user, 'leave.read')`, `viaEmployeeBranchScope(permitted) → { employee?: Prisma.EmployeeWhereInput }` (returns `{}` for `'all'`).
- Produces: nothing for later tasks.

- [ ] **Step 1: Add the branch-scope import**

In `src/app/(admin)/admin/leave/page.tsx`, add this import alongside the existing imports (e.g. right after the `requirePermission` import on line 23 region):

```ts
import { getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
```

- [ ] **Step 2: Capture the user and compute the scope**

Replace line 55:

```ts
  await requirePermission('leave.read');
```

with:

```ts
  const { user } = await requirePermission('leave.read');
```

Then, immediately after `const requestedPage = parsePageParam(pageRaw);` (line 59), add:

```ts
  const permitted = await getPermittedBranches(user, 'leave.read');
  const scope = viaEmployeeBranchScope(permitted); // {} for 'all' (global/Superadmin)
```

- [ ] **Step 3: Merge the scope into the live `where`**

Immediately after the `if (q) { where.employee = { OR: [...] }; }` block (after line 76), add:

```ts
  // Branch scope: a scoped admin only sees leave for employees in their branches.
  // Merge with any name-search `where.employee` via AND so both apply.
  if (scope.employee) {
    where.employee = where.employee ? { AND: [where.employee, scope.employee] } : scope.employee;
  }
```

- [ ] **Step 4: Branch-scope the trash read**

Replace the `trashWhere` declaration (line 78):

```ts
  const trashWhere = { deletedAt: { not: null } } as const;
```

with:

```ts
  const trashWhere: Prisma.LeaveRequestWhereInput = { deletedAt: { not: null } };
  if (scope.employee) trashWhere.employee = scope.employee;
```

(`trashWhere` is used by both the trash `findMany` and its `count`, so this scopes both. `Prisma` is already imported at the top of the file.)

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/admin/leave/page.tsx"
git commit -m "$(printf 'feat(leave): branch-scope the inbox + trash reads (B3 read filter)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: approve / reject act-on gate (admin.ts)

**Files:**
- Modify: `src/lib/leave/admin.ts` (`approveLeaveRequest` ~line 101, `rejectLeaveRequest` ~line 404)
- Create: `src/lib/leave/leave-branch-enforcement.test.ts`

**Interfaces:**
- Consumes: `getPermittedBranches(user, 'leave.approve')`, `canActOnEmployeeBranches(permitted, [home, ...assigned]) → boolean`.
- Produces: the test scaffold (boundary mocks) reused by Tasks 3–4.

- [ ] **Step 1: Write the failing test**

Create `src/lib/leave/leave-branch-enforcement.test.ts`:

```ts
/**
 * Branch-scope enforcement for leave mutations (Spec B3).
 *
 * Mocks only boundaries; drives the REAL getPermittedBranches /
 * canActOnEmployeeBranches by mocking getUserAssignments at the seam.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── next/* + infra mocks ──────────────────────────────────────────────────────
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));
vi.mock('@/lib/audit/log', () => ({ auditLogTx: vi.fn() }));
vi.mock('@/lib/inngest/events', () => ({ sendNotification: vi.fn() })); // admin.ts imports sendNotification here
vi.mock('./leave-config', () => ({
  getLeaveConfig: vi.fn().mockResolvedValue({}),
}));

// ── auth seam ─────────────────────────────────────────────────────────────────
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
  canDo: vi.fn(),
}));

// ── prisma seam ───────────────────────────────────────────────────────────────
const lrFindUnique = vi.fn();
const lrUpdate = vi.fn();
const lrCreate = vi.fn();
const holidayFindMany = vi.fn();
const attFindMany = vi.fn();
const empFindUnique = vi.fn();
const transactionFn = vi.fn();

function txStub() {
  return {
    leaveRequest: {
      findUnique: (...a: unknown[]) => lrFindUnique(...a),
      update: (...a: unknown[]) => lrUpdate(...a),
      create: (...a: unknown[]) => lrCreate(...a),
    },
    holiday: { findMany: (...a: unknown[]) => holidayFindMany(...a) },
    attendance: { findMany: (...a: unknown[]) => attFindMany(...a) },
  };
}

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: (...a: unknown[]) => transactionFn(...a),
    employee: { findUnique: (...a: unknown[]) => empFindUnique(...a) },
    leaveRequest: { findUnique: (...a: unknown[]) => lrFindUnique(...a) },
  },
  prismaRaw: {
    leaveRequest: { findUnique: (...a: unknown[]) => lrFindUnique(...a) },
  },
}));

import { approveLeaveRequest, rejectLeaveRequest } from './admin';

// ── helpers ───────────────────────────────────────────────────────────────────
const BRANCH_A = '00000000-0000-0000-0000-00000000000a';
const BRANCH_B = '00000000-0000-0000-0000-00000000000b';

/** One scoped (branchId set) assignment granting `perm`. */
function scopedTo(branchId: string, perm: string) {
  return [{ branchId, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}
function globalGrant(perm: string) {
  return [{ branchId: null, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}

/** A pending leave request whose employee lives in `home` (+ optional assigned). */
function pendingReq(home: string, assigned: string[] = []) {
  return {
    id: 'lr1',
    status: 'Pending',
    employeeId: 'e1',
    leaveTypeId: 'lt1',
    startDate: new Date('2026-07-01'),
    endDate: new Date('2026-07-01'),
    unit: 'FullDay',
    startTime: null,
    endTime: null,
    employee: {
      firstName: 'สมชาย',
      userId: 'u1',
      salaryType: 'Monthly',
      baseSalary: '10000',
      branchId: home,
      assignedBranchIds: assigned,
    },
    leaveType: { name: 'ลากิจ', nameByLocale: null, annualQuota: 0, overQuotaPolicy: 'Block' },
  };
}

describe('rejectLeaveRequest — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(txStub()));
    lrUpdate.mockResolvedValue({});
  });

  it('scoped actor on an out-of-scope request → not-found, no update', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    lrFindUnique.mockResolvedValue({
      id: 'lr1',
      status: 'Pending',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-01'),
      employee: { firstName: 'ก', userId: 'u1', branchId: BRANCH_B, assignedBranchIds: [] },
      leaveType: { name: 'ลากิจ', nameByLocale: null },
    });

    const res = await rejectLeaveRequest({ leaveRequestId: 'lr1', note: 'ปฏิเสธทดสอบ' });
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(lrUpdate).not.toHaveBeenCalled();
  });

  it('scoped actor on an in-scope request → updates to Rejected', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    lrFindUnique.mockResolvedValue({
      id: 'lr1',
      status: 'Pending',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-01'),
      employee: { firstName: 'ก', userId: 'u1', branchId: BRANCH_A, assignedBranchIds: [] },
      leaveType: { name: 'ลากิจ', nameByLocale: null },
    });

    const res = await rejectLeaveRequest({ leaveRequestId: 'lr1', note: 'ปฏิเสธทดสอบ' });
    expect(res).toMatchObject({ ok: true });
    expect(lrUpdate).toHaveBeenCalled();
  });
});

describe('approveLeaveRequest — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(txStub()));
    holidayFindMany.mockResolvedValue([]);
    attFindMany.mockResolvedValue([]);
  });

  it('scoped actor on an out-of-scope request → not-found, gate blocks before holiday lookup', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    lrFindUnique.mockResolvedValue(pendingReq(BRANCH_B));

    const res = await approveLeaveRequest({ leaveRequestId: 'lr1', note: 'อนุมัติทดสอบ' });
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(holidayFindMany).not.toHaveBeenCalled(); // proves the gate fired before the heavy path
  });

  it('scoped actor on an in-scope request → passes the gate (reaches holiday lookup)', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    lrFindUnique.mockResolvedValue(pendingReq(BRANCH_A));

    await approveLeaveRequest({ leaveRequestId: 'lr1', note: 'อนุมัติทดสอบ' });
    expect(holidayFindMany).toHaveBeenCalled(); // got past the gate
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/leave/leave-branch-enforcement.test.ts`
Expected: FAIL — the out-of-scope cases currently proceed (no gate yet): `rejectLeaveRequest` calls `lrUpdate` and `approveLeaveRequest` calls `holidayFindMany`.

- [ ] **Step 3: Add the gate to `approveLeaveRequest`**

In `src/lib/leave/admin.ts`, add the branch-scope import next to the existing auth import (the `requirePermission` import ~line 32):

```ts
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
```

In `approveLeaveRequest`, after `const { user } = await requirePermission('leave.approve');` (line 102) add:

```ts
  const permitted = await getPermittedBranches(user, 'leave.approve');
```

Extend the `req` employee select (line 154–156) to include the branch set:

```ts
          employee: {
            select: {
              firstName: true,
              userId: true,
              salaryType: true,
              baseSalary: true,
              branchId: true,
              assignedBranchIds: true,
            },
          },
```

Then immediately after the `if (req.status !== 'Pending') { ... }` block (after line 172) add the gate:

```ts
      if (
        !canActOnEmployeeBranches(permitted, [
          req.employee.branchId,
          ...req.employee.assignedBranchIds,
        ])
      ) {
        return { ok: false as const, code: 'not-found' as const, message: 'ไม่พบคำขอลา' };
      }
```

- [ ] **Step 4: Add the gate to `rejectLeaveRequest`**

In `rejectLeaveRequest`, after `const { user } = await requirePermission('leave.approve');` (line 405) add:

```ts
  const permitted = await getPermittedBranches(user, 'leave.approve');
```

Extend its `req` employee select (line 441) to include the branch set:

```ts
          employee: {
            select: {
              firstName: true,
              userId: true,
              branchId: true,
              assignedBranchIds: true,
            },
          },
```

Then immediately after its `if (req.status !== 'Pending') { ... }` block (after line 452) add the same gate:

```ts
      if (
        !canActOnEmployeeBranches(permitted, [
          req.employee.branchId,
          ...req.employee.assignedBranchIds,
        ])
      ) {
        return { ok: false as const, code: 'not-found' as const, message: 'ไม่พบคำขอลา' };
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/leave/leave-branch-enforcement.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/leave/admin.ts src/lib/leave/leave-branch-enforcement.test.ts
git commit -m "$(printf 'feat(leave): branch act-on gate on approve/reject (B3)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: on-behalf create server validation (admin.ts)

**Files:**
- Modify: `src/lib/leave/admin.ts` (`adminCreateLeaveRequest` ~line 559)
- Modify: `src/lib/leave/leave-branch-enforcement.test.ts` (append cases)

**Interfaces:**
- Consumes: `getPermittedBranches(user, 'leave.approve')`, `canActOnEmployeeBranches`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test (append)**

Append to `src/lib/leave/leave-branch-enforcement.test.ts`:

```ts
import { adminCreateLeaveRequest } from './admin';

describe('adminCreateLeaveRequest — branch act-on gate (on-behalf)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
  });

  function baseInput() {
    return {
      employeeId: 'e1',
      leaveTypeId: 'lt1',
      startDate: '2026-07-01',
      endDate: '2026-07-01',
      unit: 'FullDay' as const,
      reason: 'ลากิจธุระ',
    };
  }

  it('scoped actor choosing an out-of-scope employee → employee-not-found, no create', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    empFindUnique.mockResolvedValue({
      id: 'e1',
      archivedAt: null,
      status: 'Active',
      firstName: 'ก',
      lastName: 'ข',
      nickname: null,
      branchId: BRANCH_B,
      assignedBranchIds: [],
    });

    const res = await adminCreateLeaveRequest(baseInput());
    expect(res).toMatchObject({ ok: false, code: 'employee-not-found' });
    expect(lrCreate).not.toHaveBeenCalled();
  });

  it('scoped actor choosing an in-scope employee → passes the gate (reaches date validation)', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    empFindUnique.mockResolvedValue({
      id: 'e1',
      archivedAt: null,
      status: 'Active',
      firstName: 'ก',
      lastName: 'ข',
      nickname: null,
      branchId: BRANCH_A,
      assignedBranchIds: [],
    });

    // Bad dates → proves we got PAST the branch gate (gate returns employee-not-found).
    const res = await adminCreateLeaveRequest({ ...baseInput(), endDate: '2026-06-30' });
    expect(res).toMatchObject({ ok: false, code: 'bad-dates' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/leave/leave-branch-enforcement.test.ts -t "on-behalf"`
Expected: FAIL — the out-of-scope case currently proceeds past the employee load (no gate yet).

- [ ] **Step 3: Add the gate to `adminCreateLeaveRequest`**

In `src/lib/leave/admin.ts`, after `const { user } = await requirePermission('leave.approve');` (line 562) add:

```ts
  const permitted = await getPermittedBranches(user, 'leave.approve');
```

Extend the employee select (lines 571–578) to include the branch set:

```ts
    select: {
      id: true,
      archivedAt: true,
      status: true,
      firstName: true,
      lastName: true,
      nickname: true,
      branchId: true,
      assignedBranchIds: true,
    },
```

Then immediately after the `if (employee.archivedAt || employee.status === 'Archived') { ... }` block (after line 585) add:

```ts
  if (
    !canActOnEmployeeBranches(permitted, [employee.branchId, ...employee.assignedBranchIds])
  ) {
    // Out of the actor's branch scope — hide existence behind the not-found code.
    return { ok: false, code: 'employee-not-found', message: 'ไม่พบพนักงาน' };
  }
```

(`getPermittedBranches` / `canActOnEmployeeBranches` are already imported by Task 2.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/lib/leave/leave-branch-enforcement.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/leave/admin.ts src/lib/leave/leave-branch-enforcement.test.ts
git commit -m "$(printf 'feat(leave): server-validate on-behalf create branch scope (B3)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: void / restore full-scope fix (void.ts)

Replace the home-branch-only `requirePermission('leave.void', { branchId })` with the full home-∪-assigned `canActOnEmployeeBranches` gate — fixing the rotating-staff asymmetry.

**Files:**
- Modify: `src/lib/leave/void.ts` (`voidLeaveRequest` ~line 32, `restoreLeaveRequest` ~line 90)
- Modify: `src/lib/leave/leave-branch-enforcement.test.ts` (append cases)

**Interfaces:**
- Consumes: `getPermittedBranches(user, 'leave.void')`, `canActOnEmployeeBranches`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test (append)**

Append to `src/lib/leave/leave-branch-enforcement.test.ts`:

```ts
import { restoreLeaveRequest, voidLeaveRequest } from './void';

describe('voidLeaveRequest — full branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        attendance: {
          findMany: vi.fn().mockResolvedValue([]),
          updateMany: vi.fn().mockResolvedValue({}),
        },
        leaveRequest: { update: (...a: unknown[]) => lrUpdate(...a) },
      }),
    );
    lrUpdate.mockResolvedValue({});
  });

  it('scoped actor on an out-of-scope request → not-found, no update', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.void'));
    lrFindUnique.mockResolvedValue({
      id: 'lr1',
      deletedAt: null,
      status: 'Approved',
      employee: { branchId: BRANCH_B, assignedBranchIds: [] },
    });

    const res = await voidLeaveRequest('lr1', 'ยกเลิกทดสอบ');
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(lrUpdate).not.toHaveBeenCalled();
  });

  it('rotating staff: home out-of-scope but an ASSIGNED branch in-scope → authorized', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.void'));
    lrFindUnique.mockResolvedValue({
      id: 'lr1',
      deletedAt: null,
      status: 'Approved',
      employee: { branchId: BRANCH_B, assignedBranchIds: [BRANCH_A] }, // home=B (out), assigned includes A (in)
    });

    const res = await voidLeaveRequest('lr1', 'ยกเลิกทดสอบ');
    expect(res).toMatchObject({ ok: true });
    expect(lrUpdate).toHaveBeenCalled();
  });
});

describe('restoreLeaveRequest — full branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        attendance: { updateMany: vi.fn().mockResolvedValue({}) },
        leaveRequest: { update: (...a: unknown[]) => lrUpdate(...a) },
      }),
    );
    lrUpdate.mockResolvedValue({});
  });

  it('scoped actor on an out-of-scope request → not-found, no update', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.void'));
    lrFindUnique.mockResolvedValue({
      id: 'lr1',
      deletedAt: new Date('2026-06-01'),
      employee: { branchId: BRANCH_B, assignedBranchIds: [] },
    });

    const res = await restoreLeaveRequest('lr1');
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(lrUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/leave/leave-branch-enforcement.test.ts -t "branch act-on gate"`
Expected: FAIL — without the new gate, the out-of-scope void/restore proceed (and the home-only `requirePermission` mock returns a user regardless), so `lrUpdate` IS called.

- [ ] **Step 3: Fix `voidLeaveRequest`**

In `src/lib/leave/void.ts`, add the import after the `requirePermission` import (line 5):

```ts
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
```

Extend the `row` employee select (line 38) to include `assignedBranchIds`:

```ts
    select: {
      id: true,
      deletedAt: true,
      status: true,
      employee: { select: { branchId: true, assignedBranchIds: true } },
    },
```

Replace the scoped `requirePermission` call (line 43):

```ts
  const { user } = await requirePermission('leave.void', { branchId: row.employee.branchId });
```

with the full gate:

```ts
  const { user } = await requirePermission('leave.void');
  const permitted = await getPermittedBranches(user, 'leave.void');
  if (
    !canActOnEmployeeBranches(permitted, [
      row.employee.branchId,
      ...row.employee.assignedBranchIds,
    ])
  ) {
    return { ok: false, code: 'not-found', message: 'ไม่พบคำขอลา' };
  }
```

- [ ] **Step 4: Fix `restoreLeaveRequest`**

Extend its `row` employee select (line 93) to include `assignedBranchIds`:

```ts
    select: {
      id: true,
      deletedAt: true,
      employee: { select: { branchId: true, assignedBranchIds: true } },
    },
```

Replace its scoped `requirePermission` call (line 98):

```ts
  const { user } = await requirePermission('leave.void', { branchId: row.employee.branchId });
```

with:

```ts
  const { user } = await requirePermission('leave.void');
  const permitted = await getPermittedBranches(user, 'leave.void');
  if (
    !canActOnEmployeeBranches(permitted, [
      row.employee.branchId,
      ...row.employee.assignedBranchIds,
    ])
  ) {
    return { ok: false, code: 'not-found', message: 'ไม่พบคำขอลา' };
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm exec vitest run src/lib/leave/leave-branch-enforcement.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/leave/void.ts src/lib/leave/leave-branch-enforcement.test.ts
git commit -m "$(printf 'fix(leave): void/restore use full home-union-assigned branch scope (B3)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm exec vitest run`
Expected: all green (the existing suite + the 9 new leave tests). No regressions.

- [ ] **Step 2: Typecheck the whole project**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Confirm the page-gate guardrail still passes**

Run: `pnpm exec vitest run "src/app/(admin)/admin/admin-page-gates.test.ts"`
Expected: PASS (no new pages; leave still gated).

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: build succeeds (validates the `page.tsx` Server Component change end-to-end).

---

## Self-Review (completed during planning)

- **Spec coverage:** Unit 1 → Task 1; Unit 2 → Task 2; Unit 3 → Task 3; Unit 4 → Task 4; testing/verification → Tasks 2–5. All four spec units mapped.
- **Placeholder scan:** none — every step carries the exact code/command.
- **Type consistency:** gate uses `canActOnEmployeeBranches(permitted, [branchId, ...assignedBranchIds])` consistently; result codes match each call-site's existing union (`'not-found'` for approve/reject/void, `'employee-not-found'` for adminCreate); permission strings match per surface (`leave.read` / `leave.approve` / `leave.void`).
- **Known gap stated:** Task 1 read-filter has no integration harness (pre-existing program gap), verified by tsc + build + helper tests — called out, not hidden.
