# Page fade-in on admin navigation — Design

**Date:** 2026-07-31
**Status:** Implemented
**Author:** brainstormed with Claude

## Summary

Give every `(admin)` and `(owner)` page a subtle fade-and-rise entrance on
navigation, matching the POS prototype's `.fade-page`.

Six files, no new dependency. The animation already exists in `globals.css` —
this spec is about **where it attaches** so it replays on route change without
disturbing the sidebar, topbar, or toasts.

The design originally aimed for zero JavaScript via `template.tsx`; that was
measured not to work on Next 16 (see below) and the shipped version is a
one-hook client wrapper instead.

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

A client component wraps the layout's `{children}` in a `<div>` keyed on the
pathname. When the key changes React drops the old node and mounts a new one,
and a fresh DOM node restarts the CSS animation — POS's `view`-switch mechanism
expressed in App Router terms.

```
(admin)/layout.tsx           Sidebar, Topbar, ToastProvider, NextIntlClientProvider
  └─ <PageFade>              NEW — keyed div, replaced per navigation
       └─ settings/layout.tsx     sticky sub-nav — held still
            └─ <SectionFade>      NEW — keyed div, fades the content column
                 └─ page.tsx
```

Six files:

```
src/app/globals.css            +4 lines   .u-enter-page
src/lib/motion/page-fade.tsx   new        PageFade + SectionFade
(admin)/layout.tsx             +2 lines   covers 58 pages
(owner)/layout.tsx             +2 lines   covers 1 page
admin/settings/layout.tsx      +2 lines   sub-nav holds still
admin/reports/layout.tsx       +2 lines   sub-nav holds still
```

Every future page under either group inherits the entrance with no further work.

### Why not `template.tsx` — measured, not assumed

This design originally specified `template.tsx`, which Next documents as
re-instantiating on every navigation. **It does not work here, and it fails
silently:** the animation plays on first load and never again, so clicking
around casually looks correct.

Measured on Next 16.0 / React 19 by stamping the wrapper node before a
`/admin` → `/admin/employees` navigation:

```
BEFORE:    data-probe="A"   enter-rise currentTime 108ms   (mid-flight)
AFTER NAV: data-probe="A"   enter-rise currentTime 320ms   (finished, same node)
```

The marker survived, so the node was never replaced. A template placed at a
route-group level is re-keyed only when its own segment changes, and `(admin)`
never changes while navigating within the admin area.

The keyed wrapper does not depend on that behaviour — we own the key. The cost
is one client component, with `children` passed as a prop so the server
components inside are unaffected by the boundary.

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

### The wrapper

```tsx
// src/lib/motion/page-fade.tsx
'use client';
import { usePathname } from 'next/navigation';

export function PageFade({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div key={pathname} className="u-enter-page">{children}</div>;
}
```

Both layouts wrap their `{children}` with it:

```tsx
<main className="min-w-0 flex-1">
  <PageFade>{children}</PageFade>
</main>
```

Query-string changes (filters, pagination) leave the pathname alone and stay
silent — see the trade-offs below.

### Sections that own their chrome

Two sections render a sticky sub-nav from their *layout*, which should hold
still while you move between its tabs:

| Section | Layout chrome |
|---|---|
| `/admin/settings` | sticky `SettingsNav` aside |
| `/admin/reports` | `PageHeader` + `ReportTabs` strip |

`attendance` and `payroll` look like they belong here but do not: their layouts
are pass-throughs, and those tab strips are rendered by the pages, so they are
content and correctly fade with it.

For the two that qualify, `PageFade` collapses its key to the section prefix —
so the area node survives tab switches — and a `SectionFade` inside that
layout, keyed on the full pathname, fades only the content column beside the
sub-nav. Arriving from outside the section still changes the area key, so the
whole thing including the sub-nav fades in on entry.

Each entry in `SECTIONS_WITH_OWN_CHROME` must be paired with a `<SectionFade>`
in that layout. Forget the pairing and the section's pages stop animating
entirely; `page-fade.spec.ts` holds the pairing for `/admin/settings`.

### Why not the alternatives

**Per-page class (59 edits)**, the literal POS approach: no remount side
effects, but a 59-file mechanical diff with nothing stopping the 60th page from
forgetting it.

**`template.tsx`**: measured not to work — see above.

## Preconditions verified

- All 11 layouts under `(admin)` are server components with **zero** client
  hooks (`useState`/`useReducer`/`useRef`), so remounting them inside the keyed
  wrapper destroys no state.
- **No `loading.tsx` anywhere** in `(admin)` or `(owner)`, and the only
  `Suspense` is inside `employee-filters.tsx`, not a page boundary. Pages
  therefore commit fully-rendered and the fade plays on real content, never on
  a skeleton that then pops.
- Playwright's visibility check ignores `opacity`, so mid-fade elements still
  count as visible. The existing 25 functional e2e specs are unaffected.

## Testing

One new spec, `tests/e2e/page-fade.spec.ts`, five tests — all passing.

**The chrome/content split holds.** Stamp a marker on the sidebar DOM node,
client-side navigate between two admin pages, then assert the marker survived
(layout persisted, chrome didn't flash) while the `.u-enter-page` wrapper is a
different node (wrapper replaced, fade replayed). That assertion pair is the
whole design, and it is the test that caught `template.tsx` not working.

**An animation is actually attached**, asserted as a duration over 100ms rather
than pinning the exact token, so retuning `--duration-slow` doesn't fail here.

**Sections keep their chrome.** Switching `/admin/settings/branches` →
`/admin/settings/departments` must leave both the area wrapper and the sticky
sub-nav marked, while replacing the inner content wrapper. A companion test
navigates *into* the section from `/admin` and asserts the area wrapper IS
replaced, so collapsing the key can't silently kill the entrance on entry.

**Reduced motion still wins.** The same page under `reducedMotion: 'reduce'`
(passed via `contextOptions` — Playwright 1.60 dropped the top-level option),
asserting the computed `animation-duration` collapses to ≤1ms.

No unit tests — there is no logic here.

## Accepted trade-offs

- **No exit animation.** The outgoing page vanishes instantly. This is what
  makes the pattern feel fast rather than laggy, and it is what POS shipped.
- ~~Sub-nav re-fades in four sections.~~ **Fixed** — see below. The count was
  also wrong: only two sections have layout-level chrome, not four.
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
