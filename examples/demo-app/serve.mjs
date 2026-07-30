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

// Server-held state for examples/demo-app/notes.html. In memory and reset by a
// restart, which is what makes it usable as a reproduction: a run's effect on
// it is observable (`GET /notes` lists what was added) and does not survive
// into the next run.
const notes = [];

/**
 * Renders notes.html with the notes currently on file. Server-side rather than
 * in the page on purpose (design contained-recovery, D4): a duplicate write has
 * to be *visible* as a second entry, and a client-side list would show the
 * retry without showing the second write.
 */
async function renderNotes(res) {
  const template = await readFile(path.join(root, 'notes.html'), 'utf8');
  const items = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('');
  const body = template.replace('__NOTES__', items).replace('__COUNT__', String(notes.length));
  res.writeHead(200, { 'content-type': MIME['.html'] });
  res.end(body);
}

function escapeHtml(text) {
  return text.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

/**
 * The mutation that erases its own evidence: reads the POSTed note, waits as
 * the support flow does, appends it, then redirects back to the page the form
 * is on — which comes back with the form empty. The POST -> [delay] -> 302 ->
 * GET shape is the same as `handleSupportTicket`; the difference that matters
 * is the destination (design contained-recovery, D4).
 */
async function handleAddNote(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const note = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('note')?.trim() ?? '';

  await new Promise((resolve) => setTimeout(resolve, SUPPORT_TICKET_DELAY_MS));

  if (note !== '') notes.push(note);
  res.writeHead(302, { location: '/notes' });
  res.end();
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'POST' && url.pathname === '/support/ticket') {
      await handleSupportTicket(req, res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/notes/add') {
      await handleAddNote(req, res);
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/notes' || url.pathname === '/notes.html')) {
      await renderNotes(res);
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
