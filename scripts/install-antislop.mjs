// Usage: node scripts/install-antislop.mjs <path-to-anti-slop-clone>
// Vendors the antislop skills (https://github.com/miqdadbadjuber/anti-slop, MIT) into this repo:
// .claude/skills/antislop*/ for Claude Code and links in .agents/skills/ for Antigravity.
// Each SKILL.md loses its `allowed-tools` line: those grant unscoped Write/Edit and `Bash(python *)`
// while the skill is active, which would bypass the narrow permissions ReKa's headless runs depend on.
// Run it again on a fresh clone to update.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fail } from './lib.mjs';

const src = process.argv[2] && resolve(process.argv[2]);
if (!src || !existsSync(join(src, 'skills', 'antislop', 'SKILL.md'))) fail('usage: install-antislop.mjs <path-to-anti-slop-clone>');

const root = resolve(import.meta.dirname, '..');
const claudeSkills = join(root, '.claude', 'skills');
const agentSkills = join(root, '.agents', 'skills');
mkdirSync(agentSkills, { recursive: true });

const names = readdirSync(join(src, 'skills')).filter((n) => n.startsWith('antislop') && existsSync(join(src, 'skills', n, 'SKILL.md')));
for (const name of names) {
  const dest = join(claudeSkills, name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(src, 'skills', name), dest, { recursive: true });
  const skill = join(dest, 'SKILL.md');
  const text = readFileSync(skill, 'utf8');
  const stripped = text.replace(/^allowed-tools:.*\n/m, '');
  if (/^allowed-tools:/m.test(stripped)) fail(`${name}: more than one allowed-tools line, check it by hand`);
  writeFileSync(skill, stripped);

  const link = join(agentSkills, name);
  rmSync(link, { force: true });
  symlinkSync(join('..', '..', '.claude', 'skills', name), link);
  console.log(`installed ${name}${text === stripped ? '' : ' (allowed-tools removed)'}`);
}
cpSync(join(src, 'LICENSE'), join(claudeSkills, 'antislop', 'LICENSE'));
const version = existsSync(join(src, 'skills', 'antislop', 'VERSION')) ? readFileSync(join(src, 'skills', 'antislop', 'VERSION'), 'utf8').trim() : 'unknown';
console.log(`antislop ${version}: ${names.length} skills`);
