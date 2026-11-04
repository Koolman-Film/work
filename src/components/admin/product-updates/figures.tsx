'use client';

import { ArrowRight } from 'lucide-react';
import { useLocale } from 'next-intl';
import type { Locale } from '@/lib/i18n/config';
import { latnDigits } from '@/lib/i18n/format';
import { timelineLayout } from '@/lib/product-updates/release';
import { pickText } from '@/lib/product-updates/selectors';
import type {
  BeforeAfterFigure,
  ReleaseFigure,
  StepsFigure,
  TimelineFigure,
} from '@/lib/product-updates/types';
import { UI } from '@/lib/product-updates/ui-text';
import { cn } from '@/lib/utils';

/**
 * Release figures, drawn from registry DATA in HTML/CSS — never an image with
 * words in it. Six languages × two themes of one picture is twelve files to
 * keep in step; data renders in the reader's language and theme by itself.
 * HTML rather than SVG so a long Burmese or Khmer label wraps instead of
 * running out of its box.
 *
 * The three templates, and when each fits, are in
 * docs/runbooks/release-notes-guide.md.
 */
export function ReleaseFigureView({ figure }: { figure: ReleaseFigure }) {
  const locale = useLocale() as Locale;
  const body =
    figure.kind === 'timeline' ? (
      <Timeline figure={figure} locale={locale} />
    ) : figure.kind === 'beforeAfter' ? (
      <BeforeAfter figure={figure} locale={locale} />
    ) : (
      <Steps figure={figure} locale={locale} />
    );
  return (
    <figure className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-line bg-surface-muted p-4">
        {body}
      </div>
      {figure.caption && (
        <figcaption className="max-w-prose text-[13px] text-ink-3">
          {pickText(figure.caption, locale)}
        </figcaption>
      )}
    </figure>
  );
}

/** "1 ต.ค." / "1 Oct" — day and short month, no year: the range sits in one
 *  stretch of time, and a Gregorian year would fight the Thai UI's BE dates. */
function shortDay(ymd: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH-u-ca-gregory' : latnDigits(locale), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${ymd}T00:00:00.000Z`));
}

function shortMonth(ym: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH-u-ca-gregory' : latnDigits(locale), {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${ym}-15T00:00:00.000Z`));
}

const BAR_TONE = {
  muted: 'bg-surface-sunken text-ink-1 ring-1 ring-inset ring-line',
  brand: 'bg-brand-solid text-white',
  highlight: 'bg-warning-solid text-ink-1',
} as const;

function Timeline({ figure, locale }: { figure: TimelineFigure; locale: Locale }) {
  const { rows, ticks } = timelineLayout(figure);
  return (
    <div className="min-w-[560px]">
      {/* Month ticks, over the track column only. */}
      <div className="grid grid-cols-[minmax(9rem,11rem)_1fr] gap-3">
        <span />
        <div className="relative h-5">
          {ticks.map((t) => (
            <span
              key={t.ymd}
              className="absolute top-0 whitespace-nowrap pl-1 text-[11px] text-ink-4"
              style={{ left: `${t.left}%` }}
            >
              {shortDay(t.ymd, locale)}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-2.5">
        {rows.map((row, rowIndex) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: registry data, static order
            key={rowIndex}
            className="grid grid-cols-[minmax(9rem,11rem)_1fr] items-center gap-3"
          >
            <span className="text-[13px] font-semibold leading-snug text-ink-2">
              {pickText(row.label, locale)}
            </span>
            <div className="relative h-8">
              {ticks.map((t) => (
                <span
                  key={t.ymd}
                  aria-hidden="true"
                  className="absolute inset-y-[-6px] border-l border-dashed border-line-strong"
                  style={{ left: `${t.left}%` }}
                />
              ))}
              {row.bars.map((bar, barIndex) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: registry data, static order
                  key={barIndex}
                  title={`${shortDay(bar.from, locale)} – ${shortDay(bar.to, locale)}`}
                  className={cn(
                    'absolute inset-y-0 flex items-center overflow-hidden rounded-md px-2 text-xs font-semibold',
                    BAR_TONE[bar.tone],
                  )}
                  style={{ left: `calc(${bar.left}% + 1.5px)`, width: `calc(${bar.width}% - 3px)` }}
                >
                  <span className="truncate">
                    {shortMonth(bar.month, locale)}
                    {bar.note ? ` (${pickText(bar.note, locale)})` : ''}
                  </span>
                  {/* The exact range, for screen readers and touch: `title`
                      only shows on hover. */}
                  <span className="sr-only">
                    {` ${shortDay(bar.from, locale)} – ${shortDay(bar.to, locale)}`}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-[minmax(9rem,11rem)_1fr] gap-3 text-[11px] text-ink-4">
        <span />
        <div className="flex justify-between">
          <span>{shortDay(figure.from, locale)}</span>
          <span>{shortDay(figure.to, locale)}</span>
        </div>
      </div>
    </div>
  );
}

function BeforeAfter({ figure, locale }: { figure: BeforeAfterFigure; locale: Locale }) {
  const panel = (p: BeforeAfterFigure['before'], tag: string) => (
    <div className="min-w-0 flex-1 space-y-2">
      <p className="text-[13px] font-semibold text-ink-1">
        <span className="mr-1.5 rounded bg-surface-sunken px-1.5 py-0.5 text-[11px] text-ink-3">
          {tag}
        </span>
        {pickText(p.title, locale)}
      </p>
      <ul className="space-y-1.5">
        {p.rows.map((r, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: registry data, static order
            key={i}
            className={cn(
              'flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-[13px]',
              r.off
                ? 'bg-warning-solid font-semibold text-ink-1'
                : 'bg-surface text-ink-1 ring-1 ring-inset ring-line',
            )}
          >
            <span className="font-semibold">{r.label}</span>
            <span className={cn('text-right', r.off ? '' : 'text-ink-3')}>
              {pickText(r.off ? UI.figureOff : UI.figureWorking, locale)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
      {panel(figure.before, pickText(UI.figureBefore, locale))}
      <ArrowRight
        aria-hidden="true"
        className="mx-auto shrink-0 rotate-90 text-ink-3 sm:rotate-0"
        size={20}
      />
      {panel(figure.after, pickText(UI.figureAfter, locale))}
    </div>
  );
}

function Steps({ figure, locale }: { figure: StepsFigure; locale: Locale }) {
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      {figure.steps.map((s, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: registry data, static order
          key={i}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg border border-amber-200 bg-surface p-3"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-warning-solid font-display text-xs font-bold text-ink-1">
            {i + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-ink-1">
              {pickText(s.title, locale)}
            </span>
            <span className="block text-[13px] text-ink-2">{pickText(s.detail, locale)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
