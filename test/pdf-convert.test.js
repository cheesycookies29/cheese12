// PDF Studio (0.68): the export in other kinds of file. A PDF read back into paragraphs, headings,
// tables and pictures, and written as Word, OpenDocument, Rich Text, a web page, Markdown, text, Excel,
// CSV and SVG; and through the API: the format asked, split, stamps left off documents, pictures
// for the browser to draw, the limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApi } from '../server/api.js';
import { docToPdf } from '../server/pdf/layout.js';
import { readZip } from '../server/pdf/office-core.js';
import * as office from '../server/pdf/office.js';
import { convertPdf, readPages, numberOf } from '../server/pdf/convert.js';
import { zipFiles } from '../server/zip.js';
import { PDF_EXPORT_FORMATS, PDF_LIMITS } from '../shared/pdf-studio.js';

const SCAN = fs.readFileSync(new URL('../scripts/fixtures/Scanned acceptance NSU-2025-118.pdf', import.meta.url));
const REPORT = {
  title: 'Quarterly report',
  blocks: [
    { type: 'heading', level: 1, runs: [{ text: 'Quarterly report' }] },
    { type: 'paragraph', runs: [{ text: 'This report covers the third quarter. Sales rose in every region, and the new ' }, { text: 'Document Management', bold: true }, { text: ' module went live for all staff. It is long enough to wrap onto a second line so that paragraphs are joined.' }] },
    { type: 'heading', level: 2, runs: [{ text: 'Sales by region' }] },
    { type: 'table', widths: [2, 1, 1], rows: [
      { cells: [{ runs: [{ text: 'Region', bold: true }] }, { runs: [{ text: 'Q2', bold: true }] }, { runs: [{ text: 'Q3', bold: true }] }] },
      { cells: [{ runs: [{ text: 'Luzon' }] }, { runs: [{ text: '1,250,000.00' }] }, { runs: [{ text: '1,410,500.50' }] }] },
      { cells: [{ runs: [{ text: 'Visayas' }] }, { runs: [{ text: '820,000.00' }] }, { runs: [{ text: '(12,000.00)' }] }] },
    ] },
    { type: 'paragraph', runs: [{ text: 'Growth was 12% overall.' }] },
  ],
};
const PDF = docToPdf(REPORT, { size: 'a4' }).pdf;
const part = (zip, name) => readZip(zip).read(name).toString('utf8');

test('a PDF read back: lines, paragraphs joined, a table found, the bold kept word by word', () => {
  const [page] = readPages(PDF);
  assert.equal(page.hasText, true);
  assert.equal(page.lines[0].text, 'Quarterly report');
  assert.ok(page.lines.some((l) => l.cells.length === 3 && l.text.startsWith('Luzon')));
  const md = convertPdf(PDF, 'md', 'report').files[0].buffer.toString('utf8');
  assert.match(md, /^# Quarterly report\n\nThis report covers the third quarter\. .* the new \*\*Document Management\*\* module went live .* are joined\.\n\n## Sales by region\n\n/s);
  assert.match(md, /\| \*\*Region\*\* \| \*\*Q2\*\* \| \*\*Q3\*\* \|\n\| --- \| --- \| --- \|\n\| Luzon \| 1,250,000\.00 \| 1,410,500\.50 \|/);
  const txt = convertPdf(PDF, 'txt', 'report').files[0].buffer.toString('utf8');
  assert.match(txt, /Region\tQ2\tQ3\nLuzon\t1,250,000\.00\t1,410,500\.50/);
  assert.doesNotMatch(txt, /\*\*/);
});

test('Word, OpenDocument and Excel files: whole packages, the parts each needs', () => {
  const docx = convertPdf(PDF, 'docx', 'report', { title: 'Quarterly report', author: 'Sam' }).files[0];
  assert.equal(docx.name, 'report.docx');
  const zip = readZip(docx.buffer);
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml']) assert.ok(zip.has(p), p);
  const doc = part(docx.buffer, 'word/document.xml');
  assert.match(doc, /<w:pStyle w:val="Heading1"\/><\/w:pPr><w:r><w:t xml:space="preserve">Quarterly report</);
  assert.match(doc, /<w:b\/><\/w:rPr><w:t xml:space="preserve">Document Management ?</);
  assert.equal((doc.match(/<w:tr>/g) || []).length, 3);
  assert.match(part(docx.buffer, 'docProps/core.xml'), /<dc:title>Quarterly report<\/dc:title><dc:creator>Sam</);
  // Read back by CORE's own Word reader: the same text.
  const back = office.toBlocks(docx.buffer, 'docx');
  assert.ok(JSON.stringify(back).includes('Sales by region'));

  const odt = convertPdf(PDF, 'odt', 'report').files[0].buffer;
  // "mimetype" first and not compressed, as OpenDocument requires.
  assert.equal(odt.subarray(30, 38).toString('latin1'), 'mimetype');
  assert.equal(odt.readUInt16LE(8), 0);
  assert.match(part(odt, 'content.xml'), /<text:h text:style-name="Heading_20_1" text:outline-level="1">Quarterly report<\/text:h>/);
  assert.ok(readZip(odt).has('META-INF/manifest.xml'));

  const xlsx = convertPdf(PDF, 'xlsx', 'report').files[0].buffer;
  const sheet = part(xlsx, 'xl/worksheets/sheet1.xml');
  assert.match(sheet, /<c r="B\d+" s="2"><v>1250000<\/v><\/c><c r="C\d+" s="2"><v>1410500\.5<\/v>/);
  assert.match(sheet, /<v>-12000<\/v>/);
  assert.match(part(xlsx, 'xl/workbook.xml'), /<sheet name="Page 1"/);
});

test('Rich Text, web page, CSV and SVG', () => {
  const rtf = convertPdf(PDF, 'rtf', 'report').files[0].buffer.toString('latin1');
  assert.match(rtf, /^\{\\rtf1\\ansi/);
  assert.match(rtf, /\{\\b Document Management ?\}/);
  assert.match(rtf, /\\trowd/);
  const page = convertPdf(PDF, 'html', 'report', { title: 'Q3 <report>' }).files[0].buffer.toString('utf8');
  assert.match(page, /<title>Q3 &lt;report&gt;<\/title>/);
  assert.match(page, /<h1>Quarterly report<\/h1>/);
  assert.match(page, /<table><tr><td><strong>Region<\/strong><\/td>/);
  assert.doesNotMatch(page, /<script/);
  const csv = convertPdf(PDF, 'csv', 'report').files[0].buffer.toString('utf8');
  assert.match(csv, /^﻿Quarterly report\r\n/);
  assert.match(csv, /\r\nLuzon,"1,250,000\.00","1,410,500\.50"\r\n/);
  const svg = convertPdf(PDF, 'svg', 'report').files[0];
  assert.equal(svg.name, 'report.svg');
  assert.match(svg.buffer.toString('utf8'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test('a scan without text: a picture in documents, said in a note; nothing in text', () => {
  const docx = convertPdf(SCAN, 'docx', 'scan');
  assert.ok((readZip(docx.files[0].buffer).names).some((k) => /^word\/media\/image1\.(jpg|png)$/.test(k)));
  assert.match(docx.notes[0], /no text to take.*as a picture/);
  const txt = convertPdf(SCAN, 'txt', 'scan');
  assert.match(txt.notes[0], /left empty/);
});

test('numbers as people write them, and text that only looks like one', () => {
  assert.deepEqual(numberOf('1,234.50'), { value: 1234.5, percent: false });
  assert.deepEqual(numberOf('(1,234.50)'), { value: -1234.5, percent: false });
  assert.deepEqual(numberOf('15%'), { value: 0.15, percent: true });
  assert.deepEqual(numberOf('₱ 1,200'), { value: 1200, percent: false });
  for (const s of ['0917 123 4567', '00123', 'Page 3', '1,23', '(12', '1234567890123456789']) assert.equal(numberOf(s), null, s);
});

test('a ZIP with folders keeps them, safely', () => {
  const zip = zipFiles([{ name: '_rels/.rels', buffer: Buffer.from('a') }, { name: '../../etc/passwd', buffer: Buffer.from('b') }, { name: '/word/x.xml', buffer: Buffer.from('c') }], { paths: true });
  assert.deepEqual((readZip(zip).names), ['_rels/.rels', '_/_/etc/passwd', 'word/x.xml']);
  // Without folders (downloads of attachments), as before.
  assert.deepEqual((readZip(zipFiles([{ name: 'a/b.txt', buffer: Buffer.from('x') }])).names), ['a_b.txt']);
});

// ----- The API -----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-pdf-convert-'));
const db = openDb(path.join(dir, 'db.json'));
const handle = createApi(db);
let cookie = '';
const sam = async (method, url, body = {}) => {
  const res = await handle({ method, headers: { cookie }, socket: { remoteAddress: '10.0.0.5' } }, new URL(url, 'http://localhost'), body);
  if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
  return res;
};
await sam('POST', '/api/auth/setup', { name: 'Ada Admin', username: 'admin', password: 'Correct-Horse-42' });
const fails = (promise, status, re) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status, err.message);
  if (re) assert.match(err.message, re);
  return true;
});

test('API: export as Word, split into a ZIP, pictures for the browser, stamps on pictures only', async () => {
  const src = (await sam('POST', '/api/tools/pdf/sources', { file: { name: 'report.pdf', type: '', data: PDF.toString('base64') } })).data;
  const scan = (await sam('POST', '/api/tools/pdf/sources', { file: { name: 'scan.pdf', type: '', data: SCAN.toString('base64') } })).data;
  const pages = [{ source: src.id, page: 0 }, { source: scan.id, page: 0 }];
  const stamp = { header: 'CONFIDENTIAL HEADER', watermark: { text: 'DRAFT' } };
  const word = await sam('POST', '/api/tools/pdf/export', { pages, as: 'docx', stamp, fileName: 'Bundle' });
  assert.equal(word.headers['Content-Type'], PDF_EXPORT_FORMATS.docx && 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(word.headers['Content-Disposition'], /filename="Bundle\.docx"/);
  const doc = part(word.data, 'word/document.xml');
  assert.match(doc, /Quarterly report/);
  assert.match(doc, /<w:pageBreakBefore\/>/);
  // Header and watermark are not written into a document to edit.
  assert.doesNotMatch(doc, /CONFIDENTIAL HEADER|DRAFT/);
  assert.match(decodeURIComponent(word.headers['X-Core-Note']), /1 of 2 pages have no text/);
  // One file per source: a ZIP of two Word files.
  const parts = await sam('POST', '/api/tools/pdf/export', { pages, as: 'docx', split: 'documents', fileName: 'Bundle' });
  assert.equal(parts.headers['Content-Type'], 'application/zip');
  assert.deepEqual((readZip(parts.data).names), ['report.docx', 'scan.docx']);
  // SVG pictures: the header drawn on them.
  const svg = await sam('POST', '/api/tools/pdf/export', { pages, as: 'svg', stamp, fileName: 'Bundle' });
  const files = readZip(svg.data);
  assert.deepEqual(files.names, ['Bundle - page 1.svg', 'Bundle - page 2.svg']);
  assert.match(files.read('Bundle - page 1.svg').toString('utf8'), /CONFIDENTIAL HEADER/);
  // PNG: the pages as SVG, for the browser to draw.
  const png = (await sam('POST', '/api/tools/pdf/export', { pages: [{ source: src.id, page: 0, rotate: 90 }], as: 'png', fileName: 'Pic' })).data;
  assert.equal(png.base, 'Pic');
  assert.equal(png.ext, 'png');
  assert.equal(png.pages.length, 1);
  // Turned a quarter: the picture is landscape.
  assert.ok(png.pages[0].width > png.pages[0].height);
  assert.match(png.pages[0].svg, /rotate\(90\)/);
  // A preview is always the PDF; an unknown format is a PDF.
  const pdf = await sam('POST', '/api/tools/pdf/export', { pages, as: 'exe', fileName: 'x' });
  assert.equal(pdf.headers['Content-Type'], 'application/pdf');
  // Too many pages for a conversion.
  const many = Array.from({ length: PDF_LIMITS.maxConvertPages + 1 }, () => ({ source: src.id, page: 0 }));
  await fails(sam('POST', '/api/tools/pdf/export', { pages: many, as: 'docx' }), 400, /Word can be made from up to 300 pages/);
  const pics = Array.from({ length: PDF_LIMITS.maxPicturePages + 1 }, () => ({ source: src.id, page: 0 }));
  await fails(sam('POST', '/api/tools/pdf/export', { pages: pics, as: 'jpg' }), 400, /JPEG pictures can be made from up to 100 pages/);
  // In the audit log, with the format.
  const log = fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8');
  assert.match(log, /tools\.pdf-export[^\n]*2 pages from 2 files → Bundle\.docx/);
  assert.match(log, /tools\.pdf-export[^\n]*→ PNG pictures \(Pic\)/);
});
