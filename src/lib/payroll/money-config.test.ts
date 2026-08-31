import { describe, expect, it } from 'vitest';
import { payrollMoneySchema, toPayrollConfigData } from './money-config';

const VALID = {
  ssoRatePercent: '5',
  ssoSalaryCap: '17500',
  ssoAmountCap: '875',
  otMultiplier: '1.5',
  workingDaysPerMonth: '30',
  otThresholdMinutes: '30',
  absentDeductionPerDay: '500',
  lateDeduction: '100',
  earlyLeaveDeduction: '100',
  advanceMinRemaining: '0',
  advanceBlackoutDays: '0',
  leaveDeductMaxPercent: '30',
};

describe('payrollMoneySchema', () => {
  it('accepts a valid payload', () => {
    expect(payrollMoneySchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects a negative deduction', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, lateDeduction: '-1' });
    expect(r.success).toBe(false);
  });

  it('rejects an SSO rate above 100%', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, ssoRatePercent: '150' });
    expect(r.success).toBe(false);
  });

  it('rejects more than two decimal places on money', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, ssoSalaryCap: '17500.123' });
    expect(r.success).toBe(false);
  });

  it('rejects a non-integer workingDaysPerMonth', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, workingDaysPerMonth: '30.5' });
    expect(r.success).toBe(false);
  });

  it('rejects an OT multiplier below 1.00', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, otMultiplier: '0.99' });
    expect(r.success).toBe(false);
  });

  it('rejects a zero SSO salary cap', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, ssoSalaryCap: '0' });
    expect(r.success).toBe(false);
  });

  it('rejects a zero SSO amount cap', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, ssoAmountCap: '0' });
    expect(r.success).toBe(false);
  });
});

describe('toPayrollConfigData', () => {
  it('converts the SSO percent to a stored fraction', () => {
    const parsed = payrollMoneySchema.parse(VALID);
    const data = toPayrollConfigData(parsed);
    expect(data.ssoRate?.toString()).toBe('0.05');
    expect(data.ssoSalaryCap?.toString()).toBe('17500');
    expect(data.ssoAmountCap?.toString()).toBe('875');
    expect(data.otMultiplier?.toString()).toBe('1.5');
    expect(data.workingDaysPerMonth).toBe(30);
    expect(data.otThresholdMinutes).toBe(30);
  });
});

describe('payrollMoneySchema — cash-advance limits', () => {
  it('accepts a floor and a blackout window', () => {
    const r = payrollMoneySchema.safeParse({
      ...VALID,
      advanceMinRemaining: '2000',
      advanceBlackoutDays: '3',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a blackout longer than 27 days', () => {
    // The window ends ON cutoffDay, which is itself capped at 28. Allowing 28+
    // would let a single setting block every day of the month, so the ceiling
    // sits below the cutoff's own bound and "blocked all month" is unreachable.
    const r = payrollMoneySchema.safeParse({ ...VALID, advanceBlackoutDays: '28' });
    expect(r.success).toBe(false);
  });

  it('rejects a negative blackout window', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, advanceBlackoutDays: '-1' });
    expect(r.success).toBe(false);
  });

  it('rejects a negative floor', () => {
    const r = payrollMoneySchema.safeParse({ ...VALID, advanceMinRemaining: '-500' });
    expect(r.success).toBe(false);
  });

  it('carries both through to the Prisma payload', () => {
    const parsed = payrollMoneySchema.parse({
      ...VALID,
      advanceMinRemaining: '2000',
      advanceBlackoutDays: '3',
    });
    const data = toPayrollConfigData(parsed);
    expect(String(data.advanceMinRemaining)).toBe('2000');
    expect(data.advanceBlackoutDays).toBe(3);
  });
});
