// THE RESULTS: one tab per spider, filled at the moment each catch lands on stage.
// Everything can be shown on the page (click a row) and exported.

class Results {
  constructor(els, defs, hooks) {
    this.els = els;   // { tabs, body }
    this.defs = defs; // spider definitions
    this.hooks = hooks; // { onShow(kind, item), onCheckLinks(), onSiteMap(), onColumns(cols) }
    this.filter = { links: 'all', images: 'all' };
    this.reset();
    els.tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) this.select(b.dataset.tab); });
    els.body.addEventListener('click', (e) => this.click(e));
    new ResizeObserver(() => this.positionLine()).observe(els.tabs);
  }

  reset() {
    this.data = { links: [], tables: [], regex: [], images: [], text: [], mimic: [], pages: [] };
    this.cols = [];
    this.notes = {};
    this.active = null;
    this.queue = [];   // catches waiting to be drawn: they are added to the list once per frame, not once each
    this.fillToken = (this.fillToken || 0) + 1;
    this.filling = false;
    this.renderTabs();
    this.els.body.innerHTML = '<p class="hint">Results appear here as the spiders catch them. Click any result to see it on the page.</p>';
  }

  def(kind) { return this.defs.find((d) => d.kind === kind); }

  renderTabs() {
    const tabs = this.defs.filter((d) => d.kind !== 'mimic' || this.cols.length).map((d) => [d.kind, d.short, d.color]);
    if (this.data.pages.length > 1) tabs.push(['pages', 'Pages', '#e5e7eb']);
    for (const b of this.els.tabs.querySelectorAll('[data-tab]')) if (!tabs.some(([k]) => k === b.dataset.tab)) b.remove();
    for (const [k, label, c] of tabs) {
      const n = k === 'text' ? this.data.text.reduce((s, b) => s + b.words, 0) : this.data[k].length;
      let b = this.els.tabs.querySelector(`[data-tab="${k}"]`);
      if (!b) {
        b = document.createElement('button'); b.dataset.tab = k;
        b.innerHTML = `${label}<em></em>`;
        this.els.tabs.append(b);
      }
      b.style.setProperty('--c', c);
      b.setAttribute('aria-selected', String(this.active === k));
      b.querySelector('em').textContent = n ? (k === 'text' ? n.toLocaleString() + 'w' : n) : '';
    }
    if (!this.line) {
      this.line = document.createElement('span'); this.line.className = 'tabline';
      this.line.setAttribute('aria-hidden', 'true'); this.els.tabs.append(this.line);
    }
    this.positionLine();
  }

  positionLine() {
    const b = this.els.tabs.querySelector('[aria-selected="true"]');
    if (!this.line) return;
    this.line.hidden = !b;
    if (!b) return;
    this.line.style.width = `${b.offsetWidth}px`;
    this.line.style.transform = `translateX(${b.offsetLeft}px)`;
    this.line.style.background = b.style.getPropertyValue('--c');
  }

  select(kind) {
    this.active = kind;
    this.renderTabs();
    this.render();
  }

  clear(kind) { this.data[kind] = []; this.queue = this.queue.filter((q) => q[0] !== kind); }

  begin(kind, page, out) {
    this.notes[kind] = out.notes || [];
    if (kind === 'mimic') this.cols = out.columns;
    if (kind === 'text') this.data.text.push({ page: page.url, title: out.title, words: 0, md: [] });
    if (this.active !== kind) this.select(kind); else this.render();
  }

  addPage(p) { this.data.pages.push(p); this.renderTabs(); }

  add(kind, item, page) {
    if (kind === 'text') {
      const sec = this.data.text[this.data.text.length - 1];
      sec.md.push(item.md);
      sec.words += (item.md.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').match(/[\p{L}\p{N}]+/gu) || []).length;
    } else {
      if (kind === 'mimic') {
        // the same record on two pages (a site's "/" and "/index.html") is kept once
        const key = this.cols.map((c) => item.values[c.key]).join('\u0001');
        if (this.data.mimic.some((r) => r.key === key)) return;
        item.key = key;
      }
      item.page = page;
      this.data[kind].push(item);
    }
    this.queue.push([kind, item, this.data[kind].length - 1]);
    if (!this.raf) this.raf = requestAnimationFrame(() => this.flush());
  }

  // Draw everything caught since the last frame in one go: the tabs, the new rows, and the summary.
  flush() {
    this.raf = 0;
    const batch = this.queue.splice(0), kind = this.active;
    this.renderTabs();
    const mine = batch.filter((q) => q[0] === kind);
    if (!mine.length || this.filling) return; // a list that is still filling in picks the new ones up itself
    this.appendMany(kind, mine);
    const sum = this.els.body.querySelector('.rhead span');
    if (sum) sum.innerHTML = this.summary(kind);
  }

  summary(kind) {
    const D = this.data, n = D[kind].length, s = n === 1 ? '' : 's';
    if (kind === 'links') return `${n} unique link${s}`;
    if (kind === 'tables') return `${n} data table${s}`;
    if (kind === 'regex') return `${n} unique match${n === 1 ? '' : 'es'}`;
    if (kind === 'images') { const m = D.images.filter((i) => i.altState === 'missing').length; return `${n} image${s} · <span class="${m ? 'bad' : ''}">${m} missing alt text</span>`; }
    if (kind === 'text') { const w = D.text.reduce((a, b) => a + b.words, 0); return `${w.toLocaleString()} words · ${Math.max(1, Math.round(w / 230))} min read`; }
    if (kind === 'mimic') return `${n} record${s} · ${this.cols.length} column${this.cols.length === 1 ? '' : 's'}`;
    return `${n} pages crawled`;
  }

  // ---------- rendering ----------

  head(kind, summary, buttons) {
    const d = this.def(kind) || { color: '#e5e7eb', name: 'Pages' };
    const notes = (this.notes[kind] || []).map((n) => `<li>${esc(n)}</li>`).join('');
    return `<div class="rhead" style="--c:${d.color}"><div><b>${esc(d.name)}</b><span>${summary}</span></div><div class="acts">${buttons}</div></div>${notes ? `<ul class="notes">${notes}</ul>` : ''}`;
  }

  render() {
    const k = this.active, body = this.els.body;
    if (!k) return;
    const D = this.data;
    this.fillToken++; // a fill from the last render stops here
    this.filling = false;
    this.queue = this.queue.filter((q) => q[0] !== k); // render draws all of this kind, queued ones included
    if (k === 'links') {
      const f = this.filter.links;
      const counts = { internal: 0, external: 0, email: 0, phone: 0, file: 0, broken: 0 };
      for (const l of D.links) { counts[l.kind]++; if (l.status >= 400 || l.status < 0) counts.broken++; }
      const chips = [['all', `All ${D.links.length}`], ['internal', `On this site ${counts.internal}`], ['external', `Elsewhere ${counts.external}`], ['contact', `Email/phone ${counts.email + counts.phone}`], ['file', `Files ${counts.file}`], ['broken', `Broken ${counts.broken}`]];
      body.innerHTML = this.head('links', this.summary('links'),
        `<button data-act="check">Check for broken links</button><button data-act="csv">CSV</button><button data-act="json">JSON</button>`) +
        `<div class="chips">${chips.map(([v, l]) => `<button data-filter="${v}" aria-pressed="${f === v}">${l}</button>`).join('')}</div><ol class="rows" id="rows"></ol>`;
      this.fill('links');
    } else if (k === 'tables') {
      body.innerHTML = this.head('tables', this.summary('tables'), `<button data-act="json">JSON</button>`) + '<div class="cards" id="rows"></div>';
      this.fill('tables');
    } else if (k === 'regex') {
      body.innerHTML = this.head('regex', this.summary('regex'), `<button data-act="copy">Copy</button><button data-act="csv">CSV</button>`) + '<ol class="rows" id="rows"></ol>';
      this.fill('regex');
    } else if (k === 'images') {
      const f = this.filter.images;
      const missing = D.images.filter((i) => i.altState === 'missing').length;
      body.innerHTML = this.head('images', this.summary('images'), `<button data-act="csv">CSV</button>`) +
        `<div class="chips"><button data-filter="all" aria-pressed="${f === 'all'}">All</button><button data-filter="missing" aria-pressed="${f === 'missing'}">Missing alt ${missing}</button></div><div class="grid" id="rows"></div>`;
      this.fill('images');
    } else if (k === 'text') {
      body.innerHTML = this.head('text', this.summary('text'), `<button data-act="copy">Copy Markdown</button><button data-act="md">Download .md</button>`) +
        `<div id="rows">${D.text.map((s) => this.textSection(s)).join('')}</div>`;
    } else if (k === 'mimic') {
      body.innerHTML = this.head('mimic', this.summary('mimic'), `<button data-act="csv">CSV</button><button data-act="tsv">Copy for Excel</button><button data-act="json">JSON</button>`) +
        `<div class="chips cols">${this.cols.map((c) => `<button data-drop="${esc(c.key)}" title="Leave this column out">${esc(c.name)} <span aria-hidden="true">×</span></button>`).join('')}</div>` +
        `<div class="ptable"><table><thead><tr>${this.cols.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody id="rows"></tbody></table></div>`;
      this.fill('mimic');
    } else if (k === 'pages') {
      body.innerHTML = this.head('pages', this.summary('pages'), `<button data-act="map">Site map</button><button data-act="csv">CSV</button>`) +
        `<ol class="rows">${D.pages.map((p) => `<li class="row"><span class="badge ${p.error ? 'b-bad' : 'b-ok'}">${p.error ? 'fell' : p.status}</span><span class="rmain"><b>${esc(p.title || p.url)}</b><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>${p.error ? `<small class="bad">${esc(p.error)}</small>` : `<small>${p.kb} KB · ${p.ms} ms</small>`}</span></li>`).join('')}</ol>`;
    }
  }

  textSection(s) {
    return `<section class="md"><h4>${esc(s.title || s.page)} <small>${s.words.toLocaleString()} words</small></h4><pre>${esc(s.md.join('\n\n'))}</pre></section>`;
  }

  // Long lists are drawn in chunks, one per frame, so 1,000+ rows never freeze the page. Rows caught while it
  // fills are picked up too, because it reads the live list.
  fill(kind) {
    const token = this.fillToken, list = this.els.body.querySelector('#rows'), all = this.data[kind];
    if (!list) return;
    let done = 0;
    this.filling = true;
    const step = () => {
      if (token !== this.fillToken) return;
      const end = Math.min(all.length, done + 300);
      this.insert(list, kind, all.slice(done, end).map((it, k) => [kind, it, done + k]));
      done = end;
      if (done < all.length) return requestAnimationFrame(step);
      this.filling = false;
      const sum = this.els.body.querySelector('.rhead span');
      if (sum) sum.innerHTML = this.summary(kind); // rows may have arrived while it filled
    };
    step();
  }

  appendMany(kind, entries) {
    const list = this.els.body.querySelector('#rows');
    if (!list) return;
    if (kind === 'text') {
      const s = this.data.text[this.data.text.length - 1];
      const secs = list.querySelectorAll('section.md');
      const html = this.textSection(s);
      if (secs.length === this.data.text.length) secs[secs.length - 1].outerHTML = html; else list.insertAdjacentHTML('beforeend', html);
      const pre = list.querySelector('section.md:last-child pre');
      if (pre) pre.scrollTop = pre.scrollHeight;
      return;
    }
    this.insert(list, kind, entries);
  }

  insert(list, kind, entries) {
    const html = entries.map(([, it, i]) => this.rowHtml(kind, it, i)).join('');
    if (!html) return;
    const pane = this.els.body, atEnd = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 120;
    if (entries.length > 20) list.classList.add('bulk'); // no slide-in animation for a crowd of rows
    list.insertAdjacentHTML('beforeend', html);
    if (atEnd) pane.scrollTop = pane.scrollHeight;
  }

  rowHtml(kind, it, i) {
    if (kind === 'links') {
      const f = this.filter.links;
      const broken = it.status >= 400 || it.status < 0;
      if (f !== 'all' && !(f === 'broken' ? broken : f === 'contact' ? it.kind === 'email' || it.kind === 'phone' : it.kind === f)) return '';
      const st = it.status == null ? '' : it.status < 0 ? 'robots' : it.status === 0 ? '?' : it.status;
      return `<li class="row" data-kind="links" data-i="${i}"><span class="badge b-${it.kind}">${it.kind === 'internal' ? 'site' : it.kind === 'external' ? 'away' : it.kind}</span><span class="rmain"><b>${esc(it.text || '(no text)')}</b><a href="${esc(it.href)}" target="_blank" rel="noopener">${esc(it.href)}</a></span><span class="st ${broken ? 'bad' : ''}">${st}${it.count > 1 ? ` <small>×${it.count}</small>` : ''}</span></li>`;
    }
    if (kind === 'tables') {
      const prev = it.rows.slice(0, 7).map((r, ri) => `<tr>${r.slice(0, 7).map((c) => (ri === 0 && it.header ? `<th>${esc(short(c, 40))}</th>` : `<td>${esc(short(c, 40))}</td>`)).join('')}</tr>`).join('');
      return `<div class="card" data-kind="tables" data-i="${i}"><div class="ct"><b>${esc(it.caption || 'Table ' + (i + 1))}</b><small>${it.rows.length} rows × ${it.cols} columns</small></div><div class="tw"><table>${prev}</table></div><div class="acts"><button data-act="table-csv" data-i="${i}">Download CSV</button><button data-act="table-tsv" data-i="${i}">Copy for Excel</button><button data-act="show" data-i="${i}">Show on page</button></div></div>`;
    }
    if (kind === 'regex') {
      const ctx = it.context.trim() === it.value ? '' : esc(it.context).replace(esc(it.value), `<mark>${esc(it.value)}</mark>`);
      return `<li class="row r2" data-kind="regex" data-i="${i}"><span class="rmain"><b class="mono">${esc(it.value)}</b>${ctx ? `<small>${ctx}</small>` : ''}</span><span class="st">${it.count > 1 ? '×' + it.count : ''}</span></li>`;
    }
    if (kind === 'images') {
      if (this.filter.images === 'missing' && it.altState !== 'missing') return '';
      const badge = it.altState === 'ok' ? `<span class="badge b-ok">alt</span>` : it.altState === 'decorative' ? `<span class="badge">decorative</span>` : `<span class="badge b-bad">no alt</span>`;
      return `<figure class="thumb" data-kind="images" data-i="${i}"><img src="${esc(it.src)}" alt="" loading="lazy" referrerpolicy="no-referrer"><figcaption>${badge}<small>${it.w && it.h ? `${it.w}×${it.h}` : ''}</small><span>${esc(short(it.alt || it.src.split('/').pop().split('?')[0], 60))}</span></figcaption></figure>`;
    }
    // mimic
    const cell = (c) => {
      const v = it.values[c.key] || '';
      if (c.key.endsWith('@src') && v) return `<td><img src="${esc(v)}" alt="" loading="lazy" referrerpolicy="no-referrer"></td>`;
      if (c.key.endsWith('@href') && v) return `<td><a href="${esc(v)}" target="_blank" rel="noopener" title="${esc(v)}">${esc(short(v.replace(/^https?:\/\/[^/]+/, '') || v, 40))}</a></td>`;
      return `<td title="${esc(v)}">${esc(short(v, 80))}</td>`;
    };
    return `<tr data-kind="mimic" data-i="${i}" class="${it.pick ? 'pick' : ''}">${this.cols.map(cell).join('')}</tr>`;
  }

  updateLink(it) {
    if (this.active === 'links') this.render();
  }

  // ---------- actions ----------

  exportFiles() {
    const D = this.data, files = [];
    if (D.links.length) files.push(['links.csv', toCsv([['page', 'text', 'url', 'type', 'times linked', 'status'], ...D.links.map((l) => [l.page, l.text, l.href, l.kind, l.count, l.status ?? ''])])]);
    D.tables.forEach((t, i) => files.push([`table-${i + 1}.csv`, toCsv(t.rows)]));
    if (D.regex.length) files.push(['matches.csv', toCsv([['page', 'match', 'times found', 'context'], ...D.regex.map((r) => [r.page, r.value, r.count, r.context])])]);
    if (D.images.length) files.push(['images.csv', toCsv([['page', 'image', 'alt text', 'alt state', 'width', 'height'], ...D.images.map((i) => [i.page, i.src, i.alt, i.altState, i.w || '', i.h || ''])])]);
    if (D.text.length) files.push(['text.md', D.text.map((p) => `<!-- ${p.page} -->\n\n${p.md.join('\n\n')}`).join('\n\n---\n\n')]);
    if (D.mimic.length) files.push(['my-pick.csv', toCsv([this.cols.map((c) => c.name), ...D.mimic.map((r) => this.cols.map((c) => r.values[c.key] || ''))])]);
    if (D.pages.length) files.push(['pages.csv', toCsv([['url', 'title', 'status', 'ms', 'error'], ...D.pages.map((p) => [p.url, p.title || '', p.status || '', p.ms || '', p.error || ''])])]);
    return files;
  }

  click(e) {
    const f = e.target.closest('[data-filter]');
    if (f) { this.filter[this.active] = f.dataset.filter; this.render(); return; }
    const drop = e.target.closest('[data-drop]');
    if (drop) {
      if (this.cols.length < 2) return;
      this.cols = this.cols.filter((c) => c.key !== drop.dataset.drop);
      this.hooks.onColumns(this.cols);
      this.renderTabs(); this.render();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) { e.preventDefault(); this.action(act, +e.target.closest('[data-act]').dataset.i); return; }
    if (e.target.closest('a')) return;
    const row = e.target.closest('[data-kind]');
    if (row) this.hooks.onShow(row.dataset.kind, this.data[row.dataset.kind][+row.dataset.i]);
  }

  async action(act, i) {
    const k = this.active, D = this.data;
    const strip = (it) => { const { el, target, ...rest } = it; return rest; };
    if (act === 'check') return this.hooks.onCheckLinks();
    if (act === 'map') return this.hooks.onSiteMap();
    if (k === 'mimic') {
      const rows = [this.cols.map((c) => c.name), ...D.mimic.map((r) => this.cols.map((c) => r.values[c.key] || ''))];
      if (act === 'csv') return download('my-pick.csv', toCsv(rows), 'text/csv');
      if (act === 'tsv') return flashBtn(await copyText(rows.map((r) => r.map((c) => c.replace(/[\t\n]/g, ' ')).join('\t')).join('\n')));
      if (act === 'json') return download('my-pick.json', JSON.stringify(D.mimic.map((r) => Object.fromEntries([['page', r.page], ...this.cols.map((c) => [c.name, r.values[c.key] || ''])])), null, 2), 'application/json');
      if (act === 'csv' || act === 'tsv') return;
    }
    if (act === 'show') return this.hooks.onShow(k, D[k][i]);
    if (act === 'table-csv') return download(`table-${i + 1}.csv`, toCsv(D.tables[i].rows), 'text/csv');
    if (act === 'table-tsv') return flashBtn(await copyText(D.tables[i].rows.map((r) => r.map((c) => c.replace(/\t/g, ' ')).join('\t')).join('\n')));
    if (act === 'json') return download(`crawlspace-${k}.json`, JSON.stringify(D[k].map(strip), null, 2), 'application/json');
    if (act === 'md') return download('crawlspace-text.md', D.text.map((s) => `<!-- ${s.page} -->\n\n${s.md.join('\n\n')}`).join('\n\n---\n\n'), 'text/markdown');
    if (act === 'copy' && k === 'text') return flashBtn(await copyText(D.text.map((s) => s.md.join('\n\n')).join('\n\n---\n\n')));
    if (act === 'copy' && k === 'regex') return flashBtn(await copyText(D.regex.map((r) => r.value).join('\n')));
    if (act === 'csv') {
      if (k === 'links') return download('links.csv', toCsv([['page', 'text', 'url', 'type', 'times linked', 'status'], ...D.links.map((l) => [l.page, l.text, l.href, l.kind, l.count, l.status ?? ''])]), 'text/csv');
      if (k === 'regex') return download('matches.csv', toCsv([['page', 'match', 'times found', 'context'], ...D.regex.map((r) => [r.page, r.value, r.count, r.context])]), 'text/csv');
      if (k === 'images') return download('images.csv', toCsv([['page', 'image', 'alt text', 'alt state', 'width', 'height'], ...D.images.map((m) => [m.page, m.src, m.alt, m.altState, m.w || '', m.h || ''])]), 'text/csv');
      if (k === 'pages') return download('pages.csv', toCsv([['url', 'title', 'status', 'ms', 'error'], ...D.pages.map((p) => [p.url, p.title || '', p.status || '', p.ms || '', p.error || ''])]), 'text/csv');
    }
  }
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

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

function flashBtn(ok) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = ok ? 'Copied' : 'Copy failed';
  t.hidden = false;
  clearTimeout(flashBtn.t);
  flashBtn.t = setTimeout(() => { t.hidden = true; }, 1400);
}
