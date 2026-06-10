'use client';

import { useState } from 'react';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Avatar (Sapphire Editorial): photo when `src` is given, initials otherwise.
 * `tone="amber"` is the Superadmin "สป" treatment from the mockups; default
 * brand for everyone else.
 *
 * Client component: signed storage URLs expire (short TTL), so a long-lived
 * tab can have its photo 401 — onError flips back to initials instead of
 * showing a broken-image glyph.
 */
const sizes = { sm: 'size-8 text-[11px]', md: 'size-9 text-xs', lg: 'size-14 text-lg' } as const;
const tones = {
  brand: 'border-primary-200 bg-primary-50 text-primary-700',
  amber: 'border-accent-400/40 bg-accent-400/20 text-accent-600',
} as const;

export function Avatar({
  name,
  src,
  tone = 'brand',
  size = 'md',
  className,
}: {
  name: string;
  /** Signed photo URL; null/undefined or a load failure falls back to initials. */
  src?: string | null;
  tone?: keyof typeof tones;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center overflow-hidden rounded-full border font-display font-bold',
        sizes[size],
        tones[tone],
        className,
      )}
    >
      {showImage ? (
        // biome-ignore lint/performance/noImgElement: signed storage URL (short-lived, per-request); next/image optimization/caching doesn't apply
        <img
          src={src as string}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
