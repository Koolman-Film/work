/**
 * THROWAWAY sample generator (local only — not wired into the app, not committed).
 * Renders a formal, stacked dual-language payslip to PDF for every locale, using
 * the recommended engine: HTML → headless Chromium (Playwright). Real label
 * translations come from messages/<locale>.json; letterhead labels + line-item
 * detail notes are sample data (flagged in chat).
 *
 * Running header/footer: a fixed-position header + footer repeat on EVERY page
 * via `position:fixed` + `@page` margins (this keeps the page's web fonts, unlike
 * page.pdf's headerTemplate which can't render Thai/Khmer reliably). A *-long
 * variant triples the deduction rows to prove the repeat across pages.
 *
 * Logo: crisp inline SVG by default; if payslip-samples/koolman-logo.{png,jpg,svg}
 * exists it is embedded instead.
 *
 * Visual direction: Japanese-inspired — ma, restraint (藍 indigo + 朱 vermilion +
 * 墨 ink + washi), hairlines, tracked Latin micro-labels (NEVER on SE-Asian
 * scripts), light numerals.
 *
 * Run:  node scripts/sample-payslip-pdf.mjs   (then rasterise with pdftoppm)
 */
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'payslip-samples');
const LOCALES = ['th', 'en', 'my', 'lo', 'zh-CN', 'km'];
const NAVY = '#1a3a78';

const money = (n) =>
  `฿${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DATA = {
  companyEn: 'Koolman Co., Ltd.',
  companyTh: 'บริษัท คูลแมน จำกัด',
  employeeName: 'Somchai Jaidee · สมชาย ใจดี',
  employeeId: 'EMP-00042',
  branchValue: 'Chiang Mai',
  departmentValue: 'Installation',
  income: { base: 20000, overtime: 1500, total: 21500 },
  deduct: { sso: 750, advance: 3000, attendance: 500, leave: 666.67, debt: 1000, uniform: 200, total: 6116.67 },
  net: 15383.33,
};

const DETAIL = {
  base: '30 days',
  overtime: '5 hr × ฿300',
  sso: '5% · cap ฿15,000',
  advance: 'requested 12 Jun',
  attendance: '1 day absent',
  leave: '420 min × ฿1.5873',
  debt: 'installment 3 / 6',
  uniform: '1 set',
};

const EXTRA = {
  th: { employee: 'พนักงาน', employeeId: 'รหัสพนักงาน', payPeriod: 'งวดเงินเดือน', overtime: 'ค่าล่วงเวลา', uniform: 'ค่าชุดพนักงาน', generatedOn: 'ออกเอกสารเมื่อ', monthly: 'รายเดือน', period: 'มิถุนายน 2569', kept: 'รับจริง', disclaimer: 'เอกสารนี้ออกโดยระบบอัตโนมัติ ไม่ต้องลงนาม' },
  en: { employee: 'Employee', employeeId: 'Employee ID', payPeriod: 'Pay period', overtime: 'Overtime allowance', uniform: 'Uniform', generatedOn: 'Generated on', monthly: 'Monthly', period: 'June 2026', kept: 'Take-home', disclaimer: 'This is a system-generated document. No signature required.' },
  my: { employee: 'ဝန်ထမ်း', employeeId: 'ဝန်ထမ်းအမှတ်', payPeriod: 'လစာကာလ', overtime: 'အချိန်ပိုကြေး', uniform: 'ယူနီဖောင်းခ', generatedOn: 'ထုတ်ပေးသည့်ရက်', monthly: 'လစဉ်', period: 'ဇွန် 2026', kept: 'လက်ခံရရှိ', disclaimer: 'ဤစာရွက်စာတမ်းကို စနစ်မှ အလိုအလျောက်ထုတ်ပေးသည်။ လက်မှတ်မလိုအပ်ပါ။' },
  lo: { employee: 'ພະນັກງານ', employeeId: 'ລະຫັດພະນັກງານ', payPeriod: 'ງວດເງິນເດືອນ', overtime: 'ຄ່າລ່ວງເວລາ', uniform: 'ຄ່າຊຸດພະນັກງານ', generatedOn: 'ອອກເອກະສານເມື່ອ', monthly: 'ລາຍເດືອນ', period: 'ມິຖຸນາ 2026', kept: 'ຮັບຈິງ', disclaimer: 'ເອກະສານນີ້ສ້າງໂດຍລະບົບ ບໍ່ຈຳເປັນຕ້ອງເຊັນ' },
  'zh-CN': { employee: '员工', employeeId: '员工编号', payPeriod: '工资周期', overtime: '加班费', uniform: '制服费', generatedOn: '生成日期', monthly: '月薪', period: '2026年6月', kept: '实得', disclaimer: '本文件由系统自动生成，无需签名。' },
  km: { employee: 'បុគ្គលិក', employeeId: 'លេខសម្គាល់បុគ្គលិក', payPeriod: 'រយៈពេលប្រាក់ខែ', overtime: 'ប្រាក់បន្ថែមម៉ោង', uniform: 'ឯកសណ្ឋាន', generatedOn: 'បង្កើតនៅ', monthly: 'ប្រចាំខែ', period: 'មិថុនា 2026', kept: 'ទទួលបាន', disclaimer: 'ឯកសារនេះបង្កើតដោយប្រព័ន្ធ មិនតម្រូវឱ្យចុះហត្ថលេខាទេ។' },
};

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;600;700&family=Noto+Sans+Thai:wght@400;500;600;700&family=Noto+Sans+Lao:wght@400;700&family=Noto+Sans+Myanmar:wght@400;700&family=Noto+Sans+Khmer:wght@400;700&family=Noto+Sans+SC:wght@400;500;700&display=swap';
const FONT_STACK =
  "'Noto Sans','Noto Sans Thai','Noto Sans Lao','Noto Sans Myanmar','Noto Sans Khmer','Noto Sans SC',sans-serif";

const LOGO_SVG = (size) => `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="Koolman Co., Ltd.">
  <circle cx="60" cy="60" r="57" fill="#ffffff" stroke="${NAVY}" stroke-width="5"/>
  <circle cx="60" cy="60" r="46" fill="${NAVY}"/>
  <rect x="4" y="47" width="112" height="26" rx="13" fill="#ffffff" stroke="${NAVY}" stroke-width="3.5"/>
  <text x="60" y="60" text-anchor="middle" dominant-baseline="central" fill="${NAVY}" font-weight="800" font-size="13" textLength="102" lengthAdjust="spacingAndGlyphs" font-family="${FONT_STACK}">KOOLMAN CO., LTD.</text>
</svg>`;

async function loadLogo() {
  for (const f of ['koolman-logo.png', 'koolman-logo.jpg', 'koolman-logo.svg']) {
    try {
      const buf = await readFile(path.join(OUT, f));
      const ext = path.extname(f).slice(1);
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {}
  }
  return null;
}

function buildHtml(locale, p, logoImg, long = false) {
  const x = EXTRA[locale];
  const isEn = locale === 'en';
  const L = (loc, en) =>
    isEn ? `<span class="t1">${en}</span>` : `<span class="t1">${loc}</span><span class="t2">${en}</span>`;
  const Li = (loc, en) => (isEn ? `<span class="t2i">${en}</span>` : `${loc}<span class="t2i">${en}</span>`);

  const gross = DATA.income.total;
  const ded = DATA.deduct.total;
  const netPct = Math.round((DATA.net / gross) * 1000) / 10;
  const dedPct = Math.round((ded / gross) * 1000) / 10;
  const dt = (k) => (k && DETAIL[k] ? `<span class="dt">${DETAIL[k]}</span>` : '');
  const row = (cls, loc, en, key, amount) =>
    `<tr><td class="cell">${L(loc, en)}</td><td class="amt ${cls}">${cls === 'neg' ? '−' : ''}${money(amount)}${dt(key)}</td></tr>`;
  const infoRow = (loc, en, value) =>
    `<div class="irow"><div class="ik">${L(loc, en)}</div><div class="iv">${value}</div></div>`;
  const sectionHead = (kind, native, en) =>
    isEn
      ? `<div class="card-h"><span class="seal-sq ${kind}"></span><span class="h-en">${en}</span></div>`
      : `<div class="card-h"><span class="seal-sq ${kind}"></span><span class="h-t1">${native}</span><span class="h-en">${en}</span></div>`;

  const dedItems = [
    [p.deduct.sso, 'Social security', 'sso', DATA.deduct.sso],
    [p.deduct.advance, 'Cash advance', 'advance', DATA.deduct.advance],
    [p.deduct.attendance, 'Absence/lateness', 'attendance', DATA.deduct.attendance],
    [p.deduct.leave, 'Over-quota leave', 'leave', DATA.deduct.leave],
    [p.deduct.debt, 'Loan/installments', 'debt', DATA.deduct.debt],
    [x.uniform, 'Uniform', 'uniform', DATA.deduct.uniform],
  ];
  const dedList = long ? [...dedItems, ...dedItems, ...dedItems] : dedItems;
  const dedHtml = dedList.map(([loc, en, key, amt]) => row('neg', loc, en, key, amt)).join('\n      ');

  const logo = logoImg ? `<img class="logo" src="${logoImg}" alt="Koolman Co., Ltd.">` : LOGO_SVG(48);

  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS_HREF}" rel="stylesheet">
<style>
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

  /* Repeating header/footer via table thead/tfoot — the print spec repeats
     these on EVERY page. (position:fixed in Chrome print anchors to the
     content box, not the page edge, so it overlaps content — table groups
     are the reliable approach and keep the page's web fonts.) */
  table.sheet{width:100%;border-collapse:collapse;}
  table.sheet > thead{display:table-header-group;}
  table.sheet > tfoot{display:table-footer-group;}
  .hdr-cell{padding:0 0 15px;text-align:left;font-weight:400;}
  .ftr-cell{padding:14px 0 0;text-align:left;font-weight:400;}
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
  .nh-val .cur{font-size:.6em;font-weight:400;color:#c2c8e0;margin-right:4px;vertical-align:.08em;}
</style></head>
<body>
<table class="sheet">
  <thead><tr><th class="hdr-cell">
    <div class="top">
      <div class="brand">
        ${logo}
        <div>
          <div class="co-name">${DATA.companyEn}</div>
          <div class="co-sub">${DATA.companyTh}</div>
        </div>
      </div>
      <div class="doc">
        <div class="doc-title">Payslip</div>
        ${isEn ? '' : `<div class="doc-native">${p.title}</div>`}
        <div class="doc-period">${x.period}</div>
        <div class="doc-plbl">${EXTRA.en.payPeriod}</div>
      </div>
    </div>
    <div class="rule"></div>
  </th></tr></thead>
  <tbody><tr><td>
  <main>
    <div class="summary">
      <div class="metric"><div class="m-lbl">${Li(p.income.title, 'Earnings')}</div><div class="m-val earn">${money(gross)}</div></div>
      <div class="metric"><div class="m-lbl">${Li(p.deduct.title, 'Deductions')}</div><div class="m-val ded">−${money(ded)}</div></div>
      <div class="metric"><div class="m-lbl">${Li(p.net, 'Net pay')}</div><div class="m-val net">${money(DATA.net)}</div></div>
    </div>
    <div class="bar"><div class="b-net" style="width:${netPct}%"></div><div class="b-ded" style="width:${dedPct}%"></div></div>
    <div class="legend">
      <span><span class="sw" style="background:var(--indigo)"></span>${EXTRA.en.kept} ${netPct}%</span>
      <span><span class="sw" style="background:#cfc8ba"></span>Deductions ${dedPct}%</span>
    </div>

    <div class="card"><div class="info">
      ${infoRow(x.employee, 'Employee', DATA.employeeName)}
      ${infoRow(x.employeeId, 'Employee ID', DATA.employeeId)}
      ${infoRow(p._branch, 'Branch', DATA.branchValue)}
      ${infoRow(p._department, 'Department', DATA.departmentValue)}
      ${infoRow(p._payType, 'Pay type', x.monthly)}
      ${infoRow(x.payPeriod, 'Pay period', x.period)}
    </div></div>

    <div class="cols">
    <div class="card">
      ${sectionHead('earn', p.income.title, 'Earnings')}
      <table class="lines">
        ${row('', p.income.base, 'Base salary', 'base', DATA.income.base)}
        ${row('', x.overtime, 'Overtime allowance', 'overtime', DATA.income.overtime)}
      </table>
      <div class="card-foot"><div class="f-lbl">${L(p.income.total, 'Total earnings')}</div><div class="f-amt">${money(DATA.income.total)}</div></div>
    </div>

    <div class="card">
      ${sectionHead('ded', p.deduct.title, 'Deductions')}
      <table class="lines">
      ${dedHtml}
      </table>
      <div class="card-foot"><div class="f-lbl">${L(p.deduct.total, 'Total deductions')}</div><div class="f-amt neg">−${money(DATA.deduct.total)}</div></div>
    </div>
    </div>

    <div class="net-hero">
      <div>
        <div class="nh-lbl">Net pay</div>
        ${isEn ? '' : `<div class="nh-native">${p.net}</div>`}
        <div class="nh-eq">${money(gross)} − ${money(ded)}</div>
      </div>
      <div class="nh-val"><span class="cur">฿</span>${num(DATA.net)}</div>
    </div>
    <div class="endmark">
      <div class="disc">${isEn ? x.disclaimer : `${x.disclaimer} · ${EXTRA.en.disclaimer}`}</div>
      <div class="stamp"><div class="s1">Issued</div><div class="s2">2026·07·01</div></div>
    </div>
  </main>
  </td></tr></tbody>
</table>
</body></html>`;
}

async function render(ctx, html, file) {
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  // Header repeats via <thead> (keeps web fonts). The footer is drawn by
  // Chrome's PDF engine in the bottom margin — pinned to the physical bottom of
  // EVERY page incl. the last (Latin/numeric only, so no font embedding needed).
  await page.pdf({
    path: file,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;box-sizing:border-box;padding:0 13mm;font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#9b9588;letter-spacing:.04em;display:flex;justify-content:space-between;">
      <span>Koolman Co., Ltd. · Generated 2026-07-01 09:14 (Asia/Bangkok)</span>
      <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`,
    margin: { top: '13mm', right: '13mm', bottom: '15mm', left: '13mm' },
  });
  await page.close();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const logoImg = await loadLogo();
  console.log(logoImg ? '• using raster logo from payslip-samples/' : '• using built-in SVG logo');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  let enP = null;
  for (const locale of LOCALES) {
    const msgs = JSON.parse(await readFile(path.join(ROOT, `messages/${locale}.json`), 'utf8'));
    const p = msgs.payslip;
    p._branch = msgs.profile.readonly.branch;
    p._department = msgs.profile.readonly.department;
    p._payType = msgs.profile.readonly.payType;
    if (locale === 'en') enP = p;
    const safe = locale.replace('/', '-');
    await render(ctx, buildHtml(locale, p, logoImg), path.join(OUT, `payslip-${safe}.pdf`));
    console.log(`✓ ${locale}`);
  }
  // Multi-page demo: triple the deductions so content flows onto page 2+.
  await render(ctx, buildHtml('en', enP, logoImg, true), path.join(OUT, 'payslip-en-long.pdf'));
  console.log('✓ en-long (multi-page demo)');
  await browser.close();
  console.log(`\nAll PDFs in: ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
