// Usage: node scripts/validate.mjs <tokens.json>
// Checks the design tokens before any HTML is written. Exits 1 with a list of problems.
import { readFileSync } from 'node:fs';
import { fail, contrastRatio } from './lib.mjs';

const file = process.argv[2];
if (!file) fail('usage: validate.mjs <tokens.json>');

let tokens;
try {
  tokens = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  fail(`cannot read ${file}: ${e.message}`);
}

const errors = [];
const HEX = /^#[0-9a-fA-F]{6}$/;
const REQUIRED_COLORS = ['background', 'surface', 'text', 'textMuted', 'primary', 'onPrimary', 'border'];
// [foreground, background, minimum ratio]. 4.5 = WCAG AA body text, 3 = AA large text / UI.
const DEFAULT_PAIRS = [
  ['text', 'background', 4.5],
  ['text', 'surface', 4.5],
  ['textMuted', 'background', 4.5],
  ['textMuted', 'surface', 4.5],
  ['onPrimary', 'primary', 4.5],
  ['primary', 'background', 3],
];

const colors = tokens.colors ?? {};
for (const key of REQUIRED_COLORS) {
  if (!(key in colors)) errors.push(`colors.${key} is missing`);
}
for (const [key, value] of Object.entries(colors)) {
  if (typeof value !== 'string' || !HEX.test(value)) errors.push(`colors.${key} must be #rrggbb, got ${JSON.stringify(value)}`);
}

const pairs = [...DEFAULT_PAIRS, ...(tokens.contrastPairs ?? [])];
const report = [];
for (const [fg, bg, min = 4.5] of pairs) {
  if (!HEX.test(colors[fg] ?? '') || !HEX.test(colors[bg] ?? '')) continue;
  const ratio = contrastRatio(colors[fg], colors[bg]);
  const ok = ratio >= min;
  report.push(`${ok ? 'ok  ' : 'FAIL'} ${fg} on ${bg}: ${ratio.toFixed(2)} (min ${min})`);
  if (!ok) errors.push(`contrast ${fg} on ${bg} is ${ratio.toFixed(2)}, needs >= ${min}`);
}

const fonts = tokens.typography?.fontFamily ?? {};
for (const key of ['heading', 'body']) {
  if (typeof fonts[key] !== 'string' || !fonts[key].trim()) errors.push(`typography.fontFamily.${key} is missing`);
}

const ascending = (label, values, min) => {
  if (!Array.isArray(values) || values.length === 0) return errors.push(`${label} must be a non-empty array of numbers`);
  if (values.some((v) => typeof v !== 'number' || v < min)) return errors.push(`${label} must contain numbers >= ${min}`);
  if (values.some((v, i) => i > 0 && v <= values[i - 1])) errors.push(`${label} must be strictly ascending`);
};
const scale = tokens.typography?.scale;
ascending('typography.scale', scale && Object.values(scale), 10);
ascending('spacing', tokens.spacing, 0);

console.log(report.join('\n'));
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('\nTokens valid.');
