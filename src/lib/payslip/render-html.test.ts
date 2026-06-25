// src/lib/payslip/render-html.test.ts
import { describe, expect, it } from 'vitest';
import { buildPayslipHtml } from './render-html';
import type { PayslipDocument } from './types';

const doc: PayslipDocument = {
  meta: { employeeName: 'Somchai Jaidee', employeeId: 'EMP-1', branch: 'Chiang Mai',
    department: 'Install', payType: 'Monthly', month: '2026-06' },
  income: { lines: [{ key: 'base', labelKey: 'income.base', amount: 20000, detail: null }], total: 20000 },
  deduct: { lines: [{ key: 'sso', labelKey: 'deduct.sso', amount: 750,
    detail: { key: 'sso', vars: { pct: 5, cap: '15,000' } } }], total: 750 },
  net: 19250,
};
const t = (k: string, v?: Record<string, string | number>) =>
  k === 'detail.sso' ? `${v!.pct}% · cap ฿${v!.cap}` : k; // echo key
const tEn = (k: string) => k; // echo key for English
const money = (n: number) => `฿${n.toFixed(2)}`;
const opts = { t, tEn, money, fontFace: '/*f*/', logoSvg: '<svg/>', periodLabel: 'มิถุนายน 2569', generatedAt: '2026-07-01' };

describe('buildPayslipHtml', () => {
  it('renders a detail line only when present', () => {
    const html = buildPayslipHtml(doc, { ...opts, locale: 'en' });
    expect(html).toContain('5% · cap ฿15,000');
  });
  it('NEVER letter-spaces native script — .t1 has no letter-spacing/uppercase', () => {
    const html = buildPayslipHtml(doc, { ...opts, locale: 'th' });
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const t1 = css.match(/\.t1\s*\{[^}]*\}/)![0];
    expect(t1).not.toMatch(/letter-spacing/);
    expect(t1).not.toMatch(/text-transform/);
    const t2 = css.match(/\.t2\s*\{[^}]*\}/)![0];
    expect(t2).toMatch(/letter-spacing/);
    expect(t2).toMatch(/uppercase/);
  });
  it('omits the English second line when locale is en', () => {
    const html = buildPayslipHtml(doc, { ...opts, locale: 'en' });
    expect(html).not.toContain('class="t2"');
  });
});
