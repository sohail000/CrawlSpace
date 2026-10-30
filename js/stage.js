// THE STAGE: the real page, rendered without its scripts, with an overlay where the spiders work.
// Spiders act out results that were really extracted from this page; every catch lands in the results
// panel at the moment the spider makes it, and the page's outline shakes like a web when it does.

const READER_CSS = 'body{font:17px/1.65 Georgia,serif;max-width:46rem;margin:2.5rem auto;padding:0 1.25rem;color:#1d1d1f;background:#fff}' +
  'img{max-width:100%;height:auto}table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #ccc;padding:4px 8px;vertical-align:top}' +
  'a{color:#2457d6}h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25}';
const STAGE_CSS = 'html{scroll-behavior:auto!important}.async-hide{opacity:1!important}a,button{cursor:default!important}.cs-pick,.cs-pick *{cursor:crosshair!important}';
// The dark page: every colour flipped, then pictures flipped back so they keep their real colours.
const NIGHT_CSS = 'html{filter:invert(1) hue-rotate(180deg);background:#fff!important}' +
  'img,picture,video,canvas,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}';
const TAG_FONT = '600 10px "Space Mono", ui-monospace, monospace';

class Stage {
  constructor(els) {
    this.els = els; // { wrap, frame, canvas, caption }
    this.ctx = els.canvas.getContext('2d');
    this.speed = 1;
    this.skip = false;
    this.now = 0;
    this.tick = 0;
    // Where marks sit on the page only changes when the layout does, so their positions are cached and
    // looked up again (a few per frame) after layoutGen moves on. The overlay is only redrawn when something changed.
    this.layoutGen = 0;
    this.busyUntil = 0;
    this.lastView = null;
    this.lastBusy = false;
    this.reset();
    new ResizeObserver(() => this.resize()).observe(els.wrap);
    this.resize();
  }

  reset() {
    this.spiders = []; this.marks = []; this.effects = []; this.waiters = [];
    this.track = null; this.glideTo = null; this.pin = null; this.amp = 0; this.vibColor = '#ffffff'; this.last = {};
    this.dirty = true;
  }

  resize() {
    const r = this.els.wrap.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = r.width; this.H = r.height;
    this.els.canvas.width = Math.round(r.width * this.dpr);
    this.els.canvas.height = Math.round(r.height * this.dpr);
    this.dirty = true;
  }

  // ---------- the page ----------

  async show(page) {
    this.endPick();
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
    if (this.night) head.append(Object.assign(style(NIGHT_CSS), { id: 'cs-night' }));
    const frame = this.els.frame;
    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      frame.srcdoc = '<!doctype html>\n' + doc.documentElement.outerHTML;
    });
    this.doc = frame.contentDocument;
    this.win = frame.contentWindow;
    this.page = page;
    this.watchLayout();
    // The stage is for watching: links and forms on it do nothing when clicked.
    this.doc.addEventListener('click', (e) => { if (e.target.closest?.('a, button, input, select, label, summary, area')) e.preventDefault(); }, true);
    this.doc.addEventListener('submit', (e) => e.preventDefault(), true);
    await new Promise((r) => setTimeout(r, 350)); // let fonts and layout settle
    return this.doc;
  }

  // Anything that moves things around on the page (a resize, a font or an image arriving) invalidates the cached positions.
  watchLayout() {
    this.layoutObserver?.disconnect();
    const moved = () => { this.layoutGen++; this.dirty = true; };
    this.layoutObserver = new ResizeObserver(moved);
    this.layoutObserver.observe(this.doc.documentElement);
    this.doc.addEventListener('load', moved, true); // images fire load without bubbling
    this.doc.fonts?.addEventListener('loadingdone', moved);
  }

  addMark(m, r) {
    m.r = r; m.gen = this.layoutGen;
    this.marks.push(m);
    this.busyUntil = this.now + 0.8; // marks fade and grow in over about half a second
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

  // The box of a result's spot on the page: the whole element, or just the first line of a link or text match.
  itemRect(t) {
    return t ? this.rectOf(t, t.nodeType === 1 && t.tagName !== 'A') : null;
  }

  view() {
    const w = this.win;
    return { x: w.scrollX, y: w.scrollY, w: w.innerWidth, h: w.innerHeight };
  }

  // Bring something into view and pulse it (used when a result is clicked).
  flash(target, color) {
    if (!target || !this.win) return;
    this.glide(target);
    this.effects.push({ type: 'flash', target, color, born: this.now });
  }

  // Scroll the page on stage (and only that, never the window around it) so something sits mid-screen,
  // easing over about 0.4 s. Does nothing if it is already comfortably in view.
  glide(target) {
    const r = this.rectOf(target, true), v = this.win && this.view();
    if (!r) return;
    if (r.y > v.y + 50 && r.y + r.h < v.y + v.h - 50) return;
    const y1 = Math.max(0, Math.min(r.y + r.h / 2 - v.h / 2, this.doc.documentElement.scrollHeight - v.h));
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return this.win.scrollTo(v.x, y1);
    this.glideTo = { y0: v.y, y1, t: 0 };
  }

  vibrate(a, color) { this.amp = Math.min(9, this.amp + a); if (color) this.vibColor = color; }

  setNight(on) {
    this.night = on;
    this.els.wrap.classList.toggle('night', on);
    const d = this.doc;
    if (!d?.head) return;
    const s = d.getElementById('cs-night');
    if (on && !s) d.head.append(Object.assign(d.createElement('style'), { id: 'cs-night', textContent: NIGHT_CSS }));
    if (!on && s) s.remove();
  }

  // A catch peels off the page and hangs behind the spider on a thread. When the string gets long,
  // the oldest piece is sent on to the results panel.
  carry(sp, text, from, color) {
    if (!text || !from) return;
    text = short(text, 24);
    this.ctx.font = TAG_FONT;
    const w = this.ctx.measureText(text).width + 12;
    sp.cargo.unshift({ text, w, x: from.x + Math.min(from.w, w) / 2, y: from.y + from.h / 2, a: 0, color, born: this.now });
    if (sp.cargo.length > 6) this.sendOff(sp.cargo.pop());
  }

  sendOff(t) {
    const v = this.view();
    this.effects.push({ type: 'flytag', x: t.x - v.x, y: t.y - v.y, text: t.text, w: t.w, color: t.color, born: this.now });
  }

  // The carried pieces follow each other like the segments of a rope.
  hang(sp, dt) {
    const k = Math.min(1, dt * 12);
    let px = sp.x - Math.cos(sp.h) * sp.size * 3.4, py = sp.y - Math.sin(sp.h) * sp.size * 3.4, pw = 0;
    for (const t of sp.cargo) {
      t.y += 60 * dt; // a little weight, so the string sags like silk
      const L = 4 + (pw + t.w) * 0.45, dx = t.x - px, dy = t.y - py, d = Math.hypot(dx, dy) || 1;
      if (d > L) { t.x += (px + (dx / d) * L - t.x) * k; t.y += (py + (dy / d) * L - t.y) * k; }
      let a = Math.atan2(t.y - py, t.x - px);
      if (Math.abs(a) > Math.PI / 2) a += Math.PI; // keep the words the right way up
      t.a += (Math.atan2(Math.sin(a), Math.cos(a)) - t.a) * k;
      px = t.x; py = t.y; pw = t.w;
    }
  }

  // Teaching the mimic: the element under the pointer is outlined, a click picks it, Esc cancels.
  startPick(onPick, onCancel) {
    if (!this.doc) return;
    this.endPick();
    const doc = this.doc;
    const valid = (t) => (t && t.nodeType === 1 && t !== doc.body && t !== doc.documentElement ? t : null);
    const move = (e) => { this.hover = valid(e.target); };
    const click = (e) => {
      e.preventDefault(); e.stopPropagation();
      const el = valid(e.target);
      if (el) { this.endPick(); onPick(el); }
    };
    const key = (e) => { if (e.key === 'Escape') { this.endPick(); onCancel(); } };
    doc.documentElement.classList.add('cs-pick');
    doc.addEventListener('mousemove', move, true);
    doc.addEventListener('click', click, true);
    doc.addEventListener('keydown', key, true);
    window.addEventListener('keydown', key, true);
    this.picking = () => {
      doc.documentElement.classList.remove('cs-pick');
      doc.removeEventListener('mousemove', move, true);
      doc.removeEventListener('click', click, true);
      doc.removeEventListener('keydown', key, true);
      window.removeEventListener('keydown', key, true);
    };
  }

  endPick() {
    if (this.picking) this.picking();
    this.picking = null;
    this.hover = null;
  }

  clearMarks(type) { this.marks = this.marks.filter((m) => m.type !== type); this.dirty = true; }

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
    sp.cargo = [];
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
      if (animate && labelOf) this.carry(sp, labelOf(it), this.rectOf(it.el || it.target), def.color);
      onCatch(it);
      if (!animate && (i % 4 === 0 || quick >= 0.02)) await this.wait(quick * (quick >= 0.02 ? 1 : 4));
    }
    for (const t of sp.cargo.splice(0)) this.sendOff(t);
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
    this.addMark(mark, r);
    this.last.links = mark;
    this.vibrate(0.5, def.color);
    if (animate) await this.wait(0.3);
  }

  // Funnel-web: traces the table's edge in silk, wraps it, and sends the bundle to the results.
  async tables(sp, it, animate, def) {
    const r = this.rectOf(it.el, true);
    if (!r) return;
    const mark = { type: 'wrap', target: it.el, color: def.color, walker: null, born: this.now, hatchAt: animate ? Infinity : this.now - 1 };
    this.addMark(mark, r);
    if (animate) {
      await this.go(sp, r.x, r.y);
      mark.walker = sp;
      mark.from = 0;
      const corners = [[r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y]];
      for (let k = 0; k < corners.length; k++) { mark.from = k; await this.go(sp, corners[k][0], corners[k][1]); }
      mark.walker = null;
      mark.hatchAt = this.now;
      this.busyUntil = this.now + 0.7;
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
    this.addMark({ type: 'bite', target: it.target, color: def.color, born: this.now }, r);
    if (animate) this.effects.push({ type: 'burst', x: r.x + r.w / 2, y: r.y + r.h / 2, color: def.color, born: this.now });
    this.vibrate(1, def.color);
    if (animate) await this.wait(0.35);
  }

  // Huntsman: sprints to each image and tags it with its alt-text state.
  async images(sp, it, animate, def) {
    const r = this.rectOf(it.el, true);
    if (!r) return;
    if (animate) await this.go(sp, r.x + 8, r.y + 8, 'sprint');
    this.addMark({ type: 'tag', target: it.el, item: it, color: def.color, born: this.now }, r);
    this.vibrate(0.8, def.color);
    if (animate) await this.wait(0.3);
  }

  // Reader: walks down the margin of each block of text it keeps.
  async text(sp, it, animate, def) {
    const r = this.rectOf(it.el, true);
    if (!r) return;
    const mark = { type: 'margin', target: it.el, color: def.color, walker: null, born: this.now };
    this.addMark(mark, r);
    if (animate) {
      await this.go(sp, r.x - 10, r.y);
      mark.walker = sp;
      await this.go(sp, r.x - 10, r.y + r.h);
      mark.walker = null;
    }
    this.vibrate(0.4, def.color);
  }

  // Mimic: carries the shape of your pick from record to record, and underlines each field it copies.
  async mimic(sp, it, animate, def) {
    const r = this.rectOf(it.el, true);
    if (!r) return;
    const prev = this.last.mimic;
    if (animate) {
      await this.go(sp, r.x + Math.min(r.w / 2, 40), r.y + 4);
      const from = prev && this.rectOf(prev.target, true);
      if (from) { this.effects.push({ type: 'morph', from, to: r, color: def.color, born: this.now }); await this.wait(0.35); }
    }
    const mark = { type: 'stamp', target: it.el, fields: it.fieldEls, pick: it.pick, color: def.color, born: this.now };
    this.addMark(mark, r);
    this.last.mimic = mark;
    this.vibrate(0.7, def.color);
    if (animate) await this.wait(0.25);
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
      if (sp.cargo) this.hang(sp, sdt);
    }
    // camera: keep the working spider in view
    if (this.track && this.win) {
      const v = this.view(), s = this.track;
      const ty = s.y < v.y + 70 || s.y > v.y + v.h - 90 ? s.y - v.h * 0.42 : v.y;
      const tx = s.x < v.x + 30 || s.x > v.x + v.w - 30 ? s.x - v.w * 0.5 : v.x;
      if (Math.abs(ty - v.y) > 1 || Math.abs(tx - v.x) > 1) this.win.scrollTo(v.x + (tx - v.x) * Math.min(1, dt * 7), v.y + (ty - v.y) * Math.min(1, dt * 7));
    }
    if (this.glideTo && this.win) {
      const g = this.glideTo, k = Math.min(1, (g.t += dt) / 0.4);
      this.win.scrollTo(this.win.scrollX, g.y0 + (g.y1 - g.y0) * k * k * (3 - 2 * k));
      if (k >= 1) this.glideTo = null;
    }
    this.amp *= Math.exp(-dt * 3.2);
    this.effects = this.effects.filter((e) => this.now - e.born < 1.6);
    if (!this.needsDraw()) return;
    this.refreshes = 60; // at most this many marks look their position up again per frame
    this.draw();
  }

  // False when the overlay would come out exactly as it already is: nobody moving, nothing fading, no outline
  // shaking, and the page not scrolled since the last draw.
  needsDraw() {
    if (this.dirty || this.lastBusy || this.now < this.busyUntil) return true;
    if (this.spiders.length || this.effects.length || this.hover || this.pin || this.amp > 0.15) return true;
    const v = this.win && this.view(), l = this.lastView;
    return Boolean(v) && (!l || v.x !== l.x || v.y !== l.y || v.w !== l.w || v.h !== l.h);
  }

  markRect(m) {
    if (!m.r || (m.gen !== this.layoutGen && this.refreshes-- > 0)) {
      m.r = this.rectOf(m.target, m.type !== 'knot' && m.type !== 'bite');
      m.gen = this.layoutGen;
    }
    return m.r;
  }

  draw() {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    this.dirty = false;
    this.lastView = this.win ? this.view() : null;
    this.lastBusy = Boolean(this.spiders.length || this.effects.length || this.hover || this.pin || this.amp > 0.15);
    if (this.win && this.doc) {
      const v = this.lastView;
      ctx.save();
      ctx.translate(-v.x, -v.y);
      for (const m of this.marks) this.drawMark(m, v);
      for (const e of this.effects) this.drawEffect(e, v, true);
      for (const sp of this.spiders) { if (sp.cargo?.length) this.drawCargo(sp); sp.draw(ctx, this.now, 1.3, true); }
      if (this.pin) this.drawPin(this.pin);
      if (this.hover) this.drawHover(this.hover);
      ctx.restore();
      for (const e of this.effects) this.drawEffect(e, v, false);
    }
    this.drawOutline();
  }

  drawMark(m, v) {
    const ctx = this.ctx, far = (q) => q.y > v.y + v.h + 400 || q.y + q.h < v.y - 400;
    if (m.r && far(m.r)) return; // off screen: skip it before any position lookup
    const r = this.markRect(m);
    if (!r || far(r)) return;
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
    } else if (m.type === 'stamp') {
      ctx.globalAlpha = 0.07 * age;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 0.85 * age;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.setLineDash([]);
      if (!m.fr || m.frGen !== this.layoutGen) { m.fr = (m.fields || []).map((f) => this.rectOf(f, true)); m.frGen = this.layoutGen; }
      ctx.lineWidth = 2;
      for (const f of m.fr) {
        if (!f) continue;
        ctx.beginPath(); ctx.moveTo(f.x, f.y + f.h + 1); ctx.lineTo(f.x + Math.min(f.w, 420) * age, f.y + f.h + 1); ctx.stroke();
      }
      if (m.pick) this.label(r.x, r.y, 'YOUR PICK', m.color);
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
      const r = this.itemRect(e.target);
      if (r) {
        const k = Math.min(1, t / 1.6);
        ctx.globalAlpha = (1 - k) * (0.6 + 0.4 * Math.sin(t * 18));
        ctx.lineWidth = 3;
        ctx.strokeRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12);
      }
    } else if (inPage && e.type === 'morph' && t < 0.5) {
      // the pick's outline slides over and reshapes itself to the next record
      const k = Math.min(1, t / 0.35), q = k * k * (3 - 2 * k);
      const L = (a, b) => a + (b - a) * q;
      ctx.globalAlpha = 0.9 - k * 0.5; ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(L(e.from.x, e.to.x), L(e.from.y, e.to.y), L(e.from.w, e.to.w), L(e.from.h, e.to.h));
      ctx.setLineDash([]);
    } else if (!inPage && e.type === 'flytag') {
      // a carried piece heads off the right edge, into the results panel
      const k = Math.min(1, t / 0.9), q = k * k;
      const x = e.x + (this.W + e.w - e.x) * q, y = e.y - Math.sin(k * Math.PI) * 50;
      ctx.globalAlpha = 1 - k * 0.4;
      this.tag(x, y, 0, e);
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

  label(x, y, text, color) {
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.font = 'bold 10px "Space Mono", ui-monospace, monospace';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 16, w, 16);
    ctx.fillStyle = '#0b0d12';
    ctx.fillText(text, x + 5, y - 4);
    ctx.fillStyle = color;
  }

  // A caught piece: its text in a small box, turned to lie along the thread.
  tag(x, y, a, t) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = 'rgba(11,13,18,.9)';
    ctx.fillRect(-t.w / 2, -8, t.w, 16);
    ctx.strokeStyle = t.color; ctx.lineWidth = 1;
    ctx.strokeRect(-t.w / 2 + 0.5, -7.5, t.w - 1, 15);
    ctx.fillStyle = t.color; ctx.font = TAG_FONT; ctx.textBaseline = 'middle';
    ctx.fillText(t.text, -t.w / 2 + 6, 0.5);
    ctx.restore();
  }

  drawCargo(sp) {
    const ctx = this.ctx;
    ctx.strokeStyle = sp.color; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sp.x - Math.cos(sp.h) * sp.size * 3.4, sp.y - Math.sin(sp.h) * sp.size * 3.4);
    for (const t of sp.cargo) ctx.lineTo(t.x, t.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (const t of sp.cargo) {
      ctx.globalAlpha = Math.min(1, (this.now - t.born) / 0.25);
      this.tag(t.x, t.y, t.a, t);
    }
    ctx.globalAlpha = 1;
  }

  // The item a result's thread is tied to: a soft pulsing outline, like a flash that holds.
  drawPin(pin) {
    const r = this.itemRect(pin.target);
    if (!r) return;
    const ctx = this.ctx;
    ctx.strokeStyle = ctx.fillStyle = pin.color;
    ctx.globalAlpha = pin.k * (0.14 + 0.1 * Math.sin(this.now * 6));
    ctx.fillRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12);
    ctx.globalAlpha = pin.k * (0.65 + 0.3 * Math.sin(this.now * 6));
    ctx.lineWidth = 2.5;
    ctx.strokeRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12);
    ctx.globalAlpha = 1;
  }

  drawHover(el) {
    const r = this.rectOf(el, true);
    if (!r) return;
    const ctx = this.ctx, c = '#f472b6';
    ctx.fillStyle = ctx.strokeStyle = c;
    ctx.globalAlpha = 0.1; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    this.label(r.x - 1, r.y - 1, 'TEACH WITH THIS', c);
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
