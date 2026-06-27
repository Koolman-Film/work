import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked LINE session the supabase server client returns. Mutate `fakeLineSub`
// per test to simulate which LINE account is scanning.
let fakeLineSub: string | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: fakeLineSub
            ? {
                id: `auth-${fakeLineSub}`,
                identities: [{ provider: 'custom:line', id: fakeLineSub }],
              }
            : null,
        },
      }),
    },
  }),
}));
// The feature flag is OFF in source; force it on to exercise the flow.
vi.mock('@/lib/auth/admin-line-feature', () => ({ ADMIN_LINE_LINK_ENABLED: true }));

import { linkMergeAccounts, previewMergeAccounts } from '@/lib/auth/link-merge-accounts';
import { prisma } from '@/lib/db/prisma';
import { mintMergeToken } from '@/lib/pairing/token';

async function resetDb() {
  await prisma.attendance.deleteMany({});
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.roleDefinition.deleteMany({});
  await prisma.roleDefinition.create({
    data: {
      key: 'admin',
      name: 'Admin',
      permissions: ['liff.admin'],
      isSuperadmin: false,
      isSystem: true,
    },
  });
  await prisma.roleDefinition.create({
    data: { key: 'staff', name: 'Staff', permissions: [], isSuperadmin: false, isSystem: true },
  });
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

async function seed(opts: { adminLine: string | null; empLine: string | null }) {
  const adminRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'admin' } });
  const branch = await prisma.branch.create({ data: { name: 'B' } });
  const ua = await prisma.user.create({
    data: { email: 'boss@x.co', authUserId: crypto.randomUUID(), lineUserId: opts.adminLine },
  });
  await prisma.userRoleAssignment.create({
    data: { userId: ua.id, roleId: adminRole.id, branchId: null },
  });
  const ue = await prisma.user.create({
    data: { authUserId: crypto.randomUUID(), lineUserId: opts.empLine },
  });
  await prisma.employee.create({
    data: {
      userId: ue.id,
      firstName: 'A',
      lastName: 'B',
      nickname: 'Em',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: 20000,
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
  const { token, expiresAt } = await mintMergeToken(ua.id, ue.id);
  await prisma.user.update({
    where: { id: ua.id },
    data: { mergeToken: token, mergeTokenExpiresAt: expiresAt },
  });
  return { ua, ue, token };
}

describe('link-merge-accounts — explicit pairing + consent', () => {
  it('previews the token-targeted employee (LINE on the employee row)', async () => {
    const { token } = await seed({ adminLine: null, empLine: 'L-emp' });
    fakeLineSub = 'L-emp';
    const res = await previewMergeAccounts({ mergeToken: token });
    expect(res).toEqual({ ok: true, adminEmail: 'boss@x.co', employeeName: 'Em' });
  });

  it('links when a self-paired admin scans (LINE on the admin row) → relocates', async () => {
    const { ua, ue, token } = await seed({ adminLine: 'L', empLine: null });
    fakeLineSub = 'L';
    const res = await linkMergeAccounts({ mergeToken: token });
    expect(res).toEqual({ ok: true });
    const ueAfter = await prisma.user.findUniqueOrThrow({ where: { id: ue.id } });
    const uaAfter = await prisma.user.findUniqueOrThrow({ where: { id: ua.id } });
    expect(ueAfter.lineUserId).toBe('L');
    expect(uaAfter.lineUserId).toBeNull();
    const ueRoles = await prisma.userRoleAssignment.findMany({
      where: { userId: ue.id },
      include: { role: true },
    });
    expect(ueRoles.some((r) => r.role.key === 'admin')).toBe(true);
  });

  it('rejects a stranger whose LINE belongs to neither party', async () => {
    const { token } = await seed({ adminLine: null, empLine: 'L-emp' });
    await prisma.user.create({ data: { lineUserId: 'L-stranger' } });
    fakeLineSub = 'L-stranger';
    const res = await linkMergeAccounts({ mergeToken: token });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('not-a-party');
  });

  it('token is single-use: second call with same token returns consumed', async () => {
    const { token } = await seed({ adminLine: 'L-admin', empLine: null });
    fakeLineSub = 'L-admin';
    const first = await linkMergeAccounts({ mergeToken: token });
    expect(first).toEqual({ ok: true });
    const second = await linkMergeAccounts({ mergeToken: token });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('consumed');
  });
});
