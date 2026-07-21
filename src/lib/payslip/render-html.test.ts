// src/lib/payslip/render-html.test.ts
import { describe, expect, it } from 'vitest';
import { localizedLeaveTypeName } from '@/lib/leave/localized-name';
import en from '../../../messages/en.json';
import my from '../../../messages/my.json';
import { buildPayslipHtml } from './render-html';
import type { PayslipDocument } from './types';

// --- stub helpers (echo-key) for structural invariant tests ---
const doc: PayslipDocument = {
  meta: {
    employeeName: 'Somchai Jaidee',
    employeeId: 'EMP-1',
    branch: 'Chiang Mai',
    branchEn: null,
    letterhead: { payslipNameEn: null, payslipNameNative: null, payslipLogoKey: null },
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
const tRef = (k: string) => k; // echo key for the reference line
const money = (n: number) => `฿${n.toFixed(2)}`;
const opts = {
  t,
  tRef,
  money,
  fontFace: '/*f*/',
  logoSvg: '<svg/>',
  periodLabel: 'มิถุนายน 2569',
  generatedAt: '2026-07-01',
  companyEn: 'Koolman Co., Ltd.',
  companyNative: 'บริษัท คูลแมน จำกัด',
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
  it('renders a Thai reference second line (.ml-n) for a non-Thai employee', () => {
    // Non-Thai slip → reference line is Thai, which must drop the Latin
    // tracking/uppercase via .ml-n so the script shapes correctly.
    const html = buildPayslipHtml(doc, { ...opts, locale: 'en' });
    expect(html).toContain('class="t2 ml-n"');
  });
  it('renders an English reference second line (tracked, no .ml-n) for a Thai employee', () => {
    const html = buildPayslipHtml(doc, { ...opts, locale: 'th' });
    expect(html).toContain('class="t2"'); // Latin reference keeps the micro-label style
    expect(html).not.toContain('class="t2 ml-n"');
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
    // !important is required: `ml-n` is appended to higher-specificity descendant
    // selectors (.stamp .s1, .card-h .h-en) and later-defined rules (.doc-plbl,
    // .nh-lbl), so a plain rule would lose the cascade and leave Thai/complex
    // scripts letter-spaced.
    expect(mln).toMatch(/letter-spacing:\s*normal\s*!important/);
    expect(mln).toMatch(/text-transform:\s*none\s*!important/);
    expect(html).toContain('<span class="ml-n">'); // native is wrapped, not a bare node
  });
  it('localizes the pay-type VALUE via profile.salaryType (not the raw enum)', () => {
    const html = buildPayslipHtml(doc, { ...opts, locale: 'th' });
    expect(html).toContain('profile.salaryType.Monthly'); // stub echoes the resolved key
  });
  it('omits the department row entirely when there is no department', () => {
    const noDept = { ...doc, meta: { ...doc.meta, department: null } };
    const html = buildPayslipHtml(noDept, { ...opts, locale: 'th' });
    expect(html).not.toContain('profile.readonly.department');
  });
  it('print path (default) adds NO screen viewport or body padding', () => {
    const html = buildPayslipHtml(doc, { ...opts, locale: 'th' });
    expect(html).not.toContain('name="viewport"');
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    expect(css).not.toMatch(/body\{padding:13mm/);
  });
  it('screen mode adds a fixed-width viewport + print margins so it scales to fit', () => {
    const html = buildPayslipHtml(doc, { ...opts, locale: 'th', screen: true });
    expect(html).toContain('<meta name="viewport" content="width=794, initial-scale=1">');
    expect(html).toMatch(/body\{padding:13mm 13mm 15mm;\}/);
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
        branchEn: null,
        letterhead: { payslipNameEn: null, payslipNameNative: null, payslipLogoKey: null },
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
      tRef: resolve,
      money: (n) => `฿${n.toFixed(2)}`,
      fontFace: '/*f*/',
      logoSvg: '<svg/>',
      periodLabel: 'June 2026',
      generatedAt: '2026-07-01',
      companyEn: 'Koolman Co., Ltd.',
      companyNative: 'บริษัท คูลแมน จำกัด',
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

describe('buildPayslipHtml — per-branch letterhead + branch localization', () => {
  it('renders the companyEn / companyNative opts in the header', () => {
    const html = buildPayslipHtml(
      {
        ...doc,
        meta: {
          ...doc.meta,
          branchEn: null,
          letterhead: { payslipNameEn: null, payslipNameNative: null, payslipLogoKey: null },
        },
      },
      { ...opts, locale: 'th', companyEn: 'Acme Co., Ltd.', companyNative: 'บริษัท แอคมี จำกัด' },
    );
    expect(html).toContain('Acme Co., Ltd.');
    expect(html).toContain('บริษัท แอคมี จำกัด');
  });

  it('shows the English branch name in the สาขา field for a non-Thai locale', () => {
    const meta = {
      ...doc.meta,
      branch: 'เชียงใหม่',
      branchEn: 'Chiang Mai',
      letterhead: { payslipNameEn: null, payslipNameNative: null, payslipLogoKey: null },
    };
    const en = buildPayslipHtml(
      { ...doc, meta },
      { ...opts, locale: 'en', companyEn: 'X', companyNative: 'Y' },
    );
    expect(en).toContain('Chiang Mai');
    const th = buildPayslipHtml(
      { ...doc, meta },
      { ...opts, locale: 'th', companyEn: 'X', companyNative: 'Y' },
    );
    expect(th).toContain('เชียงใหม่');
  });
});

describe('buildPayslipHtml — settled-with-leave note is locale-aware', () => {
  // Regression guard for the finding this branch fixes: document.ts used to
  // bake the whole sentence — including the leave-type name — into a
  // hardcoded Thai literal `label`, so every employee saw it in Thai
  // regardless of their own locale. It must now go through `labelKey` +
  // `vars` (resolved per-locale, like every other system-authored line) with
  // the leave-type name localized via `localizedLeaveTypeName`.
  it('renders the my.json translation for a non-Thai employee, not the hardcoded Thai sentence', () => {
    const leaveType = { name: 'ลาพักร้อน', nameByLocale: { my: 'ခွင့်ရက်အထူး' } };
    const settledDoc: PayslipDocument = {
      ...doc,
      deduct: {
        lines: [
          {
            key: 'settledAbsent',
            labelKey: 'deduct.settledAbsent',
            vars: { days: 1 },
            leaveType,
            amount: 0,
            detail: null,
          },
        ],
        total: 0,
      },
    };

    const resolveMy = (path: string, vars?: Record<string, string | number>): string => {
      const v = path
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], my as unknown);
      if (typeof v !== 'string') throw new Error(`missing message: ${path}`);
      return v.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? `{${k}}`));
    };
    // Isolate: only the primary (employee-locale) line uses real translations
    // — the reference line just echoes its key, so any Thai text found in
    // the output can only have leaked in via the primary line.
    const echoTRef = (k: string) => k;

    const html = buildPayslipHtml(settledDoc, {
      locale: 'my',
      t: resolveMy,
      tRef: echoTRef,
      money: (n) => `฿${n.toFixed(2)}`,
      fontFace: '/*f*/',
      logoSvg: '<svg/>',
      periodLabel: 'ယခုလ',
      generatedAt: '2026-07-01',
      companyEn: 'Koolman Co., Ltd.',
      companyNative: 'บริษัท คูลแมน จำกัด',
    });

    const expectedMyText = resolveMy('payslip.deduct.settledAbsent', {
      days: 1,
      leaveType: localizedLeaveTypeName(leaveType.name, leaveType.nameByLocale, 'my'),
    });
    expect(expectedMyText).toContain('ခွင့်ရက်အထူး'); // sanity: the localized name was actually used
    expect(html).toContain(expectedMyText);
    // Must not be the hardcoded Thai sentence the pre-fix implementation
    // baked into a literal `label` regardless of the employee's locale.
    expect(html).not.toContain('ขาดงาน — หักจากสิทธิลาพักร้อน 1 วัน');
    expect(html).not.toContain('ลาพักร้อน'); // Thai leave-type name must not leak into a my-locale slip
  });
});
