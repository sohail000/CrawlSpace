// Feedback belongs to a real action: loading, choosing a spider, or landing a catch.
class Experience {
  constructor(stage, results, state, defs) {
    Object.assign(this, { stage, results, state, defs });
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.sound = false;
    this.shake = true;
    this.lastSound = -Infinity;
    this.lastCatch = -Infinity;
    this.icons = [];
    try {
      this.sound = localStorage.getItem('crawlspace.sound') === '1';
      this.shake = localStorage.getItem('crawlspace.shake') !== '0';
    } catch {}
    this.motion.addEventListener('change', () => {
      if (this.motion.matches) { stage.skip = true; stage.stopWaiting(); }
      this.buttons();
    });
    document.getElementById('sound').onclick = () => {
      this.sound = !this.sound;
      this.save('sound', this.sound);
      this.unlock();
      this.buttons();
    };
    document.getElementById('motion').onclick = () => {
      this.shake = !this.shake;
      this.save('shake', this.shake);
      this.buttons();
    };
    for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, () => this.unlock(), { passive: true });
    for (const id of ['close-summary', 'browse-results']) document.getElementById(id).onclick = () => this.closeSummary();
    document.getElementById('open-summary').onclick = () => this.summary();
    document.getElementById('download-all').onclick = () => this.download();
    const help = document.getElementById('shortcuts');
    document.getElementById('helpbtn').onclick = () => help.showModal();
    document.getElementById('close-help').onclick = () => help.close();
    help.addEventListener('click', (e) => { if (e.target === help && (e.clientX < help.getBoundingClientRect().left || e.clientX > help.getBoundingClientRect().right)) help.close(); });
    document.addEventListener('keydown', (e) => this.key(e));
    for (const b of document.querySelectorAll('[data-hunt]')) b.onclick = () => this.hunt(b.dataset.hunt);
    for (const canvas of document.querySelectorAll('#dock canvas')) {
      const def = defs.find((d) => d.species === canvas.dataset.species);
      canvas.width = canvas.height = 120;
      const body = new SpiderBody(30, 30, { color: def.color, species: def.species, scale: 0.58 });
      body.h = -Math.PI / 2 + 0.25;
      body.replant();
      this.icons.push({ canvas, body, kind: def.kind, until: 0 });
    }
    this.loader = new SpiderBody(80, 110, { color: '#e8bc6a', species: 'orb', scale: 0.8 });
    this.loader.h = Math.PI / 2;
    this.loader.replant();
    this.buttons();
    this.drawIcons(0, true);
    this.refresh();
    stage.onCatch = (kind, def, animated) => this.catch(kind, def, animated);
  }

  save(key, on) { try { localStorage.setItem('crawlspace.' + key, on ? '1' : '0'); } catch {} }

  buttons() {
    const s = document.getElementById('sound'), m = document.getElementById('motion');
    s.textContent = this.sound ? '♪ Sound on' : '♪ Sound off';
    s.setAttribute('aria-pressed', String(this.sound));
    m.textContent = this.motion.matches ? 'Motion reduced' : this.shake ? 'Shake on' : 'Shake off';
    m.setAttribute('aria-pressed', String(this.shake && !this.motion.matches));
    m.disabled = this.motion.matches;
  }

  unlock() {
    if (!this.sound) return;
    try {
      if (!this.audio) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        this.audio = new Audio();
        this.master = this.audio.createGain();
        this.master.gain.value = 0.16;
        this.master.connect(this.audio.destination);
      }
      if (this.audio.state === 'suspended') this.audio.resume().catch(() => {});
    } catch { this.sound = false; this.buttons(); }
  }

  pluck(kind) {
    const ctx = this.audio;
    if (!this.sound || !ctx || ctx.state !== 'running' || document.hidden) return;
    const t = ctx.currentTime;
    if (t - this.lastSound < 0.13) return;
    this.lastSound = t;
    const pitch = [220, 146.83, 440, 329.63, 261.63, 392][this.defs.findIndex((d) => d.kind === kind)] || 220;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch * 1.015, t);
    osc.frequency.exponentialRampToValueAtTime(pitch, t + 0.08);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t + 0.34);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  catch(kind, def, animated) {
    this.pluck(kind);
    this.dirty = true;
    const now = performance.now();
    if (this.motion.matches || !animated || now - this.lastCatch < 160) return;
    this.lastCatch = now;
    if (this.shake) {
      const size = kind === 'tables' ? 3 : 1.5;
      const field = document.getElementById('stagebox');
      this.shaking?.cancel();
      this.shaking = field.animate([
        { transform: 'translate(0,0)' }, { transform: `translate(${size}px,-${size / 2}px)` },
        { transform: `translate(-${size}px,${size / 3}px)` }, { transform: 'translate(0,0)' },
      ], { duration: 220, easing: 'ease-out' });
    }
    document.getElementById('haulcount').animate([{ background: def.color, color: '#111' }, { background: '#303a25', color: '#e8bc6a' }], { duration: 400 });
  }

  chosen(kind) {
    const icon = this.icons.find((i) => i.kind === kind);
    if (icon) icon.until = performance.now() + 450;
    this.drawIcons(performance.now(), true);
    document.getElementById('crewcount').textContent = this.state.selected.size;
  }

  drawIcons(now, force = false) {
    if (!force && now - (this.iconAt || 0) < 60) return;
    this.iconAt = now;
    for (const icon of this.icons) {
      const moving = !this.motion.matches && (now < icon.until || this.stage.spiders.some((s) => s.sp === icon.body.sp));
      const selected = this.state.selected.has(icon.kind);
      icon.canvas.closest('.chip').classList.toggle('working', moving && this.state.running);
      if (!force && !moving && !icon.wasMoving) continue;
      icon.wasMoving = moving;
      const ctx = icon.canvas.getContext('2d');
      ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, 60, 60);
      icon.body.twitchy = moving;
      if (moving) icon.body.update(0.06, now / 1000);
      ctx.globalAlpha = selected ? 1 : 0.6;
      icon.body.draw(ctx, now / 1000, 0.9, selected);
      ctx.globalAlpha = 1;
    }
  }

  frame(now) {
    if (document.hidden) return;
    this.drawIcons(now);
    if (this.dirty) { this.dirty = false; this.refresh(); }
    if (!document.getElementById('stagebox').classList.contains('loading')) { this.loadingAt = null; return; }
    if (this.loadingAt == null) this.loadingAt = now;
    if (now - (this.loaderAt || 0) < 50) return;
    this.loaderAt = now;
    const ctx = document.getElementById('loadspider').getContext('2d');
    const y = this.motion.matches ? 100 : Math.min(100, (now - this.loadingAt) / 5) + Math.sin(now / 420) * 4;
    ctx.clearRect(0, 0, 160, 180);
    ctx.strokeStyle = '#e8bc6a88'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, 0); ctx.lineTo(80, y); ctx.stroke();
    this.loader.teleport(80, y);
    this.loader.draw(ctx, now / 1000, 1, true);
  }

  refresh() {
    const D = this.results.data;
    const n = ['links', 'tables', 'regex', 'images', 'mimic'].reduce((s, k) => s + D[k].length, 0) + D.text.reduce((s, p) => s + p.md.length, 0);
    document.getElementById('haulcount').textContent = n.toLocaleString();
    document.getElementById('open-summary').disabled = this.state.running || !n;
    document.getElementById('crewcount').textContent = this.state.selected.size;
    document.getElementById('haulnote').textContent = this.state.running ? 'Collecting from the page, live.' : 'Every catch has a source.';
    document.getElementById('fieldstate').textContent = this.state.running ? 'HUNT IN PROGRESS' : this.state.demo ? 'LIVE DEMO · SAMPLE PAGE' : 'YOUR PAGE · SCRIPT-FREE';
  }

  start() {
    this.started = performance.now();
    if (!this.results.data.regex.length) this.pattern = this.state.pattern;
    this.closeSummary(false);
    this.refresh();
  }

  finish() {
    this.elapsed = Math.round((performance.now() - this.started) / 1000);
    this.refresh();
    if (!this.state.demo) this.summary();
  }

  closeSummary(focus = true) {
    const panel = document.getElementById('summary'), visible = !panel.hidden;
    panel.hidden = true;
    this.results.els.tabs.inert = false;
    this.results.els.body.inert = false;
    if (focus && visible) document.getElementById('open-summary').focus();
  }

  summary() {
    const D = this.results.data;
    const stats = this.defs.map((d) => ({ color: d.color, value: d.kind === 'text' ? D.text.reduce((s, p) => s + p.words, 0) : D[d.kind].length,
      label: d.kind === 'regex' ? (PATTERNS[this.pattern]?.label.toLowerCase() || 'matches') : { links: 'links', tables: 'tables', images: 'images', text: 'words', mimic: 'records' }[d.kind] }));
    const missing = D.images.filter((i) => i.altState === 'missing').length;
    const checked = D.links.filter((l) => l.status > 0);
    if (missing) stats.push({ color: '#ff7a59', value: missing, label: 'images without alt text' });
    if (checked.length) stats.push({ color: '#ff7a59', value: checked.filter((l) => l.status >= 400).length, label: `broken / ${checked.length} checked links` });
    document.getElementById('summary-label').textContent = this.state.demo ? 'A LITTLE TASTE OF WHAT’S POSSIBLE' : this.state.stop ? 'EXPEDITION STOPPED' : 'EXPEDITION COMPLETE';
    document.getElementById('summary-title').textContent = this.state.stop ? 'Here’s what we caught.' : 'A good day’s catch.';
    const pages = D.pages.filter((p) => !p.error).length;
    document.getElementById('summary-detail').textContent = `${pages || 1} page${pages > 1 ? 's' : ''} explored${this.state.demo ? ' · sample data' : ''}. Yours to keep.`;
    const list = document.getElementById('summary-stats');
    list.innerHTML = stats.filter((s) => s.value || s.label.startsWith('broken')).map((s) => `<div class="summary-stat" style="--c:${s.color}"><strong data-total="${s.value}">${s.value.toLocaleString()}</strong><span>${esc(s.label)}</span></div>`).join('') || '<p>No catches yet. Try a different spider.</p>';
    const panel = document.getElementById('summary');
    panel.hidden = false;
    this.results.els.tabs.inert = true;
    this.results.els.body.inert = true;
    if (!this.motion.matches) {
      panel.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320, easing: 'ease-out' });
      const start = performance.now(), nodes = [...list.querySelectorAll('[data-total]')];
      const count = (now) => {
        if (panel.hidden || !nodes[0]?.isConnected) return;
        const p = Math.min(1, (now - start) / 650), k = 1 - (1 - p) ** 3;
        nodes.forEach((n) => { n.textContent = Math.round(Number(n.dataset.total) * k).toLocaleString(); });
        if (p < 1) requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
    }
  }

  download() {
    const files = this.results.exportFiles();
    if (this.state.site) {
      const site = this.state.site;
      files.push(['site-map.json', JSON.stringify({ start: site.start,
        pages: [...site.nodes.values()].map(({ url, title, depth, parent, crawled, status, error }) => ({ url, title, depth, parent, crawled: Boolean(crawled), status, error })),
        links: [...site.edges].map((e) => { const [from, to] = e.split('\n'); return { from, to }; }),
      }, null, 2)]);
    }
    download('crawlspace-collection.zip', storedZip(files), 'application/zip');
  }

  async hunt(kind) {
    if (this.hunting || this.state.loading) return;
    this.hunting = true;
    const buttons = [...document.querySelectorAll('[data-hunt]')];
    buttons.forEach((b) => { b.disabled = true; });
    try {
      if (this.state.running) { stopRun(); await this.state.finished; }
      endDemo();
      for (const d of this.defs) { this.state.touched.add(d.kind); pick(d.kind, false); }
      if (kind === 'mimic') {
        await put(demoPage());
        document.getElementById('url').value = '';
        history.replaceState(null, '', location.pathname + location.search);
        this.state.demo = true;
        document.getElementById('demonote').hidden = false;
        taught(this.stage.doc.querySelector('.card h3'));
      } else {
        if (kind === 'prices') setPattern('prices');
        pick(kind === 'prices' ? 'regex' : 'tables', true);
        const loaded = await load(kind === 'prices' ? 'https://books.toscrape.com/' : 'https://en.wikipedia.org/wiki/List_of_largest_cities');
        if (!loaded) return;
      }
      await release();
    } finally { this.hunting = false; buttons.forEach((b) => { b.disabled = false; }); }
  }

  key(e) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.defaultPrevented) return;
    if (e.target.closest?.('input, textarea, select, button, a, [contenteditable="true"]') && e.key !== 'Escape') return;
    const help = document.getElementById('shortcuts');
    if (e.key === 'Escape') {
      if (help.open) { help.close(); return; }
      this.closeSummary();
      if (this.state.running) stopRun();
      cancelPick(); closePops(); siteMap.hide();
      return;
    }
    if (help.open) return;
    if (e.key === '?') { e.preventDefault(); help.showModal(); }
    else if (e.code === 'Space') { e.preventDefault(); if (!this.state.running && this.state.selected.size) release(); }
    else if (e.key.toLowerCase() === 's' && this.state.running) { this.stage.skip = true; this.stage.stopWaiting(); }
    else if (e.key.toLowerCase() === 'd') setNight(!this.stage.night);
    else if (/^[1-6]$/.test(e.key) && !this.state.running) {
      const kind = this.defs[Number(e.key) - 1].kind;
      if (kind === 'mimic' && !this.state.mimic) return togglePop('mimic');
      this.state.touched.add(kind); pick(kind, !this.state.selected.has(kind));
    }
  }
}

// Stored ZIP entries: UTF-8 names, CRC32, no dependency or compression worker.
function storedZip(files) {
  const encode = new TextEncoder(), chunks = [], directory = [];
  let offset = 0, directorySize = 0;
  const table = Array.from({ length: 256 }, (_, i) => {
    for (let b = 0; b < 8; b++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
    return i >>> 0;
  });
  const header = (size) => { const bytes = new Uint8Array(size); return [bytes, new DataView(bytes.buffer)]; };
  for (const [filename, text] of files) {
    const name = encode.encode(filename), data = encode.encode(text);
    let crc = 0xffffffff;
    for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const [local, l] = header(30);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
    l.setUint16(12, 33, true); l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true);
    chunks.push(local, name, data);
    const [central, c] = header(46);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(14, 33, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    directory.push(central, name); directorySize += 46 + name.length;
    offset += 30 + name.length + data.length;
  }
  const [end, e] = header(22);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end], { type: 'application/zip' });
}
