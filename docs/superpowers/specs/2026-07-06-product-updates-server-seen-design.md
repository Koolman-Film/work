# Per-user server-backed "seen" set for product updates

**Date:** 2026-07-06
**Status:** Approved (design)
**Area:** admin web · product-updates

## Problem

The admin welcome **tour re-appears after login**. Root cause: whether the
first-run tour (and the announcement modal, and the "What's New" unread badge)
shows is decided entirely from a **per-browser `localStorage`** set
(`koolman.productUpdates.seen.v1`, see `src/lib/product-updates/seen.ts`).

- The gate in `src/components/admin/product-updates/product-updates.tsx` auto-starts
  the `welcome` tour unless the marker `first-run.welcome` is in that set.
- Login/logout are cookie-based server actions; `signOut({ scope: 'local' })`
  clears only Supabase auth keys, never this key. So on a single stable browser
  it fires once — but the "seen" memory does **not** follow the user across
  devices, incognito sessions, or storage-clearing webviews. Each fresh browser
  context = empty set = tour fires again.

`seen.ts` itself notes: *"cross-device consistency is intentionally out of scope."*
This spec brings it into scope.

## Goal

The product-updates "seen" state — welcome tour, announcement modal, and
what's-new unread badge — becomes **once per user, on any device**, backed by
the database instead of the browser.

## Decisions (locked)

1. **Scope:** move the *entire* `seen` set server-side, not just the tour marker.
   The three surfaces are one mechanism; splitting one key across two storage
   layers would be incoherent.
2. **Migration:** **server-only, accept one re-show.** Drop `localStorage`
   entirely. Existing admins start with a `NULL` column, so they see the welcome
   tour + modal exactly once more after deploy, then it is saved forever. There
   are only a handful of admins, so a single one-time re-show is acceptable and
   keeps the design minimal (no dual-source union / migration step).

## Design

### 1. Data model

Add one nullable column to `User` (mirrors the existing `mergePromptDismissedAt`
per-user-UI-state precedent; `Json?` matches how the schema already stores
flexible per-row data such as `nameByLocale`):

```prisma
/// Product-updates "seen" ids (welcome tour, announcements, what's-new items),
/// per-user across devices. Replaces the old per-browser localStorage set.
/// Array of stable UpdateItem ids + the 'first-run.welcome' marker.
/// NULL ⇒ empty set.
productUpdatesSeen  Json?
```

- Stored shape is a `string[]` — **identical** to today's `localStorage`
  payload — so all set logic in `selectors.ts` (`unseenItems`, `nextAnnounce`,
  `unseenCount`) is unchanged.
- One Prisma migration adds the column. No backfill.

### 2. Read path (server → client, no flash)

`AdminLayout` (`src/app/(admin)/layout.tsx`) is already a server component that
resolves the current user via `requireAdminArea()`. The underlying
`requireRole`/`resolveAuthedUser` fetch uses `include: AUTHED_INCLUDE` (not a
narrow `select`), so **all scalar columns — including `productUpdatesSeen` — are
already present** on the returned `User`. No change to the auth layer.

The layout passes the value down as a prop:

```
AdminLayout (server)  →  <ProductUpdates initialSeen={parseSeen(user.productUpdatesSeen)} />
```

The zustand store's `hydrate()` changes signature to `hydrate(initialSeen: string[])`
and seeds `seen` from the **server prop** instead of reading `localStorage`.
Because the value arrives with the server render, there is no async fetch and no
flash: the first-run gate in `product-updates.tsx` evaluates against real data on
the very first client render. The sidebar badge and announcement modal read the
same store, so they are fixed for free.

### 3. Write path (client → server, add-only union)

New server action, modeled directly on `dismissMergePrompt`
(`src/lib/auth/start-admin-merge.ts:112`):

```ts
// src/lib/product-updates/actions.ts
'use server';
export async function markProductUpdatesSeen(ids: string[]): Promise<void> {
  const { user } = await requireAdminArea();            // current user from session
  const current = parseSeen(user.productUpdatesSeen);
  const next = [...new Set([...current, ...ids])];      // union, add-only
  if (next.length === current.length) return;           // nothing new → skip write
  await prisma.user.update({
    where: { id: user.id },
    data: { productUpdatesSeen: next },
  });
}
```

The store's `markSeen` / `markManySeen`:
1. update local `seen` state **optimistically** (instant UX — unchanged from
   today), then
2. fire `markProductUpdatesSeen([...ids])` (not awaited; errors are logged and
   swallowed, matching the current silent-degrade posture of `persistSeen`).

**Add-only union** makes the write idempotent and safe across concurrent tabs —
nothing is ever removed, so the worst case of a race is a harmless re-show, never
a lost dismissal. No transaction or row lock is required because the operation is
a monotonic set-grow.

### 4. `parseSeen` helper

A single pure helper tolerantly reads the JSON column (replaces `readSeen`'s
tolerance, but for the DB value rather than `localStorage`):

```ts
export function parseSeen(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}
```

Used both server-side (in the action) and to compute the layout prop.

## Files touched

| File | Change |
|------|--------|
| `prisma/schema.prisma` (+ migration) | add `productUpdatesSeen Json?` to `User` |
| `src/lib/product-updates/actions.ts` | **new** — `markProductUpdatesSeen` server action |
| `src/lib/product-updates/seen-json.ts` | **new** — `parseSeen` pure helper (server + client safe) |
| `src/lib/product-updates/seen.ts` | **delete** — localStorage read/write retired |
| `src/lib/product-updates/store.ts` | `hydrate(initialSeen)`; `markSeen`/`markManySeen` call the action; drop `seen.ts` import |
| `src/components/admin/product-updates/product-updates.tsx` | accept `initialSeen` prop; `hydrate(initialSeen)` |
| `src/app/(admin)/layout.tsx` | pass `initialSeen={parseSeen(user.productUpdatesSeen)}` |

No change to `selectors.ts`, `announcement-modal.tsx`, `whats-new-panel.tsx`,
`run-tour.ts`, `tours.ts`, `registry.ts`, or the auth layer.

## Error handling

- **Server write fails:** local optimistic state keeps the current session
  consistent; on a later login the server won't have the id, so at most the
  surface re-shows once. Acceptable (same tolerance as the accepted one-time
  migration re-show). Logged, not surfaced to the user.
- **Malformed / null column:** `parseSeen` returns `[]` — never throws.
- **Called outside an admin session:** `requireAdminArea()` inside the action
  gates it (`notFound()`); the action is only wired into the admin-only mount.

## Testing

- `parseSeen` (pure): null → `[]`; valid `string[]` passthrough; malformed
  (non-array, mixed types) → filtered/empty; never throws.
- `markProductUpdatesSeen`: unions add-only into an existing value; skips the
  write when nothing is new; requires admin auth (mock `requireAdminArea` +
  `prisma.user.update`).
- `store.hydrate(initialSeen)`: seeds `seen` from the prop; `markSeen` updates
  local state optimistically **and** invokes the action (mocked).
- Existing `selectors.test.ts` continues to pass unchanged (set shape identical).

## Out of scope / YAGNI

- No localStorage fallback, offline queue, or client→server migration union
  (per the locked "server-only, accept one re-show" decision).
- No per-device or cross-device diffing beyond the single shared set.
- No change to what content exists (`registry.ts` / `tours.ts`).
```
