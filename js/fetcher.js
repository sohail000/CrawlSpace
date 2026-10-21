// Getting pages. A browser page may not read other websites, so pages come through the Crawlspace proxy
// (proxy/worker.js). Wikipedia is the exception: its API allows browsers in, so it works with no proxy at all.

// The deployed proxy's address (see README). Empty = Wikipedia only, unless a local proxy is running.
const PROXY_URL = 'https://crawlspace-proxy.crawlspace-proxy.workers.dev';
const LOCAL_PROXY = 'http://127.0.0.1:8787';

const Fetcher = {
  proxy: null,
  lastHit: new Map(), // host -> time of the last request (politeness)

  // Use the configured proxy, or one running on this computer (node proxy/dev.mjs).
  async init() {
    let saved = '';
    try { saved = new URLSearchParams(location.search).get('proxy') || localStorage.getItem('crawlspace.proxy') || ''; } catch {}
    // Only look for a proxy on this computer when the site itself runs here: from a public site,
    // reaching into the visitor's own machine would make the browser ask them for permission.
    const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    for (const p of [saved, PROXY_URL, local && LOCAL_PROXY].filter(Boolean)) {
      try {
        const r = await fetch(p.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(1500) });
        if (r.ok) { this.proxy = p.replace(/\/$/, ''); return this.proxy; }
      } catch {}
    }
    return null;
  },

  wikiPage(url) {
    const m = url.hostname.match(/^([a-z][a-z-]{1,15})(?:\.m)?\.wikipedia\.org$/);
    if (!m || !url.pathname.startsWith('/wiki/')) return null;
    const title = url.pathname.slice(6);
    return title && !/^(Special|File|Category|Help|Talk|User|Wikipedia|Template|Portal|Draft):/i.test(decodeURIComponent(title)) ? { lang: m[1], title } : null;
  },

  canFetch(url) { return Boolean(this.proxy || this.wikiPage(url)); },

  async politeWait(host, gap = 900) {
    const wait = (this.lastHit.get(host) || 0) + gap - Date.now();
    this.lastHit.set(host, Date.now() + Math.max(0, wait));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  },

  // -> { url, html, status, ms, kb, via }
  async page(address, signal) {
    let url;
    try { url = new URL(address); } catch { throw new Error('That is not a web address.'); }
    const wiki = this.wikiPage(url);
    const t0 = performance.now();
    await this.politeWait(url.host);
    if (wiki && !this.proxy) {
      const api = `https://${wiki.lang}.wikipedia.org/api/rest_v1/page/html/${wiki.title}?redirect=true`;
      const r = await fetch(api, { signal });
      if (!r.ok) throw new Error(r.status === 404 ? 'Wikipedia has no page at that address.' : `Wikipedia answered ${r.status}.`);
      const html = await r.text();
      const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || decodeURIComponent(wiki.title);
      const finalUrl = `https://${wiki.lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')}`;
      return { url: finalUrl, html, status: 200, ms: Math.round(performance.now() - t0), kb: Math.round(html.length / 1024), via: 'wikipedia' };
    }
    if (!this.proxy) throw Object.assign(new Error('Only Wikipedia pages work until the Crawlspace proxy is set up (see the README).'), { kind: 'noproxy' });
    const r = await fetch(`${this.proxy}/?url=${encodeURIComponent(url.href)}`, { signal });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw Object.assign(new Error(body.message || `The proxy answered ${r.status}.`), { kind: body.error || 'proxy' });
    }
    const html = await r.text();
    return {
      url: r.headers.get('X-Final-Url') || url.href, html, status: Number(r.headers.get('X-Status')) || 200,
      ms: Math.round(performance.now() - t0), kb: Math.round(html.length / 1024), via: 'proxy',
    };
  },

  // HTTP status of a link, for the broken-link check. -> number (0 = could not check)
  async status(address, signal) {
    if (!this.proxy) return 0;
    try {
      await this.politeWait(new URL(address).host, 400);
      const r = await fetch(`${this.proxy}/?mode=status&url=${encodeURIComponent(address)}`, { signal });
      const body = await r.json();
      return r.ok ? body.status : body.error === 'robots' ? -1 : 0;
    } catch { return 0; }
  },
};
