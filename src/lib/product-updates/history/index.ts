import 'server-only';
import { UPDATES } from '../registry';
import type { UpdateItem } from '../types';
import { RELEASES_2026_05 } from './2026-05';
import { RELEASES_2026_06 } from './2026-06';
import { RELEASES_2026_07 } from './2026-07';
import { RELEASES_2026_08_10 } from './2026-08-10';

/**
 * Releases from go-live (28 May 2026) to October 2026, reconstructed from the
 * git log on 2026-11-05. Every entry is `history: true` — record, never news
 * (see the guide's "Backfilled history" section).
 *
 * SERVER-ONLY, deliberately. This is ~500 KB of six-language copy, and the
 * registry it sits beside is imported by the sidebar and the pop-up on every
 * admin page. History is never unread, so nothing there needs it; only
 * /admin/whats-new does, and its route passes it down as a prop.
 */
export const HISTORY: UpdateItem[] = [
  ...RELEASES_2026_08_10,
  ...RELEASES_2026_07,
  ...RELEASES_2026_06,
  ...RELEASES_2026_05,
];

/** Everything the page shows — the version rules are checked on this set,
 *  because a month's numbering spans both lists (June's welcome is in the
 *  registry, the rest of June is here). */
export const ALL_RELEASES: UpdateItem[] = [...UPDATES, ...HISTORY];

const LOCALE_KEYS = new Set(['th', 'en', 'my', 'lo', 'zh-CN', 'km']);

/** True for a LocalizedText: an object of strings keyed only by locales. */
function isLocalized(v: Record<string, unknown>): boolean {
  const keys = Object.keys(v);
  return (
    keys.length > 0 &&
    keys.includes('th') &&
    keys.every((k) => LOCALE_KEYS.has(k) && typeof v[k] === 'string')
  );
}

function keepLocale(v: unknown, locale: string): unknown {
  if (Array.isArray(v)) return v.map((x) => keepLocale(x, locale));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (isLocalized(o)) {
      // th stays as the fallback pickText relies on.
      return locale === 'th' ? { th: o.th } : { th: o.th, [locale]: o[locale] ?? o.th };
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, keepLocale(x, locale)]));
  }
  return v;
}

/**
 * HISTORY with every LocalizedText cut to one language — what the page
 * actually sends. Six languages of five months is ~800 KB of HTML for text
 * nobody on the page can see: the admin area renders in one locale only.
 */
export function historyFor(locale: string): UpdateItem[] {
  return keepLocale(HISTORY, locale) as UpdateItem[];
}
