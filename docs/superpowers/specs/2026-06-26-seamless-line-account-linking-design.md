# Seamless LINE account linking — order-proof admin/employee merge

**Date:** 2026-06-26
**Status:** Design — pending spec review → implementation plan
**Related:** `2026-06-26-unify-admin-line-connect-design.md`, `2026-06-24-admin-employee-unified-identity-design.md`, rich-menu work (`feat/capability-rich-menu`), the merge-hardening done after the finnix incident.

## Problem / goal

A single human can be an **admin** (logs in by email/password, has admin or
superadmin role, no Employee record) and an **employee** (logs in via LINE, has
an Employee record). These are two separate `User` rows. We want all connection
flows to work **seamlessly in any order** — link as either type first, add the
other later — for admins, employees, and people who are both.

Today they do not. The merge wizard *infers* which row is the employee from
"whoever is currently holding the LINE session," and that inference dead-ends in
exactly the orders where the LINE is not yet on an employee row.

## Root cause

`User.lineUserId` is `@unique`: **one LINE account binds to at most one User
row.** The merge wizard's party resolution
(`resolveMergeParties`, `src/lib/auth/link-merge-accounts.ts`) looks up the
employee by `User.findUnique({ where: { lineUserId: <session sub> } })` and
requires that row to have an Employee record. Whenever the LINE is on the admin
row (a self-paired admin) or not yet bound, this returns `not-employee` and the
merge cannot proceed — and the parallel attempt to *pair* that same LINE to a
second (employee) row fails on the unique constraint
(`link-line-to-employee.ts`, surfaced as `line-account-in-use`).

The one genuinely broken ordering: **a pure admin self-pairs their own LINE
first, then later becomes an employee on a separate row.** Neither pairing nor
the merge wizard can unify them.

## Key enabling fact

`requireRole()` (`src/lib/auth/require-role.ts:97-105`) has a **universal**
`lineUserId` fallback: when the session's `authUserId` lookup misses, it resolves
the verified `custom:line` identity sub against `User.lineUserId`. This is not
admin-only — it fires for any session. Therefore a row only needs
`lineUserId = L` set for a LINE login to resolve to it; `authUserId` need not be
the LINE auth user. **The dead-end is fixable by relocating one column
(`lineUserId`) onto the employee row** — no auth-user surgery, no destructive
repointing.

## Chosen approach — explicit-pairing merge (Approach 1)

Stop inferring identity from where the LINE happens to be. Make the pairing
**explicit** (the admin states which employee they are), and define **one
relocation rule** for the LINE column. This keeps the existing QR wizard and the
non-destructive design; it is not an identity-system rewrite.

(Approaches considered and rejected: *auto-heal on collision* — too implicit,
finnix-adjacent risk; *prevent the bad state by attaching the Employee record to
the existing admin row* — smaller but constrains employee creation and does not
help legacy dual-account admins already in the bad state.)

## The invariant

**Whenever a human is or becomes an employee, their LINE binding
(`User.lineUserId`) lives on the employee row.** That row then carries Employee
record + any copied admin role + the LINE binding, and resolves to the
**combined** experience on LINE. The separate pure-admin row keeps its email
login and roles untouched. A pure admin with no Employee record keeps LINE on
their own row exactly as today.

Everything else in this spec enforces that invariant regardless of link order.

## Design

### 1. Explicit pairing — the token carries the employee

The merge token currently encodes only `adminUserId` (JWT `sub`). It will encode
**both** `adminUserId` and the chosen `employeeUserId`.

- **Web start flow** (`startAdminMerge`, `src/lib/auth/start-admin-merge.ts`):
  the admin, logged into the web panel, **picks the employee record that is
  them** from a searchable employee list. The selected `employeeUserId` is
  carried in the minted token itself (HS256-signed, so it is tamper-evident — no
  separate DB column needed). No step-up re-auth (being logged into the admin
  panel is sufficient; decided during design).
- **Token** (`mintMergeToken`, `src/lib/pairing/token.ts`): add an
  `employeeUserId` claim. `verifyMergeToken` returns `{ adminUserId,
  employeeUserId }`.

Identity is *stated*, never guessed. The QR scan's job shrinks to **consent +
proof of control**.

### 2. Consent semantics

The scan proves the scanner controls **one side** of the stated pair: the
scanning LINE session resolves (via `authUserId` or the `lineUserId` fallback) to
either the `adminUserId` row or the `employeeUserId` row. Since this is a
self-link, controlling either side is sufficient consent — and it works whichever
side the LINE is on, which is exactly why link order stops mattering.

`resolveMergeParties` is rewritten to:
1. Verify the token → `(adminUserId, employeeUserId)`.
2. Read the scanning LINE session sub; find which row (if any) it is bound to.
3. **Authorize:** require that sub to be bound to the admin row OR the employee
   row of the pair (or to be unbound — the fresh-LINE case in §3). Reject
   otherwise (`not-a-party`).
4. Validate: admin row exists, is not archived, holds an active admin/superadmin
   role, and is a **pure** admin (no Employee record); employee row exists and
   has an Employee record. (Re-uses the existing `admin-not-pure` /
   `employee-no-record` guards from `mergeAdminIntoEmployee`.)
5. Single-use + expiry checks unchanged.

The LIFF confirm screen
(`src/app/(liff)/liff/merge/[token]/merge-client.tsx`) still shows both
identities ("admin `email` ↔ employee `name`") before any mutation, so a mis-scan
is caught. `previewMergeAccounts` returns the same shape.

### 3. The relocation rule

When the merge executes (`mergeAdminIntoEmployee`,
`src/lib/auth/merge-admin-into-employee.ts`), it guarantees the LINE ends up on
the employee row. Let `L` be the scanning LINE sub:

| Where `L` currently is | Action |
|---|---|
| On the **employee row** (today's normal case) | Copy admin roles. No move. |
| **Unbound** (fresh LINE) | Bind `L` to the employee row, then copy admin roles. |
| On the **admin row** (self-paired admin — the old dead-end) | **Relocate** `L`: clear `lineUserId` on the admin row, set it on the employee row. Then copy admin roles. Admin keeps email login. |
| On a **different human's row** | Refuse with a distinct `line-conflict` error — a genuine collision, not a self-link. |

Role copying is the existing behavior (admin/superadmin assignments copied onto
the employee row, deduped). The relocation is the only new mutation.

Note: in the relocate case the admin row's `authUserId` stays on the email auth
user (admin self-pair only ever set `lineUserId`), so nothing but the one column
moves; the employee row's LINE login resolves through the universal
`lineUserId` fallback.

### 4. Non-destructive guarantees

Carried over from the post-finnix design. The merge **never**:
- archives, deletes, or disables the admin row;
- clears the admin's `email` or `authUserId` (email login always survives);
- moves or removes role assignments from the admin row (roles are **copied**);
- repoints historical attribution.

The only new mutation is moving one `lineUserId` column off the admin row in the
self-paired case, which is itself reversible (re-pair). Every merge writes an
audit row (`user.account-merge`) recording the copied roles **and** any LINE
relocation (before/after `lineUserId`).

## Scenario matrix (target behavior)

| Order | Path | Result |
|---|---|---|
| Employee only | pair LINE → employee row | unchanged |
| Pure admin only | self-pair LINE → admin row | unchanged |
| Employee first → granted admin (same row, web) | role grant | combined; LINE already on employee row |
| Employee first → separate admin acct → merge | copy roles | combined; LINE on employee row |
| Admin (no LINE) → employee → merge | copy roles | combined; LINE on employee row |
| **Admin self-paired LINE → employee later → merge** | **relocate `L` + copy roles** | combined; LINE moved to employee row *(fixes the dead-end)* |
| Fresh combined setup via wizard | bind `L` + copy roles | combined; LINE bound to employee row |
| LINE belongs to a third party | refuse (`line-conflict`) | no mutation; clear error |

## Components touched

- `src/lib/pairing/token.ts` — `mintMergeToken`/`verifyMergeToken` carry
  `employeeUserId`.
- `src/lib/auth/start-admin-merge.ts` — accept the chosen `employeeUserId`;
  validate the caller is a pure admin and the target has an Employee record
  before minting.
- Web merge-start UI — employee picker (searchable list) on the page that today
  generates the QR (admin dashboard/profile merge card → start flow).
- `src/lib/auth/link-merge-accounts.ts` — `resolveMergeParties` rewritten to the
  explicit-pairing + one-side-consent model; `previewMergeAccounts` /
  `linkMergeAccounts` unchanged in signature.
- `src/lib/auth/merge-admin-into-employee.ts` — add the relocation rule; extend
  the audit payload.
- `src/app/(liff)/liff/merge/[token]/merge-client.tsx` — copy/labels only; flow
  unchanged.
- `messages/*.json` (6 locales) — any new error/label strings
  (`line-conflict`, `not-a-party`, employee-picker copy).

## Dependencies (out of scope to build here; required for the live result)

1. **`ADMIN_LINE_LINK_ENABLED`** (`src/lib/auth/admin-line-feature.ts`) is
   currently `false`, disabling admin self-pair and the merge wizard entirely.
   This design is what makes flipping it back on safe; the flip itself is a
   separate, deliberate step.
2. **Combined rich menu** — the `computeMenuTarget` / `syncRichMenuForUser`
   resolver lives on the unmerged `feat/capability-rich-menu` branch. Without it,
   a merged identity works but shows the employee menu instead of the combined
   one. Required follow-up, not part of this spec.

## Testing

Integration tests, one per scenario-matrix row that involves the merge:

- Employee-first → merge: copies roles; employee row unchanged LINE; admin row
  retains email + roles.
- Admin-no-LINE → employee → merge: copies roles.
- **Admin self-paired LINE → employee → merge: `L` relocates** from admin row to
  employee row; admin row `lineUserId` becomes null; employee row resolves on
  LINE; admin still logs in by email.
- Fresh-LINE via wizard: binds `L` to employee row + copies roles.
- Refuse on third-party LINE: `line-conflict`, no mutation.
- Idempotent replay: dedupe roles, relocation no-ops when already correct.
- Consent: a scanning LINE bound to neither party → `not-a-party`, no mutation.

Each asserts the end state and that an audit row was written.

## Non-goals

- True single-row consolidation (web/email login also showing the person's own
  payslip/leave). Decided against: keeps the lightweight two-row merge, avoids
  repointing logins (the finnix-incident change class). Web/email login shows
  admin tools; personal employee data is reached via LINE.
- Auto-correlating admin and employee by shared email/phone.
- Re-enabling `ADMIN_LINE_LINK_ENABLED` and merging the combined-menu branch
  (tracked as dependencies above).
