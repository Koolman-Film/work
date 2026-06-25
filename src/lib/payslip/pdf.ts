import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const FOOTER = `<div style="width:100%;box-sizing:border-box;padding:0 13mm;font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#9b9588;letter-spacing:.04em;display:flex;justify-content:space-between;">
  <span>Koolman Co., Ltd.</span>
  <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

async function launch() {
  if (process.env.VERCEL) {
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  // Local dev: use an installed Chrome/Chromium.
  const local =
    process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return puppeteer.launch({ executablePath: local, headless: true });
}

export async function renderPayslipPdf(html: string): Promise<Buffer> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: FOOTER,
      margin: { top: '13mm', right: '13mm', bottom: '15mm', left: '13mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
