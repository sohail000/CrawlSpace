// Director: load a page onto the stage, show what each spider would catch, then release them.

const SPIDERS = [
  { kind: 'links', name: 'Orb-weaver', short: 'Links', species: 'orb', color: '#ffcc4d', verb: 'anchoring link', job: 'Every link on the page, across the site if you like, and which ones are broken.' },
  { kind: 'tables', name: 'Funnel-web', short: 'Tables', species: 'funnel', color: '#ff7a59', verb: 'wrapping table', job: 'Every data table, cleaned up, as CSV or straight into Excel.' },
  { kind: 'regex', name: 'Jumping spider', short: 'Patterns', species: 'jumping', color: '#4ade80', verb: 'biting match', job: 'Emails, phone numbers, prices, dates, or any pattern you give it.' },
  { kind: 'images', name: 'Huntsman', short: 'Images', species: 'huntsman', color: '#38bdf8', verb: 'tagging image', job: 'Every image, with its size, and which ones lack alt text.' },
  { kind: 'text', name: 'Reader', short: 'Text', species: 'reader', color: '#a78bfa', verb: 'reading block', job: 'The main text without menus or ads, as clean Markdown.' },
];
const $ = (id) => document.getElementById(id);

const stage = new Stage({ wrap: $('stage'), frame: $('frame'), canvas: $('overlay'), caption: $('caption') });
const results = new Results({ tabs: $('rtabs'), body: $('rbody') }, SPIDERS, {
  onShow(kind, item) {
    if (!stage.doc || (item.page && item.page !== stage.page?.url)) { if (item.page) window.open(item.page, '_blank', 'noopener'); return; }
    stage.flash(item.el || item.target, SPIDERS.find((s) => s.kind === kind)?.color || '#fff');
  },
  onCheckLinks: checkLinks,
});

const state = { page: null, selected: new Set(SPIDERS.map((s) => s.kind)), pattern: 'emails', running: false, stop: false };

// ---------- the dock: one card per spider ----------

function buildDock() {
  $('dock').innerHTML = SPIDERS.map((s) => `
    <label class="spider" style="--c:${s.color}" data-kind="${s.kind}">
      <input type="checkbox" checked data-kind="${s.kind}">
      <canvas width="112" height="112" data-species="${s.species}" aria-hidden="true"></canvas>
      <span class="sname"><b>${s.name}</b><em>${s.short}</em></span>
      <span class="sjob">${s.job}</span>
      <span class="scount" id="count-${s.kind}">–</span>
      ${s.kind === 'regex' ? `<span class="pattern" onclick="event.preventDefault()">
        <select id="pattern" aria-label="Pattern">${Object.entries(PATTERNS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}<option value="custom">My own pattern…</option></select>
        <input id="custom" placeholder="regex, e.g. ISBN[- ]?\\d+" hidden spellcheck="false"></span>` : ''}
    </label>`).join('');
  for (const c of $('dock').querySelectorAll('canvas')) {
    const s = SPIDERS.find((x) => x.species === c.dataset.species);
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    const body = new SpiderBody(28, 30, { color: s.color, species: s.species, scale: 1.25 });
    body.h = -Math.PI / 2 + 0.3;
    body.replant();
    body.draw(ctx, 0, 1.4);
  }
  $('dock').addEventListener('change', (e) => {
    const k = e.target.dataset.kind;
    if (k) { e.target.checked ? state.selected.add(k) : state.selected.delete(k); e.target.closest('.spider').classList.toggle('off', !e.target.checked); }
    updateRelease();
  });
  $('pattern').addEventListener('change', () => { state.pattern = $('pattern').value; $('custom').hidden = state.pattern !== 'custom'; if (!$('custom').hidden) $('custom').focus(); scan(); });
  $('custom').addEventListener('input', () => scan());
}

function customPattern() { return { source: $('custom').value.trim(), caseless: true }; }

function extract(kind, doc, url) {
  if (kind === 'links') return extractLinks(doc, url);
  if (kind === 'tables') return extractTables(doc);
  if (kind === 'regex') return state.pattern === 'custom' && !customPattern().source ? { items: [], notes: ['Type a pattern first.'] } : extractMatches(doc, state.pattern, customPattern());
  if (kind === 'images') return extractImages(doc);
  const t = extractText(doc, url);
  return { items: t.blocks, title: t.title, words: t.words, notes: [] };
}

// What each spider would catch on this page, before anyone is released.
function scan() {
  if (!stage.doc) return;
  for (const s of SPIDERS) {
    let label;
    try {
      const out = extract(s.kind, stage.doc, stage.page.url);
      const n = out.items.length;
      label = s.kind === 'links' ? `${n} links` : s.kind === 'tables' ? `${n} table${n === 1 ? '' : 's'}`
        : s.kind === 'regex' ? `${n} ${state.pattern === 'custom' ? 'matches' : PATTERNS[state.pattern].label.toLowerCase()}`
        : s.kind === 'images' ? `${n} image${n === 1 ? '' : 's'}` : `${out.words.toLocaleString()} words`;
    } catch (e) { label = e.message; }
    $(`count-${s.kind}`).textContent = label;
  }
}

function updateRelease() {
  $('release').disabled = !state.page || state.running || !state.selected.size;
}

// ---------- loading a page ----------

function normalize(text) {
  let s = String(text || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); return u.hostname.includes('.') ? u.href : null; } catch { return null; }
}

async function load(text) {
  const url = normalize(text);
  if (!url) return status('That doesn’t look like a web address. Try something like en.wikipedia.org/wiki/Spider', true);
  if (state.running) stopRun();
  $('url').value = url;
  $('empty').hidden = true;
  $('stagebox').classList.add('loading');
  status('Fetching the page…');
  try {
    const page = await Fetcher.page(url);
    await stage.show(page);
    state.page = page;
    results.reset();
    pageBar(page);
    scan();
    status(`Page on stage. Pick your spiders and release them.`);
    history.replaceState(null, '', '#' + page.url);
  } catch (e) {
    status(e.message, true);
    if (e.kind === 'noproxy') $('empty').hidden = false;
  } finally {
    $('stagebox').classList.remove('loading');
    updateRelease();
  }
}

function pageBar(p) {
  const title = stage.doc?.title || p.url;
  $('pagebar').innerHTML = `<b>${esc(short(title, 90))}</b><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a><span>${p.status} · ${p.kb} KB · ${p.ms} ms · via ${p.via === 'wikipedia' ? 'Wikipedia API' : 'proxy'}</span>`;
}

function status(msg, bad = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('bad', bad);
}

// ---------- releasing the spiders ----------

async function release() {
  if (!state.page || state.running) return;
  const scope = $('scope').value;
  const limit = scope === 'page' ? 1 : Number(scope);
  state.running = true; state.stop = false;
  stage.stopped = false; stage.skip = false;
  document.body.classList.add('running');
  updateRelease();
  results.reset();
  const start = new URL(state.page.url);
  const queue = [state.page.url], seen = new Set(queue);
  let done = 0;
  while (queue.length && done < limit && !state.stop) {
    const url = queue.shift();
    let page = state.page;
    if (done > 0) {
      status(`Fetching page ${done + 1} of up to ${limit}: ${url}`);
      try {
        page = await Fetcher.page(url);
        if (state.stop) break;
        await stage.show(page);
        state.page = page;
        pageBar(page);
      } catch (e) {
        results.addPage({ url, error: e.message });
        continue;
      }
    }
    done++;
    results.addPage({ url: page.url, title: stage.doc.title, status: page.status, kb: page.kb, ms: page.ms });
    status(limit > 1 ? `Page ${done} of up to ${limit}` : 'Spiders at work');
    for (const def of SPIDERS) {
      if (!state.selected.has(def.kind) || state.stop) continue;
      let out;
      try { out = extract(def.kind, stage.doc, page.url); } catch (e) { status(e.message, true); continue; }
      results.begin(def.kind, page, out);
      await stage.perform(def.kind, def, out.items, (it) => results.add(def.kind, it, page.url), (it) => labelOf(def.kind, it));
    }
    if (limit > 1) {
      for (const l of extractLinks(stage.doc, page.url).items) {
        if (l.kind !== 'internal' || seen.has(l.href) || new URL(l.href).hostname !== start.hostname) continue;
        seen.add(l.href);
        queue.push(l.href);
      }
    }
  }
  stage.setCaption(null);
  state.running = false;
  document.body.classList.remove('running');
  status(state.stop ? 'Stopped.' : `Done: ${done} page${done === 1 ? '' : 's'} crawled. Export from the results panel.`);
  updateRelease();
}

function labelOf(kind, it) {
  if (kind === 'links') return short(it.text || it.href, 40);
  if (kind === 'tables') return it.caption ? short(it.caption, 40) : `${it.rows.length} rows`;
  if (kind === 'regex') return short(it.value, 40);
  if (kind === 'images') return short(it.alt || 'no alt text', 40);
  return short(it.md.replace(/^[#>\-\d. ]+/, ''), 40);
}

function stopRun() {
  state.stop = true;
  stage.stopped = true;
  stage.skip = true;
  stage.stopWaiting();
}

// Ask each link's server for its status (through the proxy), a few at a time.
async function checkLinks() {
  if (!Fetcher.proxy) return status('Checking links needs the proxy (see the README). Wikipedia’s missing pages are already marked.', true);
  const todo = results.data.links.filter((l) => (l.kind === 'internal' || l.kind === 'external' || l.kind === 'file') && l.status == null).slice(0, 200);
  let n = 0;
  status(`Checking ${todo.length} links…`);
  const worker = async () => {
    while (todo.length) {
      const l = todo.shift();
      l.status = await Fetcher.status(l.href);
      n++;
      if (l.status >= 400 || l.status < 0) stage.vibrate(2, '#ff4d6d');
      if (n % 5 === 0 || !todo.length) { results.updateLink(l); status(`Checked ${n} links…`); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const broken = results.data.links.filter((l) => l.status >= 400).length;
  status(`Checked ${n} links: ${broken} broken.`, broken > 0);
  results.updateLink();
}

// ---------- controls ----------

$('go').addEventListener('submit', (e) => { e.preventDefault(); load($('url').value); });
$('release').addEventListener('click', release);
$('stop').addEventListener('click', stopRun);
$('skip').addEventListener('click', () => { stage.skip = true; stage.stopWaiting(); });
$('speed').addEventListener('click', () => {
  stage.speed = stage.speed === 1 ? 2 : stage.speed === 2 ? 4 : 1;
  $('speed').textContent = `${stage.speed}×`;
});
for (const b of document.querySelectorAll('[data-url]')) b.addEventListener('click', () => load(b.dataset.url));

let lastFrame = performance.now();
requestAnimationFrame(function frame(ts) {
  stage.frame(Math.min(0.05, (ts - lastFrame) / 1000));
  lastFrame = ts;
  requestAnimationFrame(frame);
});

buildDock();
updateRelease();
Fetcher.init().then((p) => {
  $('proxy').textContent = p ? 'any website' : 'Wikipedia only';
  $('proxy').title = p ? `Pages come through the proxy at ${p}` : 'No proxy found: only Wikipedia pages can be loaded. See the README to set one up.';
  $('proxy').classList.toggle('on', Boolean(p));
  for (const b of document.querySelectorAll('[data-needs-proxy]')) b.hidden = !p;
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (/^https?:\/\//.test(fromHash)) load(fromHash);
});
window.crawlspace = { stage, results, state };
