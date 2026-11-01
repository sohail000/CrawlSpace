# Crawlspace

**Watch spiders crawl any web page.** Paste a web address and the page appears centre stage. Spiders, each with one job, crawl it in front of you and catch its links, tables, patterns, images and text, ready to export. Or click one thing on the page, and the Mimic catches everything like it.

**[Try it →](https://sohail000.github.io/CrawlSpace/)**

The first screen is a live demo: a small made-up field-guide page that ships with Crawlspace, already being crawled by the Funnel-web, the Jumping spider (prices) and the Mimic. It stops the moment you type an address or load a page. If your system asks for reduced motion, it shows the finished results with no animation.

The workspace has a warm ink-and-brass theme, six illustrated crew selectors, and a live **Haul** panel. Start with **Catch prices** (Books to Scrape), **Collect tables** (Wikipedia), or **Copy a collection** (the bundled Mimic sample), or paste your own address. The sample is always labelled as sample data.

## Feel the catch

- **Sound:** click **Sound off** in the top bar to enable soft silk plucks. Each spider has its own pitch. Audio is made locally with Web Audio, starts only after a user gesture, and is limited to fewer than eight plucks a second. The choice is remembered; sound starts off for new visitors.
- **Shake:** real animated catches give the stage a brief nudge; wrapping a table gives it a slightly stronger one. The **Shake** switch remembers your choice. System reduced-motion settings disable shakes and animations and make runs finish without travel animations.
- Crew icons react to selection and actual work. A hanging spider appears only while a page is being fetched. Pages fade in and the result underline follows your selected tab.
- When a run ends, a closable collection card shows the actual totals. Stopped runs show only what was caught. The automatic demo leaves its results visible; open **Your collection** to see its summary.
- **Download everything** saves one uncompressed ZIP containing the available results: `links.csv`, `table-N.csv`, `matches.csv`, `images.csv`, `text.md`, `my-pick.csv`, and `pages.csv`. Site crawls also include `site-map.json`. No ZIP library or server is needed. Individual exports still work.

### Keyboard shortcuts

Press **Space** to release, **S** to skip animations, **Esc** to stop or close, **1–6** to choose spiders, **D** for dark/original page colours, and **?** for the shortcut guide. These also work inside the page on stage and leave typing and focused controls alone.

![The redesigned Crawlspace workspace, with Mimic catches and a downloadable collection](assets/preview.png)

## The spiders

| Spider | Catches | How it moves |
|---|---|---|
| **Orb-weaver** | Every link, sorted into on-site, elsewhere, email/phone and files. Can crawl the whole site and check for broken links. | Walks link to link, anchoring silk at each one |
| **Funnel-web** | Every data table as clean rows: CSV, or straight into Excel | Traces the table's edge, wraps it in silk, sends the bundle to the results |
| **Jumping spider** | Emails, phone numbers, prices, dates, web addresses, or your own pattern | Leaps from match to match and bites each one |
| **Huntsman** | Every image, with its size and whether it has alt text | Sprints to each image and tags it |
| **Reader** | The main text without menus or ads, as Markdown | Walks down the margin of each block it keeps |
| **Mimic** | Whatever you point at. Click one product's name and get every product on the page as a table: name, price, link, image | Carries the outline of your pick from record to record, underlining each field it copies |

Each catch peels off the page and hangs behind the spider on a silk thread (the real link text, price or email it caught) before going on to the results panel, and the page's outline shakes like a web. Rest the mouse on a result and a silk thread runs from its row to its spot on the page, scrolling there if it is out of view (not while the spiders are working). Click any result to flash it on the page. The page is shown dark by default; **Original colours** in the page bar switches back.

## Teach the Mimic

Press **Teach it**, then click one thing that repeats on the page: a product name, a price, a row of a table. The Mimic works out what that thing belongs to (the product card, the table row) and catches every one like it, with all the fields they share as columns. Columns are named after the page's own labels where it has them (a table's header, a "video-title"). Drop any column you don't need.

Crawl the site afterwards and the Mimic catches the same records on every page it visits, so 5 pages of a shop listing become one table.

## Site map

Crawl a site (“this site, up to 25 pages”) and the Orb-weaver draws what it found as an orb web: the start page is the hub, each crawled page is a knot, and each link that led there is a thread. Pages it found but didn't crawl ring the rim; broken pages are snapped threads. Hover a knot for its details, click it to put that page on stage.

## Pages that need JavaScript: the bookmarklet

Some sites (YouTube, many web apps) send an empty shell and build the page with scripts, so there's nothing to fetch by address. For those, drag the **Crawl in Crawlspace** button (under **Bookmarklet**, top right) to your bookmarks bar. Open the page in your browser, let it load, and click the bookmark: Crawlspace opens with the page exactly as you saw it. The page goes straight from your tab to Crawlspace's tab, not through any server.

## Built for accuracy

- **Real structure, not guesses.** Everything is read from the page's own structure.
- **Tables come out right.** Merged cells are repeated where they reach, footnote markers and hidden sort keys are removed, and navigation menus and layout tables are skipped. The panel says what it skipped and why.
- **Patterns check the obvious traps.** Phone numbers must look like phone numbers, so a range like 1999–2003 is not one. Emails and phones also come from `mailto:` and `tel:` links.
- **Only visible text counts.** Hidden text and scripts are ignored.
- **Nothing is hidden from you.** Spiders show everything they caught, and anything they skipped is listed.

## How pages are fetched

A page in your browser isn't allowed to read other websites, so Crawlspace uses a small proxy (`proxy/worker.js`) that fetches pages for it. The proxy:

- respects robots.txt
- only makes read-only requests to public addresses
- caps pages at 5 MB
- only answers the Crawlspace site

Wikipedia pages work without it, through Wikipedia's own API.

Pages are shown without their scripts, so sites that build everything with JavaScript come out mostly empty. Crawlspace says so when it happens; use the bookmarklet for those.

**Run the proxy on your computer** (Node 20+): `node proxy/dev.mjs`, then open `index.html`. It's picked up automatically.

**Put the proxy online** (free Cloudflare account):

```
cd proxy
npx wrangler login
npx wrangler deploy
```

Copy the `workers.dev` address it prints into `PROXY_URL` at the top of `js/fetcher.js`, and push. (The live site uses `https://crawlspace-proxy.crawlspace-proxy.workers.dev`.)

## Files

- `index.html`, `style.css`: the page
- `js/fetcher.js`: fetching pages (proxy or Wikipedia API)
- `js/extract.js`: what each spider catches
- `js/stage.js`: the page on stage, the overlay and each spider's moves
- `js/spider.js`: the procedural spiders (one build per species)
- `js/results.js`: result tabs and exports
- `js/experience.js`: catch sounds, stage feedback, crew icons, collection summary, ZIP writer and shortcuts
- `js/demo.js`: bundled field-guide sample, with light and dark colours
- `js/thread.js`: silk from each hovered result to its source
- `js/sitemap.js`: the site map, drawn as an orb web
- `js/app.js`: wiring, teaching the Mimic, the site crawl and the bookmarklet
- `proxy/`: the fetching proxy (Cloudflare Worker, plus a local runner)
- `Crawlspace.html`: the original toy, with spiders that crawl and bite any page

MIT licensed.
