import type { Locale } from '@/lib/i18n/config';
import type { LocalizedText, Tour, UpdateItem } from './types';

/** Localized value for `locale`, falling back to the required `th` source.
 *  `LocalizedText` only declares `th`/`en`; any other locale (my/lo/zh-CN/km)
 *  is intentionally absent and falls back to `th`. The widened index type
 *  models that — reading an undeclared locale yields `undefined`. */
export function pickText(text: LocalizedText, locale: Locale): string {
  return (text as Partial<Record<Locale, string>>)[locale] ?? text.th;
}

/** Newest-first by `date`. Returns a new array; does not mutate input. */
export function sortByDateDesc(items: UpdateItem[]): UpdateItem[] {
  return [...items].sort((a, b) => b.date.localeCompare(a.date));
}

/** Items whose id is not in `seen`, newest-first. */
export function unseenItems(items: UpdateItem[], seen: ReadonlySet<string>): UpdateItem[] {
  return sortByDateDesc(items).filter((i) => !seen.has(i.id));
}

export function unseenCount(items: UpdateItem[], seen: ReadonlySet<string>): number {
  return items.reduce((n, i) => (seen.has(i.id) ? n : n + 1), 0);
}

/** Newest unseen item flagged `announce`, or null. */
export function nextAnnounce(items: UpdateItem[], seen: ReadonlySet<string>): UpdateItem | null {
  return unseenItems(items, seen).find((i) => i.announce) ?? null;
}

export function tourById(tours: Tour[], id: string): Tour | null {
  return tours.find((t) => t.id === id) ?? null;
}
