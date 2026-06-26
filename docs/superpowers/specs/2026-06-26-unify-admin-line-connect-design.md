# Admin–employee LINE identity: bind, sync, and capability menus

**Date:** 2026-06-26
**Status:** Design — pending spec review → implementation plan
**Related:** [`2026-06-24-admin-employee-unified-identity-design.md`](2026-06-24-admin-employee-unified-identity-design.md), [`2026-06-11-admin-line-experience-design.md`](2026-06-11-admin-line-experience-design.md)

## Problem

LINE identity for admins and employees grew piecemeal, and the surfaces don't
compose smoothly:

- **Four overlapping surfaces** set or use `User.lineUserId`: admin self-pairing
  (`/admin/settings/line`), admin-managed employee pairing
  (`/admin/employees/[id]/edit`), employee self-pairing (`/liff/pair`), and the
  account merge (`startAdminMerge` → `/liff/merge`).
- **Binding collisions dead-end.** `lineUserId` is `@unique`
  (`prisma/schema.prisma:138`). If an admin tries to bind a LINE already held by
  their employee account, they get `line-account-in-use` — a wall, not a path to
  the obviously-intended outcome (unify the two accounts).
- **Sync is one-directional.** Only admin→employee merge exists; an employee
  can't initiate linking to their admin account.
- **No "both" rich menu.** Only an admin menu exists (`ADMIN_RICH_MENU_ID`,
  per-user linked); employees get the OA default menu. A person who is *both*
  (after merge) gets the admin menu only and silently loses their employee
  buttons.

The admin population is **mixed**: some pure admins (owner/office, no Employee
record), some are also employees (legacy dual accounts).

## Goals

Every surface works smoothly, around two clean, decoupled capabilities plus a
capability-driven rich menu:

1. **Bind a LINE** to an account — a fresh LINE pairs to an admin *or* an
   employee. Binding never surprises the user by merging.
2. **Sync two accounts** — an admin account and an employee account (same person)
   link into one identity. Deliberate, explicit, and **initiatable from either
   side**.
3. **Rich menu follows capabilities** — three states: employee-only, admin-only,
   admin+employee.
4. A binding **collision becomes a doorway to sync**, never a dead-end.

## Non-goals

- No "un-merge"/reversal (merge stays one-way by design; value-preserving).
- No change to employee-side feature gating (`requireEmployee`) or `/liff/home`
  capability groups.
- Rich-menu *images/content* are an ops asset, not produced by this code change
  (see Dependencies).

## Confirmed decisions

1. **Bind and sync are decoupled** — not one auto-detecting scan. This removes the
   ordering edge cases of conflating them.
2. **Sync = merge into one identity** — one User carrying both the Employee record
   and the admin role; the redundant login is archived. (Consistent with the
   shipped unified-identity architecture; reuses `mergeAdminIntoEmployee`.)
3. **Sync is bidirectional** — generatable from the admin profile *and* the
   employee LIFF profile; redeemed in the counterpart account's session.
4. **Confirm-first on sync**, and the confirm screen shows **both identities**
   (admin email + employee name) so a mis-scanned bearer token is caught.
5. **Rich menu = pure function of capabilities**; employee-only uses the OA
   default (no per-user link), so only **one new menu object** (Combined) is built.

## Capability 1 — Bind a LINE to an account

A fresh (unbound) LINE binds to exactly one account. Unchanged mechanics, made
consistent:

| Surface | Target | Flow |
|---|---|---|
| `/admin/settings/line` | the admin's own User | mint admin-pair token → `/liff/pair-admin/[token]` → `linkLineToAdmin` |
| `/admin/employees/[id]/edit` pairing card | an employee's User | mint pairing token → `/liff/pair/[token]` → `linkLineToEmployee` |
| `/liff/pair` (employee self) | the employee's User | same redeem |

**Change:** after a successful bind, call `applyRichMenuForUser` (capability
resolver, below) instead of the hardcoded `linkAdminRichMenu`.

**Collision → doorway (the key smoothness fix).** When a bind targets a LINE
already bound to a *different* User, do not dead-end. Instead:

- Surface: *"This LINE is already linked to [account label]. If that's you, sync
  your accounts."* with a button into **Capability 2**.
- The sync's confirm-both-identities screen is the authorization check (the system
  can't prove two accounts are the same person; the human confirms).

## Capability 2 — Sync two accounts into one identity

One **account-sync token**, generatable from either account, redeemed in the
counterpart account's authenticated session. The merge result is invariant
regardless of who initiates: keep the **employee** User (it holds the Employee
record), copy the admin role onto it, archive the **admin** User — i.e.
`mergeAdminIntoEmployee`, reused unchanged.

**Token:** reuse the existing `mergeToken` / `mergeTokenExpiresAt` columns
(repurposed as the generic account-sync token; rename is cosmetic and optional).
`sub` = the initiator's User.id; single-use; short expiry.

**Initiation surfaces:**
- Admin side: `/admin/profile` — "link my employee account" → QR. (This repurposes
  the profile card added in `bb080bf`; it now has a first-class home.)
- Employee side: `/liff/profile` (or `/liff/home`) — "link my admin account" → QR.

**Redeem surfaces (the counterpart session opens the QR):**
- Redeemed in a **LINE** session (LIFF) when the counterpart is the employee.
- Redeemed in a **web/email** session when the counterpart is the admin.
- Both first run the **confirm-both-identities** screen, then execute.

**Classification at redeem:** given the two Users (token initiator + redeemer
session), one must be a pure admin (admin role, no Employee record) and the other
an employee (has Employee record). Merge admin→employee. If both are employees or
both pure admins → cannot-sync error. Existing executor guards (`same-user`,
`admin-not-pure`, `employee-no-record`) remain the backstop.

**Post-sync:** call `applyRichMenuForUser` on the surviving User's `lineUserId`
(now admin+employee → Combined menu).

## Capability-driven rich menu

`applyRichMenuForUser(lineUserId, { hasEmployee, hasAdmin })` — the single source
of truth for which menu a user sees:

| Capabilities | Action |
|---|---|
| admin **+** employee | link `COMBINED_RICH_MENU_ID` |
| admin only | link `ADMIN_RICH_MENU_ID` (exists) |
| employee only | **unlink** per-user → OA default (employee) menu shows |
| neither | unlink |

**Call sites:** after binding a LINE (admin or employee), after sync/merge, after
granting/revoking admin role, after archiving an employee. Replaces direct
`linkAdminRichMenu` / `unlinkAdminRichMenu` calls.

This delivers the three menu types **and** fixes the current gap where a merged
admin-employee gets the admin-only menu.

## Surface map (every surface, after)

| Surface | Capability | Behavior |
|---|---|---|
| `settings/line` | Bind (admin) | bind own LINE; collision → offer sync |
| employee pairing card / `/liff/pair` | Bind (employee) | bind employee LINE; collision → offer sync |
| `/admin/profile` | Sync (admin-initiated) | QR → employee redeems → merge |
| `/liff/profile` | Sync (employee-initiated) | QR → admin redeems → merge |
| dashboard nudge | discovery | lightweight link → `settings/line` (gated on `lineUserId == null`, dismissible) |
| any rich menu | — | resolved by `applyRichMenuForUser` |

## Retire / change

- **Drop the "auto-detect bind-vs-merge at scan" idea** (former Approach A) —
  superseded by the two-capability model.
- **`startAdminMerge`** generalizes into the bidirectional account-sync
  initiation (admin side); add the employee-side initiator.
- **`/liff/merge/[token]` auto-running merge** becomes the confirm-first sync
  redeem (LINE-session variant); add the web-session variant.
- **`linkMergeAccounts` / `mergeAdminIntoEmployee`** — kept, reused.
- **`mergeToken` columns** — kept, repurposed (no column drop).
- **Hardcoded `linkAdminRichMenu`** call sites — replaced by `applyRichMenuForUser`.

## Edge cases

- Bind collision where the LINE is on the person's own other account → offer sync
  (not an error).
- Bind collision where the LINE genuinely belongs to someone else → real error;
  the confirm-both-identities screen in sync prevents accidental cross-person merge.
- Admin already LINE-bound, then syncs via employee LINE → executor nulls the
  archived admin's `lineUserId`; no unique clash.
- Both-pure-admin or both-employee redeem → cannot-sync error.
- Token expiry / single-use / not-authorized unchanged.

## Dependencies (ops)

- **Combined rich menu asset:** a designed menu image + `scripts/setup-combined-rich-menu.ts`
  (mirrors `setup-admin-rich-menu.ts`) + `COMBINED_RICH_MENU_ID` env var on Vercel.
  Code ships independently; the menu appears once the asset is created and script run.

## Testing

- **Unit:** `applyRichMenuForUser` capability→menu table; sync classification
  (admin+employee→merge, both-same→error); collision detection returns
  offer-sync vs hard-error.
- **Integration:** bind (admin/employee) sets `lineUserId` + applies correct menu;
  sync from each direction executes a value-preserving merge (reuse existing
  executor assertions) and applies the Combined menu; collision routes to sync.
- Existing `mergeAdminIntoEmployee` tests carry over unchanged.

## Suggested phasing (for the implementation plan)

1. **Rich-menu resolver** — `applyRichMenuForUser` + Combined-menu wiring +
   swap call sites. Self-contained; fixes the merged-person gap immediately.
2. **Bidirectional sync** — generalize the token/initiation to either side; add
   the web-session redeem; confirm-both-identities screen.
3. **Collision → doorway** — bind surfaces offer sync instead of dead-ending;
   entry-point/nudge cleanup.

## Rollout

Code + one rich-menu setup script + one env var. No destructive migration
(`mergeToken` columns reused). Deploys to production via push to `main`.
