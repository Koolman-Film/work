'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import type { Locale } from '@/lib/i18n/config';
import { UPDATES } from '@/lib/product-updates/registry';
import { nextAnnounce, pickText, unseenItems } from '@/lib/product-updates/selectors';
import { useProductUpdates } from '@/lib/product-updates/store';
import type { UpdateItem } from '@/lib/product-updates/types';
import { UI } from '@/lib/product-updates/ui-text';
import { UpdateList } from './update-list';

/**
 * Auto-opens when there is an unseen item flagged `announce`, and shows
 * EVERY unseen item — not just the one that triggered it.
 *
 * `announce` is purely the trigger: it answers "is this release worth
 * interrupting for", not "which entry does the modal display". Selecting one
 * item was the earlier behaviour and it could not survive two entries landing
 * together — the modal showed only the newest, then either popped a second
 * time the instant the first closed, or lost the other entirely when the
 * reader took "See all" (which marks everything seen on the way out). Showing
 * the batch removes the choice, and with it the bug.
 *
 * "Got it" marks the whole batch seen; "See all" hands off to the panel for
 * the full history. Only renders once hydrated, so a freshly-loaded page never
 * flashes a stale announcement.
 */
export function AnnouncementModal() {
  const locale = useLocale() as Locale;
  const hydrated = useProductUpdates((s) => s.hydrated);
  const seen = useProductUpdates((s) => s.seen);
  const markManySeen = useProductUpdates((s) => s.markManySeen);
  const openPanel = useProductUpdates((s) => s.openPanel);
  const startTour = useProductUpdates((s) => s.startTour);

  const pending = hydrated && nextAnnounce(UPDATES, seen) !== null;

  // The batch is snapshotted on the open edge rather than derived per render,
  // because dismissing marks these very ids seen — a derived list would empty
  // itself mid-dismiss and the panel would visibly go blank while the Dialog
  // is still playing its exit transition.
  const [batch, setBatch] = useState<UpdateItem[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: open-edge only; `seen` is read once, deliberately
  useEffect(() => {
    if (!pending) return;
    setBatch(unseenItems(UPDATES, seen));
  }, [pending]);

  const open = pending && batch.length > 0;

  function dismiss() {
    const ids = batch.map((i) => i.id);
    if (ids.length > 0) markManySeen(ids);
  }

  return (
    <Dialog open={open} onClose={dismiss} title={pickText(UI.whatsNewTitle, locale)}>
      <div className="space-y-4">
        <UpdateList
          items={batch}
          onStartTour={(tourId) => {
            // Mark seen before starting: the tour destroys this dialog, and an
            // unacknowledged batch would re-announce on the next page load.
            dismiss();
            startTour(tourId);
          }}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              dismiss();
              openPanel();
            }}
            className="rounded-lg px-3 py-2 text-sm text-ink-2 transition hover:bg-surface-hover-strong"
          >
            {pickText(UI.seeAllUpdates, locale)}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg bg-brand-solid px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-solid-hover"
          >
            {pickText(UI.gotIt, locale)}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
