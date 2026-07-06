import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/lib/i18n/config';
import { UPDATES } from './registry';
import { TOURS } from './tours';
import type { LocalizedText } from './types';
import { UI } from './ui-text';

/**
 * Guards that every shipped LocalizedText carries all 6 supported locales,
 * each a non-empty string. A new tour/announcement/chrome label with only
 * th/en fails here rather than silently falling back to Thai.
 */

// [label, LocalizedText] pairs across every product-updates surface.
function allStrings(): Array<[string, LocalizedText]> {
  const out: Array<[string, LocalizedText]> = [];
  for (const tour of TOURS) {
    for (const step of tour.steps) {
      out.push([`tour ${tour.id}/${step.anchor} title`, step.title]);
      out.push([`tour ${tour.id}/${step.anchor} body`, step.body]);
    }
  }
  for (const item of UPDATES) {
    out.push([`update ${item.id} title`, item.title]);
    out.push([`update ${item.id} body`, item.body]);
  }
  for (const [key, value] of Object.entries(UI)) {
    out.push([`ui ${key}`, value]);
  }
  return out;
}

describe('product-updates i18n completeness', () => {
  it.each(allStrings())('%s has all 6 locales, non-empty', (_label, text) => {
    const record = text as Record<string, unknown>;
    for (const locale of LOCALES) {
      expect(typeof record[locale]).toBe('string');
      expect((record[locale] as string).length).toBeGreaterThan(0);
    }
  });

  // Defense-in-depth: catch a typo'd/extra locale key (e.g. 'zn-CN', 'en-US')
  // that would never render — the widened type rejects these at authoring
  // sites, but an `as`/`@ts-expect-error` cast could slip one through.
  it.each(allStrings())('%s has no unknown locale keys', (_label, text) => {
    const allowed = new Set<string>(LOCALES);
    for (const key of Object.keys(text)) {
      expect(allowed.has(key)).toBe(true);
    }
  });
});
