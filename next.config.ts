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

  // Sentry, Prisma client, etc. should not be bundled into the edge runtime
  serverExternalPackages: ['@prisma/client', 'prisma', 'pino', 'pino-pretty'],

  // Allow @line/liff (browser-only) to be handled gracefully if accidentally imported server-side
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), '@line/liff'];
    }
    return config;
  },
};

export default config;
