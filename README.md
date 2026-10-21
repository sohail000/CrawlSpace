# Crawlspace

**Watch spiders crawl any web page.** Paste a web address and the page appears centre stage. Five spiders, each with one job, crawl it in front of you and catch its links, tables, patterns, images and text, ready to export.

**[Try it →](https://sohail000.github.io/CrawlSpace/)**

![The funnel-web spider wrapping a Wikipedia table in silk, with the clean table in the results panel](assets/preview.png)

## The spiders

| Spider | Catches | How it moves |
|---|---|---|
| **Orb-weaver** | Every link, sorted into on-site, elsewhere, email/phone and files. Can crawl the whole site and check for broken links. | Walks link to link, anchoring silk at each one |
| **Funnel-web** | Every data table as clean rows: CSV, or straight into Excel | Traces the table's edge, wraps it in silk, sends the bundle to the results |
| **Jumping spider** | Emails, phone numbers, prices, dates, web addresses, or your own pattern | Leaps from match to match and bites each one |
| **Huntsman** | Every image, with its size and whether it has alt text | Sprints to each image and tags it |
| **Reader** | The main text without menus or ads, as Markdown | Walks down the margin of each block it keeps |

Each catch shows up in the results panel the moment the spider makes it, and the page's outline shakes like a web. Click any result to see it on the page.

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

Pages are shown without their scripts, so sites that build everything with JavaScript may come out partly empty.

**Run the proxy on your computer** (Node 20+): `node proxy/dev.mjs`, then open `index.html`. It's picked up automatically.

**Put the proxy online** (free Cloudflare account):

```
cd proxy
npx wrangler login
npx wrangler deploy
```

Copy the `https://crawlspace-proxy.<you>.workers.dev` address it prints into `PROXY_URL` at the top of `js/fetcher.js`, and push.

## Files

- `index.html`, `style.css`: the page
- `js/fetcher.js`: fetching pages (proxy or Wikipedia API)
- `js/extract.js`: what each spider catches
- `js/stage.js`: the page on stage, the overlay and each spider's moves
- `js/spider.js`: the procedural spiders (one build per species)
- `js/results.js`: result tabs and exports
- `js/app.js`: wiring and the site crawl
- `proxy/`: the fetching proxy (Cloudflare Worker, plus a local runner)
- `Crawlspace.html`: the original toy, with spiders that crawl and bite any page

MIT licensed.
