# Product Updates (admin web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one code-shipped system on the admin web surface that powers three views — an announcement modal, a What's New panel, and a driver.js guide tour — over a single content registry.

**Architecture:** A typed registry (`registry.ts` + `tours.ts`) is the content source. Pure selectors derive "what's unseen / what to announce" from the registry plus a per-user seen-set. A zustand store owns client state (panel open, active tour, the seen-set hydrated from `localStorage`). A single client orchestrator mounted in the admin layout renders the modal + panel and runs tours; the sidebar footer and topbar user-menu are the entry points.

**Tech Stack:** Next.js 16 (App Router), React, TypeScript, zustand@5, next-intl@4, driver.js (new), vitest (node env), Tailwind, lucide-react.

## Global Constraints

- **Surface:** admin web only (`src/app/(admin)`). Do NOT touch LIFF.
- **Content is code-shipped:** no DB table, no authoring UI, no server actions for content.
- **Copy is inline & localized** as `{ th: string; en?: string }`; render with `th` fallback. `th` is required.
- **Seen-state is `localStorage`**, a namespaced set of item ids. Never throws on SSR / missing storage.
- **Tour anchors are `data-tour="<anchor>"` attributes** on real elements — never CSS selectors.
- **Item `id` is a stable slug** and the seen key — never rename or reuse an id.
- **Tests:** vitest runs `environment: 'node'`; test files sit next to source as `*.test.ts`. Unit-test pure logic only. Run a single file with `pnpm exec vitest run <path>`; lint with `pnpm lint`.
- **Existing primitives to reuse:** `Dialog` from `@/components/ui/dialog` (controlled: `open`/`onClose`/`title`/`children`/`className`); `cn` from `@/lib/utils`; `Locale`/`DEFAULT_LOCALE` from `@/lib/i18n/config`; `useLocale()` from `next-intl`. Mirror the zustand store style in `src/components/admin/use-mobile-nav.ts`.

---

## File Structure

```
src/lib/product-updates/
  types.ts          // LocalizedText, UpdateItem, TourStep, Tour
  registry.ts       // UpdateItem[] — the content devs edit per release
  tours.ts          // Tour[] — id → ordered steps (data-tour anchors)
  selectors.ts      // pure: pickText, sortByDateDesc, unseenItems, unseenCount, nextAnnounce, tourById
  selectors.test.ts // node-env unit tests for selectors.ts
  seen.ts           // SSR-safe localStorage read/persist (thin, untested)
  store.ts          // zustand: panelOpen, activeTourId, seen-set, actions
  run-tour.ts       // driver.js wrapper: runTour(tour, locale, onDone) => cleanup
src/components/admin/product-updates/
  announcement-modal.tsx  // built on ui/dialog
  whats-new-panel.tsx     // the list panel, built on ui/dialog
  product-updates.tsx     // orchestrator — mounted in (admin)/layout.tsx
src/components/admin/sidebar.tsx   // EDIT: What's New footer button + unseen dot + data-tour anchors
src/components/admin/topbar.tsx    // EDIT: "Restart guide" user-menu entry + data-tour anchors
src/app/(admin)/layout.tsx         // EDIT: mount <ProductUpdates/> after <Topbar>
package.json                       // EDIT: add driver.js
```

---

## Task 1: Pure core — types, content, selectors

**Files:**
- Create: `src/lib/product-updates/types.ts`
- Create: `src/lib/product-updates/registry.ts`
- Create: `src/lib/product-updates/tours.ts`
- Create: `src/lib/product-updates/selectors.ts`
- Test: `src/lib/product-updates/selectors.test.ts`

**Interfaces:**
- Produces:
  - `type LocalizedText = { th: string; en?: string }`
  - `type UpdateItem = { id: string; date: string; title: LocalizedText; body: LocalizedText; announce?: boolean; tour?: string }`
  - `type TourStep = { anchor: string; title: LocalizedText; body: LocalizedText; side?: 'top' | 'right' | 'bottom' | 'left' }`
  - `type Tour = { id: string; steps: TourStep[] }`
  - `UPDATES: UpdateItem[]` (registry), `TOURS: Tour[]`
  - `pickText(text: LocalizedText, locale: Locale): string`
  - `sortByDateDesc(items: UpdateItem[]): UpdateItem[]`
  - `unseenItems(items: UpdateItem[], seen: ReadonlySet<string>): UpdateItem[]`
  - `unseenCount(items: UpdateItem[], seen: ReadonlySet<string>): number`
  - `nextAnnounce(items: UpdateItem[], seen: ReadonlySet<string>): UpdateItem | null`
  - `tourById(tours: Tour[], id: string): Tour | null`

- [ ] **Step 1: Write the types**

Create `src/lib/product-updates/types.ts`:

```ts
/**
 * Product-updates content model (admin web).
 *
 * All content is code-shipped — these types describe the typed registry
 * devs edit per release. Copy is inline & localized; `th` is the source of
 * truth, `en` an optional proofread fallback target.
 */

export type LocalizedText = { th: string; en?: string };

export type UpdateItem = {
  /** Stable slug — the seen key. NEVER rename or reuse. */
  id: string;
  /** ISO date 'YYYY-MM-DD' — drives newest-first ordering. */
  date: string;
  title: LocalizedText;
  body: LocalizedText;
  /** When true, also interrupt with a modal until the user dismisses it. */
  announce?: boolean;
  /** Optional tour id — shows a "Take the tour" button on the item. */
  tour?: string;
};

export type TourStep = {
  /** Matches data-tour="<anchor>" on a real element. NOT a CSS selector. */
  anchor: string;
  title: LocalizedText;
  body: LocalizedText;
  side?: 'top' | 'right' | 'bottom' | 'left';
};

export type Tour = { id: string; steps: TourStep[] };
```

- [ ] **Step 2: Write the content registry + tours**

Create `src/lib/product-updates/registry.ts`:

```ts
import type { UpdateItem } from './types';

/**
 * The What's New content. Newest items can go anywhere — ordering is by
 * `date`, computed at render. Add a new entry per release; give it a fresh,
 * stable `id`. Set `announce: true` to pop a modal on next load.
 */
export const UPDATES: UpdateItem[] = [
  {
    id: 'welcome-2026-06',
    date: '2026-06-26',
    title: { th: 'ยินดีต้อนรับสู่ Koolman Work', en: 'Welcome to Koolman Work' },
    body: {
      th: 'ระบบจัดการงานบุคคลของคุณ ดูทัวร์แนะนำเพื่อเริ่มต้นใช้งานได้เลย',
      en: 'Your HR workspace. Take the quick tour to get started.',
    },
    announce: true,
    tour: 'welcome',
  },
];
```

Create `src/lib/product-updates/tours.ts`:

```ts
import type { Tour } from './types';

/**
 * Guide tours. Each step anchors to a real element via data-tour="<anchor>".
 * Anchors used here must exist in the rendered admin shell (see sidebar.tsx /
 * topbar.tsx). A missing anchor at runtime skips that step gracefully.
 */
export const TOURS: Tour[] = [
  {
    id: 'welcome',
    steps: [
      {
        anchor: 'sidebar-home',
        title: { th: 'หน้าหลัก', en: 'Home' },
        body: { th: 'ภาพรวมงานทั้งหมดเริ่มที่นี่', en: 'Your dashboard overview starts here.' },
        side: 'right',
      },
      {
        anchor: 'whats-new-button',
        title: { th: 'มีอะไรใหม่', en: "What's New" },
        body: {
          th: 'กดที่นี่เพื่อดูฟีเจอร์ใหม่และเริ่มทัวร์อีกครั้งได้ทุกเมื่อ',
          en: 'Open this anytime to see new features and replay tours.',
        },
        side: 'right',
      },
      {
        anchor: 'topbar-bell',
        title: { th: 'การแจ้งเตือน', en: 'Notifications' },
        body: { th: 'งานที่ต้องดำเนินการจะแจ้งเตือนที่นี่', en: 'Items needing your action show up here.' },
        side: 'bottom',
      },
    ],
  },
];
```

- [ ] **Step 3: Write the failing selector tests**

Create `src/lib/product-updates/selectors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  nextAnnounce,
  pickText,
  sortByDateDesc,
  tourById,
  unseenCount,
  unseenItems,
} from './selectors';
import type { UpdateItem } from './types';

const items: UpdateItem[] = [
  { id: 'a', date: '2026-01-01', title: { th: 'A' }, body: { th: 'a' } },
  { id: 'b', date: '2026-03-01', title: { th: 'B' }, body: { th: 'b' }, announce: true },
  { id: 'c', date: '2026-02-01', title: { th: 'C' }, body: { th: 'c' }, announce: true },
];

describe('pickText', () => {
  it('returns the locale value when present', () => {
    expect(pickText({ th: 'สวัสดี', en: 'Hi' }, 'en')).toBe('Hi');
  });
  it('falls back to th when the locale value is missing', () => {
    expect(pickText({ th: 'สวัสดี' }, 'en')).toBe('สวัสดี');
  });
});

describe('sortByDateDesc', () => {
  it('orders newest first and does not mutate input', () => {
    const out = sortByDateDesc(items);
    expect(out.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('unseenItems / unseenCount', () => {
  it('excludes ids in the seen set', () => {
    const seen = new Set(['a', 'b']);
    expect(unseenItems(items, seen).map((i) => i.id)).toEqual(['c']);
    expect(unseenCount(items, seen)).toBe(1);
  });
  it('treats an empty seen set as everything unseen', () => {
    expect(unseenCount(items, new Set())).toBe(3);
  });
});

describe('nextAnnounce', () => {
  it('returns the newest unseen item flagged announce', () => {
    expect(nextAnnounce(items, new Set())?.id).toBe('b');
  });
  it('skips seen announce items', () => {
    expect(nextAnnounce(items, new Set(['b']))?.id).toBe('c');
  });
  it('returns null when no unseen announce item remains', () => {
    expect(nextAnnounce(items, new Set(['b', 'c']))).toBeNull();
  });
});

describe('tourById', () => {
  it('finds a tour by id and returns null when absent', () => {
    const tours = [{ id: 'welcome', steps: [] }];
    expect(tourById(tours, 'welcome')?.id).toBe('welcome');
    expect(tourById(tours, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/lib/product-updates/selectors.test.ts`
Expected: FAIL — `Cannot find module './selectors'` (or "is not a function").

- [ ] **Step 5: Implement the selectors**

Create `src/lib/product-updates/selectors.ts`:

```ts
import type { Locale } from '@/lib/i18n/config';
import type { LocalizedText, Tour, UpdateItem } from './types';

/** Localized value for `locale`, falling back to the required `th` source. */
export function pickText(text: LocalizedText, locale: Locale): string {
  return text[locale] ?? text.th;
}

/** Newest-first by `date`. Returns a new array; does not mutate input. */
export function sortByDateDesc(items: UpdateItem[]): UpdateItem[] {
  return [...items].sort((a, b) => b.date.localeCompare(a.date));
}

/** Items whose id is not in `seen`, newest-first. */
export function unseenItems(items: UpdateItem[], seen: ReadonlySet<string>): UpdateItem[] {
  return sortByDateDesc(items).filter((i) => !seen.has(i.id));
}

export function unseenCount(items: UpdateItem[], seen: ReadonlySet<string>): number {
  return items.reduce((n, i) => (seen.has(i.id) ? n : n + 1), 0);
}

/** Newest unseen item flagged `announce`, or null. */
export function nextAnnounce(items: UpdateItem[], seen: ReadonlySet<string>): UpdateItem | null {
  return unseenItems(items, seen).find((i) => i.announce) ?? null;
}

export function tourById(tours: Tour[], id: string): Tour | null {
  return tours.find((t) => t.id === id) ?? null;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/lib/product-updates/selectors.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 7: Lint, then commit**

Run: `pnpm lint`
Expected: no errors in `src/lib/product-updates/`.

```bash
git add src/lib/product-updates/
git commit -m "feat(product-updates): typed registry, tours, and pure selectors"
```

---

## Task 2: Seen-state persistence + zustand store

**Files:**
- Create: `src/lib/product-updates/seen.ts`
- Create: `src/lib/product-updates/store.ts`

**Interfaces:**
- Consumes: nothing from Task 1 at module level (store imports `UPDATES` only inside actions if needed; not required here).
- Produces:
  - `SEEN_STORAGE_KEY: string`
  - `readSeen(): Set<string>` — SSR-safe; empty set on server / missing / malformed storage; never throws.
  - `persistSeen(ids: ReadonlySet<string>): void` — SSR-safe no-op on server.
  - `useProductUpdates` zustand hook with state:
    `{ panelOpen: boolean; activeTourId: string | null; seen: Set<string>; hydrated: boolean; hydrate(): void; openPanel(): void; closePanel(): void; startTour(id: string): void; endTour(): void; markSeen(id: string): void; markManySeen(ids: string[]): void }`

- [ ] **Step 1: Implement the localStorage wrapper**

Create `src/lib/product-updates/seen.ts`:

```ts
/**
 * Per-browser "seen" set for product-updates, in localStorage.
 *
 * SSR-safe: on the server (no `window`) or when storage is unavailable /
 * malformed, reads return an empty set and writes are no-ops — never throws.
 * Cross-device consistency is intentionally out of scope (see the design spec).
 */

export const SEEN_STORAGE_KEY = 'koolman.productUpdates.seen.v1';

export function readSeen(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function persistSeen(ids: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // storage full / disabled — degrade silently
  }
}
```

- [ ] **Step 2: Implement the zustand store**

Create `src/lib/product-updates/store.ts`:

```ts
'use client';

/**
 * Client state for product-updates. Mirrors the use-mobile-nav store style:
 * sibling client components (sidebar button, topbar menu, orchestrator) share
 * one hook instead of a Context provider.
 *
 * `seen` is hydrated from localStorage once via hydrate() (called by the
 * orchestrator on mount). Initial state is an empty set so the server render
 * and first client render match — UI that depends on `seen` gates on
 * `hydrated` to avoid a flash.
 */

import { create } from 'zustand';
import { persistSeen, readSeen } from './seen';

type ProductUpdatesState = {
  panelOpen: boolean;
  activeTourId: string | null;
  seen: Set<string>;
  hydrated: boolean;
  hydrate: () => void;
  openPanel: () => void;
  closePanel: () => void;
  startTour: (id: string) => void;
  endTour: () => void;
  markSeen: (id: string) => void;
  markManySeen: (ids: string[]) => void;
};

export const useProductUpdates = create<ProductUpdatesState>((set, get) => ({
  panelOpen: false,
  activeTourId: null,
  seen: new Set(),
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ seen: readSeen(), hydrated: true });
  },
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  startTour: (id) => set({ activeTourId: id }),
  endTour: () => set({ activeTourId: null }),
  markSeen: (id) => {
    const seen = new Set(get().seen);
    seen.add(id);
    persistSeen(seen);
    set({ seen });
  },
  markManySeen: (ids) => {
    const seen = new Set(get().seen);
    for (const id of ids) seen.add(id);
    persistSeen(seen);
    set({ seen });
  },
}));
```

- [ ] **Step 3: Verify it type-checks and lints**

Run: `pnpm exec tsc --noEmit`
Expected: no errors referencing `src/lib/product-updates/`.

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Add seen.ts to coverage exclude (match the I/O-wrapper convention)**

Modify `vitest.config.ts` — in `test.coverage.exclude`, add the line alongside the existing supabase/prisma exclusions:

```ts
        'src/lib/product-updates/seen.ts',
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/product-updates/seen.ts src/lib/product-updates/store.ts vitest.config.ts
git commit -m "feat(product-updates): localStorage seen-state + zustand store"
```

---

## Task 3: driver.js install + tour runner

**Files:**
- Modify: `package.json` (add `driver.js`)
- Create: `src/lib/product-updates/run-tour.ts`

**Interfaces:**
- Consumes (Task 1): `Tour`, `TourStep`, `pickText`; `Locale` from `@/lib/i18n/config`.
- Produces: `runTour(tour: Tour, locale: Locale, onDone: () => void): () => void` — starts a driver.js tour over the live DOM, skipping steps whose `[data-tour]` anchor is absent; calls `onDone` when the tour finishes or is destroyed; returns a cleanup function that destroys the tour.

- [ ] **Step 1: Add the dependency**

Run: `pnpm add driver.js`
Expected: `driver.js` appears under `dependencies` in `package.json` (v1.x).

- [ ] **Step 2: Implement the runner**

Create `src/lib/product-updates/run-tour.ts`:

```ts
'use client';

/**
 * driver.js wrapper. Translates our Tour model into driver steps, resolves
 * each step's data-tour anchor at start time, and drops steps whose anchor is
 * missing (e.g. an element on a page you're not on). If no steps resolve, the
 * tour is a no-op with a console warning.
 */

import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { Locale } from '@/lib/i18n/config';
import { pickText } from './selectors';
import type { Tour } from './types';

export function runTour(tour: Tour, locale: Locale, onDone: () => void): () => void {
  const steps = tour.steps
    .filter((s) => document.querySelector(`[data-tour="${s.anchor}"]`) !== null)
    .map((s) => ({
      element: `[data-tour="${s.anchor}"]`,
      popover: {
        title: pickText(s.title, locale),
        description: pickText(s.body, locale),
        side: s.side ?? 'bottom',
      },
    }));

  if (steps.length === 0) {
    console.warn(`[product-updates] tour "${tour.id}" had no resolvable anchors; skipping`);
    onDone();
    return () => {};
  }

  const d = driver({
    showProgress: true,
    allowClose: true,
    steps,
    onDestroyed: () => onDone(),
  });
  d.drive();

  return () => d.destroy();
}
```

- [ ] **Step 3: Verify type-check + lint**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (If driver.js types complain about `side`, it accepts the same union as our `TourStep.side`; the `?? 'bottom'` guarantees a value.)

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/product-updates/run-tour.ts
git commit -m "feat(product-updates): add driver.js and tour runner"
```

---

## Task 4: Announcement modal + What's New panel

**Files:**
- Create: `src/components/admin/product-updates/announcement-modal.tsx`
- Create: `src/components/admin/product-updates/whats-new-panel.tsx`

**Interfaces:**
- Consumes: `Dialog` from `@/components/ui/dialog`; `useProductUpdates` (Task 2); `UPDATES` (Task 1), `TOURS` (Task 1); selectors `pickText`, `sortByDateDesc`, `unseenItems`, `nextAnnounce` (Task 1); `useLocale` from `next-intl`; `Locale` from `@/lib/i18n/config`; `cn` from `@/lib/utils`.
- Produces: `<AnnouncementModal/>` and `<WhatsNewPanel/>` — self-contained, store-driven (no props).

- [ ] **Step 1: Implement the announcement modal**

Create `src/components/admin/product-updates/announcement-modal.tsx`:

```tsx
'use client';

import { Sparkles } from 'lucide-react';
import { useLocale } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import type { Locale } from '@/lib/i18n/config';
import { UPDATES } from '@/lib/product-updates/registry';
import { nextAnnounce, pickText } from '@/lib/product-updates/selectors';
import { useProductUpdates } from '@/lib/product-updates/store';

/**
 * Auto-opens when there is an unseen announce item. "Got it" marks just that
 * item seen; "See all" hands off to the What's New panel; "Take the tour"
 * starts the item's tour (also marking it seen). Only renders once hydrated,
 * so a freshly-loaded page never flashes a stale announcement.
 */
export function AnnouncementModal() {
  const locale = useLocale() as Locale;
  const hydrated = useProductUpdates((s) => s.hydrated);
  const seen = useProductUpdates((s) => s.seen);
  const markSeen = useProductUpdates((s) => s.markSeen);
  const openPanel = useProductUpdates((s) => s.openPanel);
  const startTour = useProductUpdates((s) => s.startTour);

  const item = hydrated ? nextAnnounce(UPDATES, seen) : null;
  const open = item !== null;

  function dismiss() {
    if (item) markSeen(item.id);
  }

  return (
    <Dialog open={open} onClose={dismiss} title={item ? pickText(item.title, locale) : undefined}>
      {item && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-700">
              <Sparkles size={18} aria-hidden="true" />
            </span>
            <p className="text-sm leading-relaxed text-ink-2">{pickText(item.body, locale)}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                dismiss();
                openPanel();
              }}
              className="rounded-lg px-3 py-2 text-sm text-ink-2 transition hover:bg-gray-100"
            >
              {locale === 'en' ? 'See all updates' : 'ดูทั้งหมด'}
            </button>
            {item.tour && (
              <button
                type="button"
                onClick={() => {
                  const tourId = item.tour as string;
                  dismiss();
                  startTour(tourId);
                }}
                className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm font-medium text-ink-1 transition hover:bg-gray-50"
              >
                {locale === 'en' ? 'Take the tour' : 'ดูทัวร์แนะนำ'}
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-700"
            >
              {locale === 'en' ? 'Got it' : 'เข้าใจแล้ว'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
```

- [ ] **Step 2: Implement the What's New panel**

Create `src/components/admin/product-updates/whats-new-panel.tsx`:

```tsx
'use client';

import { Dialog } from '@/components/ui/dialog';
import { useLocale } from 'next-intl';
import { useEffect } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { UPDATES } from '@/lib/product-updates/registry';
import { pickText, sortByDateDesc, unseenItems } from '@/lib/product-updates/selectors';
import { useProductUpdates } from '@/lib/product-updates/store';

/**
 * Lists all updates newest-first. Opening the panel marks every listed item
 * seen (clears the sidebar dot). Items with a tour show a replay button; tours
 * stay replayable regardless of seen-state.
 */
export function WhatsNewPanel() {
  const locale = useLocale() as Locale;
  const panelOpen = useProductUpdates((s) => s.panelOpen);
  const closePanel = useProductUpdates((s) => s.closePanel);
  const seen = useProductUpdates((s) => s.seen);
  const markManySeen = useProductUpdates((s) => s.markManySeen);
  const startTour = useProductUpdates((s) => s.startTour);

  // On open, mark everything currently unseen as seen.
  useEffect(() => {
    if (!panelOpen) return;
    const unseenIds = unseenItems(UPDATES, seen).map((i) => i.id);
    if (unseenIds.length > 0) markManySeen(unseenIds);
    // Intentionally run only when the panel transitions open.
    // biome-ignore lint/correctness/useExhaustiveDependencies: open-edge only
  }, [panelOpen]);

  const items = sortByDateDesc(UPDATES);

  return (
    <Dialog
      open={panelOpen}
      onClose={closePanel}
      title={locale === 'en' ? "What's New" : 'มีอะไรใหม่'}
    >
      <ul className="divide-y divide-gray-100">
        {items.map((item) => (
          <li key={item.id} className="py-3 first:pt-0 last:pb-0">
            <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-4">
              {item.date}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-ink-1">{pickText(item.title, locale)}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">{pickText(item.body, locale)}</p>
            {item.tour && (
              <button
                type="button"
                onClick={() => {
                  const tourId = item.tour as string;
                  closePanel();
                  startTour(tourId);
                }}
                className="mt-2 text-sm font-medium text-primary-700 transition hover:text-primary-800"
              >
                {locale === 'en' ? 'Take the tour →' : 'ดูทัวร์แนะนำ →'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verify type-check + lint**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm lint`
Expected: clean (Biome may reorder imports — accept its autofix with `pnpm lint:fix`).

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/product-updates/announcement-modal.tsx src/components/admin/product-updates/whats-new-panel.tsx
git commit -m "feat(product-updates): announcement modal + what's-new panel"
```

---

## Task 5: Orchestrator + layout mount + first-run tour

**Files:**
- Create: `src/components/admin/product-updates/product-updates.tsx`
- Modify: `src/app/(admin)/layout.tsx`

**Interfaces:**
- Consumes: `AnnouncementModal`, `WhatsNewPanel` (Task 4); `useProductUpdates` (Task 2); `runTour` (Task 3); `TOURS`, `UPDATES` (Task 1); `tourById`, `nextAnnounce` (Task 1); `useLocale`; `Locale`.
- Produces: `<ProductUpdates/>` — the single mount point that hydrates the store, auto-starts the first-run welcome tour once, runs whichever tour is active, and renders the modal + panel.

- [ ] **Step 1: Implement the orchestrator**

Create `src/components/admin/product-updates/product-updates.tsx`:

```tsx
'use client';

import { useLocale } from 'next-intl';
import { useEffect, useRef } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { UPDATES } from '@/lib/product-updates/registry';
import { nextAnnounce, tourById } from '@/lib/product-updates/selectors';
import { runTour } from '@/lib/product-updates/run-tour';
import { useProductUpdates } from '@/lib/product-updates/store';
import { TOURS } from '@/lib/product-updates/tours';
import { AnnouncementModal } from './announcement-modal';
import { WhatsNewPanel } from './whats-new-panel';

/** Marker id (kept in the seen-set) recording that the first-run welcome
 *  tour has already auto-started, so it fires exactly once per browser. */
const FIRST_RUN_KEY = 'first-run.welcome';

/**
 * Single client mount for the product-updates system (admin layout). Owns:
 *   - store hydration from localStorage,
 *   - first-run auto-start of the welcome tour (once),
 *   - running the active tour via driver.js,
 *   - rendering the announcement modal + what's-new panel.
 */
export function ProductUpdates() {
  const locale = useLocale() as Locale;
  const hydrate = useProductUpdates((s) => s.hydrate);
  const hydrated = useProductUpdates((s) => s.hydrated);
  const seen = useProductUpdates((s) => s.seen);
  const markSeen = useProductUpdates((s) => s.markSeen);
  const activeTourId = useProductUpdates((s) => s.activeTourId);
  const startTour = useProductUpdates((s) => s.startTour);
  const endTour = useProductUpdates((s) => s.endTour);

  // Hydrate the seen-set from localStorage once on mount.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // First-run: auto-start the welcome tour exactly once per browser — but
  // only when nothing is already interrupting. If an announcement modal is
  // pending (e.g. the welcome item itself), that modal is the better first
  // surface and offers "Take the tour"; we don't stack a driver overlay on
  // top of it. A user who dismisses the greeting still gets the tour once on
  // a later visit (FIRST_RUN_KEY not yet set, no pending announcement).
  const firstRunChecked = useRef(false);
  useEffect(() => {
    if (!hydrated || firstRunChecked.current) return;
    firstRunChecked.current = true;
    if (!seen.has(FIRST_RUN_KEY) && nextAnnounce(UPDATES, seen) === null) {
      markSeen(FIRST_RUN_KEY);
      startTour('welcome');
    }
  }, [hydrated, seen, markSeen, startTour]);

  // Run whichever tour is active; clean up on change/unmount.
  useEffect(() => {
    if (!activeTourId) return;
    const tour = tourById(TOURS, activeTourId);
    if (!tour) {
      endTour();
      return;
    }
    const cleanup = runTour(tour, locale, endTour);
    return cleanup;
  }, [activeTourId, locale, endTour]);

  return (
    <>
      <AnnouncementModal />
      <WhatsNewPanel />
    </>
  );
}
```

- [ ] **Step 2: Mount it in the admin layout**

Modify `src/app/(admin)/layout.tsx` — add the import and render `<ProductUpdates/>` inside the shell (it renders nothing structural, so placement after `<main>` is fine):

```tsx
import { ProductUpdates } from '@/components/admin/product-updates/product-updates';
```

Change the returned shell from:

```tsx
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userLabel={user.email ?? 'Admin'} userId={user.id} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
```

to:

```tsx
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userLabel={user.email ?? 'Admin'} userId={user.id} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <ProductUpdates />
    </div>
```

- [ ] **Step 3: Verify type-check + lint + build the route**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Manual smoke (documented, run if a dev server is available)**

Run: `pnpm dev`, sign in as an Admin, open `/admin`.
Expected: on a fresh browser profile, the welcome tour auto-starts after load; the announcement modal shows the welcome item; "Got it" closes it and it does not reappear on reload.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/product-updates/product-updates.tsx "src/app/(admin)/layout.tsx"
git commit -m "feat(product-updates): orchestrator mount + first-run welcome tour"
```

---

## Task 6: Entry points — sidebar button, dot, tour anchors, restart-guide

**Files:**
- Modify: `src/components/admin/sidebar.tsx`
- Modify: `src/components/admin/topbar.tsx`

**Interfaces:**
- Consumes: `useProductUpdates` (Task 2); `UPDATES` (Task 1); `unseenCount` (Task 1); `useMobileNav` (existing).
- Produces: a What's New footer button (`data-tour="whats-new-button"`) with an unseen dot, a `data-tour="sidebar-home"` anchor on the Home link, a `data-tour="topbar-bell"` anchor on the bell, and a "Restart guide" entry in the user menu.

- [ ] **Step 1: Add the What's New button + dot to the sidebar footer**

Modify `src/components/admin/sidebar.tsx`. Add imports near the top:

```tsx
import { Sparkles } from 'lucide-react';
import { UPDATES } from '@/lib/product-updates/registry';
import { unseenCount } from '@/lib/product-updates/selectors';
import { useProductUpdates } from '@/lib/product-updates/store';
```

Inside `Sidebar`, after the existing `close` selector, add:

```tsx
  const openPanel = useProductUpdates((s) => s.openPanel);
  const hydrated = useProductUpdates((s) => s.hydrated);
  const seen = useProductUpdates((s) => s.seen);
  const unseen = hydrated ? unseenCount(UPDATES, seen) : 0;
```

Replace the footer block:

```tsx
          {/* Footer brand mark (the functional user menu lives in the Topbar). */}
          <div className="border-t border-gray-100 px-4 py-3">
            <p className="font-display text-[11px] uppercase tracking-wider text-ink-4">
              Koolman Work · V1
            </p>
          </div>
```

with:

```tsx
          {/* Footer: What's New entry + brand mark. */}
          <div className="border-t border-gray-100 px-3 py-3">
            <button
              type="button"
              data-tour="whats-new-button"
              onClick={() => {
                openPanel();
                close();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-2 transition hover:bg-gray-50"
            >
              <span className="relative">
                <Sparkles size={18} strokeWidth={2} aria-hidden="true" />
                {unseen > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary-600 ring-2 ring-white">
                    <span className="sr-only">มีอัปเดตใหม่</span>
                  </span>
                )}
              </span>
              <span className="flex-1 text-left">มีอะไรใหม่</span>
            </button>
            <p className="px-3 pt-2 font-display text-[11px] uppercase tracking-wider text-ink-4">
              Koolman Work · V1
            </p>
          </div>
```

- [ ] **Step 2: Anchor the Home nav link for the welcome tour**

Still in `sidebar.tsx`, the nav renders each item as a `<Link>`. Add a `data-tour` only to the Home item (`href === '/admin'`). On the `<Link>` element, add the attribute:

```tsx
                          data-tour={item.href === '/admin' ? 'sidebar-home' : undefined}
```

(Place it alongside the existing `aria-current` / `className` props on that `<Link>`.)

- [ ] **Step 3: Anchor the bell + add "Restart guide" to the topbar user menu**

Modify `src/components/admin/topbar.tsx`. Wrap the bell with the anchor — change:

```tsx
        <NotificationBell userId={userId} />
```

to:

```tsx
        <span data-tour="topbar-bell">
          <NotificationBell userId={userId} />
        </span>
```

Add an import:

```tsx
import { useProductUpdates } from '@/lib/product-updates/store';
```

In `UserMenu`, after the `const [open, setOpen]` line add:

```tsx
  const startTour = useProductUpdates((s) => s.startTour);
```

Then, inside the dropdown `role="menu"` block, add a "Restart guide" button just above the sign-out `<form>` (use the existing `Sparkles` icon — add it to the `lucide-react` import in this file):

```tsx
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              startTour('welcome');
            }}
            className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-sm text-ink-2 transition hover:bg-gray-50"
          >
            <Sparkles size={16} aria-hidden="true" />
            <span>เริ่มทัวร์แนะนำใหม่</span>
          </button>
```

Update the topbar's lucide import line to include `Sparkles`:

```tsx
import { ChevronDown, LogOut, Menu, Search, Sparkles, UserCog } from 'lucide-react';
```

- [ ] **Step 4: Verify type-check + lint**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm lint`
Expected: clean (run `pnpm lint:fix` to absorb Biome import-ordering).

- [ ] **Step 5: Manual smoke (run if a dev server is available)**

Run: `pnpm dev`, open `/admin`.
Expected: the sidebar footer shows `✦ มีอะไรใหม่` with a dot when there are unseen items; clicking opens the panel and clears the dot; the user-menu "เริ่มทัวร์แนะนำใหม่" restarts the welcome tour, which highlights Home → What's New → bell in turn.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/sidebar.tsx src/components/admin/topbar.tsx
git commit -m "feat(product-updates): sidebar what's-new button, unseen dot, tour anchors, restart-guide"
```

---

## Final verification

- [ ] **Run the full unit suite:** `pnpm test` — expect green, including `selectors.test.ts`.
- [ ] **Type-check:** `pnpm exec tsc --noEmit` — clean.
- [ ] **Lint:** `pnpm lint` — clean.
- [ ] **Production build:** `pnpm build` — succeeds (driver.js CSS bundles, no SSR window errors).

## Spec coverage map

- Announcement (push modal) → Task 4 (`announcement-modal.tsx`) + Task 5 (auto-open via orchestrator).
- What's New (pull list) → Task 4 (`whats-new-panel.tsx`) + Task 6 (sidebar entry + dot).
- Guide wizard (driver.js) → Task 3 (runner) + Task 5 (first-run + active-tour effect) + Task 6 (anchors + restart entry).
- Code-shipped registry + inline `{th,en}` → Task 1.
- localStorage seen-state, SSR-safe → Task 2.
- Editorial/operational separation (footer vs topbar bell) → Task 6.
- Edge cases (no unseen / missing anchor / SSR / driver cleanup) → Task 2 (`readSeen`), Task 3 (`runTour` filter + warn), Task 5 (cleanup return).
```
