'use client';

import { useLocale } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { type Inline, parseBody } from '@/lib/product-updates/rich-text';
import { pickText } from '@/lib/product-updates/selectors';
import type { UpdateItem } from '@/lib/product-updates/types';
import { UI } from '@/lib/product-updates/ui-text';
import { cn } from '@/lib/utils';

/**
 * The update entries, rendered identically wherever they appear.
 *
 * Both surfaces show the same content and differ only in how they OPEN — the
 * announcement modal is pushed at you, the What's New panel is pulled up. That
 * distinction belongs to the containers, not to the list, so this component is
 * the single place a row's shape is defined and the two cannot drift apart.
 *
 * `onStartTour` is a callback rather than a direct `startTour` call because
 * each surface has to clean itself up first: the panel closes, the modal marks
 * its batch seen. A driver.js overlay stacked under an open dialog is
 * unusable.
 */

type Props = {
  /** Already ordered by the caller — this component does not sort. */
  items: UpdateItem[];
  onStartTour: (tourId: string) => void;
  /** Cap before the list scrolls. Tailwind max-h-* class. */
  maxHeightClassName?: string;
};

export function UpdateList({ items, onStartTour, maxHeightClassName = 'max-h-[60vh]' }: Props) {
  const locale = useLocale() as Locale;
  const ref = useRef<HTMLUListElement>(null);
  const [atEnd, setAtEnd] = useState(true);

  // A list clipped by max-height with no cue reads as "that is all there is",
  // which is the exact failure ScrollArea was built to fix for tables. This
  // does the vertical equivalent inline rather than widening ScrollArea: that
  // component is horizontal-only by construction and has 14 call sites in
  // table code, none of which should absorb risk for a dialog.
  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    // 1px tolerance — fractional layout heights mean scrollTop rarely lands
    // exactly on max, and without it the fade flickers at the bottom.
    setAtEnd(max <= 1 || el.scrollTop >= max - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    // The viewport and its content both change size — the modal's batch
    // differs per reader, and a dialog animates its own height on open.
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [sync]);

  return (
    <div className="relative">
      <ul
        ref={ref}
        className={cn('divide-y divide-line-soft overflow-y-auto pr-1', maxHeightClassName)}
      >
        {items.map((item) => (
          <li key={item.id} className="py-3 first:pt-0 last:pb-0">
            <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-4">
              {item.date}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-ink-1">
              {pickText(item.title, locale)}
            </p>
            <Body source={pickText(item.body, locale)} />
            {item.tour && (
              <button
                type="button"
                onClick={() => onStartTour(item.tour as string)}
                className="mt-2 text-sm font-medium text-primary-700 transition hover:text-primary-800"
              >
                {pickText(UI.takeTheTourArrow, locale)}
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* Sibling AFTER the viewport so it paints above the rows it covers, and
          pointer-events-none so it never eats a click on a tour button. */}
      <span
        aria-hidden="true"
        data-scroll-edge="end"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-8',
          'bg-gradient-to-t from-[var(--scroll-shadow)] to-transparent',
          'transition-opacity duration-200',
          atEnd ? 'opacity-0' : 'opacity-100',
        )}
      />
    </div>
  );
}

/**
 * Renders a body's token tree. Builds React elements from tokens — the parser
 * never emits HTML, so there is no injection path from registry copy.
 *
 * Index keys throughout: blocks and spans are positional, derived fresh from
 * immutable copy on every render, and can never reorder or be inserted into.
 * That is the exact case the key warning does not apply to.
 */
function Body({ source }: { source: string }) {
  const blocks = parseBody(source);

  return (
    <div className="mt-1 space-y-1.5 text-sm leading-relaxed text-ink-2">
      {blocks.map((block, i) =>
        block.kind === 'list' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <ul className="space-y-1" key={i}>
            {block.items.map((item, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
              <li className={BULLET} key={j}>
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <p key={i}>
            <Spans spans={block.spans} />
          </p>
        ),
      )}
    </div>
  );
}

// The marker is a ::before dot rather than list-style, so a wrapped bullet's
// second line aligns under the text instead of under the dot. Thai wraps often
// at dialog width, which makes that difference very visible.
const BULLET =
  'relative pl-4 before:absolute before:left-1 before:top-[0.55em] before:size-1 before:rounded-full before:bg-ink-4';

// Not <mark>: the UA default is a yellow that fights both themes and fails
// contrast in dark. A brand-tinted chip carries the same "do not miss this"
// weight and is theme-aware by construction.
const MARK = 'rounded bg-primary-50 px-1 font-medium text-primary-800';

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((span, i) =>
        span.bold ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <strong className="font-semibold text-ink-1" key={i}>
            {span.text}
          </strong>
        ) : span.italic ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <em key={i}>{span.text}</em>
        ) : span.mark ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <span className={MARK} key={i}>
            {span.text}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, never reordered
          <span key={i}>{span.text}</span>
        ),
      )}
    </>
  );
}
