# Admin Motion Foundation + Approvals Flagship — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dependency-free, compositor-only, reduced-motion-aware motion system for the admin app, proven end-to-end on the approvals inbox (enter stagger, micro-interactions, optimistic row exit, success toast, inbox-zero moment).

**Architecture:** CSS-first foundation (Tailwind v4 `@theme` tokens + `@keyframes` + a global reduced-motion guard) + a tiny `useExitTransition` hook + a pure reconcile reducer + a toast primitive + animation on the base `Dialog`, then the approvals-inbox choreography.

**Tech Stack:** Next.js 16 App Router (RSC + client components), Tailwind v4 (CSS-first), Vitest, Biome. No animation library.

## Global Constraints

- **Compositor-only:** animate `transform`/`opacity` (and `grid-template-rows` for collapse) — never `top`/`left`/`width`/`height`/`margin`.
- **Reduced-motion:** every animation degrades to instant under `@media (prefers-reduced-motion: reduce)`. Information is never gated behind motion.
- **No new dependency.** No framer-motion/motion/gsap/View-Transitions.
- **Token-driven:** durations/easings come from the `@theme` tokens, never hardcoded ms in components.
- **Additive to shared primitives:** `Dialog` and `ReviewModal` changes must not alter their public props or open/close semantics for existing callers. `ReviewModal` keeps `router.refresh()` on success UNLESS an `onActioned` callback is supplied.
- **Motion character:** `--ease-out-soft` for functional motion; `--ease-overshoot` only for the inbox-zero "moment".

---

### Task 1: Motion tokens, keyframes, reduced-motion guard

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: CSS custom properties `--duration-fast|base|slow`, `--ease-out-soft`, `--ease-overshoot`; keyframes `enter-rise`, `exit-collapse`, `toast-in`, `badge-pop`, `moment-in`, `shimmer`; a global reduced-motion guard. Consumed by every later task.

- [ ] **Step 1: Add motion tokens inside the existing `@theme` block** (globals.css, the block starting at line 16)

```css
  /* Motion — see docs/superpowers/specs/2026-07-11-motion-foundation-approvals-design.md */
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;
  --ease-out-soft: cubic-bezier(0.22, 0.61, 0.36, 1);
  --ease-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);
```

- [ ] **Step 2: Add keyframes + reduced-motion guard at the end of `globals.css`** (top-level, after existing rules)

```css
/* ── Motion keyframes (transform/opacity only) ─────────────────────────── */
@keyframes enter-rise {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes badge-pop {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.15); }
  100% { transform: scale(1); }
}
@keyframes moment-in {
  from { opacity: 0; transform: scale(0.9); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes shimmer {
  from { background-position: -150% 0; }
  to   { background-position: 250% 0; }
}

/* Utility helpers used by the approvals flagship + primitives. */
.u-enter-rise { animation: enter-rise var(--duration-base) var(--ease-out-soft) both; }
.u-moment-in  { animation: moment-in var(--duration-slow) var(--ease-overshoot) both; }
.u-badge-pop  { animation: badge-pop var(--duration-base) var(--ease-out-soft); }
/* Row exit: a grid wrapper collapses 1fr→0fr so height animates cheaply. */
.u-collapse-wrap { display: grid; grid-template-rows: 1fr; transition: grid-template-rows var(--duration-base) var(--ease-out-soft), opacity var(--duration-base) var(--ease-out-soft); }
.u-collapse-wrap > * { overflow: hidden; }
.u-collapse-wrap[data-exiting='true'] { grid-template-rows: 0fr; opacity: 0; }
/* Shimmer loading sweep. */
.u-shimmer { background-image: linear-gradient(90deg, transparent 0%, rgb(0 0 0 / 0.04) 50%, transparent 100%); background-size: 200% 100%; animation: shimmer 1.1s linear infinite; }

/* ── Reduced-motion: degrade everything to instant ─────────────────────── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 3: Verify build + lint**

Run: `npx biome check src/app/globals.css && npx tsc --noEmit`
Expected: clean. (CSS has no unit test; correctness is verified visually in Task 6's smoke.)

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(motion): motion tokens, keyframes, and reduced-motion guard"
```

---

### Task 2: exit-controller (pure) + useExitTransition hook + reconcile reducer + tests

The tests run in the existing **node** Vitest env — there is **no
`@testing-library/react`/`jsdom`, and adding one is out of scope** (no-new-dep
constraint). So the timing logic lives in a **pure controller** (node-testable
with fake timers) and the React hook is a thin, untested binding (covered by the
Task 6 browser smoke).

**Files:**
- Create: `src/lib/motion/exit-controller.ts`
- Create: `src/lib/motion/exit-controller.test.ts`
- Create: `src/lib/motion/use-exit-transition.ts`
- Create: `src/lib/motion/approvals-reconcile.ts`
- Create: `src/lib/motion/approvals-reconcile.test.ts`

**Interfaces:**
- Produces:
  - `createExitController(opts?): ExitController` — pure, no React. `beginExit(key, onDone)` marks `key` exiting for `durationMs` (default 200) then fires `onDone` and un-marks; a repeat `beginExit` for an already-exiting key is ignored; `reducedMotion: true` fires `onDone` synchronously; `subscribe(cb)` + `version()` drive the hook.
  - `useExitTransition(opts?): { isExiting(key): boolean; beginExit(key, onDone): void }` — thin hook binding the controller via `useSyncExternalStore`; defaults `reducedMotion` from `matchMedia`.
  - `reconcileApprovals(prev, incoming, removed, exiting, keyOf): T[]` — pure reducer. Rules: drop any `incoming` whose key ∈ `removed`; keep `incoming` order; **preserve a `prev` row that is mid-exit** (key ∈ `exiting`, ∉ `removed`, ∉ kept) so a background refresh can't cancel its collapse; never resurrect a `removed` key.
- Consumed by Task 6 (all) and Tasks 3/4 (hook).

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/motion/approvals-reconcile.test.ts
import { describe, expect, it } from 'vitest';
import { reconcileApprovals } from './approvals-reconcile';

type Card = { type: string; id: string };
const c = (id: string): Card => ({ type: 't', id });
const keyOf = (x: Card) => `${x.type}:${x.id}`;
const keys = (xs: Card[]) => xs.map(keyOf);
const NONE = new Set<string>();

describe('reconcileApprovals', () => {
  it('passes through incoming when nothing removed/exiting', () => {
    expect(keys(reconcileApprovals([c('a'), c('b')], [c('a'), c('b')], NONE, NONE, keyOf)))
      .toEqual(['t:a', 't:b']);
  });
  it('drops a removed key even if the server prop still includes it (stale)', () => {
    expect(keys(reconcileApprovals([c('a'), c('b')], [c('a'), c('b')], new Set(['t:b']), NONE, keyOf)))
      .toEqual(['t:a']);
  });
  it('adds a genuinely-new incoming key', () => {
    expect(keys(reconcileApprovals([c('a')], [c('a'), c('d')], NONE, NONE, keyOf)))
      .toEqual(['t:a', 't:d']);
  });
  it('never resurrects a removed key that reappears in incoming', () => {
    expect(keys(reconcileApprovals([], [c('b')], new Set(['t:b']), NONE, keyOf))).toEqual([]);
  });
  it('preserves a mid-exit row the server prop already dropped', () => {
    // b is exiting (not yet removed); server refresh no longer lists it → keep it until its collapse finishes.
    expect(keys(reconcileApprovals([c('a'), c('b')], [c('a')], NONE, new Set(['t:b']), keyOf)))
      .toEqual(['t:a', 't:b']);
  });
});
```

```ts
// src/lib/motion/exit-controller.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExitController } from './exit-controller';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createExitController', () => {
  it('marks a key exiting, then fires onDone after durationMs and un-marks', () => {
    const ctl = createExitController({ durationMs: 200 });
    const done = vi.fn();
    ctl.beginExit('a', done);
    expect(ctl.isExiting('a')).toBe(true);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(done).toHaveBeenCalledOnce();
    expect(ctl.isExiting('a')).toBe(false);
  });
  it('ignores a repeat beginExit for an already-exiting key', () => {
    const ctl = createExitController({ durationMs: 200 });
    const d1 = vi.fn();
    const d2 = vi.fn();
    ctl.beginExit('a', d1);
    ctl.beginExit('a', d2);
    vi.advanceTimersByTime(200);
    expect(d1).toHaveBeenCalledOnce();
    expect(d2).not.toHaveBeenCalled();
  });
  it('fires onDone synchronously when reducedMotion is true', () => {
    const ctl = createExitController({ durationMs: 200, reducedMotion: true });
    const done = vi.fn();
    ctl.beginExit('a', done);
    expect(done).toHaveBeenCalledOnce();
    expect(ctl.isExiting('a')).toBe(false);
  });
  it('notifies subscribers and bumps version on state change', () => {
    const ctl = createExitController({ durationMs: 200 });
    const cb = vi.fn();
    ctl.subscribe(cb);
    const v0 = ctl.version();
    ctl.beginExit('a', () => {});
    expect(cb).toHaveBeenCalled();
    expect(ctl.version()).not.toBe(v0);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/motion/`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// src/lib/motion/approvals-reconcile.ts
/**
 * Reconcile the client-owned approvals list against a fresh server `incoming`
 * prop. `removed` = keys already fully removed (their exit finished); `exiting`
 * = keys mid-collapse. Removals are authoritative (never resurrected), and a
 * mid-exit row is preserved even if the server already dropped it so a
 * background refresh can't cancel its animation.
 */
export function reconcileApprovals<T>(
  prev: readonly T[],
  incoming: readonly T[],
  removed: ReadonlySet<string>,
  exiting: ReadonlySet<string>,
  keyOf: (item: T) => string,
): T[] {
  const kept = incoming.filter((i) => !removed.has(keyOf(i)));
  const keptKeys = new Set(kept.map(keyOf));
  const stillExiting = prev.filter((p) => {
    const k = keyOf(p);
    return exiting.has(k) && !removed.has(k) && !keptKeys.has(k);
  });
  return [...kept, ...stillExiting];
}
```

```ts
// src/lib/motion/exit-controller.ts
export type ExitController = {
  beginExit(key: string, onDone: () => void): void;
  isExiting(key: string): boolean;
  exitingKeys(): ReadonlySet<string>;
  subscribe(cb: () => void): () => void;
  version(): number;
};

export function createExitController(opts?: {
  durationMs?: number;
  reducedMotion?: boolean;
}): ExitController {
  const durationMs = opts?.durationMs ?? 200;
  const reduced = opts?.reducedMotion ?? false;
  const exiting = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const subs = new Set<() => void>();
  let ver = 0;
  const emit = () => {
    ver += 1;
    for (const cb of subs) cb();
  };
  return {
    beginExit(key, onDone) {
      if (timers.has(key)) return;
      if (reduced) {
        onDone();
        return;
      }
      exiting.add(key);
      emit();
      const t = setTimeout(() => {
        timers.delete(key);
        exiting.delete(key);
        emit();
        onDone();
      }, durationMs);
      timers.set(key, t);
    },
    isExiting: (key) => exiting.has(key),
    exitingKeys: () => exiting,
    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    version: () => ver,
  };
}
```

```ts
// src/lib/motion/use-exit-transition.ts
'use client';
import { useMemo, useSyncExternalStore } from 'react';
import { createExitController } from './exit-controller';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function useExitTransition(opts?: { durationMs?: number; reducedMotion?: boolean }) {
  const controller = useMemo(
    () =>
      createExitController({
        durationMs: opts?.durationMs,
        reducedMotion: opts?.reducedMotion ?? prefersReducedMotion(),
      }),
    // stable per mount — options are read once
    [],
  );
  useSyncExternalStore(controller.subscribe, controller.version, controller.version);
  return {
    isExiting: controller.isExiting,
    beginExit: controller.beginExit,
    exitingKeys: controller.exitingKeys,
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/lib/motion/`
Expected: PASS (exit-controller 4 + reconcile 5 = 9 tests).

- [ ] **Step 5: tsc + lint + commit**

Run: `npx tsc --noEmit && npx biome check src/lib/motion/`
```bash
git add src/lib/motion/
git commit -m "feat(motion): exit-controller + useExitTransition hook + reconcile reducer"
```

---

### Task 3: Toast primitive + provider

**Files:**
- Create: `src/lib/motion/toast-context.tsx`
- Create: `src/components/ui/toast.tsx`
- Modify: `src/app/(admin)/layout.tsx` (mount `ToastProvider`)

**Interfaces:**
- Consumes: `useExitTransition` (Task 2), tokens/keyframes (Task 1).
- Produces: `ToastProvider` (client), `useToast(): { toast(message: string, variant?: 'success' | 'neutral'): void }`. Consumed by Task 6.

**Spec:**
- `toast-context.tsx` (`'use client'`): a context holding a queue of `{ id: string; message: string; variant }`. `ToastProvider` renders children + a fixed toast stack (`fixed bottom-4 right-4 z-[60] flex flex-col gap-2`, mobile: `bottom-4 inset-x-4`). `useToast()` returns `toast()`, which pushes an item (id via a monotonic counter ref — do NOT use `Math.random`/`Date.now` at module scope; a `useRef(0)` counter is fine in the client provider). Each toast auto-dismisses after 3000ms and on dismiss runs `beginExit(id, () => removeFromQueue(id))`.
- `toast.tsx`: presentational `<Toast>` — `role="status"`, `u-enter-rise`-style entrance via `toast-in` (apply `animation: toast-in var(--duration-base) var(--ease-out-soft) both`), `data-exiting` toggles the exit (opacity+translate). Variants: `success` (green accent) / `neutral` (ink). Match the app's card/surface styling.
- Mount `<ToastProvider>` in `src/app/(admin)/layout.tsx` wrapping the admin content so any admin client component can `useToast()`.

- [ ] **Step 1: Build the provider + toast UI + mount in the admin layout.** Reduced-motion: the toast still appears and auto-dismisses; only the slide is removed (handled globally by the guard + the hook's `reducedMotion` path making exit instant).
- [ ] **Step 2: tsc + lint.** Run: `npx tsc --noEmit && npx biome check src/lib/motion/toast-context.tsx src/components/ui/toast.tsx "src/app/(admin)/layout.tsx"` → clean.
- [ ] **Step 3: Commit.**

```bash
git add src/lib/motion/toast-context.tsx src/components/ui/toast.tsx "src/app/(admin)/layout.tsx"
git commit -m "feat(motion): toast primitive + provider mounted in admin layout"
```

---

### Task 4: Animate the base Dialog

**Files:**
- Modify: `src/components/ui/dialog.tsx`

**Interfaces:**
- Consumes: `useExitTransition` (Task 2), tokens (Task 1). No public prop change.

**Spec:**
- Today `Dialog` does `if (!open) return null;`. Add an internal mount-through-exit so the close animation can play:
  - Track a `rendered` flag: `rendered` becomes true when `open` is true; when `open` flips to false, keep `rendered` true, set `data-exiting` on the panel + backdrop, and unmount after `--duration-base` (reuse `useExitTransition` keyed on a constant like `'dialog'`, or a local `setTimeout` mirror). Return `null` only when `!open && !rendered`.
  - Backdrop: `animation: <fade-in>` on enter; `data-exiting` fades it out. (Add a `dialog-backdrop-in` keyframe in Task 1 if you prefer, or animate `opacity` via a transition on a `data-open` attribute — either is fine; keep it token-driven.)
  - Panel enter: `opacity 0→1` + `scale(.98)→1` via `--ease-out-soft` (a `dialog-panel-in` keyframe, or transition on a `data-open` attribute). Exit reverses.
- **Do NOT change:** the `open`/`onClose`/`dismissable`/`title`/`className` props, the Esc/backdrop close, the body-scroll lock, or the focus-on-open behavior (those effects stay keyed on `open`). The scroll-lock cleanup already runs when `open` flips false — good, scroll unlocks while the exit plays.
- Verify existing callers still open/close correctly: `ConfirmDialog`, `ReviewModal`, and the mobile `FilterBar` sheet.

- [ ] **Step 1: Implement the animated Dialog** per the spec, reduced-motion aware (guard makes it instant).
- [ ] **Step 2: tsc + lint + a fast manual check** that `ConfirmDialog`/`ReviewModal` still open and close (Task 6 smoke covers the visual polish).
- [ ] **Step 3: Commit.**

```bash
git add src/components/ui/dialog.tsx
git commit -m "feat(motion): animate base Dialog enter/exit + backdrop (additive)"
```

---

### Task 5: `ReviewModal` onActioned wiring (+ 3 modal wrappers)

**Files:**
- Modify: `src/components/ui/review-modal.tsx`
- Modify: `src/app/(admin)/admin/leave/leave-review-modal.tsx`
- Modify: `src/app/(admin)/admin/advance/advance-review-modal.tsx`
- Modify: `src/app/(admin)/admin/approvals/disputed-review-modal-lite.tsx`

**Interfaces:**
- Produces: an additive optional `onActioned?: () => void` prop on `ReviewModal` and on all three wrapper modals. Consumed by Task 6.

**Spec:**
- In `review-modal.tsx`, the success path is (around lines 85–94): `onClose()` then `router.refresh()`. Change to: on success, `onClose()`; then **if `onActioned` is provided, call `onActioned()` INSTEAD of `router.refresh()`; otherwise `router.refresh()` as today.** This preserves every existing caller (none pass `onActioned`) and lets the approvals list opt into optimistic handling.
- Add `onActioned?: () => void` to `ReviewModal`'s `Props` and thread it: each wrapper (`LeaveReviewModal`, `AdvanceReviewModal`, `DisputedReviewModalLite`) accepts an optional `onActioned` and forwards it to `ReviewModal`.
- No other behavior change. `onActioned` fires only on a successful approve/reject (the same branch that currently calls `router.refresh()`).

- [ ] **Step 1: Add + thread the prop; guard the refresh vs. onActioned branch.**
- [ ] **Step 2: tsc + lint** (verify existing callers on the leave/advance/calendar pages still typecheck — the prop is optional). Run the leave/advance-related unit/integration tests if any reference these modals: `npx vitest run` (unit) to confirm no regression.
- [ ] **Step 3: Commit.**

```bash
git add src/components/ui/review-modal.tsx "src/app/(admin)/admin/leave/leave-review-modal.tsx" "src/app/(admin)/admin/advance/advance-review-modal.tsx" "src/app/(admin)/admin/approvals/disputed-review-modal-lite.tsx"
git commit -m "feat(motion): ReviewModal onActioned hook (opt-in, replaces refresh)"
```

---

### Task 6: Approvals inbox choreography

**Files:**
- Modify: `src/app/(admin)/admin/approvals/approvals-list.tsx`
- Modify: `src/app/(admin)/admin/approvals/page.tsx` (move empty-state into the client list)

**Interfaces:**
- Consumes: `useExitTransition`, `reconcileApprovals` (Task 2), `useToast` (Task 3), the animated `Dialog` (Task 4), the `onActioned` prop (Task 5), tokens/keyframes/utilities (Task 1).

**Spec (build on the existing `approvals-list.tsx`):**
- **List-owner state:** `const [items, setItems] = useState(() => cards)`; a `removed` ref (`useRef(new Set<string>())`); `const { isExiting, beginExit, exitingKeys } = useExitTransition()`. Key helper `keyOf = (c) => `${c.type}:${c.id}``. A sync effect on the `cards` prop: `setItems((prev) => reconcileApprovals(prev, cards, removed.current, exitingKeys(), keyOf))` (handles filter-driven prop changes + the post-refresh reconcile without cancelling a mid-exit row).
- **Active card tracking:** when `open(card)` runs, record `activeKeyRef.current = keyOf(card)` so the modal's `onActioned` (zero-arg) knows which row to exit.
- **Optimistic exit:** pass `onActioned={handleActioned}` to all three modals. `handleActioned = () => { const key = activeKeyRef.current; if (!key || isExiting(key)) return; beginExit(key, () => { removed.current.add(key); setItems((xs) => xs.filter((c) => keyOf(c) !== key)); router.refresh(); }); }`. Note the ordering: the row is added to `removed` and the background `router.refresh()` fires **inside `onDone`, after the collapse finishes** — so the refresh's reconcile can't cancel the in-flight animation, `removed` keeps the row from resurrecting, and surviving rows keep stable keys (React doesn't remount them → no re-stagger). Guard re-entry with `isExiting(key)`.
- **Enter stagger:** each `<li>` gets `className="… u-enter-rise"` + `style={{ animationDelay: `calc(${Math.min(index, 8)} * 40ms)` }}`.
- **Micro-interactions:** the card button gets hover-lift (`transition hover:-translate-y-px hover:shadow-sm`) + `active:scale-[0.99]` (swift; all transform, token-timed via a `transition-[transform,box-shadow] duration-[var(--duration-fast)]` utility or the bare `transition` already present).
- **Row exit wrapper:** wrap each `<li>`'s content in the `u-collapse-wrap` element and set `data-exiting={isExiting(key)}` so removal animates the collapse.
- **Loading beat:** when `loadingId === card.id`, render the `u-shimmer` sweep on the row instead of the plain "กำลังโหลด…".
- **Toast:** in `handleActioned`, call `toast('อัปเดตคำขอแล้ว', 'success')` (or split approve/reject copy if the modal reports which — keep it simple: one success message).
- **Inbox-zero moment + empty state:** move the empty-state markup from `page.tsx` (the `cards.length === 0` branch) into `ApprovalsList`; render it when `items.length === 0` with `className="… u-moment-in"`. `page.tsx` always renders `<ApprovalsList …>` now (remove its own empty-state branch); no data change.
- **Live count:** show the live `items.length` in a small list header (e.g. "รออนุมัติ N รายการ") with `u-badge-pop` applied on change (toggle a key or a brief class). The server-derived `PageHeader` title count in `page.tsx` stays as-is (it will reflect the new total on next navigation) — do not try to mutate it from the client.

- [ ] **Step 1: Rewire `approvals-list.tsx`** per the spec (list-owner state, stagger, micro-interactions, exit wrapper, shimmer, onActioned/optimistic exit, toast, empty-state + moment, live count).
- [ ] **Step 2: Move the empty state** out of `page.tsx` into the list; `page.tsx` renders `<ApprovalsList>` unconditionally. Keep the `capped` notice in `page.tsx`.
- [ ] **Step 3: tsc + lint.** Run: `npx tsc --noEmit && npx biome check "src/app/(admin)/admin/approvals/"` → clean.
- [ ] **Step 4: Manual browser smoke** (Task-level, on the dev server with a seeded pending inbox): stagger on load; hover/press; open a review modal (animated) → approve → row collapses out + success toast; clear the queue → inbox-zero moment; then a **reduced-motion pass** (DevTools "Emulate prefers-reduced-motion: reduce" or the browser tool's reduced-motion emulation) confirming enter/exit/moment all become instant and no information is lost.
- [ ] **Step 5: Commit.**

```bash
git add "src/app/(admin)/admin/approvals/"
git commit -m "feat(motion): approvals inbox choreography (stagger, optimistic exit, toast, moment)"
```

---

## Done criteria

- `use-exit-transition.test.ts` + `approvals-reconcile.test.ts` green; full `pnpm test` + `pnpm test:integration` green; `npx tsc --noEmit` + `npx biome check` clean.
- The approvals inbox shows: staggered entrance, hover/press feedback, animated modals, optimistic row exit on approve/reject, a success toast, and the inbox-zero moment.
- With `prefers-reduced-motion: reduce`, everything degrades to instant with no lost information (verified in the Task 6 smoke).
- No new dependency; no schema/migration/writes (grep the branch before final review); shared `Dialog`/`ReviewModal` behavior unchanged for existing callers.
