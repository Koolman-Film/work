'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Horizontally scrollable region with an iOS-style edge affordance: a soft
 * shadow on the side you can still scroll toward, and nothing on the side you
 * have reached.
 *
 * Why this exists rather than the pure-CSS `background-attachment: local`
 * trick it replaces: that paints the shadow as a BACKGROUND, and backgrounds
 * render behind their element's content. Buttons and text in the last column
 * therefore drew on top of the shadow and were hard-clipped at the edge. To
 * sit above content the shadow has to be a sibling overlay outside the
 * scrolling box, which in turn has to be told where the scroll is.
 *
 * The listener is passive and only flips two booleans, so it does not fight
 * the scroll. `overflow-x-auto` still does all the actual scrolling — remove
 * the JS and you lose the shadows, never the ability to reach the content.
 */
export function ScrollArea({
  children,
  className,
  viewportClassName,
}: {
  children: ReactNode;
  /** Classes for the outer wrapper — put the border, radius and background here. */
  className?: string;
  /** Classes for the scrolling viewport itself. */
  viewportClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // A 1px tolerance: fractional layout widths mean scrollLeft rarely lands
    // exactly on 0 or max, and without it the shadow flickers at the ends.
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(max <= 1 || el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    // Content and container both change size — a filter narrowing the rows, a
    // window resize, a column appearing. Watch both or the shadow goes stale.
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [sync]);

  return (
    <div data-scroll-area className={cn('relative', className)}>
      <div ref={ref} className={cn('overflow-x-auto', viewportClassName)}>
        {children}
      </div>

      {/* Overlays are siblings AFTER the viewport, so they paint above its
          content. `pointer-events-none` keeps them out of the way of the
          buttons they cover. Inset by a pixel so they never sit on top of the
          wrapper's own border. */}
      <span
        aria-hidden="true"
        data-scroll-edge="start"
        className={cn(
          'pointer-events-none absolute inset-y-px left-px w-8 rounded-l-[inherit]',
          'bg-gradient-to-r from-[var(--scroll-shadow)] to-transparent',
          'transition-opacity duration-200',
          atStart ? 'opacity-0' : 'opacity-100',
        )}
      />
      <span
        aria-hidden="true"
        data-scroll-edge="end"
        className={cn(
          'pointer-events-none absolute inset-y-px right-px w-8 rounded-r-[inherit]',
          'bg-gradient-to-l from-[var(--scroll-shadow)] to-transparent',
          'transition-opacity duration-200',
          atEnd ? 'opacity-0' : 'opacity-100',
        )}
      />
    </div>
  );
}
