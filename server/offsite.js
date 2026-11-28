// Off-server backups (0.38): every hour the data file, the audit log and new attached files are
// copied to a private S3 bucket in the same AWS account, so a lost or broken server loses at most
// an hour. Standard library only: the server's role credentials come from the instance metadata
// service (IMDSv2) and each request is signed with AWS Signature Version 4.
//
// VAPT round 3 (0.39):
// - nothing is ever overwritten: every upload is conditional (If-None-Match: *), and the bucket
//   refuses any other upload, so a taken-over server cannot rewrite the history (C3-2);
// - each hour has a manifest of what it holds (sizes and SHA-256), sealed with a key made from the
//   server key; a restore checks the seal and every file against it (C3-2);
// - downloads are capped at the size the manifest gives, redirects are refused and the bucket's
//   owner is pinned (C3-6, C3-10, C3-12); attached files no longer on the server leave the list (C3-5).
//
// Run hourly by the ltdc-erp-offsite systemd timer (deploy/aws/); the result is written to
// data/backups/offsite.json, which the Security monitor shows. The bucket is made by
// deploy/aws/github-deploy.yaml. The server key (data/secret.key) is never sent: see RESTORE.md.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
// RFC 3986, as SigV4 wants: everything but unreserved characters escaped; '/' kept in paths.
const enc = (s, keepSlash = false) => {
  const e = encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? e.replace(/%2F/g, '/') : e;
};
// A file name, never a path, '.' or '..'.
export const safeName = (name) => typeof name === 'string' && /^[\w.-]{1,200}$/.test(name) && !/^\.{1,2}$/.test(name);
export class IntegrityError extends Error {}

// AWS Signature Version 4 for one request. headers: lower-case names; host is required.
export function signV4({ method, path: p, query = {}, headers, payloadHash, region, service = 's3', creds, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const all = { ...headers, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash, ...(creds.token ? { 'x-amz-security-token': creds.token } : {}) };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonical = [method, enc(p, true), canonicalQuery, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${creds.secret}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${creds.id}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

// The server's identity and role credentials, from the instance metadata service (IMDSv2).
// imds: tests only (a stand-in); the real address is fixed.
export async function instanceCredentials({ imds = 'http://169.254.169.254', fetchImpl = fetch } = {}) {
  const opts = (extra) => ({ redirect: 'error', signal: AbortSignal.timeout(3000), ...extra });
  const get = async (p, token) => {
    const r = await fetchImpl(`${imds}${p}`, opts({ headers: { 'X-aws-ec2-metadata-token': token } }));
    if (!r.ok) throw new Error(`Instance metadata ${p}: HTTP ${r.status}`);
    return r.text();
  };
  let token;
  try {
    const r = await fetchImpl(`${imds}/latest/api/token`, opts({ method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '300' } }));
    token = await r.text();
  } catch {
    throw new Error('Not on AWS: the instance metadata service did not answer.');
  }
  const doc = JSON.parse(await get('/latest/dynamic/instance-identity/document', token));
  const role = (await get('/latest/meta-data/iam/security-credentials/', token)).split('\n')[0].trim();
  if (!role) throw new Error('The server has no IAM role (attach ltdc-erp-server: deploy/aws/EC2.md).');
  const c = JSON.parse(await get(`/latest/meta-data/iam/security-credentials/${role}`, token));
  return { accountId: doc.accountId, region: doc.region, creds: { id: c.AccessKeyId, secret: c.SecretAccessKey, token: c.Token } };
}

// A small S3 client: put an object once, get one with a size cap. owner: the account that must own
// the bucket (pinned on every request). endpoint: tests only (path-style).
export function s3Client({ bucket, region, creds, owner = null, endpoint = '', fetchImpl = fetch }) {
  const base = endpoint ? new URL(endpoint) : new URL(`https://${bucket}.s3.${region}.amazonaws.com`);
  const pathOf = (key) => (endpoint ? `/${bucket}/${key}` : `/${key}`);
  async function call(method, key, body = null, extra = {}) {
    const p = pathOf(key);
    const headers = signV4({ method, path: p, headers: { host: base.host, ...(owner ? { 'x-amz-expected-bucket-owner': owner } : {}), ...extra }, payloadHash: body ? sha256(body) : sha256(''), region, creds });
    delete headers.host; // fetch sets it
    return fetchImpl(`${base.origin}${enc(p, true)}`, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(120000) });
  }
  async function fail(r, method, key) {
    const text = await r.text().catch(() => '');
    const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1] || `HTTP ${r.status}`;
    const hint = code === 'AccessDenied' || code === 'NoSuchBucket' ? ' Update the CloudFormation stack with deploy/aws/github-deploy.yaml (it makes the bucket and lets the server write to it).' : '';
    return Object.assign(new Error(`S3 ${method} ${key}: ${code}.${hint}`), { code });
  }
  return {
    bucket,
    // Never overwrites: an object already there is left as it is ({ existed: true }).
    async put(key, body, type = 'application/octet-stream') {
      const r = await call('PUT', key, body, { 'content-type': type, 'if-none-match': '*' });
      if (r.status === 412) return { existed: true };
      if (!r.ok) throw await fail(r, 'PUT', key);
      return { existed: false };
    },
    // The whole object, refused when bigger than maxBytes (read in pieces, never all at once).
    async get(key, { maxBytes = 2 * 1024 * 1024 * 1024 } = {}) {
      const r = await call('GET', key);
      if (!r.ok) throw await fail(r, 'GET', key);
      const declared = Number(r.headers.get('content-length'));
      if (declared > maxBytes) throw new IntegrityError(`${key} is ${declared} bytes, more than the ${maxBytes} expected.`);
      const chunks = [];
      let size = 0;
      for await (const chunk of r.body) {
        size += chunk.length;
        if (size > maxBytes) throw new IntegrityError(`${key} is more than the ${maxBytes} bytes expected.`);
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
  };
}

const pad = (n) => String(n).padStart(2, '0');
// hourly/2026-11-18/09: the hour's folder in the server's time zone (Asia/Manila on the server).
export const hourPrefix = (d = new Date()) => `hourly/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}/${pad(d.getHours())}`;
// hourly/2026-12-09/19/20: a further copy in the same hour, in a folder for its minute (0.74.3). On an
// event day the copy runs every 15 minutes (deploy/aws/ltdc-erp-event backups-every-15); the hour's
// first copy keeps the hour's folder, the others go in minute folders under it.
export const minutePrefix = (d = new Date()) => `${hourPrefix(d)}/${pad(d.getMinutes())}`;
export const PREFIX_RE = /^hourly\/\d{4}-\d{2}-\d{2}\/\d{2}(\/\d{2})?$/;

function writeStatus(file, status) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export const statusFile = (dataDir) => path.join(dataDir, 'backups', 'offsite.json');

// The key that seals each hour's manifest, made from the server key (which never leaves the server).
export function manifestKey(dataDir) {
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) throw new Error(`The server key is missing (${file}). Put it back first: deploy/aws/RESTORE.md.`);
  return hmac(Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64'), 'core-offsite-manifest-v1');
}
// Documents (0.67) are listed only by manifests written since; older manifests read as before.
const canonical = (m) => JSON.stringify({ v: m.v, prefix: m.prefix, at: m.at, files: m.files, attachments: m.attachments, documents: m.documents });
// A stored document file: documents/<2 hex>/<32 hex> (encrypted with the server's key; server/dms/blobs.js).
const DOC_NAME = /^[0-9a-f]{2}\/[0-9a-f]{32}$/;
function documentFiles(dataDir) {
  const root = path.join(dataDir, 'documents');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const sub of fs.readdirSync(root)) {
    if (!/^[0-9a-f]{2}$/.test(sub)) continue;
    for (const f of fs.readdirSync(path.join(root, sub))) if (/^[0-9a-f]{32}$/.test(f)) out.push(`${sub}/${f}`);
  }
  return out;
}
export const sealManifest = (m, key) => ({ ...m, mac: createHmac('sha256', key).update(canonical(m)).digest('hex') });
export function checkManifest(m, key, prefix) {
  if (!m || m.v !== 1 || typeof m.mac !== 'string' || m.prefix !== prefix || !Array.isArray(m.files) || !m.attachments || typeof m.attachments !== 'object') throw new IntegrityError(`The manifest of ${prefix} is not one CORE wrote.`);
  const want = Buffer.from(createHmac('sha256', key).update(canonical(m)).digest('hex'));
  const got = Buffer.from(m.mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new IntegrityError(`The manifest of ${prefix} does not match the server key: it was changed, or it is from another server.`);
  return m;
}

async function clientFor({ client, credentials }) {
  if (client) return client;
  const id = await credentials();
  return s3Client({ bucket: `ltdc-erp-backups-${id.accountId}`, region: id.region, creds: id.creds, owner: id.accountId });
}

// One run: the data file and the audit log (and its sealed head) under this hour's folder, attached
// files new since the last run under attachments/, and the hour's sealed manifest. Returns the status.
export async function runOffsiteBackup({ dataDir, now = new Date(), credentials = instanceCredentials, client = null } = {}) {
  const started = Date.now();
  const status = { at: now.toISOString(), ok: false };
  try {
    const key = manifestKey(dataDir);
    const s3 = await clientFor({ client, credentials });
    status.bucket = s3.bucket;
    // The hour's folder, or, when the hour already has its copy (every 15 minutes on an event day),
    // a folder for this minute under it. Nothing is ever replaced: each upload is conditional.
    let prefix = hourPrefix(now);
    const files = [];
    // The audit log's sealed head first, then the log: a line added in between leaves the log longer
    // than the head says, which the chain check accepts; the other order would look like a cut.
    for (const [name, type] of [['db.json', 'application/json'], ['audit-head.json', 'application/json'], ['audit-log.jsonl', 'application/x-ndjson']]) {
      const file = path.join(dataDir, name);
      if (!fs.existsSync(file)) continue;
      // The data file is replaced in one step when saved, so this read is one whole version of it.
      const body = fs.readFileSync(file);
      let put = await s3.put(`${prefix}/${name}`, body, type);
      if (put.existed && name === 'db.json' && prefix === hourPrefix(now)) {
        prefix = minutePrefix(now);
        put = await s3.put(`${prefix}/${name}`, body, type);
      }
      if (put.existed && name === 'db.json') throw Object.assign(new Error(`This hour (${hourPrefix(now)}) and this minute (${prefix}) are already copied; the next copy is at the next scheduled time.`), { already: true });
      files.push({ name, bytes: body.length, sha256: sha256(body) });
    }
    if (!files.some((u) => u.name === 'db.json')) throw new Error(`No data file in ${dataDir}.`);
    // Attached files never change once saved: each is sent once. The list is saved after each one,
    // so a failure does not send them all again; files no longer on the server leave it.
    const listFile = path.join(dataDir, 'backups', 'offsite-attachments.json');
    let sent = {};
    try {
      sent = JSON.parse(fs.readFileSync(listFile, 'utf8'));
    } catch {}
    const attDir = path.join(dataDir, 'attachments');
    const here = fs.existsSync(attDir) ? fs.readdirSync(attDir).filter((n) => safeName(n) && fs.statSync(path.join(attDir, n)).isFile()) : [];
    const kept = Object.fromEntries(Object.entries(sent).filter(([n, v]) => here.includes(n) && v && typeof v === 'object'));
    let newFiles = 0;
    let newBytes = 0;
    for (const name of here) {
      const st = fs.statSync(path.join(attDir, name));
      if (kept[name]?.bytes === st.size) continue;
      const body = fs.readFileSync(path.join(attDir, name));
      await s3.put(`attachments/${name}`, body);
      kept[name] = { bytes: body.length, sha256: sha256(body) };
      newFiles += 1;
      newBytes += body.length;
      writeStatus(listFile, kept);
    }
    writeStatus(listFile, kept);
    // Document files (0.67), the same way: each sent once (they are already encrypted, and never
    // change once written), under documents/.
    const docList = path.join(dataDir, 'backups', 'offsite-documents.json');
    let docSent = {};
    try {
      docSent = JSON.parse(fs.readFileSync(docList, 'utf8'));
    } catch {}
    const docHere = documentFiles(dataDir);
    const docKept = Object.fromEntries(Object.entries(docSent).filter(([n, v]) => docHere.includes(n) && v && typeof v === 'object'));
    let newDocs = 0;
    for (const name of docHere) {
      const file = path.join(dataDir, 'documents', name);
      if (docKept[name]?.bytes === fs.statSync(file).size) continue;
      const body = fs.readFileSync(file);
      await s3.put(`documents/${name}`, body);
      docKept[name] = { bytes: body.length, sha256: sha256(body) };
      newDocs += 1;
      newBytes += body.length;
      writeStatus(docList, docKept);
    }
    writeStatus(docList, docKept);
    // The hour's manifest: what it holds and every attached and document file of that moment, sealed.
    const manifest = sealManifest({ v: 1, prefix, at: now.toISOString(), files, attachments: kept, documents: docKept }, key);
    await s3.put(`${prefix}/manifest.json`, Buffer.from(JSON.stringify(manifest)), 'application/json');
    Object.assign(status, { ok: true, prefix, files, attachments: { new: newFiles, newBytes, total: Object.keys(kept).length }, documents: { new: newDocs, total: Object.keys(docKept).length }, ms: Date.now() - started });
  } catch (err) {
    Object.assign(status, { ok: false, error: err.message, ms: Date.now() - started });
  }
  // The last good copy stays known when this run failed.
  let before = null;
  try {
    before = JSON.parse(fs.readFileSync(statusFile(dataDir), 'utf8'));
  } catch {}
  status.lastOk = status.ok ? { at: status.at, prefix: status.prefix, files: status.files } : before?.lastOk || null;
  writeStatus(statusFile(dataDir), status);
  return status;
}

// Fetch one hour's copy into a folder after checking it: the manifest's seal (needs the server key
// in dataDir), then each file's size and SHA-256; attached files too unless attachments is false.
// For a restore (deploy/aws/RESTORE.md) and the nightly restore check. prefix: e.g. hourly/2026-11-18/09
// (or hourly/2026-12-09/19/20, a copy taken every 15 minutes on an event day).
export async function fetchOffsiteCopy({ prefix, dest, dataDir, attachments = true, client = null, credentials = instanceCredentials }) {
  if (!PREFIX_RE.test(prefix || '')) throw new Error('Give the hour to restore, e.g. hourly/2026-11-18/09, or a minute folder in it, e.g. hourly/2026-12-09/19/20 (S3 console → the bucket → hourly → the day → the hour).');
  const key = manifestKey(dataDir);
  const s3 = await clientFor({ client, credentials });
  let manifest;
  try {
    manifest = JSON.parse((await s3.get(`${prefix}/manifest.json`, { maxBytes: 16 * 1024 * 1024 })).toString('utf8'));
  } catch (err) {
    if (err instanceof IntegrityError || err instanceof SyntaxError) throw new IntegrityError(`The manifest of ${prefix} cannot be read as one CORE wrote.`);
    throw err;
  }
  checkManifest(manifest, key, prefix);
  fs.mkdirSync(path.join(dest, 'attachments'), { recursive: true, mode: 0o700 });
  const got = [];
  for (const f of manifest.files) {
    if (!['db.json', 'audit-head.json', 'audit-log.jsonl'].includes(f.name)) throw new IntegrityError(`The manifest of ${prefix} lists an unexpected file.`);
    const body = await s3.get(`${prefix}/${f.name}`, { maxBytes: f.bytes });
    if (body.length !== f.bytes || sha256(body) !== f.sha256) throw new IntegrityError(`${prefix}/${f.name} is not the file that was sent.`);
    fs.writeFileSync(path.join(dest, f.name), body, { mode: 0o600 });
    got.push(f.name);
  }
  let count = 0;
  if (attachments) {
    for (const [name, a] of Object.entries(manifest.attachments)) {
      if (!safeName(name)) throw new IntegrityError(`The manifest of ${prefix} lists an attached file with an unsafe name.`);
      const body = await s3.get(`attachments/${name}`, { maxBytes: a.bytes });
      if (body.length !== a.bytes || sha256(body) !== a.sha256) throw new IntegrityError(`attachments/${name} is not the file that was sent.`);
      fs.writeFileSync(path.join(dest, 'attachments', name), body, { mode: 0o600 });
      count += 1;
    }
  }
  let docs = 0;
  if (attachments && manifest.documents && typeof manifest.documents === 'object') {
    for (const [name, a] of Object.entries(manifest.documents)) {
      if (!DOC_NAME.test(name)) throw new IntegrityError(`The manifest of ${prefix} lists a document file with an unsafe name.`);
      const body = await s3.get(`documents/${name}`, { maxBytes: a.bytes });
      if (body.length !== a.bytes || sha256(body) !== a.sha256) throw new IntegrityError(`documents/${name} is not the file that was sent.`);
      fs.mkdirSync(path.join(dest, 'documents', name.slice(0, 2)), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dest, 'documents', name), body, { mode: 0o600 });
      docs += 1;
    }
  }
  return { files: got, attachments: count, documents: docs, at: manifest.at };
}
