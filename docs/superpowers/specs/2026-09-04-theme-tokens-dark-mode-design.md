# Design — accessible token ramp + toggleable dark mode

Date: 2026-09-04
Status: approved (brainstorming), ready for implementation planning
Branch: `claude/ui-dark-mode` (worktree off `main` @ 8e39c3b)

## Goal

Two outcomes, one colour change:

1. Every text token clears WCAG AA (4.5:1) on the background it actually renders on.
2. A three-state theme toggle — Light / Dark / **System** (default) — that survives
   reload with no flash of the wrong theme.

**Non-goal: any behavioural change.** No component logic, props, data flow, server
actions or queries are touched. The diff is CSS variables, class names, and one new
toggle component.

## Evidence this is built on

Measured on 19 rendered pages (11 admin @1440px, 8 LIFF @375px) against the local
stack, not read from source. Method and traps are in "Measurement" below.

| token | hex | on `#fff` | on canvas `#f6f8fb` | usages | verdict |
|---|---|---|---|---|---|
| ink-1 | `#0f172a` | 17.85 | 16.78 | 240 | pass |
| ink-2 | `#334155` | 10.35 | 9.73 | 243 | pass |
| ink-3 | `#64748b` | 4.76 | **4.47** | 345 | **fails on canvas by 0.03** |
| ink-4 | `#94a3b8` | **2.56** | **2.41** | 180 | **fails everywhere** |
| ink-5 | `#cbd5e1` | **1.48** | **1.40** | 7 | **near-invisible** |

17 distinct contrast failures across admin, 10 across LIFF. The worst user-facing
instance: **"Not checked in yet"** — the primary status on the worker check-in
screen — renders at 2.56:1.

Verified separately: with the phone in dark mode the LIFF pages render fully light,
because `globals.css` pins `color-scheme: light`.

## Decisions taken

| # | Decision | Chosen |
|---|---|---|
| 1 | Surfaces in scope | Both; LIFF sequenced first |
| 2 | Theme persistence | Cookie, 3-state, SSR-stamped |
| 3 | Palette mechanism | Redefine variables + enumerated exceptions |
| 4 | Ink ramp | A′ — keep ink-1/ink-2, open room below them |
| 5 | Tap targets / typography / icons | Deferred to a separate pass |

## The constraint that shaped the ramp

Two AA-passing greys on a light canvas are only ~1.7% lightness apart — the same
colour to the eye. The current five-level ink hierarchy and WCAG AA are therefore
mutually exclusive. A′ resolves it by darkening ink-3 to open room for a compliant
ink-4 beneath it.

### Light — three values move

| token | from | to | on canvas |
|---|---|---|---|
| ink-1 | `#0f172a` | unchanged | 16.78 |
| ink-2 | `#334155` | unchanged | 9.73 |
| ink-3 | `#64748b` | `#4d5a6b` | 4.47 → **6.60** |
| ink-4 | `#94a3b8` | `#657284` | 2.41 → **4.60** |
| ink-5 | `#cbd5e1` | unchanged | retired from text |

`ink-5`'s 7 text usages re-point to `ink-4`. Its 3 non-text usages (2 checkbox
borders, 1 legend swatch) stay.

**Accepted cost:** secondary text darkens across 345 usages. The app reads more
solid and less airy. This is visible on every screen and is intended.

## `surface-hover` — two new tokens, and why they are required

`bg-surface-muted` is used 68× as a hover state and 57× as a static recessed fill.
`bg-surface-sunken` is 25× and 25×. In light mode "slightly darker than white"
serves both meanings. Inverting breaks the coincidence:

- a hover on a dark card must go **lighter**, or the element vanishes under the cursor
- a recessed panel inside a dark card must go **darker**

One variable cannot be both, and 93 usages depend on it being both.

**Resolution:** add **two** hover tokens, not one. There are two distinct hover
values today and collapsing them would silently restyle 25 hover states in light
mode:

| new token | light value | seeded from | dark value |
|---|---|---|---|
| `--color-surface-hover` | `oklch(98.5% 0.002 247.839)` | today's `surface-muted` | `#292d32` (L 29.5) |
| `--color-surface-hover-strong` | `oklch(96.7% 0.003 264.542)` | today's `surface-sunken` | `#313439` (L 32.5) |

Because each is seeded with the exact value it replaces, **light mode is
byte-identical**. Migration is two exact string replacements:

- `hover:bg-surface-muted` -> `hover:bg-surface-hover` (68)
- `hover:bg-surface-sunken` -> `hover:bg-surface-hover-strong` (25)

Static (non-hover) `bg-surface-muted` (57) and `bg-surface-sunken` (25) are left
untouched and keep their recessed meaning in both themes.

## Dark palette (derived, not eyeballed)

Elevation is expressed as lightness, per the existing note in `globals.css`.
Separation between surfaces is measured as perceptual ΔL, not WCAG ratio — the
ratio formula compresses badly at low luminance and reports 1.03 for steps that
are plainly visible.

```
--color-surface-sunken:       #0b0d12   L 16.0
--color-canvas:               #101317   L 18.5   ΔL 2.5
--color-surface-muted:        #1a1d22   L 23.0   ΔL 4.5
--color-surface:              #22252a   L 26.5   ΔL 3.5
--color-surface-hover:        #292d32   L 29.5   ΔL 3.0
--color-surface-hover-strong: #313439   L 32.5   ΔL 3.0
--color-line-soft:            #2d3135
--color-line:                 #3a3d42
--color-line-strong:          #52565b
--color-ink-1:                #e9f0f9
--color-ink-2:                #c7ced7
--color-ink-3:                #a7adb5
--color-ink-4:                #979da5
--color-ink-5:                #6e7277   (non-text)
```

Every ink level is checked against `surface-hover-strong`, the **lightest**
surface and therefore the worst case for light text. All four clear AA there
(10.89 / 7.88 / 5.53 / 4.57).

**No surface may exceed L 32.95.** That is the hard ceiling at which `ink-4`
(`#979da5`) still reaches 4.5:1. It is a real constraint, not a preference: an
early draft put `surface-hover-strong` at L 36 and ink-4 silently dropped to
3.99. Any future surface added to this palette must be checked against it.

### Status ramps in dark

Rule: soft tints (50/100/200) become dark but sit **above** both canvas and
surface so alert blocks read as blocks; text tones (700/800/900) become light;
solid fills (500/600) are solved so white text clears AA.

Verified: 14 real alert pairs the app renders all pass, lowest 6.43. All 20 solid
fills pass with white text. Soft tints sit 1.23–1.28 above `surface`.

The full generated table lives in `scripts/derive-theme-tokens.mjs`, committed
alongside this design. The hex values are **outputs, not inputs** — the script is
the source of truth, so the ramp can be re-derived and re-verified rather than
hand-maintained.

`gray-100` / `gray-700` are 2 leftover raw usages from the earlier token
migration. They are re-pointed at `line-soft` / `ink-2` rather than re-derived.

## Theme mechanism

```css
:root { /* complete light palette */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark overrides */ }
}
:root[data-theme="dark"] { /* dark overrides */ }
```

- **System (default)** resolves entirely in CSS. No cookie read, no script, no
  hydration — so the default case has structurally zero flash.
- **Explicit light/dark** writes a `theme` cookie; the root layout reads it during
  SSR and stamps `data-theme` on `<html>` before the first byte.
- `:not([data-theme="light"])` is what lets an explicit Light choice win on a
  dark OS. Without it the override only works one way.
- `color-scheme` is set to match so native controls and scrollbars follow.

The two dark blocks are necessarily duplicated (a rule cannot span a media query).
A test asserts both declare an identical variable set, mirroring the existing
stub-locale drift test (`2e3ea30`).

### Toggle

Three-state control (Light / Dark / System). Placed in the admin topbar, and in
the LIFF utility bar beside `LanguageSwitcher`. Writes the cookie and refreshes;
no client theme provider, no context.

## Explicitly excluded

- `bg-white/10` and friends on the blue hero — translucent scrims, not surfaces.
  They stay literal, per the existing comment.
- LIFF tap targets (16px-tall links, 32×32 arrows), sub-12px text, and the
  emoji-vs-lucide icon split. Real findings, deferred: they change layout, and
  mixing layout regressions into a colour diff makes attribution impossible.

## Measurement, and how it misled me

The audit harness produced three false results before it produced true ones. All
three are recorded because the same traps apply to verifying the implementation.

1. **Gradients read as transparent.** Walking only `background-color` missed
   `linear-gradient(...)` on the KPI hero and reported white-on-canvas at 1.06:1.
   White on that deep blue is ~9:1. Six of twelve initial findings were fake.
2. **`lab()` silently unparsed.** Tailwind v4's palette is OKLCH; browsers report
   it as `lab()`. An `rgba()` regex dropped it, so every palette-coloured
   background was treated as transparent. Fixed by parsing through a canvas 2D
   context — the browser converts, not the regex.
3. **A swallowed exception read as a clean bill of health.** A `catch {}` hid
   `__mkAudit is not a function` across all 8 LIFF pages and returned empty
   arrays, which are indistinguishable from "no failures". Nearly reported the
   worker surfaces as perfect.

**Rule for implementation:** the harness reports `scanned` and `measured` counts
per page, and records errors instead of discarding them. A zero-failure result is
only believable alongside a non-zero measured count.

## Verification plan

1. **Light mode is a no-op except the 3 deliberate ink values.** Capture audit
   output on all 19 pages before the change; re-run after; diff. The only
   permitted deltas are ink-3, ink-4 and the ink-5 text re-points.
2. **Dark mode passes AA.** Same 19 pages with `prefers-color-scheme: dark`
   emulated, plus `data-theme="dark"` forced. Zero contrast failures expected.
3. **Both dark blocks agree.** Unit test on the variable sets.
4. **No functional change.** Full existing gate: biome, tsc, unit, integration.
   No test should need modification; if one does, that is a signal the change was
   not purely presentational.

## Open questions

None blocking. The deferred layout pass has its own findings recorded above.
