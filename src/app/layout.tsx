import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Koolman Work',
  description: 'ระบบ HR สำหรับ Koolman',
  // Default to Thai; per-route localization will refine later via next-intl
};

/**
 * Pin all Vercel function execution to Singapore.
 *
 * Why: Supabase prod project is in ap-southeast-1 (Singapore). Without
 * this hint, Vercel defaults to iad1 (Washington) — every DB query then
 * crosses the Pacific (~250ms round-trip), turning a 9-query dashboard
 * into a 2-second wait. Pinning to sin1 puts the function ~5ms from the
 * database. Measured ~6× speedup on /admin.
 *
 * Hobby tier supports a SINGLE region (chosen here). On Pro you could
 * add more regions for multi-region failover.
 *
 * Also configurable in Vercel UI → Project Settings → Functions →
 * Function Region. The code value here is the source of truth; the UI
 * setting is a belt-and-suspenders fallback if `preferredRegion` is
 * ever ignored by a future Vercel runtime change.
 */
export const preferredRegion = 'sin1';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-dvh bg-white text-gray-900 antialiased">
        {children}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
