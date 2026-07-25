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

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
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
