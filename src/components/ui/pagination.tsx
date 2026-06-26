import Link from 'next/link';
import type { PageMeta } from '@/lib/pagination';
import { cn } from '@/lib/utils';

/**
 * Pager for server-rendered list pages: « ก่อนหน้า · หน้า X / Y · ถัดไป ».
 *
 * Renders nothing when there's a single page (nothing to navigate). Each page
 * supplies `makeHref(page)` so it can preserve its own params (status, q, …) —
 * the pager stays ignorant of any one list's URL shape. Labels default to Thai
 * (the admin UI is Thai-only); LIFF passes translated labels via `labels`.
 *
 * Server component — `makeHref` is invoked here to produce plain <Link>s, so no
 * function ever crosses a client boundary.
 */

type Labels = { prev: string; next: string; summary: (m: PageMeta) => string };

const TH_LABELS: Labels = {
  prev: 'ก่อนหน้า',
  next: 'ถัดไป',
  summary: (m) => `หน้า ${m.page} / ${m.pageCount}`,
};

export function Pagination({
  meta,
  makeHref,
  className,
  labels,
}: {
  meta: PageMeta;
  makeHref: (page: number) => string;
  className?: string;
  labels?: Partial<Labels>;
}) {
  // One page (or none) — nothing to navigate.
  if (meta.pageCount <= 1) return null;

  const l = { ...TH_LABELS, ...labels };
  const base = 'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold';
  const enabled = 'text-ink-2 hover:bg-gray-50 hover:text-ink-1';
  const disabled = 'cursor-not-allowed text-ink-4';

  return (
    <nav
      className={cn('flex items-center justify-between gap-2', className)}
      aria-label="การแบ่งหน้า"
    >
      {meta.hasPrev ? (
        <Link href={makeHref(meta.page - 1)} rel="prev" className={cn(base, enabled)}>
          <Chevron dir="left" />
          {l.prev}
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(base, disabled)}>
          <Chevron dir="left" />
          {l.prev}
        </span>
      )}

      <span className="text-xs tabular-nums text-ink-3">{l.summary(meta)}</span>

      {meta.hasNext ? (
        <Link href={makeHref(meta.page + 1)} rel="next" className={cn(base, enabled)}>
          {l.next}
          <Chevron dir="right" />
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(base, disabled)}>
          {l.next}
          <Chevron dir="right" />
        </span>
      )}
    </nav>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path
        d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
