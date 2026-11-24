// PDF Studio (0.66): the older Office formats (.doc, .xls, .ppt), Rich Text (.rtf) and Outlook messages
// (.msg) turned into the block model the PDF layout draws. Real files made by LibreOffice are in
// scripts/fixtures/; smaller ones are built here (compound files with test/support/cfb-writer.js) to
// reach the corners: pieces of 8-bit and 16-bit text, strings split across CONTINUE records, damaged
// and looping sector chains, passwords.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toBlocks as convert, KINDS, sniffCompound, isRtf } from '../server/pdf/office.js';
import { readCfb, isCompound } from '../server/pdf/office-cfb.js';
import { decompressRtf } from '../server/pdf/office-msg.js';
import { writeCfb } from './support/cfb-writer.js';

const fixture = (name) => readFileSync(new URL(`../scripts/fixtures/${name}`, import.meta.url));

// The shapes the layout engine expects (as in pdf-office.test.js).
const KEYS = {
  heading: ['type', 'level', 'runs'], paragraph: ['type', 'runs', 'align', 'indent'], list: ['type', 'ordered', 'start', 'items'],
  table: ['type', 'rows', 'widths'], image: ['type', 'data', 'mime', 'width', 'height', 'alt'], code: ['type', 'text'], rule: ['type'], pagebreak: ['type'],
};
function checkRuns(runs, where) {
  assert.ok(Array.isArray(runs), where);
  for (const run of runs) {
    for (const [k, v] of Object.entries(run)) {
      assert.ok(['text', 'bold', 'italic', 'underline', 'mono', 'size', 'link', 'color'].includes(k), `${where}: run key ${k}`);
      if (['bold', 'italic', 'underline', 'mono'].includes(k)) assert.equal(v, true, `${where}: ${k}`);
    }
    assert.equal(typeof run.text, 'string');
    assert.ok(run.text.length > 0, `${where}: empty run`);
    if ('link' in run) assert.match(run.link, /^(https?:|mailto:)/);
    if ('color' in run) assert.ok(run.color.length === 3 && run.color.every((c) => c >= 0 && c <= 1));
  }
}
function validate(res) {
  assert.deepEqual(Object.keys(res).sort(), ['blocks', 'landscape', 'title', 'warnings']);
  res.blocks.forEach((b, i) => {
    const where = `block ${i} (${b.type})`;
    assert.ok(KEYS[b.type], where);
    for (const [k, v] of Object.entries(b)) {
      assert.ok(KEYS[b.type].includes(k), `${where}: key ${k}`);
      assert.notEqual(v, undefined, `${where}: ${k} is undefined`);
    }
    if (b.type === 'heading') assert.ok([1, 2, 3, 4].includes(b.level));
    if (b.runs) checkRuns(b.runs, where);
    if (b.type === 'list') b.items.forEach((it) => checkRuns(it.runs, where));
    if (b.type === 'table') b.rows.forEach((row) => row.cells.forEach((c) => {
      for (const k of Object.keys(c)) assert.ok(['runs', 'colspan', 'align'].includes(k), `${where}: cell key ${k}`);
      checkRuns(c.runs, where);
    }));
    if (b.type === 'image') assert.ok(Buffer.isBuffer(b.data) && ['image/jpeg', 'image/png'].includes(b.mime));
  });
  if (res.blocks.length) for (const b of [res.blocks[0], res.blocks[res.blocks.length - 1]]) assert.notEqual(b.type, 'pagebreak');
  return res;
}
const toBlocks = (...args) => validate(convert(...args));
const text = (b) => (b.runs || []).map((r) => r.text).join('');
const cells = (table) => table.rows.map((r) => r.cells.map((c) => c.runs.map((x) => x.text).join('')));
const find = (res, type, pred = () => true) => res.blocks.find((b) => b.type === type && pred(b));
const all = (res) => res.blocks.map((b) => (b.type === 'table' ? cells(b).flat().join(' ') : b.type === 'list' ? b.items.map(text).join(' ') : text(b))).join('\n');
// "\u" control words of RTF, written without the escape in this file.
const U = (n) => `\\${'u'}${n}`;

// A tiny PNG (1 × 1) and enough of a JPEG for its signature.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082', 'hex');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 7), Buffer.from([0xff, 0xd9])]);

// All the streams of a compound file, one of them changed, written again.
function rewrite(buf, name, change) {
  const cfb = readCfb(buf);
  const files = new Map();
  for (const n of cfb.names) files.set(n, Buffer.from(cfb.read(n)));
  if (name) files.set(name, change(files.get(name)));
  return writeCfb(files);
}

// =============================================================================================
// Compound files

test('KINDS, sniffCompound and isRtf know the older formats', () => {
  for (const k of ['doc', 'xls', 'ppt', 'rtf', 'msg']) assert.equal(KINDS[k], k);
  assert.equal(KINDS.dot, 'doc');
  assert.equal(KINDS.xlt, 'xls');
  assert.equal(KINDS.pps, 'ppt');
  assert.equal(sniffCompound(fixture('Project proposal KMC.doc')), 'doc');
  assert.equal(sniffCompound(fixture('Equipment budget.xls')), 'xls');
  assert.equal(sniffCompound(fixture('Quarterly review.ppt')), 'ppt');
  assert.equal(sniffCompound(writeCfb({ __properties_version1: Buffer.alloc(32), __substg1: Buffer.alloc(2), '__substg1.0_0037001F': Buffer.from('Hi', 'utf16le') })), 'msg');
  assert.equal(sniffCompound(writeCfb({ EncryptionInfo: Buffer.alloc(200), EncryptedPackage: Buffer.alloc(5000) })), 'encrypted-ooxml');
  assert.equal(sniffCompound(writeCfb({ Something: Buffer.alloc(10) })), null);
  assert.equal(sniffCompound(fixture('Project proposal KMC.docx')), null);
  assert.equal(sniffCompound(Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(100)])), null);
  assert.equal(isRtf(Buffer.from('{\\rtf1\\ansi hello}')), true);
  assert.equal(isRtf(Buffer.from('\r\n  {\\rtf1 x}')), true);
  assert.equal(isRtf(Buffer.from('{\\rt hello}')), false);
  assert.equal(isRtf(fixture('Project proposal KMC.rtf')), true);
});

test('readCfb: v3 and v4 files, small and large streams, storages, DIFAT sectors', () => {
  const big = Buffer.alloc(70000, 1);
  big.write('start', 0);
  big.write('end', big.length - 3);
  const files = { Small: Buffer.from('tiny stream'), 'Folder/Inner': Buffer.from('inside'), 'Folder/Deeper/Big': big, Empty: Buffer.alloc(0), Exact: Buffer.alloc(4096, 2) };
  for (const opts of [{ version: 3 }, { version: 4 }, { version: 3, headerDifat: 0 }]) {
    const buf = writeCfb(files, opts);
    assert.ok(isCompound(buf));
    const cfb = readCfb(buf);
    assert.deepEqual([...cfb.names].sort(), ['Empty', 'Exact', 'Folder/Deeper/Big', 'Folder/Inner', 'Small']);
    assert.deepEqual([...cfb.storages].sort(), ['Folder', 'Folder/Deeper']);
    assert.equal(cfb.read('small').toString(), 'tiny stream'); // names are not case-sensitive
    assert.equal(cfb.read('Folder/Inner').toString(), 'inside');
    assert.ok(cfb.read('Folder/Deeper/Big').equals(big));
    assert.equal(cfb.read('Empty').length, 0);
    assert.equal(cfb.read('Exact').length, 4096);
    assert.equal(cfb.size('Folder/Deeper/Big'), 70000);
    assert.throws(() => cfb.read('Missing'), /part of this file \(Missing\) is missing/);
  }
  // DIFAT: many allocation-table sectors, none of them in the header.
  const many = writeCfb({ Huge: Buffer.alloc(600000, 3) }, { headerDifat: 0 });
  assert.equal(readCfb(many).read('Huge').length, 600000);
  assert.equal(readCfb(many).read('Huge')[599999], 3);
});

test('readCfb: damaged files, loops and limits give a clear message', () => {
  const files = { Data: Buffer.alloc(20000, 5), Note: Buffer.from('small') };
  const DAMAGED = /damaged or was only partly uploaded/;
  // A chain that loops back on itself.
  const loop = writeCfb(files, { patchFat: (fat, info) => { const { start } = info.streams.get('Data'); fat[start + 5] = start + 1; } });
  assert.throws(() => readCfb(loop).read('Data'), DAMAGED);
  // A chain pointing outside the allocation table, and one ending too soon.
  const outside = writeCfb(files, { patchFat: (fat, info) => { fat[info.streams.get('Data').start + 2] = 0x7ffffff0; } });
  assert.throws(() => readCfb(outside).read('Data'), DAMAGED);
  const short = writeCfb(files, { patchFat: (fat, info) => { fat[info.streams.get('Data').start + 2] = 0xfffffffe; } });
  assert.throws(() => readCfb(short).read('Data'), DAMAGED);
  // The directory chain looping.
  const dirLoop = writeCfb(files, { patchFat: (fat, info) => { fat[info.dirStart] = info.dirStart; } });
  assert.throws(() => readCfb(dirLoop), DAMAGED);
  // Cut short, a bad header, not a compound file at all.
  const whole = writeCfb(files);
  assert.throws(() => readCfb(whole.subarray(0, 1500)).read('Data'), DAMAGED);
  assert.throws(() => readCfb(whole.subarray(0, 300)), DAMAGED);
  const badShift = Buffer.from(whole);
  badShift.writeUInt16LE(30, 0x1e);
  assert.throws(() => readCfb(badShift), /not an Office file ATLAS can read/);
  assert.throws(() => readCfb(Buffer.from('PK\x03\x04 not a compound file')), /not an Office file ATLAS can read/);
  // Limits: one stream, all streams together.
  assert.throws(() => readCfb(whole, { maxStreamBytes: 10000 }).read('Data'), /far more data/);
  const twice = readCfb(writeCfb({ A: Buffer.alloc(9000), B: Buffer.alloc(9000) }), { maxTotalBytes: 12000 });
  twice.read('A');
  assert.throws(() => twice.read('B'), /far more data/);
  // Through toBlocks the file's name leads the message.
  assert.throws(() => convert(loop, 'doc', { fileName: 'loop.doc' }), /“loop\.doc” is not a Word document ATLAS can read|“loop\.doc” is damaged/);
});

test('a password-protected .docx, .xlsx or .pptx (an encrypted compound file) gets a plain message', () => {
  const enc = writeCfb({ EncryptionInfo: Buffer.alloc(300, 1), EncryptedPackage: Buffer.alloc(9000, 2), '\x06DataSpaces/Version': Buffer.alloc(64) });
  for (const kind of ['docx', 'xlsx', 'pptx', 'doc']) {
    assert.throws(() => convert(enc, kind, { fileName: `pay.${kind}` }), new RegExp(`“pay\\.${kind}” is protected with a password: open it, remove the password, save it and upload it again`));
  }
  // A compound file that is none of the known kinds keeps the old message for .docx.
  const other = writeCfb({ Contents: Buffer.alloc(100) });
  assert.throws(() => convert(other, 'docx'), /password or saved in the older Word format \(\.doc\)/);
});

// =============================================================================================
// Word 97–2003

// A .doc built from pieces of text ({ text, compressed }): the FIB, the text, and a Table stream with
// the piece table. No formatting tables, so paragraphs are plain and tables come from the cell marks.
function makeDoc(pieces, { flags = 0x0200, nFib = 0xc1, ccp } = {}) {
  const fib = Buffer.alloc(0x400);
  fib.writeUInt16LE(0xa5ec, 0);
  fib.writeUInt16LE(nFib, 2);
  fib.writeUInt16LE(flags, 0x0a);
  fib.writeUInt16LE(14, 0x20);
  fib.writeUInt16LE(22, 0x3e);
  fib.writeUInt16LE(93, 0x98);
  const texts = [];
  const cps = [0];
  const fcs = [];
  let at = fib.length;
  for (const p of pieces) {
    const bytes = p.compressed ? Buffer.from(p.text, 'latin1') : Buffer.from(p.text, 'utf16le');
    fcs.push(p.compressed ? (at * 2) | 0x40000000 : at);
    texts.push(bytes);
    at += bytes.length;
    cps.push(cps[cps.length - 1] + p.text.length);
  }
  fib.writeInt32LE(ccp ?? cps[cps.length - 1], 0x4c);
  const plc = Buffer.alloc(cps.length * 4 + pieces.length * 8);
  cps.forEach((cp, i) => plc.writeUInt32LE(cp, i * 4));
  fcs.forEach((fc, i) => plc.writeUInt32LE(fc >>> 0, cps.length * 4 + i * 8 + 2));
  const clx = Buffer.concat([Buffer.from([2]), Buffer.alloc(4), plc]);
  clx.writeUInt32LE(plc.length, 1);
  fib.writeUInt32LE(0, 0x1a2);
  fib.writeUInt32LE(clx.length, 0x1a6);
  return writeCfb({ WordDocument: Buffer.concat([fib, ...texts, Buffer.alloc(600)]), [flags & 0x0200 ? '1Table' : '0Table']: clx });
}

test('doc: pieces of 8-bit and 16-bit text, fields, cell marks, page breaks', () => {
  const doc = makeDoc([
    { text: 'Leave policy\rApply in ATLAS: \x13 HYPERLINK "https://example.org/leave" \\o "tip" \x14the leave page\x15 and caf\xe9 hours.\r', compressed: true },
    { text: 'Name\x07Days\x07\x07Ana Cruz\x07 5\x07\x07After the table\x0cNext page: ₱ 1,200 — “done”\r\x13 PAGE \x14 3\x15\r', compressed: false },
  ]);
  const res = toBlocks(doc, 'doc', { fileName: 'policy.doc' });
  assert.equal(res.title, null);
  assert.equal(text(res.blocks[0]), 'Leave policy');
  const link = res.blocks[1].runs.find((r) => r.link);
  assert.deepEqual(link, { text: 'the leave page', link: 'https://example.org/leave' });
  assert.equal(text(res.blocks[1]), 'Apply in ATLAS: the leave page and café hours.');
  assert.deepEqual(cells(find(res, 'table')), [['Name', 'Days'], ['Ana Cruz', ' 5']]);
  const i = res.blocks.findIndex((b) => b.type === 'pagebreak');
  assert.equal(text(res.blocks[i - 1]), 'After the table');
  assert.equal(text(res.blocks[i + 1]), 'Next page: ₱ 1,200 — “done”');
  assert.equal(text(res.blocks[i + 2]), ' 3');
  // Text past the main document (footnotes and the like) is not shown.
  const cut = toBlocks(makeDoc([{ text: 'Main text\rFootnote text\r', compressed: true }], { ccp: 10 }), 'doc');
  assert.equal(all(cut), 'Main text');
});

test('doc: a real file — title, headings, formatting, links, lists, table, picture, page break', () => {
  const res = toBlocks(fixture('Project proposal KMC.doc'), 'doc', { fileName: 'Project proposal KMC.doc' });
  assert.equal(res.title, 'Project proposal: Hospital HRIS');
  assert.deepEqual(res.warnings, []);
  assert.deepEqual(res.blocks[0], { type: 'heading', level: 1, runs: [{ text: 'Project proposal: Hospital HRIS' }] });
  const intro = res.blocks[1];
  assert.equal(text(intro), 'Prepared for Kalayaan Medical Center by Lancaster Systems and its partners. Café budget: ₱1,200 — see our site.');
  assert.ok(intro.runs.some((r) => r.text === 'Lancaster Systems' && r.bold));
  assert.ok(intro.runs.some((r) => r.text === 'its partners' && r.italic));
  const site = intro.runs.find((r) => r.text === 'our site');
  assert.equal(site.link, 'https://example.com/hris');
  assert.ok(site.underline && site.color[0] > 0.7);
  assert.deepEqual(res.blocks.filter((b) => b.type === 'heading').map((b) => [b.level, text(b)]), [[1, 'Project proposal: Hospital HRIS'], [2, 'Scope'], [2, 'Price']]);
  const lists = res.blocks.filter((b) => b.type === 'list');
  assert.deepEqual(lists.map((l) => [l.ordered, l.items.map((it) => [it.level, text(it)])]), [
    [false, [[0, 'Timekeeping'], [1, 'Biometric clocks']]],
    [true, [[0, 'Payroll'], [0, 'Reports in Courier']]],
  ]);
  assert.ok(lists[1].items[1].runs.some((r) => r.text === 'Courier' && r.mono));
  assert.deepEqual(cells(find(res, 'table')), [['Phase', 'Duration'], ['Phase 1', '2 weeks'], ['Phase 2', '4 weeks']]);
  const img = find(res, 'image');
  assert.equal(img.mime, 'image/png');
  assert.deepEqual([img.width, img.height], [60, 45]);
  const pb = res.blocks.findIndex((b) => b.type === 'pagebreak');
  assert.ok(pb > res.blocks.indexOf(img));
  assert.equal(text(res.blocks[pb + 1]), 'Price');
  const last = res.blocks[res.blocks.length - 1];
  assert.ok(last.runs.some((r) => r.text === '1,200,000.00' && r.bold && r.italic));
  assert.ok(last.runs.some((r) => r.text === 'three' && r.underline));
});

test('doc: renamed files, passwords, Word 95 and damage get plain messages', () => {
  // A .doc named .docx, and a .docx named .doc, are read as what they are.
  const asDocx = toBlocks(fixture('Project proposal KMC.doc'), 'docx');
  assert.equal(asDocx.blocks[0].type, 'heading');
  const asDoc = toBlocks(fixture('Project proposal KMC.docx'), 'doc');
  assert.equal(text(asDoc.blocks[0]), 'Project proposal: Hospital HRIS');
  // Word's Rich Text saved as .doc.
  assert.equal(text(toBlocks(Buffer.from('{\\rtf1\\ansi Hello from RTF\\par}'), 'doc').blocks[0]), 'Hello from RTF');
  // A web page saved as .doc or .xls.
  assert.deepEqual(cells(find(toBlocks(Buffer.from('<html><body><table><tr><td>a</td><td>b</td></tr></table></body></html>'), 'xls'), 'table')), [['a', 'b']]);
  assert.throws(() => convert(makeDoc([{ text: 'secret\r', compressed: true }], { flags: 0x0300 }), 'doc', { fileName: 'pay.doc' }),
    /“pay\.doc” is protected with a password: open it in Word, remove the password/);
  assert.throws(() => convert(makeDoc([{ text: 'old\r', compressed: true }], { nFib: 0x65 }), 'doc'), /saved by Word 95 or older/);
  assert.throws(() => convert(Buffer.from('hello, not a document'), 'doc', { fileName: 'x.doc' }), /“x\.doc” is not an Office file ATLAS can read/);
  assert.throws(() => convert(fixture('Equipment budget.xls').subarray(0, 0), 'doc'), /not an Office file ATLAS can read/);
  const noWord = writeCfb({ Other: Buffer.alloc(10) });
  assert.throws(() => convert(noWord, 'doc'), /not a Word document ATLAS can read/);
  // The piece table pointing past the text.
  const bad = rewrite(makeDoc([{ text: 'Hello\r', compressed: true }]), '1Table', (t) => { t.writeUInt32LE(0x3fff0000, 5 + 8 + 2); return t; });
  assert.throws(() => convert(bad, 'doc'), /not a Word document ATLAS can read/);
});

// =============================================================================================
// Excel 97–2003

const rec = (type, data = Buffer.alloc(0)) => {
  const h = Buffer.alloc(4);
  h.writeUInt16LE(type, 0);
  h.writeUInt16LE(data.length, 2);
  return Buffer.concat([h, data]);
};
const bytes = (...parts) => Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const f64 = (n) => { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b; };
const cell = (r, c, xf) => bytes(u16(r), u16(c), u16(xf));
const xlString = (s, wide = false) => bytes(u16(s.length), [wide ? 1 : 0], wide ? Buffer.from(s, 'utf16le') : Buffer.from(s, 'latin1'));
const bof = (dt, vers = 0x0600) => rec(0x0809, bytes(u16(vers), u16(dt), Buffer.alloc(12)));

// A workbook: globals (fonts, formats, styles, sheets, shared strings) and each sheet's records.
function makeXls(sheets, { extraGlobals = [], sst = [], date1904 = false } = {}) {
  const head = [
    bof(5), ...extraGlobals, rec(0x0022, u16(date1904 ? 1 : 0)),
    rec(0x0031, bytes(u16(200), u16(0), u16(0x7fff), u16(400), Buffer.alloc(6), [5, 0], 'Arial')),
    rec(0x0031, bytes(u16(200), u16(2), u16(0x7fff), u16(700), Buffer.alloc(6), [5, 0], 'Arial')),
    rec(0x041e, bytes(u16(164), xlString('#,##0.00 "pcs"'))),
    rec(0x00e0, bytes(u16(0), u16(0), Buffer.alloc(16))), // 0: general
    rec(0x00e0, bytes(u16(0), u16(14), Buffer.alloc(16))), // 1: date
    rec(0x00e0, bytes(u16(1), u16(0), Buffer.alloc(16))), // 2: bold
    rec(0x00e0, bytes(u16(0), u16(164), Buffer.alloc(16))), // 3: custom
    rec(0x00e0, bytes(u16(0), u16(10), Buffer.alloc(16))), // 4: 0.00%
  ];
  const bound = (pos, s) => rec(0x0085, bytes(u32(pos), [s.hidden ? 1 : 0, s.kind || 0], [s.name.length, 0], s.name));
  const tail = [...sst, rec(0x000a)];
  const globalsLength = (positions) => Buffer.concat([...head, ...sheets.map((s, i) => bound(positions[i], s)), ...tail]).length;
  const bodies = sheets.map((s) => Buffer.concat([bof(s.kind === 2 ? 0x20 : 0x10), ...s.records, rec(0x000a)]));
  let pos = globalsLength(sheets.map(() => 0));
  const positions = bodies.map((b) => { const p = pos; pos += b.length; return p; });
  const globals = Buffer.concat([...head, ...sheets.map((s, i) => bound(positions[i], s)), ...tail]);
  assert.equal(globals.length, globalsLength(positions));
  return writeCfb({ Workbook: Buffer.concat([globals, ...bodies]) });
}

test('xls: shared strings across CONTINUE records, numbers, RK, formulas, merges, 1904 dates', () => {
  // Shared strings: "Item", a rich "Bold name" whose formatting runs fall in the next part, and
  // "Grüße żółw" whose characters change from 8-bit to 16-bit at the part boundary.
  const sst = [
    rec(0x00fc, bytes(u32(4), u32(4), xlString('Item'), u16(9), [0x08], u16(2), 'Bold name', u32(0), u32(0x00050001), u16(10), [0], 'Grüße')),
    rec(0x003c, bytes([1], Buffer.from(' żółw', 'utf16le'), u16(4), [0], 'Last')),
  ];
  const sheet = [
    rec(0x00fd, bytes(cell(0, 0, 2), u32(0))),
    rec(0x00fd, bytes(cell(0, 1, 2), u32(1))),
    rec(0x00fd, bytes(cell(0, 2, 2), u32(2))),
    rec(0x0203, bytes(cell(1, 0, 0), f64(1234.5))),
    rec(0x027e, bytes(cell(1, 1, 3), u32((42 << 2) | 2))), // integer 42
    rec(0x027e, bytes(cell(1, 2, 4), u32((1234 << 2) | 3))), // 12.34 → 1234%
    rec(0x00bd, bytes(u16(2), u16(0), u16(1), u32((44000 << 2) | 2), u16(0), u32((7 << 2) | 2), u16(1))), // 2 cells
    rec(0x0006, bytes(cell(3, 0, 0), [0, 0, 0, 0, 0, 0], u16(0xffff), u16(0), u32(0), u16(0))), rec(0x0207, xlString('Formula text')),
    rec(0x0006, bytes(cell(3, 1, 0), [1, 0, 1, 0, 0, 0], u16(0xffff), u16(0), u32(0), u16(0))),
    rec(0x0006, bytes(cell(3, 2, 0), [2, 0, 0x07, 0, 0, 0], u16(0xffff), u16(0), u32(0), u16(0))),
    rec(0x0006, bytes(cell(4, 0, 0), f64(0.1 + 0.2), u16(0), u32(0), u16(0))),
    rec(0x0205, bytes(cell(4, 1, 0), [0, 0])),
    rec(0x0204, bytes(cell(4, 2, 0), xlString('Ünïcode ₱', true))),
    rec(0x00fd, bytes(cell(5, 0, 0), u32(3))),
    rec(0x00e5, bytes(u16(1), u16(5), u16(5), u16(0), u16(2))),
  ];
  const xls = makeXls([{ name: 'Data', records: sheet }, { name: 'Secret', hidden: true, records: [] }, { name: 'Chart 1', kind: 2, records: [] }], { sst, date1904: true });
  const res = toBlocks(xls, 'xls', { fileName: 'book.xls' });
  assert.deepEqual(res.blocks.map((b) => b.type), ['heading', 'table']);
  assert.equal(text(res.blocks[0]), 'Data');
  const t = res.blocks[1];
  assert.deepEqual(cells(t), [
    ['Item', 'Bold name', 'Grüße żółw'],
    ['1234.5', '42.00 pcs', '1234.00%'],
    ['6/19/2024', '7', ''], // 44,000 days after 1 January 1904
    ['Formula text', 'TRUE', '#DIV/0!'],
    ['0.3', 'FALSE', 'Ünïcode ₱'],
    ['Last'],
  ]);
  assert.equal(t.rows[0].header, true);
  assert.ok(t.rows[0].cells[0].runs[0].bold);
  assert.equal(t.rows[1].cells[0].align, 'right');
  assert.equal(t.rows[5].cells[0].colspan, 3);
  assert.deepEqual(res.warnings.sort(), ['1 hidden sheet was left out.', 'Sheet Chart 1 is a chart, which ATLAS cannot put in a PDF; it was left out.']);
});

test('xls: a real file — sheets, formats, dates, percentages, formulas, merged title, hidden sheet', () => {
  const res = toBlocks(fixture('Equipment budget.xls'), 'xls', { fileName: 'Equipment budget.xls' });
  assert.deepEqual(res.blocks.map((b) => b.type), ['heading', 'table', 'pagebreak', 'heading', 'table']);
  assert.deepEqual(res.blocks.filter((b) => b.type === 'heading').map(text), ['Budget', 'Notes']);
  const budget = res.blocks[1];
  assert.deepEqual(cells(budget), [
    ['Equipment budget 2026', '', '', ''],
    ['Item', 'Qty', 'Unit price', 'Total', 'Delivery', 'Share'],
    ['Laptop', '12', '45,000.00', '540,000.00', '15/03/2026', '68.0%'],
    ['Monitor', '12', '9,500.50', '114,006.00', '01/04/2026', '14.4%'],
    ['Café table – Ñandú', '-3', '1234567.25', '#DIV/0!', 'TRUE', 'Ready soon'],
  ]);
  assert.equal(budget.rows[0].cells[0].colspan, 3);
  assert.ok(budget.rows[1].cells.every((c) => c.runs[0].bold));
  assert.deepEqual(cells(res.blocks[4]), [['Prices include VAT.', 'Checked'], ['', '0.5']]);
  assert.deepEqual(res.warnings, ['1 hidden sheet was left out.']);
  // The same workbook saved as .xlsx gives the same tables.
  assert.equal(res.landscape, false);
});

test('xls: passwords, Excel 95, row limits and damaged records', () => {
  const pass = makeXls([{ name: 'S', records: [] }], { extraGlobals: [rec(0x002f, bytes(u16(1), Buffer.alloc(52)))] });
  assert.throws(() => convert(pass, 'xls', { fileName: 'pay.xls' }), /“pay\.xls” is protected with a password: open it in Excel, remove the password/);
  const biff5 = writeCfb({ Book: Buffer.concat([bof(5, 0x0500), rec(0x000a)]) });
  assert.throws(() => convert(biff5, 'xls'), /Excel 95 format or older/);
  const biff5b = writeCfb({ Workbook: Buffer.concat([bof(5, 0x0500), rec(0x000a)]) });
  assert.throws(() => convert(biff5b, 'xls'), /Excel 95 format or older/);
  assert.throws(() => convert(writeCfb({ Workbook: Buffer.from('garbage!') }), 'xls'), /not an Excel workbook ATLAS can read/);
  // 2,500 rows: the first 2,000 are kept.
  const rows = [];
  for (let r = 0; r < 2500; r++) rows.push(rec(0x027e, bytes(cell(r, 0, 0), u32((r << 2) | 2))));
  const long = toBlocks(makeXls([{ name: 'Long', records: rows }]), 'xls');
  assert.equal(find(long, 'table').rows.length, 2000);
  assert.ok(long.warnings.some((w) => /only the first 2,000 rows/.test(w)));
  // Records cut short or pointing at strings that do not exist are skipped.
  const odd = makeXls([{ name: 'Odd', records: [rec(0x00fd, bytes(cell(0, 0, 0), u32(99))), rec(0x0203, bytes(cell(0, 1, 0))), rec(0x0204, bytes(cell(1, 0, 0), u16(50), [0], 'short')), rec(0x027e, bytes(cell(2, 0, 99), u32((5 << 2) | 2)))] }]);
  assert.deepEqual(cells(find(toBlocks(odd, 'xls'), 'table')), [['5']]);
  // A sheet whose position is outside the stream.
  const lost = makeXls([{ name: 'Lost', records: [] }]);
  const broken = rewrite(lost, 'Workbook', (wb) => { const at = wb.indexOf(Buffer.from('Lost')) - 8; wb.writeUInt32LE(0x7fffffff, at); return wb; });
  const res = toBlocks(broken, 'xls');
  assert.deepEqual(res.warnings, ['Sheet Lost could not be read and was left out.']);
});

// =============================================================================================
// PowerPoint 97–2003

test('ppt: a real file — slides in order, titles, bullets, bold, a picture, hidden slide left out', () => {
  const res = toBlocks(fixture('Quarterly review.ppt'), 'ppt', { fileName: 'Quarterly review.ppt' });
  assert.equal(res.title, 'Quarterly review');
  assert.equal(res.landscape, true);
  assert.deepEqual(res.warnings, ['1 hidden slide was left out.']);
  assert.deepEqual(res.blocks.filter((b) => b.type === 'heading').map((b) => [b.level, text(b)]), [[1, 'Quarterly review'], [1, 'Highlights'], [1, 'Next steps']]);
  assert.equal(res.blocks.filter((b) => b.type === 'pagebreak').length, 2);
  assert.equal(text(res.blocks[1]), 'Kalayaan Medical Center – 2026');
  const list = find(res, 'list');
  assert.equal(list.ordered, false);
  assert.deepEqual(list.items.map(text), ['Payroll went live in March', '1,200 staff on the new system', 'Café opened — on time']);
  assert.ok(list.items[0].runs.some((r) => r.text === 'March' && r.bold));
  assert.ok(!all(res).includes('Hidden draft'));
  const img = find(res, 'image');
  assert.equal(img.mime, 'image/png');
  assert.ok(Math.abs(img.width - 113.4) < 0.5 && Math.abs(img.height - 85) < 0.5);
  // A .ppt named .pptx is read as what it is.
  assert.equal(text(toBlocks(fixture('Quarterly review.ppt'), 'pptx').blocks[0]), 'Quarterly review');
});

test('ppt: no usable "Current User" falls back to the records in order; passwords and damage', () => {
  const ppt = fixture('Quarterly review.ppt');
  const noUser = rewrite(ppt, 'Current User', () => Buffer.alloc(4));
  const res = toBlocks(noUser, 'ppt');
  assert.deepEqual(res.blocks.filter((b) => b.type === 'heading').map(text), ['Quarterly review', 'Highlights', 'Next steps']);
  const locked = rewrite(ppt, 'Current User', (b) => { b.writeUInt32LE(0xf3d1c4df, 12); return b; });
  assert.throws(() => convert(locked, 'ppt', { fileName: 'deck.ppt' }), /“deck\.ppt” is protected with a password: open it in PowerPoint/);
  assert.throws(() => convert(writeCfb({ 'PowerPoint Document': Buffer.alloc(40, 0xff) }), 'ppt'), /not a PowerPoint presentation ATLAS can read/);
  assert.throws(() => convert(writeCfb({ Other: Buffer.alloc(40) }), 'ppt'), /not a PowerPoint presentation ATLAS can read/);
});

// =============================================================================================
// Rich Text

test('rtf: paragraphs, formatting, Unicode, code pages, links, headings, lists, tables, pictures, pages', () => {
  const rtf = [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman Times New Roman;}{\\f1\\fmodern Courier New;}{\\f2\\fnil\\fcharset204 Arial Cyr;}}',
    '{\\colortbl;\\red0\\green0\\blue0;\\red0\\green0\\blue255;}',
    '{\\stylesheet{\\s0 Normal;}{\\s1\\b\\fs32 heading 1;}{\\s2 Heading 2;}}',
    '{\\info{\\title Leave {\\i policy}}{\\author Somebody}}',
    '{\\header Page header text\\par}{\\footer Footer text\\par}{\\*\\generator Some writer;}{\\*\\unknowndest skipped}',
    '\\pard\\s1 Leave policy\\par',
    `\\pard\\plain\\qc Caf\\'e9 {\\b bold {\\i both}} \\ul under\\ul0 , \\uc1${U(8369)}?1,200 ${U(-3913)}? {\\f2 \\'cf\\'f0\\'e8\\'e2\\'e5\\'f2}\\line next line\\tab tabbed\\par`,
    '\\pard {\\field{\\*\\fldinst{ HYPERLINK "https://example.org/leave" }}{\\fldrslt{\\cf2\\ul the leave page}}} and {\\f1 code}\\par',
    '\\pard\\s2 Steps\\par',
    "\\pard\\ls1\\ilvl0 {\\listtext 1.\\tab}Ask your manager\\par",
    "\\pard\\ls1\\ilvl0 {\\listtext 2.\\tab}Wait for approval\\par",
    "\\pard\\ls2\\ilvl1 {\\listtext\\f3 \\'b7\\tab}A bullet below\\par",
    '\\trowd\\trhdr\\cellx2000\\cellx4000\\cellx6000\\pard\\intbl {\\b Name}\\cell {\\b Days}\\cell Notes\\cell\\row',
    '\\trowd\\clmgf\\cellx2000\\clmrg\\cellx4000\\cellx6000\\pard\\intbl Spans two\\cell\\cell Last\\cell\\row',
    '\\trowd\\cellx2000\\cellx4000\\cellx6000\\pard\\intbl Two\\par lines\\cell {\\pict\\pngblip\\picwgoal600\\pichgoal300 ' + PNG.toString('hex') + '}\\cell x\\cell\\row',
    '\\pard After the table {\\v hidden text}\\par',
    `\\pard {\\*\\shppict{\\pict\\pngblip\\picw1\\pich1\\picwgoal1440\\pichgoal720\\picscalex50\\picscaley100 ${PNG.toString('hex')}}}{\\nonshppict{\\pict\\wmetafile8 0102}}\\par`,
    '\\pard {\\pict\\emfblip 01000000}\\par',
    '\\pard {\\pict\\jpegblip\\bin' + JPEG.length + ' ',
  ].join('\n');
  const tail = '}\\par\\page\\pard Second page\\par}';
  const buf = Buffer.concat([Buffer.from(rtf, 'latin1'), JPEG, Buffer.from(tail, 'latin1')]);
  const res = toBlocks(buf, 'rtf', { fileName: 'policy.rtf' });
  assert.equal(res.title, 'Leave policy');
  assert.ok(!all(res).includes('header') && !all(res).includes('Footer') && !all(res).includes('skipped') && !all(res).includes('hidden'));
  assert.deepEqual(res.blocks[0], { type: 'heading', level: 1, runs: [{ text: 'Leave policy' }] });
  const p = res.blocks[1];
  assert.equal(p.align, 'center');
  assert.equal(text(p), 'Café bold both under, ₱1,200  Привет\nnext line    tabbed'.replace('', String.fromCharCode(65536 - 3913)));
  assert.ok(p.runs.some((r) => r.text === 'bold ' && r.bold && !r.italic));
  assert.ok(p.runs.some((r) => r.text === 'both' && r.bold && r.italic));
  assert.ok(p.runs.some((r) => r.text === 'under' && r.underline));
  const link = res.blocks[2].runs.find((r) => r.link);
  assert.equal(link.text, 'the leave page');
  assert.equal(link.link, 'https://example.org/leave');
  assert.deepEqual(link.color, [0, 0, 1]);
  assert.ok(res.blocks[2].runs.some((r) => r.text === 'code' && r.mono));
  assert.deepEqual([res.blocks[3].type, res.blocks[3].level, text(res.blocks[3])], ['heading', 2, 'Steps']);
  const lists = res.blocks.filter((b) => b.type === 'list');
  assert.deepEqual(lists.map((l) => [l.ordered, l.items.map((i) => [i.level, text(i)])]), [[true, [[0, 'Ask your manager'], [0, 'Wait for approval'], [1, 'A bullet below']]]]);
  const t = find(res, 'table');
  assert.deepEqual(cells(t), [['Name', 'Days', 'Notes'], ['Spans two', 'Last'], ['Two\nlines', '', 'x']]);
  assert.equal(t.rows[0].header, true);
  assert.equal(t.rows[1].cells[0].colspan, 2);
  const after = res.blocks.indexOf(t);
  assert.equal(res.blocks[after + 1].type, 'image'); // the picture from the cell comes after the table
  assert.deepEqual([res.blocks[after + 1].width, res.blocks[after + 1].height], [30, 15]);
  const imgs = res.blocks.filter((b) => b.type === 'image');
  assert.deepEqual(imgs.map((b) => [b.mime, b.width, b.height]), [['image/png', 30, 15], ['image/png', 36, 36], ['image/jpeg', undefined, undefined]]);
  assert.ok(res.warnings.some((w) => /1 picture in a format a PDF cannot hold/.test(w)));
  const pb = res.blocks.findIndex((b) => b.type === 'pagebreak');
  assert.equal(text(res.blocks[pb + 1]), 'Second page');
});

test('rtf: WordPad and macOS TextEdit files', () => {
  const wordpad = [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat\\deflang1033{\\fonttbl{\\f0\\fnil\\fcharset0 Calibri;}{\\f1\\fnil\\fcharset2 Symbol;}}',
    '{\\*\\generator Riched20 10.0.19041}\\viewkind4\\uc1 ',
    '\\pard\\sa200\\sl276\\slmult1\\f0\\fs22\\lang9 Meeting notes\\par',
    '\\b Decisions\\b0\\par',
    "\\pard{\\pntext\\f1\\'B7\\tab}{\\*\\pn\\pnlvlblt\\pnf1\\pnindent0{\\pntxtb\\'B7}}\\fi-360\\li720 Approve budget\\par",
    "{\\pntext\\f1\\'B7\\tab}Hire two nurses\\par",
    "\\pard\\sa200 Na\\'efve caf\\'e9\\par",
    '}',
  ].join('\r\n');
  const w = toBlocks(Buffer.from(wordpad, 'latin1'), 'rtf');
  assert.deepEqual(w.blocks.map((b) => b.type), ['paragraph', 'paragraph', 'list', 'paragraph']);
  assert.deepEqual(w.blocks[1].runs, [{ text: 'Decisions', bold: true, size: 11 }]);
  assert.deepEqual(w.blocks[2].items.map(text), ['Approve budget', 'Hire two nurses']);
  assert.equal(w.blocks[2].ordered, false);
  assert.equal(text(w.blocks[3]), 'Naïve café');

  const textedit = [
    '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761',
    '\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;\\f1\\fswiss\\fcharset0 Helvetica-Bold;\\f2\\fmodern\\fcharset0 Courier;}',
    '{\\colortbl;\\red255\\green255\\blue255;}',
    '{\\*\\expandedcolortbl;;}',
    '\\paperw11900\\paperh16840\\margl1440\\margr1440\\vieww11520\\viewh8400\\viewkind0',
    '\\pard\\tx566\\tx1133\\pardirnatural\\partightenfactor0',
    '',
    '\\f1\\b\\fs24 \\cf0 Shopping list\\',
    '\\pard\\tx566\\pardirnatural\\partightenfactor0',
    '',
    `\\f0\\b0 \\cf0 Milk \\'96 2 litres\\`,
    `Eggs \\uc0${U(8212)}  a dozen\\`,
    '\\',
    '\\f2 code sample\\',
    '\\f0 \\',
    '\\itap1\\trowd \\taflags1 \\trgaph108\\trleft-108 \\clvertalc \\clshdrawnil \\cellx4320',
    '\\clvertalc \\clshdrawnil \\cellx8640',
    '\\pard\\intbl\\itap1\\pardeftab720\\partightenfactor0',
    '\\cf0 Item\\cell ',
    '\\pard\\intbl\\itap1\\pardeftab720\\partightenfactor0',
    '\\cf0 Price\\cell \\row',
    '',
    '\\itap1\\trowd \\taflags1 \\trgaph108\\trleft-108 \\cellx4320',
    '\\cellx8640',
    '\\pard\\intbl\\itap1\\pardeftab720\\partightenfactor0',
    '\\cf0 Bread\\cell ',
    '\\pard\\intbl\\itap1\\pardeftab720\\partightenfactor0',
    '\\cf0 2.50\\cell \\lastrow\\row',
    '\\pard\\pardeftab720\\partightenfactor0',
    "\\cf0 After {{\\NeXTGraphic photo.png \\width1200 \\height900 \\appleattachmentpadding0 \\appleembedtype0 \\appleaqc",
    "}\\'ac}\\",
    '}',
  ].join('\n');
  const t = toBlocks(Buffer.from(textedit, 'latin1'), 'rtf');
  assert.deepEqual(t.blocks.filter((b) => b.type !== 'table').map((b) => text(b).trim()).filter(Boolean), ['Shopping list', 'Milk – 2 litres', 'Eggs — a dozen', 'code sample', 'After']);
  assert.ok(t.blocks[0].runs[0].bold);
  assert.ok(t.blocks.find((b) => text(b) === 'code sample').runs[0].mono);
  assert.deepEqual(cells(find(t, 'table')), [['Item', 'Price'], ['Bread', '2.50']]);
  assert.deepEqual(t.warnings, ['Pictures of a TextEdit document are kept outside the .rtf file (in an .rtfd folder), so they were left out.']);
});

test('rtf: a file written by LibreOffice (Word-style), Outlook HTML in RTF, and hostile input', () => {
  const lo = toBlocks(fixture('Project proposal KMC.rtf'), 'rtf');
  assert.equal(lo.title, 'Project proposal: Hospital HRIS');
  assert.deepEqual(lo.blocks.filter((b) => b.type === 'heading').map(text), ['Project proposal: Hospital HRIS', 'Scope', 'Price']);
  assert.match(all(lo), /Café budget: ₱1,200 — see our site\./);
  assert.deepEqual(lo.blocks.filter((b) => b.type === 'list').map((l) => [l.ordered, l.items.map(text)]), [[false, ['Timekeeping', 'Biometric clocks']], [true, ['Payroll', 'Reports in Courier']]]);
  assert.deepEqual(cells(find(lo, 'table')), [['Phase', 'Duration'], ['Phase 1', '2 weeks'], ['Phase 2', '4 weeks']]);
  assert.ok(find(lo, 'image'));
  assert.ok(lo.blocks.some((b) => b.type === 'pagebreak'));

  // HTML wrapped in RTF (\fromhtml1), as Outlook stores it: read as the HTML it wraps.
  const html = [
    '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1 \\deff0{\\fonttbl{\\f0\\fswiss Arial;}}',
    '{\\*\\htmltag19 <html>}{\\*\\htmltag34 <head>}{\\*\\htmltag41 <title>Ignored</title>}{\\*\\htmltag41 </head>}',
    '{\\*\\htmltag50 <body>}\\htmlrtf {\\htmlrtf0',
    '{\\*\\htmltag64 <p>}Hello {\\*\\htmltag84 <b>}team{\\*\\htmltag92 </b>}, caf\\\'e9 \\htmlrtf\\par\\htmlrtf0',
    '{\\*\\htmltag72 </p>}',
    '{\\*\\htmltag64 <ul><li>}One{\\*\\htmltag72 </li><li>}Two{\\*\\htmltag72 </li></ul>}',
    '\\htmlrtf}\\htmlrtf0 {\\*\\htmltag58 </body>}{\\*\\htmltag27 </html>}}',
  ].join('\r\n');
  const h = toBlocks(Buffer.from(html, 'latin1'), 'rtf');
  assert.deepEqual(h.blocks.map((b) => b.type), ['paragraph', 'list']);
  assert.deepEqual(h.blocks[0].runs, [{ text: 'Hello ' }, { text: 'team', bold: true }, { text: ', café' }]);
  assert.deepEqual(h.blocks[1].items.map(text), ['One', 'Two']);

  // Deep nesting (text beyond 4,000 levels is not read), unbalanced braces, a stray \bin, a cut-off
  // file: no hang, no crash.
  const deep = Buffer.from(`{\\rtf1 ${'{'.repeat(20000)}too deep${'}'.repeat(20000)} after ${'{\\b '.repeat(500)}bold${'}'.repeat(500)}\\par}`);
  const start = Date.now();
  assert.equal(all(toBlocks(deep, 'rtf')), ' after bold');
  assert.ok(Date.now() - start < 2000);
  assert.equal(all(toBlocks(Buffer.from('{\\rtf1 open {\\b bold'), 'rtf')), 'open bold');
  assert.equal(all(toBlocks(Buffer.from('{\\rtf1 x\\bin99999999 '), 'rtf')), 'x');
  assert.equal(all(toBlocks(Buffer.from('{\\rtf1 a}}}} b'), 'rtf')), 'a');
  assert.equal(toBlocks(Buffer.from('{\\rtf1}'), 'rtf').blocks.length, 0);
  assert.throws(() => convert(Buffer.from('plain text, not RTF'), 'rtf', { fileName: 'n.rtf' }), /“n\.rtf” is not a Rich Text document ATLAS can read/);
});

// =============================================================================================
// Outlook messages

const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
// A .msg: { subject, from: [name, email], recipients: [[name, email, type]], date, html, plain, rtf, attachments: [[name, data]] }.
function makeMsg({ subject, from, recipients = [], date, html, plain, rtf, attachments = [], ansi = false, extra = {} }) {
  const files = new Map();
  const str = (prefix, id, s) => {
    if (s === undefined) return;
    if (ansi) files.set(`${prefix}__substg1.0_${hex4(id)}001E`, Buffer.from(s, 'latin1'));
    else files.set(`${prefix}__substg1.0_${hex4(id)}001F`, Buffer.from(s, 'utf16le'));
  };
  const bin = (prefix, id, b) => { if (b !== undefined) files.set(`${prefix}__substg1.0_${hex4(id)}0102`, b); };
  const fixed = (head, entries) => Buffer.concat([Buffer.alloc(head), ...entries.map(([tag, value]) => {
    const e = Buffer.alloc(16);
    e.writeUInt32LE(tag >>> 0, 0);
    e.writeUInt32LE(6, 4);
    if (typeof value === 'bigint') e.writeBigUInt64LE(value, 8);
    else e.writeInt32LE(value, 8);
    return e;
  })]);
  str('', 0x001a, 'IPM.Note');
  str('', 0x0037, subject);
  if (from) { str('', 0x0c1a, from[0]); str('', 0x5d01, from[1]); }
  bin('', 0x1013, html);
  str('', 0x1000, plain);
  bin('', 0x1009, rtf);
  const top = [[0x3fde0003, ansi ? 1252 : 65001]];
  if (date) top.push([0x00390040, BigInt(date.getTime() + 11644473600000) * 10000n]);
  files.set('__properties_version1.0', fixed(32, top));
  recipients.forEach(([name, email, type], i) => {
    const p = `__recip_version1.0_#${i.toString(16).toUpperCase().padStart(8, '0')}/`;
    str(p, 0x3001, name);
    str(p, 0x39fe, email);
    files.set(`${p}__properties_version1.0`, fixed(8, [[0x0c150003, type]]));
  });
  attachments.forEach(([name, data], i) => {
    const p = `__attach_version1.0_#${i.toString(16).toUpperCase().padStart(8, '0')}/`;
    str(p, 0x3707, name);
    if (data === 'message') files.set(`${p}__substg1.0_3701000D/__substg1.0_0037001F`, Buffer.from('Inner', 'utf16le'));
    else bin(p, 0x3701, data);
    files.set(`${p}__properties_version1.0`, fixed(8, []));
  });
  for (const [k, v] of Object.entries(extra)) files.set(k, v);
  return writeCfb(files);
}

test('msg: subject, people, date, HTML body, attachments and pictures', () => {
  const msg = makeMsg({
    subject: 'Leave approved — Ünïcode',
    from: ['Ana Cruz', 'ana@example.com'],
    recipients: [['Ben Reyes', 'ben@example.com', 1], ['HR Team', 'hr@example.com', 2], ['Secret', 'bcc@example.com', 3], ['Carla', 'carla@example.com', 1]],
    date: new Date(Date.UTC(2026, 2, 15, 9, 30)),
    html: Buffer.from('<html><head><title>x</title></head><body><p>Hi <b>Ben</b>,</p><p>Your leave is <a href="https://example.org/leave">approved</a>.</p><img src="cid:image001.png"></body></html>', 'utf8'),
    plain: 'Plain text that is not used',
    attachments: [['photo.png', PNG], ['form.pdf', Buffer.from('%PDF-1.4 ...')], ['scan.jpg', JPEG], ['Fwd: hello', 'message']],
  });
  const res = toBlocks(msg, 'msg', { fileName: 'leave.msg' });
  assert.equal(res.title, 'Leave approved — Ünïcode');
  assert.deepEqual(res.blocks[0], { type: 'heading', level: 1, runs: [{ text: 'Leave approved — Ünïcode' }] });
  assert.deepEqual(cells(res.blocks[1]), [
    ['From', 'Ana Cruz <ana@example.com>'],
    ['To', 'Ben Reyes <ben@example.com>; Carla <carla@example.com>'],
    ['Cc', 'HR Team <hr@example.com>'],
    ['Date', 'Sunday, 15 March 2026, 09:30 UTC'],
  ]);
  assert.ok(res.blocks[1].rows[0].cells[0].runs[0].bold);
  assert.equal(res.blocks[2].type, 'rule');
  assert.ok(!all(res).includes('Plain text'));
  assert.match(all(res), /Hi Ben,\nYour leave is approved\./);
  const link = res.blocks.flatMap((b) => b.runs || []).find((r) => r.link);
  assert.equal(link.link, 'https://example.org/leave');
  const att = res.blocks.find((b) => b.type === 'paragraph' && /^Attachments: /.test(text(b)));
  assert.equal(text(att), 'Attachments: photo.png (69 bytes), form.pdf (12 bytes), scan.jpg (46 bytes), Fwd: hello');
  assert.deepEqual(res.blocks.filter((b) => b.type === 'image').map((b) => [b.mime, b.alt]), [['image/png', 'photo.png'], ['image/jpeg', 'scan.jpg']]);
  assert.ok(res.warnings.includes('An attached e-mail message is listed by name only.'));
  assert.ok(res.warnings.includes('Attachments other than JPEG and PNG pictures are listed by name only.'));
});

test('msg: plain-text and compressed-RTF bodies, 8-bit strings, and files that are not messages', () => {
  const plain = toBlocks(makeMsg({ subject: 'Caf\xe9 menu', ansi: true, from: ['Kitchen', '/O=EXCHANGE/OU=FIRST/CN=KITCHEN'], plain: 'Line one\r\nLine two\r\n\r\nSecond paragraph' }), 'msg');
  assert.equal(plain.title, 'Café menu');
  assert.deepEqual(cells(plain.blocks[1]), [['From', 'Kitchen']]);
  assert.deepEqual(plain.blocks.slice(3).map(text), ['Line one\nLine two', 'Second paragraph']);
  // The example of MS-OXRTFCP: "{\rtf1\ansi\ansicpg1252\pard hello world}".
  const lzfu = Buffer.from('2d0000002b0000004c5a4675f1c5c7a703000a00726370673132354232 0af32068656c090020627705b06c647d0a800fa0'.replace(/ /g, ''), 'hex');
  assert.equal(decompressRtf(lzfu).toString('latin1'), '{\\rtf1\\ansi\\ansicpg1252\\pard hello world}\r\n');
  const viaRtf = toBlocks(makeMsg({ subject: 'RTF only', rtf: lzfu }), 'msg');
  assert.equal(text(viaRtf.blocks[viaRtf.blocks.length - 1]), 'hello world');
  // Not compressed ("MELA"), and damaged.
  const raw = Buffer.from('{\\rtf1 stored as is\\par}');
  const mela = Buffer.concat([Buffer.alloc(16), raw]);
  mela.writeUInt32LE(raw.length + 12, 0);
  mela.writeUInt32LE(raw.length, 4);
  mela.writeUInt32LE(0x414c454d, 8);
  assert.equal(text(toBlocks(makeMsg({ subject: 'x', rtf: mela }), 'msg').blocks.at(-1)), 'stored as is');
  assert.throws(() => decompressRtf(Buffer.alloc(20)), /compressed RTF\) is damaged/);
  const empty = toBlocks(makeMsg({ subject: '' }), 'msg');
  assert.deepEqual(empty.blocks.map(text), ['(No subject)', '', '(This message has no text.)']);
  assert.throws(() => convert(writeCfb({ Something: Buffer.alloc(5) }), 'msg', { fileName: 'm.msg' }), /“m\.msg” is not an Outlook message ATLAS can read/);
  assert.throws(() => convert(Buffer.from('From: someone\r\n\r\nan .eml file'), 'msg'), /not an Office file ATLAS can read/);
});

// =============================================================================================
// Damaged files never crash or hang

test('damaged copies of every format end in a result or a plain Error, quickly', () => {
  const files = [
    ['doc', fixture('Project proposal KMC.doc')], ['xls', fixture('Equipment budget.xls')], ['ppt', fixture('Quarterly review.ppt')],
    ['rtf', fixture('Project proposal KMC.rtf')],
    ['msg', makeMsg({ subject: 'Hi', html: Buffer.from('<p>x</p>'), attachments: [['a.png', PNG]] })],
  ];
  let seed = 12345;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const start = Date.now();
  for (const [kind, buf] of files) {
    for (let round = 0; round < 60; round++) {
      const copy = Buffer.from(buf);
      const flips = 1 + rand(40);
      for (let k = 0; k < flips; k++) copy[512 + rand(copy.length - 512)] = rand(256);
      const cut = round % 5 === 0 ? copy.subarray(0, 512 + rand(copy.length - 512)) : copy;
      try {
        validate(convert(cut, kind, { fileName: `x.${kind}` }));
      } catch (err) {
        assert.ok(err instanceof Error && !(err instanceof TypeError) && !(err instanceof RangeError), `${kind}: ${err}`);
        assert.match(err.message, /“x\.\w+”|This file|The text of this message/, `${kind}: ${err.message}`);
      }
    }
  }
  assert.ok(Date.now() - start < 20000);
});
