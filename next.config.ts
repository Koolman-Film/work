import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// next-intl plugin — points at our request-config module that runs
// getRequestConfig on every Server Component request and provides the
// resolved locale + messages to the React tree via NextIntlClientProvider.
const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

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
  ],

  outputFileTracingIncludes: {
    '/liff/payslip/pdf': ['./src/lib/payslip/fonts/**'],
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
