/**
 * Unit tests for requireLiffAdmin — the /liff/admin/* gate.
 *
 * Composition under test: requireRole(['Admin']) for session/tier
 * resolution, then canDo(user, 'liff.admin'). Mocked at module
 * boundaries (mirrors require-role-line-fallback.test.ts style).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/check-permission', () => ({
  canDo: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { canDo } from '@/lib/auth/check-permission';
import { requireRole } from '@/lib/auth/require-role';
import { requireLiffAdmin } from './require-liff-admin';

const mockedRequireRole = vi.mocked(requireRole);
const mockedCanDo = vi.mocked(canDo);

const ADMIN_RESULT = {
  user: { id: 'user-1' },
  employee: undefined,
  tier: 'Admin' as const,
  authUserId: 'aaaaaaaa-0000-0000-0000-000000000001',
  // biome-ignore lint/suspicious/noExplicitAny: minimal RequireRoleResult stub
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireLiffAdmin', () => {
  it('passes a paired admin who holds liff.admin', async () => {
    mockedRequireRole.mockResolvedValue(ADMIN_RESULT);
    mockedCanDo.mockResolvedValue(true);

    const result = await requireLiffAdmin();

    expect(result).toBe(ADMIN_RESULT);
    expect(mockedRequireRole).toHaveBeenCalledWith(['Admin']);
    expect(mockedCanDo).toHaveBeenCalledWith(ADMIN_RESULT.user, 'liff.admin');
  });

  it('rejects staff — requireRole notFound propagates, no permission check', async () => {
    mockedRequireRole.mockRejectedValue(new Error('NEXT_NOT_FOUND'));

    await expect(requireLiffAdmin()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockedCanDo).not.toHaveBeenCalled();
  });

  it('rejects an admin-tier user WITHOUT liff.admin via notFound', async () => {
    mockedRequireRole.mockResolvedValue(ADMIN_RESULT);
    mockedCanDo.mockResolvedValue(false);

    await expect(requireLiffAdmin()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
