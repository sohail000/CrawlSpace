// One hunt across live Wikipedia, from a source page to a target page.
// Hunters read pages and follow links. A sentinel sits on the target and maps who links to it.
// Every event describes something that really happened: the view animates events and never invents them.

const HUNTER_NAMES = ['Argiope', 'Phidippus', 'Salticus', 'Hogna', 'Dolomedes'];
const SNIFF_SIZE = 48;  // links checked per page in one request: "which of these link to the target?"
const FOLLOW = 6;       // ordinary links queued per page, on top of every link known to lead to the target
const RING_REQUESTS = 6; // the sentinel's whole budget for mapping rings around the target

const normTitle = (t) => {
  const s = String(t || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};
const hubness = (bytes) => (bytes ? Math.max(0, Math.min(1, (Math.log10(bytes) - 4) / 1.4)) : 0);
const spread = (arr, n) => (arr.length <= n ? arr.slice() : Array.from({ length: n }, (_, i) => arr[Math.floor((i * arr.length) / n)]));

// What the visitor typed may be a link. A Wikipedia link names its article (in any language).
// Any other link gives a search phrase: the words of its last meaningful path segment, or the site's name.
const GENERIC_SEGMENTS = new Set(('index home default main wiki w watch article articles story stories news post posts p blog ' +
  'blogs en us uk amp page pages item items product products dp gp search results tag tags category categories topic topics ' +
  'video videos status r comments u user users profile about html').split(' '));
const SECOND_LEVEL = new Set('co com org net gov edu ac'.split(' '));

function readLink(input) {
  const s = String(input || '').trim();
  if (!/^https?:\/\//i.test(s) && !/^www\./i.test(s) && !/^[\w-]+(\.[\w-]+)+\//.test(s)) return null;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const site = host.replace(/^(www|m)\./, '');
  const wp = host.match(/^([a-z][a-z-]{1,15})(?:\.m)?\.wikipedia\.org$/);
  if (wp) {
    let title = '';
    try { title = u.pathname.startsWith('/wiki/') ? decodeURIComponent(u.pathname.slice(6)) : u.searchParams.get('title') || ''; } catch {}
    title = title.replace(/_/g, ' ').trim();
    return title ? { lang: wp[1], title } : null;
  }
  for (const seg of u.pathname.split('/').filter(Boolean).reverse()) {
    let w;
    try { w = decodeURIComponent(seg); } catch { continue; }
    const words = w.replace(/\.[a-z]{2,5}$/i, '').split(/[-_+.~\s]+/).filter((t) => t && !/\d/.test(t));
    if (words.join('').length >= 3 && !(words.length === 1 && GENERIC_SEGMENTS.has(words[0].toLowerCase()))) return { query: words.join(' '), site };
  }
  const labels = host.split('.');
  labels.pop(); // the top-level domain
  while (labels.length > 1 && SECOND_LEVEL.has(labels[labels.length - 1])) labels.pop();
  const name = labels[labels.length - 1];
  return name && name !== 'www' ? { query: name, site } : null;
}

// Estimated hops still to go from a candidate page to the target (lower is better).
function estimate(c) {
  if (c.heat === 1) return 1;     // Wikipedia confirmed: this page links to the target
  if (c.heat === 2) return 2;     // it links to a page that links to the target
  if (c.heat === 3) return 2.9;   // three links out, by the sentinel's map
  const hub = c.hub ?? 0.25;
  return (c.sniffed ? 2.15 : 2.6) + 1.2 * (1 - c.scent) + 0.5 * (1 - hub) - 0.1 * c.lead;
}

class Hunt {
  constructor({ from, to, wiki, emit, hunters = 3, maxReads = 50 }) {
    this.from = from;
    this.to = to;
    this.wiki = wiki;
    this.emit = emit;
    this.hunterCount = hunters;
    this.maxReads = maxReads;
    this.pace = null;            // optional (spiderId) => Promise, so the view can keep up with the crawl
    this.abort = new AbortController();
    this.done = false;
    this.found = false;
    this.nodes = new Map();      // canonical title -> node
    this.frontier = [];
    this.alias = new Map();      // title -> canonical title, learned from redirects
    this.targetNames = new Set();
    this.zone = new Map();       // page -> { level, via }: level 1 links to the target, level 2 to a level-1 page...
    this.nid = 0;
    this.active = 0;
    this.claimed = 0;
    this.t0 = Date.now();
    this.requests0 = wiki.count;
    this.stats = { reads: 0, links: 0, sniffed: 0, fails: 0 };
  }

  canon(t) { const n = normTitle(t); return this.alias.get(n) || n; }
  isTarget(t) { return this.targetNames.has(normTitle(t)) || this.targetNames.has(this.canon(t)); }

  snapshot() {
    return { ...this.stats, requests: this.wiki.count - this.requests0, ms: Date.now() - this.t0, hunters: this.hunterCount, frontier: this.frontier.length, mapped: this.zone.size };
  }

  // ---------- the run ----------

  async run() {
    const E = this.emit;
    this.hunters = HUNTER_NAMES.slice(0, this.hunterCount).map((name, i) => ({ id: 'h' + i, name, role: 'hunter' }));
    this.sentinel = { id: 'sentinel', name: 'Misumena', role: 'sentinel' };
    E('hunt', { from: this.from, to: this.to, hunters: this.hunterCount, maxReads: this.maxReads });
    for (const s of [...this.hunters, this.sentinel]) E('spider', s);
    try {
      E('state', { spider: this.sentinel.id, state: 'resolve', msg: 'finding both pages on Wikipedia' });
      const [source, target] = await this.resolveEnds();
      this.source = source;
      this.target = target;
      E('ends', { source, target });
      this.root = this.addNode(source.title, null, { id: 'src', est: 3 });
      this.frontier.push(this.root);
      this.ready = this.prepareTarget();
      this.ready.catch(() => {});
      await Promise.all(this.hunters.map((h, i) => sleep(i * 300).then(() => this.worker(h))));
      await this.ready;
      if (!this.done) this.giveUp();
    } catch (e) {
      if (this.stopped || e.name === 'AbortError') return;
      this.done = true;
      this.abort.abort();
      E('error', { message: e.message });
      E('end', { found: false, reason: 'error', message: e.message, stats: this.snapshot() });
    }
  }

  stop() {
    if (this.done) return;
    this.done = true;
    this.stopped = true;
    this.abort.abort();
    this.emit('end', { found: false, reason: 'stopped', stats: this.snapshot() });
  }

  // Turn what was typed (a name, a Wikipedia link in any language, or any other link) into two English articles.
  async resolveEnds() {
    const opts = { signal: this.abort.signal };
    const ends = [];
    for (const raw of [this.from, this.to]) {
      const link = readLink(raw);
      if (link?.lang && link.lang !== 'en') {
        const en = await this.wiki.englishTitle(link.lang, link.title, opts);
        if (!en) throw new Error(`"${link.title}" has no English Wikipedia article yet. Try typing the topic instead.`);
        ends.push({ text: en, note: `Followed your ${link.lang}.wikipedia.org link to the English article "${en}".` });
      } else if (link?.title) ends.push({ text: link.title, note: '' });
      else if (link?.query) ends.push({ text: link.query, site: link.site, note: '' });
      else if (/^\w+:\/\//.test(String(raw).trim())) throw new Error("Couldn't read that link. Paste a web address, or just type the topic.");
      else ends.push({ text: String(raw).trim(), note: '' });
    }
    const looked = await this.wiki.lookup(ends.map((x) => x.text), opts);
    const out = [];
    for (let i = 0; i < 2; i++) {
      const r = looked[i], end = ends[i];
      let pick = r, note = end.note;
      if (r.missing || r.ambiguous) {
        const hits = (await this.wiki.search(r.input, opts)).filter((t) => t !== r.title);
        const checked = hits.length ? await this.wiki.lookup(hits, opts) : [];
        const ok = checked.find((c) => !c.missing && !c.ambiguous);
        if (!ok) {
          throw new Error(end.site ? `Couldn't find a Wikipedia article for that ${end.site} link. Try typing the topic instead.`
            : r.missing ? `Wikipedia has no article called "${r.input}".` : `"${r.input}" means too many things. Try something more specific.`);
        }
        if (!end.site) note = r.ambiguous ? `"${r.input}" has several meanings, so the spiders took ${ok.title}.` : `No page is called "${r.input}", so the spiders took ${ok.title}.`;
        pick = ok;
      }
      if (end.site) note = `Crawlspace hunts inside Wikipedia, so from your ${end.site} link it took "${pick.title}".`;
      out.push({ title: pick.title, description: pick.description, input: r.input, note, url: wikiUrl(pick.title) });
    }
    if (out[0].title === out[1].title) throw new Error('Those are the same page. Pick two different things.');
    return out;
  }

  // The sentinel learns the target's scent and who links to it (one request each, in parallel).
  async prepareTarget() {
    const s = this.sentinel, T = this.target.title, E = this.emit;
    const opts = { signal: this.abort.signal, onWait: (w) => this.waitState(s, 'dst', w) };
    E('state', { spider: s.id, node: 'dst', state: 'scent', msg: `learning what ${T} smells like` });
    const [info, bl] = await Promise.all([this.wiki.target(T, opts), this.wiki.backlinks(T, opts)]);
    this.targetNames = new Set([T, ...info.aliases].map(normTitle));
    this.sniffTargets = [T, ...info.aliases.slice(0, 49)];

    const scent = new Scent();
    scent.add(T.replace(/\(.*?\)/g, ''), 4, 1);
    scent.add(info.description, 2, 1);
    scent.add(info.extract.slice(0, 3000), 1, 3);
    for (const c of info.categories) scent.add(c, 1.5, 1);
    for (const a of info.aliases.slice(0, 60)) scent.add(a, 0.4, 1);
    const counts = new Map();
    for (const b of bl.titles) for (const t of new Set(words(b.replace(/\(.*?\)/g, '')))) counts.set(t, (counts.get(t) || 0) + 1);
    for (const [t, c] of counts) scent.w.set(t, (scent.w.get(t) || 0) + 0.5 * Math.sqrt(c));
    scent.seal();
    this.scent = scent;

    for (const b of bl.titles) if (!this.isTarget(b)) this.zone.set(b, { level: 1, via: T });
    E('scent', { spider: s.id, terms: scent.top, aliases: info.aliases.length, description: info.description });
    E('zone', { spider: s.id, level: 1, titles: spread(bl.titles, 60).map((t) => ({ title: t, via: T })), total: bl.titles.length, more: bl.more });
    this.log(s, `${bl.more ? '500+' : bl.titles.length} pages link to ${T}. It smells of: ${scent.top.slice(0, 6).join(', ')}.`);
    // A rarely linked target needs its outer rings before anyone judges a link; a popular one maps them in the background.
    const rings = this.mapRings();
    if (!bl.more) await rings;
  }

  // The sentinel maps rings around the target (who links to it, who links to those...) with batched
  // "who links here" requests: RING_REQUESTS at most, however big the rings get.
  async mapRings() {
    const s = this.sentinel, E = this.emit, T = this.target.title;
    const opts = { signal: this.abort.signal, onWait: (w) => this.waitState(s, 'dst', w) };
    let ring = [...this.zone.keys()];
    let spent = 0;
    try {
      for (let level = 2; level <= 3 && ring.length && spent < RING_REQUESTS && !this.done; level++) {
        const pool = ring.slice().sort((a, b) => a.length - b.length); // short titles first: broad, well-linked topics
        const next = new Map();
        for (let i = 0; i < pool.length && spent < RING_REQUESTS && next.size < 1500 && !this.done; i += 50) {
          const batch = pool.slice(i, i + 50);
          E('state', { spider: s.id, node: 'dst', state: 'zone', msg: `asking who links to ${batch.length} pages ${level - 1} link${level > 2 ? 's' : ''} out`, level });
          let cont = null;
          do {
            const r = await this.wiki.linkshere(batch, opts, cont);
            spent++;
            for (const [t, via] of r.map) if (!this.zone.has(t) && !next.has(t) && !this.isTarget(t)) next.set(t, via);
            cont = r.cont;
          } while (cont && spent < RING_REQUESTS && next.size < 1500 && !this.done);
        }
        if (this.done) return;
        for (const [t, via] of next) this.zone.set(t, { level, via });
        const titles = [...next.keys()];
        E('zone', { spider: s.id, level, titles: spread(titles, 48).map((t) => ({ title: t, via: next.get(t) })), total: titles.length });
        this.log(s, `Mapped ${titles.length} pages that are ${level} links from ${T}.`);
        this.rescan();
        if (next.size >= 1000) break;
        ring = titles;
      }
    } catch (e) {
      if (e.name !== 'AbortError' && !this.done) this.log(s, `Could not map the outer rings: ${e.message}`, 'warn');
    }
    if (!this.done) E('state', { spider: s.id, node: 'dst', state: 'watch', msg: `guarding ${T}` });
  }

  // A fresh ring can make links on pages already read worth following.
  rescan() {
    const items = [];
    for (const n of [...this.nodes.values()]) {
      if (n.state !== 'read' || !n.page || items.length >= 12) continue;
      for (const L of n.page.links) {
        const title = this.canon(L.title);
        const z = this.zone.get(title);
        if (!z || this.nodes.has(title) || items.length >= 12) continue;
        const c = { L, title, ctx: '', scent: this.scent.smell(L.title), heat: z.level, lead: L.lead ? 1 : 0, hub: null, sniffed: false };
        c.est = estimate(c);
        const child = this.addNode(title, n, { occ: L, heat: c.heat, scent: c.scent, est: c.est, why: this.why(c) });
        this.frontier.push(child);
        items.push(child);
      }
    }
    if (!items.length) return;
    this.emit('frontier', { spider: null, node: null, items: items.map((n) => this.itemOf(n)) });
    this.log(this.sentinel, `The new map lights up ${items.length} link${items.length === 1 ? '' : 's'} on pages already read.`);
  }

  // ---------- hunters ----------

  async worker(sp) {
    let idle = false;
    while (!this.done) {
      if (this.pace) await this.pace(sp.id);
      if (this.done || this.claimed >= this.maxReads) break;
      const node = this.popBest();
      if (!node) {
        if (this.active === 0) break;
        if (!idle) { this.emit('state', { spider: sp.id, state: 'idle', msg: 'waiting for new threads' }); idle = true; }
        await sleep(250);
        continue;
      }
      idle = false;
      this.claimed++;
      this.active++;
      try {
        await this.visit(sp, node);
      } catch (e) {
        if (this.done || e.name === 'AbortError') break;
        node.state = 'fail';
        this.stats.fails++;
        this.emit('fail', { spider: sp.id, node: node.id, kind: e.kind || 'error', reason: short(e.message, 120) });
        this.log(sp, `Fell off ${node.title}: ${e.message}`, 'warn');
      } finally {
        this.active--;
      }
      if (this.done) break;
      this.emit('stats', this.snapshot());
    }
    if (!this.found) this.emit('state', { spider: sp.id, state: 'home', msg: 'heading home' });
  }

  popBest() {
    let bi = -1;
    for (let i = 0; i < this.frontier.length; i++) {
      const n = this.frontier[i], b = this.frontier[bi];
      if (!b || n.f < b.f || (n.f === b.f && n.scent > b.scent)) bi = i;
    }
    return bi < 0 ? null : this.frontier.splice(bi, 1)[0];
  }

  addNode(title, parent, extra = {}) {
    const depth = parent ? parent.depth + 1 : 0;
    const node = { id: extra.id || 'n' + ++this.nid, title, parent, depth, state: 'queued', heat: 0, scent: 0, hub: null, est: 3, why: '', ...extra };
    node.f = depth + node.est;
    this.nodes.set(title, node);
    return node;
  }

  itemOf(n) {
    return { id: n.id, title: n.title, parent: n.parent ? n.parent.id : null, depth: n.depth, heat: n.heat, scent: Math.round(n.scent * 100) / 100, est: Math.round(n.est * 100) / 100, why: n.why };
  }

  async visit(sp, node) {
    const E = this.emit;
    const opts = { signal: this.abort.signal, onWait: (w) => this.waitState(sp, node.id, w) };
    node.state = 'claimed';
    E('claim', { spider: sp.id, node: node.id, title: node.title, parent: node.parent ? node.parent.id : null, depth: node.depth });
    E('state', { spider: sp.id, node: node.id, state: 'fetch', msg: `reading ${node.title}` });
    const page = await this.wiki.read(node.title, opts);
    if (this.done) return;
    this.stats.reads++;
    E('fetched', { spider: sp.id, node: node.id, ms: page.ms, kb: page.kb, title: page.title });
    this.log(sp, `Read "${page.title}": ${page.paragraphs.length} paragraphs, ${page.links.length} links, ${page.kb} KB in ${page.ms} ms.`);

    if (page.title !== node.title) {
      this.alias.set(normTitle(node.title), page.title);
      if (this.isTarget(page.title) && node.parent) return this.win(sp, node.parent, node.occ);
      const twin = this.nodes.get(page.title);
      if (twin && twin !== node) {
        node.state = 'fail';
        E('fail', { spider: sp.id, node: node.id, kind: 'dup', reason: `same page as ${page.title}` });
        return;
      }
      this.nodes.delete(node.title);
      node.title = page.title;
      this.nodes.set(page.title, node);
    }
    if (!page.links.length) {
      node.state = 'fail';
      this.stats.fails++;
      E('fail', { spider: sp.id, node: node.id, kind: 'empty', reason: 'a dead end: no article links on this page' });
      return;
    }
    node.state = 'read';
    node.page = page;
    E('page', { spider: sp.id, node: node.id, title: page.title, url: wikiUrl(page.title), paragraphs: page.paragraphs, linkCount: page.links.length, kb: page.kb });

    await this.ready;
    if (this.done) return;

    const hit = page.links.find((l) => this.isTarget(l.title));
    if (hit) return this.win(sp, node, hit);

    // Smell every link, then ask Wikipedia about the most promising ones in a single request.
    E('state', { spider: sp.id, node: node.id, state: 'judge', msg: `smelling ${page.links.length} links` });
    const cands = [];
    const seen = new Set();
    for (const L of page.links) {
      const title = this.canon(L.title);
      if (seen.has(title) || this.nodes.has(title) || title === page.title) continue;
      seen.add(title);
      const para = page.paragraphs[L.p];
      const [a, b] = sentenceAround(para.t, L.s, L.e);
      cands.push({
        L, title, ctx: para.t.slice(a, b), scent: this.scent.smell(L.title, para.t.slice(a, b)),
        heat: this.zone.get(title)?.level || 0, lead: L.lead ? 1 : 0, hub: null, sniffed: false,
      });
    }
    this.stats.links += page.links.length;

    const ask = cands.filter((c) => c.heat !== 1)
      .map((c) => ({ c, k: c.scent + 0.08 * c.lead + (c.heat === 2 ? 0.5 : c.heat === 3 ? 0.3 : 0) - 0.0004 * c.L.p }))
      .sort((x, y) => y.k - x.k).slice(0, SNIFF_SIZE).map((x) => x.c);
    if (ask.length) {
      E('state', { spider: sp.id, node: node.id, state: 'sniff', msg: `asking which of ${ask.length} links lead to ${this.target.title}` });
      const sn = await this.wiki.sniff(ask.map((c) => c.title), this.sniffTargets, opts);
      if (this.done) return;
      this.stats.sniffed += ask.length;
      for (const c of ask) {
        const canon = sn.canon.get(c.title) || c.title;
        if (canon !== c.title) { this.alias.set(c.title, canon); c.title = canon; }
        c.sniffed = true;
        if (sn.missing.has(canon)) c.dead = true;
        if (sn.linking.has(canon)) c.heat = 1;
        c.hub = hubness(sn.length.get(canon));
      }
      const viaRedirect = ask.find((c) => this.isTarget(c.title));
      if (viaRedirect) return this.win(sp, node, viaRedirect.L);
      E('sniff', { spider: sp.id, node: node.id, checked: ask.length, hot: ask.filter((c) => c.heat === 1).map((c) => c.title), ms: sn.ms });
    }

    const fresh = [];
    const taken = new Set();
    for (const c of cands) {
      if (c.dead || taken.has(c.title) || this.nodes.has(c.title) || c.title === page.title) continue;
      taken.add(c.title);
      c.est = estimate(c);
      fresh.push(c);
    }
    fresh.sort((a, b) => a.est - b.est || b.scent - a.scent);
    const hot = fresh.filter((c) => c.heat === 1).slice(0, 6);
    const warm = fresh.filter((c) => c.heat > 1).slice(0, 4);
    const cool = fresh.filter((c) => !c.heat).slice(0, FOLLOW);
    const chosen = [...hot, ...warm, ...cool];

    // Bites: the sentences where the chosen links sit, so every decision shows its evidence.
    const bites = chosen.slice(0, 6).map((c, i) => {
      const [a, b] = sentenceAround(page.paragraphs[c.L.p].t, c.L.s, c.L.e);
      return { id: `${node.id}b${i}`, p: c.L.p, s: a, e: b, as: c.L.s, ae: c.L.e, title: c.title, kind: c.heat === 1 ? 'hot' : c.heat ? 'warm' : 'pick' };
    }).sort((x, y) => x.p - y.p || x.s - y.s);
    E('bites', { spider: sp.id, node: node.id, bites });

    const items = chosen.map((c) => {
      const n = this.addNode(c.title, node, { occ: c.L, heat: c.heat, scent: c.scent, hub: c.hub, est: c.est, why: this.why(c) });
      this.frontier.push(n);
      return n;
    });
    E('frontier', { spider: sp.id, node: node.id, items: items.map((n) => this.itemOf(n)) });
    E('links', { spider: sp.id, node: node.id, considered: page.links.length, chosen: items.length, hot: hot.length });
    if (hot.length) this.log(sp, `On "${page.title}": ${hot.map((c) => c.title).join(', ')} ${hot.length === 1 ? 'links' : 'link'} straight to ${this.target.title}.`);
  }

  why(c) {
    const T = this.target.title;
    const z = this.zone.get(c.title);
    if (c.heat === 1) return `links straight to ${T}`;
    if (c.heat === 2 && z) return `links to ${z.via}, which links to ${T}`;
    if (c.heat === 3 && z) return `three links from ${T}, by way of ${z.via}`;
    const terms = this.scent.shared(`${c.title} ${c.ctx}`);
    if (c.scent > 0.15 && terms.length) return `smells of ${terms.join(', ')}`;
    if ((c.hub || 0) > 0.6) return 'a big hub page';
    if (c.lead) return 'named in the opening paragraph';
    return 'worth a look';
  }

  waitState(sp, nodeId, w) {
    const s = Math.ceil(w.ms / 1000);
    const msg = w.reason === 'wikipedia' ? `Wikipedia asked us to slow down: resting ${s}s`
      : w.reason === 'budget' ? `pacing: staying under Wikipedia's per-minute limit (${s}s)`
      : 'waiting for a free connection (3 at a time)';
    this.emit('state', { spider: sp.id, node: nodeId, state: 'wait', msg, ms: w.ms });
    if (w.reason === 'wikipedia') this.log(sp, msg, 'warn');
  }

  log(sp, msg, level = 'info') { this.emit('log', { spider: sp ? sp.id : null, msg, level }); }

  // ---------- endings ----------

  quote(node, L) {
    const paras = node.page.paragraphs;
    const para = paras[L.p];
    const q = snippet(para.t, L.s, L.e);
    const [a, b] = sentenceAround(para.t, L.s, L.e);
    // A bare list item ("platypuses") says little alone: lead with the sentence that introduces the list,
    // or failing that, the section it sits in.
    let pre = '';
    if (para.k === 'li' && (L.e - L.s) / para.t.length > 0.6) {
      let i = L.p - 1;
      while (i >= 0 && paras[i].k === 'li') i--;
      const intro = paras[i];
      if (intro && intro.k === 'p' && /:\s*$/.test(intro.t)) {
        const [x, y] = sentenceAround(intro.t, intro.t.length - 1, intro.t.length);
        pre = short(intro.t.slice(x, y).trim(), 160) + ' … ';
      } else {
        for (; i >= 0; i--) if (paras[i].k === 'h') { pre = `Listed under “${paras[i].t}”: `; break; }
      }
    }
    return { text: pre + q.text, s: q.s + pre.length, e: q.e + pre.length, node: node.id, p: L.p, ss: a, se: b, as: L.s, ae: L.e };
  }

  // Shortest chain through every page read so far (breadth-first over the links those pages contain).
  shortest() {
    const byTitle = new Map();
    for (const n of this.nodes.values()) if (n.state === 'read' && n.page) byTitle.set(n.title, n);
    const prev = new Map([[this.root, null]]);
    const queue = [this.root];
    while (queue.length) {
      const n = queue.shift();
      const hit = n.page.links.find((L) => this.isTarget(L.title));
      if (hit) {
        const chain = [{ n, L: hit }];
        for (let cur = n; prev.get(cur); cur = prev.get(cur).from) chain.unshift({ n: prev.get(cur).from, L: prev.get(cur).L });
        return chain;
      }
      for (const L of n.page.links) {
        const m = byTitle.get(this.canon(L.title));
        if (m && !prev.has(m)) { prev.set(m, { from: n, L }); queue.push(m); }
      }
    }
    return null;
  }

  win(sp, node, link) {
    if (this.done) return;
    this.done = true;
    this.found = true;
    this.abort.abort();
    const found = [];
    for (let n = node; n; n = n.parent) found.unshift(n);
    let chain = found.map((n, i) => ({ n, L: i < found.length - 1 ? found[i + 1].occ : link }));
    const tight = this.shortest();
    const tightened = tight && tight.length < chain.length ? { was: chain.length, now: tight.length, path: chain.map((c) => c.n.id) } : null;
    if (tightened) chain = tight;

    const last = chain[chain.length - 1];
    const fq = this.quote(last.n, last.L);
    this.emit('bites', {
      spider: sp.id, node: last.n.id,
      bites: [{ id: `${last.n.id}win`, p: fq.p, s: fq.ss, e: fq.se, as: fq.as, ae: fq.ae, title: this.target.title, kind: 'found' }],
    });
    const hops = chain.map(({ n, L }) => ({ node: n.id, title: n.title, url: wikiUrl(n.title), receipt: this.quote(n, L) }));
    hops.push({ node: 'dst', title: this.target.title, url: wikiUrl(this.target.title), receipt: null });
    const stats = this.snapshot();
    this.log(sp, `Bridge found: ${hops.map((h) => h.title).join(' → ')} (${hops.length - 1} links).`);
    this.emit('found', { spider: sp.id, node: node.id, hops, tightened, stats });
    this.emit('end', { found: true, hops: hops.length - 1, stats });
  }

  giveUp() {
    this.done = true;
    let best = null;
    for (const n of this.nodes.values()) if (n.state === 'read' && n !== this.root && (!best || n.est < best.est)) best = n;
    const closest = [];
    for (let n = best; n; n = n.parent) closest.unshift({ node: n.id, title: n.title, url: wikiUrl(n.title) });
    this.emit('end', { found: false, reason: this.claimed >= this.maxReads ? 'budget' : 'exhausted', closest, stats: this.snapshot() });
  }
}
