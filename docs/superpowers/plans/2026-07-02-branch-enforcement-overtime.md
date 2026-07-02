# Branch Enforcement — Overtime + scope-presence guardrail (Spec B-OT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Branch-scope the Overtime surface (reads + writes), add a scope-presence guardrail so an unscoped employee-linked admin read can't ship again, and scope the sidebar badge counts.

**Architecture:** Reuse `src/lib/auth/branch-scope.ts`. OT reads merge `viaEmployeeBranchScope`/`employeeBranchScope` into the query `where`; OT writes load the target employee's branch set and gate with `canActOnEmployeeBranches` before mutating — scoped by `attendance.overtime.manage`. A new test scans `(admin)/admin/**` entry points for employee-linked reads and requires a scope primitive (or an allowlist entry). Global/Superadmin → `'all'` → inert.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Prisma, Vitest, Biome, pnpm.

## Global Constraints

- **No new helpers, no schema/migration.** Use `getPermittedBranches`, `permittedBranchesFromAssignments`, `employeeBranchScope`, `viaEmployeeBranchScope`, `canActOnEmployeeBranches`, type `PermittedBranches` from `src/lib/auth/branch-scope.ts`; `getUserAssignments` from `check-permission`.
- **Invariant — zero change for global/Superadmin:** `getPermittedBranches → 'all'` ⇒ `{}`/no-op / gate `true`.
- **Scope key:** the Overtime surface scopes by `attendance.overtime.manage`. Sidebar badges scope per-domain (`leave.read`/`advance.read`/`attendance.read`).
- **Write gate:** load the target employee's `[branchId, ...assignedBranchIds]`; `!emp || !canActOnEmployeeBranches(...)` → `redirect(backUrl(ym, '<Thai not-found>'))` before any write. `OvertimeEntry` links to Employee via `employeeId` (scope via the `employee` relation).
- **Branch base:** local main `3d60019` (full program incl. B-payroll-guard). Branch: `claude/spec-bot-overtime-branch-enforcement`. tsc baseline: 0 errors.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run commands from the worktree root: `/Users/tong/Works/fai/work/.claude/worktrees/practical-satoshi-2a56f0`.

## File Structure

- `src/lib/overtime/candidates.ts` — `getOtCandidates` gains `permitted` (Task 1).
- `src/app/(admin)/admin/attendance/overtime/page.tsx` — capture user+permitted; scope 3 reads (Task 1).
- `src/lib/overtime/actions.ts` — act-on gate in approve/dismiss/void (Task 2).
- `src/app/(admin)/layout.tsx` — scope 3 badge counts (Task 3).
- `src/app/(admin)/admin/scope-presence.test.ts` — new guardrail (Task 4).
- `src/lib/overtime/overtime.branch.test.ts` — new OT tests (Tasks 1–2).

---

## Task 1: Scope the Overtime reads

**Files:**
- Modify: `src/lib/overtime/candidates.ts`, `src/app/(admin)/admin/attendance/overtime/page.tsx`
- Create: `src/lib/overtime/overtime.branch.test.ts`

**Interfaces:**
- Consumes: `getPermittedBranches(user, 'attendance.overtime.manage')`, `viaEmployeeBranchScope`, `employeeBranchScope`, `PermittedBranches`.
- Produces: `getOtCandidates(args, permitted: PermittedBranches)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/overtime/overtime.branch.test.ts`:

```ts
/** Branch-scope enforcement for overtime (Spec B-OT). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const attendanceFindMany = vi.fn(async () => [] as unknown[]);
const otFindMany = vi.fn(async () => [] as unknown[]);
const payrollConfigFindFirst = vi.fn(async () => ({ otThresholdMinutes: 30 }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    attendance: { findMany: (...a: unknown[]) => attendanceFindMany(...a) },
    overtimeEntry: { findMany: (...a: unknown[]) => otFindMany(...a) },
    payrollConfig: { findFirst: (...a: unknown[]) => payrollConfigFindFirst(...a) },
  },
}));

import { getOtCandidates } from './candidates';

const BRANCH_A = '00000000-0000-0000-0000-00000000000a';

describe('getOtCandidates — branch scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scoped actor: attendance query carries the employee branch scope', async () => {
    await getOtCandidates({ ym: '2026-07' }, [BRANCH_A]);
    expect(attendanceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employee: { OR: [{ branchId: { in: [BRANCH_A] } }, { assignedBranchIds: { hasSome: [BRANCH_A] } }] },
        }),
      }),
    );
  });

  it("global actor ('all'): no employee scope added", async () => {
    await getOtCandidates({ ym: '2026-07' }, 'all');
    const arg = attendanceFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(arg.where).not.toHaveProperty('employee');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/overtime/overtime.branch.test.ts`
Expected: FAIL — `getOtCandidates` takes only one arg / no scope in the where.

- [ ] **Step 3: Add `permitted` to `getOtCandidates`**

In `src/lib/overtime/candidates.ts`, add the import at the top:

```ts
import { type PermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
```

Change the signature (line 39–42) to add `permitted`:

```ts
export async function getOtCandidates(
  args: { ym: string; employeeId?: string },
  permitted: PermittedBranches,
): Promise<OtCandidate[]> {
```

Merge the scope into the `attendance.findMany` where (the `where` object at lines 53–59) by adding `...viaEmployeeBranchScope(permitted)`:

```ts
    where: {
      type: 'CheckIn',
      deletedAt: null,
      clockOutAt: { not: null },
      date: { gte: start, lt: end },
      ...(args.employeeId ? { employeeId: args.employeeId } : {}),
      ...viaEmployeeBranchScope(permitted),
    },
```

And into the decided-entries `overtimeEntry.findMany` where (lines 81–85):

```ts
    where: {
      date: { gte: start, lt: end },
      deletedAt: null,
      ...(args.employeeId ? { employeeId: args.employeeId } : {}),
      ...viaEmployeeBranchScope(permitted),
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/lib/overtime/overtime.branch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the page (capture user+permitted; scope the 3 reads)**

In `src/app/(admin)/admin/attendance/overtime/page.tsx`, add imports:

```ts
import { employeeBranchScope, getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
```

Replace line 26:

```ts
  await requirePermission('attendance.overtime.manage');
```

with:

```ts
  const { user } = await requirePermission('attendance.overtime.manage');
  const permitted = await getPermittedBranches(user, 'attendance.overtime.manage');
```

Then update the three reads in the `Promise.all` (lines 35–58):
- `getOtCandidates({ ym })` → `getOtCandidates({ ym }, permitted)`
- the history `overtimeEntry.findMany` where (line 38) → `where: { date: { gte: start, lt: end }, ...viaEmployeeBranchScope(permitted) },`
- the picker `employee.findMany` where (line 54) → `where: { archivedAt: null, status: { not: 'Archived' }, ...employeeBranchScope(permitted) },`

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors (candidates signature + page caller updated together).

- [ ] **Step 7: Commit**

```bash
git add src/lib/overtime/candidates.ts "src/app/(admin)/admin/attendance/overtime/page.tsx" src/lib/overtime/overtime.branch.test.ts
git commit -m "$(printf 'feat(overtime): branch-scope OT candidates, history + picker reads (B-OT)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Act-on gate the Overtime writes

**Files:**
- Modify: `src/lib/overtime/actions.ts` (`approveOt` ~95, `dismissOt` ~144, `voidOt` ~184)
- Modify: `src/lib/overtime/overtime.branch.test.ts` (append)

**Interfaces:**
- Consumes: `getPermittedBranches(user, 'attendance.overtime.manage')`, `canActOnEmployeeBranches`.

- [ ] **Step 1: Write the failing test (append)**

Append to `src/lib/overtime/overtime.branch.test.ts`:

```ts
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
}));
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
}));
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn() }));
vi.mock('@/lib/leave/leave-config', () => ({ getLeaveConfig: vi.fn(async () => ({})) }));

// extend the prisma mock's models used by the write actions
const empFindUnique = vi.fn();
const otCreate = vi.fn(async () => ({ id: 'ot-new' }));
const otUpdate = vi.fn(async () => ({ id: 'ot1' }));
const otFindUniqueVoid = vi.fn();
// NOTE: re-declare the prisma mock to include employee.findUnique + overtimeEntry.create/update/findUnique.
// If the Task-1 vi.mock('@/lib/db/prisma') is already present at top-of-file, EXTEND that factory instead of
// adding a second — add: employee: { findUnique }, and to overtimeEntry: { findMany, create, update, findUnique }.

import { approveOt, dismissOt, voidOt } from './actions';

const BRANCH_B = '00000000-0000-0000-0000-00000000000b';
function scoped(perm: string, branchId: string | null) {
  return [{ branchId, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}
function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe('approveOt / dismissOt — act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
  });

  it('scoped actor on an out-of-scope employee → redirect, no OT created', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', BRANCH_A));
    empFindUnique.mockResolvedValue({ branchId: BRANCH_B, assignedBranchIds: [] });
    await expect(
      dismissOt(fd({ ym: '2026-07', employeeId: 'e1', date: '2026-07-10' })),
    ).rejects.toThrow(/REDIRECT:/);
    expect(otCreate).not.toHaveBeenCalled();
  });

  it('scoped actor on an in-scope employee → creates', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', BRANCH_A));
    empFindUnique.mockResolvedValue({ branchId: BRANCH_A, assignedBranchIds: [] });
    await dismissOt(fd({ ym: '2026-07', employeeId: 'e1', date: '2026-07-10' })).catch(() => {});
    expect(otCreate).toHaveBeenCalled();
  });

  it('rotating staff: home out-of-scope but assigned in-scope → creates', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', BRANCH_A));
    empFindUnique.mockResolvedValue({ branchId: BRANCH_B, assignedBranchIds: [BRANCH_A] });
    await dismissOt(fd({ ym: '2026-07', employeeId: 'e1', date: '2026-07-10' })).catch(() => {});
    expect(otCreate).toHaveBeenCalled();
  });

  it('global actor → creates for any employee', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', null));
    empFindUnique.mockResolvedValue({ branchId: BRANCH_B, assignedBranchIds: [] });
    await dismissOt(fd({ ym: '2026-07', employeeId: 'e1', date: '2026-07-10' })).catch(() => {});
    expect(otCreate).toHaveBeenCalled();
  });
});

describe('voidOt — act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
  });

  it('scoped actor voiding an out-of-scope entry → redirect, no update', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', BRANCH_A));
    otFindUniqueVoid.mockResolvedValue({ employee: { branchId: BRANCH_B, assignedBranchIds: [] } });
    await expect(voidOt(fd({ ym: '2026-07', id: 'ot1' }))).rejects.toThrow(/REDIRECT:/);
    expect(otUpdate).not.toHaveBeenCalled();
  });

  it('scoped actor voiding an in-scope entry → soft-deletes', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', BRANCH_A));
    otFindUniqueVoid.mockResolvedValue({ employee: { branchId: BRANCH_A, assignedBranchIds: [] } });
    await voidOt(fd({ ym: '2026-07', id: 'ot1' })).catch(() => {});
    expect(otUpdate).toHaveBeenCalled();
  });
});
```

Wire the new prisma mock members into the SINGLE `vi.mock('@/lib/db/prisma')` factory at the top of the file (do not create a second factory): `employee: { findUnique: (...a) => empFindUnique(...a) }` and `overtimeEntry: { findMany: (...a) => otFindMany(...a), create: (...a) => otCreate(...a), update: (...a) => otUpdate(...a), findUnique: (...a) => otFindUniqueVoid(...a) }`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/overtime/overtime.branch.test.ts`
Expected: FAIL — no gate; out-of-scope dismiss/void still call create/update.

- [ ] **Step 3: Add the branch-scope import to actions.ts**

In `src/lib/overtime/actions.ts`, add next to the `requirePermission` import:

```ts
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
```

- [ ] **Step 4: Gate `approveOt`**

In `approveOt`, after `const { user } = await requirePermission('attendance.overtime.manage');` (line 96) and after `const d = parsed.data;` (so `d.employeeId` is available; line ~102), BEFORE `const amount = await priceOt(d);` (line 103), add:

```ts
  const permitted = await getPermittedBranches(user, 'attendance.overtime.manage');
  const emp = await prisma.employee.findUnique({
    where: { id: d.employeeId },
    select: { branchId: true, assignedBranchIds: true },
  });
  if (!emp || !canActOnEmployeeBranches(permitted, [emp.branchId, ...emp.assignedBranchIds])) {
    redirect(backUrl(ym, 'ไม่พบพนักงาน'));
  }
```

- [ ] **Step 5: Gate `dismissOt`**

In `dismissOt`, after `const { user } = ...` (line 145) and after `employeeId`/`date` are read (line ~148), before the `try`/`create` (line ~152), add:

```ts
  const permitted = await getPermittedBranches(user, 'attendance.overtime.manage');
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { branchId: true, assignedBranchIds: true },
  });
  if (!emp || !canActOnEmployeeBranches(permitted, [emp.branchId, ...emp.assignedBranchIds])) {
    redirect(backUrl(ym, 'ไม่พบพนักงาน'));
  }
```

- [ ] **Step 6: Gate `voidOt`**

In `voidOt`, after `const { user } = ...` (line 185) and after `const id = ...` (line 187), before the `prisma.overtimeEntry.update` (line ~189), add:

```ts
  const permitted = await getPermittedBranches(user, 'attendance.overtime.manage');
  const target = await prisma.overtimeEntry.findUnique({
    where: { id },
    select: { employee: { select: { branchId: true, assignedBranchIds: true } } },
  });
  if (
    !target ||
    !canActOnEmployeeBranches(permitted, [
      target.employee.branchId,
      ...target.employee.assignedBranchIds,
    ])
  ) {
    redirect(backUrl(ym, 'ไม่พบรายการ'));
  }
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm exec vitest run src/lib/overtime/overtime.branch.test.ts`
Expected: PASS (2 from Task 1 + 6 new).

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` → 0 errors.

```bash
git add src/lib/overtime/actions.ts src/lib/overtime/overtime.branch.test.ts
git commit -m "$(printf 'feat(overtime): act-on gate approve/dismiss/void by employee branches (B-OT)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Scope the sidebar badge counts

**Files:**
- Modify: `src/app/(admin)/layout.tsx`

**Interfaces:**
- Consumes: `getUserAssignments`, `permittedBranchesFromAssignments`, `viaEmployeeBranchScope`.

- [ ] **Step 1: Add imports + compute scopes**

In `src/app/(admin)/layout.tsx`, add:

```ts
import { permittedBranchesFromAssignments, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { getUserAssignments } from '@/lib/auth/check-permission';
```

After `const { user, permissions } = await requireAdminArea();` (line 23), add:

```ts
  const assignments = await getUserAssignments(user.id);
  const leaveScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'leave.read'));
  const advScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'advance.read'));
  const attScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'attendance.read'));
```

- [ ] **Step 2: Scope the 3 counts**

Update the three counts (lines 29–31):

```ts
    prisma.leaveRequest.count({ where: { status: 'Pending', ...leaveScope } }),
    prisma.cashAdvance.count({ where: { status: 'Pending', ...advScope } }),
    prisma.attendance.count({ where: { type: 'CheckIn', checkInStatus: 'Disputed', ...attScope } }),
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` → 0 errors.

```bash
git add "src/app/(admin)/layout.tsx"
git commit -m "$(printf 'feat(admin): branch-scope sidebar badge counts (B-OT)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Scope-presence guardrail

Scans `(admin)/admin/**` entry-point files (pages/actions/routes) for reads of employee-linked models and requires a scope primitive, or an explicit EXEMPT entry. Catches an OT-class "gated but unscoped" surface at CI. (Lib service modules are covered transitively — their entry point must scope, and their own unit tests assert the injected scope; scanning all libs would need an unmanageably large allowlist, so this focuses on entry points where the OT gap actually lived.)

**Files:**
- Create: `src/app/(admin)/admin/scope-presence.test.ts`

- [ ] **Step 1: Write the guardrail**

Create `src/app/(admin)/admin/scope-presence.test.ts`:

```ts
/**
 * Guardrail: every admin entry point that reads an employee-linked model must
 * reference a branch-scope primitive (or global-only gate), or be explicitly
 * EXEMPTed with a reason. Catches "gated but unscoped" surfaces (the class that
 * let the Overtime module ship all-branch reads). Coarse (file-level): proves a
 * file scopes SOMETHING, not that every read is scoped — but a totally-unscoped
 * surface (the real failure mode) is caught.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ADMIN = __dirname; // src/app/(admin)/admin
const READ_RE =
  /prisma(?:Raw)?\.(?:attendance|leaveRequest|cashAdvance|employee|overtimeEntry)\.(?:findMany|findFirst|findUnique|count|groupBy|aggregate)/;
const SCOPE_RE =
  /getPermittedBranches|employeeBranchScope|viaEmployeeBranchScope|canActOnEmployeeBranches|requireGlobalPermission/;

/** Files that read an employee-linked model but are legitimately unscoped.
 *  Each MUST carry a reason. Add here only after confirming it's genuinely exempt. */
const EXEMPT: ReadonlyArray<{ file: string; reason: string }> = [
  // seeded empty; Step 3 fills this from the first run's offenders after confirming each is exempt
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts') && !e.name.endsWith('.test.tsx'))
      out.push(full);
  }
  return out;
}

describe('scope-presence guardrail (admin entry points)', () => {
  const exemptSet = new Set(EXEMPT.map((e) => e.file));

  it('every admin file reading an employee-linked model references a scope primitive (or is EXEMPT)', () => {
    const offenders: string[] = [];
    for (const f of walk(ADMIN)) {
      const rel = path.relative(ADMIN, f);
      if (exemptSet.has(rel)) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (READ_RE.test(text) && !SCOPE_RE.test(text)) offenders.push(rel);
    }
    expect(
      offenders,
      `Admin files read an employee-linked model without a branch-scope primitive.\nScope them, or add to EXEMPT with a reason:\n${offenders.map((r) => `  • ${r}`).join('\n')}`,
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — see the offenders**

Run: `pnpm exec vitest run "src/app/(admin)/admin/scope-presence.test.ts"`
Expected: FAIL — lists admin files reading an employee-linked model with no scope primitive. Because Tasks 1–2 already scoped Overtime, the remaining offenders should be legitimately-exempt files (e.g. `settings/*/actions.ts` referential dependency counts). Record the exact list printed.

- [ ] **Step 3: Confirm + allowlist each offender**

For EACH offender printed in Step 2: open the file, confirm the read is a legitimate exemption (org-config referential-integrity count behind a `settings.*.manage` gate; the acting user's own record; a non-employee model false-matched). Add it to `EXEMPT` with a one-line reason. Example shape:

```ts
const EXEMPT: ReadonlyArray<{ file: string; reason: string }> = [
  { file: 'settings/branches/actions.ts', reason: 'employee.count referential-integrity check behind settings.branch.manage; org-config context, count-only' },
  // ...one line per confirmed-exempt file from Step 2...
];
```

If any offender is NOT genuinely exempt (a real unscoped read), STOP and report it — that is another gap to fix, not to allowlist.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run "src/app/(admin)/admin/scope-presence.test.ts"`
Expected: PASS.

- [ ] **Step 5: Prove the guardrail bites (RED evidence)**

Temporarily remove `...viaEmployeeBranchScope(permitted)` from the history read in `overtime/page.tsx` AND the `getPermittedBranches`/`viaEmployeeBranchScope` imports usage so the file no longer matches `SCOPE_RE` (e.g. comment out the two added lines from Task 1 Step 5). Run the guardrail:

Run: `pnpm exec vitest run "src/app/(admin)/admin/scope-presence.test.ts"`
Expected: FAIL naming `attendance/overtime/page.tsx`. Then RESTORE the Task-1 changes and re-run → PASS. (This confirms the guardrail catches the exact OT-class gap.)

- [ ] **Step 6: Commit**

```bash
git add "src/app/(admin)/admin/scope-presence.test.ts"
git commit -m "$(printf 'test(admin): scope-presence guardrail for employee-linked reads (B-OT)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Whole test suite**

Run: `pnpm exec vitest run`
Expected: all green (existing suite + new overtime + scope-presence tests). No regressions. (If a pre-existing overtime test or a test that calls `getOtCandidates` breaks from the arity change, fix its call to pass `'all'` — grep `getOtCandidates(` across the repo first.)

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: All guardrails**

Run: `pnpm exec vitest run "src/app/(admin)/admin/admin-page-gates.test.ts" "src/app/(admin)/admin/payroll/payroll-gates.test.ts" "src/app/(admin)/admin/scope-presence.test.ts"`
Expected: PASS (3 files).

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: build succeeds.

---

## Self-Review (completed during planning)

- **Spec coverage:** Unit 1 (OT reads) → Task 1; Unit 2 (OT writes) → Task 2; Unit 4 (sidebar) → Task 3; Unit 3 (scope-presence guardrail) → Task 4; testing/verification → Tasks 1–5. All spec units mapped.
- **Deliberate spec refinement (flagged):** the spec's Unit 3 mentioned also scanning `src/lib/{overtime,reports,leave,advance,attendance}`. The plan scopes the guardrail to `(admin)/admin/**` entry points instead, because scanning lib helper modules (balance/available/recompute read employee data but are called from already-scoped contexts) would require a large, brittle allowlist, whereas entry-point coverage catches the actual OT failure mode (a surface page with zero scoping). Revisit at plan review if broader coverage is wanted.
- **Placeholder scan:** none — every step carries exact code/commands. (Task 4 Step 3's allowlist is filled from the Step-2 run output, with the shape shown — this is a discover-then-confirm step, not a placeholder.)
- **Type consistency:** `getOtCandidates(args, permitted)` signature used in Task 1 test + page caller; write gates use `canActOnEmployeeBranches(permitted, [branchId, ...assignedBranchIds])` uniformly; scope by `attendance.overtime.manage` for OT, per-domain for badges.
- **tsc-green-per-task:** Task 1 updates candidates signature + its page caller together; Task 2 additive; Task 3 self-contained; Task 4 test-only.
- **Caller completeness:** Task 5 Step 1 greps `getOtCandidates(` to catch any other caller broken by the arity change (the overtime page is the only known one).
