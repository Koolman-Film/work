import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser } from 'puppeteer-core';

const FOOTER = `<div style="width:100%;box-sizing:border-box;padding:0 13mm;font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#9b9588;letter-spacing:.04em;display:flex;justify-content:space-between;">
  <span>Koolman Co., Ltd.</span>
  <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

async function launch(): Promise<Browser> {
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

// Reuse ONE Chromium across renders. Launching/closing a browser per PDF is the
// dominant cost (~0.5–2s each) and is pure waste on a warm (Fluid Compute)
// instance, which serves many requests from the same process. Cache the launch
// PROMISE — concurrent first-callers then await the same launch instead of each
// spawning a browser. Stored on globalThis so dev HMR reuses it (no orphan
// Chrome processes), mirroring the Prisma singleton.
const globalForChromium = globalThis as unknown as {
  payslipBrowser?: Promise<Browser>;
};

async function getBrowser(): Promise<Browser> {
  const existing = globalForChromium.payslipBrowser;
  if (existing) {
    try {
      const browser = await existing;
      if (browser.connected) return browser;
    } catch {
      // Launch rejected — fall through and try again below.
    }
  }

  const launched = launch();
  globalForChromium.payslipBrowser = launched;
  // Drop the cache if this browser dies or never came up, so the next render
  // relaunches instead of awaiting a dead handle.
  const forget = () => {
    if (globalForChromium.payslipBrowser === launched) {
      globalForChromium.payslipBrowser = undefined;
    }
  };
  launched.then((browser) => browser.once('disconnected', forget)).catch(forget);
  return launched;
}

/**
 * Close the shared browser. Production never needs this (the instance is killed
 * on shutdown), but tests must call it in teardown — otherwise the live Chromium
 * keeps the event loop alive and hangs the run.
 */
export async function closePayslipBrowser(): Promise<void> {
  const existing = globalForChromium.payslipBrowser;
  globalForChromium.payslipBrowser = undefined;
  if (!existing) return;
  await existing.then((browser) => browser.close()).catch(() => {});
}

export async function renderPayslipPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
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
    // Close only the page — the browser stays warm for the next render.
    await page.close().catch(() => {});
  }
}
