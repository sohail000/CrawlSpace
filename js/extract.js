// What each spider catches, read from the page's real structure (the rendered document on stage).
// Every item keeps a reference to its element (or text range), so any result can be shown on the page.

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const FILE_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|tar|rar|7z|mp[34]|mov|avi|webm|wav|ogg|exe|dmg|msi|apk|css|js|json|xml|rss|atom|docx?|xlsx?|pptx?|csv)$/i;

function isVisible(el) {
  if (!el || !el.getClientRects) return false;
  return el.getClientRects().length > 0;
}

// ---------- Orb-weaver: links ----------

function extractLinks(doc, pageUrl) {
  const page = new URL(pageUrl);
  const items = [], byUrl = new Map();
  let anchors = 0, scripts = 0;
  for (const a of doc.querySelectorAll('a[href], area[href]')) {
    const raw = a.getAttribute('href').trim();
    if (/^javascript:/i.test(raw)) { scripts++; continue; }
    let u;
    try { u = new URL(raw, pageUrl); } catch { continue; }
    let kind;
    if (u.protocol === 'mailto:') kind = 'email';
    else if (u.protocol === 'tel:') kind = 'phone';
    else if (!/^https?:$/.test(u.protocol)) continue;
    else if (u.href.split('#')[0] === page.href.split('#')[0] && u.hash) { anchors++; continue; } // jumps within this page
    else if (FILE_EXT.test(u.pathname)) kind = 'file';
    else kind = u.hostname === page.hostname ? 'internal' : 'external';
    const href = kind === 'internal' || kind === 'external' ? (u.hash = '', u.href) : u.href;
    const text = clean(a.textContent || a.getAttribute('title') || a.querySelector('img')?.alt || '');
    const missing = a.classList.contains('new') || /[?&]redlink=1/.test(raw); // Wikipedia's red links: the page does not exist
    let item = byUrl.get(href);
    if (item) { item.count++; if (!item.text && text) item.text = text; continue; }
    item = { el: a, href, text, kind, count: 1, status: missing ? 404 : null, visible: isVisible(a) };
    byUrl.set(href, item);
    items.push(item);
  }
  return { items, notes: [anchors && `${anchors} links jump within this page (not counted)`, scripts && `${scripts} links run scripts (not counted)`].filter(Boolean) };
}

// ---------- Funnel-web: tables ----------

function cellText(cell) {
  const c = cell.cloneNode(true);
  for (const n of c.querySelectorAll('sup.reference, .reference, .mw-ref, style, script, .sortkey, .mw-editsection, [style*="display:none"], [style*="display: none"]')) n.remove();
  for (const br of c.querySelectorAll('br')) br.replaceWith(' ');
  return clean(c.textContent).replace(/\s*\[\d+\]$/, '');
}

// The table as a grid of strings, with merged cells (colspan/rowspan) repeated where they reach.
function tableGrid(table) {
  const rows = [], pending = [];
  for (const tr of table.rows) {
    const row = [];
    let col = 0;
    const carry = () => { while (pending[col] && pending[col].left > 0) { row[col] = pending[col].text; pending[col].left--; col++; } };
    for (const cell of tr.cells) {
      carry();
      const text = cellText(cell);
      const cs = Math.max(1, Math.min(50, cell.colSpan || 1)), rs = Math.max(1, Math.min(500, cell.rowSpan || 1));
      for (let k = 0; k < cs; k++) { row[col + k] = text; if (rs > 1) pending[col + k] = { text, left: rs - 1 }; }
      col += cs;
    }
    carry();
    rows.push(row);
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
}

function extractTables(doc) {
  const items = [], skipped = [];
  for (const table of doc.querySelectorAll('table')) {
    if (/^(presentation|none)$/i.test(table.getAttribute('role') || '')) { skipped.push({ el: table, reason: 'marked as layout' }); continue; }
    if (table.querySelector('table') && table.rows.length < 4) { skipped.push({ el: table, reason: 'a layout wrapper around other tables' }); continue; }
    if (!isVisible(table)) { skipped.push({ el: table, reason: 'hidden on the page' }); continue; }
    if (/\b(navbox|nav|menu|sidebar|toc|metadata|ambox|mbox)/i.test(table.className) || table.closest('.navbox, nav, [role="navigation"], .sidebar')) { skipped.push({ el: table, reason: 'a navigation menu' }); continue; }
    const rows = tableGrid(table).filter((r) => r.some(Boolean));
    const cols = rows[0]?.length || 0;
    if (rows.length < 2 || cols < 2) { skipped.push({ el: table, reason: 'too small to be data' }); continue; }
    const all = clean(table.textContent).length;
    const linked = [...table.querySelectorAll('a')].reduce((n, a) => n + clean(a.textContent).length, 0);
    if (cols <= 3 && all > 0 && linked / all > 0.75) { skipped.push({ el: table, reason: 'a menu of links' }); continue; }
    const first = table.rows[0];
    const header = Boolean(table.tHead) || (first && [...first.cells].every((c) => c.tagName === 'TH'));
    const caption = clean(table.caption?.textContent) || clean(table.closest('section, div')?.querySelector('h2, h3, h4')?.textContent) || '';
    items.push({ el: table, rows, header, caption, cols });
  }
  const why = [...new Set(skipped.map((s) => s.reason))].join(', ');
  return { items, notes: skipped.length ? [`${skipped.length} table${skipped.length === 1 ? '' : 's'} skipped: ${why}`] : [], skipped };
}

// ---------- Jumping spider: patterns ----------

const PATTERNS = {
  emails: { label: 'Emails', re: /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,24}/gi, link: 'email' },
  phones: {
    label: 'Phone numbers', re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,5}\)[\s.-]?)?\d{2,5}(?:[\s.-]\d{2,5}){1,4}/g, link: 'phone',
    // real phone numbers: 7-15 digits, and a + sign, brackets or three digit groups (so "1999-2003" is not one)
    ok: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15 && (/^\+|\(/.test(m) || m.split(/[\s.-]+/).length >= 3) && !/^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(m); },
  },
  prices: { label: 'Prices', re: /(?:[$€£¥₹]\s?\d{1,3}(?:[,\d]{0,12})(?:\.\d{1,2})?|\b\d{1,3}(?:[,\d]{0,12})(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|INR|JPY|PKR|AED|CAD|AUD)\b)/g },
  dates: {
    label: 'Dates',
    re: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{1,2}\s(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s\d{1,2}(?:st|nd|rd|th)?,?\s\d{4})\b/g,
  },
  urls: { label: 'Web addresses in the text', re: /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/g },
};

// Matches in the visible text of the page, plus mailto:/tel: links for emails and phones.
function extractMatches(doc, key, custom) {
  let re, ok = () => true, linkKind = null;
  if (key === 'custom') {
    try { re = new RegExp(custom.source, 'g' + (custom.caseless ? 'i' : '')); } catch (e) { throw new Error(`That pattern doesn't work: ${e.message}`); }
  } else {
    const p = PATTERNS[key];
    re = new RegExp(p.re.source, p.re.flags);
    ok = p.ok || ok;
    linkKind = p.link || null;
  }
  const items = [], byValue = new Map();
  const add = (value, target, context) => {
    const k = value.toLowerCase();
    let it = byValue.get(k);
    if (it) { it.count++; return; }
    it = { value, target, context, count: 1 };
    byValue.set(k, it);
    items.push(it);
  };
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('script, style, noscript, template, textarea') || !n.nodeValue.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let scanned = 0;
  for (let n = walker.nextNode(); n && scanned < 3_000_000; n = walker.nextNode()) {
    const text = n.nodeValue;
    scanned += text.length;
    if (!isVisible(n.parentElement)) continue;
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (!m[0]) { re.lastIndex++; continue; }
      if (!ok(m[0])) continue;
      const range = doc.createRange();
      range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
      add(m[0].trim(), range, clean(text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50)));
    }
  }
  if (linkKind) {
    for (const a of doc.querySelectorAll(`a[href^="${linkKind === 'email' ? 'mailto:' : 'tel:'}"]`)) {
      const v = decodeURIComponent(a.getAttribute('href').replace(/^(mailto|tel):/i, '').split('?')[0]).trim();
      if (v) add(v, a, `link: ${clean(a.textContent) || v}`);
    }
  }
  return { items, notes: [] };
}

// ---------- Huntsman: images ----------

function extractImages(doc) {
  const items = [], seen = new Set();
  let tiny = 0;
  for (const img of doc.querySelectorAll('img')) {
    const src = img.currentSrc || img.src;
    if (!src || seen.has(src)) continue;
    const w = img.naturalWidth || Number(img.getAttribute('width')) || 0;
    const h = img.naturalHeight || Number(img.getAttribute('height')) || 0;
    if ((w && w <= 2) || (h && h <= 2)) { tiny++; continue; } // tracking pixels
    seen.add(src);
    const alt = img.getAttribute('alt');
    items.push({
      el: img, src, alt: clean(alt), w, h,
      altState: alt === null ? 'missing' : alt.trim() ? 'ok' : 'decorative',
      visible: isVisible(img),
    });
  }
  const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
  return { items, og, notes: [tiny && `${tiny} tracking pixel${tiny === 1 ? '' : 's'} ignored`].filter(Boolean) };
}

// ---------- Reader: clean text ----------

function pickMain(doc) {
  const candidates = [...doc.querySelectorAll('article, main, [role="main"], #content, #main, .post, .post-content, .entry-content, .article-body, #mw-content-text')];
  let best = null, bestScore = 0;
  for (const el of [...candidates, doc.body]) {
    const text = [...el.querySelectorAll('p')].reduce((n, p) => n + clean(p.textContent).length, 0);
    const score = el === doc.body ? text * 0.8 : text;
    if (score > bestScore) { best = el; bestScore = score; }
  }
  return best || doc.body;
}

function inlineMd(el, base) {
  let out = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) { out += n.nodeValue; continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (/^(SCRIPT|STYLE|SUP|NOSCRIPT)$/.test(tag) && !(tag === 'SUP' && !n.classList.contains('reference'))) continue;
    const inner = inlineMd(n, base);
    if (tag === 'A' && n.getAttribute('href') && clean(inner)) {
      let href = n.getAttribute('href');
      try { href = new URL(href, base).href; } catch {}
      out += /^https?:/.test(href) ? `[${clean(inner)}](${href})` : inner;
    } else if (tag === 'STRONG' || tag === 'B') out += clean(inner) ? `**${clean(inner)}**` : '';
    else if (tag === 'EM' || tag === 'I') out += clean(inner) ? `*${clean(inner)}*` : '';
    else if (tag === 'CODE') out += '`' + inner + '`';
    else if (tag === 'BR') out += '\n';
    else out += inner;
  }
  return out;
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TABLE', 'DL', 'DD', 'DT', 'FIGURE', 'FORM', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'MAIN', 'HR']);

// Markdown for an element's own inline content, leaving its block-level children to be read separately.
function ownInlineMd(el, base) {
  let out = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 1 && BLOCK_TAGS.has(n.tagName)) { out += ' '; continue; }
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.nodeType === 1) { const w = document.createElement('div'); w.append(n.cloneNode(true)); out += inlineMd(w, base); }
  }
  return out;
}

function extractText(doc, pageUrl) {
  const root = pickMain(doc);
  const skip = 'nav, footer, aside, header, form, figure, table, .navbox, .infobox, .reflist, .references, .mw-references-wrap, .toc, .sidebar, .hatnote, .noprint, [role="navigation"], [aria-hidden="true"]';
  const blocks = [];
  // Real paragraphs and headings, plus text that sites put straight into divs and other blocks.
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, div, section, article, dd, dt')) {
    if (el.closest(skip) || !isVisible(el)) continue;
    const tag = el.tagName;
    if ((tag === 'P' || tag === 'LI') && el.parentElement.closest('li, blockquote')) continue;
    if (tag === 'LI' && el.closest('nav, ul.menu, .menu')) continue;
    const loose = /^(DIV|SECTION|ARTICLE|DD|DT)$/.test(tag);
    if (loose && el.parentElement.closest('p, li, blockquote, pre, h1, h2, h3, h4, h5, h6')) continue;
    const text = clean((loose ? ownInlineMd(el, pageUrl) : inlineMd(el, pageUrl)).replace(/\n+/g, ' '));
    if (!text || (tag === 'P' && text.length < 2) || (loose && text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').length < 25)) continue;
    let md;
    if (/^H\d$/.test(tag)) md = '#'.repeat(+tag[1]) + ' ' + text;
    else if (tag === 'LI') md = (el.parentElement?.tagName === 'OL' ? '1. ' : '- ') + text;
    else if (tag === 'BLOCKQUOTE') md = '> ' + text;
    else if (tag === 'PRE') md = '```\n' + el.textContent.replace(/\n$/, '') + '\n```';
    else md = text;
    blocks.push({ el, md, kind: tag.toLowerCase() });
  }
  const markdown = blocks.map((b, i) => (b.kind === 'li' && blocks[i - 1]?.kind === 'li' ? '' : i ? '\n' : '') + b.md).join('\n');
  const words = (markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').match(/[\p{L}\p{N}]+/gu) || []).length;
  return { root, blocks, markdown, words, minutes: Math.max(1, Math.round(words / 230)), title: clean(doc.querySelector('h1')?.textContent) || clean(doc.title) };
}

// ---------- exports ----------

function toCsv(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}
