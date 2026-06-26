# Product Updates system (admin web) — Design

**Date:** 2026-06-26
**Surface:** Admin web dashboard (`src/app/(admin)`) only. Not LIFF.
**Status:** Approved design, ready for implementation planning.

## Summary

One system, code-shipped, that powers three views onto a single content registry:

| Feature | Interaction | Backed by |
|---|---|---|
| **Announcement** | *Pushed* — a modal auto-opens when there is an unseen item flagged `announce` | registry items where `announce: true` |
| **What's New** | *Pulled* — a panel listing all items newest-first, opened from a sidebar button | the whole registry |
| **Guide wizard** | *Sequenced* — a driver.js spotlight tour over real UI | an optional `tour` attached to an item, plus one standalone `welcome` tour |

Designing them together (rather than as three overlapping mini-systems) lets them share one data model — content items plus per-user "seen" state — and one client orchestrator.

## Key decisions

- **Content is code-shipped.** Items live in a typed registry in the repo, released with each deploy. No DB table, no authoring UI, no role-gated CRUD. ("New features" = release notes written by the dev team.)
- **Copy is inline and localized** as `{ th, en }` records in the registry (Thai fallback). Admin is a Thai/English surface; this keeps one source of truth rather than routing through `messages/*.json`.
- **"Seen" state is `localStorage`** — a namespaced set of item ids. Instant, no table, no write-on-dismiss. Accepted trade-off: a second browser may re-show an announcement once. DB-backed per-`user.id` seen-state is a clean future upgrade if cross-device consistency is ever wanted.
- **Guide wizard uses driver.js** (~5kb, zero-dependency, MIT). Chosen for the smoothest dim-and-highlight-with-popover UX, solid keyboard/a11y, and no React-version coupling (driven from a `useEffect`). Avoided intro.js (commercial license) and react-joyride (heavier, finicky under React 19 strict mode).
- **What's New entry point lives in the sidebar footer**, not the topbar. The topbar bell stays purely operational; the sidebar footer is the product/meta zone (brand, version), so "What's New" — content *about the product itself* — belongs there.

## Conceptual boundary: editorial vs operational

The existing `NotificationBell` carries *operational, per-user, transactional* signals ("a leave request needs your approval"). This system carries *editorial, broadcast, product-education* content (same for everyone, tied to releases). They stay in visually distinct homes — bell in the topbar, What's New in the sidebar footer — so neither stream muddies the other.

## Data model

`src/lib/product-updates/registry.ts` — a typed array. Each item:

```ts
type LocalizedText = { th: string; en?: string }; // th required, en optional fallback target

type UpdateItem = {
  id: string;              // stable slug — this is the "seen" key. Never reuse/rename.
  date: string;            // ISO date, e.g. '2026-06-20' — drives newest-first ordering
  title: LocalizedText;
  body: LocalizedText;
  announce?: boolean;      // if true, also interrupt with a modal until seen
  tour?: string;           // optional tour id → shows a "Take the tour" button
};
```

`src/lib/product-updates/tours.ts` — tour id → ordered steps. Each step anchors to a real element via a stable `data-tour="…"` attribute (NOT a CSS selector), so tours survive restyling.

```ts
type TourStep = {
  anchor: string;          // matches data-tour="<anchor>" on a real element
  title: LocalizedText;
  body: LocalizedText;
  side?: 'top' | 'right' | 'bottom' | 'left'; // popover placement hint
};

type Tour = { id: string; steps: TourStep[] };
```

A reserved `welcome` tour id is the first-run onboarding tour.

## Behavior

### What's New (the hub)
- A pinned **button in the sidebar footer**, above the "Koolman Work · V1" brand line: `✦ มีอะไรใหม่`, full-width, styled like a nav row (Sparkles icon + label) but set apart in the footer region.
- **Unseen indicator:** a small primary-colored dot on the icon when `unseenCount > 0` (a dot, not a number — kept calm to contrast with the operational badge counts elsewhere in the sidebar). Computed client-side from `localStorage` (sidebar is already `'use client'`).
- **Click** → opens the What's New panel via the shared `product-updates` store; on mobile it also closes the nav drawer.
- The panel (built on `ui/dialog.tsx`, matching existing dialog/review-modal conventions) lists items newest-first: each row = date · title · body, an unseen "new" pill, and a **"Take the tour →"** button when the item has a `tour`.
- **Opening the panel marks all listed items as seen** (clears the dot). Tours remain replayable regardless of seen-state.

### Announcement (the interrupt)
- On admin layout mount, the orchestrator checks for an unseen item with `announce: true`. If found, it auto-opens a **modal** (`ui/dialog`) showing that item (newest if several).
- Buttons: **"เข้าใจแล้ว / Got it"** (marks that item seen, closes) and **"ดูทั้งหมด / See all updates"** (closes modal, opens the What's New panel). If the item has a tour, also **"Take the tour"**.
- Only `announce` items interrupt; everything else waits quietly in the panel. Interruptions stay rare and intentional.

### Guide wizard (driver.js)
Two triggers:
1. **First-run welcome tour** — the standalone `welcome` tour auto-starts the first time an admin loads the dashboard, gated by its own seen id so it fires once. Walks the sidebar/topbar essentials.
2. **Manual replay** — "Take the tour" buttons (panel + announcement modal) for feature tours, plus a persistent **"เริ่มทัวร์ใหม่ / Restart guide"** entry in the topbar user menu so it is always re-discoverable.

Engine: a `useTour()` hook wrapping driver.js. Given a tour id it resolves steps, waits for each `data-tour` anchor to exist, then runs. Missing anchor → that step is skipped gracefully; tour continues.

## Architecture & mounting

A single client orchestrator `<ProductUpdates/>` is mounted in `(admin)/layout.tsx` right after `<Topbar>`. It owns the announcement modal, the What's New panel, and the driver.js tour controller. The sidebar footer button and the user-menu "Restart guide" entry toggle state through a tiny zustand store — mirroring the existing `use-mobile-nav` store pattern already in the codebase.

```
src/lib/product-updates/
  types.ts        // UpdateItem, Tour, TourStep, LocalizedText
  registry.ts     // the content (UpdateItem[]) — devs edit per release
  tours.ts        // tour id → ordered steps (data-tour anchors)
  seen.ts         // SSR-safe localStorage get/add seen-ids
  store.ts        // zustand: panel open state + active tour id
src/components/admin/product-updates/
  product-updates.tsx     // orchestrator, mounted in (admin)/layout.tsx
  announcement-modal.tsx  // built on ui/dialog
  whats-new-panel.tsx     // the list panel
  use-tour.ts             // driver.js controller hook
src/components/admin/sidebar.tsx  // EDIT: add What's New footer button + unseen dot
src/components/admin/topbar.tsx   // EDIT: add "Restart guide" entry to the user menu
src/app/(admin)/layout.tsx        // EDIT: mount <ProductUpdates/> after <Topbar>
```
Plus `data-tour="…"` attributes added to the real anchored elements, and `driver.js` added to `package.json`.

## Edge cases

- **No unseen announce items** → no modal; orchestrator renders nothing visible.
- **Tour anchor missing** (e.g. you are on a different page) → that step is skipped, tour continues. If *all* steps are missing, the tour no-ops with a console warning.
- **localStorage unavailable / SSR** → `seen.ts` returns an empty set, treats everything as unseen, never throws. Nothing renders until client mount, so there is no hydration mismatch (orchestrator is client-only).
- **driver.js cleanup** → the tour is destroyed on unmount / route change so the overlay can never get stranded.

## Testing

- **Unit (vitest):** `seen.ts` (add/get, idempotent add, missing-storage path); registry-derived selectors (unseen count, next announce item, newest-first ordering).
- **Component:** announcement auto-opens only with an unseen `announce` item; "Got it" marks it seen; opening the panel clears the dot.
- **Tour:** lightly integration- or manually-tested since driver.js manipulates real DOM; optional Playwright smoke test for the welcome tour.

## Out of scope (possible future work)

- DB-authored announcements / authoring UI.
- DB-backed cross-device seen-state.
- LIFF employee-app updates (separate content stream, separate spec).
- Per-locale copy beyond th/en.
