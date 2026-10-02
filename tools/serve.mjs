import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createStaticServer(root, { index = 'index.html' } = {}) {
  const base = resolve(root);
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += index;
    const path = join(base, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!path.startsWith(base)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    let stat;
    try {
      stat = statSync(path);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    if (stat.isDirectory()) {
      res.writeHead(302, { location: `${rel}/` }).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(res);
  });
}

export function listen(server, port = 0) {
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server.address().port)));
}
