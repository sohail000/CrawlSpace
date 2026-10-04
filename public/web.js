// THE WEB: the live crawl graph. Every node is a real URL, every thread a real link,
// every spider a real worker on the server. Events are played per spider, in order.
import { SpiderBody, PALETTE } from './spider.js';

const RING = 170;
const MONO = '"Space Mono", ui-monospace, Menlo, Consolas, monospace';

// Events that need the spider to be standing on its node before they play.
const NEEDS_ARRIVAL = new Set(['page', 'bites', 'links', 'fail', 'frontier']);
const ARRIVAL_STATES = new Set(['read', 'judge', 'rest', 'idle', 'home']);
// Global events that wait until every spider has finished playing its backlog.
const AFTER_SPIDERS = new Set(['crawl-end', 'weave-start', 'weave-text', 'end']);

const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
export function hostOf(url) { try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; } }
function pathOf(url) { try { const u = new URL(url); return decodeURIComponent(u.pathname + u.search); } catch { return ''; } }

export class WebView {
  constructor(canvas, tip, hooks) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.tip = tip;
    this.hooks = hooks; // { onPlay(ev, agent), onSelect(node), onGlobal(ev) }
    this.W = 300; this.H = 300; this.dpr = 1;
    this.cam = { x: 0, y: 0, s: 1 };
    this.mouse = null;
    this.selected = null;
    this.now = 0;
    this.reset('');
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(); this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    canvas.addEventListener('mouseleave', () => { this.mouse = null; this.tip.hidden = true; });
    canvas.addEventListener('click', () => { const h = this.hover; if (h && h.node && h.node.state === 'read') this.hooks.onSelect(h.node); });
  }

  reset(question) {
    this.question = question;
    this.hub = { id: 'hub', x: 0, y: 0, depth: -1, state: 'hub', fixed: true };
    this.nodes = new Map([['hub', this.hub]]);
    this.agents = new Map();
    this.global = [];
    this.flashes = [];
    this.weaveState = null;
    this.weaver = new SpiderBody(0, 0, { color: '#ffffff', size: 4.6, speed: 90 });
    this.weaver.rest = { x: 0, y: -2 };
    this.selected = null;
  }

  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(50, r.width); this.H = Math.max(50, r.height);
    this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
  }

  // ---------- event intake ----------

  push(ev) {
    if (ev.spider && this.agents.has(ev.spider)) this.agents.get(ev.spider).queue.push(ev);
    else this.global.push(ev);
  }

  addSpider(ev, i) {
    const color = PALETTE[i % PALETTE.length];
    const ang = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const spot = { x: Math.cos(ang) * 44, y: Math.sin(ang) * 44 };
    const body = new SpiderBody(spot.x, spot.y, { color, size: 3.6, speed: 160 });
    body.rest = spot;
    const agent = { id: ev.id, name: ev.name, color, body, spot, at: this.hub, node: null, queue: [], hold: 0, label: 'ready', tone: '', spin: null, feelers: null, state: 'idle', t0: 0 };
    this.agents.set(ev.id, agent);
    return agent;
  }

  get drained() {
    for (const a of this.agents.values()) if (a.queue.length || a.hold > 0 || a.body.moving) return false;
    return true;
  }

  ensureNode(item, parentId) {
    let n = this.nodes.get(item.id);
    if (n) return n;
    const parent = this.nodes.get(item.parent || parentId) || this.hub;
    const siblings = [...this.nodes.values()].filter((x) => x.parent === parent).length;
    let ang;
    if (parent === this.hub) ang = siblings * 2.39996 - Math.PI / 2; // golden angle spread around the hub
    else ang = Math.atan2(parent.y, parent.x) + (siblings % 2 ? 1 : -1) * (0.25 + 0.18 * Math.floor(siblings / 2));
    const dist = parent === this.hub ? 70 : 42;
    n = {
      id: item.id, url: item.url, host: hostOf(item.url), parent, depth: item.depth ?? (parent.depth + 1),
      x: parent.x + Math.cos(ang) * dist, y: parent.y + Math.sin(ang) * dist, vx: 0, vy: 0,
      state: 'frontier', anchor: item.anchor, score: item.score, why: item.why, born: this.now,
      title: '', relevance: 0, bites: [], paragraphs: null, summary: '', by: null,
    };
    this.nodes.set(n.id, n);
    return n;
  }

  // Route along existing threads: up to the common ancestor, then down to the target.
  treePath(from, to) {
    const up = (n) => { const out = []; while (n) { out.push(n); n = n.parent; } return out; };
    const a = up(from), b = up(to);
    const inB = new Set(b);
    const lca = a.find((n) => inB.has(n)) || this.hub;
    const path = [];
    for (const n of a) { if (n === lca) break; path.push(n); }
    path.push(lca);
    const down = [];
    for (const n of b) { if (n === lca) break; down.push(n); }
    return path.concat(down.reverse()).filter((n) => n !== from);
  }

  // ---------- playing events ----------

  playAgent(a, ev) {
    const node = ev.node ? this.nodes.get(ev.node) : null;
    const k = 1 / (1 + a.queue.length / 3); // fast-forward when a backlog builds
    switch (ev.type) {
      case 'claim': {
        const n = this.ensureNode({ id: ev.node, url: ev.url, parent: ev.parent, depth: ev.depth });
        n.state = 'claimed'; n.by = a; n.claimedAt = this.now;
        a.node = n; a.state = 'walk'; a.t0 = this.now; a.tone = '';
        a.label = `→ ${short(n.host + pathOf(n.url), 34)}`;
        a.body.walk(this.treePath(a.at, n));
        a.body.rest = n;
        a.spin = { from: n.parent, to: n };
        a.at = n;
        break;
      }
      case 'state':
        if (ev.state === 'read' && a.state !== 'read') a.t0 = this.now;
        a.state = ev.state;
        const queued = /^waiting for a free/.test(ev.msg || '');
        a.body.twitchy = !queued && ['read', 'judge', 'robots', 'fetch', 'wait'].includes(ev.state);
        if (ev.state === 'home') {
          a.body.walk([...this.treePath(a.at, this.hub), a.spot]);
          a.body.rest = a.spot; a.at = this.hub; a.label = 'home'; a.tone = 'dim';
        } else if (ev.state === 'idle') {
          a.label = ev.msg; a.tone = 'dim';
        } else if (ev.state === 'rest') {
          a.label = 'resting (politeness delay)'; a.tone = 'dim';
        } else {
          a.label = ev.msg; a.tone = queued ? 'dim' : '';
        }
        if (ev.state === 'read') a.hold = 0.3 * k;
        break;
      case 'fetched':
        a.label = `${ev.status} · ${(ev.ms / 1000).toFixed(2)}s${ev.bytes ? ` · ${Math.round(ev.bytes / 1024)}KB` : ''}`;
        a.tone = ev.status >= 400 ? 'bad' : '';
        break;
      case 'fail':
        if (node) { node.state = 'fail'; node.reason = ev.reason; node.failKind = ev.kind; }
        a.spin = null;
        a.label = ev.reason; a.tone = 'bad';
        this.flashes.push({ x: node?.x, y: node?.y, node, c: '#ff5470', t: 0, kind: 'x' });
        if (node && node.parent) { a.body.walk([node.parent]); a.body.rest = node.parent; a.at = node.parent; }
        a.hold = 1.0 * k;
        break;
      case 'page':
        if (node) {
          node.state = 'read'; node.title = ev.title; node.url = ev.url; node.host = hostOf(ev.url);
          node.paragraphs = ev.paragraphs; node.total = ev.total; node.linkCount = ev.linkCount; node.readAt = this.now;
        }
        a.spin = null;
        a.label = ev.total > ev.paragraphs.length ? `skimmed ${ev.total} ¶, reading best ${ev.paragraphs.length}` : `reading ${ev.paragraphs.length} paragraphs`;
        a.tone = '';
        a.state = 'read'; a.t0 = this.now;
        a.hold = 0.5 * k;
        break;
      case 'bites':
        if (node) { node.relevance = ev.relevance; node.summary = ev.summary; node.bites = ev.bites; node.judgedBy = ev.by; }
        a.label = `bit ${ev.bites.length} · relevance ${ev.relevance}`; a.tone = ev.bites.length ? 'hot' : 'dim';
        if (node) this.flashes.push({ node, c: a.color, t: 0, kind: 'ring', n: ev.bites.length });
        a.hold = (0.45 + 0.2 * ev.bites.length) * k;
        break;
      case 'frontier':
        for (const it of ev.items) this.ensureNode(it);
        a.feelers = { node: a.at, items: ev.items.map((it) => this.nodes.get(it.id)), t: 0 };
        break;
      case 'links':
        a.label = ev.depthCapped ? `depth limit: not following links` : `chose ${ev.chosen.length} of ${ev.considered} links`;
        a.tone = '';
        a.hold = 0.7 * k;
        break;
      case 'balloon':
        a.label = `landed on ${ev.results.length} pages`;
        this.flashes.push({ x: 0, y: 0, c: a.color, t: 0, kind: 'balloon' });
        a.hold = 1.0;
        break;
    }
    this.hooks.onPlay(ev, a);
  }

  playGlobal(ev) {
    switch (ev.type) {
      case 'frontier': for (const it of ev.items) this.ensureNode(it); break;
      case 'weave-start':
        this.weaveState = { sources: ev.sources, text: '', cited: new Set(), progress: 0, t: 0 };
        break;
      case 'end':
        if (this.weaveState) this.weaveState.done = true;
        break;
      case 'weave-text':
        if (this.weaveState) {
          this.weaveState.text += ev.text;
          for (const m of this.weaveState.text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
            for (const n of m[1].split(',')) this.weaveState.cited.add(+n.trim());
          }
        }
        break;
    }
    this.hooks.onGlobal(ev);
  }

  tickQueues(dt) {
    for (const a of this.agents.values()) {
      a.hold -= dt;
      a.body.speedMul = 1 + a.queue.length / 3;
      while (a.queue.length && a.hold <= 0) {
        const ev = a.queue[0];
        const blocked = (NEEDS_ARRIVAL.has(ev.type) || (ev.type === 'state' && ARRIVAL_STATES.has(ev.state))) && a.body.moving;
        if (blocked) break;
        a.queue.shift();
        this.playAgent(a, ev);
      }
    }
    while (this.global.length) {
      const ev = this.global[0];
      if (AFTER_SPIDERS.has(ev.type) && !this.drained) break;
      this.global.shift();
      this.playGlobal(ev);
    }
  }

  // ---------- simulation ----------

  layout(dt) {
    const nodes = [...this.nodes.values()];
    const real = nodes.filter((n) => n.state !== 'frontier' && n !== this.hub);
    const dew = nodes.filter((n) => n.state === 'frontier');
    for (const n of real) {
      const r = Math.hypot(n.x, n.y) || 0.01;
      const f = (RING * (n.depth + 1) - r) * 1.6;
      n.vx += (n.x / r) * f * dt; n.vy += (n.y / r) * f * dt;
      const p = n.parent;
      if (p && p !== this.hub) {
        const dx = p.x - n.x, dy = p.y - n.y, d = Math.hypot(dx, dy) || 1;
        const pull = (d - RING * 0.9) * 0.6;
        n.vx += (dx / d) * pull * dt; n.vy += (dy / d) * pull * dt;
      }
    }
    for (let i = 0; i < real.length; i++) {
      const a = real[i];
      for (let j = i + 1; j < real.length; j++) {
        const b = real[j];
        const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 > 190 * 190) continue;
        const d = Math.sqrt(d2) || 0.1, f = 120000 / (d2 + 400);
        a.vx += (dx / d) * f * dt; a.vy += (dy / d) * f * dt;
        b.vx -= (dx / d) * f * dt; b.vy -= (dy / d) * f * dt;
      }
    }
    for (const n of dew) {
      const p = n.parent || this.hub;
      const dx = p.x - n.x, dy = p.y - n.y, d = Math.hypot(dx, dy) || 1;
      const rest = p === this.hub ? 80 : 44;
      n.vx += (dx / d) * (d - rest) * 3 * dt; n.vy += (dy / d) * (d - rest) * 3 * dt;
      // drift outward, away from the hub
      const r = Math.hypot(n.x, n.y) || 1;
      n.vx += (n.x / r) * 20 * dt; n.vy += (n.y / r) * 20 * dt;
    }
    for (let i = 0; i < dew.length; i++) {
      const a = dew[i];
      for (let j = i + 1; j < dew.length; j++) {
        const b = dew[j];
        const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 > 30 * 30) continue;
        const d = Math.sqrt(d2) || 0.1, f = 3000 / (d2 + 40);
        a.vx += (dx / d) * f * dt; a.vy += (dy / d) * f * dt;
        b.vx -= (dx / d) * f * dt; b.vy -= (dy / d) * f * dt;
      }
    }
    const damp = Math.pow(0.04, dt);
    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx *= damp; n.vy *= damp;
      const sp = Math.hypot(n.vx, n.vy);
      if (sp > 260) { n.vx *= 260 / sp; n.vy *= 260 / sp; }
      n.x += n.vx * dt; n.y += n.vy * dt;
    }
  }

  camera(dt) {
    let x0 = -120, x1 = 120, y0 = -100, y1 = 120;
    for (const n of this.nodes.values()) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
    const bodies = [...this.agents.values()].map((a) => a.body);
    if (this.weaveState) bodies.push(this.weaver);
    for (const b of bodies) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x); y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y); }
    const pad = 70;
    const s = Math.max(0.28, Math.min(1.5, Math.min(this.W / (x1 - x0 + pad * 2), this.H / (y1 - y0 + pad * 2 + 30))));
    const k = Math.min(1, dt * 2.5);
    this.cam.s += (s - this.cam.s) * k;
    this.cam.x += ((x0 + x1) / 2 - this.cam.x) * k;
    this.cam.y += ((y0 + y1) / 2 - this.cam.y) * k;
  }

  toScreen(x, y) { return { x: (x - this.cam.x) * this.cam.s + this.W / 2, y: (y - this.cam.y) * this.cam.s + this.H / 2 }; }

  frame(dt) {
    this.now += dt;
    this.tickQueues(dt);
    this.layout(dt);
    for (const a of this.agents.values()) {
      a.body.update(dt, this.now);
      if (a.feelers) { a.feelers.t += dt; if (a.feelers.t > 1.6) a.feelers = null; }
    }
    this.updateWeaver(dt);
    this.flashes = this.flashes.filter((f) => (f.t += dt) < 1.4);
    this.camera(dt);
    this.findHover();
    this.draw();
  }

  updateWeaver(dt) {
    const w = this.weaveState;
    if (!w) { this.weaver.update(dt, this.now); return; }
    w.t += dt;
    // While the model is still writing, the spiral creeps outward with elapsed time; text pushes it further.
    const target = w.done ? 1 : Math.min(0.97, Math.max(w.text.length / 1400, 0.75 * (1 - Math.exp(-w.t / 30))));
    w.progress += (target - w.progress) * Math.min(1, dt * 2);
    const p = this.spiralPoint(w.progress);
    this.weaver.rest = p;
    this.weaver.twitchy = true;
    this.weaver.update(dt, this.now);
  }

  spiralMax() {
    let m = RING * 0.8;
    for (const n of this.nodes.values()) if (n.state === 'read') m = Math.max(m, Math.hypot(n.x, n.y));
    return m * 0.92;
  }
  spiralPoint(t) {
    const turns = 5.5, r0 = 16, R = this.spiralMax();
    const a = t * turns * Math.PI * 2 - Math.PI / 2;
    const r = r0 + (R - r0) * t;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  findHover() {
    this.hover = null;
    if (!this.mouse) return;
    let best = null, bd = 14;
    for (const n of this.nodes.values()) {
      if (n === this.hub) continue;
      const p = this.toScreen(n.x, n.y);
      const d = Math.hypot(p.x - this.mouse.x, p.y - this.mouse.y);
      if (d < bd) { bd = d; best = { node: n }; }
    }
    for (const a of this.agents.values()) {
      const p = this.toScreen(a.body.x, a.body.y);
      const d = Math.hypot(p.x - this.mouse.x, p.y - this.mouse.y);
      if (d < bd) { bd = d; best = { agent: a }; }
    }
    this.hover = best;
    this.renderTip();
  }

  renderTip() {
    const h = this.hover, tip = this.tip;
    if (!h) { tip.hidden = true; this.cv.style.cursor = ''; return; }
    let html = '';
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    if (h.node) {
      const n = h.node;
      const st = { frontier: 'queued', claimed: 'being fetched', read: 'read', fail: 'failed' }[n.state];
      html += `<b>${esc(n.title || n.anchor || n.host)}</b><span class="u">${esc(short(n.url, 90))}</span>`;
      html += `<span class="m">${st}${n.state === 'frontier' ? ` · score ${n.score}` : ''}${n.state === 'read' ? ` · relevance ${n.relevance} · ${n.bites.length} bites` : ''} · depth ${n.depth}</span>`;
      if (n.state === 'frontier' && n.why) html += `<span>${esc(n.why)}</span>`;
      if (n.state === 'read' && n.summary) html += `<span>${esc(n.summary)}</span>`;
      if (n.state === 'fail') html += `<span class="bad">${esc(n.reason)}</span>`;
      if (n.state === 'read') html += `<span class="m">click to open in the specimen pane</span>`;
      this.cv.style.cursor = n.state === 'read' ? 'pointer' : '';
    } else {
      const a = h.agent;
      html += `<b style="color:${a.color}">${esc(a.name)}</b><span>${esc(a.label)}</span>${a.node ? `<span class="u">${esc(short(a.node.url, 90))}</span>` : ''}`;
      if (a.queue.length > 2) html += `<span class="m">replaying ${a.queue.length} events behind live</span>`;
      this.cv.style.cursor = '';
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const x = Math.min(this.mouse.x + 14, this.W - 280), y = Math.min(this.mouse.y + 14, this.H - tip.offsetHeight - 8);
    tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  }

  // ---------- drawing ----------

  draw() {
    const { ctx, dpr, cam } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * (this.W / 2 - cam.x * cam.s), dpr * (this.H / 2 - cam.y * cam.s));
    const lw = 1 / cam.s;
    const now = this.now;

    // depth rings, faint
    ctx.lineWidth = lw;
    ctx.strokeStyle = '#272338';
    ctx.setLineDash([2 * lw, 6 * lw]);
    let maxDepth = 0;
    for (const n of this.nodes.values()) if (n.state !== 'frontier') maxDepth = Math.max(maxDepth, n.depth);
    for (let d = 0; d <= maxDepth; d++) { ctx.beginPath(); ctx.arc(0, 0, RING * (d + 1), 0, 6.2832); ctx.stroke(); }
    ctx.setLineDash([]);

    // weave spiral + radial threads to cited sources
    const w = this.weaveState;
    if (w) {
      ctx.strokeStyle = '#ff2bd6';
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = lw;
      ctx.beginPath();
      const steps = Math.max(2, Math.floor(w.progress * 400));
      for (let i = 0; i <= steps; i++) { const p = this.spiralPoint((i / 400)); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.6 * lw;
      for (const s of w.sources) {
        if (!w.cited.has(s.n)) continue;
        const n = this.nodes.get(s.node);
        if (!n) continue;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(n.x, n.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // threads
    for (const n of this.nodes.values()) {
      if (n === this.hub || !n.parent) continue;
      const p = n.parent;
      if (n.state === 'frontier') {
        const grow = Math.min(1, (now - n.born) / 0.5);
        ctx.strokeStyle = '#8a849f'; ctx.globalAlpha = 0.22; ctx.lineWidth = lw;
        ctx.setLineDash([1.5 * lw, 3 * lw]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + (n.x - p.x) * grow, p.y + (n.y - p.y) * grow); ctx.stroke();
        ctx.setLineDash([]);
      } else if (n.state === 'claimed') {
        const spinning = n.by && n.by.spin && n.by.spin.to === n;
        if (!spinning) { ctx.strokeStyle = n.by?.color || '#8a849f'; ctx.globalAlpha = 0.6; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(n.x, n.y); ctx.stroke(); }
      } else if (n.state === 'read') {
        ctx.strokeStyle = n.by?.color || '#8e9aff';
        ctx.globalAlpha = 0.25 + 0.6 * (n.relevance / 100);
        ctx.lineWidth = (0.8 + n.relevance / 45) * lw;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(n.x, n.y); ctx.stroke();
      } else if (n.state === 'fail') {
        ctx.strokeStyle = '#ff5470'; ctx.globalAlpha = 0.3; ctx.lineWidth = lw;
        ctx.setLineDash([3 * lw, 3 * lw]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(n.x, n.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }

    // silk being spun right now: from the parent node to the walking spider
    for (const a of this.agents.values()) {
      if (!a.spin) continue;
      ctx.strokeStyle = a.color; ctx.globalAlpha = 0.9; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(a.spin.from.x, a.spin.from.y); ctx.lineTo(a.body.x, a.body.y); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // feelers: the spider reaching toward the links it chose
    for (const a of this.agents.values()) {
      const f = a.feelers;
      if (!f) continue;
      const t = Math.min(1, f.t / 0.6), fade = f.t > 1 ? 1 - (f.t - 1) / 0.6 : 1;
      ctx.strokeStyle = a.color; ctx.lineWidth = lw; ctx.globalAlpha = 0.7 * Math.max(0, fade);
      for (const n of f.items) {
        if (!n) continue;
        ctx.beginPath(); ctx.moveTo(a.body.x, a.body.y); ctx.lineTo(a.body.x + (n.x - a.body.x) * t, a.body.y + (n.y - a.body.y) * t); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // nodes
    for (const n of this.nodes.values()) {
      if (n === this.hub) continue;
      if (n.state === 'frontier') {
        ctx.fillStyle = '#cdc9de';
        ctx.globalAlpha = 0.25 + 0.5 * ((n.score || 0) / 100);
        ctx.beginPath(); ctx.arc(n.x, n.y, 2.2 * Math.max(1, lw), 0, 6.2832); ctx.fill();
      } else if (n.state === 'claimed') {
        ctx.strokeStyle = n.by?.color || '#fff'; ctx.lineWidth = 1.4 * lw;
        ctx.setLineDash([3 * lw, 3 * lw]); ctx.lineDashOffset = -now * 20 * lw;
        ctx.beginPath(); ctx.arc(n.x, n.y, 7, 0, 6.2832); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
      } else if (n.state === 'read') {
        const r = 3.5 + n.relevance / 12;
        ctx.fillStyle = n.by?.color || '#8e9aff';
        ctx.globalAlpha = n.bites.length || n.relevance ? 0.35 + 0.65 * (n.relevance / 100) : 0.3;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = n.by?.color || '#8e9aff'; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.2832); ctx.stroke();
      } else if (n.state === 'fail') {
        ctx.strokeStyle = '#ff5470'; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.4 * lw;
        const s = 4;
        ctx.beginPath(); ctx.moveTo(n.x - s, n.y - s); ctx.lineTo(n.x + s, n.y + s); ctx.moveTo(n.x + s, n.y - s); ctx.lineTo(n.x - s, n.y + s); ctx.stroke();
      }
      if (this.selected === n || (this.hover && this.hover.node === n)) {
        ctx.globalAlpha = 1; ctx.strokeStyle = '#25e2ff'; ctx.lineWidth = 1.2 * lw;
        ctx.beginPath(); ctx.arc(n.x, n.y, 3.5 + (n.relevance || 0) / 12 + 5, 0, 6.2832); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // hub
    const pulse = (Math.sin(now * 2.2) + 1) / 2;
    ctx.fillStyle = '#ff2bd6';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = lw; ctx.globalAlpha = 0.5 - pulse * 0.35;
    ctx.beginPath(); ctx.arc(0, 0, 10 + pulse * 10, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = 1;

    // flashes
    for (const f of this.flashes) {
      const x = f.node ? f.node.x : f.x, y = f.node ? f.node.y : f.y;
      const e = f.t / 1.4;
      ctx.strokeStyle = f.c; ctx.globalAlpha = 1 - e; ctx.lineWidth = 1.4 * lw;
      if (f.kind === 'ring') {
        for (let i = 0; i < Math.max(1, f.n); i++) { ctx.beginPath(); ctx.arc(x, y, 8 + e * 26 + i * 5, 0, 6.2832); ctx.stroke(); }
      } else if (f.kind === 'balloon') {
        for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * 0.22; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * (40 + e * 140), Math.sin(a) * (40 + e * 140)); ctx.stroke(); }
      } else {
        ctx.beginPath(); ctx.arc(x, y, 6 + e * 18, 0, 6.2832); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // spiders
    for (const a of this.agents.values()) a.body.draw(ctx, now, lw, a.body.twitchy);
    if (w || this.agents.size) this.weaver.draw(ctx, now, lw, !!w && w.progress < 0.99);

    // labels in screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'middle';
    const placed = [];
    const ranked = [...this.nodes.values()].filter((n) => n.state === 'read')
      .sort((a, b) => (b === this.selected) - (a === this.selected) || b.relevance - a.relevance);
    for (const n of ranked) {
      if (n.relevance < 45 && this.selected !== n) continue;
      if ([...this.agents.values()].some((a) => Math.hypot(a.body.x - n.x, a.body.y - n.y) < 24)) continue; // a spider is standing here
      const p = this.toScreen(n.x, n.y);
      const box = { x: p.x + 8, y: p.y - 9, w: Math.min(30, n.title.length) * 6.7 + 4, h: 26 };
      if (placed.some((q) => box.x < q.x + q.w && q.x < box.x + box.w && box.y < q.y + q.h && q.y < box.y + box.h)) continue;
      placed.push(box);
      ctx.font = `11px ${MONO}`;
      ctx.fillStyle = '#cdc9de'; ctx.globalAlpha = 0.85;
      ctx.fillText(short(n.title, 30), p.x + 10, p.y - 1);
      ctx.font = `9px ${MONO}`; ctx.fillStyle = '#8a849f';
      ctx.fillText(n.host, p.x + 10, p.y + 11);
      ctx.globalAlpha = 1;
    }
    for (const a of this.agents.values()) {
      const p = this.toScreen(a.body.x, a.body.y);
      ctx.font = `bold 10px ${MONO}`; ctx.fillStyle = a.color;
      ctx.fillText(a.name.toUpperCase(), p.x + 12, p.y - 14);
      if (a.state === 'home' && !a.body.moving) continue;
      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = a.tone === 'bad' ? '#ff5470' : a.tone === 'dim' ? '#8a849f' : a.tone === 'hot' ? '#ffffff' : '#cdc9de';
      let label = a.label;
      if (a.state === 'fetch' || a.state === 'walk' || a.state === 'read') label += ` ${(this.now - a.t0).toFixed(1)}s`;
      ctx.fillText(short(label, 44), p.x + 12, p.y - 2);
    }
    const hp = this.toScreen(0, 0);
    ctx.textAlign = 'center';
    if (w) {
      const wp = this.toScreen(this.weaver.x, this.weaver.y);
      ctx.font = `bold 10px ${MONO}`; ctx.fillStyle = '#fff';
      ctx.fillText(w.progress < 0.99 ? 'ARANEUS · weaving the answer' : 'ARANEUS · web complete', wp.x, wp.y + 20);
    }
    if (this.question) {
      ctx.font = `12px ${MONO}`; ctx.fillStyle = '#ff2bd6';
      ctx.fillText(short(this.question, 60), hp.x, hp.y + (this.agents.size ? 44 * this.cam.s + 30 : 22));
    }
    ctx.textAlign = 'left';
  }
}
