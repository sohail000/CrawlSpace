// THE SPECIMEN: the page a spider is reading, exactly as the model received it.
// While the model reads, the spider walks the paragraphs; when the verdict lands,
// it walks to each passage the model chose and bites it.
import { SpiderBody, GLYPHS } from './spider.js';
import { hostOf } from './web.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Specimen {
  constructor(els, hooks) {
    this.els = els; // { pane, scroller, article, canvas, title, url, meta, rel, follow, empty }
    this.hooks = hooks; // { onFollowChange(follow) }
    this.ctx = els.canvas.getContext('2d');
    this.follow = true;
    this.node = null;
    this.agent = null;
    this.pending = null;
    this.backlog = [];
    this.shownAt = 0;
    this.now = 0;
    this.spider = null;
    this.mode = 'idle'; // reading | biting | idle
    this.biteQueue = [];
    this.threads = [];
    this.scrambles = [];
    this.lastBite = null;
    this.readIdx = 0;
    this.readT = 0;
    new ResizeObserver(() => this.resize()).observe(els.scroller);
    this.resize();
    els.follow.addEventListener('click', () => this.setFollow(true));
  }

  resize() {
    const r = this.els.scroller.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = r.width; this.H = r.height;
    this.els.canvas.width = Math.round(r.width * this.dpr);
    this.els.canvas.height = Math.round(r.height * this.dpr);
  }

  reset() {
    this.node = null; this.pending = null; this.backlog = []; this.spider = null; this.mode = 'idle';
    this.biteQueue = []; this.threads = []; this.scrambles = [];
    this.els.article.innerHTML = '';
    this.els.empty.hidden = false;
    this.els.title.textContent = 'No page yet';
    this.els.url.textContent = ''; this.els.url.removeAttribute('href');
    this.els.meta.textContent = 'Pages appear here the moment a spider starts reading them.';
    this.els.rel.style.setProperty('--v', 0);
    this.setFollow(true);
  }

  setFollow(f) {
    this.follow = f;
    this.els.follow.hidden = f;
    this.hooks.onFollowChange?.(f);
  }

  // ---- called by the director when spider events play ----

  // Follow mode rules: stay on a page until its verdict lands; when any page's verdict lands,
  // go watch those bites (that is the moment that proves the work); otherwise show the newest page.
  onPage(node, agent) {
    if (!this.follow) return;
    if (this.canSwitch()) this.show(node, agent, true);
    else this.pending = { node, agent };
  }

  onBites(node, agent) {
    if (this.node !== node) {
      if (!this.follow || !node.bites.length) return;
      if (this.mode !== 'biting') this.show(node, agent, true);
      else if (!this.backlog.some((x) => x.node === node)) { this.backlog.push({ node, agent }); if (this.backlog.length > 3) this.backlog.shift(); }
      return;
    }
    this.updateHeader();
    if (this.mode === 'reading' && !reduceMotion) {
      this.biteQueue = node.bites.slice();
      this.biteTarget = null;
      this.biteWait = 0.2;
      this.mode = 'biting';
      if (!this.biteQueue.length) this.finish();
    } else {
      this.applyAll();
    }
  }

  canSwitch() {
    if (!this.node) return true;
    return this.mode === 'idle' && this.now - this.shownAt > 2.5;
  }

  pin(node) {
    this.setFollow(false);
    this.show(node, node.by, false);
  }

  focusBite(node, biteId) {
    if (this.node !== node) this.pin(node);
    else if (this.follow) this.setFollow(false);
    const mark = this.els.article.querySelector(`mark[data-bite="${biteId}"]`);
    if (!mark) return;
    mark.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    mark.classList.remove('flash'); void mark.offsetWidth; mark.classList.add('flash');
  }

  // ---- rendering ----

  show(node, agent, live) {
    this.applyAll(); // finish whatever was in progress on the old page
    this.node = node; this.agent = agent;
    if (this.pending?.node === node) this.pending = null;
    this.backlog = this.backlog.filter((x) => x.node !== node);
    this.shownAt = this.now;
    this.threads = []; this.scrambles = []; this.biteQueue = []; this.lastBite = null;
    this.els.empty.hidden = true;
    const html = (node.paragraphs || []).map((p, i) => {
      const tag = p.k === 'h' ? 'h3' : p.k === 'q' ? 'blockquote' : 'p';
      return `<${tag} data-p="${i}"${p.k === 'li' ? ' class="li"' : ''}>${esc(p.t)}</${tag}>`;
    }).join('');
    this.els.article.innerHTML = html;
    this.els.scroller.scrollTop = 0;
    this.updateHeader();
    const color = agent?.color || '#8e9aff';
    this.els.pane.style.setProperty('--reader', color);
    const judged = node.bites.length || node.summary;
    if (live && !judged && !reduceMotion) {
      this.mode = 'reading';
      this.spider = new SpiderBody(20, 20, { color, size: 2.6, speed: 230 });
      this.readIdx = 0; this.readT = 0;
    } else if (live && node.bites.length && !reduceMotion) {
      // verdict landed while this page waited its turn: still walk to each passage and bite it
      this.spider = new SpiderBody(20, 20, { color, size: 2.6, speed: 230 });
      this.biteQueue = node.bites.slice();
      this.biteTarget = null;
      this.biteWait = 0.3;
      this.mode = 'biting';
    } else {
      this.mode = 'idle';
      this.spider = null;
      this.applyAll();
    }
  }

  updateHeader() {
    const n = this.node;
    if (!n) return;
    this.els.title.textContent = n.title || n.host;
    this.els.url.textContent = n.url;
    this.els.url.href = n.url;
    const by = n.by ? `read by ${n.by.name}` : '';
    const verdict = n.bites.length || n.summary
      ? `relevance ${n.relevance} · ${n.bites.length} bite${n.bites.length === 1 ? '' : 's'}${n.judgedBy === 'heuristic' ? ' · keyword judge' : ''}`
      : 'model reading… <span class="rt"></span>';
    this.els.meta.innerHTML = `<span style="color:${n.by?.color || 'inherit'}">${esc(by)}</span> · ${esc(hostOf(n.url))} · ${n.total && n.total > (n.paragraphs?.length || 0) ? `skimmed ${n.paragraphs.length} of ${n.total}` : n.paragraphs?.length || 0} paragraphs · ${n.bites.length || n.summary ? esc(verdict) : verdict}${n.summary ? `<br><span class="sum">${esc(n.summary)}</span>` : ''}`;
    this.els.rel.style.setProperty('--v', (n.relevance || 0) / 100);
  }

  rangeFor(el, s, e) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let pos = 0, startNode = null, startOff = 0, tn;
    const r = document.createRange();
    while ((tn = walker.nextNode())) {
      const len = tn.nodeValue.length;
      if (!startNode && s < pos + len) { startNode = tn; startOff = s - pos; r.setStart(tn, startOff); }
      if (startNode && e <= pos + len) { r.setEnd(tn, e - pos); return r; }
      pos += len;
    }
    return null;
  }

  biteEl(b) { return this.els.article.querySelector(`[data-p="${b.p}"]`); }

  applyBite(b, animate) {
    if (this.els.article.querySelector(`mark[data-bite="${b.id}"]`)) return null;
    const el = this.biteEl(b);
    if (!el) return null;
    const r = this.rangeFor(el, b.s, b.e);
    if (!r) return null;
    const mark = document.createElement('mark');
    mark.dataset.bite = b.id;
    mark.title = b.fact;
    mark.style.setProperty('--c', this.node.by?.color || '#ff2bd6');
    try { r.surroundContents(mark); } catch { return null; } // overlapping another bite: leave it
    if (animate) {
      mark.classList.add('fresh');
      this.scrambles.push({ el: mark, orig: mark.textContent, t: 0, dur: 0.7 });
    }
    return mark;
  }

  applyAll() {
    if (!this.node) return;
    for (const s of this.scrambles) s.el.textContent = s.orig;
    this.scrambles = [];
    for (const b of this.node.bites) this.applyBite(b, false);
    this.biteQueue = [];
    if (this.mode !== 'idle') this.finish();
  }

  finish() { this.mode = 'idle'; if (this.spider) this.spider.twitchy = false; }

  // content-space point for an element or range
  pointOf(target) {
    const sr = this.els.scroller.getBoundingClientRect();
    const rr = target.getBoundingClientRect ? target.getBoundingClientRect() : target;
    const rects = target.getClientRects ? target.getClientRects() : null;
    const r0 = rects && rects.length ? rects[0] : rr;
    return { x: r0.left - sr.left + Math.min(r0.width / 2, 60), y: r0.top - sr.top + this.els.scroller.scrollTop + r0.height / 2, w: r0.width, h: r0.height };
  }

  scrollTo(y) {
    const sc = this.els.scroller;
    if (!this.follow) return;
    const top = sc.scrollTop, h = sc.clientHeight;
    if (y < top + 40 || y > top + h - 60) sc.scrollTo({ top: Math.max(0, y - h * 0.35), behavior: 'smooth' });
  }

  frame(dt) {
    this.now += dt;
    if (this.follow && this.canSwitch()) {
      const next = this.backlog.shift() || (this.pending && this.pending.node !== this.node ? this.pending : null);
      if (next) this.show(next.node, next.agent, true);
    }
    if (this.mode === 'reading' && (this.rtT = (this.rtT || 0) - dt) <= 0) {
      this.rtT = 0.5;
      const rt = this.els.meta.querySelector('.rt');
      if (rt) rt.textContent = `${(this.now - (this.node?.readAt ?? this.shownAt)).toFixed(0)}s`;
    }
    const sp = this.spider;
    if (sp) {
      if (this.mode === 'reading') {
        // walk down the text paragraph by paragraph while the model reads
        this.readT -= dt;
        if (this.readT <= 0 && !sp.moving) {
          const paras = this.els.article.children;
          if (paras.length) {
            const el = paras[Math.min(this.readIdx, paras.length - 1)];
            const pt = this.pointOf(el);
            sp.walk([{ x: 14 + Math.random() * Math.min(260, this.W * 0.5), y: pt.y }]);
            this.scrollTo(pt.y);
            this.readIdx = (this.readIdx + 1 + Math.floor(Math.random() * 2)) % Math.max(1, Math.min(paras.length, 40));
          }
          this.readT = 1.1; // unhurried: the model is reading, not the spider racing
        }
        sp.twitchy = true;
      } else if (this.mode === 'biting' && !sp.moving) {
        if (this.biteTarget) {
          // arrived on a passage: bite it
          const b = this.biteTarget;
          this.biteTarget = null;
          const mark = this.applyBite(b, true);
          if (mark) {
            const pt = this.pointOf(mark);
            if (this.lastBite) this.threads.push({ x1: this.lastBite.x, y1: this.lastBite.y, x2: pt.x, y2: pt.y, life: 1 });
            this.lastBite = pt;
          }
          this.biteWait = 0.4;
        } else if ((this.biteWait -= dt) <= 0) {
          const b = this.biteQueue.shift();
          if (!b) { this.finish(); }
          else {
            const el = this.biteEl(b);
            const r = el && this.rangeFor(el, b.s, b.e);
            if (r) {
              const pt = this.pointOf(r);
              if (Math.abs(pt.y - sp.y) > 500) {
                // far down the page: rappel on a dragline instead of a minute-long walk
                const ny = pt.y - Math.sign(pt.y - sp.y) * 90;
                this.threads.push({ x1: sp.x, y1: sp.y, x2: sp.x, y2: ny, life: 0.6 });
                sp.teleport(sp.x, ny);
              }
              sp.walk([{ x: pt.x, y: pt.y }]);
              this.scrollTo(pt.y);
              this.biteTarget = b;
            }
          }
        }
        sp.twitchy = true;
      }
      sp.update(dt, this.now);
    }
    for (let i = this.scrambles.length - 1; i >= 0; i--) {
      const s = this.scrambles[i];
      s.t += dt;
      const p = s.t / s.dur;
      if (p >= 1 || !s.el.isConnected) { if (s.el.isConnected) s.el.textContent = s.orig; this.scrambles.splice(i, 1); continue; }
      const cut = (p * s.orig.length) | 0;
      let out = '';
      for (let q = 0; q < s.orig.length; q++) out += q < cut || s.orig[q] === ' ' ? s.orig[q] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      s.el.textContent = out;
    }
    this.threads = this.threads.filter((t) => (t.life -= dt / 25) > 0);
    this.draw();
  }

  draw() {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const oy = this.els.scroller.scrollTop;
    ctx.translate(0, -oy);
    const color = this.agent?.color || this.node?.by?.color || '#ff2bd6';
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
    for (const t of this.threads) {
      ctx.globalAlpha = 0.55 * t.life;
      ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
      ctx.fillRect(t.x2 - 2, t.y2 - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    if (this.mode === 'reading') {
      // scan line: the model is reading
      const y = oy + ((this.now * 120) % Math.max(1, this.H));
      const g = ctx.createLinearGradient(0, y - 30, 0, y);
      g.addColorStop(0, 'transparent'); g.addColorStop(1, color);
      ctx.globalAlpha = 0.18; ctx.fillStyle = g; ctx.fillRect(0, y - 30, this.W, 30);
      ctx.globalAlpha = 1;
    }
    if (this.spider) this.spider.draw(ctx, this.now, 1, this.mode !== 'idle');
  }
}
