// PDF Studio (0.66): files of up to 100 MB in pieces, and more kinds of file. Uploads in pieces
// (in order, a piece sent again, a lost place, a file larger than it said, nobody else's upload,
// idle uploads swept), a ZIP of files added one by one, code, data, e-mail and e-book files, a
// large export written to disk and sent from there, and the limits that keep a small server safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import zlib from 'node:zlib';
import { pdfSchool } from './support/pdf-api.js';
import { crc32 } from '../server/zip.js';
import { FileReply } from '../server/tools-pdf.js';
import { PdfWriter, name, ref } from '../server/pdf/writer.js';
import { readPdf, pageText } from '../server/pdf/reader.js';
import { zipFiles } from '../server/zip.js';
import { epubToDoc, emlToDoc, codeToDoc } from '../server/pdf/office-extra.js';
import { PDF_LIMITS } from '../shared/pdf-studio.js';

// A ZIP with folders (ATLAS's own zipFiles flattens names), its parts stored as they are.
function zipWithPaths(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.buffer); // not zlib.crc32: Node 18 and early 22 do not have it
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(f.buffer.length, 18); head.writeUInt32LE(f.buffer.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(f.buffer.length, 20); cd.writeUInt32LE(f.buffer.length, 24); cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, f.buffer);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + f.buffer.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cdBuf, end]);
}

const SCAN = fs.readFileSync(new URL('../scripts/fixtures/Scanned acceptance NSU-2025-118.pdf', import.meta.url));
const JPEG = fs.readFileSync(new URL('../scripts/fixtures/profile-sample.jpg', import.meta.url));
const MB = 1024 * 1024;

// A PDF of about `mb` megabytes: one page holding a picture of random bytes (stored, not packed).
function bigPdf(mb) {
  const w = new PdfWriter({ title: 'Big' });
  const side = Math.ceil(Math.sqrt((mb * MB) / 3));
  const img = w.stream({ Type: name('XObject'), Subtype: name('Image'), Width: side, Height: side, ColorSpace: name('DeviceRGB'), BitsPerComponent: 8 }, randomBytes(side * side * 3), { compress: false });
  const content = w.stream({}, Buffer.from('q 500 0 0 500 50 150 cm /Im1 Do Q BT /F1 24 Tf 60 100 Td (Big file) Tj ET'));
  w.addPage({ MediaBox: [0, 0, 600, 800], Resources: { Font: { F1: w.font('Helvetica') }, XObject: { Im1: ref(img) } }, Contents: ref(content) });
  return w;
}

const { dir, handle, as, done } = await pdfSchool('atlas-pdf-uploads-');
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
  return true;
});
const people = { rey: await as('teacher.demo'), lia: await as('registrar.demo') };
const rey = async (m, u, b) => (await people.rey(m, u, b)).data;
const lia = async (m, u, b) => (await people.lia(m, u, b)).data;

// The browser's way: start, pieces of `size`, finish.
async function send(who, fileName, buf, { size = PDF_LIMITS.chunkBytes, layout } = {}) {
  const { id, chunkBytes } = await who('POST', '/api/tools/pdf/uploads', { name: fileName, size: buf.length });
  assert.equal(chunkBytes, PDF_LIMITS.chunkBytes);
  for (let at = 0; at < buf.length; at += size) await who('PUT', `/api/tools/pdf/uploads/${id}`, { offset: at, data: buf.subarray(at, at + size).toString('base64') });
  return who('POST', `/api/tools/pdf/uploads/${id}/finish`, { layout });
}

test('uploads in pieces: in order, a piece sent again, a lost place, nobody else\'s upload', async () => {
  const r = await send(rey, 'scan.pdf', SCAN, { size: 7000 });
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0].kind, 'pdf');
  assert.equal(handle.pdfStudio.uploads.size, 0, 'the upload is gone once it is a file');

  const { id } = await rey('POST', '/api/tools/pdf/uploads', { name: 'photo.jpg', size: JPEG.length });
  const half = Math.floor(JPEG.length / 2);
  assert.equal((await rey('PUT', `/api/tools/pdf/uploads/${id}`, { offset: 0, data: JPEG.subarray(0, half).toString('base64') })).received, half);
  // The same piece again (its answer was lost): accepted, nothing added.
  assert.equal((await rey('PUT', `/api/tools/pdf/uploads/${id}`, { offset: 0, data: JPEG.subarray(0, half).toString('base64') })).received, half);
  await fails(rey('PUT', `/api/tools/pdf/uploads/${id}`, { offset: half + 10, data: 'AAAA' }), 409, /lost its place/);
  await fails(lia('PUT', `/api/tools/pdf/uploads/${id}`, { offset: half, data: 'AAAA' }), 404);
  await fails(lia('POST', `/api/tools/pdf/uploads/${id}/finish`, {}), 404);
  await fails(rey('POST', `/api/tools/pdf/uploads/${id}/finish`, {}), 400, /did not arrive whole/);
  await fails(rey('PUT', `/api/tools/pdf/uploads/${id}`, { offset: half, data: Buffer.concat([JPEG.subarray(half), Buffer.alloc(30)]).toString('base64') }), 400, /larger than it said/);
  await rey('PUT', `/api/tools/pdf/uploads/${id}`, { offset: half, data: JPEG.subarray(half).toString('base64') });
  const pic = await rey('POST', `/api/tools/pdf/uploads/${id}/finish`, {});
  assert.equal(pic.sources[0].kind, 'image');

  // Refused before anything is sent: too large, empty; a piece too large.
  await fails(rey('POST', '/api/tools/pdf/uploads', { name: 'huge.pdf', size: PDF_LIMITS.maxFileBytes + 1 }), 400, /larger than 100 MB/);
  await fails(rey('POST', '/api/tools/pdf/uploads', { name: 'none.pdf', size: 0 }), 400, /empty/);
  const up = await rey('POST', '/api/tools/pdf/uploads', { name: 'x.pdf', size: 10 });
  await fails(rey('PUT', `/api/tools/pdf/uploads/${up.id}`, { offset: 0, data: Buffer.alloc(PDF_LIMITS.chunkBytes + 1).toString('base64') }), 400, /pieces of up to 4 MB/);
  // Stopped, and swept when idle.
  await rey('DELETE', `/api/tools/pdf/uploads/${up.id}`);
  assert.equal(handle.pdfStudio.uploads.size, 0);
  const idle = await rey('POST', '/api/tools/pdf/uploads', { name: 'y.pdf', size: 10 });
  handle.pdfStudio.uploads.get(idle.id).usedAt = Date.now() - 31 * 60 * 1000;
  handle.pdfStudio.sweep();
  await fails(rey('PUT', `/api/tools/pdf/uploads/${idle.id}`, { offset: 0, data: 'AAAA' }), 404, /no longer on the server/);
  await rey('DELETE', '/api/tools/pdf/sources');
});

test('a ZIP of files: each one PDF Studio takes is added, in name order; the rest are named', async () => {
  const zip = zipFiles([
    { name: 'b-notes.md', buffer: Buffer.from('# Notes\n\nText.') },
    { name: 'a-scan.pdf', buffer: SCAN },
    { name: '__MACOSX/._a-scan.pdf', buffer: Buffer.from('junk') },
    { name: 'setup.exe', buffer: Buffer.from('MZ\x90\x00program') },
    { name: 'c-query.sql', buffer: Buffer.from('SELECT name\n  FROM staff;\n') },
  ]);
  const r = await send(rey, 'bundle.zip', zip);
  assert.deepEqual(r.sources.map((s) => [s.name, s.format]), [['a-scan.pdf', 'pdf'], ['b-notes.md', 'md'], ['c-query.sql', 'code']]);
  assert.match(r.notes.join(' '), /From bundle\.zip, not added: setup\.exe/);
  await fails(send(rey, 'empty.zip', zipFiles([{ name: 'tool.exe', buffer: Buffer.from('MZ') }])), 400, /holds no files PDF Studio takes/);
  // The older one-request way gives the first file, and the others with it.
  const old = (await people.rey('POST', '/api/tools/pdf/sources', { file: { name: 'bundle.zip', data: zip.toString('base64') } })).data;
  assert.equal(old.name, 'a-scan.pdf');
  assert.equal(old.more.length, 2);
  await rey('DELETE', '/api/tools/pdf/sources');
});

test('code, data, e-mail and e-book files become readable pages', async () => {
  const json = codeToDoc(Buffer.from(JSON.stringify({ name: 'Ana', items: [1, 2, 3], nested: { ok: true } })), { fileName: 'export.json' });
  assert.equal(json.blocks[0].type, 'code');
  assert.match(json.blocks[0].text, /\n {2}"name": "Ana"/, 'one-line JSON laid out');
  const long = codeToDoc(Buffer.from('x'.repeat(1000)), { fileName: 'a.log' });
  assert.match(long.warnings.join(' '), /shortened to 400 characters/);

  const mail = [
    'From: =?utf-8?B?Sm9zw6kgUml6YWw=?= <jose@example.ph>', 'To: hr@example.ph', 'Subject: =?utf-8?Q?Leave_request_=E2=80=93_June?=', 'Date: Mon, 1 Jun 2026 09:00:00 +0800',
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="XX"', '', '--XX', 'Content-Type: multipart/related; boundary="YY"', '', '--YY',
    'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', '<p>Good morning, I would like to file leave =E2=80=94 see <b>photo</b>.</p><img src=3D"cid:pic1">', '--YY',
    'Content-Type: image/jpeg', 'Content-ID: <pic1>', 'Content-Transfer-Encoding: base64', '', JPEG.toString('base64').replace(/.{76}/g, '$&\r\n'), '--YY--',
    '--XX', 'Content-Type: application/pdf; name="form.pdf"', 'Content-Disposition: attachment; filename="form.pdf"', 'Content-Transfer-Encoding: base64', '', SCAN.subarray(0, 300).toString('base64'), '--XX--', '',
  ].join('\r\n');
  const m = emlToDoc(Buffer.from(mail, 'utf8'), { fileName: 'leave.eml' });
  assert.equal(m.title, 'Leave request – June');
  assert.deepEqual(m.blocks[1].rows.map((r) => r.cells[1].runs[0].text), ['José Rizal <jose@example.ph>', 'hr@example.ph', 'Mon, 1 Jun 2026 09:00:00 +0800']);
  assert.ok(m.blocks.some((b) => b.type === 'image'), 'the picture in the message');
  assert.ok(m.blocks.some((b) => b.type === 'paragraph' && b.runs.some((r) => /form\.pdf/.test(r.text))), 'the attachment named');
  assert.match(m.warnings.join(' '), /named, not included/);

  const epub = zipWithPaths([
    { name: 'mimetype', buffer: Buffer.from('application/epub+zip') },
    { name: 'META-INF/container.xml', buffer: Buffer.from('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>') },
    { name: 'OEBPS/book.opf', buffer: Buffer.from('<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Company Handbook</dc:title></metadata><manifest><item id="c2" href="text/two.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/><item id="p" href="img/logo.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>') },
    { name: 'OEBPS/text/one.xhtml', buffer: Buffer.from('<html><head><title>One</title></head><body><h1>Welcome</h1><p>First chapter.</p><img src="../img/logo.jpg"/></body></html>') },
    { name: 'OEBPS/text/two.xhtml', buffer: Buffer.from('<html><body><h1>Leave</h1><p>Second chapter.</p></body></html>') },
    { name: 'OEBPS/img/logo.jpg', buffer: JPEG },
  ]);
  const book = epubToDoc(epub, { fileName: 'handbook.epub' });
  assert.equal(book.title, 'Company Handbook');
  const heads = book.blocks.filter((b) => b.type === 'heading').map((b) => b.runs.map((r) => r.text).join(''));
  assert.deepEqual(heads, ['Welcome', 'Leave'], 'chapters in reading order');
  assert.ok(book.blocks.some((b) => b.type === 'image'), 'the picture inside the book');
  assert.ok(book.blocks.some((b) => b.type === 'pagebreak'), 'each chapter on a new page');

  const r = await send(rey, 'handbook.epub', epub);
  assert.equal(r.sources[0].format, 'epub');
  assert.equal(r.sources[0].title, 'Company Handbook');
  const e = await send(rey, 'leave.eml', Buffer.from(mail));
  assert.equal(e.sources[0].format, 'eml');
  await rey('DELETE', '/api/tools/pdf/sources');
});

test('a 30 MB PDF: sent in pieces, exported from disk, read whole again', async () => {
  const w = bigPdf(30);
  const big = w.toBuffer();
  assert.ok(big.length > 30 * MB);
  const r = await send(rey, 'big.pdf', big);
  const s = r.sources[0];
  assert.equal(s.size, big.length);
  const res = await people.rey('POST', '/api/tools/pdf/export', { pages: [{ source: s.id, page: 0 }], fileName: 'Big copy' });
  assert.ok(res.data instanceof FileReply, 'a large export is a file on disk');
  const out = res.data.read();
  assert.ok(out.length > 30 * MB);
  const doc = readPdf(out);
  assert.equal(doc.pageCount, 1);
  assert.match(pageText(doc, 0), /Big file/);
  fs.rmSync(res.data.path, { force: true });
  // Too much for one export: refused with a way out.
  const before = PDF_LIMITS.maxExportBytes;
  handle.pdfStudio.sources.get(s.id).stored = before + 1;
  await fails(rey('POST', '/api/tools/pdf/export', { pages: [{ source: s.id, page: 0 }] }), 400, /more than one export takes/);
  await rey('DELETE', '/api/tools/pdf/sources');
});

test('writer: written to a file piece by piece, the same bytes as in memory', () => {
  const w = bigPdf(1);
  const file = path.join(dir, 'w.pdf');
  const { size, sha256 } = w.writeTo(file);
  const disk = fs.readFileSync(file);
  assert.equal(size, disk.length);
  assert.match(sha256, /^[0-9a-f]{64}$/);
  assert.equal(readPdf(disk).pageCount, 1);
});

test('a protected PDF: its password asked for, tried again, never kept; a restricted one just opens', async () => {
  const locked = fs.readFileSync(new URL('../scripts/fixtures/Encrypted statement AES-256.pdf', import.meta.url));
  const { id } = await rey('POST', '/api/tools/pdf/uploads', { name: 'statement.pdf', size: locked.length });
  await rey('PUT', `/api/tools/pdf/uploads/${id}`, { offset: 0, data: locked.toString('base64') });
  const ask = await rey('POST', `/api/tools/pdf/uploads/${id}/finish`, {});
  assert.deepEqual([ask.needsPassword, ask.wrongPassword], [true, false]);
  assert.match(ask.error, /needs a password/);
  const wrong = await rey('POST', `/api/tools/pdf/uploads/${id}/finish`, { password: 'nope' });
  assert.deepEqual([wrong.needsPassword, wrong.wrongPassword], [true, true]);
  const ok = await rey('POST', `/api/tools/pdf/uploads/${id}/finish`, { password: 'secret' });
  const s = ok.sources[0];
  assert.match(s.warnings.join(' '), /was protected/);
  assert.equal(handle.pdfStudio.uploads.size, 0);
  // Kept as a plain copy: read again (no password), drawn and exported.
  const src = handle.pdfStudio.sources.get(s.id);
  src.doc = null;
  const svg = (await people.rey('GET', `/api/tools/pdf/sources/${s.id}/pages/0/text`)).data;
  assert.ok(svg.runs.length > 0);
  const out = (await people.rey('POST', '/api/tools/pdf/export', { pages: [{ source: s.id, page: 0 }] })).data;
  assert.equal(readPdf(out).encrypted, null, 'the export is not protected');
  assert.ok(!JSON.stringify(src).includes('secret'), 'the password is not kept');

  const restricted = fs.readFileSync(new URL('../scripts/fixtures/Restricted statement AES-256.pdf', import.meta.url));
  const r = await send(rey, 'restricted.pdf', restricted);
  assert.equal(r.sources[0].kind, 'pdf', 'no password asked for');
  await rey('DELETE', '/api/tools/pdf/sources');
});

test('a TIFF scan of two A4 pages (fax compression) becomes two A4 pages, shown, not grey', async () => {
  const tif = fs.readFileSync(new URL('../scripts/fixtures/tiff/scan-a4-2pages-g4.tif', import.meta.url));
  const r = await send(rey, 'scan.tif', tif);
  const s = r.sources[0];
  assert.deepEqual([s.format, s.kind, s.pages.length], ['tiff', 'image', 2]);
  assert.equal(s.pages[0].thumb, false, 'a fax page is drawn, not shown as the TIFF (browsers cannot show TIFF)');
  assert.ok(Math.abs(s.pages[0].width - 595.28) < 2 && Math.abs(s.pages[0].height - 841.89) < 2, `A4 from its resolution: ${s.pages[0].width} × ${s.pages[0].height}`);
  const svg = (await people.rey('GET', `/api/tools/pdf/sources/${s.id}/pages/0/svg`)).data.toString('utf8');
  assert.match(svg, /data:image\/png;base64,/);
  assert.doesNotMatch(svg, /#d9d9d9/);
  await rey('DELETE', '/api/tools/pdf/sources');
});

test('Word, Excel and PowerPoint 97–2003 and RTF files are taken, by what they hold', async () => {
  const fx = (f) => fs.readFileSync(new URL(`../scripts/fixtures/${f}`, import.meta.url));
  for (const [file, format, name] of [['Project proposal KMC.doc', 'doc', 'proposal.doc'], ['Equipment budget.xls', 'xls', 'budget.xls'], ['Quarterly review.ppt', 'ppt', 'review.ppt'], ['Project proposal KMC.rtf', 'rtf', 'proposal.rtf'], ['Project proposal KMC.doc', 'doc', 'renamed.docx']]) {
    const r = await send(rey, name, fx(file));
    assert.equal(r.sources[0].format, format, name);
    assert.ok(r.sources[0].pages.length >= 1, name);
  }
  const deck = (await rey('GET', '/api/tools/pdf')).sources.find((s) => s.format === 'ppt');
  assert.ok(deck.pages.every((p) => p.width > p.height), 'slides on landscape pages');
  await rey('DELETE', '/api/tools/pdf/sources');
});

test('done', () => done());
