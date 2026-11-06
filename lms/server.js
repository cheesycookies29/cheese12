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
  res.writeHead(status, { 'Content-Type': textual && !headers['Content-Disposition'] ? `${type}; charset=utf-8` : type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
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

// Static files: the browser keeps a copy and asks "changed?" each time (ETag → 304 Not Modified),
// so a new version shows at once but unchanged files are not downloaded again. Fonts never change
// and images rarely do, so those are kept for a while without asking.
function sendFile(req, res, file) {
  const stat = fs.statSync(file);
  const ext = path.extname(file);
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  const cache = ext === '.ttf' ? 'public, max-age=2592000' : ['.png', '.svg', '.ico'].includes(ext) ? 'public, max-age=86400' : 'no-cache';
  const headers = { ETag: etag, 'Cache-Control': cache };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...headers, ...SECURITY_HEADERS });
    return res.end();
  }
  return send(res, 200, fs.readFileSync(file), TYPES[ext] || 'application/octet-stream', headers);
}

function serveStatic(req, url, res) {
  // Five single-page apps: the ATLAS home page (/), ATLAS Learn (/lms/), its admin panel (/admin), ATLAS People (/hris/) and ATLAS Academic (/academic/).
  if (url.pathname === '/admin' || url.pathname === '/admin/') return sendFile(req, res, path.join(PUBLIC, 'admin', 'index.html'));
  if (url.pathname === '/lms') return send(res, 302, '', 'text/plain', { Location: '/lms/' });
  if (url.pathname === '/lms/') return sendFile(req, res, path.join(PUBLIC, 'lms', 'index.html'));
  if (url.pathname === '/hris') return send(res, 302, '', 'text/plain', { Location: '/hris/' });
  if (url.pathname === '/hris/') return sendFile(req, res, path.join(PUBLIC, 'hris', 'index.html'));
  if (url.pathname === '/academic') return send(res, 302, '', 'text/plain', { Location: '/academic/' });
  if (url.pathname === '/academic/') return sendFile(req, res, path.join(PUBLIC, 'academic', 'index.html'));
  if (/^\/verify\/[A-Za-z0-9-]{4,40}$/.test(url.pathname)) return sendFile(req, res, path.join(PUBLIC, 'verify.html')); // a document's verification page
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!url.pathname.startsWith(prefix)) continue;
    const rel = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(req, res, file);
    if (prefix === '/' && !path.extname(rel)) return sendFile(req, res, path.join(dir, 'index.html'));
    return send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') return send(res, 200, { ok: true }); // for a load balancer health check later
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, url, res);
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
    const out = await api(req, url, body);
    if (out.raw != null) return send(res, out.status || 200, out.raw, out.type, out.headers);
    send(res, 200, out.data, 'application/json', out.headers);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    send(res, status, { error: status === 500 ? 'Something went wrong. Check the terminal for details.' : err.message });
  }
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Double-clicked the launcher while the LMS is already running: just show it again.
    if (process.env.OPEN_BROWSER) {
      console.log(`\n  Lancaster ATLAS is already running. Opening http://localhost:${PORT} in your browser.`);
      console.log('  You can close this window; ATLAS keeps running in its first window.\n');
      openBrowser(`http://localhost:${PORT}/`);
      return setTimeout(() => process.exit(0), 1500);
    }
    console.error(`\n  Port ${PORT} is already in use. ATLAS may already be running: open http://localhost:${PORT}`);
    console.error('  Or start it on another port, e.g. PORT=3101 npm start\n');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Lancaster ATLAS is running.`);
  console.log(`  ATLAS home (everyone signs in here): http://localhost:${PORT}`);
  console.log(`  ATLAS Learn: http://localhost:${PORT}/lms/   ·   Learn admin panel: http://localhost:${PORT}/admin   ·   ATLAS People: http://localhost:${PORT}/hris/   ·   ATLAS Academic: http://localhost:${PORT}/academic/`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('  Other computers on your network can open it using this computer\'s IP address.');
  console.log(`  Data file: ${DB_FILE}`);
  console.log('  Press Ctrl+C to stop.\n');
  if (process.env.OPEN_BROWSER) openBrowser(`http://localhost:${PORT}/`);
});
