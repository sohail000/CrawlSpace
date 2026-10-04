# Crawlspace

A research crawler you can watch. Ask a question; spiders crawl the real web, read pages with an LLM (Gemma 4 or Claude),
bite out the evidence and weave a cited answer. Every animation maps to something real:

| On screen | What is actually happening |
|---|---|
| Spider walks along a thread | It claimed that URL; robots.txt check and fetch are in flight (timer shows real latency) |
| Red X, spider recoils | robots.txt said no, HTTP error, duplicate, or no readable text |
| Spider reads, scan line in the Specimen pane | The model is reading exactly the text shown |
| Bite (highlighted passage) | A passage the model quoted as evidence |
| Feelers, then grey dots | Links the model chose to follow next (the frontier) |
| Orb-weaver spins the spiral | The final answer streaming in; pink radials are cited sources |

## Run it

```
npm install
cp .env.example .env     # add GEMINI_API_KEY (Gemma 4) or ANTHROPIC_API_KEY; no key = keyword mode
npm start                # http://localhost:4321
```

Settings live in `.env` (models, pacing, port). The crawler identifies itself as `CrawlspaceBot`,
honours robots.txt, spaces requests to each host, and never logs in anywhere.

## Layout

- `server/crawler.js`: frontier, spider workers, event stream
- `server/fetcher.js`: robots.txt, per-host politeness, fetching
- `server/extract.js`: HTML to clean paragraphs and links
- `server/brain.js`: reader (structured JSON) and weaver for Gemma or Claude, plus keyword fallback
- `server/gemini.js`: Gemini API client for Gemma: retries, model fallback, concurrency cap
- `public/web.js`: the crawl graph and spider playback
- `public/specimen.js`: the reading pane where bites happen
- `Crawlspace.html`: the original procedural-spider toy
