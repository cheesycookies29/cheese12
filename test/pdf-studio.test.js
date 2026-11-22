// PDF Studio (0.64): the PDF writer (text in the standard fonts, objects, the file), pictures (JPEG
// as is, PNG unpacked with its transparency), the layout of documents on pages, the export (pages
// copied, turned, stamped upright, split into a ZIP), and the API: who sees which files, what is
// taken and refused, limits, and the tool being off for the company.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { encodeWinAnsi, textWidth, serialize, name, ref, str, bytes, PdfWriter, Content, FONTS } from '../server/pdf/writer.js';
import { decodePng, jpegInfo, embedImage } from '../server/pdf/images.js';
import { docToPdf, imageToPdf, pageGeometry } from '../server/pdf/layout.js';
import { buildPdf, fillIn } from '../server/pdf/build.js';
import { readPdf } from '../server/pdf/reader.js';
import { formatOf, cleanLayout, cleanStamp, safeFileName } from '../server/tools-pdf.js';
import { zipFiles } from '../server/zip.js';
import { TOOLS, SWITCHABLE, moduleOfApi } from '../shared/modules.js';

const JPEG = fs.readFileSync(new URL('../scripts/fixtures/profile-sample.jpg', import.meta.url));
const SCAN = fs.readFileSync(new URL('../scripts/fixtures/Scanned acceptance NSU-2025-118.pdf', import.meta.url));
// A small PNG: width × height RGBA, the left half see-through.
function png(width, height, { alpha = true, color = 6 } = {}) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ch = color === 6 ? 4 : 3;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * ch);
    row[0] = y % 2 ? 2 : 1; // Up and Sub filters
    rows.push(row);
  }
  // Pixels, then filtered: we write raw values with filter 0 for simplicity of the expected values.
  const raw = Buffer.concat(Array.from({ length: height }, (_, y) => {
    const row = Buffer.alloc(1 + width * ch);
    for (let x = 0; x < width; x++) {
      row[1 + x * ch] = 200;
      row[2 + x * ch] = 40 + y;
      row[3 + x * ch] = 10;
      if (ch === 4) row[4 + x * ch] = alpha && x < width / 2 ? 0 : 255;
    }
    return row;
  }));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = color;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Every content stream of a PDF, decompressed, as text (to find what was drawn).
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

test('writer: text in WinAnsi, widths, objects, a file that reads back', () => {
  assert.deepEqual([...encodeWinAnsi('Niño “quoted” – ₱5 €')], [...Buffer.from('Ni\xf1o \x93quoted\x94 \x96 PHP 5 \x80', 'latin1')]);
  assert.equal(encodeWinAnsi('Ş ő 中 Đ').toString('latin1'), 'S o ? ?', 'letters without their accent; others "?"');
  assert.equal(Math.round(textWidth('Hello', FONTS.regular, 10) * 1000) / 1000, 22.78, 'H 722 + e 556 + l 222 × 2 + o 556 = 2278');
  assert.ok(textWidth('Hello', FONTS.bold, 10) > textWidth('Hello', FONTS.regular, 10));
  assert.equal(textWidth('abc', FONTS.mono, 10), 18);
  assert.equal(serialize({ Type: name('Page'), Kids: [ref(3), 1.5, -0, true, null], T: str('Año'), U: str('Ωmega'), B: bytes(Buffer.from('a(b)\\')) }),
    '<</Type /Page /Kids [3 0 R 1.5 0 true null] /T (A\\361o) /U <FEFF03A9006D006500670061> /B (a\\(b\\)\\\\)>>');
  assert.equal(serialize(name('A B#')), '/A#20B#23');
  const w = new PdfWriter({ title: 'Test “title”' });
  const c = new Content().text(72, 700, 'Hello (world)', FONTS.bold, 14);
  w.addContentPage(c, [595.28, 841.89]);
  const pdf = w.toBuffer();
  assert.match(pdf.subarray(0, 9).toString(), /^%PDF-1\.7/);
  assert.match(pdf.toString('latin1'), /startxref\n\d+\n%%EOF\n$/);
  const doc = readPdf(pdf);
  assert.equal(doc.pageCount, 1);
  assert.equal(Math.round(doc.pages[0].width), 595);
  assert.equal(doc.info.title, 'Test “title”');
  assert.match(drawn(pdf), /\/F2 14 Tf 72 700 Td \(Hello \\\(world\\\)\) Tj/);
});

test('pictures: a JPEG as it is; a PNG unpacked, with its transparency as a mask', () => {
  const j = jpegInfo(JPEG);
  assert.ok(j.width > 0 && j.height > 0 && j.components === 3);
  const p = decodePng(png(4, 3));
  assert.equal(p.channels, 3);
  assert.deepEqual([...p.pixels.subarray(0, 3)], [200, 40, 10]);
  assert.deepEqual([...p.alpha], [0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  assert.equal(decodePng(png(4, 3, { alpha: false })).alpha, null, 'opaque: no mask');
  assert.equal(decodePng(png(3, 2, { color: 2 })).alpha, null);
  assert.throws(() => decodePng(Buffer.from('not a png at all, really not, no')), /not a PNG/);
  const w = new PdfWriter();
  const img = embedImage(w, png(4, 3));
  const xo = w.objects[img.id];
  assert.equal(xo.dict.Width, 4);
  assert.ok(xo.dict.SMask, 'soft mask');
  assert.throws(() => embedImage(new PdfWriter(), Buffer.from('GIF89a......')), /Only JPEG and PNG/);
});

test('layout: page geometry; a long table goes on over pages with its header; pictures fit', () => {
  const g = pageGeometry({ size: 'a4', orientation: 'auto', margin: 20 }, true);
  assert.ok(g.width > g.height, 'landscape when the document prefers it');
  assert.equal(Math.round(g.margin), 57);
  const rows = [{ header: true, cells: [{ runs: [{ text: 'Name' }] }, { runs: [{ text: 'Amount' }] }] }];
  for (let i = 0; i < 120; i++) rows.push({ cells: [{ runs: [{ text: `Row ${i} with some words to wrap around the cell` }] }, { runs: [{ text: `₱${i}.00` }], align: 'right' }] });
  const out = docToPdf({ title: 'Report', blocks: [{ type: 'heading', level: 1, runs: [{ text: 'Report' }] }, { type: 'table', rows }, { type: 'pagebreak' }, { type: 'image', data: JPEG, width: 2000, height: 2000 }] }, { size: 'a4', margin: 15 });
  assert.ok(out.pages >= 4, `pages: ${out.pages}`);
  assert.equal(out.captions[0], 'Report');
  assert.ok(out.captions.slice(1, -1).every((c) => c.startsWith('Name Amount')), 'the header row on each page of the table');
  const text = drawn(out.pdf);
  assert.ok((text.match(/\(Amount\) Tj/g) || []).length >= 3);
  assert.match(text, /\(PHP 119.00\) Tj/);
  const doc = readPdf(out.pdf);
  assert.equal(doc.pageCount, out.pages);
  // A picture on its page: fitted within the margins.
  const im = imageToPdf(JPEG, { size: 'letter', orientation: 'portrait', margin: 10, fit: 'fit' });
  assert.equal(readPdf(im.pdf).pages[0].width, 612);
  assert.equal(imageToPdf(JPEG, { size: 'auto', margin: 0 }).pages, 1);
  assert.equal(readPdf(imageToPdf(png(400, 200), { size: 'a4', orientation: 'auto' }).pdf).pages[0].width > 800, true, 'a wide picture: landscape');
});

test('export: pages copied in order, turned, stamped upright, split', () => {
  const a = readPdf(docToPdf({ blocks: [{ type: 'paragraph', runs: [{ text: 'First document' }] }, { type: 'pagebreak' }, { type: 'paragraph', runs: [{ text: 'Second page' }] }] }).pdf);
  const b = readPdf(imageToPdf(JPEG, {}).pdf);
  const scan = readPdf(SCAN);
  const pages = [{ doc: a, index: 1, rotate: 0 }, { doc: b, index: 0, rotate: 90 }, { doc: a, index: 0, rotate: 270 }, { blank: { width: 595.28, height: 841.89 } }, { doc: scan, index: 0, rotate: 180 }];
  const stamp = cleanStamp({ numbers: { format: 'of', position: 'bottom-right', start: 1, skipFirst: true }, header: '{title} · {page}/{pages}', footer: 'Confidential', watermark: { text: 'DRAFT', opacity: 0.2, color: 'red' } });
  const pdf = buildPdf(pages, stamp, { title: 'Bundle' });
  const out = readPdf(pdf);
  assert.equal(out.pageCount, 5);
  assert.deepEqual(out.pages.map((p) => p.rotate), [0, 90, 270, 0, (scan.pages[0].rotate + 180) % 360]);
  assert.equal(out.info.title, 'Bundle');
  const text = drawn(pdf);
  assert.match(text, /\(Page 1 of 4\) Tj/, 'the cover is not numbered: page 2 is "Page 1 of 4"');
  assert.match(text, /\(Page 4 of 4\) Tj/);
  assert.doesNotMatch(text, /Page 5 of/);
  assert.match(text, /\/CoreF2 \d+(\.\d+)? Tf/, 'the stamps\' fonts have names of their own');
  assert.match(text, /\(DRAFT\) Tj/);
  assert.match(text, /\(Bundle \\267 2\/4\) Tj/, 'the header with {title} and {page}/{pages} filled in');
  // A turned page: the stamps are drawn through a turning matrix.
  assert.match(text, /0 1 -1 0 [\d.]+ [\d.]+ cm/);
  // Split: one per page.
  assert.equal(fillIn('{page} of {pages} – {file}', { page: 2, pages: 9, file: 'x.pdf' }), '2 of 9 – x.pdf');
});

test('tools-pdf helpers: what a file is, clean options, safe names', () => {
  assert.equal(formatOf(SCAN, 'x.bin'), 'pdf');
  assert.equal(formatOf(JPEG, 'photo'), 'image');
  assert.equal(formatOf(Buffer.from('# Title\nText'), 'notes.md'), 'md');
  assert.equal(formatOf(Buffer.from('a,b\n1,2'), 'data.CSV'), 'csv');
  assert.equal(formatOf(Buffer.from('MZ\x90\x00 program'), 'setup.exe'), null);
  assert.equal(formatOf(Buffer.from('text\x00with nul'), 'x.txt'), null);
  assert.equal(formatOf(zipFiles([{ name: 'a.txt', buffer: Buffer.from('x') }]), 'archive.docx'), null, 'a ZIP that is not an Office file');
  assert.deepEqual(cleanLayout({ size: 'tabloid', orientation: 'sideways', margin: 99, fontSize: 3, fit: 'zoom' }), { size: 'a4', orientation: 'auto', margin: 40, fontSize: 8, fit: 'fit' });
  assert.ok(!safeFileName('../../etc/passwd').includes('/'));
  assert.equal(safeFileName('Q3 report.pdf'), 'Q3 report.pdf');
  assert.equal(safeFileName('', 'document', 'zip'), 'document.zip');
  assert.deepEqual(cleanStamp({ numbers: { format: 'roman', position: 'middle', start: -4 }, header: '  ', watermark: { text: 'x'.repeat(100), opacity: 9 } }),
    { numbers: { format: 'of', position: 'bottom-center', start: 1, skipFirst: false }, watermark: { text: 'x'.repeat(60), opacity: 0.6, color: 'gray' } });
  assert.deepEqual(TOOLS.map((t) => t.id), ['pdf']);
  assert.ok(SWITCHABLE.includes('pdf'));
  assert.equal(moduleOfApi('POST', '/api/tools/pdf/export'), 'pdf');
});

// ----- The API -----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pdf-studio-'));
const db = openDb(path.join(dir, 'db.json'));
const handle = createApi(db);
const client = () => {
  let cookie = '';
  const c = async (method, url, body = {}) => {
    const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.4' } }, new URL(url, 'http://localhost'), body);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res;
  };
  return c;
};
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
  return true;
});
const admin = client();
await admin('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'Correct-Horse-42' });
const users = {};
for (const [username, role] of [['sam', 'sales'], ['ivy', 'it']]) {
  await admin('POST', '/api/users', { name: username, username, role, password: 'Correct-Horse-42', mustChangePassword: false });
  users[username] = client();
  await users[username]('POST', '/api/auth/login', { username, password: 'Correct-Horse-42' });
}
const sam = async (m, u, b) => (await users.sam(m, u, b)).data;
const ivy = async (m, u, b) => (await users.ivy(m, u, b)).data;
const upload = (who, name, buf, layout) => who('POST', '/api/tools/pdf/sources', { file: { name, type: '', data: buf.toString('base64') }, layout });

test('API: upload documents, pictures and PDFs; arrange and export; each person sees only their own', async () => {
  const md = await upload(sam, 'notes.md', Buffer.from('# Weekly notes\n\nSome **bold** text.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'));
  assert.equal(md.kind, 'doc');
  assert.equal(md.format, 'md');
  assert.equal(md.title, 'Weekly notes');
  assert.ok(md.pages.length >= 1 && md.pages[0].caption.startsWith('Weekly notes'));
  const pic = await upload(sam, 'photo.jpg', JPEG);
  assert.equal(pic.kind, 'image');
  assert.equal(pic.pages[0].thumb, true);
  const scan = await upload(sam, 'scan.pdf', SCAN);
  assert.equal(scan.kind, 'pdf');
  assert.ok(scan.pages.length >= 1);
  const csv = await upload(sam, 'data.csv', Buffer.from('Item,Qty\nPens,3\nPaper,10\n'));
  assert.equal(csv.format, 'csv');
  // Refused: a program, an empty file, too large.
  await fails(upload(sam, 'setup.exe', Buffer.from('MZ program')), 400, /cannot turn setup\.exe into a PDF/);
  await fails(sam('POST', '/api/tools/pdf/sources', { file: { name: 'x.pdf', data: '' } }), 400, /x.pdf is empty/);
  // Another person sees nothing of Sam's.
  assert.deepEqual((await ivy('GET', '/api/tools/pdf')).sources, []);
  await fails(ivy('POST', '/api/tools/pdf/export', { pages: [{ source: md.id, page: 0 }] }), 404, /no longer in PDF Studio/);
  await fails(users.ivy('GET', `/api/tools/pdf/sources/${pic.id}/pages/0/thumb`), 404);
  // Sam's thumbnail of the picture: the picture, sent as an image only.
  const thumb = await users.sam('GET', `/api/tools/pdf/sources/${pic.id}/pages/0/thumb`);
  assert.equal(thumb.headers['Content-Type'], 'image/jpeg');
  assert.match(thumb.headers['Content-Security-Policy'], /sandbox/);
  // Layout again: Letter, landscape.
  const again = await sam('POST', `/api/tools/pdf/sources/${md.id}/layout`, { layout: { size: 'letter', orientation: 'landscape' } });
  assert.equal(Math.round(again.pages[0].width), 792);
  await fails(sam('POST', `/api/tools/pdf/sources/${scan.id}/layout`, { layout: {} }), 400, /keeps its own pages/);
  // Export one PDF with page numbers.
  const pages = [{ source: pic.id, page: 0, rotate: 90 }, { source: md.id, page: 0 }, { blank: true, size: 'a4' }, { source: scan.id, page: 0 }, { source: csv.id, page: 0 }];
  const res = await users.sam('POST', '/api/tools/pdf/export', { pages, stamp: { numbers: { format: 'n' } }, meta: { title: 'Bundle' }, fileName: 'My bundle' });
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.match(res.headers['Content-Disposition'], /filename="My bundle\.pdf"/);
  const out = readPdf(res.data);
  assert.equal(out.pageCount, 5);
  assert.equal(out.pages[0].rotate, 90);
  // Split: a ZIP with one PDF per file.
  const zip = await users.sam('POST', '/api/tools/pdf/export', { pages, split: 'documents', fileName: 'parts' });
  assert.equal(zip.headers['Content-Type'], 'application/zip');
  assert.match(zip.data.toString('latin1'), /photo\.pdf[\s\S]*notes\.pdf[\s\S]*scan\.pdf[\s\S]*data\.pdf/);
  const perPage = await users.sam('POST', '/api/tools/pdf/export', { pages, split: 'pages', fileName: 'p' });
  assert.equal((perPage.data.toString('latin1').match(/p - page \d\.pdf/g) || []).length >= 5, true);
  // Bad requests.
  await fails(sam('POST', '/api/tools/pdf/export', { pages: [] }), 400, /at least one page/);
  await fails(sam('POST', '/api/tools/pdf/export', { pages: [{ source: md.id, page: 99 }] }), 400, /not in notes\.md/);
  await fails(sam('POST', '/api/tools/pdf/export', { pages: [{ source: md.id, page: 0, rotate: 45 }] }), 400, /90/);
  // The export is in the audit log, without its contents.
  const log = fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8');
  assert.match(log, /tools\.pdf-export[^\n]*5 pages from 4 files/);
  assert.doesNotMatch(log, /Weekly notes/);
  assert.doesNotMatch(log, /tools\/pdf\/sources/, 'uploads are not logged');
  // Remove one; start over.
  await sam('DELETE', `/api/tools/pdf/sources/${csv.id}`);
  assert.equal((await sam('GET', '/api/tools/pdf')).sources.length, 3);
  assert.deepEqual(await sam('DELETE', '/api/tools/pdf/sources'), { removed: 3 });
  assert.equal(fs.readdirSync(path.join(dir, 'pdf-studio')).length, 0, 'their files are gone from the server');
});

test('API: files unused for hours are swept; the tool off for the company is refused (administrators still open it)', async () => {
  const s = await upload(sam, 'a.txt', Buffer.from('hello'));
  const src = handle.pdfStudio.sources.get(s.id);
  src.usedAt = Date.now() - 5 * 3600 * 1000;
  handle.pdfStudio.sweep();
  assert.equal(handle.pdfStudio.sources.size, 0);
  await admin('PUT', '/api/admin/modules', { modules: { pdf: false } });
  await fails(sam('GET', '/api/tools/pdf'), 403);
  assert.ok((await admin('GET', '/api/tools/pdf')).data.sources);
  await admin('PUT', '/api/admin/modules', { modules: { pdf: true } });
  assert.ok(await sam('GET', '/api/tools/pdf'));
  handle.monitor.stop();
});
