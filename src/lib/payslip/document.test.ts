import { describe, expect, it } from 'vitest';
import { assemblePayslipDocument, type NormalizedPayslipInput } from './document';

const base: NormalizedPayslipInput = {
  meta: {
    employeeName: 'Somchai Jaidee',
    employeeId: 'e1',
    branch: 'HQ',
    branchEn: null,
    letterhead: { payslipNameEn: null, payslipNameNative: null, payslipLogoKey: null },
    department: 'Ops',
    payType: 'Monthly',
    month: '2026-06',
  },
  buckets: {
    incomeBase: 20000,
    incomeOther: 0,
    deductSso: 750,
    deductAdvance: 0,
    deductAttendance: 0,
    deductLeave: 0,
    deductDebt: 0,
    deductOther: 0,
    netPay: 19250,
  },
  incomeAdjustments: [],
  deductAdjustments: [],
  advanceCount: 0,
  attendance: { absent: 0, late: 0 },
  leaveOverMinutesTotal: 0,
  rateInputs: {
    ssoRate: 0.05,
    ssoSalaryCap: 15000,
    salaryType: 'Monthly',
    baseSalary: 20000,
    workingDaysPerMonth: 30,
    standardDayMinutes: 420,
  },
};

describe('assemblePayslipDocument', () => {
  it('base salary + SSO only → totals and net reconcile', () => {
    const doc = assemblePayslipDocument(base);
    expect(doc.income.lines).toEqual([
      { key: 'base', labelKey: 'income.base', amount: 20000, detail: null },
    ]);
    expect(doc.income.total).toBe(20000);
    const sso = doc.deduct.lines.find((l) => l.key === 'sso');
    expect(sso?.amount).toBe(750);
    expect(sso?.detail).toEqual({ key: 'sso', vars: { pct: 5, cap: '15,000' } });
    expect(doc.deduct.total).toBe(750);
    expect(doc.net).toBe(19250);
  });

  it('itemizes income adjustments when they reconcile to incomeOther', () => {
    const doc = assemblePayslipDocument({
      ...base,
      buckets: { ...base.buckets, incomeOther: 1500, netPay: 20750 },
      incomeAdjustments: [{ id: 'a1', reason: 'โบนัส', amount: 1500 }],
    });
    expect(doc.income.lines).toEqual([
      { key: 'base', labelKey: 'income.base', amount: 20000, detail: null },
      { key: 'a1', label: 'โบนัส', amount: 1500, detail: null },
    ]);
  });

  it('falls back to a single income.other line when adjustments do NOT reconcile', () => {
    const doc = assemblePayslipDocument({
      ...base,
      buckets: { ...base.buckets, incomeOther: 1500, netPay: 20750 },
      incomeAdjustments: [{ id: 'a1', reason: 'โบนัส', amount: 1000 }], // sum 1000 != 1500
    });
    expect(doc.income.lines.some((l) => l.key === 'other' && l.amount === 1500)).toBe(true);
    expect(doc.income.lines.some((l) => l.key === 'a1')).toBe(false);
  });

  it('emits attendance + leave details from the supplied counts/minutes', () => {
    const doc = assemblePayslipDocument({
      ...base,
      buckets: { ...base.buckets, deductAttendance: 1000, deductLeave: 200, netPay: 18050 },
      attendance: { absent: 2, late: 0 },
      leaveOverMinutesTotal: 60,
    });
    const att = doc.deduct.lines.find((l) => l.key === 'attendance');
    expect(att?.detail).toEqual({ key: 'attendance', vars: { absent: 2, late: 0 } });
    const leave = doc.deduct.lines.find((l) => l.key === 'leave');
    expect(leave?.detail?.key).toBe('leave');
    expect(leave?.detail?.vars.minutes).toBe(60);
  });

  it('omits zero-amount deduction lines', () => {
    const doc = assemblePayslipDocument(base); // only SSO non-zero
    expect(doc.deduct.lines.map((l) => l.key)).toEqual(['sso']);
  });

  it('itemizes deduct adjustments when they reconcile to deductOther', () => {
    const doc = assemblePayslipDocument({
      ...base,
      buckets: { ...base.buckets, deductOther: 500, netPay: 18750 },
      deductAdjustments: [
        { id: 'd1', reason: 'หักค่าอุปกรณ์', amount: 300 },
        { id: 'd2', reason: 'หักอื่นๆ', amount: 200 },
      ],
    });
    expect(doc.deduct.lines.some((l) => l.key === 'd1' && l.amount === 300)).toBe(true);
    expect(doc.deduct.lines.some((l) => l.key === 'd2' && l.amount === 200)).toBe(true);
    expect(doc.deduct.lines.some((l) => l.key === 'other')).toBe(false);
    const d1 = doc.deduct.lines.find((l) => l.key === 'd1');
    expect(d1).toEqual({ key: 'd1', label: 'หักค่าอุปกรณ์', amount: 300, detail: null });
  });

  it('falls back to a single deduct.other line when deduct adjustments do NOT reconcile', () => {
    const doc = assemblePayslipDocument({
      ...base,
      buckets: { ...base.buckets, deductOther: 500, netPay: 18750 },
      deductAdjustments: [{ id: 'd1', reason: 'หักค่าอุปกรณ์', amount: 300 }], // sum 300 != 500
    });
    expect(doc.deduct.lines.some((l) => l.key === 'other' && l.amount === 500)).toBe(true);
    expect(doc.deduct.lines.some((l) => l.key === 'd1')).toBe(false);
    const other = doc.deduct.lines.find((l) => l.key === 'other');
    expect(other).toEqual({ key: 'other', labelKey: 'deduct.other', amount: 500, detail: null });
  });
});

describe('assemblePayslipDocument — letterhead passthrough', () => {
  const baseInput: NormalizedPayslipInput = {
    meta: {
      employeeName: 'Test User',
      employeeId: 'EMP-1',
      branch: 'เชียงใหม่',
      branchEn: 'Chiang Mai',
      letterhead: {
        payslipNameEn: 'Acme Co., Ltd.',
        payslipNameNative: 'บริษัท แอคมี จำกัด',
        payslipLogoKey: 'admin-1/branch-logos/b1.png',
      },
      department: null,
      payType: 'Monthly',
      month: '2026-06',
    },
    buckets: {
      incomeBase: 10000, incomeOther: 0, deductSso: 0, deductAdvance: 0,
      deductAttendance: 0, deductLeave: 0, deductDebt: 0, deductOther: 0, netPay: 10000,
    },
    incomeAdjustments: [],
    deductAdjustments: [],
    advanceCount: 0,
    attendance: { absent: 0, late: 0 },
    leaveOverMinutesTotal: 0,
    rateInputs: {
      ssoRate: 0.05, ssoSalaryCap: 15000, salaryType: 'Monthly',
      baseSalary: 10000, workingDaysPerMonth: 26, standardDayMinutes: 480,
    },
  };

  it('passes branchEn and letterhead through to the document meta', () => {
    const doc = assemblePayslipDocument(baseInput);
    expect(doc.meta.branchEn).toBe('Chiang Mai');
    expect(doc.meta.letterhead.payslipNameEn).toBe('Acme Co., Ltd.');
    expect(doc.meta.letterhead.payslipLogoKey).toBe('admin-1/branch-logos/b1.png');
  });
});
