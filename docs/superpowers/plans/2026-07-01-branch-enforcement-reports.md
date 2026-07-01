# Branch Enforcement — Reports (Spec B5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope the three `/admin/reports` pages (attendance/advance/leave) and their branch-filter dropdown to the acting admin's permitted branches, by the `report.read` permission.

**Architecture:** `employeeWhere` in `src/lib/reports/queries.ts` is the single injection point — all five employee-set functions resolve through it. Add a `permitted` param that AND's `employeeBranchScope(permitted)` into the employee `where`; thread it through the five functions and the pages. Scope the branch dropdown loader too. Global/Superadmin resolve to `'all'` → `{}` → inert.

**Tech Stack:** Next.js App Router (Server Components), Prisma, Vitest, Biome, pnpm.

## Global Constraints

- **No new helpers, no schema/migration.** Use `getPermittedBranches`, `employeeBranchScope`, type `PermittedBranches` from `src/lib/auth/branch-scope.ts`.
- **Invariant — zero change for global/Superadmin:** `getPermittedBranches → 'all'` ⇒ `employeeBranchScope → {}` (no `AND` wrapper added; dropdown unfiltered).
- **Permission:** `report.read` for both the data scope and the dropdown scope.
- **Scope key:** the permission scope matches home `branchId` ∪ `assignedBranchIds` via `employeeBranchScope(permitted)`, AND-combined with the existing user filter (which keeps filtering by home `branchId`/department/`q`).
- **All 5 employee-set functions** in `queries.ts` get `permitted`: `advanceReport`, `attendanceReport`, `leaveReport`, `advanceDetail`, `leaveDetail`. Their ONLY callers are the 3 report pages (verified by grep; `/liff/summary` does not call them).
- **Branch base:** local main `f6710ef` (B3+B4+B-LIFF). Branch: `claude/spec-b5-reports-branch-enforcement`. tsc baseline: 0 errors.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run commands from the worktree root: `/Users/tong/Works/fai/work/.claude/worktrees/practical-satoshi-2a56f0`.

## File Structure

- `src/lib/reports/queries.ts` — `employeeWhere` + 5 fns gain `permitted` (Task 1).
- `src/app/(admin)/admin/reports/{attendance,advance,leave}/page.tsx` — capture user + `permitted`, thread to queries (Task 1) and the loader (Task 2).
- `src/app/(admin)/admin/reports/_load-filter-options.ts` — `loadReportFilterOptions(permitted)` (Task 2).
- `src/lib/reports/queries.branch.test.ts` — new (Task 1).
- `src/lib/reports/filter-options.branch.test.ts` — new (Task 2).

---

## Task 1: Scope the report queries + pages

**Files:**
- Modify: `src/lib/reports/queries.ts`
- Modify: `src/app/(admin)/admin/reports/attendance/page.tsx`, `advance/page.tsx`, `leave/page.tsx`
- Create: `src/lib/reports/queries.branch.test.ts`

**Interfaces:**
- Consumes: `employeeBranchScope(permitted)`, `getPermittedBranches(user, 'report.read')`, `type PermittedBranches` from `@/lib/auth/branch-scope`; `requirePermission` from `@/lib/auth/check-permission`.
- Produces: `employeeWhere(f, permitted)` (now exported); `advanceReport(period, filter, permitted)`, `attendanceReport(period, filter, permitted)`, `leaveReport(period, filter, year, permitted)`, `advanceDetail(period, filter, permitted)`, `leaveDetail(period, filter, permitted)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/reports/queries.branch.test.ts`:

```ts
/**
 * Branch-scope enforcement for report queries (Spec B5).
 * Tests the exported `employeeWhere` (the single injection point) directly,
 * plus one threading test proving advanceReport passes `permitted` through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// queries.ts does `import 'server-only'`, which throws under the default
// vitest config (no react-server condition / alias). Mock it to a no-op so
// this stays a plain unit test. (The integration config aliases it instead.)
vi.mock('server-only', () => ({}));

const employeeFindMany = vi.fn(async () => [] as unknown[]);
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: { findMany: (...a: unknown[]) => employeeFindMany(...a) },
    cashAdvance: { groupBy: vi.fn(async () => [] as unknown[]) },
  },
}));
vi.mock('@/lib/advance/available', () => ({ advanceBalanceFor: vi.fn(async () => ({ available: 0 })) }));

import { advanceReport, employeeWhere } from './queries';

const BRANCH_A = '00000000-0000-0000-0000-00000000000a';
const BRANCH_B = '00000000-0000-0000-0000-00000000000b';

describe('employeeWhere — permission branch scope', () => {
  it('scoped actor: AND-combines the user filter with employeeBranchScope', () => {
    const w = employeeWhere({ branchId: BRANCH_A }, [BRANCH_A]);
    expect(w).toEqual({
      AND: [
        { archivedAt: null, branchId: BRANCH_A },
        { OR: [{ branchId: { in: [BRANCH_A] } }, { assignedBranchIds: { hasSome: [BRANCH_A] } }] },
      ],
    });
  });

  it('forged out-of-scope filter still AND's the permitted scope', () => {
    const w = employeeWhere({ branchId: BRANCH_B }, [BRANCH_A]); // user asks for B, only permitted A
    expect(w).toMatchObject({
      AND: [
        { branchId: BRANCH_B },
        { OR: [{ branchId: { in: [BRANCH_A] } }, { assignedBranchIds: { hasSome: [BRANCH_A] } }] },
      ],
    });
  });

  it("global actor ('all'): plain user filter, no AND wrapper", () => {
    const w = employeeWhere({ branchId: BRANCH_A }, 'all');
    expect(w).toEqual({ archivedAt: null, branchId: BRANCH_A });
    expect(w).not.toHaveProperty('AND');
  });

  it('empty permitted []: AND's the match-nothing scope', () => {
    const w = employeeWhere({}, []);
    expect(w).toEqual({ AND: [{ archivedAt: null }, { id: { in: [] } }] });
  });
});

describe('advanceReport — threads permitted into the employee query', () => {
  beforeEach(() => vi.clearAllMocks());
  it('calls prisma.employee.findMany with the scoped where', async () => {
    await advanceReport({ from: '2026-06-01', to: '2026-06-30' }, { branchId: BRANCH_A }, [BRANCH_A]);
    expect(employeeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: employeeWhere({ branchId: BRANCH_A }, [BRANCH_A]) }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/reports/queries.branch.test.ts`
Expected: FAIL — `employeeWhere` is not exported and takes only one arg; `advanceReport` takes only two args.

- [ ] **Step 3: Add imports to `queries.ts`**

In `src/lib/reports/queries.ts`, add after the existing imports (after line 20):

```ts
import type { Prisma } from '@prisma/client';
import { employeeBranchScope, type PermittedBranches } from '@/lib/auth/branch-scope';
```

- [ ] **Step 4: Export `employeeWhere` + add the `permitted` param + scope merge**

Replace the current `employeeWhere` (lines 26–41):

```ts
function employeeWhere(f: EmployeeFilter) {
  return {
    archivedAt: null,
    ...(f.branchId ? { branchId: f.branchId } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.q
      ? {
          OR: [
            { firstName: { contains: f.q, mode: 'insensitive' as const } },
            { lastName: { contains: f.q, mode: 'insensitive' as const } },
            { nickname: { contains: f.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}
```

with (note the `export` and the scope merge):

```ts
export function employeeWhere(
  f: EmployeeFilter,
  permitted: PermittedBranches,
): Prisma.EmployeeWhereInput {
  const base: Prisma.EmployeeWhereInput = {
    archivedAt: null,
    ...(f.branchId ? { branchId: f.branchId } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.q
      ? {
          OR: [
            { firstName: { contains: f.q, mode: 'insensitive' as const } },
            { lastName: { contains: f.q, mode: 'insensitive' as const } },
            { nickname: { contains: f.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const scope = employeeBranchScope(permitted); // {} for 'all'
  return Object.keys(scope).length ? { AND: [base, scope] } : base;
}
```

- [ ] **Step 5: Thread `permitted` through all 5 functions**

For each of the five functions, add `permitted: PermittedBranches` as the LAST parameter and pass it to `employeeWhere`:

- `advanceReport(period, filter, permitted)` (line 56) → `where: employeeWhere(filter, permitted)` (line 61)
- `attendanceReport(period, filter, permitted)` (line 112) → its `employeeWhere(filter)` call → `employeeWhere(filter, permitted)`
- `leaveReport(period, filter, year, permitted)` (line 191, permitted AFTER `year`) → its `employeeWhere(filter)` → `employeeWhere(filter, permitted)`
- `advanceDetail(period, filter, permitted)` (line 346) → `employeeWhere(filter, permitted)` (line 351)
- `leaveDetail(period, filter, permitted)` (line 289) → `employeeWhere(filter, permitted)` (line 294)

(Search each function body for `employeeWhere(filter)` and add the `permitted` arg. There are exactly five call sites, one per function.)

- [ ] **Step 6: Wire the three pages (capture user + permitted; pass to the query calls)**

In each of the three pages, add these imports (alongside the existing `@/lib/reports/queries` import):

```ts
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
```

In each page, immediately after `const params = await searchParams;` add:

```ts
  const { user } = await requirePermission('report.read');
  const permitted = await getPermittedBranches(user, 'report.read');
```

Then pass `permitted` to the report/detail calls (leave `loadReportFilterOptions()` untouched — Task 2 handles it):

- `attendance/page.tsx`: `attendanceReport(period, { q: params.q, branchId, departmentId }, permitted)`
- `advance/page.tsx`: `advanceReport(period, filter, permitted)` and `advanceDetail(period, filter, permitted)`
- `leave/page.tsx`: `leaveReport(period, filter, year, permitted)` and `leaveDetail(period, filter, permitted)`

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/reports/queries.branch.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors (all five signatures + all three pages updated together; `loadReportFilterOptions()` still called argless — unchanged).

- [ ] **Step 9: Commit**

```bash
git add src/lib/reports/queries.ts "src/app/(admin)/admin/reports/attendance/page.tsx" "src/app/(admin)/admin/reports/advance/page.tsx" "src/app/(admin)/admin/reports/leave/page.tsx" src/lib/reports/queries.branch.test.ts
git commit -m "$(printf 'feat(reports): branch-scope report queries by report.read (B5)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Scope the branch-filter dropdown

**Files:**
- Modify: `src/app/(admin)/admin/reports/_load-filter-options.ts`
- Modify: `src/app/(admin)/admin/reports/{attendance,advance,leave}/page.tsx` (the `loadReportFilterOptions()` call only)
- Create: `src/lib/reports/filter-options.branch.test.ts`

**Interfaces:**
- Consumes: `type PermittedBranches` from `@/lib/auth/branch-scope`; `permitted` (already computed in each page by Task 1).
- Produces: `loadReportFilterOptions(permitted: PermittedBranches)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/reports/filter-options.branch.test.ts`:

```ts
/** Branch-scope of the report filter dropdown (Spec B5). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Defensive: neutralize any transitive `import 'server-only'` under the default config.
vi.mock('server-only', () => ({}));

const branchFindMany = vi.fn(async () => [] as unknown[]);
const departmentFindMany = vi.fn(async () => [] as unknown[]);
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    branch: { findMany: (...a: unknown[]) => branchFindMany(...a) },
    department: { findMany: (...a: unknown[]) => departmentFindMany(...a) },
  },
}));

import { loadReportFilterOptions } from '@/app/(admin)/admin/reports/_load-filter-options';

const BRANCH_A = '00000000-0000-0000-0000-00000000000a';

describe('loadReportFilterOptions — branch scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scoped actor: branch list limited to permitted ids', async () => {
    await loadReportFilterOptions([BRANCH_A]);
    expect(branchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null, id: { in: [BRANCH_A] } } }),
    );
  });

  it("global actor ('all'): branch list unfiltered", async () => {
    await loadReportFilterOptions('all');
    expect(branchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null } }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/reports/filter-options.branch.test.ts`
Expected: FAIL — `loadReportFilterOptions` takes no argument and always queries all branches.

- [ ] **Step 3: Add `permitted` to the loader**

In `src/app/(admin)/admin/reports/_load-filter-options.ts`, add the import near the top (after the `prisma` import):

```ts
import type { PermittedBranches } from '@/lib/auth/branch-scope';
import type { Prisma } from '@prisma/client';
```

Change the signature + the branch `where`:

```ts
export async function loadReportFilterOptions(permitted: PermittedBranches): Promise<{
  branches: FilterOption[];
  departments: FilterOption[];
}> {
  const branchWhere: Prisma.BranchWhereInput =
    permitted === 'all' ? { archivedAt: null } : { archivedAt: null, id: { in: permitted } };
  const [branches, departments] = await Promise.all([
    prisma.branch.findMany({
      where: branchWhere,
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
  return { branches, departments };
}
```

(Departments are org-config — leave unchanged.)

- [ ] **Step 4: Pass `permitted` in all three pages**

In each page, change the `loadReportFilterOptions()` call to `loadReportFilterOptions(permitted)` (the `permitted` variable already exists from Task 1). Exactly one call site per page (attendance:28, advance:32, leave:36 region).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/reports/filter-options.branch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/admin/reports/_load-filter-options.ts" "src/app/(admin)/admin/reports/attendance/page.tsx" "src/app/(admin)/admin/reports/advance/page.tsx" "src/app/(admin)/admin/reports/leave/page.tsx" src/lib/reports/filter-options.branch.test.ts
git commit -m "$(printf 'feat(reports): scope the branch-filter dropdown to permitted branches (B5)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm exec vitest run`
Expected: all green (existing suite + 7 new report tests). No regressions.

- [ ] **Step 2: Typecheck the whole project**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Confirm the page-gate guardrail still passes**

Run: `pnpm exec vitest run "src/app/(admin)/admin/admin-page-gates.test.ts"`
Expected: PASS (no new pages; the reports section layout `report.read` gate is unchanged).

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: build succeeds.

---

## Self-Review (completed during planning)

- **Spec coverage:** Unit 1 (queries) → Task 1; Unit 2 (dropdown) → Task 2; Unit 3 (pages) → split across Task 1 (query calls + gate) and Task 2 (loader call); testing/verification → Tasks 1–3. All spec units mapped. The spec's "5 functions" (advanceReport/attendanceReport/leaveReport/advanceDetail/leaveDetail) are all covered in Task 1 Step 5.
- **Placeholder scan:** none — every step carries exact code/commands.
- **Type consistency:** `employeeWhere(f, permitted)` and the five report fns take `permitted: PermittedBranches` (last param; `leaveReport` after `year`); pages compute `permitted` once (Task 1) and reuse it for the loader (Task 2); `loadReportFilterOptions(permitted)` matches. The `AND: [base, scope]` shape matches the test assertions.
- **tsc-green-per-task:** Task 1 updates all five signatures + all three pages' query calls together (loader stays argless), so tsc is 0 at the Task 1 boundary; Task 2 changes the loader + the three loader calls together. No broken intermediate state.
- **Caller completeness:** grep confirmed the five functions' only callers are the three report pages; `/liff/summary` and payslip do not call them (the `leaveDetail` in `payslip/document.ts` is a local variable, not the report function).
