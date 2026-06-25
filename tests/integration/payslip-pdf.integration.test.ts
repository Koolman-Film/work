import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderPayslipPdf } from '@/lib/payslip/pdf';

// Needs a Chromium to drive. On Vercel `@sparticuz/chromium` provides it; locally
// we use an installed Chrome. CI has neither, so skip there (the render path is
// validated locally + on the Vercel preview deploy).
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasChromium = !!process.env.VERCEL || existsSync(CHROME);
if (!hasChromium) {
  console.warn('[skip] payslip-pdf: no Chromium (set CHROME_PATH or run on Vercel)');
}

describe.skipIf(!hasChromium)('renderPayslipPdf', () => {
  it('produces a valid PDF from HTML', async () => {
    const html = `<!doctype html><html><head><style>@page{size:A4}</style></head>
      <body><table class="sheet"><thead><tr><th>H</th></tr></thead>
      <tbody><tr><td><div style="height:1500px">content</div></td></tr></tbody></table></body></html>`;
    const buf = await renderPayslipPdf(html);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  }, 30_000);
});
