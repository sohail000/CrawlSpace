// Director: receives the server's event stream and hands each event to the panels
// at the moment the matching spider acts it out.
import { WebView, hostOf } from './web.js';
import { Specimen } from './specimen.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n, w) => String(n).padStart(w, '0');

let runInfo = null;
let spiderIndex = 0;
let weaveText = '';
let weaveSources = [];
let weaving = false;
let findings = 0;
let defaultsTouched = false;
let hasModel = false;
for (const id of ['budget', 'spiders']) document.getElementById(id).addEventListener('change', () => { defaultsTouched = true; });

// ---------- panels ----------

const specimen = new Specimen({
  pane: $('spec-pane'), scroller: $('spec-scroll'), article: $('spec-article'), canvas: $('spec-canvas'),
  title: $('spec-title'), url: $('spec-url'), meta: $('spec-meta'), rel: $('spec-rel'), follow: $('spec-follow'), empty: $('spec-empty'),
}, {});

const web = new WebView($('web'), $('tip'), {
  onSelect(node) { web.selected = node; specimen.pin(node); },
  onPlay(ev, agent) {
    const node = ev.node ? web.nodes.get(ev.node) : null;
    if (ev.type === 'page' && node) specimen.onPage(node, agent);
    if (ev.type === 'bites' && node) { specimen.onBites(node, agent); addFindings(node, ev.bites, agent); }
  },
  onGlobal(ev) {
    if (ev.type === 'crawl-end') setPhase(ev.reason === 'stopped' ? 'stopped · weaving' : 'crawl done · weaving', true);
    if (ev.type === 'weave-start') startWeave(ev.sources);
    if (ev.type === 'weave-text') { weaveText += ev.text; renderOrb(); }
    if (ev.type === 'end') { weaving = false; renderOrb(); setPhase('web complete'); $('stop').disabled = true; }
  },
});

function setPhase(text, live = false) {
  $('phase').textContent = text;
  $('phase').classList.toggle('live', live);
}

// ---------- larder ----------

function addFindings(node, bites, agent) {
  const list = $('larder');
  if (!bites.length) return;
  list.querySelector('.none')?.remove();
  for (const b of bites) {
    findings++;
    const li = document.createElement('li');
    li.className = 'f';
    li.style.setProperty('--c', agent.color);
    li.innerHTML = `<div class="fact">${esc(b.fact)}</div>${b.fact.trim() === b.quote.trim() ? '' : `<div class="quote">“${esc(b.quote)}”</div>`}<div class="src"><b>${esc(agent.name)}</b> · ${esc(hostOf(node.url))} · relevance ${node.relevance}</div>`;
    li.addEventListener('click', () => { web.selected = node; specimen.focusBite(node, b.id); });
    list.prepend(li);
  }
  $('c-larder').textContent = findings;
}

// ---------- answer (orb) ----------

function startWeave(sources) {
  weaving = true;
  weaveText = '';
  weaveSources = sources;
  selectTab('orb');
  renderOrb();
}

// Citations: [3], [2][5], and grouped forms some models write, like [1, 6, 7].
const CITE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const citedNumbers = (text) => new Set([...text.matchAll(CITE)].flatMap((m) => m[1].split(',').map((n) => +n.trim())));

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\$\\beta\$/g, 'β')
    .replace(CITE, (m, list) => list.split(',').map((n) => n.trim())
      .map((n) => `<a class="cite" data-n="${n}" role="button" tabindex="0">[${n}]</a>`).join(''));
}

function renderOrb() {
  const el = $('orb');
  if (!weaveSources.length && !weaveText) return;
  // Group consecutive "- " lines into lists; everything else into paragraphs.
  let html = '', para = [], items = [];
  const flushPara = () => { if (para.length) html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; };
  const flushList = () => { if (items.length) html += `<ul>${items.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`; items = []; };
  for (const line of weaveText.trim().split('\n')) {
    const bullet = line.match(/^\s*[-*•] (.*)$/);
    if (bullet) { flushPara(); items.push(bullet[1]); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  if (weaving) html = html.replace(/(<\/(p|li)>)(?!.*<\/(p|li)>)/s, '<span class="caret"></span>$1') || '<span class="caret"></span>';
  const cited = citedNumbers(weaveText);
  const srcs = weaveSources.filter((s) => cited.has(s.n));
  if (srcs.length) {
    html += `<div class="sources">SOURCES<ol>${srcs.map((s) => `<li value="${s.n}"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a> · ${esc(hostOf(s.url))}</li>`).join('')}</ol></div>`;
  }
  el.innerHTML = html || '<p class="none">The orb-weaver is gathering silk…</p>';
}

$('orb').addEventListener('click', (e) => {
  const c = e.target.closest('.cite');
  if (!c) return;
  const src = weaveSources.find((s) => s.n === +c.dataset.n);
  const node = src && web.nodes.get(src.node);
  if (node) { web.selected = node; specimen.focusBite(node, src.bite); }
});

// ---------- log ----------

function log(ev) {
  const list = $('log');
  const a = ev.spider ? web.agents.get(ev.spider) : null;
  const li = document.createElement('li');
  const time = new Date(ev.t || Date.now()).toTimeString().slice(0, 8);
  li.innerHTML = `<span class="t">${time}</span><span class="who" style="color:${a ? a.color : 'var(--text)'}">${esc(a ? a.name : 'crawl')}</span><span class="${ev.level === 'warn' ? 'w' : ''}">${esc(ev.msg)}</span>`;
  list.append(li);
  while (list.children.length > 500) list.firstChild.remove();
  const pane = list.parentElement;
  if (pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80) pane.scrollTop = pane.scrollHeight;
}

// ---------- HUD ----------

function stats(s) {
  $('h-pages').textContent = pad(s.pages, 2);
  $('h-bites').textContent = pad(s.bites, 3);
  $('h-queue').textContent = pad(s.frontier, 3);
  $('h-failed').textContent = pad(s.failed, 2);
  const tok = s.tokensIn + s.tokensOut;
  $('h-tokens').textContent = tok > 999 ? (tok / 1000).toFixed(1) + 'k' : tok;
  $('h-cost').textContent = '$' + s.usd.toFixed(2);
}

// ---------- tabs ----------

function selectTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('.tabpane')) p.hidden = p.dataset.pane !== name;
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => selectTab(b.dataset.tab));

// ---------- the event stream ----------

function resetAll(ev) {
  runInfo = ev;
  spiderIndex = 0; findings = 0; weaveText = ''; weaveSources = []; weaving = false;
  web.reset(ev.question);
  specimen.reset();
  $('larder').innerHTML = '<li class="none">Bitten passages pile up here, each tied to its source.</li>';
  $('c-larder').textContent = '0';
  $('orb').innerHTML = '<p class="none">When the crawl ends, the orb-weaver writes a cited answer from the larder.</p>';
  $('log').innerHTML = '';
  $('intro').hidden = true;
  $('h-budget').textContent = pad(ev.budget, 2);
  $('h-spiders').textContent = pad(ev.spiders, 2);
  stats({ pages: 0, bites: 0, frontier: 0, failed: 0, tokensIn: 0, tokensOut: 0, usd: 0 });
  setMode(ev.mode, ev.readerModel);
  setPhase('crawling', true);
  $('stop').disabled = false;
  selectTab('larder');
}

function setMode(provider, model) {
  const m = $('mode');
  const ai = provider === 'gemini' || provider === 'claude';
  m.textContent = ai ? `${provider === 'gemini' ? 'GEMMA' : 'CLAUDE'} · ${model}` : hasModel ? 'KEYWORDS · instant, no model' : 'HEURISTIC · no API key';
  m.title = ai ? `Pages are read and links judged by ${model}.` : 'No API key found: spiders judge by keyword overlap. Add GEMINI_API_KEY or ANTHROPIC_API_KEY to .env.';
  m.classList.toggle('ai', ai);
  $('h-cost-wrap').hidden = !ai;
  $('h-cost-sep').hidden = $('h-cost').hidden = provider === 'gemini'; // Gemma on the Gemini API has no per-token price
}

function handle(ev) {
  switch (ev.type) {
    case 'hello':
      if (!runInfo) setMode(ev.provider, ev.readerModel);
      hasModel = ev.ai;
      if (ev.ai) { $('brain-wrap').hidden = false; $('brain-model').textContent = ev.provider === 'gemini' ? 'Gemma (slow, real AI)' : 'Claude'; }
      if (ev.provider === 'gemini' && !defaultsTouched && $('brain').value === 'model') { $('budget').value = '10'; $('spiders').value = '2'; } // free-tier Gemma is slow and rate-limited
      return;
    case 'run': resetAll(ev); return;
    case 'spider': web.addSpider(ev, spiderIndex++); return;
    case 'stats': stats(ev); return;
    case 'log': log(ev); return;
    case 'error': log({ ...ev, msg: ev.message, level: 'warn' }); setPhase('error'); return;
    default: web.push(ev);
  }
}

function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => handle(JSON.parse(m.data));
  es.onerror = () => { $('mode').textContent = 'reconnecting…'; };
}
connect();

// ---------- controls ----------

$('hunt').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('go').disabled = true;
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: $('q').value, seeds: $('seeds').value, budget: $('budget').value, spiders: $('spiders').value, depth: $('depth').value, brain: $('brain').value }),
    });
    if (!res.ok) alert((await res.json()).error || 'Could not start the crawl.');
  } catch {
    alert('The Crawlspace server is not reachable. Is `npm start` running?');
  } finally {
    $('go').disabled = false;
  }
});

$('stop').addEventListener('click', async () => {
  $('stop').disabled = true;
  setPhase('stopping', true);
  await fetch('/api/stop', { method: 'POST' }).catch(() => {});
});

for (const b of document.querySelectorAll('[data-q]')) {
  b.addEventListener('click', () => { $('q').value = b.dataset.q; $('q').focus(); });
}

// ---------- frame loop ----------

let last = performance.now();
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;
  web.frame(dt);
  specimen.frame(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the live state from devtools.
window.crawlspace = { web, specimen };
