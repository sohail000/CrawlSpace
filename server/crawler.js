// One crawl run: a frontier of URLs, a few spider workers, and a stream of events
// describing exactly what each spider is doing. The UI animates these events; it never invents any.
import { createHash } from 'node:crypto';
import { robotsAllows, reserveSlot, fetchPage, sleep, USER_AGENT } from './fetcher.js';
import { extract, normalizeUrl } from './extract.js';
import { readPage, heuristicRead, weave, aiEnabled, skim, topicPresent, shortlistLinks, PROVIDER, READER_MODEL, WEAVER_MODEL, READ_BUDGET_CHARS, LINK_BUDGET } from './brain.js';

const MODEL_NAME = { gemini: 'Gemma', claude: 'Claude', heuristic: 'Keywords' }[PROVIDER];

const NAMES = ['Argiope', 'Phidippus', 'Hogna', 'Misumena', 'Salticus', 'Dolomedes'];

export class Run {
  constructor(opts, emit) {
    this.id = Date.now().toString(36);
    this.question = opts.question;
    this.seeds = opts.seeds;
    this.budget = opts.budget;
    this.spiderCount = opts.spiders;
    this.maxDepth = opts.maxDepth;
    this.pace = opts.pace;
    this.hostGap = opts.hostGap;
    this.emit = emit;
    this.ai = aiEnabled() && opts.brain !== 'keywords';
    this.abort = new AbortController();
    this.stopped = false;
    this.frontier = [];
    this.seen = new Set();
    this.hashes = new Set();
    this.findings = [];
    this.nid = 0;
    this.claimed = 0;
    this.active = 0;
    this.stats = { pages: 0, bites: 0, failed: 0, frontier: 0, tokensIn: 0, tokensOut: 0, usd: 0 };
  }

  log(spider, msg, level = 'info') { this.emit('log', { spider, msg, level }); }
  pushStats() { this.stats.frontier = this.frontier.length; this.emit('stats', { ...this.stats }); }
  addCost(c) { if (!c) return; this.stats.tokensIn += c.tokensIn; this.stats.tokensOut += c.tokensOut; this.stats.usd += c.usd; }

  enqueue(items, spider) {
    const added = [];
    for (const it of items) {
      if (this.seen.has(it.url)) continue;
      this.seen.add(it.url);
      const node = { id: 'n' + ++this.nid, ...it };
      this.frontier.push(node);
      added.push(node);
    }
    if (added.length) this.emit('frontier', { spider, items: added });
    return added;
  }

  popBest() {
    if (!this.frontier.length) return null;
    let bi = 0;
    for (let i = 1; i < this.frontier.length; i++) if (this.frontier[i].priority > this.frontier[bi].priority) bi = i;
    return this.frontier.splice(bi, 1)[0];
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.log(null, 'Stop requested: spiders are heading home.');
  }

  kill() { this.stopped = true; this.killed = true; this.abort.abort(); }

  async start() {
    this.emit('run', {
      id: this.id, question: this.question, budget: this.budget, spiders: this.spiderCount, maxDepth: this.maxDepth,
      mode: this.ai ? PROVIDER : 'heuristic', readerModel: READER_MODEL, weaverModel: WEAVER_MODEL, userAgent: USER_AGENT,
    });
    const spiders = NAMES.slice(0, this.spiderCount).map((name, i) => ({ id: 's' + i, name }));
    for (const s of spiders) this.emit('spider', s);
    this.log(null, this.ai ? `${MODEL_NAME} mode: reader ${READER_MODEL}, weaver ${WEAVER_MODEL}. Each page is read by the model, so expect a wait per page.` : aiEnabled() ? 'Keyword brain: instant, spiders judge by keyword overlap (no model calls).' : 'Heuristic mode: no API key found, so spiders judge by keyword overlap.');

    if (this.seeds.length) {
      this.enqueue(this.seeds.map((url) => ({ url, parent: 'hub', depth: 0, priority: 2, score: 100, anchor: 'seed', why: 'you gave this seed' })), null);
    } else {
      await this.balloon(spiders[0]);
    }
    this.pushStats();

    await Promise.all(spiders.map((s, i) => sleep(i * 350).then(() => this.worker(s))));
    if (this.killed) return;

    this.emit('crawl-end', { reason: this.stopped ? 'stopped' : this.claimed >= this.budget ? 'budget' : 'exhausted' });
    await this.weave();
  }

  async balloon(sp) {
    // No seed: drift out on a search thread. Wikipedia's public search API is free and bot-friendly.
    this.emit('state', { spider: sp.id, state: 'balloon', msg: 'ballooning: searching Wikipedia' });
    const api = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=4&srsearch=${encodeURIComponent(this.question)}`;
    try {
      const res = await fetch(api, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      const hits = (data.query?.search || []).map((h) => ({
        url: normalizeUrl('https://en.wikipedia.org/wiki/' + encodeURIComponent(h.title.replace(/ /g, '_'))),
        title: h.title,
      }));
      this.emit('balloon', { spider: sp.id, query: this.question, results: hits });
      this.log(sp.id, `Ballooned to ${hits.length} landing spots: ${hits.map((h) => h.title).join(', ') || 'none'}`);
      this.enqueue(hits.map((h, i) => ({ url: h.url, parent: 'hub', depth: 0, priority: 2 - i * 0.1, score: 100 - i * 5, anchor: h.title, why: 'search landing spot' })), sp.id);
    } catch (e) {
      this.log(sp.id, `Ballooning failed: ${e.message}. Give a seed URL instead.`, 'warn');
    }
  }

  async worker(sp) {
    let idle = false;
    while (!this.stopped) {
      if (this.claimed >= this.budget) break;
      const item = this.popBest();
      if (!item) {
        if (this.active === 0) break;
        if (!idle) { this.emit('state', { spider: sp.id, state: 'idle', msg: 'waiting for new threads' }); idle = true; }
        await sleep(400);
        continue;
      }
      idle = false;
      this.claimed++;
      this.active++;
      try {
        await this.visit(sp, item);
      } catch (e) {
        if (this.killed) return;
        this.stats.failed++;
        this.emit('fail', { spider: sp.id, node: item.id, kind: 'error', reason: e.name === 'TimeoutError' ? 'timed out' : e.message.slice(0, 120) });
        this.log(sp.id, `Fell off ${item.url}: ${e.message}`, 'warn');
      } finally {
        this.active--;
      }
      this.pushStats();
      if (!this.stopped && this.claimed < this.budget) {
        this.emit('state', { spider: sp.id, state: 'rest', msg: 'resting (politeness)' });
        await sleep(this.pace);
      }
    }
    if (!this.killed) this.emit('state', { spider: sp.id, state: 'home', msg: 'heading home' });
  }

  async visit(sp, item) {
    const host = new URL(item.url).host;
    this.emit('claim', { spider: sp.id, node: item.id, url: item.url, parent: item.parent, depth: item.depth });
    this.emit('state', { spider: sp.id, node: item.id, state: 'robots', msg: `checking ${host}/robots.txt` });

    if (!(await robotsAllows(item.url))) {
      this.stats.failed++;
      this.emit('fail', { spider: sp.id, node: item.id, kind: 'robots', reason: 'robots.txt says keep out' });
      this.log(sp.id, `robots.txt disallows ${item.url}`, 'warn');
      return;
    }

    const wait = reserveSlot(host, this.hostGap);
    if (wait > 200) {
      this.emit('state', { spider: sp.id, node: item.id, state: 'wait', msg: `waiting ${(wait / 1000).toFixed(1)}s for ${host}`, ms: wait });
      await sleep(wait);
    }
    if (this.killed) return;

    this.emit('state', { spider: sp.id, node: item.id, state: 'fetch', msg: `GET ${host}` });
    const res = await fetchPage(item.url, { signal: this.abort.signal });
    this.emit('fetched', { spider: sp.id, node: item.id, status: res.status, ms: res.ms, bytes: res.bytes, finalUrl: res.finalUrl });
    this.log(sp.id, `GET ${item.url} -> ${res.status} in ${res.ms}ms${res.bytes ? `, ${Math.round(res.bytes / 1024)}KB` : ''}`);

    if (res.status >= 400 || !res.html) {
      this.stats.failed++;
      const kind = res.status >= 400 ? 'http' : 'type';
      this.emit('fail', { spider: sp.id, node: item.id, kind, reason: kind === 'http' ? `HTTP ${res.status}` : `not a web page (${res.type.split(';')[0] || 'unknown'})` });
      return;
    }

    const finalUrl = normalizeUrl(res.finalUrl) || item.url;
    if (finalUrl !== item.url) {
      if (this.seen.has(finalUrl)) {
        this.stats.failed++;
        this.emit('fail', { spider: sp.id, node: item.id, kind: 'dup', reason: 'redirects to a page already crawled' });
        return;
      }
      this.seen.add(finalUrl);
    }

    const page = extract(res.html, finalUrl);
    const hash = createHash('sha1').update(page.paragraphs.slice(0, 30).map((p) => p.t).join('\n')).digest('hex');
    if (!page.paragraphs.length) {
      this.stats.failed++;
      this.emit('fail', { spider: sp.id, node: item.id, kind: 'empty', reason: 'no readable text (maybe needs JavaScript)' });
      return;
    }
    if (this.hashes.has(hash)) {
      this.stats.failed++;
      this.emit('fail', { spider: sp.id, node: item.id, kind: 'dup', reason: 'same text as a page already crawled' });
      return;
    }
    this.hashes.add(hash);

    // Skim first: the spider keeps the opening and the paragraphs that touch the question.
    // What the specimen pane shows is exactly what the model reads.
    const paragraphs = skim(this.question, page.paragraphs, READ_BUDGET_CHARS);
    const links = this.ai ? shortlistLinks(this.question, page.links, LINK_BUDGET) : page.links;
    this.stats.pages++;
    this.emit('page', { spider: sp.id, node: item.id, url: finalUrl, title: page.title, paragraphs, total: page.paragraphs.length, linkCount: page.links.length });

    // Off-topic pages (found via links, not seeds) don't get a slow model read.
    if (this.ai && item.depth > 0 && item.anchor !== 'seed' && !topicPresent(this.question, page.title, page.paragraphs)) {
      this.emit('state', { spider: sp.id, node: item.id, state: 'read', msg: 'skimmed: off-topic, skipping' });
      const summary = `Skimmed ${page.paragraphs.length} paragraphs: none mention the question's key terms, so no ${MODEL_NAME} read.`;
      this.emit('bites', { spider: sp.id, node: item.id, relevance: 0, summary, bites: [], by: 'skim' });
      this.emit('links', { spider: sp.id, node: item.id, considered: page.links.length, chosen: [], depthCapped: false });
      this.log(sp.id, `Skipped "${page.title}": off-topic on a skim.`);
      return;
    }
    this.emit('state', { spider: sp.id, node: item.id, state: 'read', msg: `${MODEL_NAME} reading ${paragraphs.length} paragraphs` });

    let verdict;
    try {
      verdict = await readPage({
        keywords: !this.ai,
        question: this.question, title: page.title, pageUrl: finalUrl, paragraphs, links, signal: this.abort.signal,
        onWait: () => this.emit('state', { spider: sp.id, node: item.id, state: 'read', msg: `waiting for a free ${MODEL_NAME} slot` }),
        onRetry: (why) => {
          this.emit('state', { spider: sp.id, node: item.id, state: 'read', msg: `${MODEL_NAME} busy (${why})` });
          this.log(sp.id, `${MODEL_NAME} hiccup on "${page.title}": ${why}`, 'warn');
        },
      });
    } catch (e) {
      if (this.killed) throw e;
      this.log(sp.id, `${MODEL_NAME} could not read this page (${e.message.slice(0, 120)}). Falling back to keywords.`, 'warn');
      verdict = heuristicRead({ question: this.question, paragraphs, links, pageUrl: finalUrl });
    }
    this.addCost(verdict.cost);

    const bites = verdict.bites.map((b, i) => ({ ...b, id: `${item.id}b${i}` }));
    for (const b of bites) {
      this.findings.push({ node: item.id, url: finalUrl, title: page.title, relevance: verdict.relevance, fact: b.fact, quote: b.quote, bite: b.id });
    }
    this.stats.bites += bites.length;
    this.emit('bites', { spider: sp.id, node: item.id, relevance: verdict.relevance, summary: verdict.summary, bites, by: verdict.by });
    this.log(sp.id, `Relevance ${verdict.relevance}. Bit ${bites.length} passage${bites.length === 1 ? '' : 's'} from "${page.title}".`);

    this.emit('state', { spider: sp.id, node: item.id, state: 'judge', msg: `judging ${page.links.length} links` });
    const chosen = [];
    if (item.depth + 1 <= this.maxDepth) {
      let picks = verdict.links, minScore = verdict.by === 'heuristic' ? 1 : 25;
      if (!picks.length && verdict.by !== 'heuristic' && verdict.relevance >= 30 && links.length) {
        picks = heuristicRead({ question: this.question, paragraphs: [], links, pageUrl: finalUrl }).links
          .map((l) => ({ ...l, why: `keyword pick (${MODEL_NAME} chose none): ${l.why}` }));
        minScore = 1;
        this.log(sp.id, `${MODEL_NAME} picked no links on "${page.title}", so keyword scoring chose ${picks.length}.`, 'warn');
      }
      for (const l of picks) {
        const link = links[l.id];
        if (!link || l.score < minScore) continue;
        chosen.push({
          url: link.url, parent: item.id, depth: item.depth + 1, anchor: link.text, score: l.score, why: l.why,
          priority: (l.score / 100) * (0.35 + 0.65 * (verdict.relevance / 100)) * Math.pow(0.85, item.depth + 1),
        });
      }
    }
    const added = this.enqueue(chosen, sp.id);
    this.emit('links', { spider: sp.id, node: item.id, considered: page.links.length, chosen: added.map((a) => a.id), depthCapped: item.depth + 1 > this.maxDepth });
  }

  async weave() {
    const ranked = [...this.findings].sort((a, b) => b.relevance - a.relevance).slice(0, 40);
    if (!ranked.length) {
      this.emit('weave-start', { sources: [] });
      this.emit('weave-text', { text: 'The spiders came home empty: no page had evidence for this question. Try a seed URL closer to the topic, or rephrase.' });
      this.emit('end', { stats: { ...this.stats } });
      return;
    }
    const findings = ranked.map((f, i) => ({ ...f, n: i + 1 }));
    this.emit('weave-start', { sources: findings.map((f) => ({ n: f.n, node: f.node, bite: f.bite, url: f.url, title: f.title })) });
    try {
      const { cost } = await weave({
        keywords: !this.ai,
        question: this.question,
        findings,
        signal: this.abort.signal,
        onText: (text) => this.emit('weave-text', { text }),
        onRetry: (why) => this.log(null, `${MODEL_NAME} hiccup while weaving: ${why}`, 'warn'),
      });
      this.addCost(cost);
    } catch (e) {
      if (this.killed) return;
      this.emit('weave-text', { text: `\n\n(Weaving failed: ${e.message})` });
    }
    this.pushStats();
    this.emit('end', { stats: { ...this.stats } });
  }
}
