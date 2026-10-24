// THE STAGE: the real page, rendered without its scripts, with an overlay where the spiders work.
// Spiders act out results that were really extracted from this page; every catch lands in the results
// panel at the moment the spider makes it, and the page's outline shakes like a web when it does.

const READER_CSS = 'body{font:17px/1.65 Georgia,serif;max-width:46rem;margin:2.5rem auto;padding:0 1.25rem;color:#1d1d1f;background:#fff}' +
  'img{max-width:100%;height:auto}table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #ccc;padding:4px 8px;vertical-align:top}' +
  'a{color:#2457d6}h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25}';
const STAGE_CSS = 'html{scroll-behavior:auto!important}.async-hide{opacity:1!important}a,button{cursor:default!important}';

class Stage {
  constructor(els) {
    this.els = els; // { wrap, frame, canvas, caption }
    this.ctx = els.canvas.getContext('2d');
    this.speed = 1;
    this.skip = false;
    this.now = 0;
    this.tick = 0;
    this.reset();
    new ResizeObserver(() => this.resize()).observe(els.wrap);
    this.resize();
  }

  reset() {
    this.spiders = []; this.marks = []; this.effects = []; this.waiters = [];
    this.track = null; this.amp = 0; this.vibColor = '#ffffff'; this.last = {};
  }

  resize() {
    const r = this.els.wrap.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = r.width; this.H = r.height;
    this.els.canvas.width = Math.round(r.width * this.dpr);
    this.els.canvas.height = Math.round(r.height * this.dpr);
  }

  // ---------- the page ----------

  async show(page) {
    this.reset();
    this.stopWaiting();
    const doc = new DOMParser().parseFromString(page.html, 'text/html');
    for (const n of doc.querySelectorAll('script, iframe, frame, object, embed, base, meta[http-equiv], link[rel~="preload"], link[rel~="prefetch"], link[rel~="modulepreload"], link[rel~="manifest"]')) n.remove();
    // lazy images that need scripts to appear: give them their real source
    for (const img of doc.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]')) {
      const real = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
      if (real && (!img.getAttribute('src') || /^data:|blank|placeholder|spacer/i.test(img.getAttribute('src')))) img.setAttribute('src', real);
      if (img.getAttribute('data-srcset') && !img.getAttribute('srcset')) img.setAttribute('srcset', img.getAttribute('data-srcset'));
    }
    const head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.body);
    const style = (css) => { const s = doc.createElement('style'); s.textContent = css; return s; };
    const base = doc.createElement('base');
    base.href = page.url;
    const meta = doc.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    head.prepend(meta, base);
    if (!doc.querySelector('link[rel~="stylesheet"], style')) head.append(style(READER_CSS));
    head.append(style(STAGE_CSS));
    const frame = this.els.frame;
    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      frame.srcdoc = '<!doctype html>\n' + doc.documentElement.outerHTML;
    });
    this.doc = frame.contentDocument;
    this.win = frame.contentWindow;
    this.page = page;
    // The stage is for watching: links and forms on it do nothing when clicked.
    this.doc.addEventListener('click', (e) => { if (e.target.closest?.('a, button, input, select, label, summary, area')) e.preventDefault(); }, true);
    this.doc.addEventListener('submit', (e) => e.preventDefault(), true);
    await new Promise((r) => setTimeout(r, 350)); // let fonts and layout settle
    return this.doc;
  }

  // Where something is, in page coordinates (the whole box, or the first line of a link or text match).
  rectOf(t, whole = false) {
    if (!t || !this.win) return null;
    let r = null;
    if (!whole && t.getClientRects) { const rs = t.getClientRects(); r = rs.length ? rs[0] : null; }
    if (!r || (!r.width && !r.height)) r = t.getBoundingClientRect?.();
    if (!r || (!r.width && !r.height)) return null;
    return { x: r.left + this.win.scrollX, y: r.top + this.win.scrollY, w: r.width, h: r.height };
  }

  view() {
    const w = this.win;
    return { x: w.scrollX, y: w.scrollY, w: w.innerWidth, h: w.innerHeight };
  }

  // Bring something into view and pulse it (used when a result is clicked).
  flash(target, color) {
    if (!target || !this.win) return;
    const el = target.nodeType === 1 ? target : target.startContainer?.parentElement;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.effects.push({ type: 'flash', target, color, born: this.now });
  }

  vibrate(a, color) { this.amp = Math.min(9, this.amp + a); if (color) this.vibColor = color; }

  // ---------- timing ----------

  wait(sec) { return this.skip ? Promise.resolve() : new Promise((r) => this.waiters.push({ t: sec, r })); }
  until(fn) { return this.skip ? Promise.resolve() : new Promise((r) => this.waiters.push({ fn, r })); }
  stopWaiting() { const w = this.waiters; this.waiters = []; for (const x of w) x.r(); }

  setCaption(def, text) {
    const c = this.els.caption;
    if (!def) { c.hidden = true; return; }
    c.hidden = false;
    c.style.setProperty('--c', def.color);
    c.innerHTML = `<i></i><b>${esc(def.name)}</b><span>${esc(text)}</span>`;
  }

  // ---------- a spider's turn ----------

  // Walk (or leap) to a point; far away, drop on a dragline instead of a long trek.
  async go(sp, x, y, how = 'walk') {
    const v = this.view();
    const d = Math.hypot(x - sp.x, y - sp.y);
    if (d > v.h * 1.4) {
      this.effects.push({ type: 'drop', x0: sp.x, y0: sp.y, x1: x, y1: y - 40, color: sp.color, born: this.now });
      sp.teleport(x, y - 40);
    }
    const far = Math.hypot(x - sp.x, y - sp.y);
    if (how === 'jump') {
      await this.wait(0.18); // crouch and aim before the leap
      sp.jump(x, y, Math.min(0.9, 0.5 + far / 1000));
    } else {
      // Walk at the species' own pace; only hurry on long trips, so none takes more than ~1.5s at 1×.
      sp.speedMul = Math.max(1, far / (sp.speed * (how === 'sprint' ? 0.9 : 1.5)));
      sp.walk([{ x, y }]);
    }
    await this.until(() => !sp.moving);
    sp.speedMul = 1;
  }

  async perform(kind, def, items, onCatch, labelOf) {
    const v = this.view();
    const sp = new SpiderBody(v.x + 40, v.y + 40, { color: def.color, species: def.species });
    this.spiders.push(sp);
    this.track = sp;
    this.vibColor = def.color;
    const full = this.speed >= 4 ? 8 : this.speed >= 2 ? 14 : 20;
    const quick = Math.min(0.025, 2.5 / Math.max(1, items.length - full)); // the rest arrive within ~2.5s
    for (let i = 0; i < items.length && !this.stopped; i++) {
      const it = items[i];
      const animate = i < full && !this.skip;
      this.setCaption(def, animate ? `${def.verb} ${i + 1} of ${items.length}${labelOf ? ' · ' + labelOf(it) : ''}` : `catching the other ${items.length - full} quickly…`);
      await this[kind](sp, it, animate, def);
      onCatch(it);
      if (!animate && (i % 4 === 0 || quick >= 0.02)) await this.wait(quick * (quick >= 0.02 ? 1 : 4));
    }
    this.setCaption(def, items.length ? `done: ${items.length} caught` : 'nothing to catch on this page');
    await this.wait(items.length ? 0.5 : 0.9);
    this.spiders = this.spiders.filter((s) => s !== sp);
    if (this.track === sp) this.track = null;
  }

  // Orb-weaver: walks link to link, anchoring a dragline at each one.
  async links(sp, it, animate, def) {
    const r = this.rectOf(it.el);
    if (!r) return;
    if (animate) await this.go(sp, r.x - 3, r.y + r.h / 2);
    const mark = { type: 'knot', target: it.el, item: it, color: def.color, prev: this.last.links || null, walked: animate, born: this.now };
    this.marks.push(mark);
    this.last.links = mark;
    this.vibrate(0.5, def.color);
    if (animate) await this.wait(0.3);
  }

  // Funnel-web: traces the table's edge in silk, wraps it, and sends the bundle to the results.
  async tables(sp, it, animate, def) {
    const r = this.rectOf(it.el, true);
    if (!r) return;
    const mark = { type: 'wrap', target: it.el, color: def.color, walker: null, born: this.now, hatchAt: animate ? Infinity : this.now - 1 };
    this.marks.push(mark);
    if (animate) {
      await this.go(sp, r.x, r.y);
      mark.walker = sp;
      mark.from = 0;
      const corners = [[r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y]];
      for (let k = 0; k < corners.length; k++) { mark.from = k; await this.go(sp, corners[k][0], corners[k][1]); }
      mark.walker = null;
      mark.hatchAt = this.now;
      await this.wait(0.45);
      const v = this.view();
      this.effects.push({ type: 'fly', x: r.x + r.w / 2 - v.x, y: r.y + Math.min(r.h, v.h) / 2 - v.y, color: def.color, born: this.now });
    }
    this.vibrate(2.5, def.color);
  }

  // Jumping spider: leaps from match to match and bites each one.
  async regex(sp, it, animate, def) {
    const r = this.rectOf(it.target);
    if (!r) return;
    if (animate) await this.go(sp, r.x + r.w / 2, r.y - 3, 'jump');
    this.marks.push({ type: 'bite', target: it.target, color: def.color, born: this.now });
    if (animate) this.effects.push({ type: 'burst', x: r.x + r.w / 2, y: r.y + r.h / 2, color: def.color, born: this.now });
    this.vibrate(1, def.color);
    if (animate) await this.wait(0.35);
  }

  // Huntsman: sprints to each image and tags it with its alt-text state.
  async images(sp, it, animate, def) {
    const r = this.rectOf(it.el, true);
    if (!r) return;
    if (animate) await this.go(sp, r.x + 8, r.y + 8, 'sprint');
    this.marks.push({ type: 'tag', target: it.el, item: it, color: def.color, born: this.now });
    this.vibrate(0.8, def.color);
    if (animate) await this.wait(0.3);
  }

  // Reader: walks down the margin of each block of text it keeps.
  async text(sp, it, animate, def) {
    const r = this.rectOf(it.el, true);
    if (!r) return;
    const mark = { type: 'margin', target: it.el, color: def.color, walker: null, born: this.now };
    this.marks.push(mark);
    if (animate) {
      await this.go(sp, r.x - 10, r.y);
      mark.walker = sp;
      await this.go(sp, r.x - 10, r.y + r.h);
      mark.walker = null;
    }
    this.vibrate(0.4, def.color);
  }

  // ---------- frame ----------

  frame(dt) {
    this.now += dt;
    this.tick++;
    const sdt = dt * this.speed;
    for (const w of [...this.waiters]) {
      const done = this.skip || (w.fn ? w.fn() : (w.t -= sdt) <= 0);
      if (done) { this.waiters.splice(this.waiters.indexOf(w), 1); w.r(); }
    }
    for (const sp of this.spiders) {
      sp.twitchy = !sp.moving;
      sp.update(sdt, this.now);
      if (this.skip && sp.moving) sp.teleport(sp.path[0]?.x ?? sp.leap?.x1 ?? sp.x, sp.path[0]?.y ?? sp.leap?.y1 ?? sp.y);
    }
    // camera: keep the working spider in view
    if (this.track && this.win) {
      const v = this.view(), s = this.track;
      const ty = s.y < v.y + 70 || s.y > v.y + v.h - 90 ? s.y - v.h * 0.42 : v.y;
      const tx = s.x < v.x + 30 || s.x > v.x + v.w - 30 ? s.x - v.w * 0.5 : v.x;
      if (Math.abs(ty - v.y) > 1 || Math.abs(tx - v.x) > 1) this.win.scrollTo(v.x + (tx - v.x) * Math.min(1, dt * 7), v.y + (ty - v.y) * Math.min(1, dt * 7));
    }
    this.amp *= Math.exp(-dt * 3.2);
    this.effects = this.effects.filter((e) => this.now - e.born < 1.6);
    this.draw();
  }

  markRect(m) {
    if (!m.r || this.tick % 8 === 0) m.r = this.rectOf(m.target, m.type === 'wrap' || m.type === 'tag' || m.type === 'margin');
    return m.r;
  }

  draw() {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.win && this.doc) {
      const v = this.view();
      ctx.save();
      ctx.translate(-v.x, -v.y);
      for (const m of this.marks) this.drawMark(m, v);
      for (const e of this.effects) this.drawEffect(e, v, true);
      for (const sp of this.spiders) sp.draw(ctx, this.now, 1.3, sp.moving);
      ctx.restore();
      for (const e of this.effects) this.drawEffect(e, v, false);
    }
    this.drawOutline();
  }

  drawMark(m, v) {
    const ctx = this.ctx, r = this.markRect(m);
    if (!r || r.y > v.y + v.h + 400 || r.y + r.h < v.y - 400) return;
    const age = Math.min(1, (this.now - m.born) / 0.35);
    ctx.strokeStyle = ctx.fillStyle = m.color;
    ctx.lineWidth = 1.2;
    if (m.type === 'knot') {
      const broken = m.item.status && (m.item.status >= 400 || m.item.status < 0);
      if (m.prev && m.walked) {
        // silk only between neighbours the spider actually walked between
        const p = this.markRect(m.prev);
        if (p && Math.hypot(p.x - r.x, p.y - r.y) < 260) { ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(p.x - 3, p.y + p.h / 2); ctx.lineTo(r.x - 3, r.y + r.h / 2); ctx.stroke(); }
      }
      ctx.globalAlpha = 0.9 * age;
      if (broken) ctx.fillStyle = ctx.strokeStyle = '#ff4d6d';
      ctx.beginPath(); ctx.arc(r.x - 3, r.y + r.h / 2, broken ? 3.5 : 2.4, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 0.18 * age;
      ctx.fillRect(r.x - 1, r.y + r.h - 2, r.w + 2, 2);
    } else if (m.type === 'wrap') {
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (m.walker) {
        const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
        ctx.moveTo(r.x, r.y);
        for (let k = 1; k <= m.from; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.lineTo(m.walker.x, m.walker.y);
      } else ctx.rect(r.x, r.y, r.w, r.h);
      ctx.stroke();
      const h = Math.min(1, Math.max(0, (this.now - m.hatchAt) / 0.45));
      if (h > 0) {
        ctx.save();
        ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        ctx.globalAlpha = 0.07 + 0.05 * h;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 0.28 * h;
        ctx.lineWidth = 1;
        const step = 22;
        ctx.beginPath();
        for (let d = -r.h; d < r.w * h; d += step) { ctx.moveTo(r.x + d, r.y); ctx.lineTo(r.x + d + r.h, r.y + r.h); ctx.moveTo(r.x + d + r.h, r.y); ctx.lineTo(r.x + d, r.y + r.h); }
        ctx.stroke();
        ctx.restore();
      }
    } else if (m.type === 'bite') {
      ctx.globalAlpha = 0.28 * age;
      ctx.fillRect(r.x - 2, r.y - 1, r.w + 4, r.h + 2);
      ctx.globalAlpha = 0.95 * age;
      ctx.strokeRect(r.x - 2, r.y - 1, r.w + 4, r.h + 2);
    } else if (m.type === 'tag') {
      const it = m.item, ok = it.altState === 'ok';
      const label = ok ? 'ALT ✓' : it.altState === 'decorative' ? 'DECORATIVE' : 'NO ALT';
      ctx.globalAlpha = 0.9 * age;
      ctx.strokeStyle = ok ? m.color : '#ff4d6d';
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.font = 'bold 10px "Space Mono", ui-monospace, monospace';
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = ok ? m.color : '#ff4d6d';
      ctx.fillRect(r.x, r.y, w, 16);
      ctx.fillStyle = '#0b0d12';
      ctx.fillText(label, r.x + 5, r.y + 12);
    } else if (m.type === 'margin') {
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2;
      const y1 = m.walker ? m.walker.y : r.y + r.h;
      ctx.beginPath(); ctx.moveTo(r.x - 10, r.y); ctx.lineTo(r.x - 10, y1); ctx.stroke();
      if (!m.walker) { ctx.globalAlpha = 0.07 * age; ctx.fillRect(r.x - 4, r.y - 2, r.w + 8, r.h + 4); }
    }
    ctx.globalAlpha = 1;
  }

  drawEffect(e, v, inPage) {
    const ctx = this.ctx, t = this.now - e.born;
    ctx.strokeStyle = ctx.fillStyle = e.color;
    if (inPage && e.type === 'burst') {
      const k = Math.min(1, t / 0.5);
      ctx.globalAlpha = 1 - k; ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.2832, r0 = 6 + k * 10, r1 = 10 + k * 18;
        ctx.beginPath(); ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0); ctx.lineTo(e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1); ctx.stroke();
      }
    } else if (inPage && e.type === 'drop') {
      ctx.globalAlpha = Math.max(0, 0.6 - t / 1.4); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(e.x0, e.y0); ctx.lineTo(e.x1, e.y1); ctx.stroke();
    } else if (inPage && e.type === 'flash') {
      const r = this.rectOf(e.target, e.target.nodeType === 1 && e.target.tagName !== 'A');
      if (r) {
        const k = Math.min(1, t / 1.6);
        ctx.globalAlpha = (1 - k) * (0.6 + 0.4 * Math.sin(t * 18));
        ctx.lineWidth = 3;
        ctx.strokeRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12);
      }
    } else if (!inPage && e.type === 'fly') {
      // the wrapped bundle heads for the results panel, off the right edge
      const k = Math.min(1, t / 0.7), q = k * k;
      const x = e.x + (this.W + 30 - e.x) * q, y = e.y - Math.sin(k * Math.PI) * 60;
      ctx.globalAlpha = 1 - k * 0.3;
      ctx.beginPath(); ctx.arc(x, y, 7 - k * 2, 0, 6.2832); ctx.fill();
      ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.quadraticCurveTo((e.x + x) / 2, Math.min(e.y, y) - 40, x, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // The page's outline is a web: catches set it shaking, and it settles back.
  drawOutline() {
    const { ctx, W, H } = this;
    const a = this.amp;
    ctx.lineWidth = a > 0.15 ? 1.6 : 1;
    ctx.strokeStyle = a > 0.15 ? this.vibColor : 'rgba(255,255,255,.12)';
    ctx.globalAlpha = a > 0.15 ? Math.min(1, 0.35 + a / 6) : 1;
    const edge = (x0, y0, x1, y1, phase) => {
      const n = 40, len = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const u = i / n, env = Math.sin(u * Math.PI);
        const off = a * env * Math.sin(u * Math.PI * 3 + this.now * 38 + phase);
        const x = x0 + (x1 - x0) * u + nx * off, y = y0 + (y1 - y0) * u + ny * off;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    const p = 1.5;
    edge(p, p, W - p, p, 0); edge(W - p, p, W - p, H - p, 1); edge(W - p, H - p, p, H - p, 2); edge(p, H - p, p, p, 3);
    ctx.globalAlpha = 1;
  }
}
