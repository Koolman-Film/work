'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import type { Locale } from '@/lib/i18n/config';
import { UPDATES } from '@/lib/product-updates/registry';
import { nextAnnounce, pickText, unseenItems } from '@/lib/product-updates/selectors';
import { useProductUpdates } from '@/lib/product-updates/store';
import type { UpdateItem } from '@/lib/product-updates/types';
import { UI } from '@/lib/product-updates/ui-text';
import { ReleaseTeaser } from './release-card';

/** Where the full release notes live. */
export const WHATS_NEW_PATH = '/admin/whats-new';

/**
 * Auto-opens when there is an unseen item flagged `announce`, and shows a
 * TEASER of every unseen release — not just the one that triggered it. The
 * full notes, figures and itemised changes live on /admin/whats-new.
 *
 * `announce` is purely the trigger: it answers "is this release worth
 * interrupting for", not "which entry does the modal display". Selecting one
 * item was the earlier behaviour and it could not survive two entries landing
 * together — the modal showed only the newest, then either popped a second
 * time the instant the first closed, or lost the other entirely. Showing the
 * batch removes the choice, and with it the bug.
 *
 * "Later" (and Esc / backdrop / ×) marks the batch seen and closes. "Read the
 * details" only NAVIGATES: the page marks the batch seen itself, after it has
 * snapshotted which releases are unread — marking here first would leave the
 * page nothing to mark "Unread". The page's mark closes this dialog. The
 * action-needed box is in the teaser, so no path skips it. Only renders once
 * hydrated, so a fresh page never flashes a stale one.
 */
export function AnnouncementModal() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const hydrated = useProductUpdates((s) => s.hydrated);
  const seen = useProductUpdates((s) => s.seen);
  const markManySeen = useProductUpdates((s) => s.markManySeen);
  const startTour = useProductUpdates((s) => s.startTour);

  const pending = hydrated && nextAnnounce(UPDATES, seen) !== null;

  // The batch is snapshotted on the open edge rather than derived per render,
  // because dismissing marks these very ids seen — a derived list would empty
  // itself mid-dismiss and the dialog would visibly go blank while it is still
  // playing its exit transition.
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
        <div className="max-h-[60vh] space-y-5 divide-y divide-line overflow-y-auto pr-1">
          {batch.map((item) => (
            <div key={item.id} className="pt-5 first:pt-0">
              <ReleaseTeaser
                item={item}
                onStartTour={(tourId) => {
                  // Mark seen before starting: the tour destroys this dialog,
                  // and an unacknowledged batch would re-announce next load.
                  dismiss();
                  startTour(tourId);
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg px-3 py-2 text-sm text-ink-2 transition hover:bg-surface-hover-strong"
          >
            {pickText(UI.later, locale)}
          </button>
          <button
            type="button"
            onClick={() => router.push(WHATS_NEW_PATH)}
            className="rounded-lg bg-brand-solid px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-solid-hover"
          >
            {pickText(UI.readDetails, locale)}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
