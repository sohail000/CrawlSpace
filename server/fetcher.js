// Network layer: polite fetching, robots.txt, per-host spacing.

export const USER_AGENT = 'CrawlspaceBot/0.1 (local research crawler; respects robots.txt)';
const UA_TOKEN = 'crawlspacebot';

const robotsCache = new Map(); // origin -> Promise<rules[]>
const nextSlot = new Map();    // host -> earliest ms timestamp for the next request

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ruleRegex(path) {
  const esc = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + (esc.endsWith('\\$') ? esc.slice(0, -2) + '$' : esc));
}

function parseRobots(txt) {
  // Collect rules from groups addressed to us, falling back to "*".
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if ((key === 'allow' || key === 'disallow') && val) cur.rules.push({ allow: key === 'allow', path: val, re: ruleRegex(val) });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && UA_TOKEN.includes(a)));
  const pick = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return pick.flatMap((g) => g.rules);
}

async function rulesFor(origin) {
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const res = await fetch(origin + '/robots.txt', {
          headers: { 'user-agent': USER_AGENT },
          signal: AbortSignal.timeout(8000),
          redirect: 'follow',
        });
        if (res.status >= 400 && res.status < 500) return [];   // no robots.txt: everything allowed
        if (!res.ok) return [{ allow: false, path: '/', re: /^\// }]; // server trouble: stay out
        return parseRobots((await res.text()).slice(0, 500_000));
      } catch {
        return [];
      }
    })());
  }
  return robotsCache.get(origin);
}

export async function robotsAllows(url) {
  const u = new URL(url);
  const rules = await rulesFor(u.origin);
  const path = u.pathname + u.search;
  let best = null;
  for (const r of rules) {
    if (r.re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// Reserve the next request slot for a host; returns how long the caller must wait.
export function reserveSlot(host, gapMs) {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) || 0);
  nextSlot.set(host, at + gapMs);
  return at - now;
}

const HTML_TYPES = /text\/html|application\/xhtml\+xml/i;

export async function fetchPage(url, { timeout = 15000, maxBytes = 3_000_000, signal } = {}) {
  const t0 = Date.now();
  const timeoutSignal = AbortSignal.timeout(timeout);
  const res = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      'accept-language': 'en;q=0.9,*;q=0.5',
    },
    redirect: 'follow',
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });
  const type = res.headers.get('content-type') || '';
  const out = { status: res.status, finalUrl: res.url || url, type, ms: 0, bytes: 0, html: '' };
  if (!res.ok || !HTML_TYPES.test(type)) {
    res.body?.cancel().catch(() => {});
    out.ms = Date.now() - t0;
    return out;
  }
  const reader = res.body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    out.bytes += value.byteLength;
    if (out.bytes > maxBytes) { reader.cancel().catch(() => {}); break; }
  }
  const charset = (type.match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
  let dec;
  try { dec = new TextDecoder(charset); } catch { dec = new TextDecoder('utf-8'); }
  out.html = dec.decode(Buffer.concat(chunks));
  out.ms = Date.now() - t0;
  return out;
}
