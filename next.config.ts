import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// next-intl plugin — points at our request-config module that runs
// getRequestConfig on every Server Component request and provides the
// resolved locale + messages to the React tree via NextIntlClientProvider.
const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

/**
 * The chromium binary, globbed at its ONE real location.
 *
 * This used to list two globs — the symlinked `node_modules/@sparticuz/chromium`
 * path as well as the `.pnpm` store path — on the theory that tracing should
 * resolve "regardless of layout". Both matched, so every rendering route shipped
 * TWO copies of a 66 MB payload: measured 132.83 MB of chromium in a function
 * whose unique chromium content is 66.43 MB. That is what pushed
 * /admin/payroll over Vercel's 250 MB cap and failed the deploy.
 *
 * The `.pnpm` path is the load-bearing one and the symlink is redundant:
 * `require.resolve('@sparticuz/chromium')` returns the `.pnpm` path (Node
 * resolves symlinks unless --preserve-symlinks), and the package computes its
 * binary location as `../bin` relative to its own `build/` directory — so the
 * only copy it can ever load is the one under `.pnpm`.
 *
 * `pnpm check:bundle` measures this against the build output and fails if the
 * duplication returns — or if a PDF route ever loses the binary entirely.
 */
const CHROMIUM_BIN =
  './node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**';

const config: NextConfig = {
  reactStrictMode: true,

  // i18n: cookie-based (NEXT_LOCALE) — no URL prefix. next-intl plugin
  // wraps the config below via withNextIntl(). See src/lib/i18n/.

  // Images served from Supabase Storage signed URLs go through next/image.
  // The `protocol`+`hostname` allowlist lets Vercel Image Optimization fetch them.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ficzlgdigcfwpkfbidjz.supabase.co',
        pathname: '/storage/v1/**',
      },
      {
        // LINE profile picture CDN
        protocol: 'https',
        hostname: 'profile.line-scdn.net',
        pathname: '/**',
      },
    ],
  },

  // Sentry, Prisma client, etc. should not be bundled into the edge runtime.
  // Next.js 16 uses Turbopack by default; this option is the cross-bundler way.
  // (@line/liff is browser-only and should only ever be imported in client components.)
  serverExternalPackages: [
    '@prisma/client',
    'prisma',
    'pino',
    'pino-pretty',
    '@sparticuz/chromium',
    'puppeteer-core',
    'exceljs',
  ],

  // Both PDF routes render via @sparticuz/chromium (puppeteer-core). The chromium
  // binary lives in the package's `bin/` and is loaded at RUNTIME via a computed
  // path (getBinPath → ../../bin), so Next's static tracer can't see it — it must
  // be force-included per rendering route, or the function 500s with
  // "input directory .../@sparticuz/chromium/bin does not exist". The project's
  // own webfonts (loaded via fontFaceCss) are runtime-read too, so include both.
  outputFileTracingIncludes: {
    '/liff/payslip/pdf': ['./src/lib/payslip/fonts/**', CHROMIUM_BIN],
    '/admin/payroll/payslip-pdf': ['./src/lib/payslip/fonts/**', CHROMIUM_BIN],
    '/admin/payroll/payslips-zip': ['./src/lib/payslip/fonts/**', CHROMIUM_BIN],
    // Reports export route renders PDF via the same chromium path and reads
    // the IBM Plex Thai webfonts at runtime — include both, like the routes above.
    //
    // `*` NOT `[report]`: these keys are GLOBS, so a literal `[report]` is a
    // character class matching one char from {r,e,p,o,t} — it never matches the
    // real route, and this entry silently did nothing. Verified against the
    // build's .nft.json: with the bracket key the binary was absent from this
    // route's trace; with `*` it is present.
    '/admin/reports/*/export': ['./src/lib/export/fonts/**', CHROMIUM_BIN],
    // The payroll PAGE renders PDFs too — not in a request, but in the publish
    // action's `after()` hook, which pre-warms every freshly-published slip
    // (lib/payslip/warm.ts → renderPayslipPdf). Because no route handler is
    // involved this is easy to miss: tracing saw no chromium reference on
    // /admin/payroll and shipped the page without the binary, so EVERY warm
    // since 2026-06-30 failed with "input directory .../bin does not exist"
    // (53 occurrences). It fails silently by design — warm.ts swallows it and
    // the slip falls back to a lazy ~1s render on first LIFF open — so the
    // feature had simply never worked in production.
    //
    // `/page` pins this to the page itself. A bare `/admin/payroll` key also
    // matches every nested route, which put the 66 MB binary into reconcile,
    // adjustments/*, and preview-html — none of which render a PDF.
    '/admin/payroll/page': ['./src/lib/payslip/fonts/**', CHROMIUM_BIN],
  },

  // Permanent redirects for the W2-IA URL move (pre-existing local URLs only;
  // nothing ever deployed under these, but keep these for ~6 months in case
  // anyone shared an in-progress link).
  async redirects() {
    return [
      {
        source: '/admin/branches/:path*',
        destination: '/admin/settings/branches/:path*',
        permanent: true,
      },
      {
        source: '/admin/departments/:path*',
        destination: '/admin/settings/departments/:path*',
        permanent: true,
      },
      {
        source: '/admin/accounting-groups/:path*',
        destination: '/admin/settings/accounting-groups/:path*',
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(config);
