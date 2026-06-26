/**
 * Offset pagination helpers for server-component list pages.
 *
 * Every list page drives its state through URL search params (the same pattern
 * as the admin status filters), so pagination is just one more param: ?page=N.
 * A page reads `parsePageParam`, runs `findMany({ ...pageArgs })` alongside a
 * `count()`, then feeds `buildPageMeta` into the shared <Pagination> control.
 *
 * Offset (skip/take) over cursor because the data is server-rendered and the
 * UX wants jumpable, bookmarkable pages — and at HR-app scale the count query
 * and deep-page cost don't matter.
 */

/** Rows per page. One knob for every list. */
export const PAGE_SIZE = 20;

/**
 * Parse a 1-based page number from a raw search-param value. Anything missing,
 * non-numeric, or < 1 clamps to page 1 — a hand-edited or stale URL never
 * throws, it just lands on the first page.
 */
export function parsePageParam(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/** Prisma `skip`/`take` for a given 1-based page. */
export function pageArgs(page: number, pageSize = PAGE_SIZE): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export type PageMeta = {
  /** Clamped to [1, pageCount]. */
  page: number;
  /** At least 1, even when there are no rows. */
  pageCount: number;
  total: number;
  pageSize: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** 1-based index of the first row on this page (0 when empty). */
  from: number;
  /** 1-based index of the last row on this page (0 when empty). */
  to: number;
};

/**
 * Derive display metadata from a total row count. `requestedPage` may exceed
 * the real page count (rows deleted since, or a hand-edited URL); we clamp it
 * so the control never reads "page 9 of 3". (A clamped-down page can still show
 * an empty list when the URL overshot the data — that only happens on stale
 * direct links, never via the Prev/Next controls.)
 */
export function buildPageMeta(
  total: number,
  requestedPage: number,
  pageSize = PAGE_SIZE,
): PageMeta {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return {
    page,
    pageCount,
    total,
    pageSize,
    hasPrev: page > 1,
    hasNext: page < pageCount,
    from,
    to,
  };
}
