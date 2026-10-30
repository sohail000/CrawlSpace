// A procedural spider: eight IK legs with an alternating gait. Each species has its own build
// (leg length, body shape, eyes) and way of moving: walking along waypoints, or jumping in an arc.

const SPECIES = {
  orb:      { size: 5,   legs: 1.0,  legWidth: 1.2, abdomen: 1.7, head: 0.75, speed: 170, bands: true },
  funnel:   { size: 5.5, legs: 0.85, legWidth: 2.0, abdomen: 1.3, head: 0.9,  speed: 150, gloss: true },
  jumping:  { size: 4.5, legs: 0.7,  legWidth: 1.6, abdomen: 1.1, head: 1.0,  speed: 140, eyes: true },
  huntsman: { size: 4.5, legs: 1.7,  legWidth: 1.1, abdomen: 1.0, head: 0.8,  speed: 420 },
  reader:   { size: 3.6, legs: 0.95, legWidth: 1.0, abdomen: 1.2, head: 0.7,  speed: 200 },
  mimic:    { size: 4.2, legs: 1.25, legWidth: 1.2, abdomen: 1.45, head: 0.75, speed: 190, spots: true },
};

class SpiderBody {
  constructor(x, y, { color = '#ff2bd6', species = 'orb', scale = 1 } = {}) {
    const sp = SPECIES[species] || SPECIES.orb;
    this.sp = sp;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.h = -Math.PI / 2;
    this.color = color;
    this.size = sp.size * scale;
    this.speed = sp.speed * scale;
    this.speedMul = 1;
    this.seed = Math.random() * 20;
    this.path = [];
    this.rest = null;      // where to sit when the path is empty
    this.twitchy = false;  // legs fidget while it works in place
    this.leap = null;      // an arc in flight: { x0, y0, x1, y1, t, dur, hgt }
    this.reach = this.size * 6 * sp.legs;
    const mult = [1.15, 0.95, 0.9, 1.1];
    this.legs = [];
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? 1 : -1, k = i % 4;
      const ang = side * (0.5 + k * 0.7), r = this.reach * mult[k];
      const fx = x + Math.cos(this.h + ang) * r, fy = y + Math.sin(this.h + ang) * r;
      this.legs.push({ ang, k, r, g: (k + (side > 0 ? 0 : 1)) % 2, fx, fy, sx: fx, sy: fy, tx: fx, ty: fy, t: 1 });
    }
  }

  get moving() { return this.path.length > 0 || Boolean(this.leap); }

  walk(points) { this.leap = null; this.path = points.filter(Boolean); }
  stop() { this.path = []; this.leap = null; }

  // A jumping spider's leap: a parabolic arc, legs tucked in flight.
  jump(x, y, dur = 0.45) {
    this.path = [];
    const d = Math.hypot(x - this.x, y - this.y);
    this.leap = { x0: this.x, y0: this.y, x1: x, y1: y, t: 0, dur, hgt: Math.min(140, 24 + d * 0.35) };
    this.h = Math.atan2(y - this.y, x - this.x);
  }

  // Drop straight to a spot; legs re-plant around it.
  teleport(x, y) {
    const dx = x - this.x, dy = y - this.y;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.leap = null; this.path = [];
    for (const l of this.legs) { l.fx += dx; l.fy += dy; l.sx += dx; l.sy += dy; l.tx += dx; l.ty += dy; }
  }

  update(dt, now) {
    if (this.leap) {
      const L = this.leap;
      L.t = Math.min(1, L.t + (dt * this.speedMul) / L.dur);
      const px = this.x, py = this.y;
      this.x = L.x0 + (L.x1 - L.x0) * L.t;
      this.y = L.y0 + (L.y1 - L.y0) * L.t - Math.sin(L.t * Math.PI) * L.hgt;
      for (const l of this.legs) { l.fx += this.x - px; l.fy += this.y - py; l.t = 1; }
      if (L.t >= 1) { this.leap = null; this.vx = this.vy = 0; this.replant(); }
      return;
    }
    let tg = this.path[0];
    let settling = false;
    if (!tg && this.rest) { tg = this.rest; settling = true; }
    if (tg) {
      const dx = tg.x - this.x, dy = tg.y - this.y, d = Math.hypot(dx, dy);
      if (settling && d < 3) {
        this.vx *= 0.8; this.vy *= 0.8;
      } else {
        const sp = this.speed * this.speedMul * Math.min(1, d / 50 + 0.2);
        const a = Math.atan2(dy, dx) + Math.sin(now * 3 + this.seed) * 0.25 * Math.min(1, d / 100);
        const kk = Math.min(1, dt * 6);
        this.vx += (Math.cos(a) * sp - this.vx) * kk;
        this.vy += (Math.sin(a) * sp - this.vy) * kk;
        if (!settling && d < 6) this.path.shift();
      }
    } else {
      this.vx *= 0.8; this.vy *= 0.8;
    }
    this.x += this.vx * dt; this.y += this.vy * dt;

    if (Math.hypot(this.vx, this.vy) > 8) {
      const vh = Math.atan2(this.vy, this.vx);
      const dh = ((vh - this.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.h += dh * Math.min(1, dt * 7);
      this.h = Math.atan2(Math.sin(this.h), Math.cos(this.h));
    }

    const stepping = [0, 0];
    for (const l of this.legs) if (l.t < 1) stepping[l.g]++;
    const stepTime = 0.085 / Math.max(1, this.speedMul * 0.7);
    for (const l of this.legs) {
      const la = this.h + l.ang;
      const ix = this.x + Math.cos(la) * l.r + this.vx * 0.16;
      const iy = this.y + Math.sin(la) * l.r + this.vy * 0.16;
      if (l.t < 1) {
        l.t = Math.min(1, l.t + dt / stepTime);
        const e = l.t * l.t * (3 - 2 * l.t);
        l.fx = l.sx + (l.tx - l.sx) * e;
        l.fy = l.sy + (l.ty - l.sy) * e;
      } else {
        const fd = Math.hypot(ix - l.fx, iy - l.fy);
        const twitch = this.twitchy && Math.random() < dt * 2.5;
        if ((fd > l.r * 0.5 && stepping[1 - l.g] === 0) || fd > l.r * 1.6 || twitch) {
          l.sx = l.fx; l.sy = l.fy;
          const j = twitch ? this.size * 2 : 0;
          l.tx = ix + this.vx * 0.08 + (Math.random() - 0.5) * j;
          l.ty = iy + this.vy * 0.08 + (Math.random() - 0.5) * j;
          l.t = 0;
          stepping[l.g]++;
        }
      }
    }
  }

  replant() {
    for (const l of this.legs) {
      const la = this.h + l.ang;
      l.fx = l.sx = l.tx = this.x + Math.cos(la) * l.r;
      l.fy = l.sy = l.ty = this.y + Math.sin(la) * l.r;
      l.t = 1;
    }
  }

  draw(ctx, now, lw = 1, glow = false) {
    const { x, y, size: s, sp } = this;
    const ch = Math.cos(this.h), sh = Math.sin(this.h);
    ctx.save();
    ctx.strokeStyle = this.color; ctx.fillStyle = this.color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = lw * sp.legWidth;
    if (glow) { ctx.shadowColor = this.color; ctx.shadowBlur = 10; }
    const tuck = this.leap ? 0.45 : 1;
    for (const l of this.legs) {
      const fx = this.leap ? x + (l.fx - x) * tuck : l.fx, fy = this.leap ? y + (l.fy - y) * tuck : l.fy;
      const dx = fx - x, dy = fy - y, d = Math.hypot(dx, dy) || 1;
      const L = l.r * 0.62;
      const hk = d < 2 * L ? Math.sqrt(L * L - (d * d) / 4) * 0.6 : 0;
      const px = -dy / d, py = dx / d;
      const sgn = ((px * ch + py * sh) < 0 ? -1 : 1) * (l.k < 2 ? 1 : -1);
      const kx = x + dx / 2 + px * hk * sgn, ky = y + dy / 2 + py * hk * sgn;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
      // joints: a bright knee and a small foot, like points of light
      ctx.beginPath(); ctx.arc(kx, ky, lw * sp.legWidth * 0.95, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.arc(fx, fy, lw * sp.legWidth * 0.6, 0, 6.2832); ctx.fill();
    }
    ctx.shadowBlur = 0;
    // abdomen behind, head in front
    const ax = x - ch * s * 1.5 * sp.abdomen, ay = y - sh * s * 1.5 * sp.abdomen;
    ctx.beginPath(); ctx.ellipse(ax, ay, s * 1.15 * sp.abdomen, s * 0.95 * sp.abdomen, this.h, 0, 6.2832); ctx.fill();
    if (sp.bands) {
      ctx.strokeStyle = 'rgba(8,7,13,.55)'; ctx.lineWidth = lw * 1.2;
      for (const k of [-0.35, 0.15]) {
        const bx = ax + ch * s * k * sp.abdomen, by = ay + sh * s * k * sp.abdomen;
        ctx.beginPath(); ctx.moveTo(bx - sh * s * 0.8, by + ch * s * 0.8); ctx.lineTo(bx + sh * s * 0.8, by - ch * s * 0.8); ctx.stroke();
      }
    }
    if (sp.spots) {
      ctx.fillStyle = 'rgba(8,7,13,.5)';
      for (const [k, side] of [[-0.45, 0], [0.05, -1], [0.05, 1], [0.5, 0]]) {
        const bx = ax + ch * s * k * sp.abdomen - sh * s * 0.45 * side, by = ay + sh * s * k * sp.abdomen + ch * s * 0.45 * side;
        ctx.beginPath(); ctx.arc(bx, by, s * 0.22, 0, 6.2832); ctx.fill();
      }
      ctx.fillStyle = this.color;
    }
    if (sp.gloss) {
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.beginPath(); ctx.arc(ax + sh * s * 0.4, ay - ch * s * 0.4, s * 0.3, 0, 6.2832); ctx.fill();
      ctx.fillStyle = this.color;
    }
    ctx.beginPath(); ctx.arc(x, y, s * 0.8 * sp.head, 0, 6.2832); ctx.fill();
    if (sp.eyes) {
      ctx.fillStyle = '#fff';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(x + ch * s * 0.45 - sh * s * 0.32 * side, y + sh * s * 0.45 + ch * s * 0.32 * side, s * 0.28, 0, 6.2832); ctx.fill();
      }
      ctx.fillStyle = '#08070d';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(x + ch * s * 0.55 - sh * s * 0.32 * side, y + sh * s * 0.55 + ch * s * 0.32 * side, s * 0.13, 0, 6.2832); ctx.fill();
      }
    }
    ctx.restore();
  }
}
