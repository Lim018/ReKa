// Local UI for the design generator. Runs Claude Code headless (`claude -p`) with the user's own
// Claude login, so it is for personal use on this machine only: it binds to 127.0.0.1 and rejects
// requests from other hosts/origins.
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { join, resolve, extname, basename, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(ROOT, 'output');
const USAGE_FILE = join(OUTPUT, '.usage.json');
const PORT = Number(process.env.PORT) || 4000;
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const OUTPUTS = ['png', 'html', 'design.md'];
// Model aliases available on the subscription ('' = Claude Code's own default). Fable needs usage credits.
const MODELS = { opus: 'Opus 5.5', sonnet: 'Sonnet 5.5', haiku: 'Haiku 5.5' };
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CAVEMAN_RECEIPTS = join(homedir(), '.caveman', 'receipts');
const UPLOAD_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.html', '.htm']);
const MAX_BODY = 20 * 1024 * 1024;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
};

mkdirSync(OUTPUT, { recursive: true });

// In-memory state for jobs started by this server process; job.json in each folder is the durable record.
const live = new Map(); // id -> { proc, log: [], listeners: Set<res> }

const metaPath = (id) => join(OUTPUT, id, 'job.json');
const readMeta = (id) => {
  try {
    return JSON.parse(readFileSync(metaPath(id), 'utf8'));
  } catch {
    return null;
  }
};
const writeMeta = (id, meta) => writeFileSync(metaPath(id), JSON.stringify(meta, null, 2));
// Every progress line of every run in a project, so the history survives server restarts.
const logPath = (id) => join(OUTPUT, id, 'log.jsonl');
const INTERNAL_FILES = new Set(['job.json', 'log.jsonl', 'suggestions.json']);

// A job left "running" by a previous server process can never finish.
for (const id of readdirSync(OUTPUT)) {
  const meta = readMeta(id);
  if (meta?.status === 'running') writeMeta(id, { ...meta, status: 'interrupted' });
}

// Latest plan-usage snapshot reported by Claude Code (rate_limit_event), kept across restarts.
function saveUsage(info) {
  if (info?.unifiedWindows) writeFileSync(USAGE_FILE, JSON.stringify({ ...info, checkedAt: new Date().toISOString() }, null, 2));
}
function readUsage() {
  try {
    return JSON.parse(readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// Caveman (token-compression layer) is installed per user: hooks in ~/.claude/settings.json and an
// MCP server in ~/.claude.json. Its MCP config is read from there rather than stored in this repo.
function cavemanMcpConfig() {
  try {
    return JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')).mcpServers?.caveman ?? null;
  } catch {
    return null;
  }
}

// Caveman's own per-session receipt (events it handled, compression it measured), if it wrote one.
function cavemanReceipt(sessionId) {
  if (!sessionId || !existsSync(CAVEMAN_RECEIPTS)) return null;
  for (const name of readdirSync(CAVEMAN_RECEIPTS)) {
    if (!name.startsWith('session-')) continue;
    try {
      const r = JSON.parse(readFileSync(join(CAVEMAN_RECEIPTS, name), 'utf8'));
      if (r.host_session_id !== sessionId) continue;
      const usage = r.provider_usage ?? {};
      return {
        generatedAt: r.generated_at,
        events: r.execution?.native_events?.value ?? 0,
        mode: r.policy?.mode ?? null,
        requests: usage.requests ?? 0,
        tokensBefore: usage.compression_tokens_before ?? 0,
        tokensAfter: usage.compression_tokens_after ?? 0,
        claim: r.claim_status?.compression_reduction ?? null,
      };
    } catch {}
  }
  return null;
}

// Optional model/effort/caveman chosen in the UI; empty model/effort means Claude Code's default.
function pickRunOptions(body) {
  const model = String(body.model ?? '');
  const effort = String(body.effort ?? '');
  if (model && !MODELS[model]) throw new HttpError(400, 'Model tidak dikenal');
  if (effort && !EFFORTS.includes(effort)) throw new HttpError(400, 'Effort tidak dikenal');
  return { model: model || null, effort: effort || null, caveman: body.caveman === true && Boolean(cavemanMcpConfig()) };
}
const runLabel = (text, { model, effort, caveman }) =>
  [text, model ? MODELS[model] : null, effort ? `effort ${effort}` : null, caveman ? 'caveman' : 'tanpa caveman'].filter(Boolean).join(' · ');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function slugify(text) {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'desain';
}

function newJobId(label) {
  const d = new Date();
  const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate(), '-', d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => (typeof n === 'number' ? String(n).padStart(2, '0') : n)).join('');
  return `${stamp}-${slugify(label)}`;
}

// Resolve a path inside a base folder, refusing anything that escapes it.
function inside(base, rel) {
  const full = resolve(base, rel);
  if (full !== base && !full.startsWith(base + sep)) throw new HttpError(403, 'Path di luar folder output');
  return full;
}

function listFiles(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.')) return [];
    const rel = prefix + e.name;
    return e.isDirectory() ? listFiles(join(dir, e.name), rel + '/') : [rel];
  });
}

// Follow-up ideas Claude writes for the UI's one-click buttons (skill section 8).
function readSuggestions(id) {
  try {
    const list = JSON.parse(readFileSync(join(OUTPUT, id, 'suggestions.json'), 'utf8'));
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 120)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function jobSummary(id) {
  const dir = join(OUTPUT, id);
  const meta = readMeta(id) ?? { id, title: id, status: 'done', createdAt: statSync(dir).mtime.toISOString() };
  const sessionCommand = meta.sessionId ? `cd '${ROOT}' && claude --resume ${meta.sessionId}` : null;
  return { ...meta, sessionCommand, suggestions: readSuggestions(id), caveman: meta.caveman ?? null, cavemanReceipt: cavemanReceipt(meta.sessionId), files: listFiles(dir).filter((f) => !INTERNAL_FILES.has(f)) };
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new HttpError(413, 'Ukuran request maksimal 20MB'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        fail(new HttpError(400, 'Body harus JSON'));
      }
    });
    req.on('error', fail);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(data));
}

// ---- Claude Code runner ----------------------------------------------------------------------

function describeTool(name, input = {}) {
  const rel = (p) => (p ? String(p).replace(ROOT + sep, '') : '');
  switch (name) {
    case 'Bash': return input.command;
    case 'Read': case 'Write': case 'Edit': return rel(input.file_path);
    case 'Glob': case 'Grep': return input.pattern;
    case 'Skill': return input.skill ?? input.name ?? '';
    default: return '';
  }
}

function pushLog(id, entry) {
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() });
  appendFileSync(logPath(id), line + '\n');
  for (const res of live.get(id)?.listeners ?? []) res.write(`data: ${line}\n\n`);
}

// Each project is one real Claude Code session: the first run creates it with a fixed ID and later
// runs resume it, so Claude keeps the whole conversation. The same session opens in a terminal with
// `claude --resume <sessionId>` from the project root.
// extractTarget: the only argument `scripts/extract.mjs` may be called with (null = extract not allowed).
// Keeping Bash to these exact script invocations limits what instructions injected by a redesigned
// page could make Claude do.
// caveman: on = its hooks plus its MCP server (the only MCP loaded); off = all hooks disabled for this
// run (the caveman hooks live with the user's other hooks, which cannot be removed one by one).
function runClaude(id, prompt, { label, sessionId, resume, sessionName, model = null, effort = null, caveman = false, extractTarget = null, extraDir = null }) {
  const allowed = [
    'Read', 'Glob', 'Grep', 'Skill', 'Write(./output/**)', 'Edit(./output/**)',
    'Bash(node scripts/validate.mjs:*)', 'Bash(node scripts/lint.mjs:*)', 'Bash(node scripts/render.mjs:*)',
  ];
  if (extractTarget) allowed.push(`Bash(node scripts/extract.mjs ${extractTarget}:*)`);
  const cavemanMcp = caveman ? cavemanMcpConfig() : null;
  if (cavemanMcp) allowed.push('mcp__caveman');
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json', '--verbose',
    '--strict-mcp-config',
    ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId, '--name', sessionName]),
    '--permission-mode', 'dontAsk',
    '--tools', 'Bash,Read,Write,Edit,Glob,Grep,Skill',
    '--allowedTools', ...allowed,
  ];
  if (extraDir) args.push('--add-dir', extraDir);
  if (cavemanMcp) {
    args.push('--mcp-config', JSON.stringify({ mcpServers: { caveman: cavemanMcp } }));
  } else {
    args.push('--settings', JSON.stringify({ disableAllHooks: true }));
  }
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);

  const proc = spawn('claude', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  live.set(id, { proc, listeners: new Set() });
  pushLog(id, { kind: 'run', text: label });

  let buffer = '';
  let result = null;
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === 'assistant') {
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'text' && block.text.trim()) pushLog(id, { kind: 'text', text: block.text.trim() });
          if (block.type === 'tool_use') pushLog(id, { kind: 'tool', tool: block.name, text: describeTool(block.name, block.input) });
        }
      } else if (ev.type === 'user') {
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'tool_result' && block.is_error) {
            const text = Array.isArray(block.content) ? block.content.map((c) => c.text ?? '').join(' ') : String(block.content ?? '');
            pushLog(id, { kind: 'warn', text: text.slice(0, 400) });
          }
        }
      } else if (ev.type === 'rate_limit_event') {
        saveUsage(ev.rate_limit_info);
      } else if (ev.type === 'result') {
        result = ev;
      }
    }
  });
  let stderr = '';
  proc.stderr.on('data', (c) => (stderr = (stderr + c).slice(-2000)));

  const timer = setTimeout(() => stopJob(id, 'timeout'), JOB_TIMEOUT_MS);
  proc.on('error', (err) => pushLog(id, { kind: 'error', text: `Gagal menjalankan claude: ${err.message}` }));
  proc.on('close', (code, signal) => {
    clearTimeout(timer);
    const job = live.get(id);
    const ok = code === 0 && result && !result.is_error;
    const status = ok ? 'done' : job.stopReason === 'cancel' ? 'cancelled' : 'failed';
    const meta = readMeta(id) ?? {};
    const error = ok ? null
      : job.stopReason === 'timeout' ? `Dihentikan setelah ${JOB_TIMEOUT_MS / 60000} menit`
      : (result?.result || stderr.trim() || `claude keluar dengan kode ${code ?? signal}`);
    writeMeta(id, { ...meta, status, finishedAt: new Date().toISOString(), summary: ok ? result.result : meta.summary, error });
    if (ok) pushLog(id, { kind: 'result', text: result.result });
    else pushLog(id, { kind: 'error', text: status === 'cancelled' ? 'Dibatalkan.' : error });
    for (const res of job.listeners) {
      res.write(`event: end\ndata: ${JSON.stringify({ status })}\n\n`);
      res.end();
    }
    job.listeners.clear();
    job.proc = null;
  });
}

const isRunning = () => [...live.values()].some((j) => j.proc);

function stopJob(id, reason) {
  const job = live.get(id);
  if (!job?.proc) return;
  job.stopReason = reason;
  job.proc.kill('SIGTERM');
}

// ---- Account & usage ------------------------------------------------------------------------

function accountInfo() {
  return new Promise((ok) => {
    execFile('claude', ['auth', 'status', '--json'], { cwd: ROOT, timeout: 15000 }, (err, stdout) => {
      try {
        const a = JSON.parse(stdout);
        ok({ loggedIn: a.loggedIn, authMethod: a.authMethod, email: a.email ?? null, orgName: a.orgName ?? null, plan: a.subscriptionType ?? null });
      } catch {
        ok({ loggedIn: false, error: err?.message || 'Tidak bisa membaca status login Claude Code' });
      }
    });
  });
}

// Claude Code has no standalone usage command; a minimal prompt with no tools returns the current
// rate-limit snapshot. It costs a tiny amount of the plan's quota.
function checkUsage() {
  return new Promise((ok, fail) => {
    const proc = spawn('claude', ['-p', 'Reply with: ok', '--output-format', 'stream-json', '--verbose', '--tools', '',
      '--strict-mcp-config', '--no-session-persistence'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', (c) => (out += c));
    const timer = setTimeout(() => proc.kill('SIGTERM'), 60000);
    proc.on('error', (e) => fail(new HttpError(500, `Gagal menjalankan claude: ${e.message}`)));
    proc.on('close', () => {
      clearTimeout(timer);
      for (const line of out.split('\n')) {
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'rate_limit_event') saveUsage(ev.rate_limit_info);
        } catch {}
      }
      ok(readUsage());
    });
  });
}

// ---- Request handlers ------------------------------------------------------------------------

async function createJob(req, res) {
  if (isRunning()) throw new HttpError(409, 'Masih ada proses generate yang berjalan');
  const body = await readBody(req);
  const mode = body.mode === 'redesign' ? 'redesign' : body.mode === 'design' ? 'design' : null;
  if (!mode) throw new HttpError(400, 'Mode harus design atau redesign');
  const brief = String(body.brief ?? '').trim().slice(0, 4000);
  const outputs = OUTPUTS.filter((o) => (body.outputs ?? []).includes(o));
  if (!outputs.length) throw new HttpError(400, 'Pilih minimal satu output');
  const runOptions = pickRunOptions(body);

  let source = String(body.source ?? '').trim();
  let sourceKind = null;
  let extraDir = null;
  if (source) {
    if (/^https?:\/\//i.test(source)) {
      try {
        source = new URL(source).href;
      } catch {
        throw new HttpError(400, 'URL tidak valid');
      }
      sourceKind = 'url';
    } else {
      source = resolve(source.replace(/^~(?=\/)/, process.env.HOME));
      if (!existsSync(source)) throw new HttpError(400, `Path tidak ditemukan: ${source}`);
      sourceKind = statSync(source).isDirectory() ? 'folder' : 'file';
      extraDir = sourceKind === 'folder' ? source : dirname(source);
    }
    if (/\s/.test(source)) throw new HttpError(400, 'URL/path sumber tidak boleh mengandung spasi');
  }
  if (mode === 'design' && !brief) throw new HttpError(400, 'Isi brief desain');
  if (mode === 'redesign' && !source && !body.file) throw new HttpError(400, 'Redesign butuh URL, path lokal, atau file upload');
  const uploadName = body.file ? basename(String(body.file.name ?? '')).replace(/[^\w.-]+/g, '_') : null;
  if (uploadName && !UPLOAD_EXT.has(extname(uploadName).toLowerCase())) throw new HttpError(400, 'File harus png, jpg, webp, atau html');

  const label = brief || (sourceKind === 'url' ? new URL(source).hostname : basename(source || uploadName || 'redesign'));
  const id = newJobId(label);
  const dir = join(OUTPUT, id);
  mkdirSync(dir, { recursive: true });

  let uploaded = null;
  if (uploadName) {
    const name = uploadName;
    mkdirSync(join(dir, 'input'), { recursive: true });
    uploaded = `output/${id}/input/${name}`;
    writeFileSync(join(ROOT, uploaded), Buffer.from(String(body.file.data ?? ''), 'base64'));
  }

  // The extract script may only be pointed at the source the user gave (URL, local HTML, or uploaded HTML).
  const htmlUpload = uploaded && /\.html?$/i.test(uploaded) ? uploaded : null;
  const extractTarget = mode !== 'redesign' ? null
    : sourceKind === 'url' || (sourceKind === 'file' && /\.html?$/i.test(source)) ? source
    : htmlUpload;

  const lines = [
    `/design-generator`,
    `Mode: ${mode}.`,
    sourceKind && `Sumber (${sourceKind}): ${source}`,
    uploaded && `File upload dari user: ${uploaded}`,
    brief && `Brief: ${brief}`,
    `Output yang diminta: ${outputs.join(', ')}.`,
    `Simpan semua hasil di folder output/${id}/ (folder sudah ada, jangan buat folder output lain).`,
    extractTarget && `Untuk ekstraksi jalankan persis: node scripts/extract.mjs ${extractTarget} output/${id}/source`,
    `Jalankan semua tahap skill, termasuk arah kreatif (bagian 3), kritik diri dengan rubrik (bagian 7), dan suggestions.json (bagian 8).`,
    `Jangan bertanya ke user; ambil asumsi dan catat di design.md.`,
  ];
  const title = brief.length > 80 ? brief.slice(0, 80).replace(/\s+\S*$/, '') + '…' : brief || label;
  const meta = {
    id, title, mode, brief, source: source || null, upload: uploaded, outputs,
    sessionId: randomUUID(), extractTarget, extraDir, ...runOptions,
    status: 'running', createdAt: new Date().toISOString(), revisions: [],
  };
  writeMeta(id, meta);
  runClaude(id, lines.filter(Boolean).join('\n'), {
    label: runLabel('Generate awal', runOptions), sessionId: meta.sessionId, resume: false, sessionName: `ReKa: ${title}`,
    ...runOptions, extractTarget, extraDir,
  });
  sendJson(res, 201, { id });
}

async function reviseJob(req, res, id) {
  if (isRunning()) throw new HttpError(409, 'Masih ada proses generate yang berjalan');
  const meta = readMeta(id);
  if (!meta) throw new HttpError(404, 'Hasil tidak ditemukan');
  const body = await readBody(req);
  const text = String(body.instruction ?? '').trim().slice(0, 4000);
  if (!text) throw new HttpError(400, 'Isi pesan terlebih dahulu');
  const runOptions = pickRunOptions(body);

  // Projects made before sessions existed get a fresh session that starts from the files on disk.
  const resume = Boolean(meta.sessionId);
  const sessionId = meta.sessionId ?? randomUUID();
  writeMeta(id, {
    ...meta, sessionId, status: 'running',
    revisions: [...(meta.revisions ?? []), { at: new Date().toISOString(), instruction: text, ...runOptions }],
  });
  const outputs = (meta.outputs ?? OUTPUTS).join(', ');
  const prompt = resume
    ? [
        `Pesan dari user: ${text}`,
        ``,
        `Jika ini permintaan perubahan, terapkan pada output/${id}/ dengan alur penyesuaian skill design-generator`,
        `(tokens.json → validate → design.md → index.html → lint → render ulang → lihat PNG → perbarui suggestions.json), output: ${outputs}.`,
        `"Coba arah B/C" berarti membangun ulang dengan arah itu dari bagian Arah kreatif di design.md.`,
        `Jika ini pertanyaan, jawab saja tanpa mengubah file. Jangan bertanya balik ke user.`,
      ].join('\n')
    : [
        `/design-generator`,
        `Revisi desain yang sudah ada di folder output/${id}/ (baca tokens.json, design.md, dan index.html di sana terlebih dahulu).`,
        `Permintaan revisi: ${text}`,
        `Ikuti alur penyesuaian di bagian 9 supaya semua output tetap sinkron, termasuk lint dan suggestions.json. Output yang diminta: ${outputs}.`,
        `Jangan bertanya ke user.`,
      ].join('\n');
  runClaude(id, prompt, {
    label: runLabel(`Pesan: ${text}`, runOptions), sessionId, resume, sessionName: `ReKa: ${meta.title ?? id}`, ...runOptions,
    extractTarget: meta.extractTarget ?? null, extraDir: meta.extraDir ?? null,
  });
  sendJson(res, 202, { id });
}

function streamEvents(req, res, id) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const job = live.get(id);
  const history = existsSync(logPath(id)) ? readFileSync(logPath(id), 'utf8').split('\n').filter(Boolean) : [];
  for (const line of history) res.write(`data: ${line}\n\n`);
  if (job?.proc) {
    job.listeners.add(res);
    req.on('close', () => job.listeners.delete(res));
  } else {
    res.write(`event: end\ndata: ${JSON.stringify({ status: readMeta(id)?.status ?? 'done' })}\n\n`);
    res.end();
  }
}

function serveFile(res, file, headers = {}) {
  if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, 'File tidak ditemukan');
  res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', ...headers });
  createReadStream(file).pipe(res);
}

async function handle(req, res) {
  // Only this machine's browser may talk to the server (blocks DNS rebinding and cross-site POSTs).
  if (!ALLOWED_HOSTS.has(req.headers.host)) throw new HttpError(403, 'Host tidak diizinkan');
  if (req.method !== 'GET' && req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Origin tidak diizinkan');

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = decodeURIComponent(url.pathname);
  const m = path.match(/^\/api\/jobs\/([\w-]+)(?:\/(events|revise|cancel))?$/);

  if (req.method === 'GET' && path === '/') return serveFile(res, join(ROOT, 'ui', 'index.html'));
  if (req.method === 'GET' && path === '/api/jobs') {
    const jobs = readdirSync(OUTPUT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => jobSummary(e.name))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return sendJson(res, 200, { running: isRunning(), jobs });
  }
  if (req.method === 'POST' && path === '/api/jobs') return createJob(req, res);
  if (req.method === 'GET' && path === '/api/account') {
    return sendJson(res, 200, { account: await accountInfo(), usage: readUsage(), cavemanInstalled: Boolean(cavemanMcpConfig()) });
  }
  if (req.method === 'POST' && path === '/api/usage') return sendJson(res, 200, { usage: await checkUsage() });
  if (m && existsSync(join(OUTPUT, m[1]))) {
    const [, id, action] = m;
    if (req.method === 'GET' && !action) return sendJson(res, 200, jobSummary(id));
    if (req.method === 'GET' && action === 'events') return streamEvents(req, res, id);
    if (req.method === 'POST' && action === 'revise') return reviseJob(req, res, id);
    if (req.method === 'POST' && action === 'cancel') {
      stopJob(id, 'cancel');
      return sendJson(res, 202, { id });
    }
  }
  if (req.method === 'GET' && path.startsWith('/output/')) {
    // Generated pages run sandboxed (opaque origin), so their scripts cannot call this API.
    return serveFile(res, inside(OUTPUT, path.slice('/output/'.length)), {
      'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups',
      'Cache-Control': 'no-store',
    });
  }
  throw new HttpError(404, 'Tidak ditemukan');
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.message });
    else res.end();
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Design Generator UI: http://localhost:${PORT}`);
});
