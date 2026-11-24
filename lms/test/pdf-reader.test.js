// PDF Studio (0.64): reading PDFs and copying their pages into a new one. Files are made with
// PdfWriter, or put together by hand for what the writer never writes (cross-reference and object
// streams, incremental updates, nested page trees, broken tables), then read back; pages copied
// into a new PDF are read back again, and the new file's table and references are checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deflateSync } from 'node:zlib';
import { readPdf, importPages, pageJpeg, pageText } from '../server/pdf/reader.js';
import { PdfWriter, Content, FONTS, PAGE_SIZES, Stream, Ref, name, serialize } from '../server/pdf/writer.js';

const fixture = (f) => fs.readFileSync(new URL(`../scripts/fixtures/${f}`, import.meta.url));
const photo = fixture('profile-sample.jpg');
const ENCRYPTED = /protected with a certificate or a kind of encryption ATLAS cannot open\. Open it in a PDF viewer, save an unprotected copy, and upload that\./;

// A PDF put together object by object, keeping each object's offset for the tables.
class HandPdf {
  constructor(version = '1.5') {
    this.parts = [];
    this.length = 0;
    this.offsets = {};
    this.text(`%PDF-${version}\n%\xe2\xe3\xcf\xd3\n`);
  }
  push(buf) { this.parts.push(buf); this.length += buf.length; return this; }
  text(s) { return this.push(Buffer.from(s, 'latin1')); }
  obj(num, body) {
    this.offsets[num] = this.length;
    return this.text(`${num} 0 obj\n${body}\nendobj\n`);
  }
  stream(num, dict, data, { length = data.length } = {}) {
    this.offsets[num] = this.length;
    this.text(`${num} 0 obj\n<<${dict} /Length ${length}>>\nstream\n`).push(Buffer.from(data, 'latin1'));
    return this.text('\nendstream\nendobj\n');
  }
  // Objects inside an object stream: [[number, body], …].
  objStm(num, objects) {
    let header = '';
    let body = '';
    for (const [n, text] of objects) {
      header += `${n} ${body.length} `;
      body += `${text}\n`;
    }
    const data = deflateSync(Buffer.from(header + body, 'latin1'));
    return this.stream(num, `/Type /ObjStm /N ${objects.length} /First ${header.length} /Filter /FlateDecode`, data);
  }
  // A classic table of every object written, the trailer, startxref and %%EOF.
  table(trailer, { size } = {}) {
    const at = this.length;
    const max = size || Math.max(...Object.keys(this.offsets).map(Number)) + 1;
    let s = `xref\n0 ${max}\n0000000000 65535 f \n`;
    for (let n = 1; n < max; n++) s += this.offsets[n] === undefined ? '0000000000 00000 f \n' : `${String(this.offsets[n]).padStart(10, '0')} 00000 n \n`;
    this.text(`${s}trailer\n<<${trailer} /Size ${max}>>\nstartxref\n${at}\n%%EOF\n`);
    return at;
  }
  // A cross-reference stream (object `num`) with rows [type, field2, field3] for objects 0…size-1,
  // /W [1 2 1], deflated, with the PNG Up predictor when asked.
  xrefStream(num, rows, trailer, { predictor = false, index = null, startxref = true } = {}) {
    const at = this.length;
    rows = { ...rows, [num]: [1, at, 0] };
    const nums = Object.keys(rows).map(Number);
    const size = Math.max(...nums) + 1;
    const list = index || [0, size];
    const raw = [];
    for (let s = 0; s < list.length; s += 2) {
      for (let n = list[s]; n < list[s] + list[s + 1]; n++) {
        const [t, f2, f3] = rows[n] || [0, 0, 0];
        raw.push([t, (f2 >> 8) & 255, f2 & 255, f3]);
      }
    }
    let data;
    let parms = '';
    if (predictor) {
      // Each row: filter byte 2 (Up), then the difference from the row above.
      data = Buffer.from(raw.flatMap((row, i) => [2, ...row.map((b, k) => (b - (i ? raw[i - 1][k] : 0)) & 255)]));
      parms = ' /DecodeParms << /Predictor 12 /Columns 4 >>';
    } else data = Buffer.from(raw.flat());
    this.stream(num, `/Type /XRef /Size ${size} /W [1 2 1] /Index [${list.join(' ')}] /Filter /FlateDecode${parms} ${trailer}`, deflateSync(data));
    if (startxref) this.text(`startxref\n${at}\n%%EOF\n`);
    return at;
  }
  buffer() { return Buffer.concat(this.parts); }
}

// A file from PdfWriter: three pages of text, of different sizes and turns.
function writerPdf({ title = 'Café report', author = 'Łukasz Nowak', pages = 3 } = {}) {
  const w = new PdfWriter({ title, author });
  const sizes = [PAGE_SIZES.a4, PAGE_SIZES.letter, [300, 500]];
  for (let i = 0; i < pages; i++) {
    const c = new Content().text(72, 400, `Hello page ${i + 1}`, FONTS.regular, 12).text(72, 380, 'Second line (with parens)', FONTS.bold, 10);
    w.addContentPage(c, sizes[i % 3], { rotate: [0, 90, 180][i % 3] });
  }
  return { w, buf: w.toBuffer() };
}

// Copies pages into a new PdfWriter and returns its file.
function copyInto(doc, indexes) {
  const w = new PdfWriter({ title: 'Merged' });
  for (const dict of importPages(doc, w, indexes)) w.addPage(dict);
  return { w, buf: w.toBuffer() };
}

// The new file, checked the way a strict reader would: every table entry points at its object,
// no object was left unset, and every reference outside stream data names an object in the table.
function checkStructure(buf) {
  const text = buf.toString('latin1');
  const at = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)[1]);
  assert.equal(text.slice(at, at + 4), 'xref');
  const [, count] = /^xref\n0 (\d+)\n/.exec(text.slice(at)).map(Number);
  const entries = text.slice(at).split('\n').slice(3, 2 + count);
  entries.forEach((line, i) => {
    const offset = Number(line.slice(0, 10));
    assert.equal(text.slice(offset, offset + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} is where the table says`);
    assert.ok(!text.startsWith(`${i + 1} 0 obj\nnull\n`, offset), `object ${i + 1} was set`);
  });
  const outside = text.replace(/stream\n[\s\S]*?\nendstream/g, '');
  for (const m of outside.matchAll(/(\d+) 0 R/g)) assert.ok(Number(m[1]) >= 1 && Number(m[1]) < count, `reference ${m[0]} is in the table`);
  assert.match(text.slice(at), /trailer\n<<\/Size \d+ \/Root \d+ 0 R/);
}

test('a PDF from PdfWriter reads back: pages, sizes, turns, title, author, version, text', () => {
  const { buf } = writerPdf();
  const doc = readPdf(buf);
  assert.equal(doc.pageCount, 3);
  assert.deepEqual(doc.pages, [{ width: 595.28, height: 841.89, rotate: 0 }, { width: 612, height: 792, rotate: 90 }, { width: 300, height: 500, rotate: 180 }]);
  assert.deepEqual(doc.info, { title: 'Café report', author: 'Łukasz Nowak' });
  assert.equal(doc.version, '1.7');
  assert.equal(pageText(doc, 0), 'Hello page 1 Second line (with parens)');
  assert.equal(pageText(doc, 2, 12), 'Hello page 3');
  assert.equal(pageText(doc, 99), '');
  assert.equal(pageJpeg(doc, 0), null);
});

test('copied pages make a valid new PDF: same sizes and turns, streams copied byte for byte, shared objects once', () => {
  const { w: source, buf } = writerPdf();
  const doc = readPdf(buf);
  const { w, buf: out } = copyInto(doc, [2, 0, 0, 1]);
  checkStructure(out);
  const back = readPdf(out);
  assert.equal(back.pageCount, 4);
  assert.deepEqual(back.pages, [doc.pages[2], doc.pages[0], doc.pages[0], doc.pages[1]]);
  assert.equal(pageText(back, 1), pageText(doc, 0));
  assert.equal(back.info.title, 'Merged');

  // The page dictionaries: no Type or Parent of their own, inherited attributes on the page,
  // the same page twice sharing its content stream; and /Length left to the writer.
  const dicts = w.pages.map((id) => w.objects[id]);
  assert.ok(dicts.every((d) => d.Contents instanceof Ref && d.Resources && d.MediaBox));
  assert.equal(dicts[1].Contents.n, dicts[2].Contents.n);
  assert.notEqual(dicts[0].Contents.n, dicts[1].Contents.n);
  assert.equal(dicts[3].Rotate, 90);
  const copied = w.objects[dicts[1].Contents.n];
  assert.ok(copied instanceof Stream);
  assert.equal(copied.dict.Length, undefined);
  const original = source.objects[source.objects[source.pages[0]].Contents.n];
  assert.ok(copied.data.equals(original.data), 'the compressed bytes are copied as they are');
  assert.equal(serialize(copied.dict.Filter), '/FlateDecode');

  // The fonts are shared by all pages: each is copied once, also across calls with the same writer.
  const fonts = () => w.objects.filter((o) => o && o.Type && o.Type.v === 'Font').length;
  const before = fonts();
  assert.equal(before, 2);
  const again = importPages(doc, w, [0]);
  assert.equal(fonts(), before);
  assert.equal(again[0].Contents.n, dicts[1].Contents.n);
  assert.equal(again[0].Type, undefined);
  assert.equal(again[0].Parent, undefined);
  // Another writer gets its own copies.
  const other = new PdfWriter();
  const [fresh] = importPages(doc, other, [0]);
  assert.ok(other.objects[fresh.Contents.n] instanceof Stream);
});

test('pages from several PDFs merge into one', () => {
  const a = readPdf(writerPdf({ pages: 2 }).buf);
  const b = readPdf(fixture('Scanned acceptance NSU-2025-118.pdf'));
  const w = new PdfWriter();
  for (const d of importPages(a, w, [1])) w.addPage(d);
  for (const d of importPages(b, w, [0])) w.addPage(d);
  for (const d of importPages(a, w, [0])) w.addPage(d);
  const out = w.toBuffer();
  checkStructure(out);
  const back = readPdf(out);
  assert.deepEqual(back.pages.map((p) => [p.width, p.height, p.rotate]), [[612, 792, 90], [620, 800, 0], [595.28, 841.89, 0]]);
  assert.ok(pageJpeg(back, 1).equals(pageJpeg(b, 0)), 'the scan is copied unchanged');
  assert.equal(pageText(back, 2), 'Hello page 1 Second line (with parens)');
});

// A PDF 1.5 file whose table is a cross-reference stream and whose catalog, page tree, pages,
// resources and font sit in an object stream.
function xrefStreamPdf({ predictor = false } = {}) {
  const pdf = new HandPdf('1.5');
  pdf.stream(5, ' /Filter /FlateDecode', deflateSync(Buffer.from('BT /F1 12 Tf 72 600 Td (Stream one) Tj ET')));
  pdf.stream(7, '', 'BT /F1 12 Tf 72 300 Td (Second page) Tj ET', { length: '9 0 R' });
  pdf.obj(9, '43');
  pdf.objStm(10, [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 500 700] >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources 6 0 R /Contents 5 0 R >>'],
    [4, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Rotate 270 /Resources 6 0 R /Contents [7 0 R] >>'],
    [6, '<< /Font << /F1 8 0 R >> >>'],
    [8, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
  ]);
  const rows = { 0: [0, 0, 255] };
  [1, 2, 3, 4, 6, 8].forEach((n, i) => { rows[n] = [2, 10, i]; });
  for (const n of [5, 7, 9, 10]) rows[n] = [1, pdf.offsets[n], 0];
  pdf.xrefStream(11, rows, '/Root 1 0 R', { predictor });
  return pdf.buffer();
}

for (const predictor of [false, true]) {
  test(`a cross-reference stream${predictor ? ' with the PNG Up predictor' : ''} and an object stream`, () => {
    const doc = readPdf(xrefStreamPdf({ predictor }));
    assert.equal(doc.pageCount, 2);
    assert.deepEqual(doc.pages, [{ width: 500, height: 700, rotate: 0 }, { width: 300, height: 400, rotate: 270 }]);
    assert.equal(doc.version, '1.5');
    assert.equal(pageText(doc, 0), 'Stream one');
    assert.equal(pageText(doc, 1), 'Second page', 'a stream whose /Length is another object');
    const { w, buf } = copyInto(doc, [1, 0]);
    checkStructure(buf);
    const back = readPdf(buf);
    assert.deepEqual(back.pages, [doc.pages[1], doc.pages[0]]);
    assert.equal(pageText(back, 0), 'Second page');
    assert.equal(pageText(back, 1), 'Stream one');
    // The page's own array of contents stays an array of (renumbered) references.
    const first = w.objects[w.pages[0]];
    assert.ok(Array.isArray(first.Contents) && first.Contents[0] instanceof Ref);
    assert.equal(w.objects[first.Contents[0].n].dict.Length, undefined);
  });
}

test('a hybrid file: a classic table plus /XRefStm for the objects in object streams', () => {
  const pdf = new HandPdf('1.5');
  pdf.stream(5, ' /Filter /FlateDecode', deflateSync(Buffer.from('BT /F1 12 Tf 72 600 Td (Hybrid) Tj ET')));
  pdf.objStm(10, [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'],
    [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'],
  ]);
  const stmAt = pdf.xrefStream(11, { 1: [2, 10, 0], 2: [2, 10, 1], 3: [2, 10, 2], 4: [2, 10, 3] }, '', { index: [1, 4], startxref: false });
  // The table lists the objects in the object stream as free, as hybrid files do.
  pdf.table(`/Root 1 0 R /XRefStm ${stmAt}`, { size: 12 });
  const doc = readPdf(pdf.buffer());
  assert.deepEqual(doc.pages, [{ width: 420, height: 595, rotate: 0 }]);
  assert.equal(pageText(doc, 0), 'Hybrid');
});

test('an incremental update: the later revision wins, and a /Prev loop is harmless', () => {
  const { w, buf } = writerPdf({ title: 'First title' });
  const prev = Number(/startxref\n(\d+)/.exec(buf.toString('latin1'))[1]);
  const pageId = w.pages[1];
  const page = { ...w.objects[pageId], MediaBox: [0, 0, 200, 300], Rotate: 0 };
  const infoId = w.objects.length - 1; // the writer's Info object was added last
  const parts = [buf];
  let length = buf.length;
  const add = (s) => { parts.push(Buffer.from(s, 'latin1')); length += Buffer.byteLength(s, 'latin1'); };
  const pageAt = length;
  add(`${pageId} 0 obj\n${serialize(page)}\nendobj\n`);
  const infoAt = length;
  add(`${infoId} 0 obj\n<< /Title (Second title) >>\nendobj\n`);
  const xrefAt = length;
  add(`xref\n${pageId} 1\n${String(pageAt).padStart(10, '0')} 00000 n\r\n${infoId} 1\n${String(infoAt).padStart(10, '0')} 00000 n\n`);
  add(`trailer\n<< /Size ${infoId + 1} /Root ${w.catalog} 0 R /Info ${infoId} 0 R /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  const updated = Buffer.concat(parts);
  const doc = readPdf(updated);
  assert.equal(doc.pageCount, 3);
  assert.deepEqual(doc.pages[1], { width: 200, height: 300, rotate: 0 });
  assert.deepEqual(doc.pages[0], { width: 595.28, height: 841.89, rotate: 0 });
  assert.equal(doc.info.title, 'Second title');
  assert.equal(doc.info.author, null, 'the newer Info object replaces the older one whole');

  // A revision whose /Prev points at itself.
  const looped = Buffer.from(updated.toString('latin1').replace(`/Prev ${prev}`, `/Prev ${xrefAt}`), 'latin1');
  const doc2 = readPdf(looped);
  assert.equal(doc2.pageCount, 3, 'objects the newer table does not list are found in the file');
  assert.deepEqual(doc2.pages[1], { width: 200, height: 300, rotate: 0 });
});

// A page tree two levels deep, attributes inherited from either level, a cycle back to the root,
// annotations and structure that must not be copied.
function nestedTreePdf() {
  const pdf = new HandPdf('1.4');
  pdf.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  pdf.obj(2, '<< /Type /Pages /MediaBox [0 0 600 800] /Resources 10 0 R /Rotate 90 /Kids [3 0 R 6 0 R 2 0 R 3 0 R] /Count 99 >>');
  pdf.obj(3, '<< /Type /Pages /Parent 2 0 R /Rotate 180 /Kids [4 0 R 5 0 R] /Count 2 >>');
  pdf.obj(4, '<< /Type /Page /Parent 3 0 R /Contents 11 0 R >>');
  pdf.obj(5, '<< /Type /Page /Parent 3 0 R /MediaBox [0 0 100 200] /CropBox [10 10 90 150] /Rotate 0 /Contents 11 0 R /Resources << /Font << /F1 13 0 R >> >> >>');
  pdf.obj(6, '<< /Type /Page /Parent 2 0 R /Contents 11 0 R /Annots [12 0 R] /StructParents 3 /AA << /O 14 0 R >> /Group << /S /Transparency /CS /DeviceRGB >> /UserUnit 2 >>');
  pdf.obj(10, '<< /Font << /F1 13 0 R >> /ProcSet [/PDF /Text] >>');
  pdf.stream(11, '', 'BT /F1 9 Tf 10 20 Td (Nested) Tj ET');
  pdf.obj(12, '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /P 6 0 R >>');
  pdf.obj(13, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');
  pdf.obj(14, '<< /S /JavaScript /JS (app.alert\\(1\\)) >>');
  pdf.table('/Root 1 0 R');
  return pdf.buffer();
}

test('a nested page tree: depth first, inherited Resources, MediaBox and Rotate, CropBox, cycles cut off', () => {
  const doc = readPdf(nestedTreePdf());
  assert.equal(doc.pageCount, 3, '/Count is not trusted, and the loop back to the root is not followed');
  assert.deepEqual(doc.pages, [{ width: 600, height: 800, rotate: 180 }, { width: 80, height: 140, rotate: 0 }, { width: 600, height: 800, rotate: 90 }]);
  assert.equal(pageText(doc, 0), 'Nested');

  const w = new PdfWriter();
  const [last, first, second] = importPages(doc, w, [2, 0, 1]);
  assert.deepEqual(last.MediaBox, [0, 0, 600, 800]);
  assert.equal(last.Rotate, 90);
  assert.equal(first.Rotate, 180);
  assert.equal(second.Rotate, undefined);
  assert.deepEqual(second.CropBox, [10, 10, 90, 150]);
  assert.ok(last.Resources instanceof Ref && last.Resources.n === first.Resources.n, 'the inherited resources are one object');
  assert.equal(serialize(second.Resources.Font.F1), serialize(w.objects[last.Resources.n].Font.F1), 'the font is copied once');
  for (const key of ['Annots', 'StructParents', 'AA', 'Parent', 'Type']) assert.equal(last[key], undefined, key);
  assert.equal(last.UserUnit, 2);
  assert.equal(serialize(last.Group), '<</S /Transparency /CS /DeviceRGB>>');
  const all = w.objects.map((o) => (o instanceof Stream ? serialize(o.dict) : serialize(o))).join(' ');
  assert.doesNotMatch(all, /Annot|JavaScript/);
  for (const d of [last, first, second]) w.addPage(d);
  const out = w.toBuffer();
  checkStructure(out);
  assert.deepEqual(readPdf(out).pages, [doc.pages[2], doc.pages[0], doc.pages[1]]);
});

test('the lexer: numbers, names with #xx, strings with escapes, hex strings, comments, a wrong /Length', () => {
  const pdf = new HandPdf('1.4');
  pdf.obj(1, '<< /Type /Catalog % a comment\n /Pages 2 0 R >>');
  pdf.obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>');
  pdf.obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [ -.5 +0 611.5 792. ] /Rotate -90 /Resources << /Font << /Te#20st 4 0 R >> >> /Contents 5 0 R /Extra [true false null (a\\)b) <41 4> /N#41me] >>');
  pdf.obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pdf.stream(5, '', 'BT /Te#20st 10 Tf 1 0 0 1 72 700 Tm [(Hel) -20 (lo) -400 (world)] TJ 0 -14 Td (nested (parens) ok) Tj (\\101\\102) \' ET', { length: 5 });
  pdf.obj(6, '<< /Title (Line\\nTwo \\(x\\) \\\\ \\101\\\ncont) /Author <FEFF00C9006C00E8006E0065> >>');
  pdf.table('/Root 1 0 R /Info 6 0 R');
  const doc = readPdf(pdf.buffer());
  assert.deepEqual(doc.pages, [{ width: 612, height: 792, rotate: 270 }]);
  assert.equal(doc.info.title, 'Line\nTwo (x) \\ Acont');
  assert.equal(doc.info.author, 'Élène');
  assert.equal(pageText(doc, 0), 'Hello world nested (parens) ok AB');
  const w = new PdfWriter();
  const [page] = importPages(doc, w, [0]);
  assert.ok(page.Resources.Font['Te st'] instanceof Ref);
  assert.equal(serialize(page.Extra), '[true false null (a\\)b) (A@) /NAme]');
  assert.match(serialize(page.Resources), /\/Te#20st \d+ 0 R/);
  const content = w.objects[page.Contents.n];
  assert.match(content.data.toString('latin1'), /^BT .* ET$/, 'the whole stream despite its wrong /Length');
});

test('a broken startxref, a missing table, junk around the file: the table is rebuilt', () => {
  const { buf } = writerPdf();
  const text = buf.toString('latin1');
  const variants = {
    'wrong startxref': text.replace(/startxref\n\d+/, 'startxref\n12'),
    'startxref past the end': text.replace(/startxref\n\d+/, 'startxref\n99999999'),
    'no table at all': text.slice(0, text.indexOf('xref\n0 ')),
    'offsets all shifted': text.replace('%PDF-1.7\n', '%PDF-1.7\n% an extra line added by a careless tool\n'),
    'junk before and after': `JUNK\r\n${text}${'\0'.repeat(3000)}`,
  };
  for (const [label, v] of Object.entries(variants)) {
    const doc = readPdf(Buffer.from(v, 'latin1'));
    assert.equal(doc.pageCount, 3, label);
    assert.deepEqual(doc.pages[1], { width: 612, height: 792, rotate: 90 }, label);
    assert.equal(pageText(doc, 0), 'Hello page 1 Second line (with parens)', label);
    checkStructure(copyInto(doc, [0, 1, 2]).buf);
  }
  // A cross-reference stream file whose startxref is wrong: the XRef stream gives /Root, and the
  // object stream gives the objects inside it.
  const xs = xrefStreamPdf({ predictor: true }).toString('latin1');
  const doc = readPdf(Buffer.from(xs.replace(/startxref\n\d+/, 'startxref\n3'), 'latin1'));
  assert.equal(doc.pageCount, 2);
  assert.equal(pageText(doc, 1), 'Second page');
});

test('encrypted, not a PDF, damaged, too big: plain-English errors', () => {
  const { buf } = writerPdf();
  // Encryption ATLAS cannot open: a broken standard dictionary, a certificate (public-key) handler.
  // Files it can open (with or without a password) are in pdf-encrypted.test.js.
  const encrypted = Buffer.from(buf.toString('latin1').replace('trailer\n<<', 'trailer\n<</Encrypt <</Filter /Standard /V 2>> '), 'latin1');
  assert.throws(() => readPdf(encrypted), (err) => err.code === 'encrypted' && ENCRYPTED.test(err.message));
  const pubSec = Buffer.from(buf.toString('latin1').replace('trailer\n<<', 'trailer\n<</Encrypt <</Filter /Adobe.PubSec /SubFilter /adbe.pkcs7.s5 /V 4 /R 4>> '), 'latin1');
  assert.throws(() => readPdf(pubSec, { password: 'anything' }), (err) => err.code === 'encrypted' && ENCRYPTED.test(err.message));
  // Also when the table must be rebuilt first.
  const noTable = encrypted.toString('latin1').replace(/startxref\n\d+/, 'startxref\n1');
  assert.throws(() => readPdf(Buffer.from(noTable, 'latin1')), ENCRYPTED);
  assert.throws(() => readPdf(Buffer.from('PK\x03\x04 not a pdf')), /This file is not a PDF\./);
  assert.throws(() => readPdf(Buffer.alloc(0)), /not a PDF/);
  assert.throws(() => readPdf(Buffer.from('%PDF-1.4\nnothing useful here\n%%EOF\n')), /This PDF is damaged and cannot be read\./);
  assert.throws(() => readPdf(buf.subarray(0, 40)), /damaged/);
  assert.throws(() => readPdf(buf, { maxPages: 2 }), /more than 2 pages/);
  assert.throws(() => readPdf(buf, { maxObjects: 5 }), /too complex to open here/);
  assert.equal(readPdf(new Uint8Array(buf)).pageCount, 3, 'a Uint8Array is fine too');
});

test('damaged objects resolve to nothing rather than crash', () => {
  const pdf = new HandPdf('1.4');
  pdf.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  pdf.obj(2, '<< /Type /Pages /Kids [3 0 R 4 0 R 99 0 R 5 0 R] >>');
  pdf.obj(3, '<< /Type /Page /MediaBox [0 0 100 100] /Contents 6 0 R /Resources << /XObject << /X 7 0 R >> /Font 8 0 R >> >>');
  pdf.obj(4, '<< /Type /Page /MediaBox 9 0 R /Contents [6 0 R 10 0 R] >>');
  pdf.obj(5, '[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[');
  pdf.stream(6, ' /Filter /FlateDecode', Buffer.from('not zlib at all'));
  pdf.obj(7, '<< /Unclosed [1 2');
  pdf.obj(8, 'garbage )) >> ]');
  pdf.obj(9, '[0 0 (a) 50]');
  pdf.obj(10, '<< /Length 3 >>');
  pdf.table('/Root 1 0 R');
  const doc = readPdf(pdf.buffer());
  assert.equal(doc.pageCount, 2);
  assert.deepEqual(doc.pages[1], { width: 612, height: 792, rotate: 0 }, 'a MediaBox that is not one: US Letter');
  assert.equal(pageText(doc, 0), '');
  assert.equal(pageJpeg(doc, 0), null);
  const { buf } = copyInto(doc, [0, 1]);
  checkStructure(buf);
  assert.equal(readPdf(buf).pageCount, 2);
});

test('captions: ToUnicode maps, Type0 fonts without one, forms, inline images', () => {
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '2 beginbfchar <0001> <0048> <0002> <00E9> endbfchar',
    '1 beginbfrange <0010> <0012> <0061> endbfrange',
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  const pdf = new HandPdf('1.4');
  pdf.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  pdf.obj(2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /MediaBox [0 0 200 200] >>');
  pdf.obj(3, '<< /Type /Page /Resources << /Font << /M 5 0 R /G 6 0 R /S 7 0 R >> /XObject << /Fm 9 0 R >> >> /Contents 8 0 R >>');
  pdf.obj(4, '<< /Type /Page /Resources << /Font << /G 6 0 R >> >> /Contents 11 0 R >>');
  pdf.obj(5, '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /BaseFont /ABC+Font /ToUnicode 10 0 R >>');
  pdf.obj(6, '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /BaseFont /DEF+Font >>');
  pdf.obj(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pdf.stream(8, '', 'BT /M 12 Tf <000100020010001100120099> Tj /G 12 Tf <00330044> Tj /S 9 Tf (\x92ok\x92) Tj ET BI /W 2 /H 2 /BPC 8 /CS /G ID \x00(Tj)\x01\xff EI /Fm Do');
  pdf.stream(9, ' /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /Font << /S 7 0 R >> >>', 'BT /S 8 Tf (in a form) Tj ET');
  pdf.stream(10, '', cmap);
  pdf.stream(11, '', 'BT /G 12 Tf <00330044> Tj ET');
  pdf.table('/Root 1 0 R');
  const doc = readPdf(pdf.buffer());
  assert.equal(pageText(doc, 0), 'Héabc’ok’ in a form');
  assert.equal(pageText(doc, 0, 4), 'Héab');
  assert.equal(pageText(doc, 1), '', 'glyph numbers without a map are not text');
});

test('pageJpeg: the picture of a scanned page, null otherwise', () => {
  const w = new PdfWriter();
  const img = w.stream({ Type: name('XObject'), Subtype: name('Image'), Width: 640, Height: 480, ColorSpace: name('DeviceRGB'), BitsPerComponent: 8, Filter: name('DCTDecode') }, photo);
  w.addContentPage(new Content().image('Im1', 0, 0, 640, 480), [640, 480], { images: { Im1: img } });
  // A scan wrapped in a form XObject, as some scanners write it.
  const form = w.add(new Stream({ Type: name('XObject'), Subtype: name('Form'), BBox: [0, 0, 1, 1], Resources: { XObject: { Im0: new Ref(img) } } }, Buffer.from('q /Im0 Do Q')));
  w.addPage({ MediaBox: [0, 0, 640, 480], Resources: { XObject: { Fx: new Ref(form) } }, Contents: new Ref(w.stream({}, '/Fx Do')) });
  // Two pictures: not a scan.
  w.addPage({ MediaBox: [0, 0, 640, 480], Resources: { XObject: { A: new Ref(img), B: new Ref(img) } }, Contents: new Ref(w.stream({}, '/A Do /B Do')) });
  // A picture that is not a JPEG.
  const flat = w.stream({ Type: name('XObject'), Subtype: name('Image'), Width: 1, Height: 1, ColorSpace: name('DeviceGray'), BitsPerComponent: 8 }, Buffer.alloc(1));
  w.addPage({ MediaBox: [0, 0, 10, 10], Resources: { XObject: { I: new Ref(flat) } }, Contents: new Ref(w.stream({}, '/I Do')) });
  const doc = readPdf(w.toBuffer());
  assert.ok(pageJpeg(doc, 0).equals(photo));
  assert.ok(pageJpeg(doc, 1).equals(photo));
  assert.equal(pageJpeg(doc, 2), null);
  assert.equal(pageJpeg(doc, 3), null);
  assert.equal(pageJpeg(doc, 9), null);
  // The JPEG survives a copy unchanged.
  const back = readPdf(copyInto(doc, [1, 0]).buf);
  assert.ok(pageJpeg(back, 0).equals(photo) && pageJpeg(back, 1).equals(photo));
});

test('the fixtures: a scanned acceptance and a signed contract', () => {
  const scan = readPdf(fixture('Scanned acceptance NSU-2025-118.pdf'));
  assert.ok(scan.pageCount > 0);
  assert.deepEqual(scan.pages[0], { width: 620, height: 800, rotate: 0 });
  const jpeg = pageJpeg(scan, 0);
  assert.ok(jpeg && jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[2] === 0xff);
  assert.equal(jpeg.length, 28599);
  assert.equal(pageText(scan, 0), '');
  const { buf } = copyInto(scan, [0]);
  checkStructure(buf);
  assert.deepEqual(readPdf(buf).pages, scan.pages);

  // The signed contract fixture is a stand-in: a catalog and an empty page tree, with no table and
  // no startxref. It is read through a rebuilt table, and has no pages.
  const signed = readPdf(fixture('Signed contract NSU-2025-118.pdf'));
  assert.equal(signed.pageCount, 0);
  assert.equal(signed.version, '1.4');
});

test('a 20 MB PDF of 500 pages reads quickly', () => {
  const w = new PdfWriter();
  const noise = Buffer.alloc(100 * 133 * 3);
  for (let i = 0; i < 500; i++) {
    for (let k = 0; k < noise.length; k += 4) noise.writeUInt32LE((i * 2654435761 + k * 40503) >>> 0, k);
    const img = w.stream({ Type: name('XObject'), Subtype: name('Image'), Width: 100, Height: 133, ColorSpace: name('DeviceRGB'), BitsPerComponent: 8 }, noise, { compress: false });
    w.addContentPage(new Content().image('Im1', 0, 0, 100, 133).text(10, 10, `Page ${i + 1}`), [100, 133], { images: { Im1: img } });
  }
  const buf = w.toBuffer();
  assert.ok(buf.length > 19 * 1024 * 1024);
  let t = process.hrtime.bigint();
  const doc = readPdf(buf);
  const readMs = Number(process.hrtime.bigint() - t) / 1e6;
  assert.equal(doc.pageCount, 500);
  assert.equal(pageText(doc, 499), 'Page 500');
  t = process.hrtime.bigint();
  const out = copyInto(doc, doc.pages.map((_, i) => 499 - i)).buf;
  const copyMs = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(readMs < 1500, `read in ${readMs} ms`);
  assert.ok(copyMs < 3000, `copied in ${copyMs} ms`);
  const back = readPdf(out);
  assert.equal(back.pageCount, 500);
  assert.equal(pageText(back, 0), 'Page 500');
});
