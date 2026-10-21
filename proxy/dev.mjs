// Run the Crawlspace proxy on your own computer (Node 20+), no Cloudflare account needed:
//   node proxy/dev.mjs
// The site finds it automatically at http://127.0.0.1:8787 when opened from this computer.
import http from 'node:http';
import worker from './worker.js';

const PORT = Number(process.env.PORT) || 8787;

http.createServer(async (req, res) => {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const response = await worker.fetch(new Request(`http://127.0.0.1:${PORT}${req.url}`, { method: req.method, headers }), {});
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => console.log(`Crawlspace proxy running at http://127.0.0.1:${PORT}`));
