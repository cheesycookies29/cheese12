// Off-server backups (0.38): every hour the data file, the audit log and new attached files are
// copied to a private S3 bucket in the same AWS account, so a lost or broken server loses at most
// an hour. Standard library only: the server's role credentials come from the instance metadata
// service (IMDSv2) and each request is signed with AWS Signature Version 4.
//
// Run by cron (deploy/aws/ltdc-erp-backup.cron) through scripts/offsite-backup.js; the result is
// written to data/backups/offsite.json, which the Security monitor shows. The bucket is made by
// deploy/aws/github-deploy.yaml: ltdc-erp-backups-<account id>, private, encrypted, hourly copies
// kept 30 days. The server key (data/secret.key) is never sent: see deploy/aws/RESTORE.md.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
// RFC 3986, as SigV4 wants: everything but unreserved characters escaped; '/' kept in paths.
const enc = (s, keepSlash = false) => {
  const e = encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? e.replace(/%2F/g, '/') : e;
};

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
export async function instanceCredentials({ imds = process.env.CORE_IMDS_URL || 'http://169.254.169.254', fetchImpl = fetch } = {}) {
  const get = async (p, token) => {
    const r = await fetchImpl(`${imds}${p}`, { headers: { 'X-aws-ec2-metadata-token': token }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`Instance metadata ${p}: HTTP ${r.status}`);
    return r.text();
  };
  let token;
  try {
    const r = await fetchImpl(`${imds}/latest/api/token`, { method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '300' }, signal: AbortSignal.timeout(3000) });
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

// A small S3 client: put and get one object. endpoint: for tests (path-style), else virtual-hosted.
export function s3Client({ bucket, region, creds, endpoint = process.env.CORE_S3_ENDPOINT || '', fetchImpl = fetch }) {
  const base = endpoint ? new URL(endpoint) : new URL(`https://${bucket}.s3.${region}.amazonaws.com`);
  const pathOf = (key) => (endpoint ? `/${bucket}/${key}` : `/${key}`);
  async function call(method, key, body = null, extra = {}) {
    const payload = body ? sha256(body) : sha256('');
    const p = pathOf(key);
    const headers = signV4({ method, path: p, headers: { host: base.host, ...extra }, payloadHash: payload, region, creds });
    delete headers.host; // fetch sets it
    const r = await fetchImpl(`${base.origin}${enc(p, true)}`, { method, headers, body, signal: AbortSignal.timeout(120000) });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1] || `HTTP ${r.status}`;
      const hint = code === 'AccessDenied' || code === 'NoSuchBucket' ? ' Update the CloudFormation stack with deploy/aws/github-deploy.yaml (it makes the bucket and lets the server write to it).' : '';
      throw new Error(`S3 ${method} ${key}: ${code}.${hint}`);
    }
    return r;
  }
  return {
    bucket,
    put: (key, body, type = 'application/octet-stream') => call('PUT', key, body, { 'content-type': type }),
    get: async (key) => Buffer.from(await (await call('GET', key)).arrayBuffer()),
  };
}

const pad = (n) => String(n).padStart(2, '0');
// hourly/2026-11-18/09/: the hour's folder in the server's time zone (Asia/Manila on the server).
export const hourPrefix = (d = new Date()) => `hourly/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}/${pad(d.getHours())}`;

function writeStatus(file, status) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export const statusFile = (dataDir) => path.join(dataDir, 'backups', 'offsite.json');

// One run: the data file and the audit log (and its sealed head) under this hour's folder; attached
// files that are new since the last run under attachments/. Returns the status it wrote.
export async function runOffsiteBackup({ dataDir, now = new Date(), credentials = instanceCredentials, client = null } = {}) {
  const started = Date.now();
  const status = { at: now.toISOString(), ok: false };
  try {
    let s3 = client;
    if (!s3) {
      const id = await credentials();
      const bucket = process.env.BACKUP_BUCKET || `ltdc-erp-backups-${id.accountId}`;
      s3 = s3Client({ bucket, region: id.region, creds: id.creds });
    }
    status.bucket = s3.bucket;
    const prefix = hourPrefix(now);
    const uploaded = [];
    // The audit log's sealed head first, then the log: a line added in between leaves the log longer
    // than the head says, which the chain check accepts; the other order would look like a cut.
    for (const [name, type] of [['db.json', 'application/json'], ['audit-head.json', 'application/json'], ['audit-log.jsonl', 'application/x-ndjson']]) {
      const file = path.join(dataDir, name);
      if (!fs.existsSync(file)) continue;
      // The data file is replaced in one step when saved, so this read is one whole version of it.
      const body = fs.readFileSync(file);
      await s3.put(`${prefix}/${name}`, body, type);
      uploaded.push({ name, bytes: body.length, sha256: sha256(body) });
    }
    if (!uploaded.some((u) => u.name === 'db.json')) throw new Error(`No data file in ${dataDir}.`);
    // Attached files never change once saved: each is sent once.
    const manifestFile = path.join(dataDir, 'backups', 'offsite-attachments.json');
    let sent = {};
    try {
      sent = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch {}
    const attDir = path.join(dataDir, 'attachments');
    let newFiles = 0;
    let newBytes = 0;
    if (fs.existsSync(attDir)) {
      for (const name of fs.readdirSync(attDir)) {
        const file = path.join(attDir, name);
        const st = fs.statSync(file);
        if (!st.isFile() || sent[name] === st.size) continue;
        await s3.put(`attachments/${name}`, fs.readFileSync(file));
        sent[name] = st.size;
        newFiles += 1;
        newBytes += st.size;
      }
      writeStatus(manifestFile, sent);
    }
    // The list of attached files with this hour's copy, so a new server can fetch them all
    // (scripts/offsite-fetch.js): the server cannot list the bucket.
    const list = Buffer.from(JSON.stringify(sent));
    await s3.put(`${prefix}/attachments.json`, list, 'application/json');
    uploaded.push({ name: 'attachments.json', bytes: list.length, sha256: sha256(list) });
    Object.assign(status, { ok: true, prefix, files: uploaded, attachments: { new: newFiles, newBytes, total: Object.keys(sent).length }, ms: Date.now() - started });
  } catch (err) {
    Object.assign(status, { ok: false, error: err.message, ms: Date.now() - started });
  }
  // The last good copy stays known when this run failed.
  try {
    const before = JSON.parse(fs.readFileSync(statusFile(dataDir), 'utf8'));
    status.lastOk = status.ok ? { at: status.at, prefix: status.prefix, files: status.files } : before.lastOk || null;
  } catch {
    status.lastOk = status.ok ? { at: status.at, prefix: status.prefix, files: status.files } : null;
  }
  writeStatus(statusFile(dataDir), status);
  return status;
}

// Fetch one hour's copy into a folder, with every attached file it lists: for a restore
// (deploy/aws/RESTORE.md). prefix: e.g. hourly/2026-11-18/09.
export async function fetchOffsiteCopy({ prefix, dest, client = null, credentials = instanceCredentials }) {
  if (!/^hourly\/\d{4}-\d{2}-\d{2}\/\d{2}$/.test(prefix || '')) throw new Error('Give the hour to restore, e.g. hourly/2026-11-18/09 (S3 console → the bucket → hourly → the day → the hour).');
  let s3 = client;
  if (!s3) {
    const id = await credentials();
    s3 = s3Client({ bucket: process.env.BACKUP_BUCKET || `ltdc-erp-backups-${id.accountId}`, region: id.region, creds: id.creds });
  }
  fs.mkdirSync(path.join(dest, 'attachments'), { recursive: true, mode: 0o700 });
  const got = [];
  for (const name of ['db.json', 'audit-head.json', 'audit-log.jsonl', 'attachments.json']) {
    try {
      const body = await s3.get(`${prefix}/${name}`);
      fs.writeFileSync(path.join(dest, name), body, { mode: 0o600 });
      got.push(name);
    } catch (err) {
      if (name === 'db.json') throw err;
    }
  }
  let attachments = 0;
  if (got.includes('attachments.json')) {
    for (const name of Object.keys(JSON.parse(fs.readFileSync(path.join(dest, 'attachments.json'), 'utf8')))) {
      if (!/^[\w.-]+$/.test(name)) continue; // a file name, never a path
      fs.writeFileSync(path.join(dest, 'attachments', name), await s3.get(`attachments/${name}`), { mode: 0o600 });
      attachments += 1;
    }
    fs.rmSync(path.join(dest, 'attachments.json'));
  }
  return { files: got.filter((n) => n !== 'attachments.json'), attachments };
}
