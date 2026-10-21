// Crawlspace proxy: fetches public web pages for the Crawlspace site, because a web page in a browser
// is not allowed to read other websites itself. Kept deliberately narrow:
//   GET only · public http(s) addresses only · robots.txt respected · 5 MB cap · no cookies either way
//   · answers only pages served from ALLOWED_ORIGINS, so other sites can't borrow it.
//   ?url=<page>              -> the page's HTML (UTF-8), with X-Final-Url / X-Status / X-Fetch-Ms headers
//   ?url=<page>&mode=status  -> JSON { status, finalUrl, type } (used to check for broken links)

const UA = 'CrawlspaceBot/2.0 (+https://github.com/sohail000/CrawlSpace)';
const UA_TOKEN = 'crawlspacebot';
const MAX_BYTES = 5_000_000;
const DEFAULT_ORIGINS = 'https://sohail000.github.io,http://localhost,http://127.0.0.1,null';
const HTML_TYPES = /text\/html|application\/xhtml\+xml/i;

const robotsCache = new Map(); // origin -> { at, rules }
const hits = new Map();        // ip -> recent request times (best effort, per instance)

export default {
  async fetch(request, env = {}) {
    const origin = request.headers.get('Origin') || 'null';
    const allowed = String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim());
    const okOrigin = allowed.some((a) => origin === a || (a.startsWith('http://') && origin.startsWith(a + ':')));
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : allowed[0],
      'Access-Control-Expose-Headers': 'X-Final-Url, X-Status, X-Fetch-Ms',
      Vary: 'Origin',
    };
    const fail = (status, error, message) => json({ error, message }, status, cors);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    if (request.method !== 'GET') return fail(405, 'method', 'Only GET is allowed.');
    const u = new URL(request.url);
    if (u.pathname === '/health') return json({ ok: true }, 200, cors);
    if (!okOrigin) return fail(403, 'origin', 'This proxy only serves the Crawlspace site.');

    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    if (recent.length >= 90) return fail(429, 'busy', 'Too many pages in a minute. Give it a moment.');
    recent.push(now);
    hits.set(ip, recent);

    let target;
    try { target = new URL(u.searchParams.get('url') || ''); } catch { return fail(400, 'url', 'That is not a web address.'); }
    if (!/^https?:$/.test(target.protocol)) return fail(400, 'url', 'Only http and https pages can be crawled.');
    if (isPrivateHost(target.hostname)) return fail(400, 'url', 'Private and local addresses are off limits.');
    if (target.port && !['80', '443'].includes(target.port)) return fail(400, 'url', 'Only standard web ports can be crawled.');
    target.hash = '';

    if (!(await robotsAllow(target))) return fail(403, 'robots', "This site's robots.txt asks crawlers to stay out of this page.");

    const t0 = Date.now();
    let res;
    try {
      res = await fetch(target.toString(), {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en;q=0.9,*;q=0.5' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return fail(502, 'fetch', e.name === 'TimeoutError' ? 'The site took too long to answer.' : 'Could not reach that site.');
    }
    const type = res.headers.get('content-type') || '';
    const finalUrl = res.url || target.toString();

    if (u.searchParams.get('mode') === 'status') {
      res.body?.cancel().catch(() => {});
      return json({ status: res.status, finalUrl, type: type.split(';')[0] }, 200, cors);
    }
    if (!HTML_TYPES.test(type)) {
      res.body?.cancel().catch(() => {});
      return fail(415, 'type', `That address is not a web page (${type.split(';')[0] || 'unknown type'}).`);
    }

    const chunks = [];
    let bytes = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { reader.cancel().catch(() => {}); break; }
    }
    const buf = new Uint8Array(bytes);
    let off = 0;
    for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.byteLength, bytes - off)), off); off += c.byteLength; if (off >= bytes) break; }
    const head = new TextDecoder('latin1').decode(buf.subarray(0, 2048));
    const charset = (type.match(/charset=["']?([\w-]+)/i) || head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
    let html;
    try { html = new TextDecoder(charset).decode(buf); } catch { html = new TextDecoder('utf-8').decode(buf); }

    return new Response(html, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'X-Final-Url': finalUrl,
        'X-Status': String(res.status),
        'X-Fetch-Ms': String(Date.now() - t0),
      },
    });
  },
};

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function isPrivateHost(h) {
  h = h.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || /\.(local|localhost|internal|lan|home)$/.test(h)) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) return h === '::1' || /^f[cd]/.test(h) || h.startsWith('fe80');
  return false;
}

// ---------- robots.txt ----------

async function robotsAllow(url) {
  const origin = url.origin;
  let entry = robotsCache.get(origin);
  if (!entry || Date.now() - entry.at > 3_600_000) {
    let rules = [];
    try {
      const r = await fetch(origin + '/robots.txt', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6_000) });
      if (r.ok) rules = parseRobots((await r.text()).slice(0, 500_000));
      else if (r.status >= 500) rules = [{ allow: false, len: 1, re: /^\// }]; // server trouble: stay out
    } catch { rules = []; }
    entry = { at: Date.now(), rules };
    robotsCache.set(origin, entry);
  }
  const path = url.pathname + url.search;
  let best = null;
  for (const r of entry.rules) if (r.re.test(path) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
  return !best || best.allow;
}

function parseRobots(txt) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur || (key !== 'allow' && key !== 'disallow') || !val) continue;
    const esc = val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    cur.rules.push({ allow: key === 'allow', len: val.length, re: new RegExp('^' + (esc.endsWith('\\$') ? esc.slice(0, -2) + '$' : esc)) });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && UA_TOKEN.includes(a)));
  return (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
}
