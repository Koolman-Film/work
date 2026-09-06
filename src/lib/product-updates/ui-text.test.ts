import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/lib/i18n/config';
import { UI } from './ui-text';

/**
 * `i18n-completeness.test.ts` proves every chrome label exists in all six
 * locales. This proves the one label that is a TEMPLATE still works after
 * translation — driver.js substitutes `{{current}}`/`{{total}}` by literal
 * string replace, so a locale that drops or misspells a placeholder renders a
 * counter with a hole in it and nothing else notices.
 */
describe('tour progress template', () => {
  it.each(LOCALES)('%s keeps both placeholders', (locale) => {
    const text = (UI.tourProgress as Record<string, string | undefined>)[locale];
    expect(text, `${locale} is missing`).toBeDefined();
    expect(text).toContain('{{current}}');
    expect(text).toContain('{{total}}');
  });

  it.each(LOCALES)('%s substitutes to a string with no braces left', (locale) => {
    const template = (UI.tourProgress as Record<string, string | undefined>)[locale];
    expect(template, `${locale} is missing`).toBeDefined();
    // Mirrors driver.js's own substitution.
    const rendered = (template as string).replace('{{current}}', '2').replace('{{total}}', '3');
    expect(rendered).not.toContain('{{');
    expect(rendered).not.toContain('}}');
    expect(rendered).toContain('2');
    expect(rendered).toContain('3');
  });
});

describe('tour buttons', () => {
  it.each([
    'tourNext',
    'tourPrev',
    'tourDone',
  ] as const)('%s is translated, not English-only', (key) => {
    const th = (UI[key] as Record<string, string>).th;
    const en = (UI[key] as Record<string, string>).en;
    // The bug this file was written for: driver.js's English defaults showing
    // through in a Thai tour. A Thai value identical to the English one means
    // somebody pasted the default in.
    expect(th).not.toBe(en);
  });
});
