# Spec B4 — Branch-scope enforcement: advance inbox + mutations

**Status:** Approved design (2026-06-30)
**Program:** Branch-scoped administration. Prod has A, B1 (attendance, `2613b2d`), B2a/B2b (employees, `d395bbc`/`f694d5b`), B3 (leave, `70107c2`). Built on current main `70107c2`. This is **B4** — applying the existing `branch-scope.ts` primitives to the `/admin/advance` (cash-advance) surface, structurally a twin of B3 (leave) plus one extra financial mutation.

## Problem

A branch-scoped admin (a role granted `advance.read`/`advance.approve`/`advance.void` at specific branches) currently sees and acts on cash-advance requests **across all branches**:

- **Inbox read** (`advance/page.tsx`): gated `advance.read`, but the `CashAdvance` query has **no branch filter** (live list + trash view).
- **approve / reject** (`lib/advance/admin.ts`): gated `advance.approve`, **no branch check**.
- **mark-paid** (`markAdvancePaid`, `admin.ts`): gated `advance.approve`, **no branch check** — this records that money was transferred (attaches the slip, sets `paidAt`), a high-stakes financial mutation with no leave equivalent.
- **on-behalf create** (`adminCreateCashAdvance`): the picker on `advance/new` is **already** branch-filtered, but the server action validates only `advance.approve` — a forged POST with an out-of-scope `employeeId` succeeds (same gap B2b/B3 closed).
- **void / restore** (`lib/advance/void.ts`): has a **partial** check — `requirePermission('advance.void', { branchId: row.employee.branchId })` gates on the employee's **home branch only**, missing rotating staff's `assignedBranchIds` (the same asymmetry B1/B3 fixed). The branch check also runs *after* the void-guard / not-found short-circuits, leaking existence.

## Goal (B4)

Every `/admin/advance` surface — inbox read (incl. trash), approve, reject, mark-paid, on-behalf create, void, restore — is scoped to the actor's permitted branches, matching an employee's full branch set (home `branchId` ∪ `assignedBranchIds`). **Invariant: zero change for global/Superadmin** (`getPermittedBranches → 'all'` ⇒ `{}` read filter and `canActOnEmployeeBranches → true`).

Reuses `src/lib/auth/branch-scope.ts` as-is. **No new helpers, no schema/migration.**

## Non-goals (explicit)

- **Dashboard & reports advance widgets** (advance `balance`/`available`/`period-earnings` consumers): deferred to a later increment (B5/B6).
- **Worker-facing advance** (`lib/advance/actions.ts`: worker self-submit / cancel): self-service, scoped to the worker's own record — out of scope.
- **LIFF admin advance** (if `/liff/admin/*` surfaces advances): part of the deferred **B-LIFF** increment, not B4.
- No change to advance math (balance, available, period-earnings, void-guards' business rules), perms, or UI beyond what enforcement requires.

## Architecture

All units use helpers that already exist in `src/lib/auth/branch-scope.ts`: `getPermittedBranches(user, perm) → 'all' | string[]`, `viaEmployeeBranchScope(permitted)` (read fragment, `{}` for `'all'`), `canActOnEmployeeBranches(permitted, [home, ...assigned])` (write gate; `'all'` ⇒ true).

### Unit 1 — Inbox read filter (`advance/page.tsx`)

Capture the user (currently `await requirePermission('advance.read')` discards it) and intersect the query — identical to B3 Unit 1:

```ts
const { user } = await requirePermission('advance.read');
const permitted = await getPermittedBranches(user, 'advance.read');
const scope = viaEmployeeBranchScope(permitted); // {} for 'all'
if (scope.employee) {
  where.employee = where.employee ? { AND: [where.employee, scope.employee] } : scope.employee;
}
```

Apply the same `scope.employee` to the **trash** read (`prismaRaw.cashAdvance.findMany` + `count` for `deletedAt != null`):

```ts
const trashWhere: Prisma.CashAdvanceWhereInput = { deletedAt: { not: null } };
if (scope.employee) trashWhere.employee = scope.employee;
```

`count` already mirrors `findMany`'s `where` — keep that.

### Unit 2 — approve / reject / mark-paid act-on gate (`lib/advance/admin.ts`)

Each of `approveCashAdvance`, `rejectCashAdvance`, `markAdvancePaid` already loads the advance (by id) before mutating. Ensure the loaded advance's `employee` select includes `branchId` + `assignedBranchIds` (extend the existing select; `markAdvancePaid` already selects the employee relation, the others select `employeeId` — add the relation), then gate **before** mutating:

```ts
const permitted = await getPermittedBranches(user, 'advance.approve');
if (!canActOnEmployeeBranches(permitted, [emp.branchId, ...emp.assignedBranchIds])) {
  return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' }; // matches each fn's existing missing-row code
}
```

Place the gate after the row is loaded and its status precondition is checked (e.g. `markAdvancePaid`'s `status === 'Approved'` check), but before any write. For `markAdvancePaid` the gate is inside the same transaction that loads `row` — add it right after the `not-found` / status checks.

### Unit 3 — on-behalf create server validation (`adminCreateCashAdvance`)

The `advance/new` picker is already branch-filtered. Close the **server** gap: the action already loads the target employee with `archivedAt`/`status` — extend that select with `branchId` + `assignedBranchIds`, and after the existing not-found / archived checks add:

```ts
const permitted = await getPermittedBranches(user, 'advance.approve');
if (!canActOnEmployeeBranches(permitted, [employee.branchId, ...employee.assignedBranchIds])) {
  return { ok: false, code: 'employee-not-found', message: 'ไม่พบพนักงาน' };
}
```

Reuse the existing `employee-not-found` result code (don't leak that the employee exists but is out of scope).

### Unit 4 — void / restore: fix partial scope + ordering (`lib/advance/void.ts`)

Replace the home-branch-only mechanism in both `voidCashAdvance` and `restoreCashAdvance`. The row lookup already selects `employee.branchId`; add `employee.assignedBranchIds`. Move the gate to run **immediately after the `if (!row) return not-found`**, and **before** the void-guard short-circuit (`voidCashAdvance`) / the not-deleted short-circuit (`restoreCashAdvance`), so out-of-scope is uniformly hidden:

```ts
const { user } = await requirePermission('advance.void'); // was: { branchId: row.employee.branchId }
const permitted = await getPermittedBranches(user, 'advance.void');
if (!canActOnEmployeeBranches(permitted, [row.employee.branchId, ...row.employee.assignedBranchIds])) {
  return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };
}
```

This converges void/restore on the same primitive, fixes the rotating-staff asymmetry, and (unlike B3's first pass) places the existence-hiding gate correctly from the start.

## Testing

New `src/lib/advance/advance-branch-enforcement.test.ts`, mocking only boundaries (`next/navigation`, `next/cache`, `next/headers`, audit, `@/lib/auth/check-permission`'s `requirePermission` + `getUserAssignments`, prisma, supabase/admin, notifications) and driving the **real** `getPermittedBranches` / `canActOnEmployeeBranches`. Mirrors `src/lib/leave/leave-branch-enforcement.test.ts`.

Cases:
- **approve / reject / mark-paid** — scoped actor, in-scope employee → proceeds past the gate; out-of-scope → `not-found`, **no** mutation; **global** actor → any.
- **mark-paid specifically** — out-of-scope → `not-found`, no `paidAt`/`receiptUrl` write (the financial-mutation gate).
- **adminCreateCashAdvance** — out-of-scope employee → `employee-not-found`, no create; in-scope → proceeds; global → any.
- **void / restore** — scoped out-of-scope → `not-found`, no mutation; **rotating-staff regression**: home out-of-scope but an assigned branch in-scope → authorized; **existence-hide**: out-of-scope on an already-voided / not-deleted row → uniform `not-found` (gate runs before the guard/short-circuit); **global** actor → proceeds.
- **Read filter (Unit 1):** covered by the existing `viaEmployeeBranchScope` helper tests + tsc/build (the page read-filter wiring lacks an integration harness — the known, separately-tracked program gap; stated, not hidden).
- Full suite + `tsc --noEmit` clean; `next build` green; page-gate guardrail still green (no new pages).

## Files touched

| File | Change |
|------|--------|
| `src/app/(admin)/admin/advance/page.tsx` | capture user; merge `viaEmployeeBranchScope` into live + trash `where` |
| `src/lib/advance/admin.ts` | act-on gate on `approveCashAdvance` / `rejectCashAdvance` / `markAdvancePaid` (+ employee branch select); `adminCreateCashAdvance` server-side act-on validation (+ employee branch select) |
| `src/lib/advance/void.ts` | `voidCashAdvance` / `restoreCashAdvance` → full `canActOnEmployeeBranches`, gate before guard/existence short-circuits |
| `src/lib/advance/advance-branch-enforcement.test.ts` (new) | act-on + mark-paid + create-validation + rotating-staff + existence-hide + global-actor tests |

## Open risks

- **Read-filter wiring lacks an integration harness** (pre-existing program gap): verified by helper tests + tsc/build, not an end-to-end render test. Stated; not newly introduced.
- **`markAdvancePaid` gate inside a transaction:** the gate runs inside the existing `$transaction` after the row load. `getPermittedBranches` reads the actor's assignments (independent of the advance row), so it can be computed before the transaction and the pure `canActOnEmployeeBranches` check applied inside — the plan will load `permitted` before the tx to avoid a query inside it.
- **`code: 'forbidden'` in `markAdvancePaid`** is the slip-link-invalid path (unrelated to branch); the branch gate uses `not-found`. Do not conflate.
- **Blast radius:** all prod admins are global → enforcement is a no-op for them; only future branch-scoped advance roles are affected. Pure-code, fully reversible, no migration.
