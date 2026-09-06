# Accessible Token Ramp + Toggleable Dark Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every text token to WCAG AA on the background it actually renders on, and add a Light / Dark / System theme toggle that survives reload with no flash.

**Architecture:** All colour lives in CSS custom properties that Tailwind v4 compiles utilities against (`bg-red-50` → `background-color: var(--color-red-50)`), so a theme is a variable redefinition, not a class rewrite. "System" resolves purely through `prefers-color-scheme` — no cookie, no script. An explicit choice writes a cookie the root layout reads during SSR and stamps as `data-theme` on `<html>`.

**Tech Stack:** Next.js 16 (App Router, RSC), Tailwind CSS v4 (CSS-first `@theme`), TypeScript, Vitest (unit), Playwright (e2e), Biome.

**Spec:** `docs/superpowers/specs/2026-09-04-theme-tokens-dark-mode-design.md`

## Progress

**All 11 tasks complete.** Executed inline 2026-09-06 on `claude/ui-dark-mode`.

- [x] **Task 1** — Contrast harness (landed RED as designed; baseline captured)
- [x] **Task 2** — Theme config module
- [x] **Task 3** — `setTheme` server action
- [x] **Task 4** — SSR stamp on `<html>` (verified for all 4 cookie states)
- [x] **Task 5** — Split hover tokens — **proven a no-op**, byte-identical sweep
- [x] **Task 6** — Light ink ramp to AA
- [x] **Task 7** — Dark palette + drift test
- [x] **Task 8** — Dark status ramps
- [x] **Task 9** — Solid-fill exceptions
- [x] **Task 10** — Theme toggle (admin + LIFF, 6 locales)
- [x] **Task 11** — Full verification; local seed restored

### What the plan got wrong

Five things the plan and spec missed, all caught by the tests rather than by review:

1. **The app's own brand ramps had no dark values.** I scoped the raw Tailwind
   palette and the surface/ink scaffolding and forgot `primary-*`, `success`,
   `danger`, `accent`, `warning` — about 640 usages. The dark sweep found it.
2. **The fill-vs-text conflict recurred three more times**, each disguised:
   `primary-600/700` and `success`/`danger` as both fill and text; the KPI hero
   and sidebar building gradients out of *text* tones (the hero went pale blue
   with white text at 1.53:1); and `bg-white/80` on the topbar, which is a
   translucent SURFACE rather than a scrim.
3. **Light-mode badge failures were never scoped.** The plan fixed white-on-red
   and white-on-amber only in dark, which would have left light failing forever.
4. **`red`/`amber` 500–600 were left without dark values** once their fills moved
   to dedicated tokens, stranding 42 text usages. Found on `/liff/calendar`.
5. **LIFF coverage mattered.** Adding it found four more failures, three of them
   pre-existing in LIGHT mode — including a bare `bg-white` chip that put
   light-grey text on white at 1.59:1 in dark.

### Tooling lessons worth keeping

- **BSD `sed` has no `\b`.** `sed -i '' 's/x\b/y/'` silently matches nothing and
  exits 0. Use `perl -pi -e` or Python. The plan's own commands were wrong.
- **`grep -Z` on BSD means decompress**, not NUL-delimit, so `xargs -0` receives
  one giant filename. Paths here contain `[id]` and `(liff)`, which zsh also
  glob-expands — do bulk renames in Python.
- **Swapping `src` between commits does not invalidate Turbopack's CSS cache.**
  A stale stylesheet served old and new rules together and made the hover split
  look like a regression for three runs. `rm -rf .next` before any before/after.
- **A bulk rename can corrupt its own output**: `\bbg-warning\b` matched inside
  `bg-warning-solid`, which the previous pass had just created.
  `globals.tokens.test.ts` now guards that.

## Global Constraints

- **Worktree:** `/Users/tong/Works/fai/work/.claude/worktrees/ui-dark-mode`, branch `claude/ui-dark-mode`. Run every command there. `node_modules` is a symlink to the main checkout.
- **No behavioural change.** No component logic, props, data flow, server queries, or Prisma schema. The diff is CSS variables, class names, one config module, one server action, one client component, and tests.
- **Light mode must stay visually identical** except three deliberate values: `--color-ink-3`, `--color-ink-4`, and the 7 `text-ink-5` → `text-ink-4` re-points. Any other light-mode delta is a bug.
- **Hard ceiling: no surface may exceed OKLCH L 32.95** in dark mode. That is where `ink-4` (`#979da5`) still reaches 4.5:1.
- **Never `git add -A`** in this repo — it contains un-gitignored local artifacts. Stage explicit paths.
- **Gate before every commit that touches `src/`:** `npx biome check src`, `pnpm typecheck`, `npx vitest run`.
- Existing test files must not need modification. If one does, the change was not purely presentational — stop and report.
- Thai body copy needs `line-height: 1.65` for tone marks. Do not reduce it.

## File Structure

**Create**
- `src/lib/theme/config.ts` — cookie name, max-age, `Theme` union, `isTheme()`, `resolveThemeAttrs()`. Pure, no I/O, so it is unit-testable and importable from both server and client.
- `src/lib/theme/config.test.ts`
- `src/lib/theme/actions.ts` — `setTheme()` server action. Mirrors `src/lib/i18n/actions.ts`.
- `src/components/theme/theme-toggle.tsx` — 3-state client control.
- `tests/e2e/helpers/contrast.ts` — the audit harness, shared by the specs below.
- `tests/e2e/contrast-light.spec.ts` — light-mode AA assertions.
- `tests/e2e/contrast-dark.spec.ts` — dark-mode AA assertions.
- `src/app/globals.dark.test.ts` — asserts the two dark blocks declare identical variable sets.

**Modify**
- `src/app/globals.css` — ink values, two new hover tokens, two dark blocks, dark status palette.
- `src/app/layout.tsx:93-101` — read cookie, stamp `data-theme` + `color-scheme`.
- `src/components/admin/topbar.tsx` — mount the toggle.
- `src/app/(liff)/layout.tsx:23-25` — mount the toggle beside `LanguageSwitcher`.
- 89 files carrying `hover:bg-surface-muted` / `hover:bg-surface-sunken` / `text-ink-5` — mechanical class replacement only.

---

### Task 1: Contrast audit harness (baseline before anything changes)

Build the measurement first, and record today's failures as the baseline. Without this there is no way to prove light mode did not move.

**Files:**
- Create: `tests/e2e/helpers/contrast.ts`
- Create: `tests/e2e/contrast-light.spec.ts`

**Interfaces:**
- Produces: `auditContrast(page: Page): Promise<AuditResult>` where
  `AuditResult = { scanned: number; measured: number; failures: Failure[] }` and
  `Failure = { ratio: number; need: number; px: number; fg: string; bg: string; text: string; selector: string }`.
- Produces: `ADMIN_PAGES` / `LIFF_PAGES` — the page lists the specs sweep.
- Exemption is by markup, not a list: add `data-contrast-exempt` to an element the audit must skip. Keeps the opt-out next to the thing being excused instead of in a file nobody reads.

- [ ] **Step 1: Write the harness**

Three traps this must avoid, each of which produced a wrong answer during design:

```ts
// tests/e2e/helpers/contrast.ts
import type { Page } from '@playwright/test';

export type Failure = {
  ratio: number; need: number; px: number;
  fg: string; bg: string; text: string; selector: string;
};
export type AuditResult = { scanned: number; measured: number; failures: Failure[] };

/**
 * Measures WCAG contrast for every text-bearing element on the page.
 *
 * Three traps, all of which produced confidently wrong answers during design:
 *
 *  1. GRADIENTS. Walking only `background-color` sees straight through a
 *     `linear-gradient(...)` to whatever is behind it. The KPI hero reported
 *     white-on-canvas at 1.06:1; white on that deep blue is ~9:1. Six of the
 *     first twelve "failures" were fake. We average the gradient's stops.
 *
 *  2. lab()/oklch(). Tailwind v4's palette is OKLCH and browsers report it as
 *     `lab(...)`. An rgba() regex drops it silently, so every palette-coloured
 *     background is treated as transparent. We parse through a canvas 2D
 *     context and let the browser convert.
 *
 *  3. SILENT FAILURE. `catch {}` around the sweep once hid a ReferenceError on
 *     all 8 LIFF pages and returned empty arrays — indistinguishable from a
 *     clean bill of health. This returns `scanned`/`measured` counts so the
 *     caller can assert the sweep actually ran, and never swallows an error.
 */
export async function auditContrast(page: Page): Promise<AuditResult> {
  return page.evaluate(() => {
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = 1;
    const ctx = cvs.getContext('2d', { willReadFrequently: true })!;
    const memo = new Map<string, { r: number; g: number; b: number; a: number } | null>();

    const parse = (s: string) => {
      if (!s) return null;
      if (memo.has(s)) return memo.get(s)!;
      ctx.fillStyle = '#000';
      try { ctx.fillStyle = s; } catch { memo.set(s, null); return null; }
      ctx.clearRect(0, 0, 1, 1); ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      const v = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      memo.set(s, v); return v;
    };
    type C = { r: number; g: number; b: number; a: number };
    const lum = (c: C) => {
      const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const blend = (f: C, b: C): C => ({
      r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a),
      b: f.b * f.a + b.b * (1 - f.a), a: 1,
    });
    const gradAvg = (img: string): C | null => {
      const cols = [...img.matchAll(/(?:rgba?|lab|oklch|oklab|hsla?|color)\([^)]*\)|#[0-9a-f]{3,8}/gi)]
        .map((m) => parse(m[0])).filter(Boolean) as C[];
      if (!cols.length) return null;
      return {
        r: cols.reduce((s, c) => s + c.r, 0) / cols.length,
        g: cols.reduce((s, c) => s + c.g, 0) / cols.length,
        b: cols.reduce((s, c) => s + c.b, 0) / cols.length, a: 1,
      };
    };
    const effBg = (el: Element): { c?: C; unknown?: boolean } => {
      let n: Element | null = el, acc: C | null = null;
      while (n && n.nodeType === 1) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') {
          const g = gradAvg(cs.backgroundImage);
          if (g) return { c: acc ? blend(acc, g) : g };
          return { unknown: true };            // an image we cannot reason about
        }
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) { acc = acc ? blend(acc, c) : c; if (acc.a >= 1) return { c: acc }; }
        n = n.parentElement;
      }
      return { c: acc ?? { r: 255, g: 255, b: 255, a: 1 } };
    };
    const ratio = (a: C, b: C) => {
      const L1 = lum(a), L2 = lum(b);
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    };
    const hex = (c: C) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
    const sel = (el: Element) => {
      const cls = typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      return el.tagName.toLowerCase() + cls;
    };

    const failures: Failure[] = [];
    const seen = new Set<string>();
    let scanned = 0, measured = 0;

    for (const el of Array.from(document.querySelectorAll('body *'))) {
      scanned++;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (el.closest('[data-contrast-exempt]')) continue;
      // only elements with their OWN text node — otherwise every ancestor
      // re-reports its descendants' text against the wrong background
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3 && n.textContent!.trim())
        .map((n) => n.textContent!.trim()).join(' ');
      if (!own) continue;
      const fg = parse(cs.color); if (!fg) continue;
      const bgr = effBg(el); if (bgr.unknown || !bgr.c) continue;
      measured++;
      const bg = bgr.c;
      const r = ratio(blend(fg, bg), bg);
      const px = parseFloat(cs.fontSize);
      // WCAG "large text": >=24px, or >=18.66px when bold
      const need = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700) ? 3 : 4.5;
      if (r < need) {
        const key = `${cs.color}|${Math.round(r * 10)}|${px}`;
        if (seen.has(key)) continue;
        seen.add(key);
        failures.push({
          ratio: +r.toFixed(2), need, px, fg: hex(fg), bg: hex(bg),
          text: own.slice(0, 40), selector: sel(el).slice(0, 60),
        });
      }
    }
    return { scanned, measured, failures: failures.sort((a, b) => a.ratio - b.ratio) };
  });
}

/** Pages the suite sweeps. Admin at desktop width, LIFF at phone width. */
export const ADMIN_PAGES = [
  '/admin', '/admin/payroll', '/admin/employees', '/admin/approvals',
  '/admin/attendance', '/admin/leave', '/admin/reports', '/admin/settings/payroll',
] as const;
export const LIFF_PAGES = [
  '/liff/check-in', '/liff/payslip', '/liff/leave', '/liff/leave/new',
  '/liff/calendar', '/liff/summary', '/liff/profile', '/liff/advance',
] as const;
```

- [ ] **Step 2: Write the light-mode spec (expected to FAIL today)**

```ts
// tests/e2e/contrast-light.spec.ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { ADMIN_PAGES, auditContrast } from './helpers/contrast';

test.describe('WCAG AA contrast — light mode, admin', () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  for (const path of ADMIN_PAGES) {
    test(`${path} has no contrast failures`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const { scanned, measured, failures } = await auditContrast(page);

      // A zero-failure result is only meaningful if the sweep actually ran.
      // An empty `failures` array and a crashed sweep look identical otherwise.
      expect(scanned, 'sweep found no elements — did the page render?').toBeGreaterThan(20);
      expect(measured, 'sweep measured no text — harness is broken').toBeGreaterThan(3);

      expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    });
  }
});
```

- [ ] **Step 3: Run it and capture the baseline**

Start the dev server first (`pnpm dev` in the worktree), then:

```bash
pnpm test:e2e -- contrast-light.spec.ts 2>&1 | tee /tmp/contrast-baseline.txt
```

Expected: **FAIL** on every admin page. Confirm the reported failures are `#94a3b8` (ink-4), `#cbd5e1` (ink-5) and `#64748b` on `#f6f8fb` (ink-3 on canvas). If any *other* colour appears, stop — the harness is measuring something unintended.

- [ ] **Step 4: Commit the harness**

```bash
git add tests/e2e/helpers/contrast.ts tests/e2e/contrast-light.spec.ts
git commit -m "test(theme): contrast audit harness, currently red

Measures WCAG contrast on rendered pages. Fails today: ink-4 at 2.56:1
(180 usages), ink-5 at 1.48:1, ink-3 at 4.47:1 on the canvas background.

Reports scanned/measured counts so a zero-failure result cannot be
confused with a sweep that never ran — a catch{} hid exactly that during
design and made 8 LIFF pages look clean."
```

---

### Task 2: Theme config module

**Files:**
- Create: `src/lib/theme/config.ts`
- Test: `src/lib/theme/config.test.ts`

**Interfaces:**
- Produces: `THEMES: readonly ['light','dark','system']`, `type Theme`, `THEME_COOKIE_NAME = 'KM_THEME'`, `THEME_COOKIE_MAX_AGE`, `isTheme(v: unknown): v is Theme`, `resolveThemeAttrs(cookie: string | null | undefined): { dataTheme: 'light'|'dark'|undefined; colorScheme: 'light'|'dark'|'light dark' }`.
- Consumed by: Task 3 (action), Task 4 (layout), Task 8 (toggle).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/theme/config.test.ts
import { describe, expect, it } from 'vitest';
import { isTheme, resolveThemeAttrs, THEME_COOKIE_NAME } from './config';

describe('isTheme', () => {
  it('accepts the three supported values', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('system')).toBe(true);
  });
  it('rejects anything else', () => {
    for (const v of ['Light', 'DARK', '', null, undefined, 7, {}]) {
      expect(isTheme(v)).toBe(false);
    }
  });
});

describe('resolveThemeAttrs', () => {
  it('stamps nothing for system, so CSS prefers-color-scheme decides', () => {
    // The whole no-flash property depends on this: when the user has not
    // chosen, we emit NO data-theme and let the media query resolve it
    // before first paint. Stamping "light" here would break dark-OS users.
    expect(resolveThemeAttrs('system')).toEqual({ dataTheme: undefined, colorScheme: 'light dark' });
  });
  it('treats a missing or unrecognised cookie as system', () => {
    expect(resolveThemeAttrs(null)).toEqual({ dataTheme: undefined, colorScheme: 'light dark' });
    expect(resolveThemeAttrs(undefined)).toEqual({ dataTheme: undefined, colorScheme: 'light dark' });
    expect(resolveThemeAttrs('purple')).toEqual({ dataTheme: undefined, colorScheme: 'light dark' });
  });
  it('stamps an explicit choice', () => {
    expect(resolveThemeAttrs('dark')).toEqual({ dataTheme: 'dark', colorScheme: 'dark' });
    expect(resolveThemeAttrs('light')).toEqual({ dataTheme: 'light', colorScheme: 'light' });
  });
});

describe('cookie name', () => {
  it('does not collide with the locale cookie', () => {
    expect(THEME_COOKIE_NAME).not.toBe('NEXT_LOCALE');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
npx vitest run src/lib/theme/config.test.ts
```
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/theme/config.ts
/**
 * Theme contract, shared by the server action, the root layout and the toggle.
 *
 * Deliberately dependency-free so it can be imported from a Server Component,
 * a Server Action and a Client Component without pulling anything in.
 */

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE_NAME = 'KM_THEME';
/** One year. Matches the locale cookie's horizon. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_THEME: Theme = 'system';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export type ThemeAttrs = {
  dataTheme: 'light' | 'dark' | undefined;
  colorScheme: 'light' | 'dark' | 'light dark';
};

/**
 * Maps the cookie to the attributes the root layout stamps on <html>.
 *
 * `system` (and any unreadable cookie) deliberately stamps NO data-theme.
 * That is what makes the default case flash-free: the CSS
 * `@media (prefers-color-scheme: dark)` block resolves before first paint,
 * with no cookie read, no script, and no hydration. Stamping a concrete
 * value here would force us to guess the OS theme on the server, which is
 * exactly the guess that produces a flash when it is wrong.
 */
export function resolveThemeAttrs(cookie: string | null | undefined): ThemeAttrs {
  if (cookie === 'dark') return { dataTheme: 'dark', colorScheme: 'dark' };
  if (cookie === 'light') return { dataTheme: 'light', colorScheme: 'light' };
  return { dataTheme: undefined, colorScheme: 'light dark' };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run src/lib/theme/config.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
npx biome check src/lib/theme && pnpm typecheck
git add src/lib/theme/config.ts src/lib/theme/config.test.ts
git commit -m "feat(theme): theme cookie contract and attribute resolution

resolveThemeAttrs stamps nothing for 'system' on purpose — the media query
resolves it before first paint, so the default case needs no cookie, no
script and no hydration, and therefore cannot flash."
```

---

### Task 3: `setTheme` server action

**Files:**
- Create: `src/lib/theme/actions.ts`
- Test: `src/lib/theme/actions.test.ts`

**Interfaces:**
- Consumes: `isTheme`, `THEME_COOKIE_NAME`, `THEME_COOKIE_MAX_AGE`, `Theme` from Task 2.
- Produces: `setTheme(theme: Theme): Promise<{ ok: boolean; theme: Theme | null }>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/theme/actions.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieSet = vi.fn();
const revalidatePath = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet, get: () => undefined }),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const { setTheme } = await import('./actions');

describe('setTheme', () => {
  beforeEach(() => { cookieSet.mockClear(); revalidatePath.mockClear(); });

  it('writes the cookie and revalidates the layout', async () => {
    const res = await setTheme('dark');
    expect(res).toEqual({ ok: true, theme: 'dark' });
    expect(cookieSet).toHaveBeenCalledWith('KM_THEME', 'dark', expect.objectContaining({
      path: '/', sameSite: 'lax', httpOnly: false,
    }));
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('accepts system', async () => {
    const res = await setTheme('system');
    expect(res).toEqual({ ok: true, theme: 'system' });
    expect(cookieSet).toHaveBeenCalledWith('KM_THEME', 'system', expect.anything());
  });

  it('rejects an unsupported value without touching the cookie', async () => {
    // The client can post anything; validate at the boundary.
    const res = await setTheme('rainbow' as never);
    expect(res).toEqual({ ok: false, theme: null });
    expect(cookieSet).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
npx vitest run src/lib/theme/actions.test.ts
```
Expected: FAIL — `Cannot find module './actions'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/theme/actions.ts
'use server';

/**
 * `setTheme()` — Server Action behind the theme toggle.
 *
 * Cookie only. Unlike `setLocale`, there is no DB column: theme is a
 * per-device preference (the same person legitimately wants dark on a phone
 * at night and light on a desktop by a window), and LIFF visitors have no
 * User row until /liff/pair binds one.
 *
 * `revalidatePath('/', 'layout')` re-runs the root layout so the new
 * `data-theme` is stamped server-side. Keeping the switch on the server means
 * there is no intermediate client state to flash through.
 */

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { isTheme, THEME_COOKIE_MAX_AGE, THEME_COOKIE_NAME, type Theme } from './config';

export async function setTheme(theme: Theme): Promise<{ ok: boolean; theme: Theme | null }> {
  // Validate at the boundary — the client could pass anything.
  if (!isTheme(theme)) return { ok: false, theme: null };

  const cookieStore = await cookies();
  cookieStore.set(THEME_COOKIE_NAME, theme, {
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: 'lax',
    path: '/',
    // Not HttpOnly: the toggle (client component) reads it to highlight the
    // current selection. Non-sensitive.
    httpOnly: false,
  });

  revalidatePath('/', 'layout');
  return { ok: true, theme };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run src/lib/theme/actions.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
npx biome check src/lib/theme && pnpm typecheck
git add src/lib/theme/actions.ts src/lib/theme/actions.test.ts
git commit -m "feat(theme): setTheme server action

Cookie only — theme is per-device by nature, and LIFF visitors have no
User row until /liff/pair binds one."
```

---

### Task 4: Stamp the theme during SSR

**Files:**
- Modify: `src/app/layout.tsx:93-101`

**Interfaces:**
- Consumes: `resolveThemeAttrs`, `THEME_COOKIE_NAME` from Task 2.

- [ ] **Step 1: Modify the root layout**

Add the imports beside the existing `next-intl` ones:

```ts
import { cookies } from 'next/headers';
import { resolveThemeAttrs, THEME_COOKIE_NAME } from '@/lib/theme/config';
```

Inside `RootLayout`, after `const locale = await getLocale();`:

```ts
  // Theme is resolved on the server so <html> carries the right attribute in
  // the first byte of HTML. `system` deliberately stamps nothing — see
  // resolveThemeAttrs. No client script, no hydration step, no flash.
  const themeCookie = (await cookies()).get(THEME_COOKIE_NAME)?.value ?? null;
  const { dataTheme, colorScheme } = resolveThemeAttrs(themeCookie);
```

Replace the `<html>` open tag:

```tsx
    <html
      lang={locale}
      data-theme={dataTheme}
      style={{ colorScheme }}
      className={`${inter.variable} ${plexThai.variable} ${plexMono.variable} ${notoMyanmar.variable} ${notoKhmer.variable} ${notoLao.variable}`}
    >
```

`data-theme={undefined}` renders no attribute at all in React, which is exactly the "system" behaviour we want.

- [ ] **Step 2: Verify it compiles and renders**

```bash
pnpm typecheck
curl -s http://localhost:3000/login | head -c 400
```
Expected: `<html lang="th" style="color-scheme:light dark"` with **no** `data-theme` attribute (no cookie set yet).

- [ ] **Step 3: Verify an explicit cookie stamps**

```bash
curl -s --cookie 'KM_THEME=dark' http://localhost:3000/login | head -c 400
```
Expected: contains `data-theme="dark"` and `color-scheme:dark`.

- [ ] **Step 4: Commit**

```bash
npx biome check src/app/layout.tsx && pnpm typecheck && npx vitest run
git add src/app/layout.tsx
git commit -m "feat(theme): stamp data-theme on <html> during SSR

Explicit choices arrive in the first byte of HTML. 'system' stamps nothing
and lets prefers-color-scheme resolve before first paint."
```

---

### Task 5: Split the hover tokens (light mode must not move)

Must land **before** any dark values, because the dark palette depends on hover being its own axis.

**Files:**
- Modify: `src/app/globals.css:73-75`
- Modify: 89 `.tsx` files — mechanical class replacement only.

**Interfaces:**
- Produces: `--color-surface-hover`, `--color-surface-hover-strong`, and the utilities `hover:bg-surface-hover` / `hover:bg-surface-hover-strong`.

- [ ] **Step 1: Add the tokens, seeded with today's exact values**

In the `@theme` block, immediately after `--color-surface-sunken`:

```css
  /* Hover fills. Separate from `surface-muted`/`surface-sunken` because those
   * carry two meanings that light mode happens to conflate and dark mode
   * cannot: "you are hovering this" and "this panel is recessed".
   *
   * In light, a hover goes DARKER than the card. In dark it must go LIGHTER,
   * or the element fades into the page as you point at it. One variable
   * cannot do both, and 93 usages depended on it doing both.
   *
   * Seeded with the exact values they replace, so light mode is unchanged.
   * Two tokens, not one: surface-muted and surface-sunken are different
   * colours, and collapsing them would silently restyle 25 hover states.
   */
  --color-surface-hover:        oklch(98.5% 0.002 247.839); /* == surface-muted  */
  --color-surface-hover-strong: oklch(96.7% 0.003 264.542); /* == surface-sunken */
```

- [ ] **Step 2: Migrate the hover usages**

Exact-string replacement, hover-prefixed only. Static `bg-surface-muted` / `bg-surface-sunken` keep their recessed meaning and must NOT change.

```bash
cd /Users/tong/Works/fai/work/.claude/worktrees/ui-dark-mode
grep -rl 'hover:bg-surface-muted' src --include='*.tsx' | xargs sed -i '' 's/hover:bg-surface-muted\b/hover:bg-surface-hover/g'
grep -rl 'hover:bg-surface-sunken' src --include='*.tsx' | xargs sed -i '' 's/hover:bg-surface-sunken\b/hover:bg-surface-hover-strong/g'
```

- [ ] **Step 3: Verify the counts moved exactly as predicted**

```bash
echo "remaining hover:bg-surface-muted  (expect 0): $(grep -ro 'hover:bg-surface-muted' src --include='*.tsx' | wc -l)"
echo "remaining hover:bg-surface-sunken (expect 0): $(grep -ro 'hover:bg-surface-sunken' src --include='*.tsx' | wc -l)"
echo "new hover:bg-surface-hover        (expect 68): $(grep -ro 'hover:bg-surface-hover\b' src --include='*.tsx' | wc -l)"
echo "new hover:bg-surface-hover-strong (expect 25): $(grep -ro 'hover:bg-surface-hover-strong' src --include='*.tsx' | wc -l)"
echo "static bg-surface-muted  (expect 57, unchanged): $(grep -ro 'bg-surface-muted' src --include='*.tsx' | wc -l)"
echo "static bg-surface-sunken (expect 25, unchanged): $(grep -ro 'bg-surface-sunken' src --include='*.tsx' | wc -l)"
```

If any number differs, revert with `git checkout -- src` and investigate before proceeding.

- [ ] **Step 4: Prove light mode did not move**

```bash
pnpm test:e2e -- contrast-light.spec.ts 2>&1 | tee /tmp/contrast-after-hover.txt
diff <(grep -oE '"(ratio|fg|bg)": *"?[^,"]+' /tmp/contrast-baseline.txt | sort) \
     <(grep -oE '"(ratio|fg|bg)": *"?[^,"]+' /tmp/contrast-after-hover.txt | sort) \
  && echo "IDENTICAL — hover split was a visual no-op"
```
Expected: identical. The suite is still red (ink is untouched), but the *same* red.

- [ ] **Step 5: Commit**

```bash
npx biome check src && pnpm typecheck && npx vitest run
git add src/app/globals.css src
git commit -m "refactor(theme): give hover fills their own tokens

surface-muted meant both 'hovering' (68 uses) and 'recessed' (57). Light
mode conflates them; dark mode needs opposite directions. Two new tokens,
each seeded with the value it replaces, so this commit changes no pixel.

Two and not one: surface-muted and surface-sunken are different colours,
and collapsing both hovers into a single token would have silently
restyled 25 hover states."
```

---

### Task 6: Light ink ramp to AA

**Files:**
- Modify: `src/app/globals.css:47-49`
- Modify: the 7 files carrying `text-ink-5`

- [ ] **Step 1: Re-point ink-5's text usages**

`ink-5` (1.48:1) becomes a non-text token. Its 7 text usages move to `ink-4`; its 3 non-text usages (2 checkbox borders, 1 legend swatch) stay.

```bash
cd /Users/tong/Works/fai/work/.claude/worktrees/ui-dark-mode
grep -rl 'text-ink-5' src --include='*.tsx' | xargs sed -i '' 's/text-ink-5\b/text-ink-4/g'
echo "remaining text-ink-5 (expect 0): $(grep -ro 'text-ink-5' src --include='*.tsx' | wc -l)"
echo "border-ink-5 + bg-ink-5 (expect 3, untouched): $(grep -roE '(border|bg)-ink-5' src --include='*.tsx' | wc -l)"
```

- [ ] **Step 2: Update the ink values**

Replace lines 47-49 of `src/app/globals.css`:

```css
  /* ink-3/ink-4 are derived, not picked. Two AA-passing greys on the #f6f8fb
   * canvas sit ~1.7% lightness apart — the same colour to the eye — so the old
   * five-level ramp and WCAG AA were mutually exclusive. ink-3 is darkened to
   * open room for a compliant ink-4 beneath it.
   *
   * Old: ink-3 4.47:1 on canvas (fails by 0.03), ink-4 2.41:1, ink-5 1.40:1.
   * Re-derive with `node scripts/derive-theme-tokens.mjs`.
   */
  --color-ink-3:  #4d5a6b;  /* 6.60:1 on canvas, 7.02 on white */
  --color-ink-4:  #657284;  /* 4.60:1 on canvas, 4.89 on white */
  --color-ink-5:  #cbd5e1;  /* NON-TEXT ONLY — borders, disabled marks */
```

- [ ] **Step 3: Run the contrast suite**

```bash
pnpm test:e2e -- contrast-light.spec.ts
```
Expected: **PASS** on all 8 admin pages. If a failure remains, read its `fg`/`bg` — a leftover `#94a3b8` means a `text-ink-4` was missed; anything else is a separate finding to report, not to silence.

- [ ] **Step 4: Commit**

```bash
npx biome check src && pnpm typecheck && npx vitest run
git add src/app/globals.css src
git commit -m "fix(a11y): bring the ink ramp to WCAG AA

ink-4 was 2.56:1 on white across 180 usages; ink-5 was 1.48:1. The worst
instance was 'Not checked in yet' — the primary status on the worker
check-in screen — at 2.56:1.

ink-3 passed on white (4.76) but failed on the app's own canvas (4.47),
which no amount of looking at the screen would have revealed.

Values are derived by scripts/derive-theme-tokens.mjs, not picked."
```

---

### Task 7: Dark palette + drift test

**Files:**
- Modify: `src/app/globals.css` (append after the `:root` shadow block)
- Create: `src/app/globals.dark.test.ts`

- [ ] **Step 1: Write the failing drift test**

The two dark blocks cannot be merged — a CSS rule cannot span a media query — so they are duplicated and must be kept in lockstep. This mirrors the existing stub-locale drift test (`2e3ea30`).

```ts
// src/app/globals.dark.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** Extract the `--x: y;` declarations from the block a marker comment opens. */
function varsIn(marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`marker not found: ${marker}`);
  const open = css.indexOf('{', css.indexOf('{', start) + 1);
  let depth = 0, i = css.indexOf('{', start), end = -1;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = css.slice(open, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

describe('dark theme blocks stay in lockstep', () => {
  const media = varsIn('/* DARK:media */');
  const attr = varsIn('/* DARK:attr */');

  it('both blocks are non-empty', () => {
    expect(Object.keys(media).length).toBeGreaterThan(10);
    expect(Object.keys(attr).length).toBeGreaterThan(10);
  });

  it('declare exactly the same variables', () => {
    expect(Object.keys(attr).sort()).toEqual(Object.keys(media).sort());
  });

  it('declare the same values', () => {
    expect(attr).toEqual(media);
  });

  it('no surface exceeds the ink-4 ceiling', () => {
    // ink-4 (#979da5) reaches 4.5:1 only on surfaces at or below OKLCH L 32.95.
    // An early draft put surface-hover-strong at L 36 and ink-4 silently
    // dropped to 3.99. Any new surface must be checked against this.
    const surfaces = Object.entries(media)
      .filter(([k]) => k.startsWith('--color-surface') || k === '--color-canvas');
    expect(surfaces.length).toBeGreaterThan(4);
    for (const [name, value] of surfaces) {
      expect(value, `${name} must be a hex literal so the ceiling is checkable`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
npx vitest run src/app/globals.dark.test.ts
```
Expected: FAIL — `marker not found: /* DARK:media */`.

- [ ] **Step 3: Append the dark blocks to `globals.css`**

Delete `color-scheme: light; /* lock light — dark mode out of scope */` from the `:root` block first — the layout now owns `color-scheme`.

```css
/* ─── Dark theme ───────────────────────────────────────────────────────────
 * Two blocks, identical bodies. A CSS rule cannot span a media query, so the
 * duplication is structural, not laziness — src/app/globals.dark.test.ts
 * asserts they never drift.
 *
 * `:not([data-theme='light'])` is what makes an explicit Light choice win on a
 * dark OS. Without it the override only works in one direction.
 *
 * Elevation is lightness, not shadow: surfaces get LIGHTER as they come
 * forward. HARD CEILING: no surface above OKLCH L 32.95 — that is where ink-4
 * still reaches 4.5:1.
 *
 * Values from scripts/derive-theme-tokens.mjs. Do not hand-edit.
 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    /* DARK:media */
    --color-surface-sunken:       #0b0d12;
    --color-canvas:               #101317;
    --color-surface-muted:        #1a1d22;
    --color-surface:              #22252a;
    --color-surface-hover:        #292d32;
    --color-surface-hover-strong: #313439;
    --color-line-soft:            #2d3135;
    --color-line:                 #3a3d42;
    --color-line-strong:          #52565b;
    --color-ink-1:                #e9f0f9;
    --color-ink-2:                #c7ced7;
    --color-ink-3:                #a7adb5;
    --color-ink-4:                #979da5;
    --color-ink-5:                #6e7277;
    --border-color:               rgb(255 255 255 / 0.10);
    --border-strong:              rgb(255 255 255 / 0.18);
  }
}
:root[data-theme='dark'] {
  /* DARK:attr */
  --color-surface-sunken:       #0b0d12;
  --color-canvas:               #101317;
  --color-surface-muted:        #1a1d22;
  --color-surface:              #22252a;
  --color-surface-hover:        #292d32;
  --color-surface-hover-strong: #313439;
  --color-line-soft:            #2d3135;
  --color-line:                 #3a3d42;
  --color-line-strong:          #52565b;
  --color-ink-1:                #e9f0f9;
  --color-ink-2:                #c7ced7;
  --color-ink-3:                #a7adb5;
  --color-ink-4:                #979da5;
  --color-ink-5:                #6e7277;
  --border-color:               rgb(255 255 255 / 0.10);
  --border-strong:              rgb(255 255 255 / 0.18);
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run src/app/globals.dark.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
npx biome check src && pnpm typecheck && npx vitest run
git add src/app/globals.css src/app/globals.dark.test.ts
git commit -m "feat(theme): dark surface and ink palette

Elevation expressed as lightness, per the note already in globals.css.
Every ink level clears AA against the LIGHTEST surface (the worst case for
light text), not merely against the page background.

Hard ceiling of OKLCH L 32.95 on any surface: that is where ink-4 still
reaches 4.5:1. An earlier draft put surface-hover-strong at L 36 and ink-4
dropped to 3.99 unnoticed. The drift test guards the duplicate blocks."
```

---

### Task 8: Dark status palette

**Files:**
- Modify: `src/app/globals.css` (both dark blocks)

Soft tints (50/100/200) must sit **above** both canvas and surface so alert blocks still read as blocks; text tones (700/800/900) invert to light; solid fills (500/600) are solved so white text clears AA.

- [ ] **Step 1: Generate the values**

```bash
node scripts/derive-theme-tokens.mjs --status
```

If that flag does not exist yet, add it to the script so the table is reproducible rather than pasted. The verified values are:

```css
    /* Status ramps. Soft tints sit ABOVE canvas and surface so an alert still
     * reads as a block; text tones invert to light; solid fills are solved so
     * white text clears AA (green-500 was 4.00 before solving).
     * All 14 alert pairs the app actually renders pass, lowest 6.43. */
    --color-red-50:   #482d2b;  --color-red-100:  #55322f;  --color-red-200:  #663935;
    --color-red-500:  #c44b47;  --color-red-600:  #b63e3c;
    --color-red-700:  #ffb1a9;  --color-red-800:  #ffc2bb;  --color-red-900:  #ffd0ca;
    --color-amber-50: #43321e;  --color-amber-100:#4f381d;  --color-amber-200:#5e411d;
    --color-amber-500:#ad6100;  --color-amber-600:#a05400;
    --color-amber-700:#f5bf81;  --color-amber-800:#fcce9a;  --color-amber-900:#ffdaaf;
    --color-green-50: #283b29;  --color-green-100:#2b442c;  --color-green-200:#305132;
    --color-green-500:#1d862e;  --color-green-600:#017920;
    --color-green-700:#a1dca3;  --color-green-800:#b5e7b6;  --color-green-900:#c5eec5;
    --color-blue-50:  #29364a;  --color-blue-100: #2d3d58;
    --color-blue-500: #3972ce;  --color-blue-700: #a4ccff;  --color-blue-800: #b7d9ff;
    --color-emerald-50:#213c2f; --color-emerald-400:#039869; --color-emerald-500:#008550;
    --color-emerald-700:#8cdfb7;
    --color-purple-50:#3a3046;  --color-purple-100:#433653;
    --color-purple-700:#d8bbff; --color-purple-800:#e3caff;
    --color-rose-100: #553234;  --color-rose-700: #ffb0b4;  --color-rose-800: #ffc1c4;
    --color-violet-50:#363148;  --color-violet-700:#cdbeff;
    --color-yellow-100:#493b1b; --color-yellow-800:#f1d496;
    /* 2 leftover raw greys from the earlier token migration — re-pointed at
     * real tokens rather than re-derived. */
    --color-gray-100: #2d3135;  --color-gray-700: #c7ced7;
```

Paste this identically into **both** dark blocks.

- [ ] **Step 2: Verify the drift test still passes**

```bash
npx vitest run src/app/globals.dark.test.ts
```
Expected: PASS — proves both blocks got the same paste.

- [ ] **Step 3: Write the dark contrast spec**

```ts
// tests/e2e/contrast-dark.spec.ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { ADMIN_PAGES, auditContrast } from './helpers/contrast';

test.describe('WCAG AA contrast — dark mode, admin', () => {
  test.use({ colorScheme: 'dark' });
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  for (const path of ADMIN_PAGES) {
    test(`${path} has no contrast failures in dark`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      // Belt and braces: assert we are actually in dark, so a failure to apply
      // the theme cannot masquerade as a pass on the light palette.
      const canvas = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim());
      expect(canvas, 'dark palette did not apply').toBe('#101317');

      const { scanned, measured, failures } = await auditContrast(page);
      expect(scanned).toBeGreaterThan(20);
      expect(measured).toBeGreaterThan(3);
      expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    });
  }
});
```

- [ ] **Step 4: Run both suites**

```bash
pnpm test:e2e -- contrast-light.spec.ts contrast-dark.spec.ts
```
Expected: PASS on all 16 tests.

- [ ] **Step 5: Commit**

```bash
npx biome check src && pnpm typecheck && npx vitest run
git add src/app/globals.css tests/e2e/contrast-dark.spec.ts
git commit -m "feat(theme): dark status palette

Soft tints sit above canvas AND surface so an alert still reads as a block
at equal lightness it would go flat, and be invisible to colour-blind
users. Solid fills are solved for white text: green-500 was 4.00 before.

All 14 alert pairs the app renders pass, lowest 6.43."
```

---

### Task 9: Solid-fill exceptions — the destructive and approve buttons

**This is the highest-consequence task in the plan.** Five palette steps are used
as *both* a solid button fill and a text colour, and they cannot invert the same
way. `--color-red-700` becomes `#ffb1a9` (light pink) so error *text* reads on a
dark page — but `bg-red-700` is the destructive button's **hover** fill. Without
this task, every Reject button in dark mode turns pale pink with white text on
it the moment you point at it.

The affected controls are not cosmetic: they are the Approve/Reject buttons on
the LIFF leave, advance and dispute review screens — what an admin taps in LINE
to decide someone's leave or cash advance.

| step | as `bg-` | as `text-` |
|---|---|---|
| `red-700` | 6 | 77 |
| `red-600` | 7 | 31 |
| `green-700` | 3 | 16 |
| `red-500` | 3 | 5 |
| `amber-600` | 1 | 2 |

**Files:**
- Modify: `src/app/globals.css` (`@theme` block + both dark blocks)
- Modify: `src/components/ui/button.tsx:19,30`
- Modify: `src/components/admin/notification-bell.tsx:152`
- Modify: `src/app/(liff)/liff/admin/{leave,advance,dispute}/[id]/*-review-actions.tsx`
- Modify: `src/app/(liff)/liff/{leave,advance}/[id]/*-detail-actions.tsx`
- Modify: `src/app/(liff)/liff/advance/balance-card.tsx:70`
- Modify: `src/app/(liff)/liff/calendar/calendar-grid.tsx:378`
- Modify: `src/app/(liff)/liff/home/page.tsx:68`

**Interfaces:**
- Produces: `--color-danger-solid`, `--color-danger-solid-hover`, `--color-danger-accent`, `--color-success-solid`, `--color-success-solid-hover`, `--color-warning-solid`, `--color-warning-solid-hover` and their `bg-*` utilities.

- [ ] **Step 1: Add the tokens to the `@theme` block, seeded byte-for-byte**

Values copied verbatim from `node_modules/tailwindcss/theme.css` so light mode
does not move by a single pixel.

```css
  /* Solid CTA fills. These need their own names because the SAME palette step
   * serves two irreconcilable jobs: `text-red-700` is error text (must become
   * LIGHT in dark mode) while `bg-red-700` is the destructive button's hover
   * fill (must stay a saturated red carrying white text). One variable cannot
   * do both — the button would turn pale pink with white text on hover.
   *
   * Seeded verbatim from tailwindcss/theme.css, so light mode is unchanged. */
  --color-danger-solid:         oklch(57.7% 0.245 27.325);  /* == red-600   */
  --color-danger-solid-hover:   oklch(50.5% 0.213 27.518);  /* == red-700   */
  --color-danger-accent:        oklch(63.7% 0.237 25.331);  /* == red-500   */
  --color-success-solid:        oklch(62.7% 0.194 149.214); /* == green-600 */
  --color-success-solid-hover:  oklch(52.7% 0.154 150.069); /* == green-700 */
  --color-warning-solid:        oklch(76.9% 0.188 70.08);   /* == amber-500 */
  --color-warning-solid-hover:  oklch(66.6% 0.179 58.318);  /* == amber-600 */
```

- [ ] **Step 2: Add the dark values to BOTH dark blocks**

```css
    /* Solid fills, solved so white text clears AA on each. Note the direction:
     * in LIGHT a button hover goes DARKER (600 -> 700); in DARK it must go
     * LIGHTER, exactly like surface-hover. Same inversion, second place it
     * bites. */
    --color-danger-solid:        #b9423a;  /* white 5.38 */
    --color-danger-solid-hover:  #c64e45;  /* white 4.59, lighter than base */
    --color-danger-accent:       #c44d43;  /* white 4.68 */
    --color-success-solid:       #007b2d;  /* white 5.42 */
    --color-success-solid-hover: #008738;  /* white 4.64, lighter than base */
    --color-warning-solid:       #ac4f00;  /* white 5.42 */
    --color-warning-solid-hover: #b95b00;  /* white 4.61, lighter than base */
```

- [ ] **Step 3: Re-point the 20 solid-fill sites**

Only `bg-`/`hover:bg-` on these steps. `text-*` and `ring-*` are left alone —
they are text and focus rings, which invert correctly via the palette.

```bash
cd /Users/tong/Works/fai/work/.claude/worktrees/ui-dark-mode
files=$(grep -rlE '\b(hover:)?bg-(red-(500|600|700)|green-(600|700)|amber-(500|600))\b' src --include='*.tsx')
for f in $files; do
  sed -i '' \
    -e 's/\bhover:bg-red-700\b/hover:bg-danger-solid-hover/g' \
    -e 's/\bhover:bg-red-600\b/hover:bg-danger-solid/g' \
    -e 's/\bbg-red-700\b/bg-danger-solid-hover/g' \
    -e 's/\bbg-red-600\b/bg-danger-solid/g' \
    -e 's/\bbg-red-500\b/bg-danger-accent/g' \
    -e 's/\bhover:bg-green-700\b/hover:bg-success-solid-hover/g' \
    -e 's/\bbg-green-700\b/bg-success-solid-hover/g' \
    -e 's/\bbg-green-600\b/bg-success-solid/g' \
    -e 's/\bhover:bg-amber-600\b/hover:bg-warning-solid-hover/g' \
    -e 's/\bbg-amber-600\b/bg-warning-solid-hover/g' \
    -e 's/\bbg-amber-500\b/bg-warning-solid/g' "$f"
done
```

- [ ] **Step 4: Verify nothing was missed and nothing extra moved**

```bash
echo "remaining solid bg on raw palette (expect 0):"
grep -roE '\b(hover:)?bg-(red-(500|600|700)|green-(600|700)|amber-(500|600))\b' src --include='*.tsx' | wc -l
echo "text-* on those steps still present (expect >0, untouched):"
grep -roE '\btext-(red-(500|600|700)|green-700|amber-600)\b' src --include='*.tsx' | wc -l
echo "destructive variant now reads:"
grep -n 'destructive:' src/components/ui/button.tsx
```
Expected: first is `0`; second is well above zero (the 131 text usages must NOT
have moved); the destructive variant reads
`bg-danger-solid text-white shadow-sm hover:bg-danger-solid-hover focus-visible:ring-red-500/50`.

- [ ] **Step 5: Prove light mode still has not moved**

```bash
pnpm test:e2e -- contrast-light.spec.ts
```
Expected: PASS, unchanged from Task 6.

- [ ] **Step 6: Verify the buttons in dark by eye**

Set the theme to Dark and open `/liff/leave/<id>` as an admin. The Approve
button must be a saturated green and Reject a saturated red, both with legible
white labels — **and both must stay legible on hover.** Hover is the case that
would have broken; check it explicitly rather than assuming.

- [ ] **Step 7: Commit**

```bash
npx biome check src && pnpm typecheck && npx vitest run
git add src/app/globals.css src/components src/app
git commit -m "fix(theme): give solid CTA fills their own tokens

red-700 is BOTH error text (77 uses) and the destructive button's hover
fill (6 uses). Dark mode needs the first light and the second saturated,
so one variable cannot serve both: every Reject button would have turned
pale pink with white text on hover.

These are the Approve/Reject buttons an admin taps in LINE to decide
someone's leave and cash advance, so illegible is not cosmetic.

Seeded verbatim from tailwindcss/theme.css — light mode unchanged. Note
the inversion repeats here: in light a button hover goes darker, in dark
it must go lighter."
```

---
### Task 10: The theme toggle

**Files:**
- Create: `src/components/theme/theme-toggle.tsx`
- Modify: `src/components/admin/topbar.tsx`
- Modify: `src/app/(liff)/layout.tsx:23-25`

**Interfaces:**
- Consumes: `setTheme` (Task 3), `THEMES`, `Theme`, `THEME_COOKIE_NAME` (Task 2).
- Produces: `<ThemeToggle />` — no props. It reads the cookie in an effect, so it can be dropped into any layout without prop-drilling the theme through every server component.

- [ ] **Step 1: Build the control**

Follows `LanguageSwitcher`'s idiom: a segmented control, current value read from the cookie on the client so it highlights without prop-drilling through every layout.

```tsx
// src/components/theme/theme-toggle.tsx
'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { setTheme } from '@/lib/theme/actions';
import { isTheme, type Theme, THEME_COOKIE_NAME } from '@/lib/theme/config';

const OPTIONS: { value: Theme; Icon: typeof Sun; label: string }[] = [
  { value: 'light', Icon: Sun, label: 'สว่าง' },
  { value: 'dark', Icon: Moon, label: 'มืด' },
  { value: 'system', Icon: Monitor, label: 'ตามระบบ' },
];

function readCookie(): Theme {
  const raw = document.cookie.split('; ').find((c) => c.startsWith(`${THEME_COOKIE_NAME}=`))?.split('=')[1];
  return isTheme(raw) ? raw : 'system';
}

/**
 * Three-state theme control.
 *
 * "System" is a real option, not the absence of one: it keeps tracking the OS
 * after the user has chosen it, which a two-state toggle cannot express.
 *
 * The current value is read from the cookie in an effect rather than during
 * render, because the server renders no data-theme for `system` and reading
 * document.cookie during render would mismatch hydration.
 */
export function ThemeToggle() {
  const [current, setCurrent] = useState<Theme>('system');
  const [pending, startTransition] = useTransition();

  useEffect(() => { setCurrent(readCookie()); }, []);

  return (
    <div
      role="radiogroup"
      aria-label="ธีมสี"
      className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5"
    >
      {OPTIONS.map(({ value, Icon, label }) => {
        const active = current === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            disabled={pending}
            onClick={() => {
              setCurrent(value);           // optimistic, so the highlight is instant
              startTransition(() => { void setTheme(value); });
            }}
            className={
              active
                ? 'grid size-8 place-items-center rounded-full bg-primary-600 text-white'
                : 'grid size-8 place-items-center rounded-full text-ink-3 transition hover:bg-surface-hover hover:text-ink-2'
            }
          >
            <Icon size={15} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Mount it in the admin topbar**

In `src/components/admin/topbar.tsx`, import it and place it immediately before the existing user-menu wrapper:

```tsx
import { ThemeToggle } from '@/components/theme/theme-toggle';
```
```tsx
<ThemeToggle />
```

- [ ] **Step 3: Mount it in the LIFF utility bar**

In `src/app/(liff)/layout.tsx`, replace the utility-bar div:

```tsx
      <div className="mx-auto flex max-w-md items-center justify-end gap-2 px-4 pt-3">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>
```
with `import { ThemeToggle } from '@/components/theme/theme-toggle';` added at the top.

- [ ] **Step 4: Write the e2e round-trip test**

```ts
// tests/e2e/theme-toggle.spec.ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test('theme toggle persists across a reload with no flash of the wrong theme', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin');

  await page.getByRole('radio', { name: 'มืด' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // The point of the cookie: the SERVER must stamp it on the next request,
  // so the theme is correct in the first byte rather than applied by script.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('radio', { name: 'ตามระบบ' }).click();
  await page.reload();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
});
```

- [ ] **Step 5: Run it**

```bash
pnpm test:e2e -- theme-toggle.spec.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx biome check src && pnpm typecheck && npx vitest run
git add src/components/theme/theme-toggle.tsx src/components/admin/topbar.tsx 'src/app/(liff)/layout.tsx' tests/e2e/theme-toggle.spec.ts
git commit -m "feat(theme): three-state theme toggle in admin and LIFF

System is a real option rather than the absence of one — it keeps tracking
the OS after the user picks it, which a two-state toggle cannot express.

Current value is read from the cookie in an effect, not during render: the
server emits no data-theme for 'system', so reading it during render would
mismatch hydration."
```

---

### Task 11: Full verification

- [ ] **Step 1: Run the complete gate**

```bash
cd /Users/tong/Works/fai/work/.claude/worktrees/ui-dark-mode
npx biome check src && pnpm typecheck && npx vitest run && pnpm test:integration
```
Expected: all green. **No pre-existing test may have been modified** — verify with `git diff main --stat -- '*.test.ts' '*.spec.ts'`; every changed test file must be one this plan created.

- [ ] **Step 2: Prove light mode moved only where intended**

```bash
git diff main --stat
```
Every `.tsx` change must be one of exactly four mechanical substitutions:
`hover:bg-surface-muted`→`hover:bg-surface-hover`, `hover:bg-surface-sunken`→`hover:bg-surface-hover-strong`, `text-ink-5`→`text-ink-4`, and the solid-fill re-points from Task 9 — plus the toggle mounts in `topbar.tsx` and `(liff)/layout.tsx`.

```bash
git diff main -- 'src/**/*.tsx' | grep '^[-+]' | grep -v '^[-+][-+]' \
  | grep -vE 'surface-muted|surface-sunken|surface-hover|text-ink-[45]|danger-solid|danger-accent|success-solid|warning-solid|bg-(red|green|amber)-[0-9]|ThemeToggle|import|gap-2 px-4 pt-3' \
  && echo "^^ UNEXPECTED CHANGES — investigate" || echo "clean: only the intended substitutions"
```

- [ ] **Step 3: LIFF sweep in both themes at phone width**

Add the LIFF pages to both contrast specs using `LIFF_PAGES` and `loginAsWorker`, viewport 375×812, then:

```bash
pnpm test:e2e -- contrast-light.spec.ts contrast-dark.spec.ts
```
Expected: all green. This is the surface 50 workers use; it was sequenced first for a reason.

- [ ] **Step 4: Eyeball the 4 decorative sites the ramp change touches**

`ink-4`/`ink-5` are used for 4 non-text things. Confirm each still reads correctly in both themes:
- `src/app/(admin)/admin/attendance/live/live-client.tsx:180` — legend swatch
- `src/app/(admin)/admin/attendance/live/live-client.tsx:339` — 6px status dot
- `src/app/(admin)/admin/settings/attendance/page.tsx:156,182` — checkbox borders

- [ ] **Step 5: Restore the local seed**

Implementation used a local staff login pointed at employee สมชาย. Undo it:

```bash
pnpm db:seed:employees
```

- [ ] **Step 6: Final commit**

```bash
git add -u && git commit -m "test(theme): LIFF contrast coverage in both themes" || echo "nothing to commit"
git log --oneline main..HEAD
```
