// Usage: node scripts/lint.mjs <file.html>
// Deterministic checks for a generated page: token discipline, standalone-ness, pinned CDN code,
// accessibility basics, reduced-motion support, and stock "AI slop" copy. Exits 1 on errors;
// warnings are reported but do not fail.
import { readFileSync } from 'node:fs';
import { fail } from './lib.mjs';

const file = process.argv[2];
if (!file) fail('usage: lint.mjs <file.html>');
let html;
try {
  html = readFileSync(file, 'utf8');
} catch (e) {
  fail(`cannot read ${file}: ${e.message}`);
}

const errors = [];
const warnings = [];
const lineOf = (index) => html.slice(0, index).split('\n').length;

const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const CODE_HOSTS = new Set(['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com']);
const SLOP = [
  'elevate', 'unlock', 'seamless', 'revolutioni', 'game-changer', 'cutting-edge', 'next-level', 'empower',
  'solusi terbaik', 'solusi terpercaya', 'wujudkan', 'lebih dari sekadar', 'di era digital', 'kami hadir',
  'mitra terpercaya', 'pengalaman tak terlupakan', 'kualitas terbaik', 'terdepan', 'one-stop',
];

// Page basics.
if (!/<html[^>]*\slang="[a-z-]+"/i.test(html)) errors.push('<html> needs a lang attribute');
if (/lorem ipsum/i.test(html)) errors.push('placeholder "lorem ipsum" text found');
for (const m of html.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/gi)) errors.push(`line ${lineOf(m.index)}: <img> without alt`);

// Colors must come from the tokens: no raw colors outside :root in CSS, inline styles, or SVG paint.
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
const cssOutsideRoot = css.replace(/:root\b[^{]*\{[^}]*\}/g, '');
const RAW_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i;
for (const m of cssOutsideRoot.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/gim)) {
  if (!m[1].startsWith('--') && RAW_COLOR.test(m[2])) errors.push(`CSS "${m[1]}: ${m[2].trim().slice(0, 60)}" uses a raw color; use a token variable`);
}
for (const m of html.matchAll(/\sstyle="([^"]*)"/gi)) {
  if (RAW_COLOR.test(m[1])) errors.push(`line ${lineOf(m.index)}: inline style uses a raw color; use a token variable`);
}
for (const m of html.matchAll(/\s(fill|stroke|stop-color|color)="(#[0-9a-f]{3,8}|rgba?\([^"]*)"/gi)) {
  errors.push(`line ${lineOf(m.index)}: SVG ${m[1]}="${m[2]}" uses a raw color; use var(--…) or currentColor`);
}

// Standalone: no external images; code only from known CDNs at exact versions.
const urls = [
  ...[...html.matchAll(/\ssrc="(https?:\/\/[^"]+)"/gi)].map((m) => [m[1], m.index, /<img|<source|<video/i.test(html.slice(Math.max(0, m.index - 80), m.index)) ? 'media' : 'code']),
  ...[...html.matchAll(/<link\b[^>]*\shref="(https?:\/\/[^"]+)"/gi)].map((m) => [m[1], m.index, 'link']),
  ...[...html.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)/gi)].map((m) => [m[1], m.index, 'media']),
  ...[...html.matchAll(/(?:from\s*|import\s*\(\s*|:\s*)["'](https?:\/\/[^"']+)["']/gi)].map((m) => [m[1], m.index, 'code']),
];
for (const [url, index, kind] of urls) {
  const host = new URL(url).hostname;
  const where = `line ${lineOf(index)}: ${url}`;
  if (FONT_HOSTS.has(host)) continue;
  if (kind === 'media') errors.push(`${where} — external image/media; draw it (SVG/CSS/canvas) instead`);
  else if (!CODE_HOSTS.has(host)) errors.push(`${where} — code may only load from ${[...CODE_HOSTS].join(', ')}`);
  else if (!/[@/]\d+\.\d+\.\d+/.test(url)) errors.push(`${where} — pin an exact version (e.g. three@0.170.0)`);
}

// Motion must respect users who ask for less of it.
const animates = /@keyframes|animation(?:-name)?\s*:|transition\s*:|animation-timeline|requestAnimationFrame|\.animate\(|gsap\.|THREE\./i.test(html);
if (animates && !/prefers-reduced-motion/i.test(html)) errors.push('page animates but never checks prefers-reduced-motion');

// Generic copy.
const text = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/gi, ' ').toLowerCase();
for (const phrase of SLOP) if (text.includes(phrase)) warnings.push(`stock phrase "${phrase}" — write something specific to this client`);

for (const e of errors) console.log(`error   ${e}`);
for (const w of warnings) console.log(`warning ${w}`);
if (errors.length) {
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`Lint passed${warnings.length ? ` with ${warnings.length} warning(s)` : ''}.`);
