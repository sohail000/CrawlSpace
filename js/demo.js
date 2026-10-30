// The demo page: a small made-up "field guide" bundled with the site, so there is something for every
// spider to catch the moment someone arrives, with no network and no proxy. It lives in a script (not a
// separate .html file) because a page opened from file:// is not allowed to read other local files.

const DEMO_URL = 'https://demo.crawlspace.invalid/field-guide';

// Little spider pictures drawn on the spot, as inline SVG, so the page needs no image files.
function demoPicture(bg, fg) {
  const legs = [[-1, -22], [-1, -8], [-1, 8], [-1, 22]].map(([s, y]) => `M60 45 ${60 + s * 22} ${45 + y * 0.8} ${60 + s * 40} ${45 + y * 1.4}M60 45 ${60 - s * 22} ${45 + y * 0.8} ${60 - s * 40} ${45 + y * 1.4}`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90"><rect width="120" height="90" fill="${bg}"/>` +
    `<path d="${legs}" stroke="${fg}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="60" cy="49" rx="11" ry="14" fill="${fg}"/><circle cx="60" cy="33" r="6.5" fill="${fg}"/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const DEMO_SPECIES = [
  { name: 'Garden orb-weaver', latin: 'Araneus diadematus', size: 'up to 20 mm', web: 'Wheel-shaped orb', venom: 'Harmless to people', note: 'Builds the classic wheel web between shrubs at dusk and eats it again each morning.', seen: 'August to October', bg: '#dff3d2', fg: '#2f6b1f', alt: 'A garden orb-weaver in the middle of its wheel web' },
  { name: 'Zebra jumping spider', latin: 'Salticus scenicus', size: 'up to 9 mm', web: 'No web, hunts by sight', venom: 'Harmless to people', note: 'Stalks sunny walls and fence posts, then leaps on its prey from a silk safety line.', seen: 'April to September', bg: '#fdeccb', fg: '#6a4a0a', alt: 'A striped zebra jumping spider on a fence post' },
  { name: 'Funnel weaver', latin: 'Agelenopsis aperta', size: 'up to 18 mm', web: 'Sheet with a funnel', venom: 'Mild, rarely bites', note: 'Spins a flat sheet of silk in the grass with a funnel-shaped den at one corner.', seen: 'June to October', bg: '#e6e0f5', fg: '#4a3a8a', alt: 'A funnel weaver at the mouth of its silk funnel' },
  { name: 'Wolf spider', latin: 'Lycosa tarantula', size: 'up to 30 mm', web: 'No web, hunts on the ground', venom: 'Mild, rarely bites', note: 'Runs down its prey along the ground and carries its eggs in a silk sac.', seen: 'March to November', bg: '#e9e4dc', fg: '#4a3f2e', alt: 'A wolf spider carrying her egg sac' },
  { name: 'Crab spider', latin: 'Misumena vatia', size: 'up to 10 mm', web: 'No web, ambushes', venom: 'Harmless to people', note: 'Waits on flowers and slowly changes colour, white to yellow, to match the petals.', seen: 'May to August', bg: '#fbe3ec', fg: '#9a3f63', alt: '' },
  { name: 'Cellar spider', latin: 'Pholcus phalangioides', size: 'up to 9 mm', web: 'Loose tangle', venom: 'Harmless to people', note: 'Hangs upside down in a loose web in sheds and corners, with legs far longer than its body.', seen: 'All year', bg: '#dcecf7', fg: '#1f5a82', alt: 'A cellar spider hanging in its loose web' },
];

const DEMO_BOOKS = [['The Orb-weaver’s Year', '$14.99'], ['Webs of the Hedgerow', '$22.00'], ['Jumping Spiders, Close Up', '$9.50'], ['Pocket Guide to Garden Silk', '$31.25']];

function demoHtml() {
  const cards = DEMO_SPECIES.map((s) => `
      <article class="card">
        <img src="${demoPicture(s.bg, s.fg)}" ${s.alt ? `alt="${s.alt}"` : ''} width="240" height="180">
        <h3>${s.name}</h3>
        <p class="latin">${s.latin}</p>
        <p>${s.note}</p>
        <p class="seen">Seen: ${s.seen}</p>
        <a href="/species/${s.name.toLowerCase().replace(/[^a-z]+/g, '-')}">Read more</a>
      </article>`).join('');
  const rows = DEMO_SPECIES.map((s) => `<tr><td>${s.name}</td><td>${s.size}</td><td>${s.web}</td><td>${s.venom}</td></tr>`).join('');
  const books = DEMO_BOOKS.map(([t, p]) => `<li><span class="bt">${t}</span><b class="price">${p}</b></li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Field Guide: Spiders of the Garden</title>
<style>
  body { margin: 0; font: 16px/1.6 Georgia, serif; color: #26301f; background: #fbfaf4; }
  header { background: #2f6b1f; color: #fff; padding: 56px 40px 18px; }
  header h1 { margin: 0 0 4px; font: 700 32px/1.2 system-ui, sans-serif; }
  header p { margin: 0; opacity: .85; font-family: system-ui, sans-serif; }
  nav { display: flex; gap: 22px; padding: 12px 40px; background: #e4edd6; font: 600 14px system-ui, sans-serif; }
  nav a { color: #2f6b1f; text-decoration: none; }
  main { max-width: 900px; margin: 0 auto; padding: 8px 40px 40px; }
  h2 { font: 700 24px system-ui, sans-serif; margin: 38px 0 10px; color: #2f6b1f; }
  table { border-collapse: collapse; width: 100%; font: 15px system-ui, sans-serif; }
  caption { text-align: left; font-weight: 600; padding-bottom: 6px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #d6dcc6; }
  th { background: #e4edd6; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .card { background: #fff; border: 1px solid #d6dcc6; border-radius: 10px; padding: 12px; }
  .card img { width: 100%; height: auto; border-radius: 6px; display: block; }
  .card h3 { margin: 10px 0 0; font: 700 17px system-ui, sans-serif; }
  .card p { margin: 4px 0; font-size: 14px; line-height: 1.45; }
  .card .latin { font-style: italic; color: #6b7558; }
  .card .seen { color: #2f6b1f; font: 600 13px system-ui, sans-serif; }
  .card a { color: #2457d6; font: 600 13px system-ui, sans-serif; }
  .shelf { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .shelf li { background: #fff7dd; border: 1px solid #ecd98a; border-radius: 8px; padding: 12px; font: 14px system-ui, sans-serif; display: flex; flex-direction: column; gap: 6px; }
  .price { font-size: 18px; color: #8a5a00; }
  address { font-style: normal; background: #e4edd6; border-radius: 10px; padding: 16px 20px; font-family: system-ui, sans-serif; line-height: 1.8; }
  footer { padding: 18px 40px 30px; font: 13px system-ui, sans-serif; color: #6b7558; }
</style></head>
<body>
<header><h1>Field Guide: Spiders of the Garden</h1><p>A small, friendly guide to the eight-legged neighbours in your hedge.</p></header>
<nav><a href="/">Home</a><a href="/species">Species</a><a href="/shop">Shop</a><a href="/contact">Contact</a><a href="https://en.wikipedia.org/wiki/Spider">About spiders</a></nav>
<main>
  <h2>Meet your neighbours</h2>
  <p>Almost every garden is home to dozens of kinds of spider. Most are small, shy, and useful: a single hedge can hold thousands of them, quietly keeping the numbers of flies, aphids and mosquitoes down.</p>
  <p>You do not need any equipment to start. Walk the edge of a lawn on a damp autumn morning and the dew will show you every web. Look for wheels between the branches, flat sheets in the grass, and loose tangles in the corners of sheds.</p>
  <p>Spiders fall into two broad groups: those that trap their food in silk, and those that chase it down. The guide below sorts the six most common garden kinds by how they hunt.</p>

  <h2>Six common garden spiders</h2>
  <table>
    <caption>Size, web and venom of the six species</caption>
    <thead><tr><th>Species</th><th>Size</th><th>Web type</th><th>Venom</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Know them by sight</h2>
  <div class="cards">${cards}
  </div>

  <h2>On the field-guide shelf</h2>
  <ul class="shelf">${books}</ul>
  <p><a href="/downloads/garden-spider-checklist.pdf">Download the printable checklist (PDF)</a></p>

  <h2>Spotted something odd?</h2>
  <address>
    Send a photo to <a href="mailto:hello@gardenfieldguide.example">hello@gardenfieldguide.example</a> or <a href="mailto:tips@gardenfieldguide.example">tips@gardenfieldguide.example</a>.<br>
    Call the helpline on <a href="tel:+15550100199">+1 555 010 0199</a>, or the garden desk on (555) 010-0142.
  </address>
</main>
<footer>Field Guide: Spiders of the Garden is a made-up page that ships with Crawlspace, so the spiders always have something to catch.</footer>
</body></html>`;
}

function demoPage() {
  const html = demoHtml();
  return { url: DEMO_URL, html, status: 200, ms: 0, kb: Math.round(html.length / 1024), via: 'demo' };
}
