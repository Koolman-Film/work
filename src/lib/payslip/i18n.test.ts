import { describe, expect, it } from 'vitest';
const LOCALES = ['th', 'en', 'my', 'lo', 'zh-CN', 'km'] as const;
const KEYS = ['employee','employeeId','payPeriod','payType','generatedOn','issued','disclaimer','kept','download'];
const DETAIL = ['sso','advance','leave'];
describe('payslipPdf i18n', () => {
  for (const l of LOCALES) {
    it(`${l} has the full payslipPdf namespace`, async () => {
      const m = (await import(`../../../messages/${l}.json`)).default;
      expect(m.payslipPdf, `${l} payslipPdf`).toBeDefined();
      for (const k of KEYS) expect(m.payslipPdf[k], `${l}.payslipPdf.${k}`).toBeTruthy();
      for (const k of DETAIL) expect(m.payslipPdf.detail?.[k], `${l}.payslipPdf.detail.${k}`).toBeTruthy();
    });
  }
});
