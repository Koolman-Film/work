# Branch Enforcement — Advance Inbox + Mutations (Spec B4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope every `/admin/advance` surface (inbox read incl. trash, approve, reject, mark-paid, on-behalf create, void, restore) to the acting admin's permitted branches, matching an employee's home ∪ assigned branches.

**Architecture:** Reuse the existing `src/lib/auth/branch-scope.ts` primitives unchanged. Reads merge `viaEmployeeBranchScope(permitted)` into the Prisma `where`; writes load the target employee's branch set and gate with `canActOnEmployeeBranches(permitted, [home, ...assigned])` before mutating. Out-of-scope returns each call-site's existing missing code (existence hidden). Global/Superadmin resolve to `'all'` → inert.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Prisma, Vitest, Biome, pnpm.

## Global Constraints

- **No new helpers, no schema/migration.** Use `getPermittedBranches`, `viaEmployeeBranchScope`, `canActOnEmployeeBranches` from `src/lib/auth/branch-scope.ts` exactly as they exist.
- **Invariant — zero change for global/Superadmin:** `getPermittedBranches → 'all'`. Each mutation gets an explicit global-actor test.
- **Per-permission scoping:** `advance.read` for the inbox; `advance.approve` for approve/reject/mark-paid/on-behalf-create; `advance.void` for void/restore.
- **Hide existence:** out-of-scope returns the call-site's existing missing code — `'not-found'` (`message: 'ไม่พบคำขอเบิก'`) for inbox/approve/reject/mark-paid/void/restore; `'employee-not-found'` (`message: 'ไม่พบพนักงาน'`) for adminCreate. Never a distinct "wrong branch" message.
- **Gate before mutation / before existence short-circuits:** every write gate runs before any DB write; void/restore gates run before the void-guard / not-deleted short-circuits.
- **Branch base:** current main `70107c2`. Branch: `claude/spec-b4-advance-branch-enforcement`.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run commands from the worktree root: `/Users/tong/Works/fai/work/.claude/worktrees/practical-satoshi-2a56f0`. Deps are installed; `tsc` baseline on this branch is **0 errors**.

## File Structure

- `src/app/(admin)/admin/advance/page.tsx` — inbox read filter (Task 1).
- `src/lib/advance/admin.ts` — `approveCashAdvance` / `rejectCashAdvance` / `markAdvancePaid` act-on gates (Task 2); `adminCreateCashAdvance` server validation (Task 3).
- `src/lib/advance/void.ts` — `voidCashAdvance` / `restoreCashAdvance` full-scope fix + gate ordering (Task 4).
- `src/lib/advance/advance-branch-enforcement.test.ts` — new; mutation-gate tests, built up across Tasks 2–4.

---

## Task 1: Inbox read filter (page.tsx)

Wiring change — branch-filter the live inbox + trash reads. No unit test (page-level read-filter wiring is verified by `tsc` + `next build` + the existing `viaEmployeeBranchScope` helper tests in `src/lib/auth/branch-scope.test.ts`; the missing read-filter integration harness is a known, separately-tracked program gap).

**Files:**
- Modify: `src/app/(admin)/admin/advance/page.tsx`

**Interfaces:**
- Consumes: `getPermittedBranches(user, 'advance.read')`, `viaEmployeeBranchScope(permitted) → { employee?: Prisma.EmployeeWhereInput }` (`{}` for `'all'`).

- [ ] **Step 1: Add the branch-scope import**

In `src/app/(admin)/admin/advance/page.tsx`, add alongside the existing imports (near the `requirePermission` import, line ~20):

```ts
import { getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
```

- [ ] **Step 2: Capture the user + compute the scope**

Replace line 48:

```ts
  await requirePermission('advance.read');
```

with:

```ts
  const { user } = await requirePermission('advance.read');
```

Then immediately after `const requestedPage = parsePageParam(pageRaw);` (line 52) add:

```ts
  const permitted = await getPermittedBranches(user, 'advance.read');
  const scope = viaEmployeeBranchScope(permitted); // {} for 'all' (global/Superadmin)
```

- [ ] **Step 3: Merge the scope into the live `where`**

Immediately after the `if (q) { where.employee = { OR: [...] }; }` block (after line 69) add:

```ts
  // Branch scope: a scoped admin only sees advances for employees in their branches.
  if (scope.employee) {
    where.employee = where.employee ? { AND: [where.employee, scope.employee] } : scope.employee;
  }
```

- [ ] **Step 4: Branch-scope the trash read**

Replace line 71:

```ts
  const trashWhere = { deletedAt: { not: null } } as const;
```

with:

```ts
  const trashWhere: Prisma.CashAdvanceWhereInput = { deletedAt: { not: null } };
  if (scope.employee) trashWhere.employee = scope.employee;
```

(`trashWhere` feeds both the trash `findMany` and its `count`. `Prisma` is already imported in this file.)

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/admin/advance/page.tsx"
git commit -m "$(printf 'feat(advance): branch-scope the inbox + trash reads (B4 read filter)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: approve / reject / mark-paid act-on gate (admin.ts)

**Files:**
- Modify: `src/lib/advance/admin.ts` (`approveCashAdvance` ~line 72, `rejectCashAdvance` ~line 214, `markAdvancePaid` ~line 302)
- Create: `src/lib/advance/advance-branch-enforcement.test.ts`

**Interfaces:**
- Consumes: `getPermittedBranches(user, 'advance.approve')`, `canActOnEmployeeBranches(permitted, [home, ...assigned]) → boolean`.
- Produces: the test scaffold (boundary mocks + helpers `scopedTo`, `globalGrant`, `BRANCH_A`, `BRANCH_B`) reused by Tasks 3–4.

- [ ] **Step 1: Write the failing test**

Create `src/lib/advance/advance-branch-enforcement.test.ts`:

```ts
/**
 * Branch-scope enforcement for advance mutations (Spec B4).
 *
 * Mocks only boundaries; drives the REAL getPermittedBranches /
 * canActOnEmployeeBranches by mocking getUserAssignments at the seam.
 * Mock shape mirrors src/lib/advance/mark-paid.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }));
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn(), auditLogTx: vi.fn(async () => undefined) }));
vi.mock('@/lib/inngest/events', () => ({ sendNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/notifications/admin-line', () => ({ notifyAdminsOnLine: vi.fn(async () => undefined) }));
vi.mock('@/lib/notifications/in-app-bell', () => ({ notifyAdminsInApp: vi.fn(async () => undefined) }));

// advanceBalanceFor / isOverCap drive approve's cap pre-check. Default: in-cap.
const advanceBalanceFor = vi.fn(async () => ({ available: 999999 }));
vi.mock('@/lib/advance/available', () => ({ advanceBalanceFor: (...a: unknown[]) => advanceBalanceFor(...a) }));
vi.mock('@/lib/advance/balance', () => ({ isOverCap: vi.fn(() => false) }));

// auth seam — REAL branch-scope, only getUserAssignments mocked.
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
  canDo: vi.fn(),
}));

// prisma seam: outer client (capRow / employee / pending) + a tx stub.
const caFindUnique = vi.fn();   // prisma.cashAdvance.findUnique (capRow, outside tx)
const caFindFirst = vi.fn();    // prisma.cashAdvance.findFirst (pending check)
const caCreate = vi.fn(async () => ({ id: 'ca-new' }));
const empFindUnique = vi.fn();  // prisma.employee.findUnique (adminCreate)
const txFindUnique = vi.fn();   // tx.cashAdvance.findUnique
const txUpdate = vi.fn(async () => ({}));
const txCreate = vi.fn(async () => ({ id: 'ca-new' }));
const transactionFn = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({ cashAdvance: { findUnique: txFindUnique, update: txUpdate, create: txCreate } }),
);
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: (...a: unknown[]) => transactionFn(...a),
    cashAdvance: {
      findUnique: (...a: unknown[]) => caFindUnique(...a),
      findFirst: (...a: unknown[]) => caFindFirst(...a),
      create: (...a: unknown[]) => caCreate(...a),
    },
    employee: { findUnique: (...a: unknown[]) => empFindUnique(...a) },
  },
  prismaRaw: { cashAdvance: { findUnique: (...a: unknown[]) => caFindUnique(...a) } },
}));

import { approveCashAdvance, markAdvancePaid, rejectCashAdvance } from './admin';

// helpers
const BRANCH_A = '00000000-0000-0000-0000-00000000000a';
const BRANCH_B = '00000000-0000-0000-0000-00000000000b';
function scopedTo(branchId: string, perm: string) {
  return [{ branchId, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}
function globalGrant(perm: string) {
  return [{ branchId: null, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}
/** A loaded advance row whose employee lives in `home` (+ optional assigned). */
function advRow(home: string, assigned: string[] = [], over: Record<string, unknown> = {}) {
  return {
    id: 'ca1',
    status: 'Pending',
    amount: '1000',
    employeeId: 'e1',
    paidAt: null,
    receiptUrl: null,
    isDeducted: false,
    employee: { firstName: 'ก', userId: 'u1', branchId: home, assignedBranchIds: assigned },
    ...over,
  };
}

describe('approveCashAdvance — branch act-on gate (capRow)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, authUserId: 'auth-1' });
    advanceBalanceFor.mockResolvedValue({ available: 999999 });
  });

  it('scoped actor on out-of-scope advance → not-found, cap check NOT run', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    caFindUnique.mockResolvedValue(advRow(BRANCH_B)); // capRow out of scope
    const res = await approveCashAdvance({ cashAdvanceId: 'ca1' });
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(advanceBalanceFor).not.toHaveBeenCalled(); // gate fired before the cap check
    expect(transactionFn).not.toHaveBeenCalled();
  });

  it('scoped actor on in-scope advance → passes the gate (cap check runs)', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    caFindUnique.mockResolvedValue(advRow(BRANCH_A));
    txFindUnique.mockResolvedValue(advRow(BRANCH_A));
    await approveCashAdvance({ cashAdvanceId: 'ca1' });
    expect(advanceBalanceFor).toHaveBeenCalled(); // got past the gate
  });

  it('global actor on out-of-branch advance → passes the gate', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('advance.approve'));
    caFindUnique.mockResolvedValue(advRow(BRANCH_B));
    txFindUnique.mockResolvedValue(advRow(BRANCH_B));
    await approveCashAdvance({ cashAdvanceId: 'ca1' });
    expect(advanceBalanceFor).toHaveBeenCalled();
  });
});

describe('rejectCashAdvance — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, authUserId: 'auth-1' });
  });

  it('scoped actor on out-of-scope advance → not-found, no update', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_B));
    const res = await rejectCashAdvance({ cashAdvanceId: 'ca1' });
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('scoped actor on in-scope advance → updates', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_A));
    const res = await rejectCashAdvance({ cashAdvanceId: 'ca1' });
    expect(res).toMatchObject({ ok: true });
    expect(txUpdate).toHaveBeenCalled();
  });

  it('global actor on out-of-branch advance → updates', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_B));
    const res = await rejectCashAdvance({ cashAdvanceId: 'ca1' });
    expect(res).toMatchObject({ ok: true });
    expect(txUpdate).toHaveBeenCalled();
  });
});

describe('markAdvancePaid — branch act-on gate (financial)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, authUserId: 'auth-1' });
  });
  const paidInput = { cashAdvanceId: 'ca1', receiptKey: 'auth-1/advance-receipts/x.jpg' };

  it('scoped actor on out-of-scope advance → not-found, no slip write', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_B, [], { status: 'Approved' }));
    const res = await markAdvancePaid(paidInput);
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('scoped actor on in-scope advance → records payment', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_A, [], { status: 'Approved' }));
    const res = await markAdvancePaid(paidInput);
    expect(res).toMatchObject({ ok: true });
    expect(txUpdate).toHaveBeenCalled();
  });

  it('global actor on out-of-branch advance → records payment', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_B, [], { status: 'Approved' }));
    const res = await markAdvancePaid(paidInput);
    expect(res).toMatchObject({ ok: true });
    expect(txUpdate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/advance/advance-branch-enforcement.test.ts`
Expected: FAIL — without the gates, out-of-scope approve reaches `advanceBalanceFor`, and out-of-scope reject/mark-paid call `txUpdate`.

- [ ] **Step 3: Add the branch-scope import to admin.ts**

In `src/lib/advance/admin.ts`, add next to the `requirePermission` import (line ~24):

```ts
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
```

- [ ] **Step 4: Gate `approveCashAdvance` (on capRow, before the cap check)**

After `const { user, authUserId } = await requirePermission('advance.approve');` (line 73) add:

```ts
  const permitted = await getPermittedBranches(user, 'advance.approve');
```

Extend the `capRow` select (lines 112–115) to load the employee branch set:

```ts
  const capRow = await prisma.cashAdvance.findUnique({
    where: { id: input.cashAdvanceId },
    select: {
      id: true,
      status: true,
      amount: true,
      employeeId: true,
      employee: { select: { branchId: true, assignedBranchIds: true } },
    },
  });
  if (
    capRow &&
    !canActOnEmployeeBranches(permitted, [
      capRow.employee.branchId,
      ...capRow.employee.assignedBranchIds,
    ])
  ) {
    return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };
  }
```

(Insert the gate immediately after the `capRow` assignment, before the `if (capRow && capRow.status === 'Pending')` cap block. A `null` capRow falls through to the transaction, which returns `not-found`.)

- [ ] **Step 5: Gate `rejectCashAdvance` (inside the tx, after the status check)**

After `const { user } = await requirePermission('advance.approve');` (line 215) add:

```ts
  const permitted = await getPermittedBranches(user, 'advance.approve');
```

Extend the in-tx `row` employee select to include `branchId` + `assignedBranchIds` (the `row` loaded at ~line 230 with `employee: { select: { firstName: true, userId: true } }` → add the two fields). Then immediately after the `if (row.status !== 'Pending') { ... }` block add:

```ts
      if (
        !canActOnEmployeeBranches(permitted, [
          row.employee.branchId,
          ...row.employee.assignedBranchIds,
        ])
      ) {
        return { ok: false as const, code: 'not-found' as const, message: 'ไม่พบคำขอเบิก' };
      }
```

- [ ] **Step 6: Gate `markAdvancePaid` (inside the tx, after the status check)**

After `const { user, authUserId } = await requirePermission('advance.approve');` (line 306) add:

```ts
  const permitted = await getPermittedBranches(user, 'advance.approve');
```

Extend the in-tx `row` employee select (line 337) to include `branchId` + `assignedBranchIds`. Then immediately after the `if (row.status !== 'Approved') { ... }` block (after line 349) add:

```ts
      if (
        !canActOnEmployeeBranches(permitted, [
          row.employee.branchId,
          ...row.employee.assignedBranchIds,
        ])
      ) {
        return { ok: false as const, code: 'not-found' as const, message: 'ไม่พบคำขอเบิก' };
      }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/advance/advance-branch-enforcement.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/advance/admin.ts src/lib/advance/advance-branch-enforcement.test.ts
git commit -m "$(printf 'feat(advance): branch act-on gate on approve/reject/mark-paid (B4)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: on-behalf create server validation (admin.ts)

**Files:**
- Modify: `src/lib/advance/admin.ts` (`adminCreateCashAdvance` ~line 430)
- Modify: `src/lib/advance/advance-branch-enforcement.test.ts` (append)

**Interfaces:**
- Consumes: `getPermittedBranches(user, 'advance.approve')`, `canActOnEmployeeBranches`.

- [ ] **Step 1: Write the failing test (append)**

Append to `src/lib/advance/advance-branch-enforcement.test.ts`:

```ts
import { adminCreateCashAdvance } from './admin';

describe('adminCreateCashAdvance — branch act-on gate (on-behalf)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, authUserId: 'auth-1' });
  });

  function emp(home: string, assigned: string[] = []) {
    return {
      id: 'e1',
      archivedAt: null,
      status: 'Active',
      firstName: 'ก',
      lastName: 'ข',
      nickname: null,
      branchId: home,
      assignedBranchIds: assigned,
    };
  }

  it('scoped actor choosing an out-of-scope employee → employee-not-found, no create', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    empFindUnique.mockResolvedValue(emp(BRANCH_B));
    const res = await adminCreateCashAdvance({ employeeId: 'e1', amount: 1000 });
    expect(res).toMatchObject({ ok: false, code: 'employee-not-found' });
    expect(caCreate).not.toHaveBeenCalled();
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('scoped actor choosing an in-scope employee → passes the gate (reaches amount validation)', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    empFindUnique.mockResolvedValue(emp(BRANCH_A));
    // Bad amount → proves we got PAST the branch gate (gate returns employee-not-found).
    const res = await adminCreateCashAdvance({ employeeId: 'e1', amount: -5 });
    expect(res).toMatchObject({ ok: false, code: 'bad-amount' });
  });

  it('global actor choosing an out-of-branch employee → passes the gate (reaches amount validation)', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('advance.approve'));
    empFindUnique.mockResolvedValue(emp(BRANCH_B));
    const res = await adminCreateCashAdvance({ employeeId: 'e1', amount: -5 });
    expect(res).toMatchObject({ ok: false, code: 'bad-amount' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/advance/advance-branch-enforcement.test.ts -t "on-behalf"`
Expected: FAIL — the out-of-scope case currently proceeds past the employee load (no gate yet) and returns `bad-amount`, not `employee-not-found`.

- [ ] **Step 3: Add the gate to `adminCreateCashAdvance`**

After `const { user } = await requirePermission('advance.approve');` (line 433) add:

```ts
  const permitted = await getPermittedBranches(user, 'advance.approve');
```

Extend the `employee` select (lines 437–444) to include `branchId` + `assignedBranchIds`. Then immediately after the `if (employee.archivedAt || employee.status === 'Archived') { ... }` block (after line 451) add:

```ts
  if (
    !canActOnEmployeeBranches(permitted, [employee.branchId, ...employee.assignedBranchIds])
  ) {
    return { ok: false, code: 'employee-not-found', message: 'ไม่พบพนักงาน' };
  }
```

(`getPermittedBranches` / `canActOnEmployeeBranches` already imported by Task 2.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/lib/advance/advance-branch-enforcement.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/advance/admin.ts src/lib/advance/advance-branch-enforcement.test.ts
git commit -m "$(printf 'feat(advance): server-validate on-behalf create branch scope (B4)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: void / restore full-scope fix + gate ordering (void.ts)

Replace the home-branch-only `requirePermission('advance.void', { branchId })` with the full home-∪-assigned `canActOnEmployeeBranches` gate, placed **before** the void-guard / not-deleted short-circuits.

**Files:**
- Modify: `src/lib/advance/void.ts` (`voidCashAdvance` ~line 37, `restoreCashAdvance` ~line 89)
- Modify: `src/lib/advance/advance-branch-enforcement.test.ts` (append)

**Interfaces:**
- Consumes: `getPermittedBranches(user, 'advance.void')`, `canActOnEmployeeBranches`.

- [ ] **Step 1: Write the failing test (append)**

Append to `src/lib/advance/advance-branch-enforcement.test.ts`:

```ts
import { restoreCashAdvance, voidCashAdvance } from './void';

describe('voidCashAdvance — full branch act-on gate + ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, authUserId: 'auth-1' });
    transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ cashAdvance: { findUnique: vi.fn(async () => ({ id: 'ca1' })), update: (...a: unknown[]) => txUpdate(...a) } }),
    );
  });

  function voidRow(home: string, assigned: string[] = [], over: Record<string, unknown> = {}) {
    return { id: 'ca1', deletedAt: null, isDeducted: false, status: 'Pending', employee: { branchId: home, assignedBranchIds: assigned }, ...over };
  }

  it('scoped actor on out-of-scope advance → not-found, no update', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.void'));
    caFindUnique.mockResolvedValue(voidRow(BRANCH_B));
    const res = await voidCashAdvance('ca1', 'เหตุผลทดสอบ');
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('rotating staff: home out-of-scope but an ASSIGNED branch in-scope → authorized', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.void'));
    caFindUnique.mockResolvedValue(voidRow(BRANCH_B, [BRANCH_A]));
    const res = await voidCashAdvance('ca1', 'เหตุผลทดสอบ');
    expect(res).toMatchObject({ ok: true });
    expect(txUpdate).toHaveBeenCalled();
  });

  it('existence-hide: out-of-scope on an ALREADY-DEDUCTED advance → not-found (gate before void-guard)', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.void'));
    caFindUnique.mockResolvedValue(voidRow(BRANCH_B, [], { isDeducted: true }));
    const res = await voidCashAdvance('ca1', 'เหตุผลทดสอบ');
    expect(res).toMatchObject({ ok: false, code: 'not-found' }); // NOT 'already-deducted'
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('global actor on out-of-branch advance → authorized', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('advance.void'));
    caFindUnique.mockResolvedValue(voidRow(BRANCH_B));
    const res = await voidCashAdvance('ca1', 'เหตุผลทดสอบ');
    expect(res).toMatchObject({ ok: true });
    expect(txUpdate).toHaveBeenCalled();
  });
});

describe('restoreCashAdvance — full branch act-on gate + ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, authUserId: 'auth-1' });
    transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ cashAdvance: { update: (...a: unknown[]) => txUpdate(...a) } }),
    );
  });

  it('existence-hide: out-of-scope on a LIVE (not-deleted) advance → not-found, no update', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.void'));
    caFindUnique.mockResolvedValue({ id: 'ca1', deletedAt: null, employee: { branchId: BRANCH_B, assignedBranchIds: [] } });
    const res = await restoreCashAdvance('ca1');
    expect(res).toMatchObject({ ok: false, code: 'not-found' }); // NOT { ok: true } no-op
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('scoped actor on in-scope voided advance → restores', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.void'));
    caFindUnique.mockResolvedValue({ id: 'ca1', deletedAt: new Date('2026-06-01'), employee: { branchId: BRANCH_A, assignedBranchIds: [] } });
    const res = await restoreCashAdvance('ca1');
    expect(res).toMatchObject({ ok: true });
    expect(txUpdate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/advance/advance-branch-enforcement.test.ts -t "full branch act-on"`
Expected: FAIL — under the old home-only gate the out-of-scope void/restore proceed (`requirePermission` mock returns a user regardless), and the already-deducted / live cases return their guard codes instead of `not-found`.

- [ ] **Step 3: Add the branch-scope import to void.ts**

In `src/lib/advance/void.ts`, add after the `requirePermission` import (line 6):

```ts
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
```

- [ ] **Step 4: Fix `voidCashAdvance` (gate before the void-guard)**

Extend the `row` employee select (line 48) to add `assignedBranchIds`:

```ts
      employee: { select: { branchId: true, assignedBranchIds: true } },
```

Then restructure lines 51–56 so the gate runs right after the `!row` check and **before** the `assertAdvanceVoidable` guard. Replace:

```ts
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };

  const guard = assertAdvanceVoidable({ isDeducted: row.isDeducted, deletedAt: row.deletedAt });
  if (!guard.ok) return { ok: false, code: guard.code, message: guard.message };

  const { user } = await requirePermission('advance.void', { branchId: row.employee.branchId });
```

with:

```ts
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };

  const { user } = await requirePermission('advance.void');
  const permitted = await getPermittedBranches(user, 'advance.void');
  if (
    !canActOnEmployeeBranches(permitted, [
      row.employee.branchId,
      ...row.employee.assignedBranchIds,
    ])
  ) {
    return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };
  }

  const guard = assertAdvanceVoidable({ isDeducted: row.isDeducted, deletedAt: row.deletedAt });
  if (!guard.ok) return { ok: false, code: guard.code, message: guard.message };
```

- [ ] **Step 5: Fix `restoreCashAdvance` (gate before the not-deleted short-circuit)**

Extend its `row` employee select (line 92) to add `assignedBranchIds`:

```ts
    select: { id: true, deletedAt: true, employee: { select: { branchId: true, assignedBranchIds: true } } },
```

Then restructure lines 94–97. Replace:

```ts
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };
  if (!row.deletedAt) return { ok: true };

  const { user } = await requirePermission('advance.void', { branchId: row.employee.branchId });
```

with:

```ts
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };

  const { user } = await requirePermission('advance.void');
  const permitted = await getPermittedBranches(user, 'advance.void');
  if (
    !canActOnEmployeeBranches(permitted, [
      row.employee.branchId,
      ...row.employee.assignedBranchIds,
    ])
  ) {
    return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };
  }

  if (!row.deletedAt) return { ok: true };
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm exec vitest run src/lib/advance/advance-branch-enforcement.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/advance/void.ts src/lib/advance/advance-branch-enforcement.test.ts
git commit -m "$(printf 'fix(advance): void/restore full home-union-assigned scope, gate before guards (B4)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm exec vitest run`
Expected: all green (existing suite + the 18 new advance tests). No regressions.

- [ ] **Step 2: Typecheck the whole project**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Confirm the page-gate guardrail still passes**

Run: `pnpm exec vitest run "src/app/(admin)/admin/admin-page-gates.test.ts"`
Expected: PASS (no new pages; advance still gated).

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: build succeeds.

---

## Self-Review (completed during planning)

- **Spec coverage:** Unit 1 → Task 1; Unit 2 (approve/reject/mark-paid) → Task 2; Unit 3 → Task 3; Unit 4 → Task 4; testing/verification → Tasks 2–5. All four spec units mapped, plus the global-actor invariant and existence-hide-ordering tests the spec requires.
- **Placeholder scan:** none — every step carries exact code/commands.
- **Type consistency:** every gate uses `canActOnEmployeeBranches(permitted, [branchId, ...assignedBranchIds])`; result codes match each call-site's existing union (`'not-found'` for inbox/approve/reject/mark-paid/void/restore, `'employee-not-found'` for adminCreate); permission strings per surface (`advance.read` / `advance.approve` / `advance.void`).
- **Known gap stated:** Task 1 read-filter has no integration harness (pre-existing program gap), verified by tsc + build + helper tests.
- **Mock-path note:** test boundary mocks (`@/lib/inngest/events`, `@/lib/notifications/admin-line`, `@/lib/notifications/in-app-bell`, `@/lib/advance/available`, `@/lib/advance/balance`) are copied from the existing `src/lib/advance/mark-paid.test.ts`; the branch-scope seam adds the `getUserAssignments` mock so the real `getPermittedBranches`/`canActOnEmployeeBranches` run.
