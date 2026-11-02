// Usage: node scripts/render.mjs <file.html> <out.png> [--width 1440] [--viewport-only] [--wait 800]
// Renders a standalone HTML file to PNG with headless Chromium (full page by default).
// Pages may animate: it scrolls through once so scroll/IntersectionObserver reveals fire, waits for
// finite animations to finish, then gives canvas/WebGL scenes --wait ms to draw. JavaScript errors are
// reported so a broken page is never mistaken for a finished one.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { toUrl, fail } from './lib.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const [input, output] = args.filter((a, i) => !a.startsWith('--') && !['--width', '--wait'].includes(args[i - 1]));
const width = option('--width', 1440);
const settle = option('--wait', 800);
const fullPage = !args.includes('--viewport-only');

if (!input || !output) fail('usage: render.mjs <file.html> <out.png> [--width 1440] [--viewport-only] [--wait 800]');
if (!Number.isInteger(width) || width < 200) fail('--width must be an integer >= 200');
if (!Number.isFinite(settle) || settle < 0) fail('--wait must be a number of milliseconds');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => errors.push(`failed to load ${r.url()} (${r.failure()?.errorText})`));

  await page.goto(toUrl(input), { waitUntil: 'networkidle', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);

  if (fullPage) {
    // Step through the page so reveal-on-scroll content is shown, then return to the top.
    await page.evaluate(async () => {
      const step = Math.max(200, Math.floor(innerHeight * 0.6));
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      scrollTo(0, 0);
    });
  }

  // Wait (max 4s) for animations that end; infinite loops are left running.
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime));
    await Promise.race([Promise.allSettled(finite.map((a) => a.finished)), new Promise((r) => setTimeout(r, 4000))]);
  });
  await page.waitForTimeout(settle);

  mkdirSync(dirname(output), { recursive: true });
  await page.screenshot({ path: output, fullPage, animations: 'allow' });
  console.log(`Rendered ${output} (${width}px wide${fullPage ? ', full page' : ''})`);
  if (errors.length) {
    console.log(`WARNING: ${errors.length} JavaScript/loading error(s) — fix before finishing:`);
    for (const e of [...new Set(errors)].slice(0, 15)) console.log(`  - ${e}`);
  }
} finally {
  await browser.close();
}
