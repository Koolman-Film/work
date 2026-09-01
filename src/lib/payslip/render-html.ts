// src/lib/payslip/render-html.ts
// Pure HTML-string builder for the PDF payslip.
// Ports the validated visual template from scripts/sample-payslip-pdf.mjs.
// No DB, no Chromium — pure function.

import type { Locale } from '@/lib/i18n/config';
import { FONT_STACK } from './fonts';
import { payslipLineVars } from './line-vars';
import type { PayslipDocument, PayslipLine } from './types';

// Brand constants — identical in all locales, no i18n needed.
export const COMPANY_EN = 'Koolman Co., Ltd.';
export const COMPANY_NATIVE = 'บริษัท คูลแมน จำกัด';

// Single currency for this app.
const CUR = '฿';

export interface BuildPayslipHtmlOpts {
  locale: string;
  /**
   * Root (namespace-less) translator for the PRIMARY (employee's) language.
   * Pass full dotted keys, e.g. `payslip.income.title`, `payslipPdf.employee`.
   * Obtained via `getTranslations({ locale })` with no namespace argument.
   */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /**
   * Root (namespace-less) translator for the REFERENCE language shown on the
   * second line of each label: English when the employee's language is Thai,
   * otherwise Thai. Caller computes `refLocale = locale === 'th' ? 'en' : 'th'`
   * and passes `getTranslations({ locale: refLocale })`.
   */
  tRef: (key: string, vars?: Record<string, string | number>) => string;
  /** formatMoney bound to the locale */
  money: (n: number) => string;
  /** fontFaceCss(locale) */
  fontFace: string;
  /** inline SVG or <img> data-uri */
  logoSvg: string;
  /** Company name shown in the header (English line). Default: COMPANY_EN. */
  companyEn: string;
  /** Company name shown in the header (native line). Default: COMPANY_NATIVE. */
  companyNative: string;
  /** already-localized month label */
  periodLabel: string;
  generatedAt: string;
  /**
   * Render for an on-screen preview instead of print. Adds a fixed-width
   * viewport (so the A4-width layout scales to fit any frame, e.g. an iPad
   * iframe) and reinstates the print page margins inside the body (Chromium
   * applies those itself for the real PDF, so they're omitted by default).
   * No effect on the PDF path.
   */
  screen?: boolean;
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
  /* Native/reference text inside the tracked/uppercase micro-labels must NOT
     inherit letter-spacing/uppercase — it breaks Khmer/Myanmar/Lao shaping and
     spaces out Thai. Uses !important because some targets are descendant
     selectors (.stamp .s1, .card-h .h-en) or defined later (.doc-plbl, .nh-lbl)
     that would otherwise win the cascade when ml-n is added to their class. */
  .ml-n{letter-spacing:normal !important;text-transform:none !important;}
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
  const {
    locale,
    t,
    tRef,
    money,
    fontFace,
    logoSvg,
    companyEn,
    companyNative,
    periodLabel,
    generatedAt,
  } = opts;

  // The slip is always bilingual: line 1 = the employee's language (`t`),
  // line 2 = the reference language (`tRef`) — English for Thai employees,
  // Thai for everyone else. The reference is Latin only when the employee is
  // Thai; a Thai reference must drop the Latin micro-label tracking/uppercase
  // (via .ml-n) or the shaping looks wrong.
  const refIsLatin = locale === 'th';
  const refCls = refIsLatin ? '' : ' ml-n';
  // Mirrors the caller's own `refLocale = locale === 'th' ? 'en' : 'th'` rule
  // (see the `tRef` doc above) — needed here too so a locale-dependent
  // `{leaveType}` interpolation can be resolved separately for each side of
  // the bilingual label.
  const refLocale: Locale = locale === 'th' ? 'en' : 'th';
  // The seal text uses the employee's own language; only English (Latin) may
  // keep the .s1 uppercase/tracking — other scripts need the .ml-n reset.
  const primaryCls = locale === 'en' ? '' : ' ml-n';
  // Thai text regardless of employee locale (Thai is `t` for th, `tRef` for the
  // rest) — used for the fixed masthead sub-title.
  const tThai = (k: string): string => (locale === 'th' ? t(k) : tRef(k));

  // Non-Thai employees see the English branch name in the สาขา field.
  const branchLabel = locale === 'th' ? doc.meta.branch : doc.meta.branchEn || doc.meta.branch;

  // Dual-language label: primary .t1 + reference .t2.
  const label = (primary: string, ref: string): string =>
    `<span class="t1">${primary}</span><span class="t2${refCls}">${ref}</span>`;

  // Inline label for summary strip (uses .t2i inline style, not block). The
  // primary is wrapped in .ml-n so it does NOT inherit the micro-label's
  // letter-spacing/uppercase (which would break complex-script shaping); the
  // reference keeps the tracked style only when it is Latin.
  const labelInline = (primary: string, ref: string): string =>
    `<span class="ml-n">${primary}</span><span class="t2i${refCls}">${ref}</span>`;

  // The `{leaveType}` and `{date}` placeholders can't be pre-formatted upstream
  // — `document.ts` has no locale awareness by design — so they're resolved per
  // side of the bilingual label, from the raw data the line carries. Shared with
  // the on-screen slip so the two can't drift.
  const lineVars = (l: PayslipLine, loc: Locale) => payslipLineVars(l, loc);

  const lineRow = (cls: 'pos' | 'neg' | '', l: PayslipLine): string => {
    // Free-text lines (adjustment reasons) have no translation — render once.
    const cell = l.label
      ? `<span class="t1">${l.label}</span>`
      : label(
          t(`payslip.${l.labelKey!}`, lineVars(l, locale as Locale)),
          tRef(`payslip.${l.labelKey!}`, lineVars(l, refLocale)),
        );
    const detail = l.detail
      ? `<span class="dt">${t(`payslipPdf.detail.${l.detail.key}`, l.detail.vars)}</span>`
      : '';
    const sign = cls === 'neg' ? '−' : '';
    return (
      `<tr><td class="cell">${cell}</td>` +
      `<td class="amt ${cls}">${sign}${money(l.amount)}${detail}</td></tr>`
    );
  };

  const infoRow = (primary: string, ref: string, value: string): string =>
    `<div class="irow"><div class="ik">${label(primary, ref)}</div><div class="iv">${value}</div></div>`;

  const sectionHead = (kind: 'earn' | 'ded', primary: string, ref: string): string =>
    `<div class="card-h"><span class="seal-sq ${kind}"></span><span class="h-t1">${primary}</span><span class="h-en${refCls}">${ref}</span></div>`;

  const gross = doc.income.total;
  const ded = doc.deduct.total;
  // Guard a zero-income slip — avoid NaN% in the take-home bar/legend.
  const netPct = gross > 0 ? Math.round((doc.net / gross) * 1000) / 10 : 0;
  const dedPct = gross > 0 ? Math.round((ded / gross) * 1000) / 10 : 0;

  const incomeRows = doc.income.lines.map((l) => lineRow('', l)).join('\n        ');
  const deductRows = doc.deduct.lines.map((l) => lineRow('neg', l)).join('\n        ');

  // Stamp date: YYYY·MM·DD only (generatedAt is a full ISO string from the route).
  const stampDate = generatedAt.slice(0, 10).replace(/-/g, '·');

  // On-screen preview: lay the A4-width sheet out at a fixed 794px and let the
  // browser scale it to the frame (viewport), plus restore the print margins
  // (Chromium adds those itself for the PDF). Both are no-ops for the PDF path.
  const screenHead = opts.screen
    ? '\n<meta name="viewport" content="width=794, initial-scale=1">'
    : '';
  const screenCss = opts.screen ? '\n  body{padding:13mm 13mm 15mm;}' : '';

  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">${screenHead}
<style>
${PAYSLIP_CSS(fontFace)}${screenCss}
</style></head>
<body>
<table class="sheet">
  <thead><tr><th class="hdr-cell">
    <div class="top">
      <div class="brand">
        ${logoSvg}
        <div>
          <div class="co-name">${companyEn}</div>
          <div class="co-sub">${companyNative}</div>
        </div>
      </div>
      <div class="doc">
        <div class="doc-title">Payslip</div>
        <div class="doc-native">${tThai('payslip.title')}</div>
        <div class="doc-period">${periodLabel}</div>
        <div class="doc-plbl${refCls}">${tRef('payslipPdf.payPeriod')}</div>
      </div>
    </div>
    <div class="rule"></div>
  </th></tr></thead>
  <tbody><tr><td>
  <main>
    <div class="summary">
      <div class="metric"><div class="m-lbl">${labelInline(t('payslip.income.title'), tRef('payslip.income.title'))}</div><div class="m-val earn">${money(gross)}</div></div>
      <div class="metric"><div class="m-lbl">${labelInline(t('payslip.deduct.title'), tRef('payslip.deduct.title'))}</div><div class="m-val ded">−${money(ded)}</div></div>
      <div class="metric"><div class="m-lbl">${labelInline(t('payslip.net'), tRef('payslip.net'))}</div><div class="m-val net">${money(doc.net)}</div></div>
    </div>
    <div class="bar"><div class="b-net" style="width:${netPct}%"></div><div class="b-ded" style="width:${dedPct}%"></div></div>
    <div class="legend">
      <span><span class="sw" style="background:var(--indigo)"></span><span class="ml-n">${t('payslipPdf.kept')}</span> ${netPct}%</span>
      <span><span class="sw" style="background:#cfc8ba"></span><span class="ml-n">${t('payslip.deduct.title')}</span> ${dedPct}%</span>
    </div>

    <div class="card"><div class="info">
      ${infoRow(t('payslipPdf.employee'), tRef('payslipPdf.employee'), doc.meta.employeeName)}
      ${infoRow(t('profile.readonly.branch'), tRef('profile.readonly.branch'), branchLabel)}
      ${doc.meta.department ? infoRow(t('profile.readonly.department'), tRef('profile.readonly.department'), doc.meta.department) : ''}
      ${infoRow(t('payslipPdf.payType'), tRef('payslipPdf.payType'), t(`profile.salaryType.${doc.meta.payType}`))}
      ${infoRow(t('payslipPdf.payPeriod'), tRef('payslipPdf.payPeriod'), periodLabel)}
    </div></div>

    <div class="cols">
    <div class="card">
      ${sectionHead('earn', t('payslip.income.title'), tRef('payslip.income.title'))}
      <table class="lines">
        ${incomeRows}
      </table>
      <div class="card-foot"><div class="f-lbl">${label(t('payslip.income.total'), tRef('payslip.income.total'))}</div><div class="f-amt">${money(gross)}</div></div>
    </div>

    <div class="card">
      ${sectionHead('ded', t('payslip.deduct.title'), tRef('payslip.deduct.title'))}
      <table class="lines">
        ${deductRows}
      </table>
      <div class="card-foot"><div class="f-lbl">${label(t('payslip.deduct.total'), tRef('payslip.deduct.total'))}</div><div class="f-amt neg">−${money(ded)}</div></div>
    </div>
    </div>

    <div class="net-hero">
      <div>
        <div class="nh-lbl${refCls}">${tRef('payslip.net')}</div>
        <div class="nh-native">${t('payslip.net')}</div>
        <div class="nh-eq">${money(gross)} − ${money(ded)}</div>
      </div>
      <div class="nh-val"><span class="cur">${CUR}</span>${money(doc.net).replace(/^฿/, '')}</div>
    </div>
    <div class="endmark">
      <div class="disc">${t('payslipPdf.disclaimer')}</div>
      <div class="stamp"><div class="s1${primaryCls}">${t('payslipPdf.issued')}</div><div class="s2">${stampDate}</div></div>
    </div>
  </main>
  </td></tr></tbody>
</table>
</body></html>`;
}
