# Unify admin LINE connect: one smart "pair-or-merge" flow

**Date:** 2026-06-26
**Status:** Design approved — pending spec review → implementation plan
**Related:** [`2026-06-24-admin-employee-unified-identity-design.md`](2026-06-24-admin-employee-unified-identity-design.md), [`2026-06-11-admin-line-experience-design.md`](2026-06-11-admin-line-experience-design.md)

## Problem

There are two separate admin-facing ways to connect a LINE account, and they look
near-identical (both show a QR an admin mints from their phone):

1. **LINE pairing** — `/admin/settings/line` → `link-line-to-admin.ts`. Binds
   `User.lineUserId` onto a single admin User (gives the admin rich menu in the OA
   chat, LINE notifications, an admin LIFF session).
2. **Account merge** — dashboard nudge + profile card → `start-admin-merge.ts` →
   `/liff/merge/[token]` → `merge-admin-into-employee.ts`. Collapses a legacy
   dual account (a pure admin User + a separate employee User who are the same
   human) into one User.

They are confusing because they overlap in appearance but diverge in outcome, and
the split is forced only by an implementation detail: `lineUserId` is `@unique`
(`prisma/schema.prisma:138`), so when an admin scans with a LINE that already
belongs to an employee, pairing **errors** (`line-account-in-use`) instead of
doing the obviously-right thing (merge).

The admin population is **mixed**: some admins are "pure" (owner/office staff who
never clock in and have no Employee record), some are also employees (legacy dual
accounts). A single entry point should detect which case applies and do the right
thing.

## Goals

- One admin-facing "connect LINE" flow that **auto-detects** bind-vs-merge from
  what the scanned LINE already is.
- The irreversible merge branch is **confirmed first** (today's merge has no
  explicit confirm — it auto-runs on opening the link).
- Single home at `/admin/settings/line`, with a lightweight dashboard nudge that
  links there. Retire the now-redundant profile merge card.
- No change to data-safety guarantees: merge stays atomic and value-preserving
  (never edits Employee/attendance/leave/advance VALUES).

## Non-goals

- No change to the employee-side LINE pairing (`/liff/pair`, `link-line-to-employee.ts`).
- No change to the merge executor's semantics (`merge-admin-into-employee.ts`) —
  it is reused as-is.
- No "un-merge"/reversal feature (merge remains one-way by design).

## Key decisions (from brainstorming)

1. **Mixed population → one smart button** that branches at redeem time.
2. **Merge branch → confirm screen first**, reusing/extending the merge UI.
3. **Entry points → `settings/line` is the one home**; keep a lightweight
   dashboard nudge linking there; remove the profile merge card.

## The insight

Both existing flows are already the same shape: an admin mints a token
(`sub = admin User.id`) and someone opens it in a LINE session. The only real
difference is what redeem does with the scanning LINE:

| Scanning LINE is… | Pairing today | Merge today | Unified |
|---|---|---|---|
| Not bound to anyone | bind → admin User | — | **bind** |
| Already an employee User | errors (`line-account-in-use`) | merge admin → employee | **confirm → merge** |
| Another non-employee user | errors | — | **collision error** |

So "unify" = turn that error into a branch. One token, one QR, one redeem route.

## Design

### 1. Unified redeem (core)

One token — the **existing admin-pair token** (`lineInviteToken`, scope
`admin-pair`). One QR on `settings/line`. The redeem route
`/liff/pair-admin/[token]` resolves the LINE identity, then branches:

```
liffBootstrap() → LINE identity (lineUserId)
  → resolveAdminLineLink({ token, lineUserId })
      ├─ unbound                 → BIND   (set lineUserId on admin User — runs immediately; reversible)
      ├─ existing User w/ Employee → MERGE  (return { employeeName, adminEmail } → confirm → execute)
      └─ existing User, no Employee → COLLISION error (unchanged semantics)
```

- The branch key is exactly today's collision check
  (`link-line-to-admin.ts:130-137`): if the existing user **has an Employee
  record**, it's a merge candidate rather than an error.
- `resolveAdminLineLink` is a new server action that **validates the token**
  (single-use, not expired, target holds an admin-tier role) and **classifies the
  outcome without mutating** — so the client can show a confirm before any merge.
  Both `adminUserId` (token `sub`) and the scanning employee's User (looked up by
  `lineUserId`) are known at this point.
- Resolve returns the classification; the client then dispatches the matching
  **act** call. The act calls re-validate (TOCTOU) before mutating.
- **BIND path:** on a `bind` classification the client immediately calls the
  existing bind action (`linkLineToAdmin`: binds `lineUserId` + audits +
  best-effort rich-menu link) — **no confirm**, because binding is reversible.
- **MERGE path:** on a `merge` classification the client shows a **confirm
  interstitial** (new), then on confirm calls the executor via the existing
  `linkMergeAccounts` → `mergeAdminIntoEmployee`.

### 2. `settings/line` — the one home

`LinePairingCard` keeps mint-token + QR + unpair. Copy updates to set
expectations for both outcomes, e.g.: *"เชื่อมต่อ LINE — ถ้าคุณเป็นพนักงานด้วย
สแกนด้วย LINE ของบัญชีพนักงานเพื่อรวมบัญชี"*. The "unpair / change LINE" control
stays (relevant to the bind case).

### 3. Dashboard nudge (simplified)

`MergePromptCard` becomes a lightweight link card pointing to
`/admin/settings/line` — drop its inline QR / `startAdminMerge`. Re-gated on
**`lineUserId == null`** (admin hasn't connected LINE yet), still dismissible via
`mergePromptDismissedAt`.

### 4. Retire

- **Profile merge card** — revert the recent `profile/page.tsx` +
  `MergePromptCard dismissible` addition. `settings/line` is now the permanent
  always-available home, so the profile re-entry is redundant.
- **`startAdminMerge` / `dismissMergePrompt`** — `startAdminMerge` (separate merge
  token mint) is retired; merge now rides the admin-pair token. `dismissMergePrompt`
  stays (nudge still dismissible).
- **`/liff/merge/[token]` route + `merge-client.tsx`** — folded into the
  pair-admin redeem. `linkMergeAccounts` (executor wrapper) and
  `mergeAdminIntoEmployee` are **kept and reused**.
- **`mergeToken` / `mergeTokenExpiresAt` columns** — become unused → drop in a
  small follow-up migration (safe: unused, additive-then-drop). `mergePromptDismissedAt`
  stays.

### 5. Edge cases (all preserved)

- Admin already LINE-bound, scans an employee LINE → merge; the executor nulls the
  archived admin's `lineUserId`, so no unique-constraint clash.
- Pure admin who will never be an employee → binds, exactly as today.
- Executor guards (`same-user`, `admin-not-pure`, `employee-no-record`) stay.
- Token expiry / single-use / not-admin errors unchanged.
- `?merge` deep-link dispatcher in `/liff/pair/pair-client.tsx` (added in f49c0cc)
  is removed/redirected to the unified pair-admin path.

## Testing

- **Unit:** `resolveAdminLineLink` outcome table — unbound→bind, employee→merge,
  non-employee→collision, expired/invalid/not-admin.
- **Integration:** pair-admin redeem binds when LINE unbound; proposes + (on
  confirm) executes merge when the LINE is an employee; collision errors for a
  non-employee user. Reuse existing value-preserving assertions from the merge
  executor tests.
- Existing `mergeAdminIntoEmployee` integration tests carry over unchanged.

## Rollout

- Code change + one small migration (drop `mergeToken`, `mergeTokenExpiresAt`).
  Additive-then-drop of unused columns is data-safe.
- Deploys to production via push to `main` (auto-deploy), same as prior work.
