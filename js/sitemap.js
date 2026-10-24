// THE SITE MAP: a whole-site crawl drawn as an orb web. The start page is the hub, every page is a knot,
// and each link that led the crawl to a page is a thread. Pages one click deeper sit on the next ring.
// Pages that were found but not crawled are faint dots; pages that failed are snapped threads.

class SiteMap {
  constructor(els, hooks) {
    this.els = els;     // { box, canvas, head, tip }
    this.hooks = hooks; // { onOpen(url), onClose() }
    this.ctx = els.canvas.getContext('2d');
    this.visible = false;
    this.hover = null;
    els.canvas.addEventListener('mousemove', (e) => this.move(e));
    els.canvas.addEventListener('mouseleave', () => this.setHover(null));
    els.canvas.addEventListener('click', (e) => { this.move(e); if (this.hover) this.hooks.onOpen(this.hover.url); });
    els.head.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) this.hooks.onClose(); });
    new ResizeObserver(() => { if (this.visible) this.layout(); }).observe(els.box);
  }

  show(site) {
    this.site = site;
    this.visible = true;
    this.els.box.hidden = false;
    this.t = 0; this.amp = 0;
    this.layout();
    this.spider = new SpiderBody(this.cx, this.cy, { color: '#ffcc4d', species: 'orb', scale: 1.1 });
    this.spider.h = -Math.PI / 2;
    this.spider.replant();
    const all = [...site.nodes.values()];
    const crawled = all.filter((n) => n.crawled).length, broken = all.filter((n) => this.broken(n)).length;
    const more = all.length - crawled - all.filter((n) => n.error).length;
    this.els.head.innerHTML = `<div><b>Site map</b><span>${crawled} page${crawled === 1 ? '' : 's'} crawled · ${more} more found${broken ? ` · <em class="bad">${broken} broken</em>` : ''}${this.hidden ? ` · ${this.hidden} not drawn` : ''}</span></div>
      <div class="legend"><i class="k"></i>crawled <i class="d"></i>found, not crawled <i class="b"></i>broken</div>
      <button data-close>Back to the page</button>`;
  }

  hide() { this.visible = false; this.els.box.hidden = true; this.setHover(null); }

  broken(n) { return Boolean(n.error) || n.status >= 400 || n.status < 0; }

  // The crawled pages form a radial tree on the inner rings: each gets a slice of the circle in proportion
  // to the crawled pages that hang off it. Pages found but not crawled are dots spaced evenly around the rim.
  layout() {
    const b = this.els.box.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = b.width; this.H = b.height;
    this.els.canvas.width = Math.round(b.width * this.dpr);
    this.els.canvas.height = Math.round(b.height * this.dpr);
    this.cx = this.W / 2; this.cy = this.H / 2 + 26;
    const nodes = this.site.nodes, all = [...nodes.values()];
    const main = all.filter((n) => n.crawled || n.error);
    const found = all.filter((n) => !n.crawled && !n.error);
    const rim = found.slice(0, 180);
    this.hidden = found.length - rim.length;
    const kids = new Map();
    for (const n of main) if (n.parent) { if (!kids.has(n.parent)) kids.set(n.parent, []); kids.get(n.parent).push(n); }
    // name pages by their address when the whole site shares one title
    const titles = new Map();
    for (const n of main) titles.set(n.title, (titles.get(n.title) || 0) + 1);
    for (const n of all) n.name = pageName(n, titles.get(n.title) > 1);
    const leaves = (n) => (n.leaves = (kids.get(n.url) || []).reduce((s, c) => s + leaves(c), 0) || 1);
    const root = nodes.get(this.site.start);
    leaves(root);
    const maxD = Math.max(1, ...main.map((n) => n.depth)) + (rim.length ? 1 : 0);
    this.R = Math.min(this.W * 0.44, (this.H - 70) * 0.45);
    const at = (n, a, r) => { n.a = a; n.r = r; n.x = this.cx + Math.cos(a) * r; n.y = this.cy + Math.sin(a) * r; };
    const place = (n, a0, a1) => {
      at(n, (a0 + a1) / 2, (n.depth / maxD) * this.R);
      let a = a0;
      for (const c of kids.get(n.url) || []) { const span = ((a1 - a0) * c.leaves) / n.leaves; place(c, a, a + span); a += span; }
    };
    place(root, -Math.PI / 2, Math.PI * 1.5);
    // the rim, in the order of the pages that found them, so threads stay short
    rim.sort((p, q) => (nodes.get(p.parent)?.a ?? 0) - (nodes.get(q.parent)?.a ?? 0));
    const a0 = rim.length ? nodes.get(rim[0].parent)?.a ?? -Math.PI / 2 : 0;
    rim.forEach((n, i) => at(n, a0 + (i / rim.length) * Math.PI * 2, this.R));
    this.shown = main.concat(rim);
    this.ids = new Set(this.shown.map((n) => n.url));
    this.spokes = Math.max(16, (kids.get(root.url) || []).length);
  }

  move(e) {
    const b = this.els.canvas.getBoundingClientRect();
    const x = e.clientX - b.left, y = e.clientY - b.top;
    let best = null, bd = 16;
    for (const n of this.shown || []) {
      const d = Math.hypot(n.x - x, n.y - y) - (n.crawled ? 4 : 0);
      if (d < bd) { bd = d; best = n; }
    }
    this.setHover(best);
  }

  setHover(n) {
    if (n === this.hover) return;
    this.hover = n;
    this.els.canvas.style.cursor = n ? 'pointer' : 'default';
    const tip = this.els.tip;
    if (!n) { tip.hidden = true; return; }
    this.amp = 4; // a touch sets the web trembling
    this.spider?.walk([{ x: n.x, y: n.y }]);
    const state = n.error ? `<em class="bad">could not be crawled: ${esc(n.error)}</em>`
      : this.broken(n) ? `<em class="bad">broken link (${n.status < 0 ? 'blocked by robots.txt' : n.status})</em>`
      : n.crawled ? `crawled · ${n.status}${n.depth ? ` · ${n.depth} click${n.depth === 1 ? '' : 's'} from the start` : ' · where the crawl started'}`
      : 'found, not crawled';
    tip.innerHTML = `<b>${esc(n.title || n.url.replace(/^https?:\/\/[^/]+/, '') || '/')}</b><span>${esc(n.url)}</span><small>${state}</small><small>Click to put it on stage</small>`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(this.W - tw - 8, n.x + 14)) + 'px';
    tip.style.top = Math.max(60, Math.min(this.H - th - 8, n.y + 14)) + 'px';
  }

  frame(dt) {
    if (!this.visible || !this.shown) return;
    this.t += dt;
    this.amp *= Math.exp(-dt * 2.5);
    this.spider.update(dt, this.t);
    this.draw();
  }

  // Where a knot sits right now: its place, plus a tremble when the web was touched.
  pos(n) {
    const w = this.amp * Math.sin(this.t * 26 + n.r * 0.05) * (n.r / this.R);
    return [n.x + Math.cos(n.a + 1.57) * w, n.y + Math.sin(n.a + 1.57) * w];
  }

  draw() {
    const { ctx, dpr, cx, cy, R } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const grow = Math.min(1, this.t / 1.6), reach = grow * R * 1.1; // the web spins out from the hub
    ctx.lineCap = 'round';

    // frame silk: spokes and a capture spiral that sags between them
    ctx.strokeStyle = 'rgba(231,233,240,.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < this.spokes; i++) {
      const a = -Math.PI / 2 + (i / this.spokes) * Math.PI * 2;
      ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(231,233,240,.06)';
    for (let rr = 26; rr < reach; rr += 26) {
      ctx.beginPath();
      for (let i = 0; i <= this.spokes; i++) {
        const a = -Math.PI / 2 + (i / this.spokes) * Math.PI * 2;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (!i) { ctx.moveTo(x, y); continue; }
        const m = a - Math.PI / this.spokes, sag = rr * 0.94;
        ctx.quadraticCurveTo(cx + Math.cos(m) * sag, cy + Math.sin(m) * sag, x, y);
      }
      ctx.stroke();
    }

    const seen = (n) => n.r <= reach;
    const byUrl = this.site.nodes;
    // threads: cross links between crawled pages, faint
    ctx.strokeStyle = 'rgba(255,204,77,.10)';
    ctx.beginPath();
    let cross = 0;
    for (const e of this.site.edges) {
      if (cross > 400) break;
      const [from, to] = e.split('\n');
      const a = byUrl.get(from), b = byUrl.get(to);
      if (!a || !b || !a.crawled || !b.crawled || b.parent === from || !seen(a) || !seen(b)) continue;
      const [ax, ay] = this.pos(a), [bx, by] = this.pos(b);
      ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx + (ax + bx - 2 * cx) * 0.3, cy + (ay + by - 2 * cy) * 0.3, bx, by);
      cross++;
    }
    ctx.stroke();

    // threads: the link that led the crawl to each page
    for (const n of this.shown) {
      const p = n.parent && byUrl.get(n.parent);
      if (!p || !this.ids.has(p.url) || !seen(p)) continue;
      const [px, py] = this.pos(p), [nx, ny] = this.pos(n);
      const k = Math.min(1, (reach - p.r) / Math.max(1, n.r - p.r)); // still being spun out
      const ex = px + (nx - px) * k, ey = py + (ny - py) * k;
      const hot = this.hover === n || this.hover === p;
      if (this.broken(n)) {
        // snapped: two loose ends that curl back
        ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.85;
        const mx = px + (ex - px) * 0.42, my = py + (ey - py) * 0.42, nx2 = px + (ex - px) * 0.62, ny2 = py + (ey - py) * 0.62;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(mx, my, mx + (my - py) * 0.12, my - (mx - px) * 0.12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.quadraticCurveTo(nx2, ny2, nx2 - (ny2 - ey) * 0.12, ny2 + (nx2 - ex) * 0.12); ctx.stroke();
      } else {
        ctx.strokeStyle = n.crawled ? '#ffcc4d' : '#8b91a7';
        ctx.globalAlpha = hot ? 0.95 : n.crawled ? 0.55 : 0.2;
        ctx.lineWidth = hot ? 2 : n.crawled ? 1.3 : 0.8;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // knots
    for (const n of this.shown) {
      if (!seen(n)) continue;
      const [x, y] = this.pos(n);
      const hot = this.hover === n;
      if (this.broken(n)) { ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(x, y, hot ? 6 : 4.5, 0, 6.2832); ctx.fill(); }
      else if (n.crawled) {
        ctx.fillStyle = '#ffcc4d';
        ctx.shadowColor = '#ffcc4d'; ctx.shadowBlur = hot ? 16 : 8;
        ctx.beginPath(); ctx.arc(x, y, hot ? 7 : n.depth ? 5 : 7, 0, 6.2832); ctx.fill();
        ctx.shadowBlur = 0;
      } else { ctx.fillStyle = hot ? '#e7e9f0' : 'rgba(139,145,167,.7)'; ctx.beginPath(); ctx.arc(x, y, hot ? 4 : 2.2, 0, 6.2832); ctx.fill(); }
    }

    // names of the crawled pages, set outside their knot
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const n of this.shown) {
      if (!n.crawled || !seen(n) || this.t < 0.8) continue;
      const [x, y] = this.pos(n);
      const name = short(n.name, 26);
      // the hub's name sits under the spider; the rest point away from the hub
      const hub = n.depth === 0, right = Math.cos(n.a) >= 0;
      const lx = hub ? x : x + (right ? 10 : -10), ly = hub ? y + 34 : y;
      ctx.textAlign = hub ? 'center' : right ? 'left' : 'right';
      ctx.globalAlpha = Math.min(1, (this.t - 0.8) * 3) * (this.hover && this.hover !== n ? 0.55 : 1);
      ctx.fillStyle = 'rgba(11,13,18,.8)';
      const w = ctx.measureText(name).width;
      ctx.fillRect(hub ? lx - w / 2 - 3 : right ? lx - 3 : lx - w - 3, ly - 8, w + 6, 16);
      ctx.fillStyle = this.hover === n ? '#ffcc4d' : '#e7e9f0';
      ctx.fillText(name, lx, ly);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';

    this.spider.draw(ctx, this.t, 1.3, this.spider.moving);
  }
}

// A short name for a page: its title without the site's name, or the end of its address
// (when there is no title, or every page has the same one).
function pageName(n, byAddress) {
  const t = clean(n.title || '');
  if (t && (!byAddress || n.depth === 0)) {
    const parts = t.split(/\s+[|·–—-]\s+/);
    return parts.length > 1 && parts[0].length > 2 ? parts[0] : t;
  }
  const u = new URL(n.url);
  const path = decodeURIComponent(u.pathname).replace(/\/index\.\w+$/, '').split('/').filter(Boolean);
  const page = path.length > 2 && /^page$/i.test(path.at(-2)) && /^\d+$/.test(path.at(-1)) ? ` · p${path.splice(-2)[1]}` : '';
  return (path.slice(-2).join('/') || '/') + page + (u.search ? '?' : '');
}
