import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { openDb } from './server/db.js';
import { createApi } from './server/api.js';
import { baseHeaders, pagePolicy, API_POLICY, crossSite } from './server/security.js';
import { PUBLIC_BODY_BYTES } from './server/helpdesk.js';

// CORE_APP_DIR: where public/ and shared/ live (the single .exe unpacks them there).
const ROOT = process.env.CORE_APP_DIR || path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // only reachable from this computer
const LOCAL_ONLY = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').split(',').filter(Boolean);
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'db.json');

const db = openDb(DB_FILE);
// Rate limits are on; RATE_LIMITS=off only for scripted runs such as the guide screenshots.
const api = createApi(db, { rateLimits: process.env.RATE_LIMITS !== 'off' });
// The Content-Security-Policy for CORE's pages, with the hashes of their small inline scripts.
const PAGE_POLICY = pagePolicy(ROOT);
// HTTPS directly, or through the HTTPS proxy on this computer (Caddy): then browsers are told to stay on HTTPS.
const viaHttps = (req) => Boolean(req.socket?.encrypted) || (/^(127\.|::1$|::ffff:127\.)/.test(req.socket?.remoteAddress || '') && req.headers['x-forwarded-proto'] === 'https');

const STATIC_DIRS = { '/shared/': path.join(ROOT, 'shared'), '/': path.join(ROOT, 'public') };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf' };

function send(res, status, body, type = 'application/json', headers = {}) {
  const textual = /^text\/|json|javascript|svg/.test(type);
  // Every answer carries the security headers; CORE's pages get the page policy, data the strictest.
  const policy = type === 'text/html' ? (headers['X-Robots-Tag'] ? {} : { 'Content-Security-Policy': PAGE_POLICY }) : type === 'application/json' ? { 'Content-Security-Policy': API_POLICY } : {};
  res.writeHead(status, { ...baseHeaders({ https: res.viaHttps }), ...policy, 'Content-Type': textual ? `${type}; charset=utf-8` : type, 'Cache-Control': 'no-store', ...headers });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

// How much of a request is read. Signed in: 50 MB (uploads arrive as base64 inside the JSON).
// Not signed in: 1 MB, or what the public support form can need with its files.
const MB = 1024 * 1024;
const bodyLimit = (req, url) => (api.signedIn(req) ? 50 * MB : url.pathname.startsWith('/api/public/') ? PUBLIC_BODY_BYTES : MB);

// A request that says it is too large is refused before any of it is read; one that turns out
// too large is refused at that point, and the rest is never read.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => reject(Object.assign(new Error('Request too large.'), { status: 413 }));
    if (Number(req.headers['content-length']) > limit) return tooLarge();
    const chunks = [];
    let size = 0;
    const onData = (chunk) => {
      size += chunk.length;
      if (size <= limit) return chunks.push(chunk);
      req.off('data', onData);
      req.pause();
      tooLarge();
    };
    req.on('data', onData);
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? JSON.parse(raw) : {};
        // Every endpoint takes a JSON object; null, a number or a string is a bad request.
        if (body === null || typeof body !== 'object') return reject(Object.assign(new Error('Send a JSON object.'), { status: 400 }));
        resolve(body);
      } catch {
        reject(Object.assign(new Error('Invalid JSON.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// Unlisted pages (public/private/<slug>.html) are served at /<slug>, linked from nowhere and
// kept out of search engines. Only slugs that look like core-rd-<random> are matched.
const NO_INDEX = { 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer' };
function servePrivate(url, res) {
  const slug = url.pathname.match(/^\/(core-rd-[a-z0-9]{8,})\/?$/)?.[1];
  const file = slug && path.join(ROOT, 'public', 'private', `${slug}.html`);
  if (!file || !fs.existsSync(file)) return false;
  send(res, 200, fs.readFileSync(file), 'text/html', NO_INDEX);
  return true;
}

function serveStatic(url, res) {
  if (url.pathname.startsWith('/private/')) return send(res, 404, 'Not found', 'text/plain');
  if (servePrivate(url, res)) return;
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!url.pathname.startsWith(prefix)) continue;
    let rel;
    try {
      rel = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    } catch {
      // A path that is not valid percent-encoding, e.g. /% or /%zz.
      return send(res, 400, 'Bad request', 'text/plain');
    }
    const file = path.join(dir, rel);
    if (!file.startsWith(dir + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    }
    // A folder with its own page, e.g. /help/ (Help & guides).
    const index = path.join(file, 'index.html');
    if (rel.endsWith('/') && fs.existsSync(index)) return send(res, 200, fs.readFileSync(index), 'text/html');
    if (fs.existsSync(index) && !rel.endsWith('/')) return send(res, 302, '', 'text/plain', { Location: `${url.pathname}/${url.search}` });
    // /support and /support/t/<token> are the public helpdesk form; everything else is the app.
    const page = url.pathname === '/support' || url.pathname.startsWith('/support/') ? 'support.html' : 'index.html';
    if (prefix === '/') return send(res, 200, fs.readFileSync(path.join(dir, page)), 'text/html');
    return send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  res.viaHttps = viaHttps(req);
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return send(res, 400, { error: 'Bad request.' });
  }
  if (!url.pathname.startsWith('/api/')) {
    // Whatever goes wrong while serving a page or a file is an error answer, never a crash.
    try {
      return serveStatic(url, res);
    } catch (err) {
      console.error(err);
      if (res.headersSent) return res.destroy();
      return send(res, 500, 'Something went wrong.', 'text/plain');
    }
  }
  // Block other websites from calling this API (DNS rebinding / CSRF): only accept
  // requests addressed to localhost or a plain IP address (e.g. 192.168.1.20 on the office network).
  const hostname = (req.headers.host || '').replace(/:\d+$/, '');
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[');
  if (hostname !== 'localhost' && !isIp && !ALLOWED_HOSTS.includes(hostname)) return send(res, 403, { error: 'Forbidden host.' });
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && !(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, { error: 'Requests must be JSON.' });
  }
  // A change must come from CORE's own pages, never from another site (cross-site request forgery).
  if (req.method !== 'GET' && req.method !== 'HEAD' && crossSite(req)) return send(res, 403, { error: 'This request came from another site and was refused.' });
  try {
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req, bodyLimit(req, url)) : {};
    const { data, headers } = await api(req, url, body);
    // A file to download (project attachments) is sent as bytes; everything else as JSON.
    send(res, 200, data, Buffer.isBuffer(data) ? 'application/octet-stream' : 'application/json', headers);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    // Too large: answer, then close the connection so the rest of the upload is not received.
    if (status === 413) res.once('finish', () => req.destroy());
    send(res, status, { error: status === 500 ? 'Something went wrong. Check the terminal for details.' : err.message }, 'application/json', status === 413 ? { Connection: 'close' } : err.headers || {});
  }
});
// A connection that sends its headers or its request too slowly is closed. Two minutes leaves
// room for the largest uploads on a slow line.
server.headersTimeout = 30 * 1000;
server.requestTimeout = 120 * 1000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. The app may already be running: open http://localhost:${PORT}`);
    console.error('  Or start it on another port, e.g. PORT=3001 (see README).\n');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  CORE · ERP by Lancaster is running at http://localhost:${PORT}`);
  if (!LOCAL_ONLY) {
    console.log('  Other computers on your network can open it using this computer\'s IP address.');
    // No HTTPS here: COOKIE_SECURE=1 says an HTTPS proxy stands in front (deploy/aws/EC2.md).
    if (process.env.COOKIE_SECURE !== '1') {
      console.warn('\n  WARNING: this connection is plain http, not encrypted. Passwords and sign-in cookies');
      console.warn('  travel unencrypted on the network, where others on it can read them. Use this only on');
      console.warn('  a trusted office network; for anything beyond that, use the HTTPS set-up (deploy/aws/EC2.md).\n');
    }
  }
  console.log(`  Data file: ${DB_FILE}`);
  console.log('  Press Ctrl+C to stop.\n');
  if (process.env.OPEN_BROWSER) {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
