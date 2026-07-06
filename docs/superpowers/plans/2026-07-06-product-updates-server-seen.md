# Per-user server-backed product-updates "seen" set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the product-updates "seen" set from per-browser `localStorage` to a per-user `User.productUpdatesSeen` DB column, so the welcome tour, announcement modal, and what's-new badge become once-per-user across every device.

**Architecture:** The admin layout (a server component) already loads the full `User` row; it passes `user.productUpdatesSeen` down to `<ProductUpdates>` as `initialSeen`, which seeds the zustand store synchronously (no flash). Writes go through a new add-only-union `'use server'` action that updates the column. `localStorage` (`seen.ts`) is retired entirely — the server column is the single source of truth.

**Tech Stack:** Next.js App Router (server components + server actions), Prisma 6 (Postgres, `Json?` column), zustand, vitest, biome.

## Global Constraints

- Package manager: **pnpm** (`pnpm@10.0.0`). All commands use `pnpm`.
- Test runner: **vitest** — unit tests run via `pnpm test` (`vitest run`).
- Lint/format: **biome** — `pnpm lint` (`biome check .`).
- Typecheck: `pnpm typecheck` (`next typegen && tsc --noEmit`).
- DB migrations: this repo **hand-authors numbered migration folders** (`NNNN_name/migration.sql`) and applies them with `pnpm db:deploy` (`prisma migrate deploy`). Do **not** run `prisma migrate dev` to apply — use `--create-only` to emit the SQL, rename the folder to the next `NNNN_`, then `db:deploy`. Requires the local Supabase stack running and `.env.local` present (see the Koolman local-stack bring-up runbook).
- Stored "seen" shape is a JSON `string[]` — **identical** to the retired `localStorage` payload — so `selectors.ts` set logic stays unchanged.
- The seen set is **add-only**: ids are never removed. Every write is a union.
- Copy / content (`registry.ts`, `tours.ts`) is out of scope — do not touch it.
- Commit after every task. Pre-commit hooks may be uninstalled in a bare worktree; if `git commit` fails with `lint-staged not found` (not a lint error), re-run with `--no-verify`.

---

### Task 1: Add `productUpdatesSeen` column + migration

**Files:**
- Modify: `prisma/schema.prisma` (the `model User { ... }` block, near `mergePromptDismissedAt`)

**Interfaces:**
- Consumes: nothing.
- Produces: `User.productUpdatesSeen: Prisma.JsonValue | null` — a JSON `string[]` column, present on every `User` row returned by `AUTHED_INCLUDE` fetches (`requireRole` / `resolveAuthedUser` use `include`, not a narrow `select`, so no auth-layer change is needed).

- [ ] **Step 1: Add the column to the `User` model**

In `prisma/schema.prisma`, inside `model User`, add this field immediately after the `localeChosenByEmployeeAt` field (keeping the per-user-UI-state fields grouped):

```prisma
  /// Product-updates "seen" ids (welcome tour, announcements, what's-new items),
  /// per-user across devices. Replaces the old per-browser localStorage set.
  /// Array of stable UpdateItem ids + the 'first-run.welcome' marker.
  /// NULL ⇒ empty set. Add-only — ids are never removed.
  productUpdatesSeen       Json?
```

- [ ] **Step 2: Generate the migration SQL without applying it**

Run: `pnpm db:migrate -- --create-only --name product_updates_seen`
Expected: Prisma writes `prisma/migrations/<timestamp>_product_updates_seen/migration.sql` and does **not** apply it (prints a message about running the migration later). It does not regenerate the client yet.

- [ ] **Step 3: Rename the folder to the repo's `NNNN_` convention**

Run:
```bash
mv prisma/migrations/*_product_updates_seen prisma/migrations/0036_product_updates_seen
```
Expected: the folder is now `prisma/migrations/0036_product_updates_seen/`.

- [ ] **Step 4: Verify the generated SQL**

Read `prisma/migrations/0036_product_updates_seen/migration.sql`.
Expected content (a JSONB column; Prisma maps `Json?` → `JSONB`):

```sql
ALTER TABLE "User" ADD COLUMN "productUpdatesSeen" JSONB;
```

If Prisma emitted anything else (e.g. an unrelated diff because the local DB was behind), stop and reconcile the local DB first — the migration must contain only this `ADD COLUMN`.

- [ ] **Step 5: Apply the migration and regenerate the client**

Run: `pnpm db:deploy && pnpm db:generate`
Expected: `db:deploy` reports `0036_product_updates_seen` applied with no drift; `db:generate` regenerates the Prisma client so `User.productUpdatesSeen` is typed.

- [ ] **Step 6: Verify the column exists in the generated type**

Run: `pnpm typecheck`
Expected: PASS. (Confirms the client picked up the field; later tasks reference `user.productUpdatesSeen`.)

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0036_product_updates_seen
git commit -m "feat(product-updates): add User.productUpdatesSeen column"
```

---

### Task 2: `parseSeen` pure helper

**Files:**
- Create: `src/lib/product-updates/seen-json.ts`
- Test: `src/lib/product-updates/seen-json.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseSeen(value: unknown): string[]` — tolerantly coerces a DB JSON value (or anything) into a `string[]`; never throws. Used server-side by the action (Task 3) and by the admin layout to compute the `initialSeen` prop (Task 5).

- [ ] **Step 1: Write the failing test**

Create `src/lib/product-updates/seen-json.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseSeen } from './seen-json';

describe('parseSeen', () => {
  it('returns [] for null/undefined', () => {
    expect(parseSeen(null)).toEqual([]);
    expect(parseSeen(undefined)).toEqual([]);
  });

  it('passes through a clean string array', () => {
    expect(parseSeen(['a', 'first-run.welcome'])).toEqual(['a', 'first-run.welcome']);
  });

  it('filters out non-string members', () => {
    expect(parseSeen(['a', 1, null, {}, 'b'])).toEqual(['a', 'b']);
  });

  it('returns [] for non-array values', () => {
    expect(parseSeen('a')).toEqual([]);
    expect(parseSeen(42)).toEqual([]);
    expect(parseSeen({ a: 1 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/product-updates/seen-json.test.ts`
Expected: FAIL — `Cannot find module './seen-json'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/product-updates/seen-json.ts`:

```ts
/**
 * Tolerant reader for the `User.productUpdatesSeen` JSON column (a string[]).
 * Server- and client-safe, no I/O. Mirrors the tolerance the retired
 * localStorage reader used to provide, but for the DB value.
 */
export function parseSeen(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/product-updates/seen-json.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/product-updates/seen-json.ts src/lib/product-updates/seen-json.test.ts
git commit -m "feat(product-updates): add parseSeen JSON-column helper"
```

---

### Task 3: `markProductUpdatesSeen` server action

**Files:**
- Create: `src/lib/product-updates/actions.ts`
- Test: `src/lib/product-updates/actions.test.ts`

**Interfaces:**
- Consumes: `parseSeen` (Task 2); `requireAdminArea` from `@/lib/auth/admin-area` (returns `{ user: User, ... }`); `prisma` from `@/lib/db/prisma`.
- Produces: `markProductUpdatesSeen(ids: string[]): Promise<void>` — unions `ids` into the current user's `productUpdatesSeen` (add-only), skipping the DB write when nothing new is added. Called by the store (Task 4).

- [ ] **Step 1: Write the failing test**

Create `src/lib/product-updates/actions.test.ts` (mock the auth gate + prisma at the module boundary, matching `src/lib/translate/actions.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/admin-area', () => ({
  requireAdminArea: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { update: vi.fn() } },
}));

import { requireAdminArea } from '@/lib/auth/admin-area';
import { prisma } from '@/lib/db/prisma';
import { markProductUpdatesSeen } from './actions';

const mockedRequireAdminArea = vi.mocked(requireAdminArea);
// biome-ignore lint/suspicious/noExplicitAny: partial prisma mock surface
const update = prisma.user.update as any;

function stubUser(id: string, seen: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: partial User shape for the gate
  mockedRequireAdminArea.mockResolvedValue({ user: { id, productUpdatesSeen: seen } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('markProductUpdatesSeen', () => {
  it('unions new ids into the existing set (add-only)', async () => {
    stubUser('u1', ['a']);
    await markProductUpdatesSeen(['b', 'a']);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { productUpdatesSeen: ['a', 'b'] },
    });
  });

  it('treats a null column as an empty set', async () => {
    stubUser('u1', null);
    await markProductUpdatesSeen(['first-run.welcome']);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { productUpdatesSeen: ['first-run.welcome'] },
    });
  });

  it('skips the write when nothing new is added', async () => {
    stubUser('u1', ['a', 'b']);
    await markProductUpdatesSeen(['a']);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not write when the auth gate rejects', async () => {
    mockedRequireAdminArea.mockRejectedValue(new Error('not found'));
    await expect(markProductUpdatesSeen(['a'])).rejects.toThrow('not found');
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/product-updates/actions.test.ts`
Expected: FAIL — `Cannot find module './actions'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/product-updates/actions.ts`:

```ts
'use server';

/**
 * Persist product-updates "seen" ids for the current admin user. Add-only
 * union: ids are never removed, so concurrent tabs can't lose a dismissal
 * and the worst-case race is a harmless re-show. No-op when nothing is new.
 */

import { requireAdminArea } from '@/lib/auth/admin-area';
import { prisma } from '@/lib/db/prisma';
import { parseSeen } from './seen-json';

export async function markProductUpdatesSeen(ids: string[]): Promise<void> {
  const { user } = await requireAdminArea();
  const current = parseSeen(user.productUpdatesSeen);
  const next = [...new Set([...current, ...ids])];
  if (next.length === current.length) return; // nothing new → skip the write
  await prisma.user.update({
    where: { id: user.id },
    data: { productUpdatesSeen: next },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/product-updates/actions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/product-updates/actions.ts src/lib/product-updates/actions.test.ts
git commit -m "feat(product-updates): add markProductUpdatesSeen server action"
```

---

### Task 4: Rewire the store to the server; delete `seen.ts`

**Files:**
- Modify: `src/lib/product-updates/store.ts`
- Delete: `src/lib/product-updates/seen.ts`
- Test: `src/lib/product-updates/store.test.ts` (create)

**Interfaces:**
- Consumes: `markProductUpdatesSeen` (Task 3).
- Produces: store hook `useProductUpdates` with a changed `hydrate(initialSeen: string[]): void` signature. `markSeen(id)` / `markManySeen(ids)` update local state optimistically **and** fire the server action (errors logged, not thrown). All other store fields/actions (`panelOpen`, `activeTourId`, `startTour`, etc.) are unchanged. Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `src/lib/product-updates/store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  markProductUpdatesSeen: vi.fn().mockResolvedValue(undefined),
}));

import { markProductUpdatesSeen } from './actions';
import { useProductUpdates } from './store';

const mockedMark = vi.mocked(markProductUpdatesSeen);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset store to initial state between tests.
  useProductUpdates.setState({ seen: new Set(), hydrated: false });
});

describe('useProductUpdates store', () => {
  it('hydrate(initialSeen) seeds the seen set and flips hydrated', () => {
    useProductUpdates.getState().hydrate(['a', 'first-run.welcome']);
    const s = useProductUpdates.getState();
    expect(s.hydrated).toBe(true);
    expect([...s.seen].sort()).toEqual(['a', 'first-run.welcome']);
  });

  it('hydrate is idempotent (second call does not overwrite)', () => {
    const store = useProductUpdates.getState();
    store.hydrate(['a']);
    store.hydrate(['b']);
    expect([...useProductUpdates.getState().seen]).toEqual(['a']);
  });

  it('markSeen adds locally and calls the server action', () => {
    useProductUpdates.getState().markSeen('x');
    expect(useProductUpdates.getState().seen.has('x')).toBe(true);
    expect(mockedMark).toHaveBeenCalledWith(['x']);
  });

  it('markManySeen adds all locally and calls the server action once', () => {
    useProductUpdates.getState().markManySeen(['x', 'y']);
    const seen = useProductUpdates.getState().seen;
    expect(seen.has('x')).toBe(true);
    expect(seen.has('y')).toBe(true);
    expect(mockedMark).toHaveBeenCalledWith(['x', 'y']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/product-updates/store.test.ts`
Expected: FAIL — `hydrate` still expects zero args / reads localStorage, and `markSeen` calls `persistSeen` not the action (assertions on `mockedMark` fail).

- [ ] **Step 3: Rewrite the store**

Replace the entire contents of `src/lib/product-updates/store.ts` with:

```ts
'use client';

/**
 * Client state for product-updates. Sibling client components (sidebar
 * button, topbar menu, orchestrator) share this one hook.
 *
 * `seen` is the per-user set, hydrated once from a server-provided array via
 * hydrate(initialSeen) (called by the orchestrator on mount with the value
 * the admin layout loaded from User.productUpdatesSeen). Writes update local
 * state optimistically and persist through the markProductUpdatesSeen server
 * action; the server column is the source of truth across devices.
 */

import { create } from 'zustand';
import { markProductUpdatesSeen } from './actions';

type ProductUpdatesState = {
  panelOpen: boolean;
  activeTourId: string | null;
  seen: Set<string>;
  hydrated: boolean;
  hydrate: (initialSeen: string[]) => void;
  openPanel: () => void;
  closePanel: () => void;
  startTour: (id: string) => void;
  endTour: () => void;
  markSeen: (id: string) => void;
  markManySeen: (ids: string[]) => void;
};

/** Fire-and-forget persist; degrade silently on failure (at worst a re-show
 *  on a later login), matching the old localStorage silent-degrade posture. */
function persist(ids: string[]): void {
  void markProductUpdatesSeen(ids).catch((err) => {
    console.warn('[product-updates] failed to persist seen ids', err);
  });
}

export const useProductUpdates = create<ProductUpdatesState>((set, get) => ({
  panelOpen: false,
  activeTourId: null,
  seen: new Set(),
  hydrated: false,
  hydrate: (initialSeen) => {
    if (get().hydrated) return;
    set({ seen: new Set(initialSeen), hydrated: true });
  },
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  startTour: (id) => set({ activeTourId: id }),
  endTour: () => set({ activeTourId: null }),
  markSeen: (id) => {
    const seen = new Set(get().seen);
    seen.add(id);
    set({ seen });
    persist([id]);
  },
  markManySeen: (ids) => {
    const seen = new Set(get().seen);
    for (const id of ids) seen.add(id);
    set({ seen });
    persist(ids);
  },
}));
```

- [ ] **Step 4: Delete the retired localStorage module**

Run: `git rm src/lib/product-updates/seen.ts`
Expected: file removed. (No test file exists for it.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/lib/product-updates/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/product-updates/store.ts src/lib/product-updates/store.test.ts
git commit -m "feat(product-updates): persist seen set via server action; drop localStorage"
```

---

### Task 5: Wire `initialSeen` through the component and admin layout

**Files:**
- Modify: `src/components/admin/product-updates/product-updates.tsx`
- Modify: `src/app/(admin)/layout.tsx`

**Interfaces:**
- Consumes: `parseSeen` (Task 2); the changed `hydrate(initialSeen)` (Task 4); `user.productUpdatesSeen` (Task 1).
- Produces: end-to-end behavior — the store is seeded from the DB on first server render, so the first-run gate evaluates against real per-user data (no flash, no repeat).

- [ ] **Step 1: Add the `initialSeen` prop to `ProductUpdates`**

In `src/components/admin/product-updates/product-updates.tsx`:

Change the component signature from:

```tsx
export function ProductUpdates() {
```

to:

```tsx
export function ProductUpdates({ initialSeen }: { initialSeen: string[] }) {
```

Then change the hydrate effect from:

```tsx
  // Hydrate the seen-set from localStorage once on mount.
  useEffect(() => {
    hydrate();
  }, [hydrate]);
```

to:

```tsx
  // Hydrate the seen-set once on mount from the server-loaded value the
  // admin layout passed down (User.productUpdatesSeen). No flash: the value
  // is present on the first client render.
  useEffect(() => {
    hydrate(initialSeen);
  }, [hydrate, initialSeen]);
```

- [ ] **Step 2: Pass the prop from the admin layout**

In `src/app/(admin)/layout.tsx`, add the import near the other `@/lib` imports:

```tsx
import { parseSeen } from '@/lib/product-updates/seen-json';
```

Then change the render from:

```tsx
      <ProductUpdates />
```

to:

```tsx
      <ProductUpdates initialSeen={parseSeen(user.productUpdatesSeen)} />
```

(`user` is already in scope from `const { user, permissions } = await requireAdminArea();`.)

- [ ] **Step 3: Typecheck the wiring**

Run: `pnpm typecheck`
Expected: PASS. (Confirms the prop type flows: `user.productUpdatesSeen` → `parseSeen` → `string[]` → `initialSeen`.)

> **Why no render test here:** this task is thin glue. The behavior it enables
> is already unit-covered — the gate logic in `selectors.test.ts`, the seeding
> and persistence in `store.test.ts` (Task 4). Rendering `ProductUpdates`
> directly would pull in `driver.js` + `next-intl` for no additional logic
> coverage, and the repo's convention is to test logic in pure/store modules
> rather than these thin admin components. The end-to-end path is checked by
> the manual verification below.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/product-updates/product-updates.tsx "src/app/(admin)/layout.tsx"
git commit -m "feat(product-updates): seed seen set from server via initialSeen prop"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite**

Run: `pnpm test`
Expected: PASS, including the three new files (`seen-json.test.ts`, `actions.test.ts`, `store.test.ts`) and the unchanged `selectors.test.ts`.

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both PASS. There should be **no remaining references** to the deleted `seen.ts`:

Run: `grep -rn "product-updates/seen'" src ; grep -rn "readSeen\|persistSeen\|SEEN_STORAGE_KEY" src`
Expected: no matches.

- [ ] **Step 3: Manual end-to-end check (local stack)**

Bring the app up (`pnpm dev` with the local Supabase stack running per the bring-up runbook), then:

1. Log in as an admin whose `productUpdatesSeen` is `NULL` (a fresh seed user, or `UPDATE "User" SET "productUpdatesSeen" = NULL WHERE email = '<you>';`). The welcome announcement/tour appears.
2. Dismiss it / complete the tour.
3. Reload the page → **no tour, no announcement**.
4. In `db:studio` (or SQL), confirm the row's `productUpdatesSeen` now contains `"first-run.welcome"` and `"welcome-2026-06"`.
5. Open the app in a **different browser / incognito**, logged in as the **same** admin → **no tour** (proves cross-device once-per-user).

- [ ] **Step 4: Final commit (if any lint autofix touched files)**

```bash
git add -A
git commit -m "chore(product-updates): lint/format pass" || echo "nothing to commit"
```

---

## Notes for the implementer

- **One-time re-show is expected:** existing admins whose column is `NULL` will see the welcome once more after deploy, then never again. This is the locked design decision (server-only, no localStorage migration). A heads-up to admins is optional but nice.
- **Do not reintroduce `localStorage`.** The server column is the single source of truth. If a write fails, the optimistic local state carries the session; a later login may re-show once — acceptable.
- **Deploy ordering:** the migration (Task 1) must be applied before the new code runs. The repo's `build` script runs `prisma migrate deploy` automatically when `DIRECT_URL` is set (see `package.json`), so a normal deploy handles this.
