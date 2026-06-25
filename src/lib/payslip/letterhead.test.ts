import { describe, expect, it } from 'vitest';
import { payslipPeriodLabel } from './letterhead';

describe('payslipPeriodLabel', () => {
  it('uses the Buddhist year (+543) for Thai', () => {
    expect(payslipPeriodLabel('th', '2026-06')).toBe('มิถุนายน 2569');
  });

  it('computes the Buddhist year dynamically (not hardcoded)', () => {
    expect(payslipPeriodLabel('th', '2025-06')).toBe('มิถุนายน 2568');
  });

  it('uses the Gregorian year for English', () => {
    expect(payslipPeriodLabel('en', '2026-06')).toBe('June 2026');
  });

  it('localizes month + year for other scripts', () => {
    expect(payslipPeriodLabel('zh-CN', '2026-06')).toBe('2026年6月');
    expect(payslipPeriodLabel('lo', '2026-06')).toBe('ມິຖຸນາ 2026');
  });

  it('does not roll the month over (uses day 01, UTC)', () => {
    expect(payslipPeriodLabel('en', '2026-12')).toBe('December 2026');
    expect(payslipPeriodLabel('th', '2026-01')).toBe('มกราคม 2569');
  });
});
