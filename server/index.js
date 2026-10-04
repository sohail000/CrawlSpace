// Local server: serves the UI, starts runs, and streams every spider event over SSE.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch {}

const { Run } = await import('./crawler.js');
const { normalizeUrl } = await import('./extract.js');
const { aiEnabled, PROVIDER, READER_MODEL, WEAVER_MODEL } = await import('./brain.js');

const PORT = Number(process.env.PORT) || 4321;
const PUBLIC = path.join(root, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

let run = null;
let events = [];   // full log of the current run, replayed to late subscribers
let seq = 0;
const clients = new Set();

function emit(type, data = {}) {
  const ev = { seq: ++seq, t: Date.now(), type, ...data };
  events.push(ev);
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(line);
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 20_000) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
}

const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);

async function startRun(req, res) {
  let b;
  try { b = await body(req); } catch { return json(res, 400, { error: 'bad JSON' }); }
  const question = String(b.question || '').trim().slice(0, 400);
  if (!question) return json(res, 400, { error: 'Ask the spiders a question first.' });
  const seeds = String(b.seeds || '').split(/[\s,]+/).filter(Boolean)
    .map((s) => normalizeUrl(/^https?:\/\//i.test(s) ? s : 'https://' + s)).filter(Boolean).slice(0, 5);

  if (run) run.kill();
  events = [];
  run = new Run({
    question,
    seeds,
    budget: clamp(b.budget, 1, 200, 20),
    spiders: clamp(b.spiders, 1, 6, 3),
    brain: b.brain === 'keywords' ? 'keywords' : 'model',
    maxDepth: clamp(b.depth, 0, 5, 2),
    pace: clamp(process.env.CRAWL_PACE_MS, 0, 20000, 1200),
    hostGap: clamp(process.env.CRAWL_HOST_GAP_MS, 250, 30000, 1500),
  }, emit);
  const mine = run;
  mine.start().catch((e) => { if (!mine.killed) emit('error', { message: e.message }); });
  json(res, 200, { id: mine.id });
}

function sse(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify({ type: 'hello', ai: aiEnabled(), provider: PROVIDER, readerModel: READER_MODEL, weaverModel: WEAVER_MODEL })}\n\n`);
  for (const ev of events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (req.method === 'GET' && p === '/api/events') return sse(req, res);
  if (req.method === 'POST' && p === '/api/run') return startRun(req, res);
  if (req.method === 'POST' && p === '/api/stop') { run?.stop(); return json(res, 200, { ok: true }); }
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end();
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  CRAWLSPACE is up -> http://localhost:${PORT}`);
  console.log(aiEnabled() ? `  ${PROVIDER} mode (reader ${READER_MODEL}, weaver ${WEAVER_MODEL})` : '  Heuristic mode: add GEMINI_API_KEY or ANTHROPIC_API_KEY to .env for model-powered spiders');
  console.log('');
});
