// PDF Studio (0.68): the export in other kinds of file. A PDF read back into paragraphs, headings,
// tables and pictures, and written as Word, OpenDocument, Rich Text, a web page, Markdown, text, Excel,
// CSV and SVG; and through the API: the format asked, split, stamps left off documents, pictures
// for the browser to draw, the limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pdfSchool } from './support/pdf-api.js';
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
  // Read back by ATLAS's own Word reader: the same text.
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

// A table as CSV and Excel files lay it out: headings flush left, numbers flush right, so a heading
// and the numbers under it do not overlap (and a row with an empty cell has fewer cells).
const right = (t) => ({ runs: t ? [{ text: t }] : [], align: 'right' });
const left = (t, o = {}) => ({ runs: t ? [{ text: t, ...o }] : [] });
const BUDGET = docToPdf({ title: 'Equipment budget', blocks: [
  { type: 'heading', level: 1, runs: [{ text: 'Equipment budget' }] },
  { type: 'table', widths: [3, 1, 2, 2], rows: [
    { cells: [left('Item', { bold: true }), left('Qty', { bold: true }), left('Unit price', { bold: true }), left('Total', { bold: true })] },
    { cells: [left('Laptop'), right('12'), right('45,000.00'), right('540,000.00')] },
    { cells: [left('Monitor'), right('12'), right('9,500.00'), right('114,000.00')] },
    { cells: [left('Installation'), right(''), right('25,000.00'), right('25,000.00')] },
    { cells: [left('Total', { bold: true }), right(''), right(''), right('679,000.00')] },
  ] },
] }, { size: 'a4' }).pdf;

test('a column of numbers flush right is one column, under its heading, in every format', () => {
  const csv = convertPdf(BUDGET, 'csv', 'budget').files[0].buffer.toString('utf8');
  assert.match(csv, /\r\nItem,Qty,Unit price,Total\r\nLaptop,12,"45,000\.00","540,000\.00"\r\nMonitor,12,"9,500\.00","114,000\.00"\r\nInstallation,,"25,000\.00","25,000\.00"\r\nTotal,,,"679,000\.00"\r\n/);
  // Excel: the totals in column D, under "Total", as numbers to add up.
  const sheet = part(convertPdf(BUDGET, 'xlsx', 'budget').files[0].buffer, 'xl/worksheets/sheet1.xml');
  assert.match(sheet, /<c r="D2" t="inlineStr"><is><t xml:space="preserve">Total</);
  for (const [ref, v] of [['D3', 540000], ['D4', 114000], ['D5', 25000], ['D6', 679000], ['B3', 12], ['C5', 25000]]) assert.match(sheet, new RegExp(`<c r="${ref}"[^>]*><v>${v}</v>`), ref);
  assert.doesNotMatch(sheet, /r="[E-Z]\d+"/);
  // Documents: a table of four columns.
  const md = convertPdf(BUDGET, 'md', 'budget').files[0].buffer.toString('utf8');
  assert.match(md, /\| \*\*Item\*\* \| \*\*Qty\*\* \| \*\*Unit price\*\* \| \*\*Total\*\* \|\n\| --- \| --- \| --- \| --- \|\n\| Laptop \| 12 \| 45,000\.00 \| 540,000\.00 \|\n\| Monitor \| 12 \| 9,500\.00 \| 114,000\.00 \|\n\| Installation \|   \| 25,000\.00 \| 25,000\.00 \|\n\| \*\*Total\*\* \|   \|   \| 679,000\.00 \|/);
  const doc = part(convertPdf(BUDGET, 'docx', 'budget').files[0].buffer, 'word/document.xml');
  assert.equal((doc.match(/<w:gridCol /g) || []).length, 4);
  assert.match(convertPdf(BUDGET, 'html', 'budget').files[0].buffer.toString('utf8'), /<tr><td>Laptop<\/td><td>12<\/td><td>45,000\.00<\/td><td>540,000\.00<\/td><\/tr>/);
  const rtfRow = convertPdf(BUDGET, 'rtf', 'budget').files[0].buffer.toString('latin1').split('\n').find((l) => l.startsWith('\\trowd'));
  assert.equal(rtfRow.match(/\\cellx/g).length, 4);
  assert.equal((part(convertPdf(BUDGET, 'odt', 'budget').files[0].buffer, 'content.xml').match(/number-columns-repeated="(\d+)"/) || [])[1], '4');
});

test('headings by the body text of their own page: files of other text sizes put together keep theirs', () => {
  const long = 'This paragraph is set in the body text of its page, and it goes on long enough to be most of the text there. '.repeat(3);
  const pdf = docToPdf({ title: 'Mixed', blocks: [
    { type: 'heading', level: 1, runs: [{ text: 'Quarterly report' }] },
    { type: 'paragraph', runs: [{ text: long }] },
    { type: 'heading', level: 2, runs: [{ text: 'Budget' }] },
    { type: 'paragraph', runs: [{ text: long }] },
    { type: 'pagebreak' },
    // Another file, with larger text: more of it than of the first.
    ...Array.from({ length: 6 }, () => ({ type: 'paragraph', runs: [{ text: long, size: 16 }] })),
  ] }, { size: 'a4' }).pdf;
  const md = convertPdf(pdf, 'md', 'mixed').files[0].buffer.toString('utf8');
  assert.match(md, /^# Quarterly report\n/);
  assert.match(md, /\n## Budget\n/);
  assert.doesNotMatch(md.split('---')[1], /^#/m);
});

test('the note on pages without text: one or more, and blank pages left out', async () => {
  const blank = docToPdf({ title: 'Blank', blocks: [{ type: 'paragraph', runs: [{ text: '' }] }] }, { size: 'a4' }).pdf;
  assert.deepEqual(convertPdf(blank, 'docx', 'blank').notes, []);
  assert.deepEqual(convertPdf(blank, 'csv', 'blank').notes, []);
  assert.equal(convertPdf(SCAN, 'docx', 'scan').notes[0], 'The page has no text to take (a scan, or text drawn as shapes): it is in the file as a picture.');
  assert.equal(convertPdf(SCAN, 'xlsx', 'scan').notes[0], 'The page has no text to take (a scan, or text drawn as shapes): it is left empty.');
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
const { dir, as, done } = await pdfSchool('atlas-pdf-convert-');
const sam = await as('teacher.demo');
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
  assert.equal(decodeURIComponent(word.headers['X-Atlas-Note']), '1 of 2 pages has no text to take (a scan, or text drawn as shapes): it is in the file as a picture.');
  assert.equal(word.headers['X-Atlas-Warning'], undefined);
  // A blank page added in PDF Studio is not a scan.
  const withBlank = await sam('POST', '/api/tools/pdf/export', { pages: [...pages, { blank: true, size: 'a4', orientation: 'portrait' }, { source: scan.id, page: 0 }], as: 'docx', fileName: 'Bundle' });
  assert.equal(decodeURIComponent(withBlank.headers['X-Atlas-Note']), '2 of 4 pages have no text to take (a scan, or text drawn as shapes): they are in the file as pictures.');
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
  // Characters the standard fonts lack, typed in the page editor: "?" in the PDF (said), the real
  // character in the other formats; one that cannot be told from a question mark is said.
  const typed = [{ source: src.id, page: 0, edits: [{ type: 'text', x: 60, y: 700, text: 'Approved — Ωmega', size: 12 }] }];
  const asPdf = await sam('POST', '/api/tools/pdf/export', { pages: typed, fileName: 'T' });
  assert.match(decodeURIComponent(asPdf.headers['X-Atlas-Warning']), /appear as “\?”: Ω/);
  const asWord = await sam('POST', '/api/tools/pdf/export', { pages: typed, as: 'docx', fileName: 'T' });
  assert.match(part(asWord.data, 'word/document.xml'), /Approved — Ωmega/);
  assert.equal(asWord.headers['X-Atlas-Warning'], undefined);
  const asCsv = await sam('POST', '/api/tools/pdf/export', { pages: typed, as: 'csv', fileName: 'T' });
  assert.match(asCsv.data.toString('utf8'), /Approved — Ωmega/);
  const alone = await sam('POST', '/api/tools/pdf/export', { pages: [{ ...typed[0], edits: [{ ...typed[0].edits[0], text: 'Angle θ = 90°' }] }], as: 'txt', fileName: 'T' });
  assert.match(alone.data.toString('utf8'), /Angle \? = 90°/);
  assert.match(decodeURIComponent(alone.headers['X-Atlas-Warning']), /appear as “\?” in this file: θ/);
  const asSvg = await sam('POST', '/api/tools/pdf/export', { pages: typed, as: 'svg', fileName: 'T' });
  assert.match(decodeURIComponent(asSvg.headers['X-Atlas-Warning']), /Ω/);
  const asPng = (await sam('POST', '/api/tools/pdf/export', { pages: typed, as: 'png', fileName: 'T' })).data;
  assert.match(asPng.warning, /Ω/);
  // Markdown, one file for each file added: two files of the same name each link to their own picture.
  const photo = (await sam('POST', '/api/tools/pdf/sources', { file: { name: 'scan.jpg', type: 'image/jpeg', data: fs.readFileSync(new URL('../scripts/fixtures/profile-sample.jpg', import.meta.url)).toString('base64') } })).data;
  const md = readZip((await sam('POST', '/api/tools/pdf/export', { pages: [{ source: scan.id, page: 0 }, { source: photo.id, page: 0 }], as: 'md', split: 'documents', fileName: 'Both' })).data);
  const mds = md.names.filter((n) => n.endsWith('.md'));
  assert.equal(mds.length, 2);
  const linked = mds.map((n) => {
    const link = md.read(n).toString('utf8').match(/!\[Picture\]\(([^)]+)\)/)[1];
    const file = `${n.replace(/[^/]*$/, '')}${link}`;
    assert.ok(md.names.includes(file), `${n} links to ${file}`);
    return md.read(file).toString('base64');
  });
  assert.notEqual(linked[0], linked[1]);
  // In the audit log, with the format.
  const log = fs.readFileSync(path.join(dir, 'audit-log.jsonl'), 'utf8');
  assert.match(log, /Exported Word from PDF Studio[^\n]*Bundle\.docx[^\n]*2 pages from 2 files/);
  assert.match(log, /Exported PNG pictures from PDF Studio[^\n]*Pic/);
  done();
});
