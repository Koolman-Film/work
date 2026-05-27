import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

  // i18n + custom routing live in middleware (next-intl) for App Router

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
  serverExternalPackages: ['@prisma/client', 'prisma', 'pino', 'pino-pretty'],

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

export default config;
