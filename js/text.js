// Words, scent and sentences: how the spiders judge links with no AI model at all.
// The target page gives off a scent (its own words, its aliases, its categories and the titles
// of pages that link to it). Every link a spider sees is sniffed against that scent.

const STOPWORDS = new Set((
  'a about above after again against all almost also although always am among an and another any are around as at away ' +
  'back be became because become been before being below between both but by came can cannot could did do does doing done ' +
  'down during each early either else even ever every few first for former found from further get gets got had has have ' +
  'having he her here hers herself him himself his how however i if in include included includes including into is it its ' +
  'itself just known large last late later latter least less like made main major make many may me might more most mostly ' +
  'much must my near nearly new next no nor not now of off often on once one only or other others otherwise our out over ' +
  'own part per perhaps rather same second several she should since so some such than that the their them themselves then ' +
  'there these they third this those though three through thus to together too two under until up upon use used uses using ' +
  'various very via was way we well were what when where whether which while who whom whose why will with within without ' +
  'would yet you your called name named article list lists page pages wikipedia type types form forms number numbers year ' +
  'years time times century centuries people person largest great high based according along across'
).split(/\s+/).filter(Boolean));

function stem(w) {
  if (/(species|series)$/.test(w)) return w;
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

function words(text) {
  const out = [];
  const folded = String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (const m of folded.matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = m[0];
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    out.push(stem(w));
  }
  return out;
}

class Scent {
  constructor() { this.w = new Map(); this.top = []; }

  add(text, weight, perTermCap = 3) {
    const n = new Map();
    for (const t of words(text)) n.set(t, (n.get(t) || 0) + 1);
    for (const [t, c] of n) this.w.set(t, (this.w.get(t) || 0) + weight * Math.min(c, perTermCap));
  }

  // Keep the strongest terms and scale them so the target's own title words weigh about 1.
  seal(keep = 400) {
    const top = [...this.w].sort((a, b) => b[1] - a[1]).slice(0, keep);
    const max = top[0]?.[1] || 1;
    this.w = new Map(top.map(([t, v]) => [t, v / max]));
    this.top = top.slice(0, 10).map(([t]) => t);
  }

  // 0..1: how strongly a link (its title, and the sentence it sits in) smells of the target.
  smell(title, context = '') {
    let s = 0;
    for (const t of new Set(words(title))) s += 2 * (this.w.get(t) || 0);
    for (const t of new Set(words(context))) s += 0.35 * (this.w.get(t) || 0);
    return 1 - Math.exp(-s / 1.6);
  }

  // The scent terms a piece of text shares with the target, strongest first.
  shared(text, n = 3) {
    return [...new Set(words(text))].filter((t) => this.w.has(t)).sort((a, b) => this.w.get(b) - this.w.get(a)).slice(0, n);
  }
}

// ---------- sentences ----------

const ABBREVIATIONS = new Set(('mr mrs ms dr st mt jr sr vs etc e.g i.e c ca no nos inc ltd co corp u.s u.k fig figs al ' +
  'approx est gen gov sgt col lt capt prof rev ft vol vols pp ed eds op cf jan feb mar apr jun jul aug sep sept oct nov dec fl').split(' '));

// Sentence boundaries as [start, end) offsets. Initials and common abbreviations do not end a sentence.
function sentences(t) {
  const spans = [];
  let start = 0;
  for (const m of t.matchAll(/[.!?…]+["'”’)\]]*\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])/gu)) {
    if (m.index < start) continue;
    if (t[m.index] === '.') {
      const tok = (t.slice(start, m.index).match(/(\S+)$/) || ['', ''])[1].replace(/^[("'“‘\[]+/, '').toLowerCase();
      if (ABBREVIATIONS.has(tok) || /^\p{L}$/u.test(tok) || /^(\p{L}\.)+\p{L}$/u.test(tok)) continue;
    }
    spans.push([start, m.index + m[0].trimEnd().length]);
    start = m.index + m[0].length;
  }
  if (start < t.length) spans.push([start, t.length]);
  return spans;
}

// The sentence (or run of sentences) that covers the span [s, e).
function sentenceAround(t, s, e) {
  let a = 0, b = t.length;
  for (const [x, y] of sentences(t)) {
    if (x <= s) a = x;
    if (y >= e) { b = y; break; }
  }
  return [a, b];
}

// A quotable receipt: the sentence holding a link, clipped around the link if it runs long.
function snippet(t, s, e, max = 300) {
  let [a, b] = sentenceAround(t, s, e);
  if (b - a <= max) return { text: t.slice(a, b), s: s - a, e: e - a };
  let x = Math.max(a, s - Math.floor((max - (e - s)) / 2));
  const y0 = Math.min(b, x + max);
  x = Math.max(a, y0 - max);
  let y = y0;
  if (x > a) { const sp = t.indexOf(' ', x); if (sp > 0 && sp < s) x = sp + 1; }
  if (y < b) { const sp = t.lastIndexOf(' ', y); if (sp > e) y = sp; }
  const pre = x > a ? '… ' : '', post = y < b ? ' …' : '';
  return { text: pre + t.slice(x, y) + post, s: s - x + pre.length, e: e - x + pre.length };
}

// ---------- small shared helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
