import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans_Thai,
  Inter,
  Noto_Sans_Khmer,
  Noto_Sans_Lao,
  Noto_Sans_Myanmar,
} from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import './globals.css';

/**
 * Fonts (Sapphire Editorial): Inter for display/KPI numerics, IBM Plex Sans
 * Thai for body Thai script, IBM Plex Mono for code/IDs. Loaded via next/font
 * (self-hosted, zero layout shift). Each exposes a CSS variable that the
 * `@theme` `--font-*` stacks in globals.css resolve to.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-plex-thai',
  display: 'swap',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});
const notoMyanmar = Noto_Sans_Myanmar({
  subsets: ['myanmar'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-myanmar',
  display: 'swap',
});
const notoKhmer = Noto_Sans_Khmer({
  subsets: ['khmer'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-khmer',
  display: 'swap',
});
const notoLao = Noto_Sans_Lao({
  subsets: ['lao'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-lao',
  display: 'swap',
});

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The locale was resolved upstream by next-intl's getRequestConfig
  // (which reads our NEXT_LOCALE cookie via src/lib/i18n/request.ts).
  // We just consume it here for two things:
  //   1. `<html lang>` — proper accessibility + lets the browser pick
  //      the right hyphenation/font fallback per locale
  //   2. NextIntlClientProvider — passes locale + messages to client
  //      components so `useTranslations()` works there.
  // Messages aren't passed explicitly: the provider reads them from
  // the request config on the server, and ships them to the client
  // bundle automatically.
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${plexThai.variable} ${plexMono.variable} ${notoMyanmar.variable} ${notoKhmer.variable} ${notoLao.variable}`}
    >
      <body className="min-h-dvh bg-white text-gray-900 antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
