// src/lib/payslip/render-html.test.ts
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import { buildPayslipHtml } from './render-html';
import type { PayslipDocument } from './types';

// --- stub helpers (echo-key) for structural invariant tests ---
const doc: PayslipDocument = {
  meta: {
    employeeName: 'Somchai Jaidee',
    employeeId: 'EMP-1',
    branch: 'Chiang Mai',
    department: 'Install',
    payType: 'Monthly',
    month: '2026-06',
  },
  income: {
    lines: [{ key: 'base', labelKey: 'income.base', amount: 20000, detail: null }],
    total: 20000,
  },
  deduct: {
    lines: [
      {
        key: 'sso',
        labelKey: 'deduct.sso',
        amount: 750,
        detail: { key: 'sso', vars: { pct: 5, cap: '15,000' } },
      },
    ],
    total: 750,
  },
  net: 19250,
};
const t = (k: string, v?: Record<string, string | number>) =>
  k === 'payslipPdf.detail.sso' ? `${v!.pct}% · cap ฿${v!.cap}` : k; // echo key
const tEn = (k: string) => k; // echo key for English
const money = (n: number) => `฿${n.toFixed(2)}`;
const opts = {
  t,
  tEn,
  money,
  fontFace: '/*f*/',
  logoSvg: '<svg/>',
  periodLabel: 'มิถุนายน 2569',
  generatedAt: '2026-07-01',
};

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
  it('renders the ISSUED stamp as YYYY·MM·DD only (full ISO timestamp in)', () => {
    const html = buildPayslipHtml(doc, {
      ...opts,
      locale: 'en',
      generatedAt: '2026-06-25T13:35:37.578Z',
    });
    expect(html).toContain('2026·06·25');
    expect(html).not.toContain('T13:35'); // no time/Z leaks into the stamp
  });
  it('wraps native summary micro-labels in .ml-n so they are not letter-spaced', () => {
    const html = buildPayslipHtml(doc, { ...opts, locale: 'th' });
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const mln = css.match(/\.ml-n\s*\{[^}]*\}/)![0];
    expect(mln).toMatch(/letter-spacing:\s*normal/);
    expect(mln).toMatch(/text-transform:\s*none/);
    expect(html).toContain('<span class="ml-n">'); // native is wrapped, not a bare node
  });
});

// --- real-resolver test: catches missing/renamed i18n keys ---
const resolve = (path: string, vars?: Record<string, string | number>): string => {
  const v = path
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en as unknown);
  if (typeof v !== 'string') throw new Error(`missing message: ${path}`);
  return v.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? `{${k}}`));
};

describe('buildPayslipHtml — real en.json keys', () => {
  it('resolves all i18n keys without throwing and renders expected labels', () => {
    const realDoc: PayslipDocument = {
      meta: {
        employeeName: 'Test User',
        employeeId: 'EMP-99',
        branch: 'Bangkok',
        department: 'Engineering',
        payType: 'Monthly',
        month: '2026-06',
      },
      income: {
        lines: [{ key: 'base', labelKey: 'income.base', amount: 30000, detail: null }],
        total: 30000,
      },
      deduct: {
        lines: [
          {
            key: 'sso',
            labelKey: 'deduct.sso',
            amount: 750,
            detail: { key: 'sso', vars: { pct: 5, cap: '15,000' } },
          },
        ],
        total: 750,
      },
      net: 29250,
    };
    const html = buildPayslipHtml(realDoc, {
      locale: 'en',
      t: resolve,
      tEn: resolve,
      money: (n) => `฿${n.toFixed(2)}`,
      fontFace: '/*f*/',
      logoSvg: '<svg/>',
      periodLabel: 'June 2026',
      generatedAt: '2026-07-01',
    });

    // Real resolved labels must appear in the output
    expect(html).toContain('Employee'); // payslipPdf.employee
    expect(html).toContain('Branch'); // profile.readonly.branch
    expect(html).toContain('Social security'); // payslip.deduct.sso
    expect(html).toContain('Net pay'); // payslip.net
    expect(html).toContain('5% · cap ฿15,000'); // payslipPdf.detail.sso with vars
    expect(html).toContain('Koolman Co., Ltd.'); // brand constant
  });
});
