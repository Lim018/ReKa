// Usage: node scripts/render.mjs <file.html> <out.png> [--width 1440] [--viewport-only]
// Renders a standalone HTML file to PNG with headless Chromium (full page by default).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { toUrl, fail } from './lib.mjs';

const args = process.argv.slice(2);
const [input, output] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--width');
const widthIndex = args.indexOf('--width');
const width = widthIndex >= 0 ? Number(args[widthIndex + 1]) : 1440;
const fullPage = !args.includes('--viewport-only');

if (!input || !output) fail('usage: render.mjs <file.html> <out.png> [--width 1440] [--viewport-only]');
if (!Number.isInteger(width) || width < 200) fail('--width must be an integer >= 200');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(toUrl(input), { waitUntil: 'networkidle', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(dirname(output), { recursive: true });
  await page.screenshot({ path: output, fullPage });
  console.log(`Rendered ${output} (${width}px wide${fullPage ? ', full page' : ''})`);
} finally {
  await browser.close();
}
