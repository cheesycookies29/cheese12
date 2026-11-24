// PDF Studio's API tests (ported from CORE ERP): a demo school on a database on disk (PDF Studio keeps
// its files beside it, in pdf-studio/), and clients that answer as CORE's tests expect:
// { data, headers } with data the file itself for a PDF, a picture or a ZIP.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../server/db.js';
import { setup } from '../support.js';

export async function pdfSchool(prefix = 'atlas-pdf-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const db = openDb(path.join(dir, 'db.json'));
  const env = setup({ db, clock: () => new Date() });
  const client = () => {
    let cookie = {};
    return async (method, url, body = {}) => {
      const header = Object.entries(cookie).map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await env.api({ method, headers: { cookie: header }, socket: { remoteAddress: '10.0.0.4' } }, new URL(url, 'http://localhost'), body);
      for (const set of [res.headers?.['Set-Cookie'] || []].flat()) {
        const [k, v] = set.split(';')[0].split('=');
        if (v) cookie[k] = v;
        else delete cookie[k];
      }
      if (res.raw != null) return { data: res.raw, headers: { 'Content-Type': res.type, ...res.headers } };
      return { data: res.data, headers: res.headers || {} };
    };
  };
  const admin = client();
  await admin('POST', '/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123' });
  await admin('POST', '/api/admin/demo');
  const as = async (username) => {
    const c = client();
    await c('POST', '/api/hub/login', { username, password: 'demo1234' });
    return c;
  };
  const done = () => {
    env.api.monitor?.stop?.();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { dir, db, handle: env.api, admin, as, client, done };
}
