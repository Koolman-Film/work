import { describe, expect, it } from 'vitest';

const LOCALES = ['th', 'en', 'my', 'lo', 'zh-CN', 'km'] as const;
const KEYS = [
  'employee',
  'employeeId',
  'payPeriod',
  'payType',
  'generatedOn',
  'issued',
  'disclaimer',
  'kept',
  'download',
];
const DETAIL = ['sso', 'advance', 'leave', 'attendance'];
describe('payslipPdf i18n', () => {
  for (const l of LOCALES) {
    it(`${l} has the full payslipPdf namespace`, async () => {
      const m = (await import(`../../../messages/${l}.json`)).default;
      expect(m.payslipPdf, `${l} payslipPdf`).toBeDefined();
      for (const k of KEYS) expect(m.payslipPdf[k], `${l}.payslipPdf.${k}`).toBeTruthy();
      for (const k of DETAIL)
        expect(m.payslipPdf.detail?.[k], `${l}.payslipPdf.detail.${k}`).toBeTruthy();
    });
  }
});

/**
 * The itemised over-quota-leave line is only worth anything if it actually
 * names the leave type and the day. A translation that drops a placeholder
 * still renders — it just silently goes back to the unexplained line this
 * change exists to replace, for that locale's readers only. Assert the
 * placeholders, not just the presence of a string.
 */
describe('payslip.deduct.leaveItem placeholders', () => {
  for (const l of LOCALES) {
    it(`${l} interpolates both {leaveType} and {date}`, async () => {
      const m = (await import(`../../../messages/${l}.json`)).default;
      const msg = m.payslip?.deduct?.leaveItem;
      expect(msg, `${l}.payslip.deduct.leaveItem`).toBeTruthy();
      expect(msg, `${l} {leaveType}`).toContain('{leaveType}');
      expect(msg, `${l} {date}`).toContain('{date}');
    });
  }
});
