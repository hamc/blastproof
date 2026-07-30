// Minimal static file server for the demo app. No dependencies.
// Usage: node examples/demo-app/serve.mjs [port]   (default 4173)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// examples/demo-app/support.html POSTs here (via app.js's fetch, see the
// comment there for why it is fetch-mediated rather than a plain form submit).
// This is a genuine server round trip: request body read fully, a real
// server-side delay, then a 302 redirect — the POST -> [delay] -> 302 -> GET
// shape the rest of the app cannot produce, because its only other mutation
// (login) redirects client-side via `window.location.href` after a
// synchronous, instant check. 600ms is chosen because it is an order of
// magnitude above the noise floor of a single `ariaSnapshot()` round trip over
// CDP (single-digit to low-tens of milliseconds locally, confirmed while
// building this), so the window opens reliably even under CI jitter, while
// adding well under a second to one dogfood run.
const SUPPORT_TICKET_DELAY_MS = 600;

/**
 * Handles the one server-side mutation in the demo app: reads the POSTed
 * body (a genuine request, not a stub), waits `SUPPORT_TICKET_DELAY_MS` as a
 * stand-in for real backend work, then redirects — reproducing the
 * POST -> [delay] -> 302 -> GET shape from the Gitea false-FAIL report (#25).
 */
async function handleSupportTicket(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  void Buffer.concat(chunks).toString('utf8'); // read fully; body itself is unused by this demo

  await new Promise((resolve) => setTimeout(resolve, SUPPORT_TICKET_DELAY_MS));

  res.writeHead(302, { location: '/support-sent.html' });
  res.end();
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'POST' && url.pathname === '/support/ticket') {
      await handleSupportTicket(req, res);
      return;
    }
    let file = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (file === '' || file.endsWith(path.sep)) file = path.join(file, 'index.html');
    let full = path.join(root, file);
    if (!full.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let body;
    try {
      body = await readFile(full);
    } catch {
      // Pretty URLs: /login -> /login.html
      full = path.join(root, `${file}.html`);
      if (!full.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      body = await readFile(full);
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => {
  console.log(`demo app listening on http://localhost:${port}`);
});
