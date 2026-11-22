// PDF Studio: encrypted PDFs. Files made by real programs (ReportLab, pypdf, LibreOffice; see the
// table below) open with no password when they only restrict printing or copying, and with the
// user or the owner password otherwise; a missing or wrong password, and security CORE cannot
// open, get plain errors. Their text, drawing and copied pages come out decrypted. A file put
// together here (object streams, a cross-reference stream, unencrypted metadata, a stream with its
// own Identity crypt filter, an annotation) covers what those programs do not write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { readPdf, importPages, pageText, pageInternals, pageAnnotations } from '../server/pdf/reader.js';
import { renderPage } from '../server/pdf/render.js';
import { PdfWriter } from '../server/pdf/writer.js';

const fixture = (f) => fs.readFileSync(new URL(`../scripts/fixtures/${f}`, import.meta.url));
const NEEDED = /^This PDF needs a password to open\. Type it to add the file\.$/;
const WRONG = /^That password is not right for this PDF\.$/;
const UNSUPPORTED = /protected with a certificate or a kind of encryption CORE cannot open/;

// Poppler, when installed, checks the copied pages the way another program reads them.
const hasPoppler = (() => { try { execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pdf-enc-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
function poppler(buf) {
  const file = path.join(tmp, `${randomBytes(6).toString('hex')}.pdf`);
  fs.writeFileSync(file, buf);
  return { info: execFileSync('pdfinfo', [file], { encoding: 'utf8' }), text: execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' }) };
}

// The pages copied into a new PDF, which is not encrypted and holds the text in the clear.
function copyAll(doc) {
  const w = new PdfWriter({ title: 'Copy' });
  for (const dict of importPages(doc, w, doc.pages.map((_, i) => i))) w.addPage(dict);
  return w.toBuffer();
}
const runsText = (doc, i) => renderPage(doc, i).runs.map((r) => r.text).join(' ');

const STATEMENT = ['Account statement for November Closing balance 12,480.00', 'Page two: transactions (ATM withdrawal)'];
const PAYSLIP = ['Payslip for October Net pay 42,150.00 Issued by Human Resources'];
// [file, made by, password to open (null: none), method, owner password or null, page texts, title]
const FILES = [
  ['Encrypted statement RC4-40.pdf', 'ReportLab, V1 R2', 'secret', 'RC4-40', 'owner-pw', STATEMENT, 'Account statement'],
  ['Encrypted payslip RC4-128.pdf', 'LibreOffice 24.2, V2 R3', 'secret', 'RC4-128', null, PAYSLIP, null],
  ['Restricted payslip RC4-128.pdf', 'LibreOffice 24.2, V2 R3, no printing or copying', null, 'RC4-128', null, PAYSLIP, null],
  ['Encrypted statement AES-128.pdf', 'pypdf, V4 R4 AESV2', 'secret', 'AES-128', 'owner-pw', STATEMENT, 'Account statement'],
  ['Encrypted statement AES-256 R5.pdf', 'pypdf, V5 R5 AESV3', 'secret', 'AES-256', 'owner-pw', STATEMENT, 'Account statement'],
  ['Encrypted statement AES-256.pdf', 'pypdf, V5 R6 AESV3', 'secret', 'AES-256', 'owner-pw', STATEMENT, 'Account statement'],
  ['Restricted statement AES-256.pdf', 'pypdf, V5 R6, owner password only', null, 'AES-256', 'owner-pw', STATEMENT, 'Account statement'],
];

for (const [file, maker, password, method, owner, texts, title] of FILES) {
  test(`${file} (${maker})`, () => {
    const buf = fixture(file);
    if (password) {
      assert.throws(() => readPdf(buf), (err) => err.code === 'password' && err.reason === 'needed' && NEEDED.test(err.message));
      assert.throws(() => readPdf(buf, { password: 'not it' }), (err) => err.code === 'password' && err.reason === 'wrong' && WRONG.test(err.message));
    } else {
      // No open password: it opens as it is, whatever is typed.
      assert.equal(readPdf(buf, { password: 'anything' }).pageCount, texts.length);
    }
    const doc = readPdf(buf, { password });
    assert.deepEqual(doc.encrypted, { method, hadOpenPassword: Boolean(password) });
    assert.equal(doc.pageCount, texts.length);
    assert.equal(doc.info.title, title);
    texts.forEach((t, i) => {
      assert.equal(pageText(doc, i), t, `page ${i + 1} text`);
      const page = renderPage(doc, i);
      assert.equal(page.error, undefined);
      assert.ok(page.runs.length > 0 && page.svg.includes('<text'), `page ${i + 1} draws its text`);
      assert.equal(runsText(doc, i).replace(/\s+/g, ' '), t, `page ${i + 1} runs`);
    });
    if (owner) {
      const byOwner = readPdf(buf, { password: owner });
      assert.deepEqual(byOwner.encrypted, { method, hadOpenPassword: Boolean(password) });
      assert.equal(pageText(byOwner, 0), texts[0]);
    }

    const out = copyAll(doc);
    assert.ok(!out.includes('/Encrypt'), 'the copy is not encrypted');
    const back = readPdf(out);
    assert.equal(back.encrypted, null);
    texts.forEach((t, i) => assert.equal(pageText(back, i), t, `copied page ${i + 1}`));
    if (hasPoppler) {
      const { info, text } = poppler(out);
      assert.match(info, /^Encrypted:\s+no$/m);
      assert.match(info, new RegExp(`^Pages:\\s+${texts.length}$`, 'm'));
      for (const t of texts) for (const word of t.split(' ')) assert.ok(text.includes(word), `pdftotext finds "${word}"`);
    }
  });
}

test('an open file opened with a password is simply opened; encrypted is null', () => {
  const doc = readPdf(copyAll(readPdf(fixture('Restricted payslip RC4-128.pdf'))), { password: 'secret' });
  assert.equal(doc.encrypted, null);
  assert.equal(pageText(doc, 0), PAYSLIP[0]);
});

// ---------- A file put together here ----------
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (...parts) => parts.reduce((h, p) => h.update(p), createHash('md5')).digest();
function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}
const xor = (key, i) => Buffer.from(key.map((b) => b ^ i));
const hex = (b) => `<${Buffer.from(b).toString('hex')}>`;

// The standard security handler, R4 (ISO 32000-1 algorithms 2, 3 and 5), the way a writer does it.
function securityR4({ user, owner, id, p, encryptMetadata }) {
  const pad = (s) => Buffer.concat([Buffer.from(s, 'latin1'), PAD]).subarray(0, 32);
  let h = md5(pad(owner));
  for (let i = 0; i < 50; i++) h = md5(h);
  let O = rc4(h, pad(user));
  for (let i = 1; i <= 19; i++) O = rc4(xor(h, i), O);
  const P = Buffer.alloc(4);
  P.writeInt32LE(p);
  let key = md5(pad(user), O, P, id, encryptMetadata ? Buffer.alloc(0) : Buffer.from([255, 255, 255, 255]));
  for (let i = 0; i < 50; i++) key = md5(key);
  let U = rc4(key, md5(PAD, id));
  for (let i = 1; i <= 19; i++) U = rc4(xor(key, i), U);
  return { O, U: Buffer.concat([U, Buffer.alloc(16)]), key };
}

// Two pages in an encrypted PDF 1.5: the catalog, page tree, pages and the document information
// live in an object stream (whose objects are not encrypted on their own), the table is a
// cross-reference stream (never encrypted), the metadata is left in the clear (/EncryptMetadata
// false), one content stream names the Identity crypt filter (so it is not encrypted), and the
// first page has a stamp annotation whose appearance shows "APPROVED". `cfm` is AESV2 or V2 (RC4).
function handEncrypted({ cfm = 'AESV2', user = '', owner = 'boss', brokenTable = false } = {}) {
  const id = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const { O, U, key } = securityR4({ user, owner, id, p: -3904, encryptMetadata: false });
  const aes = cfm === 'AESV2';
  const objKey = (num) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, num >> 16, 0, 0]), aes ? Buffer.from('sAlT') : Buffer.alloc(0)).subarray(0, 16);
  const enc = (num, data, { padding = true } = {}) => {
    data = Buffer.from(data, 'latin1');
    if (!aes) return rc4(objKey(num), data);
    const iv = randomBytes(16);
    const c = createCipheriv('aes-128-cbc', objKey(num), iv);
    c.setAutoPadding(padding);
    return Buffer.concat([iv, c.update(data), c.final()]);
  };

  const parts = [];
  let length = 0;
  const offsets = {};
  const push = (b) => { parts.push(b); length += b.length; };
  const text = (s) => push(Buffer.from(s, 'latin1'));
  const obj = (num, body) => { offsets[num] = length; text(`${num} 0 obj\n${body}\nendobj\n`); };
  const stream = (num, dict, data) => {
    offsets[num] = length;
    text(`${num} 0 obj\n<<${dict} /Length ${data.length}>>\nstream\n`);
    push(data);
    text('\nendstream\nendobj\n');
  };
  text('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n');
  // In the object stream (number 20): strings in the clear.
  const inStm = [
    [1, '<< /Type /Catalog /Pages 2 0 R /Metadata 9 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 400 300] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Contents [5 0 R 6 0 R] /Annots [7 0 R] >>'],
    [4, '<< /Type /Page /Parent 2 0 R /Contents 10 0 R >>'],
    [15, '(Treasury \\(head office\\))'],
  ];
  let header = '';
  let body = '';
  for (const [n, t] of inStm) { header += `${n} ${body.length} `; body += `${t}\n`; }
  stream(20, `/Type /ObjStm /N ${inStm.length} /First ${header.length} /Filter /FlateDecode`, enc(20, deflateSync(Buffer.from(header + body, 'latin1'))));
  // Top-level objects: their strings and streams are encrypted with their own key.
  stream(5, ' /Filter /FlateDecode', enc(5, deflateSync(Buffer.from('BT /F1 18 Tf 40 240 Td (Encrypted by hand) Tj ET'))));
  stream(6, ' /Filter [/Crypt /FlateDecode] /DecodeParms [<< /Name /Identity >> null]', deflateSync(Buffer.from('BT /F1 12 Tf 40 210 Td (Identity part) Tj ET')));
  obj(7, `<< /Type /Annot /Subtype /Stamp /Rect [250 20 390 60] /Contents ${hex(enc(7, 'Checked by finance'))} /AP << /N 8 0 R >> >>`);
  stream(8, ` /Type /XObject /Subtype /Form /BBox [0 0 140 40] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Filter /FlateDecode`, enc(8, deflateSync(Buffer.from('BT /F1 14 Tf 10 14 Td (APPROVED) Tj ET'))));
  stream(9, ' /Type /Metadata /Subtype /XML', Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/">plain metadata</x:xmpmeta>'));
  stream(10, '', enc(10, 'BT /F1 18 Tf 40 240 Td (Second page) Tj ET'));
  // "Quarterly report" is 16 bytes, encrypted with no padding: tolerated, the text is kept.
  obj(12, `<< /Title ${hex(enc(12, 'Quarterly report', { padding: false }))} /Author 15 0 R >>`);
  const cf = aes ? '/CFM /AESV2 /Length 16' : '/CFM /V2 /Length 16';
  obj(13, `<< /Filter /Standard /V 4 /R 4 /Length 128 /CF << /StdCF << ${cf} /AuthEvent /DocOpen >> >> /StmF /StdCF /StrF /StdCF /EncryptMetadata false /O ${hex(O)} /U ${hex(U)} /P -3904 >>`);
  // The cross-reference stream (number 14), rows /W [1 4 2].
  const at = length;
  const rows = [];
  for (let n = 0; n <= 20; n++) {
    const inside = inStm.findIndex(([m]) => m === n);
    if (n === 14) rows.push([1, at, 0]);
    else if (inside >= 0) rows.push([2, 20, inside]);
    else if (offsets[n] !== undefined) rows.push([1, offsets[n], 0]);
    else rows.push([0, 0, 0]);
  }
  const data = Buffer.concat(rows.map(([t, a, b]) => { const r = Buffer.alloc(7); r[0] = t; r.writeUInt32BE(a, 1); r.writeUInt16BE(b, 5); return r; }));
  stream(14, ` /Type /XRef /Size 21 /W [1 4 2] /Root 1 0 R /Info 12 0 R /Encrypt 13 0 R /ID [${hex(id)} ${hex(id)}] /Filter /FlateDecode`, deflateSync(data));
  text(`startxref\n${brokenTable ? 9 : at}\n%%EOF\n`);
  return Buffer.concat(parts);
}

for (const cfm of ['AESV2', 'V2']) {
  for (const brokenTable of [false, true]) {
    test(`by hand, ${cfm === 'V2' ? 'RC4' : 'AES'}-128 (V4 R4)${brokenTable ? ', table rebuilt' : ''}: object and xref streams, clear metadata, an Identity stream, an annotation`, () => {
      const buf = handEncrypted({ cfm, brokenTable });
      const doc = readPdf(buf);
      assert.deepEqual(doc.encrypted, { method: cfm === 'V2' ? 'RC4-128' : 'AES-128', hadOpenPassword: false });
      assert.equal(doc.pageCount, 2);
      assert.deepEqual(doc.pages[0], { width: 400, height: 300, rotate: 0 });
      assert.equal(doc.info.title, 'Quarterly report');
      assert.equal(doc.info.author, 'Treasury (head office)', 'strings inside an object stream are not decrypted again');
      assert.equal(pageText(doc, 0), 'Encrypted by hand Identity part');
      assert.equal(pageText(doc, 1), 'Second page');

      const { src } = pageInternals(doc, 0);
      const meta = src.resolve(src.catalog().Metadata);
      assert.match(meta.raw.toString('latin1'), /plain metadata/, '/EncryptMetadata false: the metadata was left as it is');
      const identity = src.resolve(src.pages[0].dict.Contents[1]);
      assert.equal(identity.dict.Filter.length, 1, 'the Crypt filter is taken out once applied');
      assert.equal(identity.dict.Filter[0].v, 'FlateDecode');
      const annot = src.resolve(src.pages[0].dict.Annots[0]);
      assert.equal(annot.Contents.b.toString('latin1'), 'Checked by finance');

      // Read again and again (text, drawing, copying), the objects are the same ones, decrypted once.
      assert.equal(src.resolve(src.pages[0].dict.Annots[0]), annot);
      assert.equal(pageText(doc, 0), 'Encrypted by hand Identity part');
      const runs = renderPage(doc, 0).runs.map((r) => r.text);
      assert.deepEqual(runs, ['Encrypted by hand', 'Identity part', 'APPROVED']);
      assert.equal(pageAnnotations(doc, 0).length, 1);
      const out = copyAll(doc);
      assert.equal(src.resolve(src.pages[0].dict.Annots[0]), annot);
      assert.deepEqual(renderPage(doc, 0).runs.map((r) => r.text), runs);
      assert.ok(!out.includes('/Encrypt') && !out.includes('/Crypt'), 'the copy has neither the encryption nor the crypt filter');
      const back = readPdf(out);
      assert.equal(back.encrypted, null);
      assert.equal(pageText(back, 1), 'Second page');
      assert.deepEqual(renderPage(back, 0).runs.map((r) => r.text), runs, 'the stamp is drawn into the copied page');
      if (hasPoppler) {
        const { info, text } = poppler(out);
        assert.match(info, /^Encrypted:\s+no$/m);
        for (const t of ['Encrypted by hand', 'Identity part', 'APPROVED', 'Second page']) assert.ok(text.includes(t), `pdftotext finds "${t}"`);
      }
    });
  }
}

test('by hand, with an open password: none, wrong, the user password, the owner password', () => {
  const buf = handEncrypted({ user: 'open sesame', owner: 'boss' });
  assert.throws(() => readPdf(buf), (err) => err.code === 'password' && NEEDED.test(err.message));
  assert.throws(() => readPdf(buf, { password: '' }), (err) => err.code === 'password' && NEEDED.test(err.message));
  assert.throws(() => readPdf(buf, { password: 'open' }), (err) => err.code === 'password' && WRONG.test(err.message));
  for (const password of ['open sesame', 'boss']) {
    const doc = readPdf(buf, { password });
    assert.deepEqual(doc.encrypted, { method: 'AES-128', hadOpenPassword: true });
    assert.equal(pageText(doc, 1), 'Second page');
  }
  // The rebuilt table asks for the password the same way.
  const broken = handEncrypted({ user: 'open sesame', brokenTable: true });
  assert.throws(() => readPdf(broken), (err) => err.code === 'password' && NEEDED.test(err.message));
  assert.equal(pageText(readPdf(broken, { password: 'open sesame' }), 0), 'Encrypted by hand Identity part');
});

test('security CORE cannot open gets a plain refusal, whatever the password', () => {
  const buf = handEncrypted().toString('latin1');
  const variants = {
    'a certificate (public-key) handler': buf.replace('/Filter /Standard /V 4 /R 4', '/Filter /Adobe.PubSec /SubFilter /adbe.pkcs7.s5 /V 4 /R 4'),
    'an unknown crypt filter method': buf.replace('/CFM /AESV2', '/CFM /Rot13'),
    'an unknown version': buf.replace('/V 4 /R 4', '/V 3 /R 4'),
    'an unknown revision': buf.replace('/V 4 /R 4', '/V 4 /R 7'),
    'no /O or /U': buf.replace(/\/O <[0-9a-f]+>/, ''),
    'an /Encrypt that is not a dictionary': buf.replace('/Encrypt 13 0 R', '/Encrypt 99 0 R'),
  };
  for (const [label, v] of Object.entries(variants)) {
    for (const password of [undefined, 'boss']) {
      assert.throws(() => readPdf(Buffer.from(v, 'latin1'), { password }), (err) => err.code === 'encrypted' && UNSUPPORTED.test(err.message), label);
    }
  }
});
