'use client';

import { useRouter } from 'next/navigation';

/**
 * URL-driven search box for server-rendered list pages.
 *
 * Submits on Enter (no debounce — Thai IME fires noisy intermediate events,
 * and these lists are already status-scoped, so live-search isn't worth the
 * extra renders). A new query always resets to page 1; the params in `keep`
 * (e.g. the active status filter) are carried through.
 *
 * Mirrors the employee-list search box, kept deliberately small so the two
 * admin inboxes can share it.
 */
export function ListSearch({
  basePath,
  defaultValue,
  placeholder,
  keep,
  name = 'q',
}: {
  basePath: string;
  defaultValue: string;
  placeholder: string;
  /** Params to preserve across the new search (page is intentionally dropped). */
  keep: Record<string, string | undefined>;
  name?: string;
}) {
  const router = useRouter();

  function go(raw: string) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) params.set(k, v);
    const q = raw.trim();
    if (q) params.set(name, q);
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  return (
    <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go(e.currentTarget.value);
        }}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
      />
    </div>
  );
}
