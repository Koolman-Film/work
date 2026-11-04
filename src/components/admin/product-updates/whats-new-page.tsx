'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import type { Locale } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';
import { UPDATES } from '@/lib/product-updates/registry';
import { sortReleasesDesc, versionAnchor } from '@/lib/product-updates/release';
import { pickText, unseenItems } from '@/lib/product-updates/selectors';
import { useProductUpdates } from '@/lib/product-updates/store';
import { UI } from '@/lib/product-updates/ui-text';
import { cn } from '@/lib/utils';
import { ReleaseCard } from './release-card';

/**
 * /admin/whats-new — the full release history, newest first, with a version
 * rail. Opening the page marks everything seen (clears the sidebar dot), but
 * the "Unread" marks are snapshotted first so the reader can still see which
 * releases are new to them on this visit. Tours stay replayable regardless.
 */
export function WhatsNewPage() {
  const locale = useLocale() as Locale;
  const hydrated = useProductUpdates((s) => s.hydrated);
  const seen = useProductUpdates((s) => s.seen);
  const markManySeen = useProductUpdates((s) => s.markManySeen);
  const startTour = useProductUpdates((s) => s.startTour);
  const releases = sortReleasesDesc(UPDATES);

  const [unread, setUnread] = useState<ReadonlySet<string> | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrate edge only; `seen` is read once
  useEffect(() => {
    if (!hydrated || unread) return;
    const ids = unseenItems(UPDATES, seen).map((i) => i.id);
    setUnread(new Set(ids));
    if (ids.length > 0) markManySeen(ids);
  }, [hydrated]);

  return (
    <>
      <PageHeader
        title={pickText(UI.whatsNewTitle, locale)}
        subtitle={pickText(UI.pageSubtitle, locale)}
      />
      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav
          aria-label={pickText(UI.versionList, locale)}
          className="flex gap-1.5 overflow-x-auto lg:sticky lg:top-24 lg:flex-col lg:self-start"
        >
          {releases.map((r) => (
            <a
              key={r.id}
              href={`#${versionAnchor(r.version)}`}
              className="grid shrink-0 grid-cols-[auto_1fr] items-center gap-x-2.5 rounded-lg px-3 py-2 transition hover:bg-surface-hover-strong"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'row-span-2 size-2 rounded-full',
                  unread?.has(r.id) ? 'bg-brand-solid' : 'bg-line-strong',
                )}
              />
              <span className="font-mono text-[13px] text-ink-1">{r.version}</span>
              <span className="text-xs text-ink-4">
                {formatDate(new Date(`${r.date}T00:00:00.000Z`), locale)}
              </span>
            </a>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          {releases.map((r) => (
            <ReleaseCard
              key={r.id}
              item={r}
              unread={unread?.has(r.id) ?? false}
              onStartTour={startTour}
            />
          ))}
        </div>
      </div>
    </>
  );
}
