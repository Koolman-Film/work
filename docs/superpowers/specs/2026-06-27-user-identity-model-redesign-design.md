# User identity model redesign — logins as a child table

**Date:** 2026-06-27
**Status:** Design — pending spec review → implementation plan
**Related:** `2026-06-26-seamless-line-account-linking-design.md` (the tactical fix this supersedes long-term), `2026-06-24-admin-employee-unified-identity-design.md`, the post-finnix merge hardening.

## Problem / goal

A single human can log in two ways — by email/password (admin) and via LINE
(employee) — but the `User` row stores login methods as **single-valued unique
columns** (`authUserId`, `lineUserId`). One human with both logins therefore
cannot be one `User` row, so the system creates **two rows** and reconciles them
with a "merge" that copies roles and relocates the `lineUserId` column. That
mechanism works (see the seamless-line-linking feature, shipped behind
`ADMIN_LINE_LINK_ENABLED`) but it is a workaround for a modeling flaw, not a
model. It produces copy-and-diverge role state, a split-brain identity, a
`lineUserId` relocation rule, and a `lineUserId` resolution fallback.

**Goal:** make login methods a one-to-many child table so one `User` (the
person) can hold many logins. This removes the relocation and fallback hacks,
turns "merge" into a true merge, and makes admin/employee linking trivial in any
order — without renaming or restructuring anything else.

## Root cause

`Employee` and `RoleAssignment` are *already* separate tables. The only thing
conflated into the `User` row is **login methods**: `authUserId` and
`lineUserId` are `@unique` single-valued columns
(`prisma/schema.prisma:136,138`). Session resolution
(`src/lib/auth/require-role.ts:87-105`) reads `authUserId` first, then falls back
to matching the `custom:line` sub against `lineUserId`. The fallback exists
precisely because one row cannot cleanly hold two logins.

## Scope

**In scope:** a `UserIdentity(userId, provider, subject)` child table; uniform
session resolution through it; a phased, reversible migration of login-method
storage; a true-merge rewrite that deletes the relocation/fallback/copy hacks.

**Out of scope (explicit non-goals):**
- Renaming `User` → `Person` or any other table reorganization. `User` already
  is the person / attribution target / role + employee owner; only its login
  storage changes.
- Auto-collapsing historical duplicate `User` rows. The (now-clean) true-merge
  unifies them on demand; new users created as one `User` never split.
- Changing `Employee`, `RoleAssignment`, attribution FKs, or the auth provider
  (Supabase `custom:line` OIDC).

## The model

One new table; `User` is structurally unchanged.

```prisma
model UserIdentity {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid
  user      User     @relation(fields: [userId], references: [id])
  provider  String   // 'email' | 'line'
  subject   String   // provider's stable subject (see below)
  createdAt DateTime @default(now())

  @@unique([provider, subject]) // one login = one identity, globally
  @@index([userId])
}
```

- **`email` identity** → `subject` = the Supabase `auth.users.id` (today's
  `User.authUserId` when `email` is set).
- **`line` identity** → `subject` = the LINE `sub` (today's `User.lineUserId`).

A `User` may have many `UserIdentity` rows. The admin-who-is-also-an-employee
becomes **one** `User` with an `email` identity and a `line` identity — no second
row, no copied roles, no relocated column.

### Why key `line` on the sub, not the Supabase line-auth UUID

Today a self-paired admin's LINE login is stored **only** as `User.lineUserId`
(the sub); the Supabase line-auth UUID is never written to the row. Keying the
`line` identity on the sub is therefore the only choice that backfills every
existing LINE login from data already on the row — no Supabase admin-API
archaeology.

## Resolution (the linchpin)

`requireRole` (and the other session→`User` resolvers) stop reading two columns +
a fallback and do one uniform lookup. For each identity on the Supabase session
(`authUser.identities`):

- `custom:line` → look up `UserIdentity(provider:'line', subject: <LINE sub>)`
- email/password → look up `UserIdentity(provider:'email', subject: authUser.id)`

First hit → `userId` → load the `User`. The `lineUserId` fallback
(`require-role.ts:97-105`) disappears: LINE is no longer a special second
column, just an identity row.

**Resolvers to migrate (Phase 2):** `src/lib/auth/require-role.ts` (primary),
`src/app/page.tsx`, `src/lib/i18n/liff-locale.ts`, `src/lib/i18n/actions.ts`, and
any other site doing `findUnique({ where: { authUserId } })` /
`{ where: { lineUserId } }` for session resolution (the audit found ~8). The
`requireRole` result keeps exposing `authUserId: authUser.id` (the **session**
id), so storage-path security checks that compare against the session id are
unaffected — they never needed the `User` column.

## Strangler phases (each independently reversible)

**Phase 1 — Add + backfill + dual-write.**
Migration creates `UserIdentity`. A backfill populates it from existing columns
(rules below). Every flow that writes `authUserId`/`lineUserId` —
`link-line-to-employee.ts`, `link-line-to-admin.ts`, admin/email user creation,
seeding, and the current merge — *also* writes the matching `UserIdentity` row
(dual-write). Columns remain authoritative; no readers change.
*Reversible: drop the table + revert dual-write.*

**Phase 2 — Resolution cutover.**
The session→`User` resolvers read `UserIdentity`, keeping the old columns as a
fallback **this phase only** (belt-and-suspenders). Bake in production.
*Reversible: flip resolvers back to columns.*

**Phase 3 — Drop the fallback.**
Pairing flows write `UserIdentity` only; remove the column fallback in
resolution; confirm storage-path checks use the session `authUser.id`.
*Reversible: re-add the fallback.*

**Phase 4 — Realize + clean up (point of no return).**
Rewrite merge into true-merge (below); delete the `lineUserId` relocation rule
(`merge-admin-into-employee.ts`) and the resolution fallback; drop the
`authUserId` / `lineUserId` columns. Gated on the parity test + a bake period.

## Backfill (Phase 1)

Per existing `User`, additive and idempotent (never mutates `User` columns):

- `email` set → `UserIdentity('email', subject = authUserId)`.
- `lineUserId` set → `UserIdentity('line', subject = lineUserId)`.
- A self-paired admin (`email` + `lineUserId`) yields **both** rows → natively
  one `User`, two logins.
- A combined post-merge employee row (`authUserId` = line-auth, `lineUserId` =
  sub, no `email`) yields **one** `line` identity from `lineUserId`; its
  `authUserId` is the same login and is not separately backfilled.
- Edge rows (`authUserId` set, no `email`, no `lineUserId`) are **reported for
  manual review**, never guessed.

Re-running the backfill is a no-op (guarded by the `@@unique([provider,
subject])`).

## True-merge (Phase 4)

`mergeUsers({ survivorId, mergedId })` — replaces `mergeAdminIntoEmployee`:

- Re-parent `mergedId`'s `UserIdentity` rows to `survivorId` (a plain `update` —
  no unique-column collision; this is the payoff of the 1:N model).
- Move the `Employee` record if the survivor has none; move role assignments
  (dedupe).
- **Archive** the husk: strip its identities and roles so it can neither log in
  nor act, but **keep the row** so historical attribution FKs (e.g.
  `Attendance.createdById`, audit `actorId`) stay valid. No FK re-pointing, no
  hard delete — non-destructive.
- Audit (`user.account-merge`) with the moved identities, employee, and roles.

For the admin+employee case the **employee row survives** (it holds the
`Employee` record); the pure-admin row is the archived husk, its `email` identity
re-parented onto the survivor so the human keeps both logins on one row.

## Testing

- **Parity test (the safety net, gates Phase 4):** over representative data,
  every session shape that resolves under the *old* column path resolves to the
  *same* `User` under the new `UserIdentity` path.
- **Backfill:** each `User` shape (admin, employee, self-paired admin, combined,
  edge) → the correct `UserIdentity` rows; idempotent on re-run; edge rows
  reported.
- **Resolution:** each provider/session shape resolves to the right `User` via
  `UserIdentity`; during Phase 2, a missing identity row falls back to the
  column.
- **Dual-write:** each pairing/creation flow writes the `UserIdentity` row
  alongside the column.
- **True-merge:** both logins reach the survivor afterward; the husk is archived
  with no identities/roles; historical attribution rows still resolve; idempotent
  re-run; audited.

## Risk & rollback

- Columns stay authoritative through Phase 2; dual-write means any resolver bug
  falls back to the column path safely.
- Phases 1–3 are each reversible. Phase 4 is the only irreversible step (columns
  dropped) and is explicitly gated on the parity test and a production bake.
- No flag-day on identity — the subsystem the finnix incident proved most
  dangerous is migrated incrementally, validated at each step.

## Relationship to the shipped tactical fix

The seamless-line-linking feature (token carries the employee, `lineUserId`
relocation, one-side consent) stays as-is and keeps working through Phases 1–3.
Phase 4 deletes its relocation rule and the fallback, and folds its
order-independence into the model itself: with 1:N logins, adding a LINE identity
to an existing `User` never collides, so the relocation it works around no longer
exists.
