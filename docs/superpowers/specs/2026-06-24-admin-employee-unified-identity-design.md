# Admin-Employee Unified Identity + Combined LIFF Home

**Date:** 2026-06-24
**Status:** Approved design — ready for implementation plan

> **Re-verification (2026-06-26, against `main` @ a080fd0).** `main` advanced ~40
> commits after the first draft (payslip PDF, leave derive-on-read + freeze, in-app
> leave recompute tool, list pagination + admin name search, `attention` button).
> Re-checked every load-bearing assumption — all still hold:
> - `computeTier` still highest-wins; root router still tier-based; `User` model
>   unchanged (no conflict with the new `merge*` columns); `/liff/home` still free.
> - Data/calc safety intact: payroll still selects by `Employee.status`
>   (`payroll/run.ts:70`); `reports/queries.ts` `employeeWhere` is still
>   Employee-scoped (no role filter) post-pagination; leave derive-on-read has no
>   role/tier dependency; attribution columns still calc-irrelevant.
> - **One change folded in:** the payslip feature added two new `Staff` gates
>   (`/liff/payslip/page.tsx` and the Route Handler `/liff/payslip/pdf/route.ts`),
>   now included in the §2 audit list.
>
> The feature branch was rebased onto `main`, so the plan builds against current code.

## Problem

Some people are **both** an admin **and** a real employee on payroll (e.g. an
owner-manager or HR lead who checks in daily *and* approves others' requests).

Today the system structurally forbids this:

- A `User` is **either** Staff (has a 1:1 `Employee` record) **or** Admin/Superadmin
  (has **no** `Employee` record).
- `User.lineUserId` is `@unique` — one LINE account maps to exactly one `User`.
- The admin-pairing flow actively rejects the overlap with a Thai error:
  *"one LINE account can connect to only one user — admins who are also employees
  must use a separate LINE account"* (`src/lib/auth/link-line-to-admin.ts`).

So an admin-employee must carry **two LINE accounts** and switch between them. We
want them to use **one** LINE account and see **both** their employee features and
their admin tools.

## Goal

An admin-employee, on a single LINE account:

- Performs **full employee actions** — check in/out, submit their own leave &
  advance requests, view their own payslip/salary (they are on payroll).
- Performs **admin actions** — approve requests, view the admin dashboard & reports.
- Sees a **combined LIFF home**: an employee button group on top, an admin button
  group below.

### Supported populations (none are dropped)

The pure-admin case (typically only the **owner**) stays first-class and unchanged —
this work *adds* the admin-employee case, it does not replace the others:

| Population | `Employee` record? | admin role? | Login | Lands on |
|---|---|---|---|---|
| **Owner / pure admin** | no | yes | email/password (unchanged) | `/admin` |
| **Worker** (staff) | yes | no | LINE (unchanged) | `/liff/check-in` |
| **Admin-employee** (new) | yes | yes | LINE | `/liff/home` |

A pure admin has no `Employee` record, so the §2 gate keeps them out of employee
features exactly as today; the §7 merge card is shown to pure admins but is
dismissible (`mergePromptDismissedAt`), so an owner who is never an employee simply
dismisses it once.

## Chosen approach: unify at the `User` level (Approach A)

An admin-employee is simply a `User` that has **both** an `Employee` record **and**
an `Admin`/`Superadmin` role assignment. The Prisma schema already supports this:

- `User.employee` is an **optional** 1:1 relation.
- `UserRoleAssignment` is a **many-to-many** join — a `User` can hold multiple roles.

So **no schema migration is required** for the core. The work is *removing* the
assumption that "admin ⇒ no employee" and fixing the access gates and routing that
encode it.

Rejected alternatives:

- **B — two linked `User`s:** fights `lineUserId @unique`, needs two synced rows.
  This is today's two-account pain with a link bolted on.
- **C — everyone is an Employee, admin is just a role:** biggest migration; forces
  payroll/attendance semantics onto people who only administer (e.g. an external
  accountant or owner not on payroll).

## Design

### 1. Identity & auth — one LINE session resolves both capabilities

The admin-employee authenticates once via LINE OIDC in the LIFF. Their single
`User` row carries:

- `lineUserId` = their LINE `sub` (bound at pairing),
- an `Employee` record (so `getCurrentEmployee` and employee flows work),
- `admin`/`superadmin` role assignment(s) (so `requireRole` and `canDo` work).

The existing `requireRole` **LIFF fallback** (`require-role.ts:97-105`) already
resolves a LINE-minted session to the `User` row via `lineUserId` when the primary
`authUserId` lookup misses. That same fallback is what lets one LINE-only
admin-employee resolve to one `User` that has both an employee and admin roles. The
admin web pages (dashboard/reports) open in LINE's in-app browser carrying that
same Supabase session.

**Auth decision: LINE-only.** No second email/password web account is required for
an admin-employee. (Pure admins keep their existing email login unchanged.)

### 2. Gate employee features on the `Employee` record (the source of truth) — THE load-bearing change

**Terminology: "staff" and "employee" are the same population.** Creating an
employee is one atomic transaction that makes a `User` + `Employee` record + a
`staff` `UserRoleAssignment` together (`src/app/(admin)/admin/employees/actions.ts`,
~lines 46-106; it even throws if the `staff` system role is missing). So the `staff`
*role* only ever exists alongside an `Employee` *record*, and vice versa. The
`Employee` record is the **source of truth** for "is a worker"; the `staff` *tier*
is just a derived label computed from the role assignment.

The problem is that the derived label gets **masked**. `computeTier` is
**highest-wins and single-valued** (`src/lib/auth/user-tier.ts`): a user holding
both a `staff` and an `admin` assignment computes to tier **`Admin`** (or
`Superadmin`), **never `Staff`** — even though they are still very much an employee.

The worker LIFF is currently gated on `requireRole(['Staff'])` — e.g.
`requireCheckInPermission` (`require-role.ts:154-162`). `requireRole` deliberately
does **not** auto-elevate Admin/Superadmin into `Staff` gates (`require-role.ts:130-134`).
So gating on the masked tier locks an admin-employee (tier `Admin`) **out** of
check-in, leave, and advance — the opposite of the goal.

**Fix:** gate employee features on the source of truth — *"has an `Employee`
record"* — instead of the masked `tier === 'Staff'` label. `requireRole` already
eagerly loads `employee` for every tier (`require-role.ts:79`), so the change is
mechanical:

- `requireCheckInPermission` (and the other employee LIFF gates) change from
  `requireRole(['Staff'])` to `requireRole(['Staff', 'Admin', 'Superadmin'])`
  followed by the existing `if (!result.employee) notFound()` and the eligibility
  checks (`status`, `canCheckIn`).
- Net effect: "any authenticated user **with an employee record**, who is allowed
  to check in" — which now correctly includes admin-employees, and is unchanged for
  workers (who have an employee record) and pure admins (who don't, so they're
  still excluded from check-in, as today).

**Implementation note:** the plan must **audit every `requireRole(['Staff'])` call
site** and apply this widen-then-require-employee pattern consistently. The complete
current surface (verified against `main` @ a080fd0, 2026-06-26):

- Server actions / lib: `src/lib/attendance/check-in.ts` (134, 159, 429),
  `src/lib/leave/actions.ts` (109, 329), `src/lib/advance/actions.ts` (69, 186),
  `src/lib/employee/profile-actions.ts` (78), `requireCheckInPermission`
  (`require-role.ts:157`).
- LIFF pages: `/liff/check-in`, `/liff/summary`, `/liff/profile`, `/liff/calendar`,
  `/liff/leave` (+ `/[id]`, `/new`), `/liff/advance` (+ `/[id]`, `/new`),
  **`/liff/payslip`** — and the **Route Handler** `/liff/payslip/pdf/route.ts:20`
  (new since the original draft; same pattern — widen the role list, keep the
  `if (!employee) notFound()`).

The `/liff/payslip` page **and** its `pdf` download route are the two gates the
payslip feature (merged to `main` after this spec's first draft) added; both must be
covered so an admin-employee can download their own payslip. Extracting a single
`requireEmployee()` helper so the rule lives in one
place rather than being copy-pasted.

### 3. Combined LIFF home — capability-aware screen

A new LIFF home route (proposed `/liff/home`) renders **capability groups**:

- **Employee group** (teal) — shown when the resolved `User` **has an `Employee`
  record**. Buttons: **ลงเวลา** (check-in/out → `/liff/check-in`), **ขอลา**
  (leave → `/liff/leave`), **เบิกเงิน** (advance → `/liff/advance`).
- **Admin group** (purple) — shown when the resolved `User` has the `liff.admin`
  permission (`canDo(user, 'liff.admin')`). Buttons: **อนุมัติ** (approvals inbox →
  `/liff/admin/inbox`, with a pending-count badge), **ภาพรวม** (admin dashboard →
  `/admin`), **รายงาน** (reports → `/admin/reports`).

Rendering rule:

- Has employee only → employee group only (worker-only).
- Has `liff.admin` only → admin group only (pure admin who opens the LIFF).
- Both → both groups (admin-employee). This is the target case.

The same screen serves everyone; there is no separate "admin-employee" component.
The "ภาพรวม"/"รายงาน" buttons deep-link to the existing admin web pages, which open
in LINE's in-app browser under the same session.

### 4. Routing

The bare-domain router (`src/app/page.tsx`) currently maps tier → home via
`TIER_HOMES` (`Admin`/`Superadmin` → `/admin`, `Staff` → `/liff/check-in`). It
selects only `roleAssignments`, not `employee`.

Because the tier label masks staff (§2), route on the two real booleans instead —
`hasEmployee` (= is a worker; the `Employee` record) and `isAdminCapable` (an
`admin`/`superadmin` assignment). Extend the root-router query to also select
`employee`, then:

- `hasEmployee` **and** `isAdminCapable` → `/liff/home` (combined home —
  admin-employee).
- `hasEmployee` **and not** `isAdminCapable` → `/liff/check-in` (pure worker —
  lands directly on their most common action; unchanged).
- **not** `hasEmployee` **and** `isAdminCapable` → `/admin` (pure admin — unchanged).
- neither → fall through to `/login` (unchanged).

This expresses all three populations without reading the highest-wins tier at all.
Pure-worker landing is intentionally left unchanged (YAGNI). Making `/liff/home` the
universal landing for workers too is a trivial future toggle if desired, but it adds
a tap before check-in, so it is out of scope here.

### 5. Pairing flow — stop rejecting the overlap

`src/lib/auth/link-line-to-admin.ts` (and the worker-side
`link-line-to-employee.ts`) reject binding a LINE account when the `User` already
plays the "other" role. Since one `User` may now legitimately be both, the pairing
logic must permit binding `lineUserId` to a `User` that has both an `Employee`
record and admin role assignments, while still rejecting the genuine collision case
(a LINE account already bound to a **different** `User`). The `lineUserId @unique`
"already bound to a different user" guard stays.

### 6. Onboarding — grant admin *to* an existing employee

The supported path to create an admin-employee is to **start from a real employee
and grant them an admin role** — add an `admin`/`superadmin` `UserRoleAssignment` to
the employee's existing `User`, from the admin UI (the
`src/app/(admin)/admin/employees/[id]/edit/page.tsx` page and/or the
`src/app/(admin)/admin/settings/team/page.tsx` page).

The reverse (taking a bare admin and creating payroll/attendance data for them) is
**out of scope** — it risks fabricating salary/attendance semantics for someone who
may not belong on payroll. If a pure admin needs to become an employee, they are
created as an employee first, then granted admin.

### 7. Migration of existing dual accounts — self-serve merge wizard

**Current state of the legacy population:** today an admin who is also an employee
exists as **two separate `User` rows** (the two-account workaround):

- **`Ua` (admin)** — email login (`authUserId` = email auth user, `email` set), an
  `admin`/`superadmin` role assignment, **no** `Employee` record, possibly a second
  LINE account from `/liff/pair-admin`.
- **`Ue` (employee)** — has the `Employee` record + all its data, a `staff` role,
  and a daily LINE account (`authUserId` and `lineUserId` both = that LINE account).

Expected volume: **1–2 people** (e.g. owner / a manager). Future admin-employees are
created via §6 (grant admin to an employee) and are a single `User` from the
start — they never need a merge. So the merge serves only this small legacy group.

**Decision: a self-serve cross-auth merge wizard** (not a dev-run script). The
wizard lets the admin link their own accounts with no developer involvement.

**Security model — the core requirement.** Merging is account-takeover-adjacent: if
the system matched accounts by name/phone and merged on a click, any admin could
absorb another person's employee account (their salary, payslips, attendance) or
post check-ins as them. So the merge requires proof of control over **both**
identities, split across two authenticated sessions:

- The merge can only be **initiated** from the authenticated admin (email) session.
- The merge can only be **completed** from the authenticated employee (LINE) session.

Neither session alone can do anything. Crucially, **the employee is identified from
the verified LINE `sub`, never selected from a list** — the login is both the proof
and the selector, which eliminates the entire "merged the wrong person" class of
bug.

**Flow:**

1. **Initiate — web, email session (`Ua`).** A dismissible card on the admin
   dashboard (and a profile entry), shown only to a **pure admin** (admin role, no
   `Employee`). On "Link my employee account", the server re-validates `Ua` is a
   pure admin and issues a **single-use merge token** (short TTL, bound to `Ua.id`,
   scope `admin-merge`), rendered as a QR / LINE deep-link. Mirrors the existing
   `lineInviteToken` pattern.
2. **Prove ownership — mobile, LINE session (`Ue`).** Admin opens the link in their
   **employee LINE account** → new LIFF page `/liff/merge/[token]` runs LINE OIDC →
   server resolves `Ue` from the verified LINE `sub` (`lineUserId == sub`),
   validates the token, and checks preconditions: token valid/unexpired/unconsumed;
   `Ua` still a pure admin; `Ue` has an `Employee`, is not archived; `Ua != Ue`.
   Shows an explicit confirm screen naming both sides and disclosing that the
   **email/password login will be retired** (LINE-only after merge).
3. **Merge — one transaction.** Copy `Ua`'s admin/superadmin role assignment(s)
   onto `Ue` (dedupe by `roleId`+`branchId`); re-point every attribution column that
   equals `Ua.id` to `Ue.id` — `Attendance.createdById`, `LeaveRequest.reviewedById`,
   `CashAdvance.approvedById`, `OvertimeEntry.reviewedById` and `.createdById`;
   re-point `Notification.userId`; archive `Ua` and null its `email` / `authUserId` /
   `lineUserId` / `lineInviteToken` to free the unique slots; consume the token;
   write an audit-log row of the merge (from → to, who, when).
4. **Done.** Success screen → `/liff/home`, now showing both menus.

**Why keep `Ue` and retire `Ua`:** all heavy data (attendance, leave, advance,
payroll) is FK'd to `Employee.id`, which stays put; LIFF-created records already
have `createdById = Ue.id`. Only the light admin-side references move. After merge,
`Ue.authUserId` is already their LINE auth user, so `requireRole` resolves them on
the **primary** path (the `lineUserId` fallback isn't even needed).

**Idempotency & edge cases:** token expired/consumed or `Ua` already archived →
friendly "already linked" no-op; LINE account opened has no `Employee` → clean
"this LINE account isn't an employee here" error; LINE account belongs to a
different admin / already merged → rejected; superadmin merges identically.
Dismissing the card persists (`User.mergePromptDismissedAt`) so it stops nagging.

**Ordering constraint (hard):** the §2 access-gate fix MUST ship in the same release
or earlier. The moment a merge adds an admin role to `Ue`, `computeTier` flips them
to `Admin`; under the old `requireRole(['Staff'])` gate that would break their
check-in. Gate fix → wizard available → merge.

**Schema:** small **additive** migration on `User` — `mergeToken`,
`mergeTokenExpiresAt`, `mergePromptDismissedAt`. Additive columns, low risk; mirrors
`lineInviteToken`/`lineInviteExpiresAt`.

## Out of scope (YAGNI)

- Any two-`User` model that *persists* the split (the merge collapses it to one).
- Per-mode preference memory / "remember my last choice" switching.
- Reverse onboarding (bare admin → create employee).
- A bulk/admin-operated merge tool — the self-serve wizard is per-person and
  user-driven; with 1–2 people there is no batch need.
- Making `/liff/home` the universal landing for workers.
- Any change to how pure-admins or pure-employees work today.

## Data & calculation safety (verified pre-implementation)

This feature changes **who can reach which screens** and **where people land** — not
any stored values or computations. Verified against the calc/data code:

- **Calculations don't read auth role/tier.** Payroll selects employees by
  `Employee.status` only (`src/lib/payroll/run.ts` ~line 67:
  `where: { status: { not: 'Archived' } }`); reports filter by `employeeWhere()`
  (branch/department/status — all `Employee`-scoped, `src/lib/reports/queries.ts`);
  late/advance/leave math reads `Employee` fields + payroll config. None branch on
  role/tier. (The `tier1` in `src/lib/payroll/calc.ts` is the late-penalty 3-strike
  tier, unrelated to auth.)
- **Attribution columns are write-only for calc.** `createdById` / `reviewedById` /
  `approvedById` are never read by any calculation (only set, and read for display).
  The merge re-points them to the surviving `User`, so display attribution stays
  correct and no computed value moves.
- **Merge is value-preserving.** All money/count logic is keyed off the `Employee`
  table, and an admin-employee has exactly **one** `Employee` row before and after
  the merge (it was always on `Ue`; `Ua` never had one). Headcount and every total
  are identical across the migration — no double-count, no drop. The merge moves
  only pointers (role assignment, attribution, notifications), never values.
- **Schema migration is additive + nullable.** The new `User` columns
  (`mergeToken`, `mergeTokenExpiresAt`, `mergePromptDismissedAt`) add no rows and
  alter no existing data.
- **Intended forward behavior (not a data change):** once gated on the `Employee`
  record, admin-employees can create *their own* attendance/leave/advance going
  forward — new capability, not a retroactive edit to existing records.

## Affected files (for the implementation plan)

- `src/lib/auth/require-role.ts` — widen `requireCheckInPermission` / Staff gates;
  consider a shared `requireEmployee()` helper.
- All employee-facing LIFF route guards under `src/app/(liff)/liff/*` (pages **and**
  the `src/app/(liff)/liff/payslip/pdf/route.ts` Route Handler) plus the lib gates in
  `attendance/check-in.ts`, `leave/actions.ts`, `advance/actions.ts`,
  `employee/profile-actions.ts` — full list in §2.
- `src/app/page.tsx` — root-router: detect admin-employee, route to `/liff/home`.
- `src/app/(liff)/liff/home/` — **new** combined home screen (capability-aware).
- `src/lib/auth/link-line-to-admin.ts`, `src/lib/auth/link-line-to-employee.ts` —
  permit the legitimate both-roles binding; keep the cross-user collision guard.
- `src/app/(admin)/admin/employees/[id]/edit/page.tsx` and/or
  `src/app/(admin)/admin/settings/team/page.tsx` — grant-admin-to-employee UI.
- i18n message catalogs — labels for the combined home groups/buttons **and the
  merge wizard** (per the existing 6-locale setup).

Merge wizard (§7):

- `prisma/schema.prisma` + migration — additive `User` columns (`mergeToken`,
  `mergeTokenExpiresAt`, `mergePromptDismissedAt`).
- `src/lib/auth/start-admin-merge.ts` — **new** initiate action (validate pure
  admin, issue single-use token).
- `src/app/(liff)/liff/merge/[token]/page.tsx` — **new** LINE confirm page
  (LINE OIDC, resolve `Ue` from `sub`, preconditions, confirm screen).
- `src/lib/auth/merge-admin-into-employee.ts` — **new** merge executor (the
  transaction; reusable + unit-tested).
- `src/app/(admin)/admin/page.tsx` + `.../admin/profile/page.tsx` — dismissible
  "link your employee account" entry point (pure admins only).

## Testing

- **Unit:** `computeTier` already covered; add coverage for the new
  "has-employee" gate helper (admin-employee passes; pure admin without employee
  fails; a worker passes). Merge executor: preconditions reject (not-pure-admin,
  no-employee, same-user), attribution columns re-pointed, idempotent re-run no-ops.
- **Integration:** an admin-employee `User` (employee + admin assignment) can hit
  the check-in / leave / advance server actions; a pure admin still cannot. Merge:
  the two-session happy path (admin-initiated token + employee LINE confirm) merges
  correctly; replay of a consumed token is rejected; a LINE account with no employee
  is rejected.
- **e2e (developer-facing):** the combined `/liff/home` renders both groups for an
  admin-employee, employee-only for a worker, admin-only for a pure admin. The
  merge wizard click-through from the admin card to the LINE confirm.
