// A procedural spider body: eight IK legs with alternating gait, walking along a list of waypoints.
// Waypoints are live objects with x/y (graph nodes move), so the spider follows them as they drift.

export class SpiderBody {
  constructor(x, y, { color = '#ff2bd6', size = 4, speed = 150 } = {}) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.h = Math.random() * 6.283 - 3.14;
    this.color = color;
    this.size = size;
    this.speed = speed;
    this.speedMul = 1;
    this.seed = Math.random() * 20;
    this.path = [];
    this.rest = null;       // object to sit on when the path is empty
    this.twitchy = false;   // legs fidget (working in place)
    this.reach = size * 6;
    const mult = [1.15, 0.95, 0.9, 1.1];
    this.legs = [];
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? 1 : -1, k = i % 4;
      const ang = side * (0.5 + k * 0.7), r = this.reach * mult[k];
      const fx = x + Math.cos(this.h + ang) * r, fy = y + Math.sin(this.h + ang) * r;
      this.legs.push({ ang, k, r, g: (k + (side > 0 ? 0 : 1)) % 2, fx, fy, sx: fx, sy: fy, tx: fx, ty: fy, t: 1 });
    }
  }

  get moving() { return this.path.length > 0; }

  walk(points) { this.path = points.filter(Boolean); }

  // Drop straight to a spot (rappelling on a dragline); legs re-plant around the new position.
  teleport(x, y) {
    const dx = x - this.x, dy = y - this.y;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    for (const l of this.legs) { l.fx += dx; l.fy += dy; l.sx += dx; l.sy += dy; l.tx += dx; l.ty += dy; }
  }
  stop() { this.path = []; }

  update(dt, now) {
    let tg = this.path[0];
    let settling = false;
    if (!tg && this.rest) { tg = this.rest; settling = true; }
    if (tg) {
      const dx = tg.x - this.x, dy = tg.y - this.y, d = Math.hypot(dx, dy);
      if (settling && d < 3) {
        this.vx *= 0.8; this.vy *= 0.8;
      } else {
        const sp = this.speed * this.speedMul * Math.min(1, d / 50 + 0.2);
        const a = Math.atan2(dy, dx) + Math.sin(now * 3 + this.seed) * 0.3 * Math.min(1, d / 100);
        const kk = Math.min(1, dt * 5);
        this.vx += (Math.cos(a) * sp - this.vx) * kk;
        this.vy += (Math.sin(a) * sp - this.vy) * kk;
        if (!settling && d < 5) this.path.shift();
      }
    } else {
      this.vx *= 0.8; this.vy *= 0.8;
    }
    this.x += this.vx * dt; this.y += this.vy * dt;

    if (Math.hypot(this.vx, this.vy) > 8) {
      const vh = Math.atan2(this.vy, this.vx);
      const dh = ((vh - this.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.h += dh * Math.min(1, dt * 6);
      this.h = Math.atan2(Math.sin(this.h), Math.cos(this.h));
    }

    const stepping = [0, 0];
    for (const l of this.legs) if (l.t < 1) stepping[l.g]++;
    for (const l of this.legs) {
      const la = this.h + l.ang;
      const ix = this.x + Math.cos(la) * l.r + this.vx * 0.18;
      const iy = this.y + Math.sin(la) * l.r + this.vy * 0.18;
      if (l.t < 1) {
        l.t = Math.min(1, l.t + dt / 0.085);
        const e = l.t * l.t * (3 - 2 * l.t);
        l.fx = l.sx + (l.tx - l.sx) * e;
        l.fy = l.sy + (l.ty - l.sy) * e;
      } else {
        const fd = Math.hypot(ix - l.fx, iy - l.fy);
        const twitch = this.twitchy && Math.random() < dt * 2.5;
        if ((fd > l.r * 0.5 && stepping[1 - l.g] === 0) || twitch) {
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

  // Draw in the current transform's coordinates. lw = line width in those units.
  draw(ctx, now, lw = 1, pulse = false) {
    const { x, y, size: s } = this;
    const ch = Math.cos(this.h), sh = Math.sin(this.h);
    ctx.strokeStyle = this.color; ctx.fillStyle = this.color; ctx.lineWidth = lw;
    ctx.globalAlpha = 0.95;
    for (const l of this.legs) {
      const dx = l.fx - x, dy = l.fy - y, d = Math.hypot(dx, dy) || 1;
      const L = l.r * 0.62;
      const hk = d < 2 * L ? Math.sqrt(L * L - (d * d) / 4) * 0.6 : 0;
      const px = -dy / d, py = dx / d;
      const sgn = ((px * ch + py * sh) < 0 ? -1 : 1) * (l.k < 2 ? 1 : -1);
      const kx = x + dx / 2 + px * hk * sgn, ky = y + dy / 2 + py * hk * sgn;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(kx, ky); ctx.lineTo(l.fx, l.fy); ctx.stroke();
      ctx.fillRect(l.fx - lw, l.fy - lw, lw * 2, lw * 2);
    }
    ctx.beginPath(); ctx.arc(x - ch * s * 1.4, y - sh * s * 1.4, s * 1.15, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, s * 0.72, 0, 6.2832); ctx.fill();
    if (pulse) {
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(x, y, s * 2.8 + Math.sin(now * 14) * s * 0.4, 0, 6.2832); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

export const PALETTE = ['#ff2bd6', '#25e2ff', '#c6ff4a', '#ffb02e', '#a974ff', '#5b9dff'];
export const GLYPHS = '░▒▓<>/\\|_=+*#%&$@01ΔΣΛ';
