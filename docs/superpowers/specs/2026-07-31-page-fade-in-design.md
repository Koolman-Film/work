# Page fade-in on admin navigation — Design

**Date:** 2026-07-31
**Status:** Approved (design), pending implementation
**Author:** brainstormed with Claude

## Summary

Give every `(admin)` and `(owner)` page a subtle fade-and-rise entrance on
navigation, matching the POS prototype's `.fade-page`.

Three files, no new dependency, no JavaScript. The animation already exists in
`globals.css` — this spec is about **where it attaches** so it replays on route
change without disturbing the sidebar, topbar, or toasts.

## Context

### What POS does

`/Users/tong/Works/fai/pos`, `reference/v0.4/finnix-film.html:58`:

```css
@keyframes fadeUp { from { opacity:0; transform:translateY(6px);} to { opacity:1; transform:translateY(0);} }
.fade-page { animation: fadeUp .28s ease; }
```

`.fade-page` sits on the root element of every top-level view — 20 sites. The
prototype is a single-file SPA whose `App()` switches on a `view` state
variable (`finnix-film.html:4409-4417`), so changing views unmounts one
component and mounts another. A fresh DOM node replays the CSS animation for
free. The sidebar and topbar sit outside the switch, so only the content area
moves.

### The POS port kept it

The finished Next.js 16 App Router port lives on the POS repo's
`perf/region-benchmark` branch (head `274b6b2`) — not on `main`, which holds
only `docs/` and `reference/`. The port carried the fade over unchanged:
`.fade-page` still on module component roots (`Dashboard.tsx:132`,
`TicketList.tsx:165`, `StockModule.tsx:508`, …, 20 sites across 8 modules), CSS
moved into a Tailwind v4 `@layer components` block at `app/globals.css:157`.

Its shell (`app/(app)/layout.tsx`) is `Sidebar` + `Header` + `<main>{children}</main>`.
Layouts don't remount on navigation in App Router, but the page segment inside
does — so the fade still replays per route change while the chrome holds still.
**The pattern survives the architecture swap**, which is the precedent this
spec relies on.

### What we already have

`src/app/globals.css:131` — byte-for-byte the same idea, shipped with the
motion foundation:

```css
@keyframes enter-rise {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.u-enter-rise { animation: enter-rise var(--duration-base) var(--ease-out-soft) both; }
```

Ours is better tuned than POS's: `cubic-bezier(0.22, 0.61, 0.36, 1)` instead of
`ease`, plus `both` fill-mode (no one-frame flash before the animation starts)
and a `prefers-reduced-motion` collapse at `globals.css:165` that POS lacks in
both the prototype and the port.

It is used in exactly one place today:
`src/app/(admin)/admin/approvals/approvals-list.tsx:120`.

So this is not "build a fade-in". It is **"apply the fade-in we already built to
the other 58 pages."**

## Scope

| Route group | Pages | In scope |
|---|---:|---|
| `(admin)` | 58 | yes |
| `(owner)` | 1 | yes |
| `(liff)` | 23 | no |
| `(auth)` | — | no |

`(liff)` is excluded: it runs inside the LINE webview, where our fade would
stack on top of LINE's own screen-push animation.

## Architecture

Next.js re-instantiates `template.tsx` on every navigation — unlike
`layout.tsx`, which persists. That gives us a fresh DOM node per route change,
which is precisely POS's `view`-switch mechanism expressed in App Router terms.

```
(admin)/layout.tsx          Sidebar, Topbar, ToastProvider, NextIntlClientProvider
  └─ (admin)/template.tsx   NEW — remounts per navigation, carries the fade
       └─ admin/**/layout.tsx    section sub-navs
            └─ page.tsx
```

Three files:

```
src/app/globals.css              +4 lines   .u-enter-page
src/app/(admin)/template.tsx     new        covers 58 pages
src/app/(owner)/template.tsx     new        covers 1 page
```

Every future page under either group inherits the entrance with no further work.

### The CSS

Added next to `.u-enter-rise`:

```css
/* Whole-page entrance. Slower than .u-enter-rise: a full page of content
   needs longer to read as deliberate rather than twitchy. */
.u-enter-page { animation: enter-rise var(--duration-slow) var(--ease-out-soft) both; }
```

Reuses the existing `enter-rise` keyframe — no new keyframe — and inherits the
`prefers-reduced-motion` collapse automatically. `--duration-slow` is 320ms;
POS runs 280ms, and 200ms (`--duration-base`) reads as twitchy across a full
page of content.

Only `opacity` and `transform` animate. Both are compositor-only, so there is
no layout or paint cost.

### The templates

```tsx
// src/app/(admin)/template.tsx
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="u-enter-page">{children}</div>;
}
```

Server components — no `'use client'`. `(owner)/template.tsx` is identical.

### Why not the alternatives

**Per-page class (59 edits)**, the literal POS approach: no remount side
effects, but a 59-file mechanical diff with nothing stopping the 60th page from
forgetting it.

**Pathname-keyed client wrapper**: fixes the sub-nav wart below, at the cost of
~6 files, a client boundary, and a keying convention. Held in reserve as the
upgrade path rather than paid for up front.

## Preconditions verified

- All 11 layouts under `(admin)` are server components with **zero** client
  hooks (`useState`/`useReducer`/`useRef`), so the template's remount of nested
  layouts destroys no state.
- **No `loading.tsx` anywhere** in `(admin)` or `(owner)`, and the only
  `Suspense` is inside `employee-filters.tsx`, not a page boundary. Pages
  therefore commit fully-rendered and the fade plays on real content, never on
  a skeleton that then pops.
- Playwright's visibility check ignores `opacity`, so mid-fade elements still
  count as visible. The existing 25 functional e2e specs are unaffected.

## Testing

One new spec, `tests/e2e/page-fade.spec.ts`, covering the two things that can
actually break.

**The chrome/content split holds.** Stamp a marker on the sidebar DOM node,
client-side navigate between two admin pages, then assert the marker survived
(layout persisted, chrome didn't flash) while the `.u-enter-page` wrapper is a
different node (template remounted, fade replayed). That assertion pair is the
whole design.

**Reduced motion still wins.** The same navigation under Playwright's
`reducedMotion: 'reduce'`, asserting the computed `animation-duration` is
effectively zero.

No unit tests — there is no logic here.

## Accepted trade-offs

- **No exit animation.** The outgoing page vanishes instantly. This is what
  makes the pattern feel fast rather than laggy, and it is what POS shipped.
- **Sub-nav re-fades in four sections.** `settings`, `payroll`, `reports` and
  `attendance` have sticky sub-navs inside the template, so switching tabs
  within a section fades the sub-nav alongside the content. Known wart, known
  upgrade path (per-section keyed wrapper). Revisit only if it irritates in
  review.
- **In-page changes stay silent.** Filter and pagination updates re-render
  without remounting, so they do not fade. Deliberate: re-fading a table on
  every keystroke is how this pattern turns annoying.

## Note for whoever adds an accessibility suite

The POS port's `tests/e2e/a11y.spec.ts:64` records that auditing mid-fade makes
axe measure partially-transparent colours blended against the background,
reporting contrast pairs that "exist for a few frames and never settle — noise
that looks exactly like a real finding." Their fix was a `settle()` helper
injecting `animation: none !important` before every audit.

We have no axe suite today, so this costs us nothing now. Anyone adding one
should freeze animations first.
