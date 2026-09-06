import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards on the theme cross-fade rule in globals.css.
 *
 * There is no DOM environment in this runner (vitest is `environment: 'node'`),
 * so the rule is asserted as source. That is enough for the two ways it can
 * silently go wrong: losing its reduced-motion guard, and animating the design
 * tokens instead of the declarations that consume them.
 */

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const toggle = readFileSync(join(process.cwd(), 'src/components/theme/theme-toggle.tsx'), 'utf8');

/** The `@media (prefers-reduced-motion: no-preference)` block, brace-matched. */
function noPreferenceBlock(): string {
  const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  expect(start, 'the no-preference guard is missing entirely').toBeGreaterThan(-1);

  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unbalanced braces after the no-preference guard');
}

describe('the theme cross-fade', () => {
  it('exists', () => {
    expect(css).toContain('[data-theme-switching]');
  });

  it('is declared ONLY inside the reduced-motion guard', () => {
    // The failure this exists for: both this rule and the global
    // `prefers-reduced-motion: reduce` override carry !important, and this
    // selector is the more specific of the two — so an unguarded copy would
    // win that fight and animate for precisely the people who opted out.
    // Counted on the BRACKETED form only, so the prose in the doc comment
    // above the rule ("<html data-theme-switching>") is not mistaken for a
    // selector and does not buy an escaped rule a free pass.
    const block = noPreferenceBlock();
    const inBlock = (block.match(/\[data-theme-switching\]/g) ?? []).length;
    const inFile = (css.match(/\[data-theme-switching\]/g) ?? []).length;
    expect(inBlock).toBeGreaterThan(0);
    expect(inFile - inBlock, 'a [data-theme-switching] rule escaped the guard').toBe(0);
  });

  it('animates consuming declarations, never the tokens themselves', () => {
    // tests/e2e/theme-toggle.spec.ts reads getPropertyValue('--color-canvas')
    // and expects the new value immediately. Transitioning a custom property
    // would make that assertion time-dependent.
    const block = noPreferenceBlock();
    expect(block).toContain('background-color');
    expect(block).toContain('border-color');
    expect(block).not.toMatch(/transition:[^}]*--color-/);
  });

  it('uses the shared motion tokens rather than hardcoded timings', () => {
    const block = noPreferenceBlock();
    expect(block).toContain('var(--duration-base)');
    expect(block).toContain('var(--ease-out-soft)');
    expect(block, 'hardcoded ms would drift from the rest of the app').not.toMatch(
      /transition:[^}]*\b\d+ms/,
    );
  });
});

describe('the toggle that drives it', () => {
  it('stamps and clears the same attribute the CSS matches', () => {
    expect(toggle).toContain("SWITCHING_ATTR = 'data-theme-switching'");
    expect(toggle).toContain('setAttribute(SWITCHING_ATTR');
    expect(toggle).toContain('removeAttribute(SWITCHING_ATTR)');
  });

  it('clears on the commit, not on a timer started at click', () => {
    // The palette moves when revalidatePath's re-render commits, which is
    // after a server round-trip. A window anchored to the click would often
    // be over before the colours moved.
    expect(toggle).toMatch(/if \(pending\) return;/);
    expect(toggle).toMatch(/}, \[pending\]\);/);
  });

  it('holds the window at least as long as the CSS animates', () => {
    const ms = Number(toggle.match(/SWITCH_MS = (\d+)/)?.[1]);
    const base = Number(css.match(/--duration-base:\s*(\d+)ms/)?.[1]);
    expect(ms, 'SWITCH_MS is missing').toBeGreaterThan(0);
    expect(base, '--duration-base is missing').toBeGreaterThan(0);
    expect(
      ms,
      'the attribute would be pulled mid-fade and the colours snap',
    ).toBeGreaterThanOrEqual(base);
  });
});
