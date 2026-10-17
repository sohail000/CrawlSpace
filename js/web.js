// THE WEB: a live map of the hunt. The source page sits on the left, the target on the right.
// Every node is a real Wikipedia page, every thread a real link, every spider a real worker, and the
// dots around the target are real pages the sentinel learned are 1, 2 or 3 links from it.
// Events are played per spider, in order; the hunt waits for its spider to finish acting before moving on.

const BRIDGE_L = 340;   // half the distance between the two ends
const HOP_X = 150;      // horizontal step per link from the source
const MONO_FONT = '"Space Mono", ui-monospace, Menlo, Consolas, monospace';
const INK = { src: '#ff2bd6', dst: '#25e2ff', gold: '#ffd166', bad: '#ff5470', text: '#cdc9de', dim: '#8a849f', rule: '#272338', link: '#8e9aff' };

// Events that need the spider standing on its node before they play.
const NEEDS_ARRIVAL = new Set(['page', 'bites', 'sniff', 'frontier', 'links', 'fail']);
const ARRIVAL_STATES = new Set(['judge', 'sniff', 'idle', 'home']);
// Global events that wait until every spider has played its backlog.
const AFTER_SPIDERS = new Set(['found', 'end']);
// How long each event holds its spider (seconds at 1x): long enough to watch, never invented work.
const HOLD = { fetched: 0.15, page: 0.55, sniff: 0.9, bites: 0.3, frontier: 0.45, links: 0.35, fail: 0.9, zone: 0.75, scent: 0.6 };

function unitHash(s) {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

class WebView {
  constructor(canvas, tip, hooks) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.tip = tip;
    this.hooks = hooks; // { onPlay(ev, agent), onSelect(node), onGlobal(ev) }
    this.W = 300; this.H = 300; this.dpr = 1;
    this.cam = { x: 0, y: 0, s: 1 };
    this.mouse = null;
    this.now = 0;
    this.speed = 1;
    this.idleWaiters = [];
    this.reset();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    canvas.addEventListener('pointerleave', () => { this.mouse = null; this.tip.hidden = true; });
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.findHover();
      const h = this.hover;
      if (h?.node?.paragraphs) this.hooks.onSelect(h.node);
    });
  }

  reset() {
    for (const w of this.idleWaiters || []) w.res();
    this.idleWaiters = [];
    this.src = { id: 'src', title: '', x: -BRIDGE_L, y: 0, fixed: true, hub: true, state: 'queued', depth: 0, parent: null, bites: [], kids: 0 };
    this.dst = { id: 'dst', title: '', x: BRIDGE_L, y: 0, fixed: true, hub: true, state: 'target', depth: 99, parent: null, bites: [], kids: 0 };
    this.nodes = new Map([['src', this.src], ['dst', this.dst]]);
    this.zone = [];
    this.zoneByTitle = new Map();
    this.zoneTotals = {};
    this.agents = new Map();
    this.global = [];
    this.flashes = [];
    this.scentWords = [];
    this.bridge = null;
    this.ended = null;
    this.selected = null;
    this.hover = null;
    this.weaver = new SpiderBody(-BRIDGE_L, 0, { color: INK.gold, size: 4.4, speed: 130 });
  }

  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(50, r.width); this.H = Math.max(50, r.height);
    this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
    this.vertical = this.H > this.W * 1.05; // tall screens: source on top, target at the bottom
  }

  // ---------- event intake ----------

  push(ev) {
    if (ev.spider && this.agents.has(ev.spider) && !AFTER_SPIDERS.has(ev.type)) this.agents.get(ev.spider).queue.push(ev);
    else this.global.push(ev);
  }

  addSpider(ev, i) {
    const sentinel = ev.role === 'sentinel';
    const color = sentinel ? INK.dst : HUNTER_COLORS[i % HUNTER_COLORS.length];
    const home = sentinel ? this.dst : this.src;
    const ang = Math.PI + (i - 1) * 0.62;
    const spot = sentinel ? { x: BRIDGE_L + 4, y: -44 } : { x: -BRIDGE_L + Math.cos(ang) * 46, y: Math.sin(ang) * 46 };
    const body = new SpiderBody(spot.x, spot.y, { color, size: sentinel ? 4.2 : 3.6, speed: 165 });
    body.rest = spot;
    const agent = {
      id: ev.id, name: ev.name, role: ev.role, color, body, spot, at: home, node: null, queue: [], hold: 0, boost: 1,
      label: sentinel ? 'waiting on the target' : 'ready', tone: 'dim', spin: null, feelers: null, sniff: null, state: 'idle', t0: 0,
    };
    this.agents.set(ev.id, agent);
    return agent;
  }

  idle(a) { return !a.queue.length && a.hold <= 0 && !a.body.moving; }

  get drained() {
    for (const a of this.agents.values()) if (!this.idle(a)) return false;
    return true;
  }

  // Lets the hunt wait until a spider has finished acting out its last page (or give up after maxMs).
  whenIdle(id, maxMs = 9000) {
    const a = this.agents.get(id);
    if (!a || this.idle(a) || (typeof document !== 'undefined' && document.hidden)) return Promise.resolve();
    return new Promise((resolve) => {
      const w = { a, res: () => { clearTimeout(w.timer); resolve(); } };
      w.timer = setTimeout(() => { this.idleWaiters = this.idleWaiters.filter((x) => x !== w); resolve(); }, maxMs);
      this.idleWaiters.push(w);
    });
  }

  ensureNode(item) {
    let n = this.nodes.get(item.id);
    if (n) {
      if (item.title && n.title !== item.title) n.title = item.title;
      return n;
    }
    const parent = this.nodes.get(item.parent) || this.src;
    const sib = parent.kids++;
    const toT = Math.atan2(this.dst.y - parent.y, this.dst.x - parent.x);
    const ang = toT + (sib % 2 ? 1 : -1) * (0.35 + 0.24 * Math.floor(sib / 2));
    n = {
      id: item.id, title: item.title, parent, depth: item.depth ?? parent.depth + 1, kids: 0,
      x: parent.x + Math.cos(ang) * 40, y: parent.y + Math.sin(ang) * 40, vx: 0, vy: 0,
      state: 'queued', heat: item.heat || 0, scent: item.scent || 0, why: item.why || '', born: this.now,
      bites: [], paragraphs: null, by: null, linkCount: 0,
    };
    this.nodes.set(n.id, n);
    return n;
  }

  // Route along existing threads: up to the common ancestor, then down to the target.
  treePath(from, to) {
    const up = (n) => { const out = []; while (n) { out.push(n); n = n.parent; } return out; };
    const a = up(from), b = up(to);
    const inB = new Set(b);
    const lca = a.find((n) => inB.has(n)) || this.src;
    const path = [];
    for (const n of a) { if (n === lca) break; path.push(n); }
    path.push(lca);
    const down = [];
    for (const n of b) { if (n === lca) break; down.push(n); }
    return path.concat(down.reverse()).filter((n) => n !== from);
  }

  pathLength(from, pts) {
    let d = 0, p = from;
    for (const q of pts) { d += Math.hypot(q.x - p.x, q.y - p.y); p = q; }
    return d;
  }

  // ---------- playing events ----------

  playAgent(a, ev) {
    const node = ev.node ? this.nodes.get(ev.node) : null;
    const k = 1 / (1 + a.queue.length / 3); // fast-forward when a backlog builds
    switch (ev.type) {
      case 'claim': {
        const n = ev.node === 'src' ? this.src : this.ensureNode({ id: ev.node, title: ev.title, parent: ev.parent, depth: ev.depth });
        n.state = 'claimed'; n.by = a; n.title = ev.title || n.title;
        a.node = n; a.state = 'walk'; a.t0 = this.now; a.tone = '';
        a.label = `→ ${short(n.title, 30)}`;
        const path = this.treePath(a.at, n);
        a.boost = Math.max(1, Math.min(4, this.pathLength(a.body, path) / 260));
        a.body.walk(path);
        a.body.rest = n;
        a.spin = n.parent ? { from: n.parent, to: n } : null;
        a.at = n;
        break;
      }
      case 'state': {
        a.state = ev.state;
        const waiting = ev.state === 'wait' || ev.state === 'idle';
        a.body.twitchy = !waiting && ['fetch', 'judge', 'sniff', 'resolve', 'scent', 'zone'].includes(ev.state);
        if (ev.state === 'fetch') a.t0 = this.now;
        if (ev.state === 'home') {
          a.body.walk([...this.treePath(a.at, this.src), a.spot]);
          a.body.rest = a.spot; a.at = this.src; a.label = 'home'; a.tone = 'dim';
        } else {
          a.label = ev.msg; a.tone = waiting ? 'dim' : '';
        }
        break;
      }
      case 'fetched':
        a.label = `${ev.kb} KB in ${(ev.ms / 1000).toFixed(1)}s`;
        a.tone = '';
        a.hold = HOLD.fetched * k;
        break;
      case 'fail':
        if (node) { node.state = 'fail'; node.reason = ev.reason; }
        a.spin = null;
        a.label = ev.reason; a.tone = 'bad';
        if (node) this.flashes.push({ node, c: INK.bad, t: 0, kind: 'x' });
        if (node?.parent) { a.body.walk([node.parent]); a.body.rest = node.parent; a.at = node.parent; }
        a.hold = HOLD.fail * k;
        break;
      case 'page':
        if (node) {
          node.state = 'read'; node.title = ev.title; node.url = ev.url;
          node.paragraphs = ev.paragraphs; node.linkCount = ev.linkCount; node.kb = ev.kb; node.readAt = this.now;
        }
        a.spin = null;
        a.label = `reading ${ev.linkCount} links`;
        a.tone = '';
        a.hold = HOLD.page * k;
        break;
      case 'bites':
        if (node) {
          const have = new Set(node.bites.map((b) => b.id));
          node.bites = node.bites.concat(ev.bites.filter((b) => !have.has(b.id)));
          if (ev.bites.some((b) => b.kind === 'found')) { node.won = true; this.flashes.push({ node, c: INK.gold, t: 0, kind: 'ring', n: 3 }); }
          else if (ev.bites.length) this.flashes.push({ node, c: a.color, t: 0, kind: 'ring', n: 1 });
        }
        a.hold = (HOLD.bites + 0.18 * ev.bites.length) * k;
        break;
      case 'sniff':
        a.sniff = { node: node || a.at, n: ev.checked, hot: ev.hot.length, t: 0 };
        a.label = ev.hot.length ? `${ev.hot.length} of ${ev.checked} links lead to ${short(this.dst.title, 20)}!` : `none of ${ev.checked} links lead straight there`;
        a.tone = ev.hot.length ? 'hot' : '';
        a.hold = HOLD.sniff * k;
        break;
      case 'frontier':
        for (const it of ev.items) this.ensureNode(it);
        a.feelers = { node: a.at, items: ev.items.map((it) => this.nodes.get(it.id)), t: 0 };
        a.hold = HOLD.frontier * k;
        break;
      case 'links':
        a.label = ev.hot ? `follows ${ev.chosen} links, ${ev.hot} hot` : `follows ${ev.chosen} of ${ev.considered} links`;
        a.hold = HOLD.links * k;
        break;
      case 'scent':
        this.scentWords = ev.terms.slice(0, 4);
        a.label = `smells ${ev.terms.slice(0, 3).join(' · ')}`;
        a.hold = HOLD.scent * k;
        break;
      case 'zone': {
        const added = this.addZone(ev);
        a.feelers = { node: this.dst, items: added, t: 0 };
        a.label = `${ev.more ? '500+' : ev.total} pages ${ev.level} link${ev.level > 1 ? 's' : ''} away`;
        a.tone = '';
        a.hold = HOLD.zone * k;
        break;
      }
    }
    this.hooks.onPlay(ev, a);
  }

  addZone(ev) {
    const added = [];
    const R = { 1: [62, 96], 2: [124, 160], 3: [186, 222] }[ev.level] || [186, 222];
    for (const z of ev.titles) {
      if (this.zoneByTitle.has(z.title)) continue;
      const ang = Math.PI * (0.6 + 0.8 * unitHash(z.title));      // the side facing the source
      const r = R[0] + (R[1] - R[0]) * unitHash(z.title + '|r');
      const dot = { title: z.title, via: z.via, level: ev.level, x: this.dst.x + Math.cos(ang) * r, y: this.dst.y + Math.sin(ang) * r, born: this.now };
      this.zone.push(dot);
      this.zoneByTitle.set(z.title, dot);
      added.push(dot);
    }
    this.zoneTotals[ev.level] = ev.more ? '500+' : ev.total;
    return added;
  }

  playGlobal(ev) {
    switch (ev.type) {
      case 'ends':
        Object.assign(this.src, { title: ev.source.title, url: ev.source.url, description: ev.source.description });
        Object.assign(this.dst, { title: ev.target.title, url: ev.target.url, description: ev.target.description });
        break;
      case 'frontier': // the sentinel's new map lit up links on pages already read
        for (const it of ev.items) {
          const n = this.ensureNode(it);
          this.flashes.push({ kind: 'pulse', from: this.dst, to: n, c: INK.dst, t: 0 });
        }
        break;
      case 'found': this.startBridge(ev); break;
      case 'end': this.ended = ev; break;
    }
    this.hooks.onGlobal(ev);
  }

  startBridge(ev) {
    const pts = ev.hops.map((h) => this.nodes.get(h.node)).filter(Boolean);
    for (const n of this.nodes.values()) if (n.state === 'claimed') n.state = 'queued'; // walks cut short by the find
    for (const a of this.agents.values()) { a.spin = null; a.sniff = null; if (a.role === 'hunter') { a.label = 'bridge found'; a.tone = 'dim'; a.body.twitchy = false; } }
    const was = ev.tightened ? ev.tightened.path.map((id) => this.nodes.get(id)).filter(Boolean).concat([this.dst]) : null;
    this.bridge = { pts, was, born: this.now, done: false, hops: ev.hops };
    for (const n of pts) n.onBridge = true;
    this.weaver.teleport(this.src.x, this.src.y);
    this.weaver.walk(pts.slice(1));
    this.weaver.rest = this.dst;
  }

  tickQueues(dt) {
    for (const a of this.agents.values()) {
      a.hold -= dt;
      if (!a.body.moving) a.boost = 1;
      a.body.speedMul = (1 + a.queue.length / 3) * a.boost * this.speed;
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
    if (this.idleWaiters.length) {
      const ready = this.idleWaiters.filter((w) => this.idle(w.a));
      if (ready.length) {
        this.idleWaiters = this.idleWaiters.filter((w) => !ready.includes(w));
        for (const w of ready) w.res();
      }
    }
  }

  // ---------- simulation ----------

  layout(dt) {
    const real = [], dots = [];
    for (const n of this.nodes.values()) {
      if (n.fixed) continue;
      (n.state === 'queued' ? dots : real).push(n);
    }
    for (const n of real) {
      const tx = Math.min(BRIDGE_L - 150, -BRIDGE_L + n.depth * HOP_X);
      n.vx += (tx - n.x) * 2.2 * dt;
      n.vy += -n.y * 0.25 * dt;
      const p = n.parent;
      if (p) {
        const dx = p.x - n.x, dy = p.y - n.y, d = Math.hypot(dx, dy) || 1;
        const pull = (d - 120) * 0.5;
        n.vx += (dx / d) * pull * dt; n.vy += (dy / d) * pull * dt;
      }
    }
    for (let i = 0; i < real.length; i++) {
      const a = real[i];
      for (let j = i + 1; j < real.length; j++) {
        const b = real[j];
        const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 > 170 * 170) continue;
        const d = Math.sqrt(d2) || 0.1, f = 90000 / (d2 + 400);
        a.vx += (dx / d) * f * dt; a.vy += (dy / d) * f * dt;
        b.vx -= (dx / d) * f * dt; b.vy -= (dy / d) * f * dt;
      }
      for (const h of [this.src, this.dst]) {
        const dx = a.x - h.x, dy = a.y - h.y, d2 = dx * dx + dy * dy;
        if (d2 > 90 * 90) continue;
        const d = Math.sqrt(d2) || 0.1, f = 60000 / (d2 + 400);
        a.vx += (dx / d) * f * dt; a.vy += (dy / d) * f * dt;
      }
    }
    for (const n of dots) {
      const p = n.parent || this.src;
      const dx = p.x - n.x, dy = p.y - n.y, d = Math.hypot(dx, dy) || 1;
      n.vx += (dx / d) * (d - 38) * 3 * dt; n.vy += (dy / d) * (d - 38) * 3 * dt;
      // lean toward the target: hot links (known to lead there) lean hardest
      const tx = this.dst.x - n.x, ty = this.dst.y - n.y, td = Math.hypot(tx, ty) || 1;
      const lean = n.heat === 1 ? 26 : n.heat ? 14 : 6;
      n.vx += (tx / td) * lean * dt; n.vy += (ty / td) * lean * dt;
    }
    for (let i = 0; i < dots.length; i++) {
      const a = dots[i];
      for (let j = i + 1; j < dots.length; j++) {
        const b = dots[j];
        const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 > 26 * 26) continue;
        const d = Math.sqrt(d2) || 0.1, f = 2400 / (d2 + 30);
        a.vx += (dx / d) * f * dt; a.vy += (dy / d) * f * dt;
        b.vx -= (dx / d) * f * dt; b.vy -= (dy / d) * f * dt;
      }
    }
    const damp = Math.pow(0.04, dt);
    for (const n of [...real, ...dots]) {
      n.vx *= damp; n.vy *= damp;
      const sp = Math.hypot(n.vx, n.vy);
      if (sp > 260) { n.vx *= 260 / sp; n.vy *= 260 / sp; }
      n.x += n.vx * dt; n.y += n.vy * dt;
    }
  }

  // The camera works in view space: world x/y, swapped when the canvas is tall.
  camera(dt) {
    const V = this.vertical;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const grow = (wx, wy) => {
      const x = V ? wy : wx, y = V ? wx : wy;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    };
    grow(-BRIDGE_L - 80, V ? -140 : -120);
    grow(BRIDGE_L + (V ? 120 : 150), V ? 140 : 110); // room past the target for its labels
    for (const n of this.nodes.values()) grow(n.x, n.y);
    for (const z of this.zone) grow(z.x, z.y);
    for (const a of this.agents.values()) grow(a.body.x, a.body.y);
    const pad = 46;
    const fit = () => Math.max(0.25, Math.min(1.6, Math.min(this.W / (x1 - x0 + pad * 2), this.H / (y1 - y0 + pad * 2 + 40))));
    let s = fit();
    // keep screen room past the target for its labels, whatever the zoom
    if (V) { if (y1 < this.dst.x + 60 / s) { y1 = this.dst.x + 60 / s; s = fit(); } }
    else if (x1 < this.dst.x + 150 / s) { x1 = this.dst.x + 150 / s; s = fit(); }
    const k = Math.min(1, dt * 2.5);
    this.cam.s += (s - this.cam.s) * k;
    this.cam.x += ((x0 + x1) / 2 - this.cam.x) * k;
    this.cam.y += ((y0 + y1) / 2 + 8 - this.cam.y) * k;
  }

  toScreen(x, y) {
    if (this.vertical) [x, y] = [y, x];
    return { x: (x - this.cam.x) * this.cam.s + this.W / 2, y: (y - this.cam.y) * this.cam.s + this.H / 2 };
  }

  frame(dt) {
    this.now += dt;
    const sdt = dt * this.speed;
    this.tickQueues(sdt);
    this.layout(dt);
    for (const a of this.agents.values()) {
      a.body.update(dt, this.now);
      if (a.feelers && (a.feelers.t += sdt) > 1.6) a.feelers = null;
      if (a.sniff && (a.sniff.t += sdt) > 1.4) a.sniff = null;
    }
    if (this.bridge) {
      this.weaver.speedMul = this.speed;
      this.weaver.twitchy = this.weaver.moving;
      this.weaver.update(dt, this.now);
      if (!this.bridge.done && !this.weaver.moving && Math.hypot(this.weaver.x - this.dst.x, this.weaver.y - this.dst.y) < 12) {
        this.bridge.done = true;
        this.flashes.push({ node: this.dst, c: INK.gold, t: 0, kind: 'ring', n: 4 });
        this.hooks.onGlobal({ type: 'bridge-done' });
      }
    }
    this.flashes = this.flashes.filter((f) => (f.t += sdt) < 1.4);
    this.camera(dt);
    this.findHover();
    this.draw();
  }

  // ---------- hover ----------

  findHover() {
    this.hover = null;
    if (!this.mouse) return;
    let best = null, bd = 14;
    const near = (x, y) => { const p = this.toScreen(x, y); return Math.hypot(p.x - this.mouse.x, p.y - this.mouse.y); };
    for (const z of this.zone) { const d = near(z.x, z.y); if (d < bd) { bd = d; best = { zone: z }; } }
    for (const n of this.nodes.values()) { const d = near(n.x, n.y) - (n.hub ? 8 : 0); if (d < bd) { bd = d; best = { node: n }; } }
    for (const a of this.agents.values()) { const d = near(a.body.x, a.body.y); if (d < bd) { bd = d; best = { agent: a }; } }
    this.hover = best;
    this.renderTip();
  }

  renderTip() {
    const h = this.hover, tip = this.tip;
    if (!h) { tip.hidden = true; this.cv.style.cursor = ''; return; }
    let html = '';
    if (h.node) {
      const n = h.node;
      const st = n === this.dst ? 'the target' : n === this.src && n.state !== 'read' ? 'the start' : { queued: 'a link waiting to be followed', claimed: 'being read right now', read: 'read', fail: 'fell' }[n.state] || '';
      html += `<b>${esc(n.title || '…')}</b>`;
      if (n.description) html += `<span class="m">${esc(n.description)}</span>`;
      html += `<span class="m">${esc(st)}${n !== this.src && n !== this.dst ? ` · ${n.depth} link${n.depth === 1 ? '' : 's'} from the start` : ''}</span>`;
      if (n.state === 'queued' && n.why) html += `<span class="${n.heat === 1 ? 'hot' : ''}">${esc(n.why)}</span>`;
      if (n.state === 'read') html += `<span class="m">${n.linkCount} links · ${n.kb} KB · click to open it in the specimen pane</span>`;
      if (n.state === 'fail') html += `<span class="bad">${esc(n.reason)}</span>`;
      if (n === this.dst && this.zoneTotals[1]) html += `<span class="m">${this.zoneTotals[1]} pages link here</span>`;
      this.cv.style.cursor = n.paragraphs ? 'pointer' : '';
    } else if (h.zone) {
      const z = h.zone;
      html += `<b>${esc(z.title)}</b><span class="hot">${z.level === 1 ? `links to ${esc(this.dst.title)}` : `${z.level} links from ${esc(this.dst.title)}, via ${esc(z.via)}`}</span><span class="m">mapped by the sentinel from Wikipedia's "what links here"</span>`;
      this.cv.style.cursor = '';
    } else {
      const a = h.agent;
      html += `<b style="color:${a.color}">${esc(a.name)}</b><span class="m">${a.role === 'sentinel' ? 'sentinel: guards the target and maps who links to it' : 'hunter: reads pages and follows links'}</span><span>${esc(a.label)}</span>`;
      if (a.queue.length > 2) html += `<span class="m">replaying ${a.queue.length} events behind live</span>`;
      this.cv.style.cursor = '';
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const x = Math.min(this.mouse.x + 14, this.W - 280), y = Math.min(this.mouse.y + 14, this.H - tip.offsetHeight - 8);
    tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  }

  // ---------- drawing ----------

  line(x1, y1, x2, y2) { const c = this.ctx; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
  dot(x, y, r) { const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); }
  ring(x, y, r) { const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.stroke(); }

  draw() {
    const { ctx, dpr, cam } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const e = dpr * (this.W / 2 - cam.x * cam.s), f = dpr * (this.H / 2 - cam.y * cam.s);
    if (this.vertical) ctx.setTransform(0, dpr * cam.s, dpr * cam.s, 0, e, f); // swap axes: world x runs down the screen
    else ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, e, f);
    const lw = 1 / cam.s;
    const now = this.now;
    const S = this.src, T = this.dst;
    ctx.lineWidth = lw;

    // the gap still to cross
    if (S.title && !this.bridge) {
      ctx.strokeStyle = INK.rule; ctx.setLineDash([2 * lw, 7 * lw]);
      this.line(S.x + 14, 0, T.x - 14, 0);
      ctx.setLineDash([]);
    }

    // the target's web: rings of pages known to lead to it
    for (const z of this.zone) {
      const grow = Math.min(1, (now - z.born) / 0.6);
      const via = z.level > 1 ? this.zoneByTitle.get(z.via) : null;
      const to = via || T;
      ctx.strokeStyle = INK.dst; ctx.globalAlpha = (z.level === 1 ? 0.16 : 0.08) * grow;
      this.line(to.x, to.y, to.x + (z.x - to.x) * grow, to.y + (z.y - to.y) * grow);
      ctx.fillStyle = INK.dst; ctx.globalAlpha = (z.level === 1 ? 0.55 : z.level === 2 ? 0.35 : 0.22) * grow;
      this.dot(z.x, z.y, (z.level === 1 ? 1.9 : 1.5) * Math.max(1, lw));
    }
    ctx.globalAlpha = 1;

    // threads between pages
    for (const n of this.nodes.values()) {
      if (n.fixed || !n.parent) continue;
      const p = n.parent;
      if (n.state === 'queued') {
        const grow = Math.min(1, (now - n.born) / 0.5);
        ctx.strokeStyle = n.heat === 1 ? INK.dst : '#8a849f'; ctx.globalAlpha = n.heat === 1 ? 0.45 : 0.2;
        ctx.setLineDash([1.5 * lw, 3 * lw]);
        this.line(p.x, p.y, p.x + (n.x - p.x) * grow, p.y + (n.y - p.y) * grow);
        ctx.setLineDash([]);
      } else if (n.state === 'claimed') {
        const spinning = n.by && n.by.spin && n.by.spin.to === n;
        if (!spinning) { ctx.strokeStyle = n.by?.color || INK.text; ctx.globalAlpha = 0.6; this.line(p.x, p.y, n.x, n.y); }
      } else if (n.state === 'read') {
        ctx.strokeStyle = n.by?.color || INK.link; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2 * lw;
        this.line(p.x, p.y, n.x, n.y);
        ctx.lineWidth = lw;
      } else if (n.state === 'fail') {
        ctx.strokeStyle = INK.bad; ctx.globalAlpha = 0.3; ctx.setLineDash([3 * lw, 3 * lw]);
        this.line(p.x, p.y, n.x, n.y);
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }

    // scent lines: links known to lead toward the target, drawn to where the sentinel mapped them
    if (!this.bridge) {
      for (const n of this.nodes.values()) {
        if (!n.heat || n.fixed || n.state === 'fail') continue;
        const z = this.zoneByTitle.get(n.title);
        const to = z || (n.heat === 1 ? T : null);
        if (!to) continue;
        ctx.strokeStyle = INK.dst; ctx.globalAlpha = n.heat === 1 ? 0.28 : 0.14;
        ctx.setLineDash([1 * lw, 4 * lw]);
        this.line(n.x, n.y, to.x, to.y);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    // silk being spun right now: from the parent page to the walking spider
    for (const a of this.agents.values()) {
      if (!a.spin) continue;
      ctx.strokeStyle = a.color; ctx.globalAlpha = 0.9;
      this.line(a.spin.from.x, a.spin.from.y, a.body.x, a.body.y);
      ctx.globalAlpha = 1;
    }

    // sniffing: a fan of feelers toward the target, with a pulse running out for each link that leads there
    for (const a of this.agents.values()) {
      const f = a.sniff;
      if (!f) continue;
      const n = f.node, t = f.t, base = Math.atan2(T.y - n.y, T.x - n.x);
      const rays = Math.min(12, Math.max(4, Math.round(f.n / 4)));
      ctx.strokeStyle = a.color; ctx.globalAlpha = 0.35 * Math.max(0, 1 - t / 1.4);
      const reach = 34 * Math.min(1, t / 0.4);
      for (let i = 0; i < rays; i++) {
        const ang = base + (i / (rays - 1) - 0.5) * 1.6;
        this.line(n.x, n.y, n.x + Math.cos(ang) * reach, n.y + Math.sin(ang) * reach);
      }
      ctx.globalAlpha = 1;
      if (f.hot) {
        ctx.fillStyle = INK.dst;
        for (let i = 0; i < f.hot; i++) {
          const q = Math.min(1, Math.max(0, (t - 0.3 - i * 0.12) / 0.8));
          if (q <= 0 || q >= 1) continue;
          ctx.globalAlpha = 1 - q * 0.6;
          this.dot(n.x + (T.x - n.x) * q, n.y + (T.y - n.y) * q + Math.sin(q * Math.PI) * (i - f.hot / 2) * 14, 2.4 * lw);
        }
        ctx.globalAlpha = 1;
      }
    }

    // feelers: the spider reaching toward the links it chose, or the sentinel toward its new ring
    for (const a of this.agents.values()) {
      const f = a.feelers;
      if (!f) continue;
      const t = Math.min(1, f.t / 0.6), fade = f.t > 1 ? 1 - (f.t - 1) / 0.6 : 1;
      ctx.strokeStyle = a.color; ctx.globalAlpha = 0.6 * Math.max(0, fade);
      const from = a.role === 'sentinel' ? T : a.body;
      for (const n of f.items) {
        if (!n) continue;
        this.line(from.x, from.y, from.x + (n.x - from.x) * t, from.y + (n.y - from.y) * t);
      }
      ctx.globalAlpha = 1;
    }

    // the bridge: a gold thread spun by the orb-weaver along the chain that was found
    const B = this.bridge;
    if (B) {
      if (B.was) {
        ctx.strokeStyle = INK.gold; ctx.globalAlpha = Math.max(0, 0.45 - (now - B.born) / 8);
        ctx.setLineDash([3 * lw, 4 * lw]);
        ctx.beginPath(); B.was.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        ctx.setLineDash([]);
      }
      const passed = B.pts.length - this.weaver.path.length;
      ctx.strokeStyle = INK.gold; ctx.lineWidth = 2.4 * lw; ctx.globalAlpha = 0.95;
      ctx.shadowColor = INK.gold; ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(B.pts[0].x, B.pts[0].y);
      for (let i = 1; i < Math.min(passed, B.pts.length); i++) ctx.lineTo(B.pts[i].x, B.pts[i].y);
      if (B.done) ctx.lineTo(T.x, T.y); else ctx.lineTo(this.weaver.x, this.weaver.y);
      ctx.stroke();
      ctx.shadowBlur = 0; ctx.lineWidth = lw; ctx.globalAlpha = 1;
    }

    // pages
    for (const n of this.nodes.values()) {
      if (n.hub) continue;
      if (n.state === 'queued') {
        ctx.fillStyle = n.heat === 1 ? INK.dst : n.heat ? '#7fd8e8' : '#cdc9de';
        ctx.globalAlpha = n.heat ? 0.85 : 0.3 + 0.5 * (n.scent || 0);
        this.dot(n.x, n.y, (n.heat === 1 ? 2.8 : 2.2) * Math.max(1, lw));
      } else if (n.state === 'claimed') {
        ctx.strokeStyle = n.by?.color || '#fff'; ctx.lineWidth = 1.4 * lw;
        ctx.setLineDash([3 * lw, 3 * lw]); ctx.lineDashOffset = -now * 20 * lw;
        this.ring(n.x, n.y, 7);
        ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.lineWidth = lw;
      } else if (n.state === 'read') {
        const c = n.onBridge ? INK.gold : n.by?.color || INK.link;
        ctx.fillStyle = c; ctx.globalAlpha = 0.85;
        this.dot(n.x, n.y, n.onBridge ? 6 : 4.5);
        ctx.strokeStyle = c; ctx.globalAlpha = 1;
        this.ring(n.x, n.y, n.onBridge ? 6 : 4.5);
      } else if (n.state === 'fail') {
        ctx.strokeStyle = INK.bad; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.4 * lw;
        const s = 4;
        this.line(n.x - s, n.y - s, n.x + s, n.y + s); this.line(n.x + s, n.y - s, n.x - s, n.y + s);
        ctx.lineWidth = lw;
      }
      if (this.selected === n || this.hover?.node === n) {
        ctx.globalAlpha = 1; ctx.strokeStyle = INK.dst; ctx.lineWidth = 1.2 * lw;
        this.ring(n.x, n.y, 11);
        ctx.lineWidth = lw;
      }
      ctx.globalAlpha = 1;
    }
    if (this.hover?.zone) { ctx.strokeStyle = INK.dst; this.ring(this.hover.zone.x, this.hover.zone.y, 7); }

    // the two ends
    const pulse = (Math.sin(now * 2.2) + 1) / 2;
    for (const [h, c] of [[S, INK.src], [T, INK.dst]]) {
      if (!h.title) continue;
      ctx.fillStyle = c; this.dot(h.x, h.y, 7);
      ctx.strokeStyle = c; ctx.globalAlpha = 0.5 - pulse * 0.35;
      this.ring(h.x, h.y, 12 + pulse * 10);
      ctx.globalAlpha = 1;
      if (this.selected === h || this.hover?.node === h) { ctx.strokeStyle = '#fff'; this.ring(h.x, h.y, 16); }
    }

    // flashes
    for (const f of this.flashes) {
      const e = f.t / 1.4;
      ctx.strokeStyle = f.c; ctx.fillStyle = f.c; ctx.globalAlpha = 1 - e; ctx.lineWidth = 1.4 * lw;
      if (f.kind === 'pulse') {
        const q = Math.min(1, f.t / 0.9);
        this.dot(f.from.x + (f.to.x - f.from.x) * q, f.from.y + (f.to.y - f.from.y) * q, 2.6 * lw);
      } else {
        const x = f.node.x, y = f.node.y;
        if (f.kind === 'ring') for (let i = 0; i < Math.max(1, f.n); i++) this.ring(x, y, 8 + e * 26 + i * 6);
        else this.ring(x, y, 6 + e * 18);
      }
      ctx.globalAlpha = 1; ctx.lineWidth = lw;
    }

    // spiders
    for (const a of this.agents.values()) a.body.draw(ctx, now, lw, a.body.twitchy);
    if (B) this.weaver.draw(ctx, now, lw, this.weaver.moving);

    this.drawLabels();
  }

  drawLabels() {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'middle';
    const placed = [];
    const free = (box) => !placed.some((q) => box.x < q.x + q.w && q.x < box.x + box.w && box.y < q.y + q.h && q.y < box.y + box.h);

    // the two ends, always
    ctx.textAlign = 'center';
    for (const [h, c, sub] of [[this.src, INK.src, 'from'], [this.dst, INK.dst, 'to']]) {
      if (!h.title) continue;
      const p = this.toScreen(h.x, h.y);
      const up = this.vertical && h === this.src; // on tall screens the source labels sit above it
      ctx.font = `10px ${MONO_FONT}`; ctx.fillStyle = INK.dim;
      ctx.fillText(sub.toUpperCase(), p.x, up ? p.y - 40 : p.y + 26);
      ctx.font = `bold 13px ${MONO_FONT}`; ctx.fillStyle = c;
      ctx.fillText(short(h.title, 26), p.x, up ? p.y - 25 : p.y + 41);
      placed.push({ x: p.x - 90, y: up ? p.y - 48 : p.y + 18, w: 180, h: 32 });
      if (h === this.dst && this.scentWords.length && !this.bridge) {
        ctx.font = `10px ${MONO_FONT}`; ctx.fillStyle = INK.dst; ctx.globalAlpha = 0.6;
        ctx.fillText(this.scentWords.join(' · '), p.x, p.y + 56);
        ctx.globalAlpha = 1;
        placed.push({ x: p.x - 110, y: p.y + 50, w: 220, h: 14 });
      }
    }
    ctx.textAlign = 'left';

    // pages: the bridge first, then pages read, biggest news first
    const ranked = [...this.nodes.values()].filter((n) => !n.hub && n.state === 'read')
      .sort((a, b) => (b.onBridge === true) - (a.onBridge === true) || (b === this.selected) - (a === this.selected) || (b.readAt || 0) - (a.readAt || 0));
    const B = this.bridge;
    for (const n of ranked) {
      if (!B && [...this.agents.values()].some((a) => Math.hypot(a.body.x - n.x, a.body.y - n.y) < 24)) continue;
      const p = this.toScreen(n.x, n.y);
      const label = short(n.title, n.onBridge ? (this.vertical ? 24 : 34) : this.vertical ? 22 : 28);
      if (n.onBridge) {
        // on the bridge: alternating sides of the gold thread
        const alt = B.pts.indexOf(n) % 2 === 1;
        const w = label.length * 7.2 + 6;
        ctx.font = `bold 11px ${MONO_FONT}`; ctx.fillStyle = INK.gold;
        if (this.vertical) {
          const x = alt ? p.x - 12 : p.x + 12;
          ctx.textAlign = alt ? 'right' : 'left';
          ctx.fillText(label, x, p.y);
          placed.push({ x: alt ? x - w : x, y: p.y - 8, w, h: 16 });
        } else {
          const y = alt ? p.y - 15 : p.y + 17;
          ctx.textAlign = 'center';
          ctx.fillText(label, p.x, y);
          placed.push({ x: p.x - w / 2, y: y - 8, w, h: 16 });
        }
        ctx.textAlign = 'left';
        continue;
      }
      const box = { x: p.x + 8, y: p.y - 8, w: label.length * 6.8 + 4, h: 16 };
      if (!free(box)) continue;
      placed.push(box);
      ctx.font = `11px ${MONO_FONT}`;
      ctx.fillStyle = INK.text; ctx.globalAlpha = B ? 0.45 : 0.8;
      ctx.fillText(label, p.x + 10, p.y);
      ctx.globalAlpha = 1;
    }

    // spiders (once the bridge is up, only the orb-weaver speaks)
    if (!B) {
      const tags = [];
      for (const a of this.agents.values()) {
        const p = this.toScreen(a.body.x, a.body.y);
        let label = a.state === 'home' && !a.body.moving ? '' : a.label;
        if (label && (a.state === 'fetch' || a.state === 'walk')) label += ` ${(this.now - a.t0).toFixed(1)}s`;
        label = short(label, 46);
        if (a.role === 'sentinel') {
          label = short(label, 30);
          ctx.textAlign = 'center';
          ctx.font = `bold 10px ${MONO_FONT}`; ctx.fillStyle = a.color;
          ctx.fillText(a.name.toUpperCase(), p.x, p.y - 32);
          ctx.font = `10px ${MONO_FONT}`; ctx.fillStyle = a.tone === 'hot' ? INK.dst : INK.text;
          if (label) ctx.fillText(label, p.x, p.y - 20);
          ctx.textAlign = 'left';
          continue;
        }
        const w = Math.max(a.name.length, label.length) * 6.4 + 4;
        let y = p.y - 14;
        for (let tries = 0; tries < 4 && tags.some((q) => p.x + 12 < q.x + q.w && q.x < p.x + 12 + w && y - 6 < q.y + 24 && q.y - 6 < y + 18); tries++) y += 28;
        tags.push({ x: p.x + 12, y, w });
        ctx.font = `bold 10px ${MONO_FONT}`; ctx.fillStyle = a.color;
        ctx.fillText(a.name.toUpperCase(), p.x + 12, y);
        if (!label) continue;
        ctx.font = `10px ${MONO_FONT}`;
        ctx.fillStyle = a.tone === 'bad' ? INK.bad : a.tone === 'dim' ? INK.dim : a.tone === 'hot' ? INK.dst : INK.text;
        ctx.fillText(label, p.x + 12, y + 12);
      }
    } else {
      const wp = this.toScreen(this.weaver.x, this.weaver.y);
      ctx.font = `bold 10px ${MONO_FONT}`; ctx.fillStyle = INK.gold; ctx.textAlign = 'center';
      ctx.fillText(B.done ? 'ARANEUS · bridge spun' : 'ARANEUS · spinning the bridge', wp.x, wp.y - 22);
      ctx.textAlign = 'left';
    }
  }
}
