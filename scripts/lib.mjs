import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Accepts an http(s) URL or a local file path and returns something page.goto() understands.
export function toUrl(target) {
  if (/^https?:\/\//i.test(target) || target.startsWith('file://')) return target;
  const path = resolve(target);
  if (!existsSync(path)) throw new Error(`File not found: ${target}`);
  return pathToFileURL(path).href;
}

export function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// "rgb(1, 2, 3)" / "rgba(1, 2, 3, 0.5)" -> "#010203" (null for fully transparent or unparseable).
export function rgbToHex(value) {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parseFloat(a) === 0) return null;
  return '#' + [r, g, b].map((n) => Math.round(parseFloat(n)).toString(16).padStart(2, '0')).join('');
}

// WCAG 2.x contrast ratio between two #rrggbb colors.
export function contrastRatio(hexA, hexB) {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
