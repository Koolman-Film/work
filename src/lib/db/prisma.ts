/**
 * Prisma client singleton.
 *
 * Why singleton: in Next.js dev mode, hot-reload re-executes module-level
 * code on file change. Without the global cache, every save creates a new
 * PrismaClient instance and they accumulate, eventually exhausting the
 * Supabase connection pool (default ~60 connections). The `globalThis`
 * stash survives HMR's module re-evaluation in dev; in production we just
 * create once and reuse for the function lifetime.
 *
 * Reference: https://www.prisma.io/docs/guides/other/troubleshooting-orm/help-articles/nextjs-prisma-client-dev-practices
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
