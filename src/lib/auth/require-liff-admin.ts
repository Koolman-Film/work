/**
 * Gate for /liff/admin/* — admin-tier session (the LIFF LINE-identity
 * fallback in requireRole applies) that ALSO holds the `liff.admin`
 * permission.
 *
 * Thin composition: requireRole(['Admin']) resolves the session — including
 * a paired admin whose LIFF session is a LINE-minted auth user — and
 * canDo() checks the permission against the user's role assignments.
 * Denial is the same opaque notFound() used by every other gate.
 */

import { notFound } from 'next/navigation';
import { canDo } from '@/lib/auth/check-permission';
import { type RequireRoleResult, requireRole } from '@/lib/auth/require-role';

export async function requireLiffAdmin(): Promise<RequireRoleResult> {
  const result = await requireRole(['Admin']);
  const ok = await canDo(result.user, 'liff.admin');
  if (!ok) notFound();
  return result;
}
