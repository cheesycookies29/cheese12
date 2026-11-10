import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { exec } from 'node:child_process';
import { openDb } from './server/db.js';
import { loadPasswordKeys } from './server/auth.js';
import { createApi } from './server/api.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3100; // the ERP uses 3000, so both can run at once
const HOST = process.env.HOST || '127.0.0.1'; // only reachable from this computer
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').filter(Boolean);
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'db.json');

// The key that encrypts the password hashes: PASSWORD_KEY, or password.key beside the data file.
loadPasswordKeys(path.dirname(DB_FILE));
const db = openDb(DB_FILE);
const api = createApi(db, { sealAtStart: false });

const PUBLIC = path.join(ROOT, 'public');
const STATIC_DIRS = { '/shared/': path.join(ROOT, 'shared'), '/': PUBLIC };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf' };
// The pages' small inline scripts (the dark-mode switch before first paint) are allowed by their
// exact hash; nothing else inline runs. Frames: ATLAS's own files (PDF previews), YouTube links in
// classes and the clock-in map. Styles stay 'unsafe-inline' for style="" attributes.
const inlineHashes = [...new Set(fs.readdirSync(PUBLIC, { recursive: true }).filter((f) => f.endsWith('.html'))
  .flatMap((f) => [...fs.readFileSync(path.join(PUBLIC, f), 'utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])))]
  .map((code) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`);
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${inlineHashes.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob: https://www.youtube-nocookie.com https://www.openstreetmap.org",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN', // ATLAS frames its own PDFs; no other site may frame ATLAS
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': CSP,
  'Permissions-Policy': 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)', // clock-in uses the location
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function send(res, status, body, type = 'application/json', headers = {}) {
  const textual = /^text\/|json|javascript|svg/.test(type);
  res.writeHead(status, { 'Content-Type': textual && !headers['Content-Disposition'] ? `${type}; charset=utf-8` : type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

// The JSON body, at most 20 MB (uploads come as base64 in JSON). Bytes are joined before decoding,
// so a letter split across two network packets is not broken; past the limit the upload is
// stopped instead of being read to the end.
const MAX_BODY = 20 * 1024 * 1024;
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const stop = (err) => {
      if (done) return;
      done = true;
      reject(err);
    };
    if (Number(req.headers['content-length']) > MAX_BODY) return stop(Object.assign(new Error('Request too large.'), { status: 413, close: true }));
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY) return stop(Object.assign(new Error('Request too large.'), { status: 413, close: true }));
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return reject(Object.assign(new Error('Invalid JSON.'), { status: 400 }));
      }
      if (body === null || typeof body !== 'object') return reject(Object.assign(new Error('The request body must be a JSON object.'), { status: 400 }));
      resolve(body);
    });
    req.on('error', stop);
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
  // Six single-page apps: the ATLAS home page (/), ATLAS Learn (/lms/), its admin panel (/admin), ATLAS People (/hris/), ATLAS Academic (/academic/) and ATLAS Finance (/finance/).
  if (url.pathname === '/admin' || url.pathname === '/admin/') return sendFile(req, res, path.join(PUBLIC, 'admin', 'index.html'));
  if (url.pathname === '/lms') return send(res, 302, '', 'text/plain', { Location: '/lms/' });
  if (url.pathname === '/lms/') return sendFile(req, res, path.join(PUBLIC, 'lms', 'index.html'));
  if (url.pathname === '/hris') return send(res, 302, '', 'text/plain', { Location: '/hris/' });
  if (url.pathname === '/hris/') return sendFile(req, res, path.join(PUBLIC, 'hris', 'index.html'));
  if (url.pathname === '/academic') return send(res, 302, '', 'text/plain', { Location: '/academic/' });
  if (url.pathname === '/academic/') return sendFile(req, res, path.join(PUBLIC, 'academic', 'index.html'));
  if (url.pathname === '/finance') return send(res, 302, '', 'text/plain', { Location: '/finance/' });
  if (url.pathname === '/finance/') return sendFile(req, res, path.join(PUBLIC, 'finance', 'index.html'));
  if (url.pathname === '/help') return send(res, 302, '', 'text/plain', { Location: '/help/' });
  if (url.pathname === '/help/') return sendFile(req, res, path.join(PUBLIC, 'help', 'index.html'));
  if (/^\/verify\/[A-Za-z0-9-]{4,40}$/.test(url.pathname)) return sendFile(req, res, path.join(PUBLIC, 'verify.html')); // a document's verification page
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!url.pathname.startsWith(prefix)) continue;
    let rel;
    try {
      rel = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    } catch {
      return send(res, 400, 'Bad request', 'text/plain');
    }
    if (rel.includes('\0')) return send(res, 400, 'Bad request', 'text/plain');
    const file = path.join(dir, rel);
    if (!file.startsWith(dir + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(req, res, file);
    if (prefix === '/' && !path.extname(rel)) return sendFile(req, res, path.join(dir, 'index.html'));
    return send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  // A malformed address or Host header is answered with 400, never allowed to stop the server.
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(res, 400, { error: 'Bad request.' });
  }
  if (url.pathname === '/healthz') return send(res, 200, { ok: true }); // for a load balancer health check later
  if (!url.pathname.startsWith('/api/')) {
    try {
      return serveStatic(req, url, res);
    } catch (err) {
      console.error(err);
      return send(res, 500, 'Something went wrong.', 'text/plain');
    }
  }
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
    if (res.headersSent) return res.destroy();
    send(res, status, { error: status === 500 ? 'Something went wrong. Check the terminal for details.' : err.message }, 'application/json', { ...(err.headers || {}), ...(err.close ? { Connection: 'close' } : {}) });
    if (err.close) res.on('finish', () => req.socket?.destroy()); // stop receiving an upload that is too large
  }
});
// Slow clients: the headers must arrive within 20 seconds (a "slowloris" cannot hold connections
// open by trickling them); a whole request, uploads included, within 5 minutes.
server.headersTimeout = 20 * 1000;
server.requestTimeout = 5 * 60 * 1000;
// Anything that still slips through is logged, and the server keeps serving everyone else.
process.on('uncaughtException', (err) => console.error('Unexpected error (ATLAS keeps running):', err));
process.on('unhandledRejection', (err) => console.error('Unexpected error (ATLAS keeps running):', err));

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
  console.log(`  ATLAS Learn: http://localhost:${PORT}/lms/   ·   Learn admin panel: http://localhost:${PORT}/admin   ·   ATLAS People: http://localhost:${PORT}/hris/   ·   ATLAS Academic: http://localhost:${PORT}/academic/   ·   ATLAS Finance: http://localhost:${PORT}/finance/`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('  Other computers on your network can open it using this computer\'s IP address.');
  console.log(`  Data file: ${DB_FILE}`);
  console.log('  Press Ctrl+C to stop.\n');
  if (process.env.OPEN_BROWSER) openBrowser(`http://localhost:${PORT}/`);
  // Encrypt any password hashes not yet under the current key, once this version has run for two
  // minutes (an update that fails to start is rolled back sooner, and the old version must still read them).
  setTimeout(() => {
    const { sealed } = api.sealPasswords();
    if (sealed) console.log(`  Encrypted ${sealed} password hash(es) with the password key.`);
  }, Number(process.env.PASSWORD_SEAL_DELAY_MS ?? 120000)).unref();
});
