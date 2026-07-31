/**
 * The entityId guard. `AuditLog.entityId` is `@db.Uuid` (schema.prisma), so a
 * non-UUID makes Postgres reject the INSERT — and because `auditLog` is
 * fire-and-forget and swallows its own errors, such a call site fails silently
 * and on EVERY call. `payslip.download` did exactly that for six weeks (306
 * failures, June 17 → July 31) with the composite id `<employeeId>:<month>`,
 * leaving no record of who read whose payslip.
 *
 * These cases are the exact shapes that were live in the codebase, so a
 * reintroduction fails here instead of in production silence.
 */

import { describe, expect, it, vi } from 'vitest';
import { auditLog, auditLogMany, auditLogTx } from './log';

const UUID = '22222222-2222-4222-8222-222222222222';
const OTHER_UUID = '33333333-3333-4333-8333-333333333333';

/** Minimal transaction stub — the guard runs before `tx` is ever touched. */
function txStub() {
  const create = vi.fn().mockResolvedValue({});
  return { tx: { auditLog: { create } } as never, create };
}

describe('audit entityId guard', () => {
  it.each([
    ['composite payslip key', `${UUID}:2026-06`],
    ['bulk zip key', 'bulk:2026-06'],
    ['bulk sentinel', 'bulk'],
    ['new sentinel', 'new'],
    ['empty string', ''],
  ])('auditLog rejects %s', (_label, entityId) => {
    expect(() =>
      auditLog({ actorId: UUID, action: 'payslip.download', entityType: 'Payroll', entityId }),
    ).toThrow(/entityId must be a UUID/);
  });

  it('auditLogMany rejects a batch if ANY row is not a UUID', () => {
    expect(() =>
      auditLogMany([
        { actorId: UUID, action: 'payslip.download', entityType: 'Payroll', entityId: OTHER_UUID },
        { actorId: UUID, action: 'payslip.download', entityType: 'Payroll', entityId: 'bulk' },
      ]),
    ).toThrow(/entityId must be a UUID/);
  });

  it('auditLogTx rejects before touching the transaction', async () => {
    const { tx, create } = txStub();
    await expect(
      auditLogTx(tx, {
        actorId: UUID,
        action: 'leave.recompute',
        entityType: 'LeaveRequest',
        entityId: 'bulk',
      }),
    ).rejects.toThrow(/entityId must be a UUID/);
    // Nothing was written — the mutation's transaction rolls back rather than
    // committing a change whose audit row silently vanished.
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a real UUID', async () => {
    const { tx, create } = txStub();
    await auditLogTx(tx, {
      actorId: UUID,
      action: 'leave.recompute',
      entityType: 'LeaveRequest',
      entityId: OTHER_UUID,
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it('empty batch is a no-op', () => {
    expect(() => auditLogMany([])).not.toThrow();
  });
});
