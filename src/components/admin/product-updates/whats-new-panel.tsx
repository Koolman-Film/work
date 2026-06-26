'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';
import { Dialog } from '@/components/ui/dialog';
import type { Locale } from '@/lib/i18n/config';
import { UPDATES } from '@/lib/product-updates/registry';
import { pickText, sortByDateDesc, unseenItems } from '@/lib/product-updates/selectors';
import { useProductUpdates } from '@/lib/product-updates/store';

/**
 * Lists all updates newest-first. Opening the panel marks every listed item
 * seen (clears the sidebar dot). Items with a tour show a replay button; tours
 * stay replayable regardless of seen-state.
 */
export function WhatsNewPanel() {
  const locale = useLocale() as Locale;
  const panelOpen = useProductUpdates((s) => s.panelOpen);
  const closePanel = useProductUpdates((s) => s.closePanel);
  const seen = useProductUpdates((s) => s.seen);
  const markManySeen = useProductUpdates((s) => s.markManySeen);
  const startTour = useProductUpdates((s) => s.startTour);

  // On open, mark everything currently unseen as seen.
  // Intentionally run only when the panel transitions open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open-edge only
  useEffect(() => {
    if (!panelOpen) return;
    const unseenIds = unseenItems(UPDATES, seen).map((i) => i.id);
    if (unseenIds.length > 0) markManySeen(unseenIds);
  }, [panelOpen]);

  const items = sortByDateDesc(UPDATES);

  return (
    <Dialog
      open={panelOpen}
      onClose={closePanel}
      title={locale === 'en' ? "What's New" : 'มีอะไรใหม่'}
    >
      <ul className="divide-y divide-gray-100">
        {items.map((item) => (
          <li key={item.id} className="py-3 first:pt-0 last:pb-0">
            <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-4">
              {item.date}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-ink-1">
              {pickText(item.title, locale)}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">{pickText(item.body, locale)}</p>
            {item.tour && (
              <button
                type="button"
                onClick={() => {
                  const tourId = item.tour as string;
                  closePanel();
                  startTour(tourId);
                }}
                className="mt-2 text-sm font-medium text-primary-700 transition hover:text-primary-800"
              >
                {locale === 'en' ? 'Take the tour →' : 'ดูทัวร์แนะนำ →'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
