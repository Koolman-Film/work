import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_PAGE_SIZE, buildAuditWhere, fetchAuditPage, resolveActors } from '@/lib/audit/query';
import { prisma } from '@/lib/db/prisma';

async function reset() {
  // Delete children before parents (Employee FKs Branch/User) so reruns
  // against a shared DB don't collide on Branch.name's unique constraint.
  await prisma.auditLog.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
}

async function makeAudit(over: {
  actorId?: string | null;
  action?: string;
  entityType?: string;
  entityId?: string;
  createdAt?: Date;
}) {
  return prisma.auditLog.create({
    data: {
      actorId: over.actorId ?? null,
      action: over.action ?? 'employee.update',
      entityType: over.entityType ?? 'Employee',
      entityId: over.entityId ?? crypto.randomUUID(),
      createdAt: over.createdAt ?? new Date(),
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('fetchAuditPage', () => {
  it('returns newest-first and paginates by keyset cursor', async () => {
    for (let i = 0; i < AUDIT_PAGE_SIZE + 5; i++) {
      await makeAudit({ createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, i)) });
    }
    const first = await fetchAuditPage({});
    expect(first.rows).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    // newest first
    expect(first.rows[0]!.createdAt.getTime()).toBeGreaterThan(first.rows[1]!.createdAt.getTime());

    const second = await fetchAuditPage({}, first.nextCursor ?? undefined);
    expect(second.rows).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    // no overlap
    const firstIds = new Set(first.rows.map((r) => r.id));
    expect(second.rows.every((r) => !firstIds.has(r.id))).toBe(true);
  });

  it('applies the action filter via buildAuditWhere', async () => {
    await makeAudit({ action: 'payroll.publish' });
    await makeAudit({ action: 'employee.update' });
    const { rows } = await fetchAuditPage(buildAuditWhere({ action: 'payroll.publish' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('payroll.publish');
  });
});

describe('resolveActors', () => {
  it('resolves employee names and email, and retains a deleted actor id', async () => {
    const u1 = await prisma.user.create({ data: { email: 'boss@x.com' } });
    const u2 = await prisma.user.create({ data: {} });
    await prisma.employee.create({
      data: {
        userId: u2.id,
        firstName: 'สม',
        lastName: 'ชาย',
        branchId: (await prisma.branch.create({ data: { name: 'HQ' } })).id,
        salaryType: 'Monthly',
        baseSalary: 20000,
        status: 'Active',
        hiredAt: new Date('2026-01-01'),
      },
    });
    const map = await resolveActors([u1.id, u2.id, 'ffffffff-ffff-4fff-8fff-ffffffffffff', null]);
    expect(map.get(u1.id)).toBe('boss@x.com');
    expect(map.get(u2.id)).toBe('สม ชาย');
    expect(map.has('ffffffff-ffff-4fff-8fff-ffffffffffff')).toBe(false); // not a real user
  });
});
