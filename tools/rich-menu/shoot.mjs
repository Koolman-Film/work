// Render menu.html → a 2500×1686 PNG for the LINE rich menu.
// Usage: node tools/rich-menu/shoot.mjs
import { chromium } from '@playwright/test';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, 'menu.png');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 2500, height: 1686 },
  deviceScaleFactor: 1,
});
await page.goto(`file://${path.join(dir, 'menu.html')}`, { waitUntil: 'networkidle' });
// Make sure every web font actually finished loading before we shoot.
await page.evaluate(async () => {
  await document.fonts.ready;
});
await page.waitForTimeout(300);

await page.locator('#menu').screenshot({ path: out });
await browser.close();

const { width, height } = { width: 2500, height: 1686 };
const kb = (statSync(out).size / 1024).toFixed(0);
console.log(`✓ wrote ${out}`);
console.log(`  ${width}×${height}px · ${kb} KB · ${kb <= 1024 ? 'under' : 'OVER'} LINE's 1 MB limit`);
