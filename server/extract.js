// Turn raw HTML into what a spider actually reads: clean paragraphs and outbound links.
import * as cheerio from 'cheerio';

const JUNK = [
  'script', 'style', 'noscript', 'svg', 'iframe', 'canvas', 'form', 'nav', 'footer', 'header', 'aside',
  'button', 'select', 'template', '[role=navigation]', '[role=banner]', '[role=contentinfo]', '[aria-hidden=true]',
  '.mw-editsection', 'sup.reference', '.reflist', '.navbox', '.metadata', '.sidebar', '.infobox', '.toc', '#toc',
  '.hatnote', '.mw-jump-link', '.catlinks', '.printfooter', '.cookie', '.cookies', '.advert', '.ads', '.share',
].join(',');

const ROOTS = ['article', 'main', '[role=main]', '#mw-content-text', '#content', '.post-content', '.entry-content', '.post', 'body'];
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|gz|tar|rar|7z|mp[34]|mov|avi|webm|wav|ogg|exe|dmg|msi|apk|css|js|json|xml|rss|atom|woff2?|ttf|eps|docx?|xlsx?|pptx?)$/i;
const TRACKING = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref_src|igshid)$/i;

export function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return null;
  }
}

function linkWorthKeeping(u) {
  const x = new URL(u);
  if (SKIP_EXT.test(x.pathname)) return false;
  // Wiki-style namespaces (Special:, File:, Talk:...) are rarely content.
  if (/\/wiki\/[^/]+:/.test(x.pathname) || /[?&](action|oldid|diff)=/.test(x.search)) return false;
  if (/\/(login|signin|signup|register|logout|cart|checkout|account)\b/i.test(x.pathname)) return false;
  return true;
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();

export function extract(html, baseUrl, { maxParagraphs = 400, maxChars = 80_000, maxLinks = 300 } = {}) {
  const $ = cheerio.load(html);
  const title = clean(
    $('meta[property="og:title"]').attr('content') || $('title').first().text() || $('h1').first().text() || baseUrl,
  ).slice(0, 200);

  $(JUNK).remove();

  let $root = $('body');
  for (const sel of ROOTS) {
    const $c = $(sel).first();
    if ($c.length && clean($c.text()).length > 400) { $root = $c; break; }
  }

  const paragraphs = [];
  const seen = new Set();
  let chars = 0;
  $root.find('h1,h2,h3,h4,p,li,blockquote,pre,dd,figcaption').each((_, el) => {
    if (paragraphs.length >= maxParagraphs || chars >= maxChars) return false;
    const $el = $(el);
    const tag = el.tagName.toLowerCase();
    if ($el.parents('p,li,blockquote,pre').length) return;          // nested: parent already covers it
    if (tag === 'li' && $el.children('p').length) return;            // its <p> children are taken instead
    const t = clean($el.text());
    const k = /^h\d$/.test(tag) ? 'h' : tag === 'li' ? 'li' : tag === 'blockquote' ? 'q' : 'p';
    if (k === 'h' ? t.length < 2 : t.length < 30) return;
    if (k === 'li' && $el.find('a').length && clean($el.find('a').text()).length > t.length * 0.8) return; // link lists
    if (seen.has(t)) return;
    seen.add(t);
    paragraphs.push({ k, t: t.slice(0, 2400) });
    chars += t.length;
  });

  const links = [];
  const linkSeen = new Set([normalizeUrl(baseUrl, baseUrl)]);
  $root.find('a[href]').each((_, a) => {
    if (links.length >= maxLinks) return false;
    const u = normalizeUrl($(a).attr('href'), baseUrl);
    if (!u || linkSeen.has(u) || !linkWorthKeeping(u)) return;
    const text = clean($(a).text() || $(a).attr('title') || '').slice(0, 120);
    if (!text) return;
    linkSeen.add(u);
    links.push({ url: u, text });
  });

  return { title, paragraphs, links, chars };
}
