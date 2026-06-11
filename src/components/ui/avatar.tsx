'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Avatar (Sapphire Editorial): photo when `src` is given, initials otherwise.
 * `tone="amber"` is the Superadmin "สป" treatment from the mockups; default
 * brand for everyone else.
 *
 * Photo avatars are interactive: hover shows an enlarged floating preview,
 * click opens a full-size modal. Initials-only avatars stay decorative.
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
  // Viewport coords of the hovered avatar; the preview is `fixed`-positioned
  // so it escapes overflow-clipping table wrappers.
  const [hoverAt, setHoverAt] = useState<{ x: number; y: number } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const showImage = Boolean(src) && !failed;

  const circle = cn(
    'inline-grid shrink-0 place-items-center overflow-hidden rounded-full border font-display font-bold',
    sizes[size],
    tones[tone],
    className,
  );

  if (!showImage) {
    return (
      <span aria-hidden="true" className={circle}>
        {initials(name)}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={name}
        className={cn(circle, 'cursor-zoom-in')}
        onClick={() => {
          setHoverAt(null);
          setModalOpen(true);
        }}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHoverAt({ x: r.left + r.width / 2, y: r.top });
        }}
        onMouseLeave={() => setHoverAt(null)}
        onFocus={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHoverAt({ x: r.left + r.width / 2, y: r.top });
        }}
        onBlur={() => setHoverAt(null)}
      >
        {/* biome-ignore lint/performance/noImgElement: signed storage URL (short-lived, per-request); next/image optimization/caching doesn't apply */}
        <img
          src={src as string}
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      </button>

      {/* Hover preview — enlarged photo floating above the avatar. */}
      {hoverAt && !modalOpen && (
        <span
          aria-hidden="true"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full pb-2"
          style={{ left: hoverAt.x, top: hoverAt.y }}
        >
          <span className="block overflow-hidden rounded-xl border border-primary-200 bg-white shadow-hero">
            {/* biome-ignore lint/performance/noImgElement: same signed URL as the avatar — already cached by the browser */}
            <img src={src as string} alt="" className="size-40 object-cover" />
          </span>
        </span>
      )}

      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} title={name}>
        {/* biome-ignore lint/performance/noImgElement: signed storage URL; next/image doesn't apply */}
        <img
          src={src as string}
          alt={name}
          className="mt-3 aspect-square w-full rounded-xl object-cover"
        />
      </Dialog>
    </>
  );
}
