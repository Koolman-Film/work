/**
 * Prisma client singletons.
 *
 * `prismaRaw` — base client, sees ALL rows including soft-deleted. Use ONLY
 *   in void/restore actions and trash views.
 * `prisma`    — base + soft-delete filter extension. Default for all reads.
 *
 * Singleton rationale (HMR pool exhaustion) unchanged — see git history.
 */
import { PrismaClient } from '@prisma/client';
import { softDeleteExtension } from './soft-delete-extension';

const globalForPrisma = globalThis as unknown as {
  prismaRaw: PrismaClient | undefined;
};

export const prismaRaw =
  globalForPrisma.prismaRaw ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaRaw = prismaRaw;
}

export const prisma = prismaRaw.$extends(softDeleteExtension);
