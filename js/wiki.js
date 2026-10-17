// Live Wikipedia, read straight from the visitor's browser: anonymous Action API calls with CORS
// (origin=*). A governor keeps every hunt polite: at most 3 requests in flight (Wikimedia's guidance)
// and a per-minute ceiling well under its published limit for browsers. Every request is reported.

const WIKI = 'https://en.wikipedia.org';
const WIKI_API = WIKI + '/w/api.php';
const wikiUrl = (title) => WIKI + '/wiki/' + encodeURIComponent(String(title).replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':');
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

class Governor {
  constructor({ concurrent = 3, perMinute = 120 } = {}) {
    this.max = concurrent;
    this.perMinute = perMinute;
    this.inflight = 0;
    this.stamps = [];
    this.waiters = [];
    this.pausedUntil = 0;
  }

  // Resolves with a release() once a request may go out. onWait reports why it is held back.
  async slot(onWait) {
    for (;;) {
      const t = Date.now();
      while (this.stamps.length && t - this.stamps[0] > 60_000) this.stamps.shift();
      const paused = this.pausedUntil - t;
      const full = this.stamps.length >= this.perMinute ? 60_000 - (t - this.stamps[0]) : 0;
      if (this.inflight < this.max && paused <= 0 && full <= 0) {
        this.inflight++;
        this.stamps.push(t);
        let done = false;
        return () => { if (done) return; done = true; this.inflight--; this.wake(); };
      }
      const ms = Math.max(paused, full);
      onWait?.(ms > 0 ? { reason: paused > 0 ? 'wikipedia' : 'budget', ms } : { reason: 'busy', ms: 0 });
      await new Promise((r) => {
        const timer = ms > 0 ? setTimeout(r, ms + 25) : null;
        this.waiters.push(() => { clearTimeout(timer); r(); });
      });
    }
  }

  wake() { const w = this.waiters; this.waiters = []; for (const f of w) f(); }
  pause(ms) { this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms); }
}

class Wiki {
  // headers: only for non-browser use (a browser sends its own User-Agent; extra headers would
  // force a CORS preflight on every call). onRequest(info) sees every finished request.
  constructor({ governor = new Governor(), headers = {}, onRequest = null } = {}) {
    this.gov = governor;
    this.headers = headers;
    this.onRequest = onRequest;
    this.count = 0;
  }

  async api(params, { signal, onWait, what = params.action, base = WIKI_API } = {}) {
    const url = base + '?' + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
    for (let attempt = 0; ; attempt++) {
      const release = await this.gov.slot(onWait);
      if (signal?.aborted) { release(); throw abortError(); }
      const t0 = now();
      const ctl = new AbortController();
      const cut = () => ctl.abort();
      signal?.addEventListener('abort', cut, { once: true });
      const timer = setTimeout(cut, 25_000);
      let res = null, data = null, size = 0, err = null;
      try {
        res = await fetch(url, { signal: ctl.signal, headers: this.headers });
        const text = await res.text();
        size = text.length;
        try { data = JSON.parse(text); } catch { data = null; }
      } catch (e) {
        err = e;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cut);
        release();
      }
      if (signal?.aborted) throw abortError();
      this.count++;
      const code = data?.error?.code;
      const limited = res && (res.status === 429 || res.status === 503 || code === 'ratelimited' || code === 'maxlag');
      this.onRequest?.({ what, status: res ? res.status : 0, ms: Math.round(now() - t0), kb: Math.round(size / 1024), limited, url, attempt });
      if (limited || err) {
        // Rate limited, overloaded, timed out, or no answer at all (a 429 without CORS headers looks like a network error).
        if (attempt >= 4) throw new Error(limited ? 'Wikipedia is rate-limiting this connection. Wait a minute and try again.' : `Could not reach Wikipedia (${err.message}).`);
        const ra = Number(res?.headers.get('retry-after'));
        const wait = ra > 0 ? ra * 1000 : 3000 * 2 ** attempt;
        this.gov.pause(wait);
        onWait?.({ reason: 'wikipedia', ms: wait });
        continue;
      }
      if (!res.ok || !data) throw new Error(`Wikipedia answered HTTP ${res.status}`);
      if (data.error) throw Object.assign(new Error(data.error.info || code), { kind: code === 'missingtitle' ? 'missing' : 'api' });
      return data;
    }
  }

  // Canonical titles for what the visitor typed: follows redirects and flags missing and ambiguous pages.
  async lookup(titles, opts) {
    const d = await this.api({ action: 'query', titles: titles.join('|'), redirects: '1', prop: 'pageprops|description|info', ppprop: 'disambiguation' }, { ...opts, what: 'look up' });
    const q = d.query || {};
    const step = new Map();
    for (const n of q.normalized || []) step.set(n.from, n.to);
    for (const r of q.redirects || []) step.set(r.from, r.to);
    const pages = new Map((q.pages || []).map((p) => [p.title, p]));
    return titles.map((input) => {
      let title = input;
      for (let i = 0; i < 4 && step.has(title); i++) title = step.get(title);
      const p = pages.get(title) || {};
      return {
        input, title, description: p.description || '', length: p.length || 0,
        missing: Boolean(p.missing || p.invalid || !pages.has(title)),
        ambiguous: Boolean(p.pageprops && 'disambiguation' in p.pageprops),
      };
    });
  }

  // A page on another language's Wikipedia: follow its interlanguage link to the English article.
  async englishTitle(lang, title, opts) {
    const d = await this.api({ action: 'query', titles: title, prop: 'langlinks', lllang: 'en', redirects: '1' },
      { ...opts, what: `find ${lang}:${title} in English`, base: `https://${lang}.wikipedia.org/w/api.php` });
    return d.query?.pages?.[0]?.langlinks?.[0]?.title || null;
  }

  async search(text, opts) {
    const d = await this.api({ action: 'query', list: 'search', srsearch: text, srlimit: '6', srnamespace: '0', srprop: '' }, { ...opts, what: 'search' });
    return (d.query?.search || []).map((s) => s.title);
  }

  // Title suggestions while typing.
  async suggest(prefix, opts) {
    const d = await this.api({ action: 'query', generator: 'prefixsearch', gpssearch: prefix, gpslimit: '7', gpsnamespace: '0', prop: 'description' }, { ...opts, what: 'suggest' });
    return (d.query?.pages || []).sort((a, b) => a.index - b.index).map((p) => ({ title: p.title, description: p.description || '' }));
  }

  // What the target smells like: its aliases (redirects), opening text and categories.
  async target(title, opts) {
    const d = await this.api({
      action: 'query', titles: title, prop: 'redirects|extracts|categories|description',
      rdlimit: 'max', rdnamespace: '0', exintro: '1', explaintext: '1', clshow: '!hidden', cllimit: 'max',
    }, { ...opts, what: `scent of ${title}` });
    const p = d.query.pages[0];
    return {
      title: p.title,
      aliases: (p.redirects || []).map((r) => r.title),
      extract: p.extract || '',
      categories: (p.categories || []).map((c) => c.title.replace(/^Category:/, '')),
      description: p.description || '',
    };
  }

  // Up to 500 articles that link to a page. The API lists them oldest first.
  async backlinks(title, opts) {
    const d = await this.api({ action: 'query', list: 'backlinks', bltitle: title, blnamespace: '0', bllimit: 'max', blfilterredir: 'nonredirects' }, { ...opts, what: `who links to ${title}` });
    return { titles: (d.query?.backlinks || []).map((b) => b.title), more: Boolean(d.continue) };
  }

  // Who links to any of up to 50 pages, in one request (at most 500 answers; `cont` fetches the next batch).
  async linkshere(titles, opts, cont = null) {
    const d = await this.api({
      action: 'query', titles: titles.slice(0, 50).join('|'), prop: 'linkshere', lhnamespace: '0', lhshow: '!redirect', lhlimit: 'max', lhprop: 'title',
      ...(cont || {}),
    }, { ...opts, what: `who links to ${titles.length} pages` });
    const map = new Map();
    for (const p of d.query?.pages || []) for (const l of p.linkshere || []) if (!map.has(l.title)) map.set(l.title, p.title);
    return { map, cont: d.continue || null };
  }

  // One page, parsed by Wikipedia, cut down to readable prose with every link's position.
  async read(title, opts) {
    const t0 = now();
    const d = await this.api({ action: 'parse', page: title, redirects: '1', prop: 'text', disableeditsection: '1', disablelimitreport: '1', disabletoc: '1' }, { ...opts, what: `read ${title}` });
    const html = d.parse.text || '';
    return { title: d.parse.title, ...prose(html), kb: Math.round(html.length / 1024), ms: Math.round(now() - t0) };
  }

  // One request answers "which of these pages link to the target?" (prop=links filtered by pltitles).
  // It also resolves redirects and reports each page's size, a rough measure of how much of a hub it is.
  async sniff(titles, targets, opts) {
    const t0 = now();
    const d = await this.api({
      action: 'query', titles: titles.slice(0, 50).join('|'), redirects: '1', prop: 'links|info',
      pltitles: targets.slice(0, 50).join('|'), pllimit: 'max', plnamespace: '0',
    }, { ...opts, what: `sniff ${titles.length} links` });
    const q = d.query || {};
    const step = new Map();
    for (const n of q.normalized || []) step.set(n.from, n.to);
    for (const r of q.redirects || []) step.set(r.from, r.to);
    const canon = new Map(titles.map((t) => {
      let c = t;
      for (let i = 0; i < 4 && step.has(c); i++) c = step.get(c);
      return [t, c];
    }));
    const linking = new Set(), length = new Map(), missing = new Set();
    for (const p of q.pages || []) {
      if (p.missing || p.invalid) missing.add(p.title);
      if (p.length) length.set(p.title, p.length);
      if (p.links?.length) linking.add(p.title);
    }
    return { canon, linking, length, missing, ms: Math.round(now() - t0) };
  }
}

function abortError() { return Object.assign(new Error('aborted'), { name: 'AbortError' }); }

// ---------- HTML -> prose ----------

const WIKI_NAMESPACES = new Set(('file image media category template help wikipedia wp project portal special talk user module draft ' +
  'mediawiki timedtext book gadget topic wikt wiktionary commons s q n b v voy species d meta mw w m c f').split(' '));

const PROSE_JUNK = [
  'style', 'script', 'link', 'meta', '.mw-editsection', 'sup.reference', 'sup.noprint', '.mw-ref', '.reflist', '.references',
  '.mw-references-wrap', '.navbox', '.navbox-styles', '.vertical-navbox', '.sidebar', '.metadata', '.ambox', '.ombox', '.tmbox',
  '.mbox-small', '.hatnote', '.shortdescription', '.noprint', '.mw-empty-elt', 'figure', '.thumb', '.gallery', '.toc', '#toc',
  '.portalbox', '.side-box', '.sister-box', '.sistersitebox', '.catlinks', '.printfooter', '#coordinates', '.mwe-math-element',
].join(',');

const END_SECTIONS = /^(see also|references|notes|external links|further reading|bibliography|sources|citations|footnotes|works cited|notes and references|references and notes|explanatory notes|general and cited references|cited sources|primary sources|secondary sources)$/i;

function linkTitle(a) {
  const href = a.getAttribute('href') || '';
  if (!href.startsWith('/wiki/')) return null;
  if (/\b(new|external|extiw|mw-selflink|mw-disambig|image|mw-file-description)\b/.test(a.getAttribute('class') || '')) return null;
  let t;
  try { t = decodeURIComponent(href.slice(6).split('#')[0]); } catch { return null; }
  t = t.replace(/_/g, ' ').trim();
  if (!t) return null;
  const colon = t.indexOf(':');
  if (colon > 0 && WIKI_NAMESPACES.has(t.slice(0, colon).toLowerCase())) return null;
  return t[0].toUpperCase() + t.slice(1);
}

// Flatten an element to plain text, remembering where each article link sits in that text.
function flatten(el, skipLists) {
  let t = '';
  const links = [];
  const add = (s) => {
    s = s.replace(/\s+/g, ' ');
    if (!t || t.endsWith(' ')) s = s.replace(/^ /, '');
    t += s;
  };
  const walk = (node, inLink) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { add(c.nodeValue); continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName.toUpperCase();
      if (tag === 'STYLE' || tag === 'SCRIPT') continue;
      if (skipLists && (tag === 'UL' || tag === 'OL' || tag === 'DL')) continue;
      if (tag === 'BR') { add(' '); continue; }
      if (tag === 'LI' && t && !/[\s(]$/.test(t)) add(', ');
      else if ((tag === 'DIV' || tag === 'P' || tag === 'DD' || tag === 'DT') && t) add(' ');
      if (tag === 'A' && !inLink) {
        const title = linkTitle(c);
        if (title) {
          const start = t.length;
          walk(c, true);
          let s = start, e = t.length;
          while (s < e && t[s] === ' ') s++;
          while (e > s && t[e - 1] === ' ') e--;
          if (e > s) links.push({ title, s, e });
          continue;
        }
      }
      walk(c, inLink);
    }
  };
  walk(el, false);
  const lead = t.length - t.trimStart().length;
  const text = t.trim();
  return {
    t: text,
    links: links.map((l) => ({ title: l.title, s: l.s - lead, e: Math.min(text.length, l.e - lead) })).filter((l) => l.s >= 0 && l.e > l.s),
  };
}

const cleanText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const KIND_RANK = { p: 0, q: 1, li: 2, i: 3 };

// Paragraphs (k: h heading, p prose, li list item, q quote, i infobox row) and the page's links,
// each link once, at its best spot for a quote: the opening prose first, then prose, lists, infobox.
function prose(html, { maxParas = 600, maxChars = 250_000 } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.mw-parser-output') || doc.body;
  for (const n of root.querySelectorAll(PROSE_JUNK)) n.remove();

  const paragraphs = [];
  for (const box of root.querySelectorAll('table.infobox')) {
    for (const tr of box.querySelectorAll('tr')) {
      const cells = [...tr.children];
      const th = cells.find((c) => c.tagName.toUpperCase() === 'TH');
      const td = cells.find((c) => c.tagName.toUpperCase() === 'TD');
      if (!th || !td) continue;
      const label = cleanText(th.textContent);
      const v = flatten(td, false);
      if (!label || !v.t || label.length > 60) continue;
      const pre = label + ': ';
      paragraphs.push({ k: 'i', t: pre + v.t, links: v.links.map((l) => ({ ...l, s: l.s + pre.length, e: l.e + pre.length })) });
    }
  }
  for (const tbl of root.querySelectorAll('table')) tbl.remove();

  let chars = 0, inLead = true;
  for (const el of root.querySelectorAll('h2, h3, h4, p, li, dd, blockquote')) {
    if (paragraphs.length >= maxParas || chars >= maxChars) break;
    const tag = el.tagName.toUpperCase();
    if (tag[0] === 'H') {
      const t = cleanText(el.textContent);
      if (tag === 'H2' && END_SECTIONS.test(t)) break;
      if (t) paragraphs.push({ k: 'h', t, links: [] });
      inLead = false;
      continue;
    }
    if (tag === 'P' && el.parentElement?.closest('li, dd, blockquote')) continue;
    if ((tag === 'DD' || tag === 'BLOCKQUOTE') && el.parentElement?.closest('li')) continue;
    const f = flatten(el, tag === 'LI' || tag === 'DD');
    if (f.t.length < 2 || (tag !== 'LI' && f.t.length < 20 && !f.links.length)) continue;
    const k = tag === 'LI' ? 'li' : tag === 'BLOCKQUOTE' ? 'q' : 'p';
    paragraphs.push({ k, t: f.t, links: f.links, lead: inLead && k === 'p' });
    chars += f.t.length;
  }

  const best = new Map();
  paragraphs.forEach((para, p) => {
    for (const l of para.links) {
      const cand = { title: l.title, p, s: l.s, e: l.e, lead: Boolean(para.lead), kind: para.k };
      const cur = best.get(l.title);
      if (!cur || (cand.lead && !cur.lead) || (cand.lead === cur.lead && KIND_RANK[cand.kind] < KIND_RANK[cur.kind])) best.set(l.title, cand);
    }
  });
  return { paragraphs, links: [...best.values()], chars };
}
