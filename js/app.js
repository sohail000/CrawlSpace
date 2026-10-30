// Director: load a page onto the stage, show what each spider would catch, then release them.

const SPIDERS = [
  { kind: 'links', name: 'Orb-weaver', short: 'Links', species: 'orb', color: '#ffcc4d', verb: 'anchoring link', job: 'Every link on the page, across the site if you like, and which ones are broken.' },
  { kind: 'tables', name: 'Funnel-web', short: 'Tables', species: 'funnel', color: '#ff7a59', verb: 'wrapping table', job: 'Every data table, cleaned up, as CSV or straight into Excel.' },
  { kind: 'regex', name: 'Jumping spider', short: 'Patterns', species: 'jumping', color: '#4ade80', verb: 'biting match', job: 'Emails, phone numbers, prices, dates, or any pattern you give it.' },
  { kind: 'images', name: 'Huntsman', short: 'Images', species: 'huntsman', color: '#38bdf8', verb: 'tagging image', job: 'Every image, with its size, and which ones lack alt text.' },
  { kind: 'text', name: 'Reader', short: 'Text', species: 'reader', color: '#a78bfa', verb: 'reading block', job: 'The main text without menus or ads, as clean Markdown.' },
  { kind: 'mimic', name: 'Mimic', short: 'Your pick', species: 'mimic', color: '#f472b6', verb: 'copying record', job: 'Click one thing on the page, and it catches everything like it as a table.' },
];
const EXAMPLES = [
  { name: 'Wikipedia: cities', url: 'https://en.wikipedia.org/wiki/List_of_largest_cities' },
  { name: 'Wikipedia: Spider', url: 'https://en.wikipedia.org/wiki/Spider' },
  { name: 'Books to scrape', url: 'https://books.toscrape.com/', proxy: true },
  { name: 'Quotes to scrape', url: 'https://quotes.toscrape.com/', proxy: true },
];
const MIMIC = SPIDERS.find((s) => s.kind === 'mimic');
const $ = (id) => document.getElementById(id);

const stage = new Stage({ wrap: $('stage'), frame: $('frame'), canvas: $('overlay'), caption: $('caption') });
const results = new Results({ tabs: $('rtabs'), body: $('rbody') }, SPIDERS, {
  onShow(kind, item) {
    if (!stage.doc || (item.page && item.page !== stage.page?.url)) { if (item.page) window.open(item.page, '_blank', 'noopener'); return; }
    siteMap.hide();
    stage.flash(item.el || item.target, SPIDERS.find((s) => s.kind === kind)?.color || '#fff');
  },
  onCheckLinks: checkLinks,
  onSiteMap: showMap,
  onColumns(cols) { if (state.mimic) state.mimic.columns = cols; scan(); },
});
const siteMap = new SiteMap({ box: $('map'), canvas: $('mapcanvas'), head: $('maphead'), tip: $('maptip') }, {
  onOpen(url) { siteMap.hide(); load(url, { keep: true }); },
  onClose() { siteMap.hide(); },
});

const state = {
  // Nothing is picked until a page is on stage: then the table and pattern spiders pick themselves when
  // there is something for them. Spiders you tick or untick yourself stay as you left them.
  page: null, selected: new Set(), touched: new Set(), pattern: 'emails',
  running: false, stop: false, mimic: null, picking: false, site: null, demo: false,
};

// ---------- the spider bar: one slim chip per spider ----------

// Spiders that have settings get a ▾ that opens a small popover (the pattern, or "Teach it").
function popoverFor(s) {
  if (s.kind === 'regex') return `<b>${s.name}</b><p>${s.job}</p><label>Look for
    <select id="pattern" aria-label="Pattern">${Object.entries(PATTERNS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}<option value="custom">My own pattern…</option></select></label>
    <input id="custom" placeholder="regex, e.g. ISBN[- ]?\\d+" hidden spellcheck="false" aria-label="Your own pattern">`;
  if (s.kind === 'mimic') return `<b>${s.name}</b><p>${s.job}</p><button type="button" id="teach" class="primary" disabled>Teach it: click the page</button>`;
  return '';
}

function buildDock() {
  $('dock').innerHTML = SPIDERS.map((s) => `
    <div class="chip off" style="--c:${s.color}" data-kind="${s.kind}" title="${s.name}: ${s.job}">
      <label class="chipmain">
        <input type="checkbox" ${s.kind === 'mimic' ? 'disabled' : ''} data-kind="${s.kind}">
        <canvas width="72" height="72" data-species="${s.species}" aria-hidden="true"></canvas>
        <span class="cname"><b><span class="full">${s.name}</span><span class="short">${s.short}</span></b><em id="count-${s.kind}">–</em></span>
        <span class="tick" aria-hidden="true"></span>
      </label>
      ${popoverFor(s) ? `<button type="button" class="more" data-pop="${s.kind}" aria-haspopup="true" aria-expanded="false" aria-label="${s.name} settings">▾</button>` : ''}
    </div>`).join('');
  for (const s of SPIDERS) {
    if (!popoverFor(s)) continue;
    const pop = document.createElement('div');
    pop.className = 'spop';
    pop.id = `pop-${s.kind}`;
    pop.hidden = true;
    pop.style.setProperty('--c', s.color);
    pop.innerHTML = popoverFor(s);
    document.body.append(pop);
  }
  for (const c of $('dock').querySelectorAll('canvas')) {
    const s = SPIDERS.find((x) => x.species === c.dataset.species);
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    const body = new SpiderBody(18, 19, { color: s.color, species: s.species, scale: 0.8 });
    body.h = -Math.PI / 2 + 0.3;
    body.replant();
    body.draw(ctx, 0, 1.4);
  }
  $('dock').addEventListener('change', (e) => {
    const k = e.target.dataset.kind;
    if (k) { state.touched.add(k); pick(k, e.target.checked); }
  });
  // Enter toggles a chip, like Space does for a checkbox
  $('dock').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[type="checkbox"]')) e.target.click(); });
  $('dock').addEventListener('click', (e) => {
    const more = e.target.closest('.more');
    if (more) return togglePop(more.dataset.pop);
    // the Mimic can't be ticked until it has been taught: its chip opens the "Teach it" popover instead
    if (e.target.closest('.chip[data-kind="mimic"] .chipmain') && !state.mimic) { e.preventDefault(); togglePop('mimic'); }
  });
  $('pattern').addEventListener('change', () => { setPattern($('pattern').value); if (!$('custom').hidden) $('custom').focus(); scan(); });
  $('custom').addEventListener('input', () => scan());
  $('teach').addEventListener('click', teach);
}

function pick(kind, on) {
  const box = $('dock').querySelector(`input[data-kind="${kind}"]`);
  box.checked = on;
  on ? state.selected.add(kind) : state.selected.delete(kind);
  box.closest('.chip').classList.toggle('off', !on);
  updateRelease();
}

// The popovers sit on the page (not in the bar), so the bar can scroll sideways on a phone without clipping them.
function togglePop(kind) {
  const pop = $(`pop-${kind}`), open = pop.hidden;
  closePops();
  if (!open) return;
  const chip = $('dock').querySelector(`.chip[data-kind="${kind}"]`), r = chip.getBoundingClientRect();
  pop.hidden = false;
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  chip.querySelector('.more').setAttribute('aria-expanded', 'true');
  pop.querySelector('select, button')?.focus();
}

function closePops() {
  for (const p of document.querySelectorAll('.spop')) p.hidden = true;
  for (const b of $('dock').querySelectorAll('.more')) b.setAttribute('aria-expanded', 'false');
}

function setPattern(key) {
  state.pattern = key;
  $('pattern').value = key;
  $('custom').hidden = key !== 'custom';
}

function customPattern() { return { source: $('custom').value.trim(), caseless: true }; }

function extract(kind, doc, url) {
  if (kind === 'links') return extractLinks(doc, url);
  if (kind === 'tables') return extractTables(doc);
  if (kind === 'regex') return state.pattern === 'custom' && !customPattern().source ? { items: [], notes: ['Type a pattern first.'] } : extractMatches(doc, state.pattern, customPattern());
  if (kind === 'images') return extractImages(doc);
  if (kind === 'mimic') {
    if (!state.mimic) return { items: [], notes: [], columns: [] };
    const out = applyPattern(doc, state.mimic, url);
    out.items.sort((a, b) => Number(b.pick) - Number(a.pick)); // start where you pointed
    return { ...out, columns: state.mimic.columns };
  }
  const t = extractText(doc, url);
  return { items: t.blocks, title: t.title, words: t.words, notes: [] };
}

// What each spider would catch on this page, before anyone is released.
function scan() {
  if (!stage.doc) return;
  for (const s of SPIDERS) {
    let label;
    try {
      if (s.kind === 'mimic' && !state.mimic) label = 'not taught yet';
      else {
        const out = extract(s.kind, stage.doc, stage.page.url);
        const n = out.items.length;
        // tables and patterns (emails by default) pick themselves when the page has some
        if ((s.kind === 'tables' || s.kind === 'regex') && !state.touched.has(s.kind)) pick(s.kind, n > 0);
        label = s.kind === 'links' ? `${n} links` : s.kind === 'tables' ? `${n} table${n === 1 ? '' : 's'}`
          : s.kind === 'regex' ? `${n} ${state.pattern === 'custom' ? 'matches' : PATTERNS[state.pattern].label.toLowerCase()}`
          : s.kind === 'images' ? `${n} image${n === 1 ? '' : 's'}`
          : s.kind === 'mimic' ? `${n} like it` : `${out.words.toLocaleString()} words`;
      }
    } catch (e) { label = e.message; }
    $(`count-${s.kind}`).textContent = label;
  }
}

function updateRelease() {
  $('release').disabled = !state.page || state.running || !state.selected.size;
  $('teach').disabled = !state.page || state.running;
}

// ---------- loading a page ----------

function normalize(text) {
  let s = String(text || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); return u.hostname.includes('.') ? u.href : null; } catch { return null; }
}

// keep: leave the results and the site map alone (opening a page from the map)
async function load(text, { keep = false } = {}) {
  const url = normalize(text);
  if (!url) return status('That doesn’t look like a web address. Try something like en.wikipedia.org/wiki/Spider', true);
  endDemo();
  if (state.running) stopRun();
  $('url').value = url;
  $('empty').hidden = true;
  $('stagebox').classList.add('loading');
  status('Fetching the page…');
  try {
    await put(await Fetcher.page(url), keep);
  } catch (e) {
    status(e.message, true);
    if (e.kind === 'noproxy') $('empty').hidden = false;
  } finally {
    $('stagebox').classList.remove('loading');
    updateRelease();
  }
}

// Put a page on stage, wherever it came from (the proxy, Wikipedia, or the bookmarklet).
async function put(page, keep = false) {
  cancelPick();
  showNotice(null);
  siteMap.hide();
  if (page.via !== 'demo') endDemo();
  if (!keep) state.site = null;
  $('empty').hidden = true;
  if (page.via !== 'demo') $('url').value = page.url;
  await stage.show(page);
  state.page = page;
  if (!keep) results.reset();
  pageBar(page);
  scan();
  const shell = page.via !== 'bookmarklet' && isShell(page, stage.doc);
  showNotice(shell && `<b>${esc(new URL(page.url).hostname.replace(/^www\./, ''))} builds this page with JavaScript.</b>It sends an empty shell first, then fills it in with scripts, and Crawlspace shows pages without their scripts. So there’s little here for the spiders, and waiting won’t change that. <button type="button" class="linkish" data-bm>Use the bookmarklet</button> to bring the page in exactly as your browser shows it.`);
  const picked = SPIDERS.filter((s) => state.selected.has(s.kind)).map((s) => s.name);
  status(shell ? 'Page on stage, but it is mostly empty without its scripts.'
    : (page.via === 'demo' ? 'Demo page on stage. ' : page.via === 'bookmarklet' ? 'Page on stage, exactly as your browser showed it. ' : 'Page on stage. ')
      + (picked.length ? `Ready: ${picked.length > 1 ? picked.slice(0, -1).join(', ') + ' and ' + picked.at(-1) : picked[0]}. Tick any other spiders you want, then release them.` : 'No tables or emails here. Tick the spiders you want, then release them.'));
  if (page.via !== 'demo') history.replaceState(null, '', '#' + page.url);
  $('stagebox').classList.remove('loading');
  updateRelease();
}

// A page that is an empty shell until its scripts run (YouTube, many web apps): almost no visible text,
// and the HTML is mostly script or has an empty app root.
function isShell(page, doc) {
  if (!doc) return false;
  const words = extractText(doc, page.url).words;
  if (words >= 80) return false;
  const html = page.html;
  const scripts = (html.match(/<script\b/gi) || []).length;
  const scriptBytes = (html.match(/<script\b[\s\S]*?<\/script>/gi) || []).reduce((n, s) => n + s.length, 0);
  return scriptBytes > html.length * 0.3 || scripts >= 8 || /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html);
}

function showNotice(html) {
  const n = $('notice');
  n.hidden = !html;
  if (!html) return;
  n.innerHTML = html + '<button type="button" class="x" aria-label="Dismiss">×</button>';
}

function pageBar(p) {
  const title = stage.doc?.title || p.url;
  const via = p.via === 'wikipedia' ? 'Wikipedia API' : p.via === 'bookmarklet' ? 'your browser' : p.via === 'demo' ? 'Crawlspace itself' : 'proxy';
  const map = state.site && [...state.site.nodes.values()].filter((n) => n.crawled).length > 1 ? '<button id="mapbtn" class="mapbtn">Site map</button>' : '';
  const night = `<button id="nightbtn" class="mapbtn night" aria-pressed="${stage.night}" title="Show the page dark, or in its own colours">${stage.night ? 'Dark page' : 'Original colours'}</button>`;
  const where = p.via === 'demo' ? '<em>demo page</em>' : `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>`;
  // the demo page has no address, so its bar offers real pages to try instead of load stats
  const examples = EXAMPLES.filter((x) => !x.proxy || Fetcher.proxy).map((x) => `<button data-url="${x.url}">${x.name}</button>`).join('');
  const tail = p.via === 'demo' ? `<div class="eg">Try a real page: ${examples}</div>` : `<span>${p.status} · ${p.kb} KB · ${p.via === 'bookmarklet' ? '' : `${p.ms} ms · `}via ${via}</span>`;
  $('pagebar').innerHTML = `<b>${esc(short(title, 90))}</b>${where}${map}${night}${tail}`;
}

// The page is shown dark unless you chose its own colours (remembered in this browser).
function setNight(on) {
  stage.setNight(on);
  try { localStorage.setItem('crawlspace.night', on ? '1' : '0'); } catch {}
  if (state.page) pageBar(state.page);
}

function status(msg, bad = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('bad', bad);
}

// ---------- the mimic: teach by clicking ----------

function teach() {
  if (!stage.doc || state.running) return;
  if (state.picking) return cancelPick();
  siteMap.hide();
  showNotice(null);
  closePops();
  state.picking = true;
  document.body.classList.add('picking');
  $('teach').textContent = 'Cancel';
  stage.setCaption(MIMIC, 'click one thing you want, like a product’s name or price · Esc to cancel');
  status('Point at something that repeats on the page, like one product’s name, one price, or one row.');
  stage.startPick(learn, cancelPick);
}

function cancelPick() {
  if (!state.picking) return;
  state.picking = false;
  stage.endPick();
  document.body.classList.remove('picking');
  $('teach').textContent = state.mimic ? 'Teach it again' : 'Teach it: click the page';
  if (!state.running) stage.setCaption(null);
}

// Work out what repeats around the element you pointed at, and tick the Mimic. False if nothing does.
function taught(el) {
  const pat = learnPattern(stage.doc, el, stage.page.url);
  if (!pat || !pat.columns.length) { status('Nothing else on this page looks like that. Try something that repeats, like one product’s name or price.', true); return false; }
  state.mimic = pat;
  $('teach').textContent = 'Teach it again';
  $('dock').querySelector('input[data-kind="mimic"]').disabled = false;
  pick('mimic', true);
  scan();
  return true;
}

async function learn(el) {
  cancelPick();
  if (taught(el)) await runOne(MIMIC);
}

// Release one spider on the page on stage, straight away (the mimic, right after it is taught).
async function runOne(def) {
  state.running = true; state.stop = false;
  stage.stopped = false; stage.skip = false;
  document.body.classList.add('running');
  updateRelease();
  stage.clearMarks('stamp');
  stage.last = {};
  const page = state.page;
  const out = extract(def.kind, stage.doc, page.url);
  results.clear(def.kind);
  results.begin(def.kind, page, out);
  status(`The ${def.name} found ${out.items.length} like your pick.`);
  await stage.perform(def.kind, def, out.items, (it) => results.add(def.kind, it, page.url), (it) => labelOf(def.kind, it));
  stage.setCaption(null);
  state.running = false;
  document.body.classList.remove('running');
  status(state.stop ? 'Stopped.' : `Caught ${out.items.length} records. Export them from the results panel, or crawl the site to catch them on more pages.`);
  updateRelease();
}

// ---------- releasing the spiders ----------

async function release({ instant = false } = {}) {
  if (!state.page || state.running) return;
  cancelPick();
  siteMap.hide();
  const scope = $('scope').value;
  const limit = scope === 'page' || state.page.via === 'demo' ? 1 : Number(scope); // the demo page has no site behind it
  state.running = true; state.stop = false;
  stage.stopped = false; stage.skip = instant;
  document.body.classList.add('running');
  updateRelease();
  results.reset();
  const start = new URL(state.page.url);
  const queue = [state.page.url], seen = new Set(queue);
  // the site as the crawl finds it: pages (knots) and the links between them (threads)
  const site = limit > 1 ? { start: state.page.url, nodes: new Map([[state.page.url, { url: state.page.url, depth: 0, parent: null }]]), edges: new Set() } : null;
  state.site = site;
  let done = 0;
  while (queue.length && done < limit && !state.stop) {
    const url = queue.shift();
    const node = site?.nodes.get(url);
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
        if (node) node.error = e.message;
        continue;
      }
    }
    done++;
    if (node) Object.assign(node, { crawled: true, title: stage.doc.title, status: page.status });
    results.addPage({ url: page.url, title: stage.doc.title, status: page.status, kb: page.kb, ms: page.ms });
    status(limit > 1 ? `Page ${done} of up to ${limit}` : 'Spiders at work');
    for (const def of SPIDERS) {
      if (!state.selected.has(def.kind) || state.stop || (def.kind === 'mimic' && !state.mimic)) continue;
      let out;
      try { out = extract(def.kind, stage.doc, page.url); } catch (e) { status(e.message, true); continue; }
      results.begin(def.kind, page, out);
      await stage.perform(def.kind, def, out.items, (it) => results.add(def.kind, it, page.url), (it) => labelOf(def.kind, it));
    }
    if (site) {
      for (const l of extractLinks(stage.doc, page.url).items) {
        if (l.kind !== 'internal' || l.href === url || new URL(l.href).hostname !== start.hostname) continue;
        site.edges.add(url + '\n' + l.href);
        if (!site.nodes.has(l.href)) site.nodes.set(l.href, { url: l.href, depth: (node?.depth || 0) + 1, parent: url });
        if (seen.has(l.href)) continue;
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
  if (site && done > 1) { pageBar(state.page); if (!state.stop) showMap(); }
}

function showMap() {
  if (!state.site) return status('The site map appears after a site crawl. Pick “this site” under Crawl, then release the spiders.', true);
  // broken links found by the link check mark their pages too
  const st = new Map(results.data.links.map((l) => [l.href, l.status]));
  for (const n of state.site.nodes.values()) if (!n.crawled && st.get(n.url) != null) n.status = st.get(n.url);
  showNotice(null);
  siteMap.show(state.site);
}

function labelOf(kind, it) {
  if (kind === 'links') return short(it.text || it.href, 40);
  if (kind === 'tables') return it.caption ? short(it.caption, 40) : `${it.rows.length} rows`;
  if (kind === 'regex') return short(it.value, 40);
  if (kind === 'images') return short(it.alt || 'no alt text', 40);
  if (kind === 'mimic') return short(Object.values(it.values).find((v) => v && !/^https?:/.test(v)) || '', 40);
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

// ---------- the demo: something to watch the moment you arrive ----------

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Put the bundled sample page on stage and let the table, price and Mimic spiders loose on it.
async function startDemo() {
  state.demo = true;
  setPattern('prices');
  await put(demoPage());
  if (!state.demo) return;
  $('demonote').hidden = false;
  await new Promise((r) => setTimeout(r, 700)); // let the page be seen before anything moves
  if (!state.demo) return;
  // the Mimic teaches itself on the first card's title, the same way a click would
  const title = stage.doc.querySelector('.card h3');
  if (title) {
    stage.setCaption(MIMIC, 'teaching itself from the first card’s title');
    stage.flash(title, MIMIC.color);
    await new Promise((r) => setTimeout(r, 900));
    if (!state.demo) return;
    taught(title);
  }
  await release({ instant: reducedMotion() });
}

// Anyone typing an address or loading a page ends the demo straight away.
function endDemo() {
  if (!state.demo) return;
  state.demo = false;
  $('demonote').hidden = true;
  if (state.running) stopRun();
  if (!state.running) stage.setCaption(null);
}

// ---------- the bookmarklet: bring in a page exactly as your browser shows it ----------

// Runs on the other site: copies the page as it is now (styles that scripts added included),
// opens Crawlspace, and hands the copy over once Crawlspace says it is ready.
function bookmarklet() {
  const app = location.href.split('#')[0] + '#from-bookmarklet';
  const origin = location.protocol === 'file:' ? '*' : location.origin;
  const src = `(()=>{const r=document.documentElement.cloneNode(true),l=document.querySelectorAll('style'),c=r.querySelectorAll('style');` +
    `l.forEach((s,i)=>{try{const t=[...s.sheet.cssRules].map(x=>x.cssText).join('\\n');if(c[i]&&t.length>c[i].textContent.length)c[i].textContent=t}catch(e){}});` +
    `try{const t=[...document.adoptedStyleSheets].map(h=>[...h.cssRules].map(x=>x.cssText).join('\\n')).join('\\n');if(t){const s=document.createElement('style');s.textContent=t;(r.querySelector('head')||r).append(s)}}catch(e){}` +
    `const m={crawlspace:1,url:location.href,html:'<!doctype html>'+r.outerHTML},w=open(${JSON.stringify(app)});` +
    `if(!w)return alert('Crawlspace: allow pop-ups for this site, then click the bookmark again.');` +
    `const f=e=>{if(e.source===w&&e.data==='crawlspace:ready'){w.postMessage(m,${JSON.stringify(origin)});removeEventListener('message',f)}};addEventListener('message',f)})()`;
  return 'javascript:' + encodeURIComponent(src);
}

// This tab was opened by the bookmarklet: tell the page that opened it we're ready, and take the page.
function receiveFromBookmarklet() {
  if (location.hash !== '#from-bookmarklet') return false;
  history.replaceState(null, '', location.pathname + location.search);
  const from = window.opener;
  if (!from) { status('This tab opens from the Crawlspace bookmark on another page. See “Bookmarklet” at the top.', true); return true; }
  $('empty').hidden = true;
  $('stagebox').classList.add('loading');
  status('Receiving the page from your other tab…');
  const got = async (e) => {
    const d = e.data;
    if (e.source !== from || !d || d.crawlspace !== 1 || typeof d.html !== 'string' || !/^https?:\/\//.test(d.url || '')) return;
    window.removeEventListener('message', got);
    try {
      await put({ url: d.url, html: d.html, status: 200, ms: 0, kb: Math.round(d.html.length / 1024), via: 'bookmarklet' });
    } catch (err) { status(err.message, true); }
    $('stagebox').classList.remove('loading');
  };
  window.addEventListener('message', got);
  from.postMessage('crawlspace:ready', '*');
  setTimeout(() => {
    if (state.page) return;
    $('stagebox').classList.remove('loading');
    $('empty').hidden = false;
    status('Nothing arrived from the other tab. Some sites block this; try the bookmark again, or paste the address instead.', true);
  }, 10000);
  return true;
}

function toggleBm(open = $('bm').hidden) { $('bm').hidden = !open; }

// ---------- controls ----------

$('go').addEventListener('submit', (e) => { e.preventDefault(); load($('url').value); });
$('url').addEventListener('input', endDemo);
$('release').addEventListener('click', () => release());
$('stop').addEventListener('click', stopRun);
$('skip').addEventListener('click', () => { stage.skip = true; stage.stopWaiting(); });
$('speed').addEventListener('click', () => {
  stage.speed = stage.speed === 1 ? 2 : stage.speed === 2 ? 4 : 1;
  $('speed').textContent = `${stage.speed}×`;
});
$('pagebar').addEventListener('click', (e) => {
  if (e.target.closest('#mapbtn')) siteMap.visible ? siteMap.hide() : showMap();
  if (e.target.closest('#nightbtn')) setNight(!stage.night);
  const eg = e.target.closest('[data-url]');
  if (eg) load(eg.dataset.url);
});
$('notice').addEventListener('click', (e) => {
  if (e.target.closest('.x')) $('notice').hidden = true;
  if (e.target.closest('[data-bm]')) toggleBm(true);
});
$('bmbtn').addEventListener('click', () => toggleBm());
$('bm').addEventListener('click', (e) => { if (e.target.closest('.x')) toggleBm(false); });
$('bmlink').href = bookmarklet();
$('bmlink').addEventListener('click', (e) => {
  e.preventDefault();
  const t = $('toast');
  t.textContent = 'Drag it to your bookmarks bar';
  t.hidden = false;
  clearTimeout(flashBtn.t);
  flashBtn.t = setTimeout(() => { t.hidden = true; }, 1800);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleBm(false); closePops(); if (siteMap.visible) siteMap.hide(); } });
document.addEventListener('click', (e) => { if (!e.target.closest('.spop, .more, .chip[data-kind="mimic"]')) closePops(); });
for (const b of document.querySelectorAll('[data-url]')) b.addEventListener('click', () => load(b.dataset.url));

let lastFrame = performance.now();
requestAnimationFrame(function frame(ts) {
  const dt = Math.min(0.05, (ts - lastFrame) / 1000);
  stage.frame(dt);
  siteMap.frame(dt);
  lastFrame = ts;
  requestAnimationFrame(frame);
});

buildDock();
updateRelease();
let night = true;
try { night = localStorage.getItem('crawlspace.night') !== '0'; } catch {}
stage.setNight(night);
const fromBookmarklet = receiveFromBookmarklet();
const deepLink = /^https?:\/\//.test(decodeURIComponent(location.hash.slice(1)));
if (!fromBookmarklet && !deepLink) startDemo();
Fetcher.init().then((p) => {
  $('proxy').textContent = p ? 'any website' : 'Wikipedia only';
  $('proxy').title = p ? `Pages come through the proxy at ${p}` : 'No proxy found: only Wikipedia pages can be loaded. See the README to set one up.';
  $('proxy').classList.toggle('on', Boolean(p));
  for (const b of document.querySelectorAll('[data-needs-proxy]')) b.hidden = !p;
  if (state.page?.via === 'demo') pageBar(state.page); // now it knows which examples need the proxy
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (!fromBookmarklet && /^https?:\/\//.test(fromHash)) load(fromHash);
});
window.crawlspace = { stage, results, state, siteMap };
