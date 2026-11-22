// PDF Studio's page editor and signing (0.65): the changes are checked (kinds, ranges, pictures),
// drawn on the page as shown (turned pages included), lines of text are changed in the page itself
// (the old words are gone, the new ones where they began), and a signed PDF gets a record page and
// a record in CORE that tells an unchanged file from a changed one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { cleanEdits, boxLines, hasSignature } from '../server/pdf/edits.js';
import { docToPdf } from '../server/pdf/layout.js';
import { buildPdf } from '../server/pdf/build.js';
import { readPdf, pageText } from '../server/pdf/reader.js';
import { renderPage } from '../server/pdf/render.js';
import { FONTS } from '../server/pdf/writer.js';
import { signingCode } from '../server/tools-pdf.js';

const JPEG = fs.readFileSync(new URL('../scripts/fixtures/profile-sample.jpg', import.meta.url));
// A tiny PNG (1 × 1, red), as the editor sends a signature.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const drawn = (pdf) => {
  const s = pdf.toString('latin1');
  const out = [];
  for (const m of s.matchAll(/stream\n/g)) {
    const end = s.indexOf('\nendstream', m.index);
    const body = pdf.subarray(m.index + 7, end);
    try {
      out.push(inflateSync(body).toString('latin1'));
    } catch {
      out.push(body.toString('latin1'));
    }
  }
  return out.join('\n');
};

test('edits: checked and cleaned; unknown kinds, bad pictures and wild positions refused', () => {
  const out = cleanEdits([
    { type: 'text', x: 10, y: 20, text: 'Hello\r\nworld\u0007', size: 300, family: 'comic', bold: true, color: 'red', extra: 1 },
    { type: 'box', x: 1, y: 2, w: 30, h: 10 },
    { type: 'highlight', x: 1, y: 2, w: 30, h: 10, color: '#A7F3D0' },
    { type: 'mark', x: 5, y: 5, kind: 'skull' },
    { type: 'image', x: 0, y: 0, w: 100, h: 40, data: `data:image/png;base64,${PNG.toString('base64')}`, signature: true },
    { type: 'replace', run: 3, text: 'New words', size: 11, family: 'serif' },
  ].map((e, i) => (i === 0 ? { ...e, size: 30 } : e)));
  assert.deepEqual(out[0], { type: 'text', x: 10, y: 20, w: null, text: 'Hello\nworld', size: 30, family: 'sans', bold: true, italic: false, color: '#111111' });
  assert.deepEqual(out[1], { type: 'box', x: 1, y: 2, w: 30, h: 10, color: '#ffffff' });
  assert.equal(out[2].color, '#a7f3d0');
  assert.equal(out[3].kind, 'check');
  assert.ok(Buffer.isBuffer(out[4].data) && out[4].signature);
  assert.equal(out[5].family, 'serif');
  assert.ok(hasSignature(out));
  for (const [bad, re] of [
    [{ type: 'script' }, /unknown kind/], [{ type: 'text', x: 1e9, y: 0 }, /out of range/], [{ type: 'image', x: 0, y: 0, w: 1, h: 1, data: Buffer.from('GIF89a').toString('base64') }, /PNG or JPEG/],
    [{ type: 'image', x: 0, y: 0, w: 1, h: 1, data: '' }, /missing/], [{ type: 'replace', run: -1 }, /not on the page/], [{ type: 'text', x: 0, y: 0, size: 1000 }, /text size/],
  ]) assert.throws(() => cleanEdits([bad]), re);
  assert.throws(() => cleanEdits('nope'), /list/);
  assert.throws(() => cleanEdits(Array(301).fill({ type: 'box', x: 0, y: 0, w: 1, h: 1 })), /up to 300/);
  assert.deepEqual(boxLines('one two three four', FONTS.regular, 10, 40), ['one two', 'three', 'four']);
  assert.deepEqual(boxLines('a\nb', FONTS.regular, 10, null), ['a', 'b']);
});

test('export with edits: drawn on top, upright on a turned page; a line of text changed in the page', () => {
  const src = readPdf(docToPdf({ blocks: [{ type: 'paragraph', runs: [{ text: 'Total due: PHP 1,000.00' }] }, { type: 'paragraph', runs: [{ text: 'Keep this line' }] }] }).pdf);
  const runs = renderPage(src, 0).runs;
  const target = runs.find((r) => r.text.includes('Total due'));
  assert.ok(target, JSON.stringify(runs.map((r) => r.text)));
  const edits = cleanEdits([
    { type: 'replace', run: target.id, text: 'Total due: PHP 2,500.00', size: target.size, family: 'sans' },
    { type: 'text', x: 72, y: 300, text: 'Approved', size: 14, bold: true, color: '#15803d' },
    { type: 'box', x: 72, y: 400, w: 100, h: 20 },
    { type: 'mark', x: 60, y: 300, kind: 'check' },
    { type: 'image', x: 300, y: 600, w: 150, h: 50, data: PNG.toString('base64'), signature: true },
  ]);
  const pdf = buildPdf([{ doc: src, index: 0, rotate: 0, edits }, { doc: src, index: 0, rotate: 90, edits: cleanEdits([{ type: 'text', x: 20, y: 20, text: 'Sideways note', size: 10 }]) }], {}, { title: 'Edited' });
  const out = readPdf(pdf);
  assert.equal(out.pageCount, 2);
  const text = pageText(out, 0, 2000);
  assert.match(text, /Total due: PHP 2,500\.00/);
  assert.doesNotMatch(text, /1,000\.00/, 'the old words are gone from the page');
  assert.match(text, /Keep this line/);
  assert.match(text, /Approved/);
  const content = drawn(pdf);
  assert.match(content, /\/CoreIm1 Do/, 'the signature is drawn as a picture of its own');
  assert.match(content, /0 1 -1 0 [\d.]+ [\d.]+ cm[\s\S]*\(Sideways note\) Tj/, 'on a turned page, through the turning matrix');
  // The changed line starts where the old one did.
  const after = renderPage(out, 0).runs.find((r) => r.text.includes('2,500'));
  assert.ok(Math.abs(after.x - target.x) < 0.6 && Math.abs(after.y - target.y) < 0.6, `${after.x},${after.y} vs ${target.x},${target.y}`);
});

test('signing codes are unambiguous', () => {
  for (let i = 0; i < 50; i++) assert.match(signingCode(), /^CORE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pdf-edit-'));
const db = openDb(path.join(dir, 'db.json'));
const handle = createApi(db);
const client = () => {
  let cookie = '';
  return async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.6' } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res;
  };
};
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'Correct-Horse-42' });
await admin('POST', '/api/users', { name: 'Sam Sales', username: 'sam', role: 'sales', password: 'Correct-Horse-42', mustChangePassword: false });
const sam = client();
await sam('POST', '/api/auth/login', { username: 'sam', password: 'Correct-Horse-42' });
const ivy = client();
await admin('POST', '/api/users', { name: 'Ivy Tech', username: 'ivy', role: 'it', password: 'Correct-Horse-42', mustChangePassword: false });
await ivy('POST', '/api/auth/login', { username: 'ivy', password: 'Correct-Horse-42' });
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
  return true;
});

test('API: the page as SVG and its lines of text; sign, record, verify; a changed file is told apart', async () => {
  const up = (await sam('POST', '/api/tools/pdf/sources', { file: { name: 'quote.md', data: Buffer.from('# Quotation\n\nTotal: PHP 45,000.00\n\nValid for 30 days.\n').toString('base64') } })).data;
  const svg = await sam('GET', `/api/tools/pdf/sources/${up.id}/pages/0/svg`);
  assert.equal(svg.headers['Content-Type'], 'image/svg+xml; charset=utf-8');
  assert.match(svg.headers['Content-Security-Policy'], /sandbox/);
  const s = svg.data.toString('utf8');
  assert.match(s, /^<svg|^<\?xml/);
  assert.match(s, /Quotation/);
  assert.doesNotMatch(s, /<script|\son\w+=|href="http/i);
  await fails(ivy('GET', `/api/tools/pdf/sources/${up.id}/pages/0/svg`), 404);
  await fails(sam('GET', `/api/tools/pdf/sources/${up.id}/pages/9/svg`), 404, /not in this file/);
  const lines = (await sam('GET', `/api/tools/pdf/sources/${up.id}/pages/0/text`)).data;
  const total = lines.runs.find((r) => r.text.includes('45,000'));
  assert.ok(total && total.editable);
  // Change the total, sign the page, export with the record page.
  const body = {
    pages: [{ source: up.id, page: 0, edits: [{ type: 'replace', run: total.id, text: 'Total: PHP 40,000.00', size: total.size, family: total.family }, { type: 'image', x: 380, y: 700, w: 150, h: 50, data: PNG.toString('base64'), signature: true }] }],
    meta: { title: 'Quotation' }, fileName: 'Signed quotation',
  };
  const res = await sam('POST', '/api/tools/pdf/export', body);
  const signed = res.data;
  const doc = readPdf(signed);
  assert.equal(doc.pageCount, 2, 'the page and its signature record');
  const last = pageText(doc, 1, 3000);
  assert.match(last, /Signature record/);
  assert.match(last, /Sam Sales \(sam\)/);
  const code = last.match(/CORE-[A-Z2-9]{4}-[A-Z2-9]{4}/)[0];
  assert.match(pageText(doc, 0, 2000), /PHP 40,000\.00/);
  assert.doesNotMatch(pageText(doc, 0, 2000), /45,000/);
  const rec = db.data.pdfSignatures.find((r) => r.code === code);
  assert.equal(rec.name, 'Sam Sales');
  assert.deepEqual(rec.signedPages, [1]);
  assert.match(fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8'), new RegExp(`tools\\.pdf-signed[^\\n]*${code}`));
  // Verify: the same bytes are valid (for anyone in CORE); one byte changed is "changed".
  const v = (await ivy('POST', '/api/tools/pdf/verify', { file: { name: 'x.pdf', data: signed.toString('base64') } })).data;
  assert.equal(v.result, 'valid');
  assert.equal(v.record.name, 'Sam Sales');
  assert.equal(v.record.code, code);
  const tampered = Buffer.from(signed);
  const at = tampered.indexOf('/Producer');
  tampered[at + 12] = tampered[at + 12] === 0x41 ? 0x42 : 0x41;
  const v2 = (await ivy('POST', '/api/tools/pdf/verify', { file: { name: 'x.pdf', data: tampered.toString('base64') } })).data;
  assert.equal(v2.result, 'changed');
  assert.equal(v2.record.code, code);
  const v3 = (await ivy('POST', '/api/tools/pdf/verify', { file: { name: 'x.pdf', data: docToPdf({ blocks: [{ type: 'paragraph', runs: [{ text: 'Unsigned' }] }] }).pdf.toString('base64') } })).data;
  assert.equal(v3.result, 'unknown');
  // Without the record page (asked), or split: no record.
  const before = db.data.pdfSignatures.length;
  const plain = (await sam('POST', '/api/tools/pdf/export', { ...body, sign: { record: false } })).data;
  assert.equal(readPdf(plain).pageCount, 1);
  await sam('POST', '/api/tools/pdf/export', { ...body, split: 'pages' });
  assert.equal(db.data.pdfSignatures.length, before);
  // A bad change is refused before anything is made.
  await fails(sam('POST', '/api/tools/pdf/export', { pages: [{ source: up.id, page: 0, edits: [{ type: 'iframe' }] }] }), 400, /unknown kind/);
  handle.monitor.stop();
});
