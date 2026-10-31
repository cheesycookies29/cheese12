import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { openDb } from './server/db.js';
import { createApi } from './server/api.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3100; // the ERP uses 3000, so both can run at once
const HOST = process.env.HOST || '127.0.0.1'; // only reachable from this computer
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').filter(Boolean);
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'db.json');

const db = openDb(DB_FILE);
const api = createApi(db);

const PUBLIC = path.join(ROOT, 'public');
const STATIC_DIRS = { '/shared/': path.join(ROOT, 'shared'), '/': PUBLIC };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.ttf': 'font/ttf' };
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };

function send(res, status, body, type = 'application/json', headers = {}) {
  const textual = /^text\/|json|javascript|svg/.test(type);
  res.writeHead(status, { 'Content-Type': textual ? `${type}; charset=utf-8` : type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 20 * 1024 * 1024) reject(Object.assign(new Error('Request too large.'), { status: 413 }));
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
  // The admin panel is its own single-page app at /admin.
  if (url.pathname === '/admin' || url.pathname === '/admin/') return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'admin', 'index.html')), 'text/html');
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!url.pathname.startsWith(prefix)) continue;
    const rel = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    if (prefix === '/' && !path.extname(rel)) return send(res, 200, fs.readFileSync(path.join(dir, 'index.html')), 'text/html');
    return send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') return send(res, 200, { ok: true }); // for a load balancer health check later
  if (!url.pathname.startsWith('/api/')) return serveStatic(url, res);
  // Block other websites from calling this API (DNS rebinding / CSRF): only accept
  // requests addressed to localhost, a plain IP address, or a name in ALLOWED_HOSTS.
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
    console.error(`\n  Port ${PORT} is already in use. The LMS may already be running: open http://localhost:${PORT}`);
    console.error('  Or start it on another port, e.g. PORT=3101 npm start\n');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  LTDC LMS is running.`);
  console.log(`  Learning portal (students, teachers): http://localhost:${PORT}`);
  console.log(`  Admin panel (administrators, registrars): http://localhost:${PORT}/admin`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('  Other computers on your network can open it using this computer\'s IP address.');
  console.log(`  Data file: ${DB_FILE}`);
  console.log('  Press Ctrl+C to stop.\n');
  if (process.env.OPEN_BROWSER) {
    const url = `http://localhost:${PORT}/admin`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
