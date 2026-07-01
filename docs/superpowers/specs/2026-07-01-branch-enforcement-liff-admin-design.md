# Spec B-LIFF — Branch-scope enforcement: LIFF mobile admin reads

**Status:** Approved design (2026-07-01)
**Program:** Branch-scoped administration. Prod has A, B1 (attendance, `2613b2d`), B2a/B2b (employees), B3 (leave, `70107c2`), B4 (advance, merged local `1e0d970`, un-pushed). Built on `1e0d970`. This is **B-LIFF** — the deferred follow-up flagged by both the B3 and B4 final reviews: the `/liff/admin/*` mobile admin surface reads leave, advance, and attendance-dispute data with **no branch filter**, unlike their web equivalents.

## Problem

The four LIFF admin pages are gated only by `requireLiffAdmin()` (= `requireRole(['Admin'])` + `canDo(user, 'liff.admin')`) — admission by tier + the `liff.admin` permission — with **no branch scoping** on their reads:

- `liff/admin/inbox/page.tsx` — reads pending **leave** (`leaveRequest.findMany`), pending **advance** (`cashAdvance.findMany`), and **attendance disputes** (`attendance.findMany` where `checkInStatus in ['Disputed']`), all unscoped.
- `liff/admin/advance/page.tsx` — the "awaiting slip" list (`cashAdvance.findMany` where Approved, `paidAt: null`), unscoped.
- `liff/admin/advance/[id]/page.tsx` — one advance (`cashAdvance.findUnique`), unscoped.
- `liff/admin/leave/[id]/page.tsx` — one leave (`leaveRequest.findUnique`), unscoped.

Because `requireRole(['Admin'])` gates on **tier** and `computeTier` ignores `branchId` (keys on role `key`), a branch-scoped *custom* role cannot reach this surface at all; the reachable path is the *system* `admin` role assigned to a single branch (tier `Admin` + scoped permitted-branches). Such an actor is correctly scoped on the web (B1/B3/B4) but sees **all branches** on mobile. Not prod-exploitable today (all prod admins are global), but it is the same read-leak class the web enforcement closes.

**Mutations are already gated.** The action buttons on these pages call the same `src/lib/advance/admin.ts` / `src/lib/advance/void.ts` / `src/lib/leave/admin.ts` / attendance server actions that B1/B3/B4 gated. So B-LIFF is **reads-only** — it closes the view leak; the write paths are already safe.

## Goal (B-LIFF)

Every LIFF admin read is scoped to the acting admin's permitted branches, matching an employee's full branch set (home `branchId` ∪ `assignedBranchIds`), **by the same permission the web uses for that data type**:

- Leave reads → `leave.read` · Advance reads → `advance.read` · Attendance-dispute reads → `attendance.read`.

**Invariant: zero change for global/Superadmin** (`getPermittedBranches → 'all'` ⇒ `viaEmployeeBranchScope → {}`, an inert filter). Reuses `src/lib/auth/branch-scope.ts` as-is. **No new helpers, no schema/migration.** `requireLiffAdmin()` stays as the admission gate; B-LIFF adds scoping on top.

### Scoping key (approved decision)

Each read is scoped by its **own data-type permission** (not by `liff.admin`), so the mobile inbox shows the *same* rows as the three web surfaces for the same admin. Consequence: a `liff.admin` holder who lacks a data-type permission sees that inbox section empty — correct (no permission, no data), and a no-op for global admins (who hold every permission).

## Non-goals (explicit)

- No change to the LIFF **mutations** (already gated by B1/B3/B4) or to `requireLiffAdmin()`'s admission logic.
- No web-surface changes. No dashboard/reports (B5/B6). No worker-facing LIFF (self-scoped).
- No new permissions, schema, or migration.

## Architecture

Helpers already in `src/lib/auth/branch-scope.ts`: `getPermittedBranches(user, perm) → 'all' | string[]`, `permittedBranchesFromAssignments(assignments, perm)` (pure), `viaEmployeeBranchScope(permitted)` (relation where-fragment, `{}` for `'all'`). `getUserAssignments(user.id)` from `check-permission`.

### Unit 1 — LIFF inbox (`liff/admin/inbox/page.tsx`)

Capture the user (currently `await requireLiffAdmin()` discards it) and load assignments **once**, then compute three scopes (one assignment round-trip, three pure resolutions — the inbox already fans out three reads):

```ts
const { user } = await requireLiffAdmin();
const assignments = await getUserAssignments(user.id);
const leaveScope = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'leave.read'));
const advScope   = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'advance.read'));
const attScope   = viaEmployeeBranchScope(permittedBranchesFromAssignments(assignments, 'attendance.read'));
```

Merge each scope into its query `where` (each is `{}` for a global actor → inert):

```ts
prisma.leaveRequest.findMany({ where: { status: 'Pending', deletedAt: null, ...leaveScope }, ... })
prisma.cashAdvance.findMany({ where: { status: 'Pending', deletedAt: null, ...advScope }, ... })
prisma.attendance.findMany({ where: { type: 'CheckIn', checkInStatus: { in: ['Disputed'] }, deletedAt: null, ...attScope }, ... })
```

(`viaEmployeeBranchScope` returns `{ employee: {...} }`; spreading it adds the `employee` relation filter. These wheres have no pre-existing `employee` key, so a plain spread is safe — no `AND` merge needed.)

### Unit 2 — LIFF advance list (`liff/admin/advance/page.tsx`)

```ts
const { user } = await requireLiffAdmin();
const permitted = await getPermittedBranches(user, 'advance.read');
prisma.cashAdvance.findMany({
  where: { status: 'Approved', paidAt: null, deletedAt: null, ...viaEmployeeBranchScope(permitted) },
  ...
});
```

### Unit 3 — LIFF advance detail (`liff/admin/advance/[id]/page.tsx`)

Switch the `findUnique` to `findFirst` so the branch relation-filter can be applied; the existing `if (!row || row.deletedAt) notFound()` then fires for an out-of-scope row (returns `null`):

```ts
const { user } = await requireLiffAdmin();
const permitted = await getPermittedBranches(user, 'advance.read');
const row = await prisma.cashAdvance.findFirst({
  where: { id, ...viaEmployeeBranchScope(permitted) },
  select: { /* unchanged */ },
});
if (!row || row.deletedAt) notFound();
```

For a global actor `viaEmployeeBranchScope` is `{}`, so `findFirst({ where: { id } })` behaves like the old `findUnique` — no change.

### Unit 4 — LIFF leave detail (`liff/admin/leave/[id]/page.tsx`)

Same pattern — `findUnique` → `findFirst` with the scope, `notFound()` on `null`:

```ts
const { user } = await requireLiffAdmin();
const permitted = await getPermittedBranches(user, 'leave.read');
const req = await prisma.leaveRequest.findFirst({
  where: { id, ...viaEmployeeBranchScope(permitted) },
  select: LEAVE_SELECT,
});
if (!req) notFound();
```

Ensure a `notFound()` fires on `null` — if the page does not already null-check the leave row, add `if (!req) notFound();` immediately after the query (the plan verifies the current file and adds it if absent). Keep `LEAVE_SELECT` unchanged — no `branchId`/`assignedBranchIds` needed because the scope lives in the `where`, not in code.

## Testing

**This increment is entirely read-filter wiring in Server Components — there is no new pure logic to unit-test** (it composes the already-tested `permittedBranchesFromAssignments` / `viaEmployeeBranchScope` / `getPermittedBranches`). Consistent with how B1–B4 treated their page read-filters (and the tracked read-filter-harness gap), verification is:

- `tsc --noEmit` clean (validates the `findUnique → findFirst` type changes and the scope spreads).
- `next build` green (compiles all four Server Components).
- The existing `src/lib/auth/branch-scope.test.ts` covers the helper behavior (`'all' → {}`, scoped → relation filter).
- Full suite + page-gate guardrail unaffected (LIFF pages are outside the `admin/` guardrail scope; `requireLiffAdmin` admission is unchanged).
- A thorough final review verifies each of the four reads is scoped, both detail pages `notFound` out-of-scope, and the global-actor path is inert.

Because there are no testable gates, the **final whole-branch review is the primary correctness check** for this increment — weight it accordingly.

## Files touched

| File | Change |
|------|--------|
| `src/app/(liff)/liff/admin/inbox/page.tsx` | capture user; one `getUserAssignments`; scope the 3 reads (leave.read / advance.read / attendance.read) |
| `src/app/(liff)/liff/admin/advance/page.tsx` | scope the awaiting-slip read (advance.read) |
| `src/app/(liff)/liff/admin/advance/[id]/page.tsx` | `findUnique → findFirst` + advance.read scope; existing `notFound` covers out-of-scope |
| `src/app/(liff)/liff/admin/leave/[id]/page.tsx` | `findUnique → findFirst` + leave.read scope; `notFound` on null |

## Open risks

- **No unit tests (by nature):** this is pure read-filter wiring; there is no extractable logic that isn't already tested at the helper level. Stated plainly. The final review is the correctness gate. If deeper assurance is wanted, a manual check with a branch-scoped system-admin account against a seeded multi-branch DB is the way — but that is outside the automated pipeline (the same read-filter-harness gap tracked program-wide).
- **`findUnique → findFirst`:** `findFirst` allows the relation filter `findUnique` cannot. It returns the same single row for a unique `id`; the only behavioral change is that an out-of-scope row returns `null` (→ `notFound`) instead of the row. No other call-site depends on these being `findUnique`.
- **Three assignment reads avoided:** the inbox loads assignments once and resolves three permissions purely, rather than calling `getPermittedBranches` three times (three `getUserAssignments` round-trips). Functionally identical, one DB read.
- **Blast radius:** all prod admins are global → every scope is `{}` → zero change in production. Only a future branch-scoped *system-admin* assignment is affected. Pure-code, fully reversible, no migration.
