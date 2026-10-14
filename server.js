import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { openDb } from './server/db.js';
import { createApi } from './server/api.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // only reachable from this computer
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').filter(Boolean);
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'db.json');

const db = openDb(DB_FILE);
const api = createApi(db);

const STATIC_DIRS = { '/shared/': path.join(ROOT, 'shared'), '/': path.join(ROOT, 'public') };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.ttf': 'font/ttf' };

function send(res, status, body, type = 'application/json', headers = {}) {
  const textual = /^text\/|json|javascript|svg/.test(type);
  res.writeHead(status, { 'Content-Type': textual ? `${type}; charset=utf-8` : type, 'Cache-Control': 'no-store', ...headers });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 50 * 1024 * 1024) reject(Object.assign(new Error('Request too large.'), { status: 413 }));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(url, res) {
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!url.pathname.startsWith(prefix)) continue;
    let rel = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    }
    if (prefix === '/') return send(res, 200, fs.readFileSync(path.join(dir, 'index.html')), 'text/html');
    return send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(url, res);
  // Block other websites from calling this API (DNS rebinding / CSRF): only accept
  // requests addressed to localhost or a plain IP address (e.g. 192.168.1.20 on the office network).
  const hostname = (req.headers.host || '').replace(/:\d+$/, '');
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[');
  if (hostname !== 'localhost' && !isIp && !ALLOWED_HOSTS.includes(hostname)) return send(res, 403, { error: 'Forbidden host.' });
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && !(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, { error: 'Requests must be JSON.' });
  }
  try {
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
    const { data, headers } = await api(req, url, body);
    send(res, 200, data, 'application/json', headers);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    send(res, status, { error: status === 500 ? 'Something went wrong. Check the terminal for details.' : err.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. The app may already be running: open http://localhost:${PORT}`);
    console.error('  Or start it on another port, e.g. PORT=3001 (see README).\n');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  LTDC ERP is running at http://localhost:${PORT}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('  Other computers on your network can open it using this computer\'s IP address.');
  console.log(`  Data file: ${DB_FILE}`);
  console.log('  Press Ctrl+C to stop.\n');
  if (process.env.OPEN_BROWSER) {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
