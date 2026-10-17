// THE SPECIMEN: the page a hunter is reading, as clean text with every article link underlined.
// When the hunter has judged the page, a spider walks to each sentence holding a link it chose and
// bites it: those sentences are the evidence for every step. Gold is the sentence that reaches the target.

const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// One paragraph as HTML: link spans, bitten sentences and the bitten link inside each.
function paraHTML(para, bites) {
  const t = para.t;
  const cuts = new Set([0, t.length]);
  for (const l of para.links) { cuts.add(l.s); cuts.add(l.e); }
  for (const b of bites) { cuts.add(b.s); cuts.add(b.e); cuts.add(b.as); cuts.add(b.ae); }
  const pts = [...cuts].filter((x) => x >= 0 && x <= t.length).sort((a, b) => a - b);
  let html = '';
  for (let j = 0; j < pts.length - 1; j++) {
    const a = pts[j], b = pts[j + 1];
    if (b <= a) continue;
    const seg = esc(t.slice(a, b));
    const link = para.links.some((l) => l.s <= a && b <= l.e);
    const bite = bites.find((x) => x.s <= a && b <= x.e);
    const anchor = bites.find((x) => x.as <= a && b <= x.ae);
    const cls = [link && 'lk', bite && `bt ${bite.kind}`, anchor && 'an'].filter(Boolean).join(' ');
    const id = anchor && a === anchor.as ? ` data-bite="${anchor.id}"` : '';
    html += cls ? `<span class="${cls}"${id}>${seg}</span>` : seg;
  }
  return html;
}

class Specimen {
  constructor(els, hooks) {
    this.els = els; // { pane, scroller, article, canvas, title, url, meta, follow, empty }
    this.hooks = hooks;
    this.ctx = els.canvas.getContext('2d');
    this.speed = 1;
    this.follow = true;
    this.now = 0;
    this.reset();
    new ResizeObserver(() => this.resize()).observe(els.scroller);
    this.resize();
    els.follow.addEventListener('click', () => this.setFollow(true));
    els.scroller.addEventListener('wheel', () => { if (this.node) this.setFollow(false); }, { passive: true });
    els.scroller.addEventListener('touchmove', () => { if (this.node) this.setFollow(false); }, { passive: true });
  }

  resize() {
    const r = this.els.scroller.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = r.width; this.H = r.height;
    this.els.canvas.width = Math.round(r.width * this.dpr);
    this.els.canvas.height = Math.round(r.height * this.dpr);
  }

  reset() {
    this.node = null; this.agent = null; this.pending = null; this.backlog = []; this.locked = false;
    this.spider = null; this.mode = 'idle'; this.applied = new Set();
    this.biteQueue = []; this.biteTarget = null; this.threads = []; this.scrambles = []; this.lastBite = null;
    this.els.article.innerHTML = '';
    this.els.empty.hidden = false;
    this.els.title.textContent = 'No page yet';
    this.els.url.textContent = ''; this.els.url.removeAttribute('href');
    this.els.meta.textContent = 'Pages appear here the moment a spider starts reading them.';
    this.setFollow(true);
  }

  setFollow(f) {
    this.follow = f;
    this.els.follow.hidden = f || !this.node;
  }

  // ---- called by the director as spider events play ----

  // Follow rules: stay on a page until its bites are done; when a page's bites land, go watch them
  // (that is the moment that shows the work); otherwise show the newest page.
  onPage(node, agent) {
    if (!this.follow || this.locked) return;
    if (this.canSwitch()) this.show(node, agent, true);
    else this.pending = { node, agent };
  }

  onBites(node, agent) {
    if (this.node !== node) {
      if (!this.follow || this.locked || !node.bites.length) return;
      const found = node.bites.some((b) => b.kind === 'found');
      if (found || this.canSwitch()) this.show(node, agent, true);
      else if (!this.backlog.some((x) => x.node === node)) { this.backlog.push({ node, agent }); if (this.backlog.length > 2) this.backlog.shift(); }
      return;
    }
    this.updateHeader();
    const fresh = node.bites.filter((b) => !this.applied.has(b.id) && !this.biteQueue.includes(b));
    if (!fresh.length) return;
    if (reduceMotion || !this.spider) { for (const b of fresh) this.applyBite(b, false); return; }
    this.biteQueue.push(...fresh);
    if (this.mode === 'idle') { this.mode = 'biting'; this.biteWait = 0.15; }
  }

  canSwitch() {
    if (!this.node) return true;
    if (this.mode === 'biting' || this.mode === 'reading') return false;
    const age = this.now - this.shownAt;
    if (!this.node.judged && this.node.state === 'read' && age < 6) return false; // wait for its verdict
    return age > 1.4 / this.speed;
  }

  pin(node) {
    this.setFollow(false);
    this.show(node, node.by, false);
  }

  // The hunt is over: settle on the page whose sentence reaches the target.
  settle(node) {
    this.locked = true;
    this.backlog = []; this.pending = null;
    if (this.node !== node) this.show(node, node.by, true);
  }

  focusBite(node, biteId) {
    if (this.node !== node) this.pin(node);
    else this.setFollow(false);
    const el = this.els.article.querySelector(`[data-bite="${biteId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  // Show one receipt from the bridge: the sentence on `node` that links onward.
  focusReceipt(node, r) {
    if (!node.bites.some((b) => b.p === r.p && b.as === r.as)) {
      node.bites.push({ id: `${node.id}r${r.p}_${r.as}`, p: r.p, s: r.ss, e: r.se, as: r.as, ae: r.ae, kind: 'found' });
    }
    const b = node.bites.find((x) => x.p === r.p && x.as === r.as);
    if (this.node !== node) this.pin(node);
    if (!this.applied.has(b.id)) this.applyBite(b, false);
    this.focusBite(node, b.id);
  }

  // ---- rendering ----

  show(node, agent, live) {
    this.flush();
    this.node = node; this.agent = agent;
    if (this.pending?.node === node) this.pending = null;
    this.backlog = this.backlog.filter((x) => x.node !== node);
    this.shownAt = this.now;
    this.threads = []; this.scrambles = []; this.biteQueue = []; this.biteTarget = null; this.lastBite = null;
    this.applied = new Set(live && !reduceMotion ? [] : node.bites.map((b) => b.id));
    this.els.empty.hidden = true;
    this.els.article.innerHTML = (node.paragraphs || []).map((p, i) => this.paraEl(p, i)).join('');
    this.els.scroller.scrollTop = 0;
    this.updateHeader();
    const color = agent?.color || '#8e9aff';
    this.els.pane.style.setProperty('--reader', color);
    if (live && !reduceMotion) {
      this.spider = new SpiderBody(24, 24, { color, size: 2.6, speed: 260 });
      this.mode = 'reading';
      this.readT = 0; this.readIdx = 0; this.sweep = 0;
      if (node.bites.length) { this.biteQueue = node.bites.slice(); this.biteWait = 0.6; }
    } else {
      this.mode = 'idle';
      this.spider = null;
    }
    this.els.follow.hidden = this.follow;
  }

  paraEl(para, i) {
    const tag = para.k === 'h' ? 'h3' : para.k === 'q' ? 'blockquote' : 'p';
    const cls = para.k === 'li' ? ' class="li"' : para.k === 'i' ? ' class="ib"' : '';
    const bites = this.node.bites.filter((b) => b.p === i && this.applied.has(b.id));
    return `<${tag} data-p="${i}"${cls}>${paraHTML(para, bites)}</${tag}>`;
  }

  rerender(p) {
    const el = this.els.article.querySelector(`[data-p="${p}"]`);
    if (!el) return null;
    const tmp = document.createElement('div');
    tmp.innerHTML = this.paraEl(this.node.paragraphs[p], p);
    const fresh = tmp.firstElementChild;
    el.replaceWith(fresh);
    return fresh;
  }

  updateHeader() {
    const n = this.node;
    if (!n) return;
    this.els.title.textContent = n.title;
    this.els.url.textContent = n.url || '';
    if (n.url) this.els.url.href = n.url;
    const by = n.by ? `<span style="color:${n.by.color}">read by ${esc(n.by.name)}</span> · ` : '';
    const hot = n.bites.filter((b) => b.kind === 'hot').length;
    const found = n.bites.some((b) => b.kind === 'found');
    const verdict = found ? `<b class="gold">links to the target</b>`
      : n.bites.length ? `${n.bites.length} sentence${n.bites.length === 1 ? '' : 's'} bitten${hot ? `, <b class="cy">${hot} lead${hot === 1 ? 's' : ''} straight to the target</b>` : ''}`
      : 'judging links…';
    this.els.meta.innerHTML = `${by}${(n.paragraphs || []).length} paragraphs · ${n.linkCount || 0} links · ${verdict}`;
  }

  biteEl(b) { return this.els.article.querySelector(`[data-p="${b.p}"]`); }

  applyBite(b, animate) {
    if (this.applied.has(b.id)) return null;
    this.applied.add(b.id);
    const el = this.rerender(b.p);
    const mark = el?.querySelector(`[data-bite="${b.id}"]`);
    if (!mark) return null;
    if (animate) {
      mark.classList.add('fresh');
      this.scrambles.push({ el: mark, orig: mark.textContent, t: 0, dur: 0.6 });
    }
    return mark;
  }

  flush() {
    for (const s of this.scrambles) if (s.el.isConnected) s.el.textContent = s.orig;
    this.scrambles = [];
    if (this.node) for (const b of this.biteQueue) this.applied.add(b.id);
    this.biteQueue = [];
  }

  // content-space point for an element
  pointOf(el) {
    const sr = this.els.scroller.getBoundingClientRect();
    const rects = el.getClientRects();
    const r0 = rects.length ? rects[0] : el.getBoundingClientRect();
    return { x: r0.left - sr.left + Math.min(r0.width / 2, 60), y: r0.top - sr.top + this.els.scroller.scrollTop + r0.height / 2 };
  }

  scrollTo(y) {
    if (!this.follow) return;
    const sc = this.els.scroller;
    const top = sc.scrollTop, h = sc.clientHeight;
    if (y < top + 40 || y > top + h - 60) sc.scrollTo({ top: Math.max(0, y - h * 0.35), behavior: 'smooth' });
  }

  frame(dt) {
    this.now += dt;
    const sdt = dt * this.speed;
    if (this.follow && this.canSwitch()) {
      const next = this.backlog.shift() || (this.pending && this.pending.node !== this.node ? this.pending : null);
      if (next) this.show(next.node, next.agent, true);
    }
    const sp = this.spider;
    if (sp) {
      sp.speedMul = this.speed;
      if (this.mode === 'reading') {
        // one quick pass down the page: the hunter reads every paragraph and smells every link
        this.sweep += sdt;
        this.readT -= sdt;
        if (this.readT <= 0 && !sp.moving) {
          const paras = this.els.article.children;
          if (paras.length) {
            const el = paras[Math.min(this.readIdx, paras.length - 1)];
            const pt = this.pointOf(el);
            sp.walk([{ x: 16 + Math.random() * Math.min(240, this.W * 0.5), y: pt.y }]);
            this.readIdx += 1 + Math.floor(Math.random() * 2);
          }
          this.readT = 0.35;
        }
        sp.twitchy = true;
        if (this.sweep > 1.1) {
          if (this.biteQueue.length) { this.mode = 'biting'; this.biteWait = 0.1; }
          else { this.mode = 'idle'; sp.twitchy = false; }
        }
      } else if (this.mode === 'biting' && !sp.moving) {
        if (this.biteTarget) {
          const b = this.biteTarget;
          this.biteTarget = null;
          const mark = this.applyBite(b, true);
          if (mark) {
            const pt = this.pointOf(mark);
            if (this.lastBite) this.threads.push({ x1: this.lastBite.x, y1: this.lastBite.y, x2: pt.x, y2: pt.y, life: 1, gold: b.kind === 'found' });
            this.lastBite = pt;
            this.updateHeader();
          }
          this.biteWait = b.kind === 'found' ? 0.8 : 0.3;
        } else if ((this.biteWait -= sdt) <= 0) {
          const b = this.biteQueue.shift();
          if (!b) { this.mode = 'idle'; sp.twitchy = false; }
          else {
            const el = this.biteEl(b);
            if (el) {
              const pt = this.pointOf(el);
              if (Math.abs(pt.y - sp.y) > 500) {
                // far down the page: rappel on a dragline instead of a long walk
                const ny = pt.y - Math.sign(pt.y - sp.y) * 90;
                this.threads.push({ x1: sp.x, y1: sp.y, x2: sp.x, y2: ny, life: 0.6 });
                sp.teleport(sp.x, ny);
              }
              sp.walk([{ x: pt.x, y: pt.y }]);
              this.scrollTo(pt.y);
              this.biteTarget = b;
            }
          }
          sp.twitchy = true;
        }
      }
      if (this.mode === 'reading') this.scrollTo(sp.y);
      sp.update(dt, this.now);
    }
    for (let i = this.scrambles.length - 1; i >= 0; i--) {
      const s = this.scrambles[i];
      s.t += sdt;
      const p = s.t / s.dur;
      if (p >= 1 || !s.el.isConnected) { if (s.el.isConnected) s.el.textContent = s.orig; this.scrambles.splice(i, 1); continue; }
      const cut = (p * s.orig.length) | 0;
      let out = '';
      for (let q = 0; q < s.orig.length; q++) out += q < cut || s.orig[q] === ' ' ? s.orig[q] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      s.el.textContent = out;
    }
    this.threads = this.threads.filter((t) => (t.life -= sdt / 25) > 0);
    this.draw();
  }

  draw() {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const oy = this.els.scroller.scrollTop;
    ctx.translate(0, -oy);
    const color = this.agent?.color || this.node?.by?.color || '#ff2bd6';
    ctx.lineWidth = 1;
    for (const t of this.threads) {
      ctx.strokeStyle = ctx.fillStyle = t.gold ? '#ffd166' : color;
      ctx.globalAlpha = 0.55 * t.life;
      ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
      ctx.fillRect(t.x2 - 2, t.y2 - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    if (this.mode === 'reading' && this.sweep < 1.2) {
      // scan line: one pass over the page
      const y = oy + (this.sweep / 1.2) * this.H;
      const g = ctx.createLinearGradient(0, y - 30, 0, y);
      g.addColorStop(0, 'transparent'); g.addColorStop(1, color);
      ctx.globalAlpha = 0.18; ctx.fillStyle = g; ctx.fillRect(0, y - 30, this.W, 30);
      ctx.globalAlpha = 1;
    }
    if (this.spider) this.spider.draw(ctx, this.now, 1, this.mode !== 'idle');
  }
}
