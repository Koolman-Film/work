'use server';

/**
 * Persist product-updates "seen" ids for the current admin user. Add-only:
 * ids are never removed, and the union is done atomically in the database
 * (seen-store.ts), so concurrent saves cannot erase each other. No-op when the
 * session's copy already holds every id.
 */

import { requireAdminArea } from '@/lib/auth/admin-area';
import { parseSeen } from './seen-json';
import { addSeenIds } from './seen-store';

export async function markProductUpdatesSeen(ids: string[]): Promise<void> {
  const { user } = await requireAdminArea();
  const current = new Set(parseSeen(user.productUpdatesSeen));
  const fresh = [...new Set(ids)].filter((id) => !current.has(id));
  if (fresh.length === 0) return; // nothing new → skip the write
  await addSeenIds(user.id, fresh);
}
