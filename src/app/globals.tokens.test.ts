import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `bg-`/`text-`/`border-…` class built on one of OUR token families must
 * name a token that actually exists.
 *
 * Tailwind emits nothing at all for an unknown utility — no error, no warning,
 * just a missing declaration — so a typo'd token is invisible until someone
 * notices the colour is gone. The contrast suite cannot catch it either, since
 * a mis-tokened element usually has no text of its own (a progress bar, a
 * status dot, a swatch).
 *
 * This exists because a bulk rename produced `bg-warning-fill-solid` and
 * `bg-success-fill-solid-hover` — a regex whose `\b` matched inside an
 * already-renamed class. Eight usages silently lost their background, and only
 * the formatter noticed, by accident.
 *
 * Scoped to the app's own token families on purpose: Tailwind's built-in
 * palette and spacing scales are not declared in globals.css and would produce
 * thousands of false positives.
 */

const OUR_FAMILIES =
  /^(surface|ink|line|canvas|brand|danger|success|warning|info|primary|accent)(-|$)/;

const UTILITIES = 'bg|text|border|ring|divide|from|to|via|fill|stroke|placeholder|outline';

describe('token classes resolve to declared tokens', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
  const declared = new Set(
    [...css.matchAll(/--color-([a-z0-9-]+)\s*:/gi)].map((m) => (m[1] as string).toLowerCase()),
  );

  it('globals.css declares a plausible number of colour tokens', () => {
    expect(declared.size).toBeGreaterThan(30);
  });

  it('every app-token class used in .tsx names a declared token', () => {
    const out = execFileSync(
      'grep',
      ['-rhoE', `\\b(${UTILITIES})-[a-z][a-z0-9-]*`, 'src', '--include=*.tsx'],
      { encoding: 'utf8', cwd: process.cwd() },
    );

    const broken = new Map<string, number>();
    for (const raw of out.split('\n')) {
      if (!raw) continue;
      const value = raw.slice(raw.indexOf('-') + 1).split('/')[0] as string;
      if (!OUR_FAMILIES.test(value)) continue;
      if (declared.has(value)) continue;
      broken.set(raw, (broken.get(raw) ?? 0) + 1);
    }

    expect(
      [...broken.entries()].map(([cls, n]) => `${cls} (${n}x)`),
      'these classes name a token that does not exist — Tailwind emits nothing for them',
    ).toEqual([]);
  });
});
