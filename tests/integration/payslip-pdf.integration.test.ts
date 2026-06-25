import { describe, expect, it } from 'vitest';
import { renderPayslipPdf } from '@/lib/payslip/pdf';

describe('renderPayslipPdf', () => {
  it('produces a valid PDF from HTML', async () => {
    const html = `<!doctype html><html><head><style>@page{size:A4}</style></head>
      <body><table class="sheet"><thead><tr><th>H</th></tr></thead>
      <tbody><tr><td><div style="height:1500px">content</div></td></tr></tbody></table></body></html>`;
    const buf = await renderPayslipPdf(html);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  }, 30_000);
});
