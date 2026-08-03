import { describe, expect, it, vi } from 'vitest';

// Mock server-only module to allow testing server functions in Vitest
vi.mock('server-only', () => ({}));

import { buildLeaveRowVM, type LeaveRecord } from './leave-row-vm';

const rec = (o: Partial<LeaveRecord>): LeaveRecord => ({
  id: 'r',
  employeeId: 'e',
  leaveTypeId: 't',
  startDate: new Date('2026-07-10'),
  endDate: new Date('2026-07-10'),
  unit: 'FullDay',
  startTime: null,
  endTime: null,
  reason: 'x',
  status: 'Approved',
  reviewNote: null,
  reviewedAt: new Date(),
  createdAt: new Date(),
  attachmentUrl: null,
  deletedAt: null,
  deductedInPayrollId: null,
  waivedOverQuotaMinutes: 0,
  waiveReason: null,
  leaveType: { name: 'ลากิจ', isPaid: true, overQuotaPolicy: 'DeductPay' },
  employee: {
    firstName: 'A',
    lastName: 'B',
    nickname: null,
    branch: { name: 'X' },
    department: null,
  },
  ...o,
});

const CFG = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

describe('buildLeaveRowVM correctable', () => {
  const build = (r: LeaveRecord) =>
    buildLeaveRowVM(r, { attachmentUrl: null, workingDays: 1, cfg: CFG, overQuota: null });

  it('true for an approved, unpaid, DeductPay request', () => {
    expect(build(rec({})).correctable).toBe(true);
  });

  it('false once paid', () => {
    expect(build(rec({ deductedInPayrollId: 'pay-1' })).correctable).toBe(false);
  });

  it('false for a Block-policy type', () => {
    expect(
      build(
        rec({
          leaveType: { name: 'ลาพักร้อน', isPaid: true, overQuotaPolicy: 'Block' },
        }),
      ).correctable,
    ).toBe(false);
  });

  it('false while still Pending', () => {
    expect(build(rec({ status: 'Pending' })).correctable).toBe(false);
  });
});
