// THE THREAD: rest the mouse on a result and a strand of silk runs from that row, across the layout, to the
// item on the page. It is drawn on its own canvas over the whole window, so it can cross from the results
// panel into the stage. The item itself pulses on the stage (Stage.pin) for as long as the thread holds.

class Thread {
  constructor(canvas, stage) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stage = stage;
    this.cur = null;   // { row, target, color }
    this.want = false; // true while the mouse is still on the row
    this.p = 0;        // how far along the thread has grown, 0 to 1
    this.dirty = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight; this.dpr = dpr;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
  }

  // Run a thread from this row to this item. The page scrolls to the item first if it is out of view.
  show(row, target, color) {
    if (!this.stage.itemRect(target)) return;
    if (this.cur?.target !== target) this.p = 0;
    this.cur = { row, target, color };
    this.want = true;
    this.stage.glide(target);
    this.stage.pin = { target, color, k: 0 };
  }

  // The mouse left: the thread winds back into its row.
  hide() { this.want = false; }

  // Where the item is on screen, kept inside the stage so an item that is off-screen still gets a thread pointing at it.
  endpoint() {
    const { stage } = this, r = stage.itemRect(this.cur.target);
    if (!r || !stage.win) return null;
    const f = stage.els.frame.getBoundingClientRect(), v = stage.view();
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    return { x: clamp(f.left + r.x - v.x, f.left + 6, f.right - 6), y: clamp(f.top + r.y - v.y + r.h / 2, f.top + 6, f.bottom - 6) };
  }

  frame(dt) {
    if (!this.cur) return;
    const instant = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.p = instant ? Number(this.want) : Math.max(0, Math.min(1, this.p + (this.want ? dt / 0.15 : -dt / 0.2)));
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.stage.pin) this.stage.pin.k = this.p;
    if (!this.want && this.p <= 0) { this.cur = null; this.stage.pin = null; return; }
    if (!this.cur.row.isConnected) this.want = false; // the list was redrawn under it
    const end = this.endpoint(), rr = this.cur.row.isConnected && this.cur.row.getBoundingClientRect();
    if (!end || !rr || !rr.height) return;
    const x0 = rr.left, y0 = rr.top + rr.height / 2;
    // a strand with a little sag, drawn from the row toward the item as far as it has grown
    const cx = (x0 + end.x) / 2, cy = Math.max(y0, end.y) + Math.min(60, Math.abs(x0 - end.x) * 0.12) + 8;
    const at = (t) => [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * end.x, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * end.y];
    ctx.strokeStyle = ctx.fillStyle = this.cur.color;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) { const [x, y] = at((i / 28) * this.p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x0, y0, 2.6, 0, 6.2832); ctx.fill();
    if (this.p >= 1) { ctx.beginPath(); ctx.arc(end.x, end.y, 3.2, 0, 6.2832); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
}
