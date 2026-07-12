# Admin Motion Foundation + Approvals Inbox Flagship — Design

**Date:** 2026-07-11
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with Claude

## Summary

Introduce a small, cohesive **motion system** for the admin app and prove it
end-to-end on one flagship surface — the **approvals inbox**. The system is
CSS-first (Tailwind v4 `@theme` tokens + `@keyframes`), compositor-only
(transform/opacity), dependency-free, and **reduced-motion-aware by default**.
Character is **balanced**: swift and restrained for functional feedback, with a
single expressive "moment" beat reserved for a milestone (inbox zero).

The goal is to make the admin UI feel more responsive, polished, and
professional without adding a motion library, without hurting performance, and
without over-animating a daily-use power-user tool.

## Context (what exists today)

- **Stack:** Next.js 16 App Router (RSC + client components), Tailwind **v4**
  (CSS-first config; no `tailwind.config.js`), Biome, Vitest. **No animation
  library** (no framer-motion/motion/gsap).
- **Motion today:** essentially none by design — ~53 bare hover `transition`
  classes, a few `animate-spin`/`animate-pulse` loaders. **No motion tokens** (no
  shared durations/easings), **no enter/exit animations**, **no
  `prefers-reduced-motion` handling anywhere** (accessibility gap).
- **Design system:** "Sapphire Editorial" with a rich static primitive library
  (`dialog`, `confirm-dialog`, `tabs`, `stat-card`, `kpi-hero`, `progress-ring`,
  `status-badge`, `empty-state`, …). **No toast primitive** — feedback is static
  inline banners (e.g. "บันทึกเรียบร้อย").
- **Approvals inbox** (`src/app/(admin)/admin/approvals/`):
  - `page.tsx` (server) loads pending `cards` + `canReview` flags → renders
    `<ApprovalsList cards canReview />`.
  - `approvals-list.tsx` (**client**) renders `<ul className="space-y-2">` of
    `<li className="surface px-4 py-3">` clickable cards. Clicking loads a review
    VM via a server action and opens one of three shared modals
    (`LeaveReviewModal`, `AdvanceReviewModal`, `DisputedReviewModalLite`).
    Approve/reject happens **inside the modal**, today followed by
    `router.refresh()` — a hard list swap with no animation. `loadingId` tracks
    the card whose modal is loading.

## Decisions

1. **CSS-first, no library.** Motion tokens + `@keyframes` + a ~30-line
   `useExitTransition` hook. Chosen for performance (GPU-composited
   transform/opacity, zero bundle, no main-thread animation loop) and
   maintainability (tokens in one place, one small clever piece).
2. **Balanced character, two easings.** `--ease-out-soft` for functional motion;
   `--ease-overshoot` for the single "moment" beat. No physics engine — the
   springy feel is a cubic-bezier.
3. **Reduced-motion is a first-class, global guard** — not per-component. All
   motion degrades to instant; information is unchanged.
4. **Depth-first flagship.** Apply the full treatment to the approvals inbox
   (lists + actions + feedback + removal) before any breadth rollout.
5. **Optimistic removal owns the list.** `ApprovalsList` becomes the list owner
   (state seeded from props); approve/reject animates the row out locally rather
   than blind-refreshing. Local removals are authoritative.
6. **Foundation improvements land on shared primitives** (base `Dialog`, new
   `Toast`) so the house style is reusable, but only the approvals surface is
   choreographed in this slice.

## Non-goals (explicit YAGNI)

- No motion library (framer-motion/motion/gsap) and no View Transitions API.
- No reorder/FLIP animation (the inbox doesn't need it).
- No route transitions, skeleton loaders, or top navigation progress bar — those
  are the later breadth phases ("perceived performance").
- No count-up numbers, no sidebar-badge animation outside the approvals count.
- Toast primitive stays minimal (success/neutral, one position) — not a full
  notification center.
- No redesign of the approvals layout, data, or server actions — this is a
  presentation/motion layer only.

## Architecture

### Foundation (reusable, app-wide)

**Motion tokens — `src/app/globals.css` `@theme`:**
```css
@theme {
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;
  --ease-out-soft: cubic-bezier(0.22, 0.61, 0.36, 1);
  --ease-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

**Keyframes — `globals.css` (transform/opacity only):**
- `enter-rise` — `opacity 0→1`, `translateY(6px)→0`.
- `exit-collapse` — `opacity 1→0`, `translateY(0→-4px)`, and height via a
  `grid-template-rows: 1fr→0fr` wrapper (row is wrapped in a
  `display:grid; grid-template-rows:1fr` element whose child has
  `overflow:hidden`; exiting sets `0fr`) so collapse stays cheap.
- `toast-in` — `translateY(8px)→0` + fade.
- `badge-pop` — `scale(1)→1.15→1` (short).
- `moment-in` — `scale(.9)→1` + fade, on `--ease-overshoot`.
- `shimmer` — background-position sweep for the loading beat.

**Reduced-motion guard — `globals.css`:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```
(The hook also reads `matchMedia('(prefers-reduced-motion: reduce)')` to skip the
mount-through-exit delay so removals are instant, not merely fast.)

**`useExitTransition` — `src/lib/motion/use-exit-transition.ts`:**
- Given a list of keyed items and a set of "exiting" keys, keeps an exiting item
  mounted for `duration` (default `--duration-base`), applying an `data-exiting`
  attribute the CSS targets, then calls back to drop it. Honors reduced-motion
  (duration → 0). Pure, unit-testable (fake timers).
- Signature (illustrative):
  ```ts
  function useExitTransition<T>(opts: {
    durationMs?: number;
    reducedMotion?: boolean; // injectable for tests; defaults to matchMedia
  }): {
    isExiting: (key: string) => boolean;
    beginExit: (key: string, onDone: () => void) => void;
  };
  ```

**Toast primitive — `src/components/ui/toast.tsx` + `src/lib/motion/toast-context.tsx`:**
- `ToastProvider` (mounted in the admin layout) + `useToast()` returning
  `toast(message, variant?)`. Renders a fixed stack; each toast enters with
  `toast-in`, auto-dismisses after ~3s, exits via `useExitTransition`. Variants:
  `success` | `neutral`. Reduced-motion: appears/disappears instantly, still
  visible for the dismiss window.

**Animated `Dialog` — `src/components/ui/dialog.tsx`:**
- Add enter (scale `.98→1` + fade) / backdrop fade / exit to the existing
  primitive using the tokens. All modals (three review modals, confirm-dialog,
  month-picker, etc.) inherit it. Must not change the Dialog's API or
  open/close semantics — additive styling only; verify existing callers.

### Application (approvals inbox only)

**`approvals-list.tsx`:**
- **List owner:** `const [items, setItems] = useState(cards)` seeded from props;
  a sync effect merges server prop changes (add genuinely-new cards by key; never
  re-add a key that is exiting or already removed locally). Keyed by
  `${type}:${id}`.
- **Enter stagger:** each `<li>` plays `enter-rise` with
  `style={{ animationDelay: 'calc(var(--i) * 40ms)' }}` where `--i = min(index, 8)`.
- **Micro-interactions:** card gets hover-lift + `active:scale-[0.99]` (swift).
- **Loading beat:** the `loadingId` card shows a `shimmer` sweep instead of the
  plain "กำลังโหลด…".
- **Optimistic exit:** each review modal gains an **`onActioned?: (cardId: string) => void`**
  prop (additive — existing callers pass nothing and are unaffected). On
  approve/reject success the modal calls it; `ApprovalsList` runs
  `beginExit(key, () => setItems(drop))` → row plays `exit-collapse` then
  unmounts. **The modal must NOT itself force a full-list `router.refresh()` on
  success when `onActioned` is wired** — that would hard-swap the list and cancel
  the exit animation. The signal path is: modal success → `onActioned(cardId)` →
  list animates the row out. `ApprovalsList` then fires one **background**
  `router.refresh()` (after the exit completes) to reconcile server-derived data
  (e.g. sidebar counts); the sync effect keeps local removals authoritative so
  that refresh cannot resurrect the removed row or re-trigger the enter stagger
  on surviving rows.
- **Toast:** on success, `toast('อนุมัติคำขอแล้ว' | 'ปฏิเสธแล้ว', 'success')`.
- **Inbox-zero moment:** when `items.length` reaches 0, the empty state renders
  with `moment-in` (overshoot). (The empty state currently lives in `page.tsx`
  when `cards.length === 0`; since the list is now client-owned, the empty state
  moves into `ApprovalsList` so it can react to local removals.)
- **Count sync:** the visible count decrements as rows leave; the count element
  plays `badge-pop` on change. (The `PageHeader` title count in `page.tsx` is
  server-derived and will lag until refresh — acceptable; the in-list count is
  the live one. Alternatively the count moves into the client list. Decision:
  keep the header title as-is, show the live count in the list header row.)

## Reconciliation rules (the one delicate piece)

`ApprovalsList` local state vs. incoming server `cards` prop:
- **Key** = `${type}:${id}`.
- On action: add key to `exiting`; after exit, remove from `items` and record in
  a `removed` set.
- Sync effect on new `cards` prop: `next = cards.filter(c => !removed.has(key(c)))`;
  preserve currently-exiting rows until their animation completes; add any new
  keys not previously seen. A card can never be resurrected once in `removed`.
- Guard against double-action (ignore `beginExit` for a key already exiting/removed).

## Reduced-motion behavior (explicit)

With `prefers-reduced-motion: reduce`: enter/stagger/exit/shimmer/overshoot all
collapse to instant (rows appear/disappear with no movement, modals open without
scale, the moment beat is a plain swap). Toasts still appear and auto-dismiss
(no slide). Information and timing-of-availability are unchanged; only motion is
removed.

## Testing

- **Unit:**
  - `useExitTransition` — mounts an exiting key through `durationMs` then fires
    `onDone`; with `reducedMotion: true`, fires immediately; ignores a second
    `beginExit` for an already-exiting key (fake timers).
  - Reconciliation reducer (extracted pure) — optimistic removal wins over a
    stale prop; a genuinely-new server card is added; a `removed` key is never
    re-added; an exiting row survives until its timer completes.
- **Integration:** none new — server actions/data are unchanged.
- **Manual/browser (flagship smoke):** stagger on load; hover/press; open a
  review modal (animated) → approve → row `exit-collapse` + success toast; clear
  to zero → inbox-zero moment; **reduced-motion pass** (emulate
  `prefers-reduced-motion: reduce`) confirming everything degrades to instant.

## Files

**New**
- `src/lib/motion/use-exit-transition.ts` (+ `use-exit-transition.test.ts`).
- `src/lib/motion/approvals-reconcile.ts` — the pure reconciliation reducer
  (+ `approvals-reconcile.test.ts`). (Extracted so it's testable without React.)
- `src/lib/motion/toast-context.tsx` — `ToastProvider` + `useToast`.
- `src/components/ui/toast.tsx` — toast UI.

**Modified**
- `src/app/globals.css` — `@theme` motion tokens, keyframes, reduced-motion guard.
- `src/components/ui/dialog.tsx` — enter/exit/backdrop animation (additive).
- `src/app/(admin)/…/admin layout` — mount `ToastProvider`.
- `src/app/(admin)/admin/approvals/approvals-list.tsx` — list-owner state,
  stagger, micro-interactions, optimistic exit, toast, inbox-zero moment, count.
- `src/app/(admin)/admin/approvals/page.tsx` — move the empty state into the
  client list (or pass an empty-state slot); no data change.
- The three review modals — add the additive `onActioned?` callback prop.

## Phase 2 (deferred, no rework implied)

- Perceived-performance breadth: skeleton loaders, top navigation progress bar,
  route transitions.
- Micro-interaction polish pass across all admin pages using the same tokens.
- Data/dashboard motion: stat-card count-up, progress-ring fill, sidebar-badge
  changes.
- Richer toast (variants, actions, positions) if a real need emerges.
