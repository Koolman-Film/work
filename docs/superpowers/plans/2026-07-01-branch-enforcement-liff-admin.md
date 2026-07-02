# Branch Enforcement — LIFF Mobile Admin Reads (Spec B-LIFF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope the four `/liff/admin/*` mobile admin reads (inbox's leave/advance/dispute lists, the awaiting-slip advance list, and the advance + leave detail pages) to the acting admin's permitted branches, by the same permission the web uses for each data type.

**Architecture:** Reuse `src/lib/auth/branch-scope.ts`. List reads merge `viaEmployeeBranchScope(permitted)` into the Prisma `where`; detail reads switch `findUnique → findFirst` so the branch relation-filter can be applied, and the existing `notFound()` fires for an out-of-scope (`null`) row. `requireLiffAdmin()` stays as the admission gate. Global/Superadmin resolve to `'all'` → `{}` → inert.

**Tech Stack:** Next.js App Router (Server Components), Prisma, Vitest, Biome, pnpm.

## Global Constraints

- **No new helpers, no schema/migration.** Use `getPermittedBranches`, `permittedBranchesFromAssignments`, `viaEmployeeBranchScope` from `src/lib/auth/branch-scope.ts`, and `getUserAssignments` from `src/lib/auth/check-permission`, exactly as they exist.
- **Invariant — zero change for global/Superadmin:** `getPermittedBranches`/`permittedBranchesFromAssignments → 'all'` ⇒ `viaEmployeeBranchScope → {}` (inert spread).
- **Per-data-type permission scoping:** leave reads → `leave.read`; advance reads → `advance.read`; attendance-dispute reads → `attendance.read`.
- **Reads-only.** Do NOT touch any mutation, server action, or `requireLiffAdmin()` itself. The action buttons already call gated server actions (B1/B3/B4).
- **Detail pages:** `findUnique → findFirst`, add `...viaEmployeeBranchScope(permitted)` to the `where`, keep/ensure `notFound()` on `null`. Do not change the `select`.
- **No new unit tests** — this is pure read-filter wiring composing already-tested helpers (per the spec). Verify with `tsc --noEmit` + `next build`; the final whole-branch review is the correctness gate.
- **Branch base:** local main `1e0d970` (includes B4). Branch: `claude/spec-bliff-liff-admin-reads`. tsc baseline: 0 errors.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Run commands from the worktree root: `/Users/tong/Works/fai/work/.claude/worktrees/practical-satoshi-2a56f0`.

## File Structure

- `src/app/(liff)/liff/admin/inbox/page.tsx` — scope 3 list reads (Task 1).
- `src/app/(liff)/liff/admin/advance/page.tsx` — scope the awaiting-slip list read (Task 1).
- `src/app/(liff)/liff/admin/advance/[id]/page.tsx` — scope the advance detail read (Task 2).
- `src/app/(liff)/liff/admin/leave/[id]/page.tsx` — scope the leave detail read (Task 2).

---

## Task 1: Scope the LIFF list reads (inbox + awaiting-slip)

Wiring — branch-filter the three inbox lists and the awaiting-slip advance list. No unit test (verified by `tsc` + `next build`).

**Files:**
- Modify: `src/app/(liff)/liff/admin/inbox/page.tsx`
- Modify: `src/app/(liff)/liff/admin/advance/page.tsx`

**Interfaces:**
- Consumes: `getUserAssignments(userId)`, `permittedBranchesFromAssignments(assignments, perm)`, `getPermittedBranches(user, perm)`, `viaEmployeeBranchScope(permitted) → { employee?: ... }` (`{}` for `'all'`).

- [ ] **Step 1: Inbox — add imports**

In `src/app/(liff)/liff/admin/inbox/page.tsx`, add after the existing `requireLiffAdmin` import (line 13):

```ts
import { permittedBranchesFromAssignments, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { getUserAssignments } from '@/lib/auth/check-permission';
```

- [ ] **Step 2: Inbox — capture user, load assignments once, compute 3 scopes**

Replace line 45:

```ts
  await requireLiffAdmin();
```

with:

```ts
  const { user } = await requireLiffAdmin();
  const assignments = await getUserAssignments(user.id);
  const leaveScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'leave.read'));
  const advScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'advance.read'));
  const attScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'attendance.read'));
```

- [ ] **Step 3: Inbox — merge each scope into its `where`**

In the three `findMany` calls, spread the matching scope into each `where`:

- `leaveRequest.findMany` (line 51): `where: { status: 'Pending', deletedAt: null, ...leaveScope },`
- `cashAdvance.findMany` (line 64): `where: { status: 'Pending', deletedAt: null, ...advScope },`
- `attendance.findMany` (line 75): `where: { type: 'CheckIn', checkInStatus: { in: ['Disputed'] }, deletedAt: null, ...attScope },`

(Each `where` has no pre-existing `employee` key, so the spread is safe — no `AND` merge needed.)

- [ ] **Step 4: Awaiting-slip — add imports + scope**

In `src/app/(liff)/liff/admin/advance/page.tsx`, add after the `requireLiffAdmin` import (line 14):

```ts
import { getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
```

Replace line 28:

```ts
  await requireLiffAdmin();
```

with:

```ts
  const { user } = await requireLiffAdmin();
  const permitted = await getPermittedBranches(user, 'advance.read');
```

And update the `findMany` `where` (line 31):

```ts
    where: { status: 'Approved', paidAt: null, deletedAt: null, ...viaEmployeeBranchScope(permitted) },
```

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(liff)/liff/admin/inbox/page.tsx" "src/app/(liff)/liff/admin/advance/page.tsx"
git commit -m "$(printf 'feat(liff): branch-scope the mobile admin inbox + awaiting-slip lists (B-LIFF)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Scope the LIFF detail reads (advance + leave)

Wiring — `findUnique → findFirst` with the branch scope so out-of-scope detail views `notFound()`. No unit test.

**Files:**
- Modify: `src/app/(liff)/liff/admin/advance/[id]/page.tsx`
- Modify: `src/app/(liff)/liff/admin/leave/[id]/page.tsx`

**Interfaces:**
- Consumes: `getPermittedBranches(user, perm)`, `viaEmployeeBranchScope(permitted)`.

- [ ] **Step 1: Advance detail — add import + capture user**

In `src/app/(liff)/liff/admin/advance/[id]/page.tsx`, add after the `requireLiffAdmin` import (line 17):

```ts
import { getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
```

Replace line 48:

```ts
  await requireLiffAdmin();
```

with:

```ts
  const { user } = await requireLiffAdmin();
  const permitted = await getPermittedBranches(user, 'advance.read');
```

- [ ] **Step 2: Advance detail — findUnique → findFirst + scope**

Change the `row` query (lines 50–65) from `findUnique` to `findFirst` and add the scope to its `where`:

```ts
  const row = await prisma.cashAdvance.findFirst({
    where: { id, ...viaEmployeeBranchScope(permitted) },
    select: {
      id: true,
      employeeId: true,
      amount: true,
      status: true,
      requestedAt: true,
      approvedAt: true,
      paidAt: true,
      receiptUrl: true,
      isDeducted: true,
      deletedAt: true,
      employee: { select: { firstName: true, lastName: true, nickname: true } },
    },
  });
  if (!row || row.deletedAt) notFound();
```

(The existing `if (!row || row.deletedAt) notFound();` already handles the out-of-scope `null` — do not remove it. Keep the `select` unchanged.)

- [ ] **Step 3: Leave detail — add import + capture user**

In `src/app/(liff)/liff/admin/leave/[id]/page.tsx`, add after the `requireLiffAdmin` import (the line `import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';`):

```ts
import { getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
```

Replace:

```ts
  await requireLiffAdmin();
```

with:

```ts
  const { user } = await requireLiffAdmin();
  const permitted = await getPermittedBranches(user, 'leave.read');
```

- [ ] **Step 4: Leave detail — findUnique → findFirst + scope**

In the `Promise.all`, change the leave query from:

```ts
    prisma.leaveRequest.findUnique({ where: { id }, select: LEAVE_SELECT }),
```

to:

```ts
    prisma.leaveRequest.findFirst({ where: { id, ...viaEmployeeBranchScope(permitted) }, select: LEAVE_SELECT }),
```

(The existing `if (!row) notFound();` after the `Promise.all` already handles the out-of-scope `null` — leave it in place.)

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(liff)/liff/admin/advance/[id]/page.tsx" "src/app/(liff)/liff/admin/leave/[id]/page.tsx"
git commit -m "$(printf 'feat(liff): branch-scope the mobile admin advance + leave detail reads (B-LIFF)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm exec vitest run`
Expected: all green (unchanged from baseline — this branch adds no tests and touches no tested code). No regressions.

- [ ] **Step 2: Typecheck the whole project**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Confirm the page-gate guardrail still passes**

Run: `pnpm exec vitest run "src/app/(admin)/admin/admin-page-gates.test.ts"`
Expected: PASS (LIFF pages are outside the `admin/` guardrail scope; `requireLiffAdmin` admission unchanged).

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: build succeeds (validates all four LIFF Server Components + the `findUnique → findFirst` type changes end-to-end).

---

## Self-Review (completed during planning)

- **Spec coverage:** Unit 1 (inbox) → Task 1; Unit 2 (advance list) → Task 1; Unit 3 (advance detail) → Task 2; Unit 4 (leave detail) → Task 2; testing/verification → Task 3. All four spec units mapped.
- **Placeholder scan:** none — every step carries the exact code/command.
- **Type consistency:** list reads use `...viaEmployeeBranchScope(permitted)` spread into `where`; detail reads use `findFirst({ where: { id, ...viaEmployeeBranchScope(permitted) } })` + existing `notFound()`; permission strings match per data type (`leave.read` / `advance.read` / `attendance.read`). The inbox loads assignments once (`getUserAssignments` + `permittedBranchesFromAssignments`×3); single-type pages use `getPermittedBranches` once.
- **Reads-only confirmed:** no mutation/action/`requireLiffAdmin` change in any task.
- **Known gap stated:** no unit tests (pure wiring, per spec); tsc + build + final review are the gates.
