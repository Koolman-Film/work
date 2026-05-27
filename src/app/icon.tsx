/**
 * Dynamic favicon for the Koolman Work app.
 *
 * Next.js 16 App Router auto-wires `src/app/icon.tsx` into the HTML
 * `<link rel="icon">` tag for every page. We use `ImageResponse` from
 * `next/og` to generate a 32x32 PNG at build time — the "KM" initials
 * on primary-600 background, matching the login screen logo block.
 *
 * Generated once at build, cached forever. No runtime cost beyond the
 * first request after a deploy. The browser caches the resulting PNG
 * via standard image-cache headers.
 *
 * If you swap brand colors (currently `#4f46e5` ≈ primary-600), update
 * the `background` value below to match.
 */

import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        fontSize: 18,
        background: '#4f46e5',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: 800,
        letterSpacing: '-1px',
        borderRadius: 6,
      }}
    >
      KM
    </div>,
    size,
  );
}
