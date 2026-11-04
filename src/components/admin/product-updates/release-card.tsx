'use client';

import { ArrowRight, ArrowUp, Sparkles, TriangleAlert, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ActionLink } from '@/components/ui/action-link';
import type { Locale } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';
import { versionAnchor } from '@/lib/product-updates/release';
import { pickText } from '@/lib/product-updates/selectors';
import type { Audience, ChangeKind, UpdateItem } from '@/lib/product-updates/types';
import { UI } from '@/lib/product-updates/ui-text';
import { cn } from '@/lib/utils';
import { ReleaseFigureView } from './figures';
import { RichBody } from './rich-body';

/**
 * One release, in the order a reader needs it: which version and when, what
 * they can now do, the one thing they must do (if any), the picture that
 * explains it, then the itemised changes. The anatomy and its rules are in
 * docs/runbooks/release-notes-guide.md — keep the two in step.
 */

const KIND: Record<
  ChangeKind,
  { label: keyof typeof UI; icon: typeof Sparkles; className: string }
> = {
  new: { label: 'kindNew', icon: Sparkles, className: 'bg-primary-50 text-primary-800' },
  improved: {
    label: 'kindImproved',
    icon: ArrowUp,
    className: 'bg-success-soft text-success-deep',
  },
  fixed: { label: 'kindFixed', icon: Wrench, className: 'bg-surface-sunken text-ink-2' },
};

const AUDIENCE: Record<Audience, keyof typeof UI> = {
  admin: 'audienceAdmin',
  payroll: 'audiencePayroll',
  employee: 'audienceEmployee',
};

function releaseDate(ymd: string, locale: Locale): string {
  return formatDate(new Date(`${ymd}T00:00:00.000Z`), locale);
}

export function ReleaseMeta({ item, unread }: { item: UpdateItem; unread?: boolean }) {
  const locale = useLocale() as Locale;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-4">
      <span className="rounded-full bg-primary-50 px-2.5 py-0.5 font-mono text-[13px] text-primary-800">
        {pickText(UI.version, locale)} {item.version}
      </span>
      <time dateTime={item.date}>{releaseDate(item.date, locale)}</time>
      {unread && (
        <span className="font-semibold text-primary-700">
          <span aria-hidden="true">● </span>
          {pickText(UI.unread, locale)}
        </span>
      )}
    </p>
  );
}

export function ActionNeeded({ item, withFigure }: { item: UpdateItem; withFigure: boolean }) {
  const locale = useLocale() as Locale;
  if (!item.action) return null;
  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="flex items-center gap-2 font-semibold text-amber-900">
        <TriangleAlert size={16} aria-hidden="true" />
        {pickText(UI.actionNeeded, locale)}
      </p>
      <p className="text-sm leading-relaxed text-ink-1">{pickText(item.action.text, locale)}</p>
      {withFigure && item.action.figure && <ReleaseFigureView figure={item.action.figure} />}
    </div>
  );
}

export function ReleaseCard({
  item,
  unread,
  onStartTour,
}: {
  item: UpdateItem;
  unread: boolean;
  onStartTour: (tourId: string) => void;
}) {
  const locale = useLocale() as Locale;
  const full = Boolean(item.items?.length || item.figure || item.action);

  return (
    <article
      id={versionAnchor(item.version)}
      className={cn(
        'scroll-mt-24 rounded-2xl border border-line bg-surface',
        full ? 'space-y-5 p-6' : 'space-y-2.5 px-6 py-5',
      )}
    >
      <ReleaseMeta item={item} unread={unread} />
      <h2
        className={cn(
          'text-balance font-bold leading-snug text-ink-1',
          full ? 'text-xl' : 'text-base',
        )}
      >
        {pickText(item.title, locale)}
      </h2>
      <RichBody source={pickText(item.summary, locale)} className="max-w-prose text-sm" />
      <ActionNeeded item={item} withFigure />
      {item.figure && <ReleaseFigureView figure={item.figure} />}

      {item.items && item.items.length > 0 && (
        <ul className="divide-y divide-line">
          {item.items.map((c, i) => {
            const kind = KIND[c.kind];
            const Icon = kind.icon;
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: registry data, static order
                key={i}
                className="grid grid-cols-1 gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]"
              >
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 self-start justify-self-start whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    kind.className,
                  )}
                >
                  <Icon size={13} aria-hidden="true" />
                  {pickText(UI[kind.label], locale)}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-1">{pickText(c.text, locale)}</p>
                  {c.detail && <p className="text-sm text-ink-3">{pickText(c.detail, locale)}</p>}
                </div>
                <span className="self-start justify-self-start whitespace-nowrap rounded-full border border-line px-2 py-px text-xs text-ink-4 sm:justify-self-end">
                  {pickText(UI[AUDIENCE[c.audience]], locale)}
                </span>
                {c.figure && (
                  <div className="mt-2 sm:col-start-2 sm:col-end-4">
                    <ReleaseFigureView figure={c.figure} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(item.links?.length || item.tour) && (
        <div className="flex flex-wrap items-center gap-2.5">
          {item.links?.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition',
                l.primary
                  ? 'bg-brand-solid text-white hover:bg-brand-solid-hover'
                  : 'border border-line bg-surface text-ink-1 hover:bg-surface-hover-strong',
              )}
            >
              {pickText(l.label, locale)}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ))}
          {item.tour && (
            <ActionLink
              onClick={() => onStartTour(item.tour as string)}
              label={pickText(UI.takeTheTour, locale)}
              icon={Sparkles}
            />
          )}
        </div>
      )}
    </article>
  );
}

/** The pop-up's short form: enough to decide whether to read on, and the
 *  action-needed box always — that is the one part nobody may miss. Keeps the
 *  tour button, so a new admin can start the welcome tour from the pop-up. */
export function ReleaseTeaser({
  item,
  onStartTour,
}: {
  item: UpdateItem;
  onStartTour: (tourId: string) => void;
}) {
  const locale = useLocale() as Locale;
  const more = item.items?.length ?? 0;
  return (
    <div className="space-y-3">
      <ReleaseMeta item={item} />
      <p className="text-balance text-base font-bold leading-snug text-ink-1">
        {pickText(item.title, locale)}
      </p>
      <RichBody source={pickText(item.summary, locale)} className="text-sm" />
      <ActionNeeded item={item} withFigure={false} />
      {more > 0 && (
        <p className="text-[13px] text-ink-4">
          {pickText(UI.moreChanges, locale).replace('{n}', String(more))}
        </p>
      )}
      {item.tour && (
        <ActionLink
          onClick={() => onStartTour(item.tour as string)}
          label={pickText(UI.takeTheTour, locale)}
          icon={Sparkles}
        />
      )}
    </div>
  );
}
