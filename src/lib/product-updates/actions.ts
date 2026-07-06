'use server';

/**
 * Persist product-updates "seen" ids for the current admin user. Add-only
 * union: ids are never removed, so concurrent tabs can't lose a dismissal
 * and the worst-case race is a harmless re-show. No-op when nothing is new.
 */

import { requireAdminArea } from '@/lib/auth/admin-area';
import { prisma } from '@/lib/db/prisma';
import { parseSeen } from './seen-json';

export async function markProductUpdatesSeen(ids: string[]): Promise<void> {
  const { user } = await requireAdminArea();
  const current = parseSeen(user.productUpdatesSeen);
  const next = [...new Set([...current, ...ids])];
  if (next.length === current.length) return; // nothing new → skip the write
  await prisma.user.update({
    where: { id: user.id },
    data: { productUpdatesSeen: next },
  });
}
