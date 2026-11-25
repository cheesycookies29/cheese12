// Limits that keep one request from holding the server: a page that draws one large form many times
// stops at a page's worth of content; a signed-out upload piece is large only through a link that
// takes uploads. And the campus addresses are only for those who may change settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { setup } from './support.js';
import { readPdf, pageText } from '../server/pdf/reader.js';
import { renderPage } from '../server/pdf/render.js';
import { MAX_DOCS_BODY } from '../server/api.js';

function pdf(objects) {
  const parts = [Buffer.from('%PDF-1.7\n', 'latin1')];
  const offsets = [];
  let len = parts[0].length;
  objects.forEach((o, i) => {
    offsets.push(len);
    let b;
    if (typeof o === 'string') b = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
    else {
      const data = zlib.deflateSync(o.stream);
      b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< ${o.dict} /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    }
    parts.push(b);
    len += b.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}
const repeatedForm = (calls, formBytes) => pdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Fm 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 4 0 R >>',
  { dict: '', stream: Buffer.from(`BT /F1 12 Tf 72 720 Td (Hello) Tj ET\n${'/Fm Do\n'.repeat(calls)}`, 'latin1') },
  { dict: '/Type /XObject /Subtype /Form /BBox [0 0 10 10]', stream: Buffer.concat([Buffer.from('BT /F1 9 Tf 1 1 Td (Logo) Tj ET\n'), Buffer.alloc(formBytes, 0x20)]) },
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]);

test('a small form drawn many times is drawn; one large form drawn many times stops at a page’s worth', () => {
  const logo = renderPage(readPdf(repeatedForm(40, 1024)), 0);
  assert.equal(logo.error, undefined);
  const heavy = readPdf(repeatedForm(600, 8 * 1024 * 1024));
  const t = Date.now();
  const page = renderPage(heavy, 0);
  pageText(heavy, 0, 90);
  assert.ok(Date.now() - t < 3000, `took ${Date.now() - t} ms`);
  assert.match(page.error, /more drawing than can be shown/);
});

const req = (url, cookie = '') => ({ method: 'PUT', url, headers: cookie ? { cookie } : {}, socket: { remoteAddress: '198.51.100.9' } });

test('signed out, an upload piece may be large only through a link that takes uploads now', async () => {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123' });
  const small = env.api.prepare(req('/api/public/share/NotARealToken0000000000000000/uploads/u1')).maxBody;
  assert.ok(small < MAX_DOCS_BODY);
  assert.equal(env.api.prepare(req('/api/public/share/%E0%A4%A/uploads/u1')).maxBody, small);
  assert.equal(env.api.prepare(req('/api/docs/uploads/u1')).maxBody, small);
});

test('school networks are not in the settings of someone who may not change settings', async () => {
  const env = setup();
  const admin = env.client();
  await admin.post('/api/admin/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'password123' });
  await admin.post('/api/admin/demo');
  await admin.put('/api/admin/settings', { security: { schoolNetworks: [{ cidr: '203.0.113.0/24', label: 'Main Campus' }] } });
  assert.equal((await admin.get('/api/admin/settings')).security.schoolNetworks.length, 1);
  const registrar = env.client();
  await registrar.post('/api/hub/login', { username: 'registrar.demo', password: 'demo1234' });
  const seen = await registrar.get('/api/admin/settings');
  assert.equal(typeof seen.security.lockoutAttempts, 'number');
  assert.equal(seen.security.schoolNetworks, undefined);
  assert.equal(seen.security.schoolNetworkFactor, undefined);
});
