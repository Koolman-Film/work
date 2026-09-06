'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';
import { Dialog } from '@/components/ui/dialog';
import type { Locale } from '@/lib/i18n/config';
import { UPDATES } from '@/lib/product-updates/registry';
import { pickText, sortByDateDesc, unseenItems } from '@/lib/product-updates/selectors';
import { useProductUpdates } from '@/lib/product-updates/store';
import { UI } from '@/lib/product-updates/ui-text';
import { UpdateList } from './update-list';

/**
 * The full history, newest-first — every entry, not just the unseen ones.
 * That is the difference from the announcement modal, which carries only what
 * is new to this reader. Opening the panel marks everything seen (clears the
 * sidebar dot). Tours stay replayable regardless of seen-state.
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

  return (
    <Dialog open={panelOpen} onClose={closePanel} title={pickText(UI.whatsNewTitle, locale)}>
      <UpdateList
        items={sortByDateDesc(UPDATES)}
        onStartTour={(tourId) => {
          closePanel();
          startTour(tourId);
        }}
      />
    </Dialog>
  );
}
