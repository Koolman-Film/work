import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The dark theme is declared twice: once inside
 * `@media (prefers-color-scheme: dark)` for visitors who have not chosen, and
 * once under `[data-theme='dark']` for visitors who have. A CSS rule cannot
 * span a media query, so the duplication is structural rather than laziness —
 * but two hand-maintained copies of 60 declarations will drift, and the drift
 * would only show up as "dark mode looks subtly wrong for some people".
 *
 * Mirrors the existing stub-locale drift test in spirit: assert the two
 * copies agree, so nobody has to remember to update both.
 */

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/**
 * Returns the custom-property declarations between a marker comment and the
 * next closing brace. The marker sits immediately inside the block it labels,
 * and these blocks contain only declarations, so scanning to the first `}` is
 * exact — no brace matching required.
 */
function varsAfter(marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`marker not found in globals.css: ${marker}`);
  const end = css.indexOf('}', start);
  if (end === -1) throw new Error(`no closing brace after marker: ${marker}`);
  const body = css.slice(start + marker.length, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1] as string] = (m[2] as string).trim();
  }
  return out;
}

describe('dark theme blocks stay in lockstep', () => {
  const media = varsAfter('/* DARK:media */');
  const attr = varsAfter('/* DARK:attr */');

  it('both blocks are populated', () => {
    expect(Object.keys(media).length).toBeGreaterThan(10);
    expect(Object.keys(attr).length).toBeGreaterThan(10);
  });

  it('declare exactly the same variables', () => {
    expect(Object.keys(attr).sort()).toEqual(Object.keys(media).sort());
  });

  it('declare the same values', () => {
    expect(attr).toEqual(media);
  });
});

describe('dark surfaces respect the ink-4 ceiling', () => {
  // ink-4 (#979da5) reaches 4.5:1 only on surfaces at or below OKLCH L 32.95.
  // An earlier draft put surface-hover-strong at L 36 and ink-4 silently
  // dropped to 3.99. Any surface added later must clear this too, so the
  // check is on the whole family rather than on a fixed list.
  const media = varsAfter('/* DARK:media */');

  const srgbToLinear = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
    return (
      0.2126 * srgbToLinear(r as number) +
      0.7152 * srgbToLinear(g as number) +
      0.0722 * srgbToLinear(b as number)
    );
  };
  const contrast = (a: string, b: string) => {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const surfaces = Object.entries(media).filter(
    ([k]) => k.startsWith('--color-surface') || k === '--color-canvas',
  );

  it('finds the surface family', () => {
    expect(surfaces.length).toBeGreaterThanOrEqual(5);
  });

  it('every surface is a hex literal, so the ceiling is checkable', () => {
    for (const [name, value] of surfaces) {
      expect(value, `${name} must be a hex literal`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('ink-4 clears AA on every surface, including the lightest', () => {
    const ink4 = media['--color-ink-4'];
    expect(ink4, '--color-ink-4 must be declared in the dark block').toBeDefined();
    for (const [name, value] of surfaces) {
      const ratio = contrast(ink4 as string, value);
      expect(
        Number(ratio.toFixed(2)),
        `ink-4 on ${name} (${value}) is ${ratio.toFixed(2)}:1 — below AA`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/**
 * The scrim is the seventh instance of the inversion trap: a token used as a
 * FILL cannot be defined in terms of the ink ramp, because the ramp inverts
 * between themes. `bg-ink-1/40` dimmed correctly in light and washed the page
 * pale in dark, where ink-1 is near-white.
 *
 * The contrast e2e suite structurally cannot catch this — it walks pages at
 * rest, and a scrim only exists while a dialog is open. So the invariant is
 * pinned here instead: scrim is declared once, and never per theme.
 */
describe('the scrim cannot invert', () => {
  const media = varsAfter('/* DARK:media */');
  const attr = varsAfter('/* DARK:attr */');

  it('is declared exactly once in the whole stylesheet', () => {
    const declarations = css.match(/--color-scrim\s*:/g) ?? [];
    expect(declarations).toHaveLength(1);
  });

  it('is not redefined by either dark block', () => {
    expect(media['--color-scrim']).toBeUndefined();
    expect(attr['--color-scrim']).toBeUndefined();
  });

  it('is dark enough to actually dim the page it covers', () => {
    const scrim = css.match(/--color-scrim\s*:\s*(#([0-9a-f]{6}))/i)?.[2];
    expect(scrim, '--color-scrim must be a hex literal').toBeDefined();
    // A dimming scrim has to sit near the dark end in BOTH themes. Checking the
    // channels directly keeps this independent of which surface it covers —
    // the seed, ink-1's light value #0f172a, peaks at 0x2a.
    const channels = [0, 2, 4].map((i) => Number.parseInt((scrim as string).slice(i, i + 2), 16));
    expect(Math.max(...channels), `--color-scrim #${scrim} is too pale to dim`).toBeLessThan(0x40);
  });
});

describe('no fill uses an ink token as a backdrop', () => {
  it('bg-ink-*/<alpha> never reappears in components', async () => {
    const { execSync } = await import('node:child_process');
    const hits = execSync(
      'grep -rln "bg-ink-[0-9]/" src --include=*.tsx --include=*.ts | grep -v "\\.test\\.ts$" || true',
      { encoding: 'utf8' },
    ).trim();
    expect(hits, `translucent ink fills invert in dark mode:\n${hits}`).toBe('');
  });
});
