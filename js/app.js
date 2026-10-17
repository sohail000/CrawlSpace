// Director: wires the hunt engine to the panels, the controls and the address bar.
// The engine runs in this tab and talks to Wikipedia directly; there is no server behind the page.

const SITE = 'https://sohail000.github.io/CrawlSpace/';
const $ = (id) => document.getElementById(id);
const pad = (n, w) => String(n).padStart(w, '0');

// "Surprise me" takes one topic from each of two different worlds, so the pair is never trivially close.
const THEMES = [
  ['Pizza', 'Sushi', 'Coffee', 'Banana', 'Chocolate', 'Tea', 'Rice', 'Honey', 'Cheese', 'Ice cream'],
  ['Moon', 'Mars', 'Black hole', 'Jupiter', 'Aurora', "Halley's Comet", 'International Space Station'],
  ['Taylor Swift', 'The Beatles', 'Jazz', 'Elvis Presley', 'Wolfgang Amadeus Mozart', 'Beyoncé', 'K-pop'],
  ['Harry Potter', 'Sherlock Holmes', 'Spider-Man', 'Batman', 'Pokémon', 'Minecraft', 'Lego', 'Star Wars', 'Mario'],
  ['Black Death', 'Ancient Egypt', 'Vikings', 'Samurai', 'Napoleon', 'Cleopatra', 'Titanic', 'Great Wall of China', 'Eiffel Tower', 'Roman Empire'],
  ['Octopus', 'Cat', 'Dinosaur', 'Penguin', 'Honey bee', 'Shark', 'Tiger', 'Kangaroo', 'Platypus', 'Tardigrade', 'Axolotl'],
  ['Volcano', 'Coral reef', 'Tornado', 'Tsunami', 'Rainbow', 'Mount Everest', 'Antarctica', 'Amazon rainforest', 'Sahara'],
  ['Quantum mechanics', 'Bitcoin', 'Internet', 'Electricity', 'Albert Einstein', 'Leonardo da Vinci', 'Spider silk', 'Gold', 'Origami', 'Bicycle', 'Chess'],
  ['Michael Jordan', 'Olympic Games', 'FIFA World Cup', 'Serena Williams', 'Skateboarding', 'Sumo'],
];

let hunt = null;
let spiderIndex = 0;
let startedAt = 0;
let running = false;
let logCount = 0;
let speed = 1;

// ---------- Wikipedia ----------

const wiki = new Wiki({
  governor: new Governor({ concurrent: 3, perMinute: 120 }),
  onRequest(r) {
    if (r.what === 'suggest' || !running) return;
    log({ spider: null, who: 'wikipedia', level: r.limited || r.status !== 200 ? 'warn' : 'info',
      msg: `${r.what} → ${r.status || 'no answer'}${r.limited ? ' (slow down)' : ''} · ${r.kb} KB · ${r.ms} ms` });
  },
});

// ---------- panels ----------

const specimen = new Specimen({
  pane: $('spec-pane'), scroller: $('spec-scroll'), article: $('spec-article'), canvas: $('spec-canvas'),
  title: $('spec-title'), url: $('spec-url'), meta: $('spec-meta'), follow: $('spec-follow'), empty: $('spec-empty'),
}, {});

const web = new WebView($('web'), $('tip'), {
  onSelect(node) { web.selected = node; specimen.pin(node); },
  onPlay(ev, agent) {
    const node = ev.node ? web.nodes.get(ev.node) : null;
    if (ev.type === 'page' && node) specimen.onPage(node, agent);
    if (ev.type === 'bites' && node) { node.judged = true; specimen.onBites(node, agent); }
  },
  onGlobal(ev) {
    if (ev.type === 'ends') showEnds(ev);
    if (ev.type === 'found') showBridge(ev);
    if (ev.type === 'end') finish(ev);
  },
});

function setPhase(text, live = false) {
  $('phase').textContent = text;
  $('phase').classList.toggle('live', live);
}

// ---------- the bridge (result) ----------

function shareUrl(from, to) {
  const base = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : SITE;
  return `${base}#${hashPart(from)}/${hashPart(to)}`;
}

function chainText(ev) {
  const s = ev.stats;
  const titles = ev.hops.map((h) => h.title);
  return `${titles.join(' → ')}\n${titles.length - 1} link${titles.length === 2 ? '' : 's'}, found live on Wikipedia by ${s.hunters} spiders after reading ${s.reads} page${s.reads === 1 ? '' : 's'}.\n${shareUrl(titles[0], titles[titles.length - 1])}`;
}

function showBridge(ev) {
  const s = ev.stats;
  const hops = ev.hops;
  const n = hops.length - 1;
  const chain = hops.map((h, i) => `<span class="${i === 0 ? 'from' : i === n ? 'to' : ''}">${esc(h.title)}</span>`).join('<i>→</i>');
  const steps = hops.map((h, i) => {
    const r = h.receipt;
    const quote = r ? `<blockquote class="rc" data-i="${i}" title="Show this sentence on the page">${esc(r.text.slice(0, r.s))}<mark>${esc(r.text.slice(r.s, r.e))}</mark>${esc(r.text.slice(r.e))}</blockquote>` : '';
    return `<li class="${i === 0 ? 'from' : i === n ? 'to' : ''}"><a class="t" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a>${quote}</li>`;
  }).join('');
  $('trail').innerHTML = `
    <div class="trail-head">
      <div class="chain">${chain}</div>
      <div class="facts">${n} link${n === 1 ? '' : 's'} · ${s.reads} page${s.reads === 1 ? '' : 's'} read · ${(s.ms / 1000).toFixed(1)}s · ${s.requests} requests to Wikipedia${ev.tightened ? ` · pulled taut from ${ev.tightened.was} to ${ev.tightened.now} links` : ''}</div>
    </div>
    <ol class="hops">${steps}</ol>
    <div class="share">
      <button type="button" class="primary" data-act="copy-text">Copy the chain</button>
      <button type="button" data-act="copy-link">Copy link</button>
      ${navigator.share ? '<button type="button" data-act="share">Share…</button>' : ''}
      <button type="button" data-act="again">Surprise me again</button>
      <span class="copied" id="copied" hidden>Copied</span>
    </div>`;
  $('trail').dataset.text = chainText(ev);
  $('trail').dataset.url = shareUrl(hops[0].title, hops[n].title);
  $('trail').hops = hops;
  selectTab('trail');
  const finder = web.nodes.get(hops[n - 1].node);
  if (finder?.paragraphs) specimen.settle(finder);
  setPhase(`bridge found · ${n} link${n === 1 ? '' : 's'}`);
}

$('trail').addEventListener('click', async (e) => {
  const rc = e.target.closest('.rc');
  if (rc) {
    const h = $('trail').hops?.[+rc.dataset.i];
    const node = h && web.nodes.get(h.receipt.node);
    if (node?.paragraphs) { web.selected = node; specimen.focusReceipt(node, h.receipt); }
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'copy-text') flashCopied(await copyText($('trail').dataset.text));
  if (act === 'copy-link') flashCopied(await copyText($('trail').dataset.url));
  if (act === 'share') navigator.share({ title: 'Crawlspace', text: $('trail').dataset.text.split('\n').slice(0, 2).join('\n'), url: $('trail').dataset.url }).catch(() => {});
  if (act === 'again') surprise();
});

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

function flashCopied(ok) {
  const el = $('copied');
  if (!el) return;
  el.textContent = ok ? 'Copied' : 'Copy failed';
  el.hidden = false;
  clearTimeout(flashCopied.t);
  flashCopied.t = setTimeout(() => { el.hidden = true; }, 1600);
}

function showEnds(ev) {
  const { source, target } = ev;
  $('from').value = source.title;
  $('to').value = target.title;
  writeHash(source.title, target.title);
  document.title = `${source.title} → ${target.title} · Crawlspace`;
  const notes = [source.note, target.note].filter(Boolean);
  for (const n of notes) log({ spider: null, msg: n, level: 'warn' });
  $('trail').innerHTML = `<p class="none">Hunting a way from <b class="from">${esc(source.title)}</b> to <b class="to">${esc(target.title)}</b>…${notes.map((n) => `<br><span class="note">${esc(n)}</span>`).join('')}</p>`;
}

function finish(ev) {
  running = false;
  $('go').hidden = false; $('stop').hidden = true;
  stats(ev.stats || {});
  if (ev.stats?.ms) $('h-time').textContent = (ev.stats.ms / 1000).toFixed(1); // the hunt's own clock, as in the bridge summary
  if (ev.found) return;
  if (ev.reason === 'stopped') { setPhase('stopped'); appendNote('Stopped. The spiders came home.'); return; }
  if (ev.reason === 'error') { setPhase('error'); return; }
  setPhase('no bridge');
  const closest = ev.closest || [];
  appendNote(`No way across within ${ev.stats?.reads || 0} pages${closest.length > 1 ? `. Closest approach: ${closest.map((c) => c.title).join(' → ')}` : ''}. Try a better-known target, or swap the ends.`);
}

function appendNote(text) {
  const p = document.createElement('p');
  p.className = 'none';
  p.textContent = text;
  $('trail').append(p);
}

function showError(message) {
  setPhase('error');
  $('trail').innerHTML = `<p class="none bad">${esc(message)}</p>`;
  selectTab('trail');
  log({ spider: null, msg: message, level: 'warn' });
}

// ---------- log ----------

function log(ev) {
  const list = $('log');
  const a = ev.spider ? web.agents.get(ev.spider) : null;
  const li = document.createElement('li');
  const time = new Date().toTimeString().slice(0, 8);
  const who = a ? a.name : ev.who || 'hunt';
  li.innerHTML = `<span class="t">${time}</span><span class="who" style="color:${a ? a.color : ev.who === 'wikipedia' ? 'var(--dim)' : 'var(--text)'}">${esc(who)}</span><span class="${ev.level === 'warn' ? 'w' : ''}">${esc(ev.msg)}</span>`;
  const pane = list.parentElement;
  const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
  list.append(li);
  while (list.children.length > 600) list.firstChild.remove();
  if (atBottom) pane.scrollTop = pane.scrollHeight;
  $('c-log').textContent = ++logCount;
}

// ---------- HUD ----------

let lastStats = {};
function stats(s) {
  lastStats = { ...lastStats, ...s };
  const x = lastStats;
  $('h-reads').textContent = pad(x.reads || 0, 2);
  $('h-links').textContent = (x.links || 0).toLocaleString('en');
  $('h-mapped').textContent = (x.mapped || 0).toLocaleString('en');
  $('h-req').textContent = x.requests || 0;
}

setInterval(() => { if (running) $('h-time').textContent = ((Date.now() - startedAt) / 1000).toFixed(1); }, 100);

// ---------- tabs ----------

function selectTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('.tabpane')) p.hidden = p.dataset.pane !== name;
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => selectTab(b.dataset.tab));

// ---------- running a hunt ----------

function handle(type, data) {
  const ev = { type, ...data };
  switch (type) {
    case 'hunt': resetAll(ev); return;
    case 'spider': web.addSpider(ev, ev.role === 'sentinel' ? 0 : spiderIndex++); return;
    case 'stats': stats(ev); return;
    case 'log': log(ev); return;
    case 'error': showError(ev.message); return;
    default: web.push(ev);
  }
}

function resetAll(ev) {
  spiderIndex = 0; logCount = 0; lastStats = {};
  web.reset();
  specimen.reset();
  $('log').innerHTML = '';
  $('c-log').textContent = '0';
  $('trail').innerHTML = '<p class="none">Finding both pages on Wikipedia…</p>';
  $('intro').hidden = true;
  $('h-max').textContent = ev.maxReads;
  $('h-time').textContent = '0.0';
  stats({ reads: 0, links: 0, mapped: 0, requests: 0 });
  setPhase('hunting', true);
  $('go').hidden = true; $('stop').hidden = false;
  selectTab('trail');
}

function start(from, to) {
  from = String(from || '').trim();
  to = String(to || '').trim();
  if (!from || !to) return;
  if (hunt && !hunt.done) hunt.stop();
  $('from').value = from;
  $('to').value = to;
  writeHash(from, to);
  const mine = new Hunt({ from, to, wiki, hunters: 3, maxReads: 50, emit: (type, data) => { if (hunt === mine) handle(type, data); } });
  mine.pace = (id) => web.whenIdle(id);
  hunt = mine;
  running = true;
  startedAt = Date.now();
  mine.run();
}

function surprise() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const i = Math.floor(Math.random() * THEMES.length);
  let j = i;
  while (j === i) j = Math.floor(Math.random() * THEMES.length);
  start(pick(THEMES[i]), pick(THEMES[j]));
}

// ---------- address bar: #From/To ----------

function hashPart(t) { return encodeURIComponent(String(t).replace(/ /g, '_')); }

function writeHash(a, b) {
  const h = `#${hashPart(a)}/${hashPart(b)}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

function readHash() {
  const parts = location.hash.slice(1).split('/');
  if (parts.length !== 2) return null;
  try {
    const [a, b] = parts.map((s) => decodeURIComponent(s).replace(/_/g, ' ').trim());
    return a && b ? [a, b] : null;
  } catch { return null; }
}

window.addEventListener('hashchange', () => {
  const h = readHash();
  if (h && !(running && h[0] === $('from').value && h[1] === $('to').value)) start(h[0], h[1]);
});

// ---------- controls ----------

$('hunt').addEventListener('submit', (e) => { e.preventDefault(); start($('from').value, $('to').value); });
$('stop').addEventListener('click', () => hunt?.stop());
$('swap').addEventListener('click', () => { const a = $('from').value; $('from').value = $('to').value; $('to').value = a; });
$('surprise').addEventListener('click', surprise);
$('speed').addEventListener('click', () => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  web.speed = specimen.speed = speed;
  $('speed').textContent = `${speed}×`;
});
for (const b of document.querySelectorAll('[data-from]')) b.addEventListener('click', () => start(b.dataset.from, b.dataset.to));

// Title suggestions while typing (Wikipedia's own prefix search).
for (const [input, list] of [[$('from'), $('sugg-from')], [$('to'), $('sugg-to')]]) {
  let timer = null, last = '';
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2 || q === last || /^(https?:\/\/|www\.)|\.\w+\//i.test(q)) return; // links are resolved when the hunt starts
    timer = setTimeout(async () => {
      last = q;
      try {
        const found = await wiki.suggest(q);
        list.innerHTML = found.map((x) => `<option value="${esc(x.title)}">${esc(x.description)}</option>`).join('');
      } catch {}
    }, 280);
  });
}

// ---------- frame loop ----------

let lastFrame = performance.now();
function frame(ts) {
  const dt = Math.min(0.05, (ts - lastFrame) / 1000);
  lastFrame = ts;
  web.frame(dt);
  specimen.frame(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// A shared link (#From/To) starts its hunt straight away.
const fromHash = readHash();
if (fromHash) { $('from').value = fromHash[0]; $('to').value = fromHash[1]; setTimeout(() => start(fromHash[0], fromHash[1]), 600); }

// Handy for poking at the live state from devtools.
window.crawlspace = { web, specimen, wiki, get hunt() { return hunt; } };
