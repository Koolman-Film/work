// src/lib/payslip/render-html.ts
// Pure HTML-string builder for the PDF payslip.
// Ports the validated visual template from scripts/sample-payslip-pdf.mjs.
// No DB, no Chromium — pure function.

import { FONT_STACK } from './fonts';
import type { PayslipDocument, PayslipLine } from './types';

// Brand constants — identical in all locales, no i18n needed.
const COMPANY_EN = 'Koolman Co., Ltd.';
const COMPANY_NATIVE = 'บริษัท คูลแมน จำกัด';

// Single currency for this app.
const CUR = '฿';

export interface BuildPayslipHtmlOpts {
  locale: string;
  /**
   * Root (namespace-less) translator for the locale language.
   * Pass full dotted keys, e.g. `payslip.income.title`, `payslipPdf.employee`.
   * Obtained via `getTranslations({ locale })` with no namespace argument.
   */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /**
   * Root (namespace-less) translator always in English.
   * Pass full dotted keys — same convention as `t`.
   */
  tEn: (key: string) => string;
  /** formatMoney bound to the locale */
  money: (n: number) => string;
  /** fontFaceCss(locale) */
  fontFace: string;
  /** inline SVG or <img> data-uri */
  logoSvg: string;
  /** already-localized month label */
  periodLabel: string;
  generatedAt: string;
}

// Critical CSS rule — copy verbatim from task brief.
// .t1: native script — NO letter-spacing, NO text-transform.
// .t2: Latin micro-label — HAS both.
const PAYSLIP_CSS = (fontFace: string) => `${fontFace}
  @page{ size:A4; }
  :root{
    --ink:#23211c; --muted:#6f6a60; --faint:#a8a294; --line:#e7e2d8; --line-2:#d9d3c6;
    --indigo:#1a3a78; --indigo-deep:#15305f; --vermilion:#b5402f; --washi:#faf8f3;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:${FONT_STACK};color:var(--ink);font-size:14px;line-height:1.4;}
  .t1{display:block;font-weight:500;}
  .t2{display:block;font-size:9.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--faint);font-weight:500;line-height:1.3;margin-top:1px;}
  .t2i{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--faint);font-weight:500;margin-left:8px;}
  .dt{display:block;font-size:11px;color:var(--muted);margin-top:2px;font-weight:400;white-space:normal;font-variant-numeric:tabular-nums;}

  /* Repeating header via table thead — the print spec repeats on EVERY page. */
  table.sheet{width:100%;border-collapse:collapse;}
  table.sheet > thead{display:table-header-group;}
  .hdr-cell{padding:0 0 15px;text-align:left;font-weight:400;}
  .top{display:flex;justify-content:space-between;align-items:center;}
  .brand{display:flex;gap:13px;align-items:center;}
  .logo{display:block;width:48px;height:48px;}
  .co-name{font-size:19px;font-weight:600;color:var(--indigo-deep);letter-spacing:.01em;}
  .co-sub{font-size:12px;color:var(--muted);margin-top:2px;}
  .doc{text-align:right;}
  .doc-title{font-size:15px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--indigo);}
  .doc-native{font-size:12px;color:var(--muted);margin-top:1px;}
  .doc-period{margin-top:6px;font-size:15px;font-weight:500;font-variant-numeric:tabular-nums;}
  .doc-plbl{font-size:9px;letter-spacing:.15em;text-transform:uppercase;color:var(--faint);margin-top:2px;}
  .rule{height:1px;background:var(--line-2);margin:11px 0 0;}

  /* Closing mark (once, after net pay) — disclaimer + hanko seal. */
  .endmark{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;
    margin-top:14px;padding-top:12px;border-top:1px solid var(--line);}
  .disc{font-size:10px;color:var(--faint);line-height:1.55;letter-spacing:.02em;}
  .stamp{flex:none;border:2px solid var(--vermilion);color:var(--vermilion);border-radius:5px;
    padding:5px 9px;text-align:center;transform:rotate(-6deg);opacity:.9;}
  .stamp .s1{font-size:10px;letter-spacing:.22em;text-transform:uppercase;font-weight:600;}
  .stamp .s2{font-size:8.5px;letter-spacing:.1em;margin-top:2px;font-variant-numeric:tabular-nums;}

  /* Summary */
  .summary{display:flex;border:1px solid var(--line);border-radius:6px;background:var(--washi);}
  .metric{flex:1;padding:11px 18px;}
  .metric + .metric{border-left:1px solid var(--line);}
  .m-lbl{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);}
  .m-val{margin-top:6px;font-size:23px;font-weight:500;font-variant-numeric:tabular-nums;letter-spacing:.01em;}
  .m-val.earn{color:var(--ink);} .m-val.ded{color:var(--vermilion);} .m-val.net{color:var(--indigo);font-weight:600;}

  .bar{height:6px;border-radius:3px;overflow:hidden;display:flex;margin:10px 0 6px;background:var(--line);}
  .bar .b-net{background:var(--indigo);} .bar .b-ded{background:#cfc8ba;}
  .legend{display:flex;gap:22px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
  .legend .sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:7px;vertical-align:middle;}

  .card{border:1px solid var(--line);border-radius:6px;margin-top:10px;overflow:hidden;background:#fff;}
  .card-h{display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--line);}
  .seal-sq{width:9px;height:9px;border-radius:1px;}
  .seal-sq.earn{background:var(--indigo);} .seal-sq.ded{background:var(--vermilion);}
  .card-h .h-t1{font-size:16px;font-weight:600;}
  .card-h .h-en{font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);font-weight:500;}
  .card-foot{display:flex;justify-content:space-between;align-items:baseline;padding:10px 18px;border-top:1px solid var(--line-2);}
  .card-foot .f-lbl .t1{font-weight:600;} .card-foot .f-lbl .t2{margin-top:2px;}
  .card-foot .f-amt{font-weight:600;font-size:16px;font-variant-numeric:tabular-nums;}
  .card-foot .f-amt.neg{color:var(--vermilion);}

  .info{padding:4px 18px;display:grid;grid-template-columns:1fr 1fr;gap:0 34px;}
  .irow{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--line);}
  .irow:nth-last-of-type(-n+2){border-bottom:none;}
  .ik{color:var(--muted);}
  .iv{font-weight:600;text-align:right;}

  .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:10px;}
  .cols .card{margin-top:0;}
  table.lines{width:100%;border-collapse:collapse;}
  table.lines td{padding:7px 18px;border-bottom:1px solid var(--line);vertical-align:top;}
  table.lines tr:last-child td{border-bottom:none;}
  .amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;width:46%;font-weight:600;font-size:15px;}
  .amt.neg{color:var(--vermilion);}

  .net-hero{margin-top:10px;background:var(--indigo);border-radius:6px;padding:14px 22px;
    display:flex;justify-content:space-between;align-items:center;color:#fff;}
  .nh-lbl{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:#aab4d6;}
  .nh-native{font-size:16px;font-weight:500;margin-top:4px;}
  .nh-eq{font-size:11px;color:#9aa3c6;margin-top:5px;font-variant-numeric:tabular-nums;letter-spacing:.04em;}
  .nh-val{font-size:40px;font-weight:300;font-variant-numeric:tabular-nums;letter-spacing:.01em;}
  .nh-val .cur{font-size:.6em;font-weight:400;color:#c2c8e0;margin-right:4px;vertical-align:.08em;}`;

export function buildPayslipHtml(doc: PayslipDocument, opts: BuildPayslipHtmlOpts): string {
  const { locale, t, tEn, money, fontFace, logoSvg, periodLabel, generatedAt } = opts;
  const isEn = locale === 'en';

  // Dual-language label: native .t1 + English .t2 (omit .t2 when locale is en)
  const label = (native: string, en: string): string =>
    isEn
      ? `<span class="t1">${en}</span>`
      : `<span class="t1">${native}</span><span class="t2">${en}</span>`;

  // Inline label for summary strip (uses .t2i inline style, not block)
  const labelInline = (native: string, en: string): string =>
    isEn ? `<span class="t2i">${en}</span>` : `${native}<span class="t2i">${en}</span>`;

  const lineRow = (cls: 'pos' | 'neg' | '', l: PayslipLine): string => {
    const native = l.label ?? t('payslip.' + l.labelKey!);
    const en = l.label ?? tEn('payslip.' + l.labelKey!);
    const detail = l.detail
      ? `<span class="dt">${t('payslipPdf.detail.' + l.detail.key, l.detail.vars)}</span>`
      : '';
    const sign = cls === 'neg' ? '−' : '';
    return (
      `<tr><td class="cell">${label(native, en)}</td>` +
      `<td class="amt ${cls}">${sign}${money(l.amount)}${detail}</td></tr>`
    );
  };

  const infoRow = (native: string, en: string, value: string): string =>
    `<div class="irow"><div class="ik">${label(native, en)}</div><div class="iv">${value}</div></div>`;

  const sectionHead = (kind: 'earn' | 'ded', native: string, en: string): string =>
    isEn
      ? `<div class="card-h"><span class="seal-sq ${kind}"></span><span class="h-en">${en}</span></div>`
      : `<div class="card-h"><span class="seal-sq ${kind}"></span><span class="h-t1">${native}</span><span class="h-en">${en}</span></div>`;

  const gross = doc.income.total;
  const ded = doc.deduct.total;
  const netPct = Math.round((doc.net / gross) * 1000) / 10;
  const dedPct = Math.round((ded / gross) * 1000) / 10;

  const incomeRows = doc.income.lines.map((l) => lineRow('', l)).join('\n        ');
  const deductRows = doc.deduct.lines.map((l) => lineRow('neg', l)).join('\n        ');

  // Stamp date: format generatedAt as YYYY·MM·DD
  const stampDate = generatedAt.replace(/-/g, '·');

  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<style>
${PAYSLIP_CSS(fontFace)}
</style></head>
<body>
<table class="sheet">
  <thead><tr><th class="hdr-cell">
    <div class="top">
      <div class="brand">
        ${logoSvg}
        <div>
          <div class="co-name">${COMPANY_EN}</div>
          <div class="co-sub">${isEn ? '' : COMPANY_NATIVE}</div>
        </div>
      </div>
      <div class="doc">
        <div class="doc-title">Payslip</div>
        ${isEn ? '' : `<div class="doc-native">${t('payslip.title')}</div>`}
        <div class="doc-period">${periodLabel}</div>
        <div class="doc-plbl">Pay period</div>
      </div>
    </div>
    <div class="rule"></div>
  </th></tr></thead>
  <tbody><tr><td>
  <main>
    <div class="summary">
      <div class="metric"><div class="m-lbl">${labelInline(t('payslip.income.title'), tEn('payslip.income.title'))}</div><div class="m-val earn">${money(gross)}</div></div>
      <div class="metric"><div class="m-lbl">${labelInline(t('payslip.deduct.title'), tEn('payslip.deduct.title'))}</div><div class="m-val ded">−${money(ded)}</div></div>
      <div class="metric"><div class="m-lbl">${labelInline(t('payslip.net'), tEn('payslip.net'))}</div><div class="m-val net">${money(doc.net)}</div></div>
    </div>
    <div class="bar"><div class="b-net" style="width:${netPct}%"></div><div class="b-ded" style="width:${dedPct}%"></div></div>
    <div class="legend">
      <span><span class="sw" style="background:var(--indigo)"></span>${isEn ? tEn('payslipPdf.kept') : t('payslipPdf.kept')} ${netPct}%</span>
      <span><span class="sw" style="background:#cfc8ba"></span>${tEn('payslip.deduct.title')} ${dedPct}%</span>
    </div>

    <div class="card"><div class="info">
      ${infoRow(t('payslipPdf.employee'), tEn('payslipPdf.employee'), doc.meta.employeeName)}
      ${infoRow(t('payslipPdf.employeeId'), tEn('payslipPdf.employeeId'), doc.meta.employeeId)}
      ${infoRow(t('profile.readonly.branch'), tEn('profile.readonly.branch'), doc.meta.branch)}
      ${infoRow(t('profile.readonly.department'), tEn('profile.readonly.department'), doc.meta.department ?? '')}
      ${infoRow(t('payslipPdf.payType'), tEn('payslipPdf.payType'), doc.meta.payType)}
      ${infoRow(t('payslipPdf.payPeriod'), tEn('payslipPdf.payPeriod'), periodLabel)}
    </div></div>

    <div class="cols">
    <div class="card">
      ${sectionHead('earn', t('payslip.income.title'), tEn('payslip.income.title'))}
      <table class="lines">
        ${incomeRows}
      </table>
      <div class="card-foot"><div class="f-lbl">${label(t('payslip.income.total'), tEn('payslip.income.total'))}</div><div class="f-amt">${money(gross)}</div></div>
    </div>

    <div class="card">
      ${sectionHead('ded', t('payslip.deduct.title'), tEn('payslip.deduct.title'))}
      <table class="lines">
        ${deductRows}
      </table>
      <div class="card-foot"><div class="f-lbl">${label(t('payslip.deduct.total'), tEn('payslip.deduct.total'))}</div><div class="f-amt neg">−${money(ded)}</div></div>
    </div>
    </div>

    <div class="net-hero">
      <div>
        <div class="nh-lbl">${tEn('payslip.net')}</div>
        ${isEn ? '' : `<div class="nh-native">${t('payslip.net')}</div>`}
        <div class="nh-eq">${money(gross)} − ${money(ded)}</div>
      </div>
      <div class="nh-val"><span class="cur">${CUR}</span>${money(doc.net).replace(/^฿/, '')}</div>
    </div>
    <div class="endmark">
      <div class="disc">${isEn ? tEn('payslipPdf.disclaimer') : `${t('payslipPdf.disclaimer')} · ${tEn('payslipPdf.disclaimer')}`}</div>
      <div class="stamp"><div class="s1">${tEn('payslipPdf.issued')}</div><div class="s2">${stampDate}</div></div>
    </div>
  </main>
  </td></tr></tbody>
</table>
</body></html>`;
}
