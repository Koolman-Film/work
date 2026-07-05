import 'server-only';
/**
 * HTML→PDF via headless Chromium. On Vercel: @sparticuz/chromium binary.
 * Locally: falls back to an installed Chrome (CHROME_EXECUTABLE_PATH env
 * override → common macOS path).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import type { ExportTable } from './export-table';
import { type PdfFonts, renderPdfHtml } from './pdf-html';

const FONT_DIR = join(process.cwd(), 'src/lib/export/fonts');
let fontsCache: PdfFonts | null = null;

async function loadFonts(): Promise<PdfFonts> {
  if (!fontsCache) {
    const [regular, bold] = await Promise.all([
      readFile(join(FONT_DIR, 'IBMPlexSansThai-Regular.ttf')),
      readFile(join(FONT_DIR, 'IBMPlexSansThai-Bold.ttf')),
    ]);
    fontsCache = { regularB64: regular.toString('base64'), boldB64: bold.toString('base64') };
  }
  return fontsCache;
}

const LOCAL_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function launch() {
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      // sparticuz ships the headless *shell* binary — per its README, puppeteer
      // must launch with 'shell'; `true` sends full-Chrome flags and fails only in prod.
      headless: 'shell',
    });
  }
  return puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH ?? LOCAL_CHROME,
    headless: true,
  });
}

export async function toPdf(table: ExportTable): Promise<Buffer> {
  const html = renderPdfHtml(table, await loadFonts());
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:7pt;color:#94a3b8;padding:0 10mm;display:flex;justify-content:space-between;">
        <span>Koolman HR</span><span>หน้า <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
