// The restore drill, run every day (0.38): take the latest off-server copy (or, without one, the
// newest copy on this server), restore it into a throw-away folder, start CORE on it and check it
// works: the data opens, an administrator can sign in to it, the audit log's chain is intact.
// The result goes to data/backups/restore-check.json, which the Security monitor shows.
// Run nightly by the ltdc-erp-restore-check systemd timer (private /tmp, removed when it ends)
// through scripts/restore-check.js; the steps for a real restore: deploy/aws/RESTORE.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';
import { createApi } from './api.js';
import { createSecrets } from './secrets.js';
import { createAudit } from './audit.js';
import { instanceCredentials, fetchOffsiteCopy, IntegrityError, statusFile as offsiteStatusFile } from './offsite.js';

export const restoreStatusFile = (dataDir) => path.join(dataDir, 'backups', 'restore-check.json');

// The newest copy kept on this server by the nightly job (data/backups/db-YYYY-MM-DD.json).
function newestLocal(dataDir) {
  const dir = path.join(dataDir, 'backups');
  if (!fs.existsSync(dir)) return null;
  const db = fs.readdirSync(dir).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1);
  if (!db) return null;
  const day = db.slice(3, 13);
  const log = path.join(dir, `audit-log-${day}.jsonl`);
  return { name: `backups/${db}`, files: { 'db.json': fs.readFileSync(path.join(dir, db)), ...(fs.existsSync(log) ? { 'audit-log.jsonl': fs.readFileSync(log) } : {}) } };
}

// The latest good off-server copy, downloaded through fetchOffsiteCopy: the hour's sealed manifest
// and every file's size and SHA-256 are checked (VAPT 0.39). Attached files are not fetched nightly.
async function latestOffsite(dataDir, dest, { credentials, client }) {
  let last;
  try {
    last = JSON.parse(fs.readFileSync(offsiteStatusFile(dataDir), 'utf8')).lastOk;
  } catch {
    return null;
  }
  if (!last?.prefix) return null;
  const got = await fetchOffsiteCopy({ prefix: last.prefix, dest, dataDir, attachments: false, client, credentials });
  const files = Object.fromEntries(got.files.map((n) => [n, fs.readFileSync(path.join(dest, n))]));
  return { name: `${last.prefix}/`, copiedAt: got.at, files };
}

export async function runRestoreCheck({ dataDir, now = new Date(), credentials = instanceCredentials, client = null, offsite = true } = {}) {
  const started = Date.now();
  const status = { at: now.toISOString(), ok: false };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-restore-check-'));
  try {
    let copy = null;
    let offsiteError = null;
    if (offsite) {
      try {
        copy = await latestOffsite(dataDir, path.join(tmp, 'download'), { credentials, client });
      } catch (err) {
        // A copy that is not what was sent is the failure this check exists to find: never covered
        // by the copy on this server (VAPT 0.39, C3-3). Only an unreachable copy falls back.
        if (err instanceof IntegrityError) throw err;
        offsiteError = err.message;
      }
    }
    status.source = copy ? 's3' : 'local';
    copy ||= newestLocal(dataDir);
    if (!copy) throw new Error(offsiteError || 'No backup found: neither an off-server copy nor a nightly copy on this server.');
    if (offsiteError) status.note = `The off-server copy could not be read (${offsiteError}); the newest copy on this server was checked instead.`;
    Object.assign(status, { copy: copy.name, copiedAt: copy.copiedAt || null, bytes: copy.files['db.json']?.length || 0 });

    // Restore into the throw-away folder, with this server's key (sealed 2-step secrets and the
    // audit chain need it; it is never part of a backup).
    for (const [name, body] of Object.entries(copy.files)) fs.writeFileSync(path.join(tmp, name), body, { mode: 0o600 });
    // The copy never reaches out: its service desk mailbox is not read and no digest is sent.
    {
      const d0 = JSON.parse(copy.files['db.json'].toString('utf8'));
      if (d0.helpdesk?.mailbox) d0.helpdesk.mailbox.enabled = false;
      if (d0.helpdesk?.outgoing) { d0.helpdesk.outgoing.enabled = false; d0.helpdesk.outgoing.events = false; }
      if (d0.pm?.digest) d0.pm.digest.enabled = false;
      fs.writeFileSync(path.join(tmp, 'db.json'), JSON.stringify(d0), { mode: 0o600 });
    }
    const key = path.join(dataDir, 'secret.key');
    if (fs.existsSync(key)) fs.writeFileSync(path.join(tmp, 'secret.key'), fs.readFileSync(key), { mode: 0o600 });

    // The audit chain, checked before CORE starts on the copy (starting adds entries of its own).
    let audit = null;
    if (copy.files['audit-log.jsonl']) {
      const db0 = JSON.parse(copy.files['db.json'].toString('utf8'));
      const secrets = createSecrets(tmp);
      fs.mkdirSync(path.join(tmp, 'audit-check'), { mode: 0o700 });
      fs.copyFileSync(path.join(tmp, 'audit-log.jsonl'), path.join(tmp, 'audit-check', 'audit-log.jsonl'));
      if (fs.existsSync(path.join(tmp, 'audit-head.json'))) fs.copyFileSync(path.join(tmp, 'audit-head.json'), path.join(tmp, 'audit-check', 'audit-head.json'));
      const keyed = createAudit(path.join(tmp, 'audit-check'), { key: fs.existsSync(key) ? () => secrets.derive('core-audit-chain-v1') : null, keyedFrom: () => db0.settings?.auditKeyedFrom });
      const v = keyed.verify();
      audit = { ok: v.ok, entries: v.count, ...(v.ok ? {} : { problem: v.keyMissing ? 'key missing' : v.missingFrom ? `entries missing from ${v.missingFrom}` : `altered at entry ${v.brokenAt}` }) };
    }

    // CORE on the copy: the data opens, migrations run, and the sign-in page's status answers.
    const db = openDb(path.join(tmp, 'db.json'));
    const api = createApi(db);
    const res = await api({ method: 'GET', headers: {} }, new URL('/api/auth/status', 'http://localhost'), {});
    if (!res?.data || res.data.setupRequired) throw new Error('CORE started on the copy but it has no accounts: it would ask for setup.');
    api.monitor?.stop?.();
    const d = db.data;
    const admins = d.users.filter((u) => u.role === 'admin' && u.active).length;
    if (!admins) throw new Error('The copy has no active administrator: nobody could sign in to manage it.');
    status.counts = { users: d.users.length, admins, employees: d.employees.length, payrollRuns: d.payrollRuns.length, requests: d.requests.length, tickets: d.tickets?.length || 0, projects: d.pmProjects?.length || 0 };
    status.audit = audit;
    if (audit && !audit.ok) throw new Error(`The copy's audit log does not pass its check (${audit.problem}).`);
    status.ok = true;
  } catch (err) {
    status.error = err.message;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  status.ms = Date.now() - started;
  const file = restoreStatusFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  return status;
}
