import type { Role, User } from '@prisma/client';
import { notFound } from 'next/navigation';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import type { Permission } from '@/lib/auth/permissions';

/**
 * Like `requirePermission`, but ALSO requires the grant to be GLOBAL
 * (branchId=null / Superadmin). A merely branch-scoped grant → notFound().
 * For global-only surfaces (payroll). Superadmin resolves to 'all', so
 * Superadmins always pass.
 */
export async function requireGlobalPermission(
  permission: Permission,
): Promise<{ user: User; authUserId: string; tier: Role | null }> {
  const result = await requirePermission(permission);
  const permitted = await getPermittedBranches(result.user, permission);
  if (permitted !== 'all') notFound();
  return result;
}
