// Usage: node scripts/extract.mjs <url | file.html> <out-dir>
// Captures the existing system for a redesign: original.png (full page) and styles.json
// (most-used colors, fonts, type sizes, spacing, radii, plus page structure and text outline).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toUrl, fail, rgbToHex } from './lib.mjs';

const [target, outDir] = process.argv.slice(2);
if (!target || !outDir) fail('usage: extract.mjs <url | file.html> <out-dir>');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(toUrl(target), { waitUntil: 'networkidle', timeout: 45000 });
  await page.evaluate(() => document.fonts.ready);

  const raw = await page.evaluate(() => {
    const counts = { color: {}, background: {}, border: {}, font: {}, fontSize: {}, fontWeight: {}, spacing: {}, radius: {} };
    const bump = (bucket, key, weight = 1) => {
      if (key) counts[bucket][key] = (counts[bucket][key] || 0) + weight;
    };
    const px = (v) => (v && v !== '0px' && v.endsWith('px') ? Math.round(parseFloat(v)) : null);

    for (const el of document.body.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') continue;

      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasText) {
        bump('color', s.color);
        bump('font', s.fontFamily.split(',')[0].replace(/["']/g, '').trim());
        bump('fontSize', px(s.fontSize));
        bump('fontWeight', s.fontWeight);
      }
      // Weight backgrounds by area so large surfaces outrank small badges.
      bump('background', s.backgroundColor, Math.max(1, Math.round((rect.width * rect.height) / 10000)));
      if (s.borderTopStyle !== 'none' && px(s.borderTopWidth)) bump('border', s.borderTopColor);
      for (const prop of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap']) {
        bump('spacing', px(s[prop]));
      }
      bump('radius', px(s.borderTopLeftRadius));
    }

    const outline = [...document.querySelectorAll('h1, h2, h3, button, a[class], label, nav a')]
      .filter((el) => el.offsetParent !== null && el.textContent.trim())
      .slice(0, 80)
      .map((el) => `${el.tagName.toLowerCase()}: ${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 100)}`);

    const structure = Object.fromEntries(
      ['header', 'nav', 'main', 'section', 'footer', 'form', 'table', 'img', 'button', 'input'].map((tag) => [
        tag,
        document.querySelectorAll(tag).length,
      ]),
    );

    return {
      title: document.title,
      lang: document.documentElement.lang || null,
      pageHeight: document.documentElement.scrollHeight,
      structure,
      outline,
      counts,
    };
  });

  const top = (bucket, n, mapKey = (k) => k) => {
    const merged = {};
    for (const [k, v] of Object.entries(bucket)) {
      const key = mapKey(k);
      if (key !== null && key !== 'null') merged[key] = (merged[key] || 0) + v;
    }
    return Object.entries(merged)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value, count]) => ({ value: /^\d+$/.test(value) ? Number(value) : value, count }));
  };

  const styles = {
    source: target,
    title: raw.title,
    lang: raw.lang,
    pageHeight: raw.pageHeight,
    structure: raw.structure,
    colors: {
      text: top(raw.counts.color, 8, rgbToHex),
      background: top(raw.counts.background, 8, rgbToHex),
      border: top(raw.counts.border, 5, rgbToHex),
    },
    typography: {
      fonts: top(raw.counts.font, 5),
      sizes: top(raw.counts.fontSize, 10),
      weights: top(raw.counts.fontWeight, 5),
    },
    spacing: top(raw.counts.spacing, 12),
    radius: top(raw.counts.radius, 6),
    outline: raw.outline,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'styles.json'), JSON.stringify(styles, null, 2));
  await page.screenshot({ path: join(outDir, 'original.png'), fullPage: true });
  console.log(`Extracted ${join(outDir, 'styles.json')} and ${join(outDir, 'original.png')}`);
} finally {
  await browser.close();
}
