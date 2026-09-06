import type { Page } from '@playwright/test';

export type Failure = {
  ratio: number;
  need: number;
  px: number;
  fg: string;
  bg: string;
  text: string;
  selector: string;
};

export type AuditResult = { scanned: number; measured: number; failures: Failure[] };

/** Admin pages swept at desktop width. */
export const ADMIN_PAGES = [
  '/admin',
  '/admin/payroll',
  '/admin/employees',
  '/admin/approvals',
  '/admin/attendance',
  '/admin/leave',
  '/admin/reports',
  '/admin/settings/payroll',
] as const;

/** Worker-facing LIFF pages swept at phone width. */
export const LIFF_PAGES = [
  '/liff/check-in',
  '/liff/payslip',
  '/liff/leave',
  '/liff/leave/new',
  '/liff/calendar',
  '/liff/summary',
  '/liff/profile',
  '/liff/advance',
] as const;

/**
 * Measures WCAG contrast for every text-bearing element on the page.
 *
 * Three traps, every one of which produced a confidently wrong answer while
 * this was being written. They are documented because verifying the fix hits
 * exactly the same ones:
 *
 *  1. GRADIENTS. Walking only `background-color` looks straight through a
 *     `linear-gradient(...)` to whatever is painted behind it. The KPI hero
 *     reported white-on-canvas at 1.06:1; white on that deep blue is ~9:1.
 *     Six of the first twelve "failures" were fake. Gradient stops are
 *     averaged instead.
 *
 *  2. lab() / oklch(). Tailwind v4's palette is OKLCH and browsers report it
 *     back as `lab(...)`. An rgba() regex drops that silently, so every
 *     palette-coloured background is treated as transparent and the walker
 *     sees through to the page. Colour is parsed through a canvas 2D context
 *     so the browser does the conversion, not a regex.
 *
 *  3. SILENT FAILURE. A `catch {}` around the sweep once hid a ReferenceError
 *     on all 8 LIFF pages and returned empty arrays — indistinguishable from
 *     a clean bill of health. Nothing here swallows an error, and the result
 *     carries `scanned`/`measured` so callers can assert the sweep actually
 *     ran before believing a zero-failure verdict.
 *
 * Add `data-contrast-exempt` to an element to skip it and its subtree. The
 * opt-out lives next to the thing being excused, not in a list nobody reads.
 */
export async function auditContrast(page: Page): Promise<AuditResult> {
  return page.evaluate(() => {
    type C = { r: number; g: number; b: number; a: number };

    const cvs = document.createElement('canvas');
    cvs.width = 1;
    cvs.height = 1;
    const ctx = cvs.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('contrast audit: could not get a 2D context');

    const memo = new Map<string, C | null>();
    const parse = (s: string): C | null => {
      if (!s) return null;
      const hit = memo.get(s);
      if (hit !== undefined) return hit;
      ctx.fillStyle = '#000';
      try {
        ctx.fillStyle = s;
      } catch {
        memo.set(s, null);
        return null;
      }
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      // Indexed access is `number | undefined` under noUncheckedIndexedAccess.
      // A 1x1 RGBA read always yields 4 bytes, so the fallbacks are unreachable
      // — they exist to satisfy the compiler, not to paper over a real case.
      const v: C = { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0, a: (d[3] ?? 255) / 255 };
      memo.set(s, v);
      return v;
    };

    const lum = (c: C) => {
      const f = (x: number) => {
        const y = x / 255;
        return y <= 0.03928 ? y / 12.92 : ((y + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const blend = (f: C, b: C): C => ({
      r: f.r * f.a + b.r * (1 - f.a),
      g: f.g * f.a + b.g * (1 - f.a),
      b: f.b * f.a + b.b * (1 - f.a),
      a: 1,
    });
    const ratio = (a: C, b: C) => {
      const l1 = lum(a);
      const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const gradAvg = (img: string): C | null => {
      const found = img.match(/(?:rgba?|lab|oklch|oklab|hsla?|color)\([^)]*\)|#[0-9a-f]{3,8}/gi);
      const cols = (found ?? []).map((m) => parse(m)).filter((c): c is C => c !== null);
      if (!cols.length) return null;
      return {
        r: cols.reduce((s, c) => s + c.r, 0) / cols.length,
        g: cols.reduce((s, c) => s + c.g, 0) / cols.length,
        b: cols.reduce((s, c) => s + c.b, 0) / cols.length,
        a: 1,
      };
    };

    const effBg = (el: Element): { c?: C; unknown?: boolean } => {
      let n: Element | null = el;
      let acc: C | null = null;
      while (n) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') {
          // A gradient with a `transparent` stop is a decorative overlay — the
          // scroll-shadow affordance, a fade, a scrim — and what you actually
          // SEE through it is the element's own background-color. Averaging
          // its stops invents a colour that is never painted: the scroll
          // shadows averaged white cover + transparent + black shadow into
          // #44464a and reported seven false failures.
          //
          // An OPAQUE gradient (the KPI hero) really is the background, so it
          // is still averaged.
          if (!/\btransparent\b|rgba?\([^)]*,\s*0\s*\)/i.test(cs.backgroundImage)) {
            const g = gradAvg(cs.backgroundImage);
            if (g) return { c: acc ? blend(acc, g) : g };
            return { unknown: true }; // a real image — we cannot reason about it
          }
          // fall through to this element's background-color
        }
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) {
          acc = acc ? blend(acc, c) : c;
          if (acc.a >= 1) return { c: acc };
        }
        n = n.parentElement;
      }
      return { c: acc ?? { r: 255, g: 255, b: 255, a: 1 } };
    };

    const hex = (c: C) =>
      `#${[c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
    const sel = (el: Element) => {
      const cls =
        typeof el.className === 'string' && el.className.trim()
          ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
          : '';
      return `${el.tagName.toLowerCase()}${cls}`;
    };

    const failures: Failure[] = [];
    const seen = new Set<string>();
    let scanned = 0;
    let measured = 0;

    for (const el of Array.from(document.querySelectorAll('body *'))) {
      scanned++;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (el.closest('[data-contrast-exempt]')) continue;

      // Only elements carrying their OWN text node. Without this every
      // ancestor re-reports its descendants' text against the wrong
      // background and the results become noise.
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim())
        .map((n) => (n.textContent ?? '').trim())
        .join(' ');
      if (!own) continue;

      const fg = parse(cs.color);
      if (!fg) continue;
      const bgr = effBg(el);
      if (bgr.unknown || !bgr.c) continue;
      measured++;

      const bg = bgr.c;
      const r = ratio(blend(fg, bg), bg);
      const px = Number.parseFloat(cs.fontSize);
      // WCAG "large text": >=24px, or >=18.66px when bold.
      const need = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5;
      if (r >= need) continue;

      const key = `${cs.color}|${Math.round(r * 10)}|${px}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push({
        ratio: Number(r.toFixed(2)),
        need,
        px,
        fg: hex(fg),
        bg: hex(bg),
        text: own.slice(0, 40),
        selector: sel(el).slice(0, 60),
      });
    }

    return { scanned, measured, failures: failures.sort((a, b) => a.ratio - b.ratio) };
  });
}
