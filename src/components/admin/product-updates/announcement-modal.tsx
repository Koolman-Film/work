'use client';

import { Sparkles } from 'lucide-react';
import { useLocale } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import type { Locale } from '@/lib/i18n/config';
import { UPDATES } from '@/lib/product-updates/registry';
import { nextAnnounce, pickText } from '@/lib/product-updates/selectors';
import { useProductUpdates } from '@/lib/product-updates/store';
import { UI } from '@/lib/product-updates/ui-text';

/**
 * Auto-opens when there is an unseen announce item. "Got it" marks just that
 * item seen; "See all" hands off to the What's New panel; "Take the tour"
 * starts the item's tour (also marking it seen). Only renders once hydrated,
 * so a freshly-loaded page never flashes a stale announcement.
 */
export function AnnouncementModal() {
  const locale = useLocale() as Locale;
  const hydrated = useProductUpdates((s) => s.hydrated);
  const seen = useProductUpdates((s) => s.seen);
  const markSeen = useProductUpdates((s) => s.markSeen);
  const openPanel = useProductUpdates((s) => s.openPanel);
  const startTour = useProductUpdates((s) => s.startTour);

  const item = hydrated ? nextAnnounce(UPDATES, seen) : null;
  const open = item !== null;

  function dismiss() {
    if (item) markSeen(item.id);
  }

  return (
    <Dialog open={open} onClose={dismiss} title={item ? pickText(item.title, locale) : undefined}>
      {item && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-700">
              <Sparkles size={18} aria-hidden="true" />
            </span>
            <p className="text-sm leading-relaxed text-ink-2">{pickText(item.body, locale)}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                dismiss();
                openPanel();
              }}
              className="rounded-lg px-3 py-2 text-sm text-ink-2 transition hover:bg-gray-100"
            >
              {pickText(UI.seeAllUpdates, locale)}
            </button>
            {item.tour && (
              <button
                type="button"
                onClick={() => {
                  const tourId = item.tour as string;
                  dismiss();
                  startTour(tourId);
                }}
                className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm font-medium text-ink-1 transition hover:bg-gray-50"
              >
                {pickText(UI.takeTheTour, locale)}
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-primary-700"
            >
              {pickText(UI.gotIt, locale)}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
