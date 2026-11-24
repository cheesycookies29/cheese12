// PDF Studio (0.64): uploaded documents turned into the block model the PDF layout draws. Each kind
// of file is built here, in the test, as small as it can be, and the blocks it gives are checked;
// then the safety limits (zip bombs, unsafe names, entities, passwords) and damaged files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { toBlocks as convert, readZip, parseXml, KINDS } from '../server/pdf/office.js';
import { zipFiles } from '../server/zip.js';

// The exact shapes the layout engine expects: only these keys, each of the right kind.
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
    if ('size' in run) assert.ok(run.size > 0);
    if ('link' in run) assert.match(run.link, /^(https?:|mailto:)/);
    if ('color' in run) assert.ok(run.color.length === 3 && run.color.every((c) => c >= 0 && c <= 1));
  }
}
function validate(res) {
  assert.deepEqual(Object.keys(res).sort(), ['blocks', 'landscape', 'title', 'warnings']);
  assert.equal(typeof res.landscape, 'boolean');
  assert.ok(res.title === null || typeof res.title === 'string');
  res.blocks.forEach((b, i) => {
    const where = `block ${i} (${b.type})`;
    assert.ok(KEYS[b.type], where);
    for (const [k, v] of Object.entries(b)) {
      assert.ok(KEYS[b.type].includes(k), `${where}: key ${k}`);
      assert.notEqual(v, undefined, `${where}: ${k} is undefined`);
    }
    if (b.type === 'heading') assert.ok([1, 2, 3, 4].includes(b.level));
    if (b.runs) checkRuns(b.runs, where);
    if (b.type === 'paragraph' && 'align' in b) assert.ok(['left', 'center', 'right', 'justify'].includes(b.align));
    if (b.type === 'paragraph' && 'indent' in b) assert.ok(b.indent >= 0 && b.indent <= 6);
    if (b.type === 'list') b.items.forEach((it) => {
      assert.deepEqual(Object.keys(it).sort(), ['level', 'runs']);
      assert.ok(it.level >= 0 && it.level <= 4);
      checkRuns(it.runs, where);
    });
    if (b.type === 'table') b.rows.forEach((row) => {
      for (const k of Object.keys(row)) assert.ok(['header', 'cells'].includes(k), `${where}: row key ${k}`);
      if ('header' in row) assert.equal(row.header, true);
      row.cells.forEach((c) => {
        for (const k of Object.keys(c)) assert.ok(['runs', 'colspan', 'align'].includes(k), `${where}: cell key ${k}`);
        if ('colspan' in c) assert.ok(c.colspan > 1);
        if ('align' in c) assert.ok(['left', 'center', 'right'].includes(c.align));
        checkRuns(c.runs, where);
      });
    });
    if (b.type === 'image') assert.ok(Buffer.isBuffer(b.data) && ['image/jpeg', 'image/png'].includes(b.mime));
  });
  // No empty paragraph or page break at either end, and never two empty paragraphs in a row.
  const empty = (b) => b && b.type === 'paragraph' && !b.runs.length;
  if (res.blocks.length) {
    for (const b of [res.blocks[0], res.blocks[res.blocks.length - 1]]) assert.ok(!empty(b) && b.type !== 'pagebreak');
  }
  res.blocks.forEach((b, i) => assert.ok(!(empty(b) && empty(res.blocks[i + 1]))));
  return res;
}
const toBlocks = (...args) => validate(convert(...args));

// A ZIP of [name, contents, { stored, flags, size }] entries. server/zip.js (zipFiles) flattens
// folders into the names (it makes downloads), so Office packages, which need folders, are built here.
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, contents, { stored = false, flags = 0, size } = {}] of entries) {
    const raw = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
    const data = stored ? raw : deflateRawSync(raw);
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags | 0x0800, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size ?? raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(flags | 0x0800, 8);
    head.writeUInt16LE(stored ? 0 : 8, 10);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(size ?? raw.length, 24);
    head.writeUInt16LE(n.length, 28);
    head.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(head, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// Enough of a PNG and a JPEG for their signatures; an EMF is anything else.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 2)]);
const EMF = Buffer.concat([Buffer.from([0x01, 0x00, 0x00, 0x00]), Buffer.alloc(24, 3)]);

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const rels = (list) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target, ext]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${ext ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
const core = (title) => `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></cp:coreProperties>`;
const p = (inner, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
const r = (text, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const drawing = (id, cx, cy, descr) => `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Picture 1" descr="${descr}"/><a:graphic><a:graphicData><pic:pic xmlns:pic="p"><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

function docx(body, { styles = '', numbering = '', extraRels = [], files = [] } = {}) {
  return zip([
    ['[Content_Types].xml', '<Types/>'],
    ['_rels/.rels', rels([['rId1', 'officeDocument', 'word/document.xml']])],
    ['docProps/core.xml', core('Quarterly report')],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`],
    ['word/_rels/document.xml.rels', rels([['rIdS', 'styles', 'styles.xml'], ['rIdN', 'numbering', 'numbering.xml'], ...extraRels])],
    ['word/styles.xml', `<w:styles ${W}>${styles}</w:styles>`],
    ['word/numbering.xml', `<w:numbering ${W}>${numbering}</w:numbering>`],
    ...files,
  ]);
}

test('KINDS maps every supported extension', () => {
  assert.deepEqual(Object.keys(KINDS).sort(), ['csv', 'doc', 'docx', 'dot', 'htm', 'html', 'markdown', 'md', 'msg', 'odp', 'ods', 'odt', 'pot', 'pps', 'ppt', 'pptx', 'rtf', 'txt', 'xls', 'xlsx', 'xlt']);
  assert.equal(KINDS.markdown, 'md');
  assert.equal(KINDS.htm, 'html');
});

test('docx: headings, runs, links, lists, tables, pictures, page breaks, landscape', () => {
  const styles = `
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Kop2"><w:name w:val="heading 2"/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
    <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:i/></w:rPr></w:style>
    <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>`;
  const numbering = `
    <w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>
    <w:abstractNum w:abstractNumId="20"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num>
    <w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num>`;
  const list = (id, lvl, text) => p(r(text), `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr>`);
  const body = [
    p(''),
    p(r('Big title'), '<w:pStyle w:val="Title"/>'),
    p(r('Introduction'), '<w:pStyle w:val="Heading1"/>'),
    p(r('Details'), '<w:pStyle w:val="Kop2"/>'),
    p([
      r('Plain '), r('bold', '<w:b/>'), r(' '), r('it', '<w:i/><w:u w:val="single"/>'), r(' '),
      r('big', '<w:sz w:val="28"/>'), r(' '), r('red', '<w:color w:val="FF0000"/>'), r(' '), r('black', '<w:color w:val="000000"/>'),
      r(' '), r('code', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>'), r(' '), r('strong', '<w:rStyle w:val="Strong"/>'),
      '<w:r><w:tab/><w:t>tabbed</w:t><w:br/><w:t>next line</w:t></w:r>',
      '<w:del><w:r><w:delText>gone</w:delText></w:r></w:del>', '<w:ins><w:r><w:t> added</w:t></w:r></w:ins>',
      r(' hidden', '<w:vanish/>'),
    ].join(''), '<w:jc w:val="center"/>'),
    p(`<w:hyperlink r:id="rIdL">${r('a link')}</w:hyperlink>${r(' and ')}<w:hyperlink r:id="rIdJ">${r('no link')}</w:hyperlink>`),
    p('<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://field.example" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>field link</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'),
    p('<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'),
    p(r('Quoted'), '<w:pStyle w:val="Quote"/><w:jc w:val="both"/>'),
    p(''), p(''), p(''),
    list(1, 0, 'First'), list(1, 1, 'First a'), list(2, 0, 'Bullet under numbers?'), list(1, 0, 'Second'),
    list(2, 0, 'Bullet one'), list(2, 0, 'Bullet two'),
    p(`${r('Before break')}<w:r><w:br w:type="page"/></w:r>${r('After break')}`),
    `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/><w:gridCol w:w="1000"/></w:tblGrid>
      <w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>${p(r('Name'))}</w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p(r('Value'))}</w:tc></w:tr>
      <w:tr><w:tc>${p(r('Line 1'))}${p(r('Line 2'))}</w:tc><w:tc>${p(r('42'), '<w:jc w:val="right"/>')}</w:tc><w:tc>${p(drawing('rIdP', 914400, 457200, 'In a cell'))}</w:tc></w:tr></w:tbl>`,
    p(drawing('rIdP', 914400, 457200, 'A logo') + drawing('rIdE', 100, 100, 'Old')),
    p(drawing('rIdE', 100, 100, 'Old 2')),
    p(''),
    '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/></w:sectPr>',
  ].join('');
  const buf = docx(body, {
    styles,
    numbering,
    extraRels: [['rIdL', 'hyperlink', 'https://example.com/a?b=1&amp;c=2', true], ['rIdJ', 'hyperlink', 'javascript:alert(1)', true], ['rIdP', 'image', 'media/image1.png'], ['rIdE', 'image', 'media/image2.emf']],
    files: [['word/media/image1.png', PNG, { stored: true }], ['word/media/image2.emf', EMF]],
  });
  const res = toBlocks(buf, 'docx', { fileName: 'report.docx' });
  assert.equal(res.title, 'Quarterly report');
  assert.equal(res.landscape, true);
  const b = res.blocks;
  assert.deepEqual(b[0], { type: 'heading', level: 1, runs: [{ text: 'Big title' }] });
  assert.deepEqual(b[1], { type: 'heading', level: 1, runs: [{ text: 'Introduction' }] }, 'heading styles do not add bold to runs');
  assert.deepEqual(b[2], { type: 'heading', level: 2, runs: [{ text: 'Details' }] }, 'a style named "heading 2" with another id');
  assert.deepEqual(b[3], {
    type: 'paragraph',
    runs: [
      { text: 'Plain ' }, { text: 'bold', bold: true }, { text: ' ' }, { text: 'it', italic: true, underline: true }, { text: ' ' },
      { text: 'big', size: 14 }, { text: ' ' }, { text: 'red', color: [1, 0, 0] }, { text: ' black ' }, { text: 'code', mono: true },
      { text: ' ' }, { text: 'strong', bold: true }, { text: '    tabbed\nnext line added' },
    ],
    align: 'center',
  });
  assert.deepEqual(b[4].runs, [{ text: 'a link', link: 'https://example.com/a?b=1&c=2' }, { text: ' and no link' }]);
  assert.deepEqual(b[5].runs, [{ text: 'field link', link: 'https://field.example' }]);
  assert.deepEqual(b[6].runs, [{ text: '7' }], 'a field shows its result, not its code');
  assert.deepEqual(b[7], { type: 'paragraph', runs: [{ text: 'Quoted', italic: true }], align: 'justify' });
  assert.deepEqual(b[8], { type: 'paragraph', runs: [] }, 'empty paragraphs in a row become one');
  assert.deepEqual(b[9], {
    type: 'list', ordered: true,
    items: [{ runs: [{ text: 'First' }], level: 0 }, { runs: [{ text: 'First a' }], level: 1 }],
  });
  assert.deepEqual(b[10], { type: 'list', ordered: false, items: [{ runs: [{ text: 'Bullet under numbers?' }], level: 0 }] });
  assert.deepEqual(b[11].items.map((i) => i.runs[0].text), ['Second']);
  assert.deepEqual(b[12].items.map((i) => i.runs[0].text), ['Bullet one', 'Bullet two']);
  assert.deepEqual(b.slice(13, 16).map((x) => x.type), ['paragraph', 'pagebreak', 'paragraph']);
  assert.equal(b[15].runs[0].text, 'After break');
  const table = b[16];
  assert.equal(table.type, 'table');
  assert.deepEqual(table.widths, [2000, 3000, 1000]);
  assert.deepEqual(table.rows[0], { header: true, cells: [{ runs: [{ text: 'Name' }] }, { runs: [{ text: 'Value' }], colspan: 2 }] });
  assert.deepEqual(table.rows[1].cells[0], { runs: [{ text: 'Line 1\nLine 2' }] });
  assert.deepEqual(table.rows[1].cells[1], { runs: [{ text: '42' }], align: 'right' });
  assert.deepEqual(table.rows[1].cells[2], { runs: [] });
  // The picture in the cell comes after the table, then the picture of the next paragraph.
  assert.deepEqual(b[17], { type: 'image', data: PNG, mime: 'image/png', width: 72, height: 36, alt: 'In a cell' });
  assert.equal(b[18].alt, 'A logo');
  assert.equal(b.length, 19, 'no empty paragraph at the end');
  assert.deepEqual(res.warnings, ['2 pictures in a format a PDF cannot hold (EMF, WMF, GIF, SVG…) were left out.']);
});

test('docx: the main part is required, and damaged or old files get a plain message', () => {
  const noDoc = zip([['_rels/.rels', rels([])], ['word/styles.xml', '<w:styles/>']]);
  assert.throws(() => toBlocks(noDoc, 'docx', { fileName: 'a.docx' }), /“a\.docx” is not a Word document ATLAS can read/);
  assert.throws(() => toBlocks(Buffer.from('just some text, not a zip'), 'docx'), /This file is not a Word document ATLAS can read/);
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]);
  assert.throws(() => toBlocks(ole, 'docx'), /password or saved in the older Word format \(\.doc\)/);
  const truncated = docx(p(r('x'))).subarray(0, 60);
  assert.throws(() => toBlocks(truncated, 'docx'), (e) => e instanceof Error && /damaged|partly uploaded/.test(e.message));
  // A main part that is not XML at all.
  const notXml = zip([['word/document.xml', 'no tags here']]);
  assert.throws(() => toBlocks(notXml, 'docx'), /not a Word document ATLAS can read/);
  assert.throws(() => toBlocks(Buffer.alloc(0), 'pdf'), /cannot turn \.pdf files into a PDF/);
});

test('docx: a broken secondary part is skipped with a warning', () => {
  const buf = zip([
    ['word/document.xml', `<w:document ${W}><w:body>${p(r('Still here'))}</w:body></w:document>`],
    ['word/_rels/document.xml.rels', rels([['rIdS', 'styles', 'styles.xml']])],
    ['word/styles.xml', ''],
  ]);
  const res = toBlocks(buf, 'docx');
  assert.deepEqual(res.blocks, [{ type: 'paragraph', runs: [{ text: 'Still here' }] }]);
  assert.equal(res.title, null);
  assert.equal(res.landscape, false);
  assert.match(res.warnings[0], /word\/styles\.xml/);
});

test('xlsx: sheets in order, values, dates, percentages, merged cells, limits', () => {
  const sheet = (rows, extra = '') => `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData>${extra}</worksheet>`;
  const buf = zip([
    ['_rels/.rels', rels([['rId1', 'officeDocument', 'xl/workbook.xml']])],
    ['docProps/core.xml', core('Budget')],
    ['xl/workbook.xml', `<workbook xmlns="m" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
      <sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Secret" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Wide" sheetId="3" r:id="rId3"/><sheet name="Long" sheetId="4" r:id="rId4"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'worksheet', 'worksheets/sheet2.xml'], ['rId3', 'worksheet', '/xl/worksheets/sheet3.xml'], ['rId4', 'worksheet', 'worksheets/sheet4.xml'], ['rId9', 'sharedStrings', 'sharedStrings.xml'], ['rId8', 'styles', 'styles.xml']])],
    ['xl/sharedStrings.xml', '<sst><si><t>Name</t></si><si><r><t>Da</t></r><r><rPr><b/></rPr><t>te</t></r><rPh><t>ignored</t></rPh></si><si><t>Pct</t></si></sst>'],
    ['xl/styles.xml', `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;Day&quot; 0.00"/></numFmts>
      <fonts><font/><font><b/></font></fonts>
      <cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="10"/><xf numFmtId="9"/><xf numFmtId="165"/><xf numFmtId="0" fontId="1"/><xf numFmtId="22"/></cellXfs></styleSheet>`],
    ['xl/worksheets/sheet1.xml', sheet(`
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>Num</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr" s="6"><is><t>Ann</t></is></c><c r="B2" s="1"><v>45306</v></c><c r="C2" s="3"><v>0.125</v></c><c r="D2"><v>0.30000000000000004</v></c><c r="E2" t="b"><v>1</v></c><c r="F2" t="str"><f>A2&amp;"!"</f><v>Ann!</v></c></row>
      <row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" s="2"><v>61</v></c><c r="C3" s="4"><v>0.5</v></c><c r="D3" s="5"><v>3</v></c><c r="E3" t="e"><v>#DIV/0!</v></c><c r="G3"><v></v></c></row>
      <row r="4"><c r="B4" s="1"><v>59</v></c><c r="C4" s="7"><v>45306.5</v></c></row>
      <row r="6"><c r="A6" t="inlineStr"><is><t>Merged</t></is></c></row>`, '<mergeCells><mergeCell ref="A6:C6"/></mergeCells>')],
    ['xl/worksheets/sheet2.xml', sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>hidden</t></is></c></row>')],
    ['xl/worksheets/sheet3.xml', sheet(`<row r="2">${'BCDEFGHI'.split('').map((c, i) => `<c r="${c}2"><v>${i}</v></c>`).join('')}</row>`)],
    ['xl/worksheets/sheet4.xml', sheet(Array.from({ length: 2005 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join(''))],
  ]);
  const res = toBlocks(buf, 'xlsx');
  assert.equal(res.title, 'Budget');
  assert.equal(res.landscape, true, 'a sheet with more than 6 columns');
  const b = res.blocks;
  assert.deepEqual(b.map((x) => x.type), ['heading', 'table', 'pagebreak', 'heading', 'table', 'pagebreak', 'heading', 'table']);
  assert.deepEqual(b[0], { type: 'heading', level: 2, runs: [{ text: 'Summary' }] });
  const rows = b[1].rows;
  assert.equal(rows[0].header, true);
  assert.deepEqual(rows[0].cells.map((c) => c.runs[0]?.text), ['Name', 'Date', 'Pct', 'Num', undefined, undefined]);
  assert.deepEqual(rows[1].cells, [
    { runs: [{ text: 'Ann', bold: true }] },
    { runs: [{ text: '1/15/2024' }], align: 'right' }, // as Excel shows them, by their number formats (0.65.1)
    { runs: [{ text: '12.50%' }], align: 'right' },
    { runs: [{ text: '0.3' }], align: 'right' },
    { runs: [{ text: 'TRUE' }] },
    { runs: [{ text: 'Ann!' }] },
  ]);
  assert.deepEqual(rows[2].cells.map((c) => c.runs[0]?.text), ['Name', '01/03/1900', '50%', 'Day 3.00', '#DIV/0!', undefined], 'empty column G trimmed');
  assert.deepEqual(rows[3].cells.map((c) => c.runs[0]?.text), [undefined, '2/28/1900', '1/15/2024 12:00', undefined, undefined, undefined]);
  assert.equal(rows[4].cells.length, 6, 'the empty row 5 is kept inside the range');
  assert.deepEqual(rows[5].cells.slice(0, 2), [{ runs: [{ text: 'Merged' }], colspan: 3 }, { runs: [] }]);
  assert.equal(rows.length, 6);
  assert.equal(b[3].runs[0].text, 'Wide');
  assert.equal(b[4].rows.length, 1);
  assert.equal(b[4].rows[0].cells.length, 8, 'leading empty column A and row 1 trimmed');
  assert.equal(b[7].rows.length, 2000);
  assert.ok(res.warnings.includes('Sheet Long: only the first 2,000 rows were kept.'));
  assert.ok(res.warnings.includes('1 hidden sheet was left out.'));
  assert.ok(!JSON.stringify(b).includes('hidden'));
});

test('xlsx: the 1904 date system and a missing workbook', () => {
  const buf = zip([
    ['xl/workbook.xml', '<workbook xmlns:r="r"><workbookPr date1904="1"/><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', rels([['rId1', 'worksheet', 'worksheets/sheet1.xml']])],
    ['xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', '<x:worksheet xmlns:x="m"><x:sheetData><x:row r="1"><x:c r="A1" s="1"><x:v>0</x:v></x:c><x:c r="B1" s="1"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>'],
  ]);
  const res = toBlocks(buf, 'xlsx');
  assert.deepEqual(res.blocks[1].rows[0].cells.map((c) => c.runs[0].text), ['1/1/1904', '1/2/1904'], 'prefixed element names are read too');
  assert.equal(res.landscape, false);
  assert.throws(() => toBlocks(zip([['xl/other.xml', '<a/>']]), 'xlsx'), /not an Excel workbook ATLAS can read/);
});

const PML = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const sp = (ph, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`;
const ap = (runs, pPr = '') => `<a:p>${pPr}${runs}</a:p>`;
const ar = (text, rPr = '') => `<a:r>${rPr ? rPr : '<a:rPr lang="en-US"/>'}<a:t>${text}</a:t></a:r>`;

test('pptx: slides in order, titles, bullets, numbering, tables, pictures, empty slides', () => {
  const slide1 = `<p:sld ${PML}><p:cSld><p:spTree>
    ${sp('<p:ph type="sldNum"/>', ap(ar('12')))}
    ${sp('<p:ph idx="1"/>', ap(ar('Point one')) + ap(ar('Sub point'), '<a:pPr lvl="1"/>') + ap(ar('No bullet'), '<a:pPr><a:buNone/></a:pPr>'))}
    ${sp('<p:ph type="title"/>', ap(ar('Welcome') + '<a:br/>' + ar('to ATLAS', '<a:rPr b="1" i="1" u="sng" sz="2400"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:rPr>')))}
    ${sp('', ap(ar('Step', '<a:rPr><a:hlinkClick r:id="rIdL"/></a:rPr>'), '<a:pPr algn="ctr"><a:buAutoNum type="arabicPeriod" startAt="3"/></a:pPr>') + ap(ar('Centred'), '<a:pPr algn="ctr"/>'))}
    <p:pic><p:nvPicPr><p:cNvPr id="5" name="Picture" descr="Chart"/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdP"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="1270000"/></a:xfrm></p:spPr></p:pic>
  </p:spTree></p:cSld></p:sld>`;
  const slide2 = `<p:sld ${PML}><p:cSld><p:spTree><p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="100"/><a:gridCol w="200"/></a:tblGrid>
    <a:tr><a:tc gridSpan="2"><a:txBody>${ap(ar('Head'))}</a:txBody></a:tc><a:tc hMerge="1"><a:txBody>${ap('')}</a:txBody></a:tc></a:tr>
    <a:tr><a:tc><a:txBody>${ap(ar('a'))}${ap(ar('b'))}</a:txBody></a:tc><a:tc><a:txBody>${ap(ar('9'), '<a:pPr algn="r"/>')}</a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`;
  const slide3 = `<p:sld ${PML}><p:cSld><p:spTree>${sp('<p:ph type="body"/>', ap(''))}</p:spTree></p:cSld></p:sld>`;
  const hidden = `<p:sld ${PML} show="0"><p:cSld><p:spTree>${sp('', ap(ar('Secret')))}</p:spTree></p:cSld></p:sld>`;
  const buf = zip([
    ['_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])],
    ['docProps/core.xml', core('Kick-off')],
    ['ppt/presentation.xml', `<p:presentation ${PML}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId4"/><p:sldId id="258" r:id="rId2"/><p:sldId id="259" r:id="rId5"/></p:sldIdLst></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', rels([['rId2', 'slide', 'slides/slide3.xml'], ['rId3', 'slide', 'slides/slide1.xml'], ['rId4', 'slide', 'slides/slide2.xml'], ['rId5', 'slide', 'slides/slide4.xml']])],
    ['ppt/slides/slide1.xml', slide1],
    ['ppt/slides/_rels/slide1.xml.rels', rels([['rIdP', 'image', '../media/image1.jpeg'], ['rIdL', 'hyperlink', 'mailto:team@example.com', true]])],
    ['ppt/slides/slide2.xml', slide2],
    ['ppt/slides/slide3.xml', slide3],
    ['ppt/slides/slide4.xml', hidden],
    ['ppt/media/image1.jpeg', JPEG],
  ]);
  const res = toBlocks(buf, 'pptx');
  assert.equal(res.title, 'Kick-off');
  assert.equal(res.landscape, true);
  const b = res.blocks;
  assert.deepEqual(b[0], { type: 'heading', level: 1, runs: [{ text: 'Welcome\n' }, { text: 'to ATLAS', bold: true, italic: true, underline: true, size: 24, color: [0, 0, 1] }] });
  assert.deepEqual(b[1], { type: 'list', ordered: false, items: [{ runs: [{ text: 'Point one' }], level: 0 }, { runs: [{ text: 'Sub point' }], level: 1 }] });
  assert.deepEqual(b[2], { type: 'paragraph', runs: [{ text: 'No bullet' }] });
  assert.deepEqual(b[3], { type: 'paragraph', runs: [] });
  assert.deepEqual(b[4], { type: 'list', ordered: true, start: 3, items: [{ runs: [{ text: 'Step', link: 'mailto:team@example.com' }], level: 0 }] });
  assert.deepEqual(b[5], { type: 'paragraph', runs: [{ text: 'Centred' }], align: 'center' });
  assert.deepEqual(b[7], { type: 'image', data: JPEG, mime: 'image/jpeg', width: 200, height: 100, alt: 'Chart' });
  assert.equal(b[8].type, 'pagebreak');
  assert.deepEqual(b[9], {
    type: 'table', widths: [100, 200], rows: [
      { header: true, cells: [{ runs: [{ text: 'Head' }], colspan: 2 }] },
      { cells: [{ runs: [{ text: 'a\nb' }] }, { runs: [{ text: '9' }], align: 'right' }] },
    ],
  });
  assert.equal(b[10].type, 'pagebreak');
  assert.deepEqual(b[11], { type: 'paragraph', runs: [{ text: '(Slide 3 has no text)', italic: true }] });
  assert.equal(b.length, 12);
  assert.ok(!JSON.stringify(b).includes('12'), 'slide number placeholders are left out');
  assert.deepEqual(res.warnings, ['1 hidden slide was left out.']);
});

const ODF_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"';
function odf(mime, styles, body, files = []) {
  return zip([
    ['mimetype', mime, { stored: true }],
    ['META-INF/manifest.xml', '<manifest:manifest xmlns:manifest="m"/>'],
    ['meta.xml', `<office:document-meta ${ODF_NS}><office:meta><dc:title>ODF title</dc:title></office:meta></office:document-meta>`],
    ['styles.xml', `<office:document-styles ${ODF_NS}><office:styles><style:style style:name="Strong_20_Emphasis" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:styles></office:document-styles>`],
    ['content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS}><office:automatic-styles>${styles}</office:automatic-styles><office:body>${body}</office:body></office:document-content>`],
    ...files,
  ]);
}

test('odt: headings, spans, spaces, links, nested lists, tables and pictures', () => {
  const styles = `
    <style:style style:name="T1" style:family="text"><style:text-properties fo:font-style="italic" fo:font-size="14pt"/></style:style>
    <style:style style:name="T2" style:family="text" style:parent-style-name="Strong_20_Emphasis"/>
    <style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>
    <style:style style:name="Tbl" style:family="table"/>
    <text:list-style style:name="L1"><text:list-level-style-number text:level="1"/><text:list-level-style-bullet text:level="2"/></text:list-style>`;
  const body = `<office:text><text:sequence-decls/>
    <text:h text:outline-level="1">Report</text:h>
    <text:h text:outline-level="6">Deep</text:h>
    <text:p text:style-name="P1">Hello   <text:span text:style-name="T1">big italic</text:span> and <text:span text:style-name="T2">bold</text:span><text:s text:c="3"/>x<text:tab/>y<text:line-break/>z <text:a xlink:href="https://example.org">site</text:a> <text:a xlink:href="file:///etc/passwd">file</text:a><text:note><text:note-body><text:p>footnote</text:p></text:note-body></text:note></text:p>
    <text:p/><text:p/>
    <text:list text:style-name="L1"><text:list-item><text:p>One</text:p><text:list><text:list-item><text:p>One dot one</text:p></text:list-item></text:list></text:list-item><text:list-item><text:p>Two</text:p></text:list-item></text:list>
    <table:table table:name="T"><table:table-column table:number-columns-repeated="3"/>
      <table:table-header-rows><table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>Head</text:p></table:table-cell><table:covered-table-cell/><table:table-cell><text:p>H3</text:p></table:table-cell></table:table-row></table:table-header-rows>
      <table:table-row><table:table-cell table:number-columns-repeated="2"><text:p>rep</text:p></table:table-cell><table:table-cell><text:p>a</text:p><text:p>b</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1000"/></table:table-row>
      <table:table-row table:number-rows-repeated="100000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
    </table:table>
    <text:p><draw:frame svg:width="2.54cm" svg:height="1in"><draw:image xlink:href="Pictures/a.png"/><svg:title>Diagram</svg:title></draw:frame></text:p>
    <text:p><draw:frame svg:width="1cm" svg:height="1cm"><draw:image xlink:href="https://evil.example/x.png"/></draw:frame></text:p>
  </office:text>`;
  const res = toBlocks(odf('application/vnd.oasis.opendocument.text', styles, body, [['Pictures/a.png', PNG]]), 'odt');
  assert.equal(res.title, 'ODF title');
  const b = res.blocks;
  assert.deepEqual(b[0], { type: 'heading', level: 1, runs: [{ text: 'Report' }] });
  assert.deepEqual(b[1], { type: 'heading', level: 4, runs: [{ text: 'Deep' }] });
  assert.deepEqual(b[2], {
    type: 'paragraph', align: 'center', runs: [
      { text: 'Hello ' }, { text: 'big italic', italic: true, size: 14 }, { text: ' and ' }, { text: 'bold', bold: true },
      { text: '   x    y\nz ' }, { text: 'site', link: 'https://example.org' }, { text: ' file' },
    ],
  });
  assert.deepEqual(b[3], { type: 'paragraph', runs: [] });
  assert.deepEqual(b[4], {
    type: 'list', ordered: true, items: [
      { runs: [{ text: 'One' }], level: 0 }, { runs: [{ text: 'One dot one' }], level: 1 }, { runs: [{ text: 'Two' }], level: 0 },
    ],
  });
  assert.deepEqual(b[5], {
    type: 'table', rows: [
      { header: true, cells: [{ runs: [{ text: 'Head' }], colspan: 2 }, { runs: [{ text: 'H3' }] }] },
      { cells: [{ runs: [{ text: 'rep' }] }, { runs: [{ text: 'rep' }] }, { runs: [{ text: 'a\nb' }] }] },
    ],
  }, 'repeated cells written out, trailing empty rows and columns dropped');
  assert.deepEqual(b[6], { type: 'image', data: PNG, mime: 'image/png', width: 72, height: 72, alt: 'Diagram' });
  assert.equal(b.length, 7, 'a picture on the web is never fetched');
  assert.deepEqual(res.warnings, []);
});

test('ods: sheets with displayed values, numbers right-aligned, hidden sheets left out', () => {
  const styles = '<style:style style:name="ta2" style:family="table"><style:table-properties table:display="false"/></style:style>';
  const row = (cells, rep = 1) => `<table:table-row table:number-rows-repeated="${rep}">${cells}</table:table-row>`;
  const body = `<office:spreadsheet>
    <table:table table:name="Costs">
      ${row('<table:table-cell office:value-type="string"><text:p>Item</text:p></table:table-cell><table:table-cell><text:p>Price</text:p></table:table-cell><table:table-cell><text:p>When</text:p></table:table-cell><table:table-cell table:number-columns-repeated="16380"/>')}
      ${row('<table:table-cell office:value-type="string"><text:p>Paper</text:p></table:table-cell><table:table-cell office:value-type="currency" office:value="12.5"><text:p>₱12.50</text:p></table:table-cell><table:table-cell office:value-type="date" office:date-value="2024-05-01"/><table:table-cell table:number-columns-repeated="16380"/>')}
      ${row('<table:table-cell table:number-columns-repeated="16384"/>', 1048574)}
    </table:table>
    <table:table table:name="Hidden" table:style-name="ta2">${row('<table:table-cell><text:p>no</text:p></table:table-cell>')}</table:table>
    <table:table table:name="Wide">${row(Array.from({ length: 45 }, (_, i) => `<table:table-cell office:value-type="float" office:value="${i}"><text:p>${i}</text:p></table:table-cell>`).join(''))}</table:table>
    <table:table table:name="Empty">${row('<table:table-cell/>', 10)}</table:table>
  </office:spreadsheet>`;
  const res = toBlocks(odf('application/vnd.oasis.opendocument.spreadsheet', styles, body), 'ods');
  const b = res.blocks;
  assert.deepEqual(b.map((x) => x.type), ['heading', 'table', 'pagebreak', 'heading', 'table', 'pagebreak', 'heading', 'paragraph']);
  assert.deepEqual(b[0], { type: 'heading', level: 2, runs: [{ text: 'Costs' }] });
  assert.deepEqual(b[1].rows, [
    { header: true, cells: [{ runs: [{ text: 'Item' }] }, { runs: [{ text: 'Price' }] }, { runs: [{ text: 'When' }] }] },
    { cells: [{ runs: [{ text: 'Paper' }] }, { runs: [{ text: '₱12.50' }], align: 'right' }, { runs: [{ text: '2024-05-01' }], align: 'right' }] },
  ]);
  assert.equal(b[4].rows[0].cells.length, 40);
  assert.equal(res.landscape, true);
  assert.deepEqual(b[7].runs, [{ text: '(This sheet is empty.)', italic: true }]);
  assert.ok(res.warnings.includes('Sheet Wide: only the first 40 columns were kept.'));
  assert.ok(res.warnings.includes('1 hidden sheet was left out.'));
});

test('odp: each page a slide, title first, lists, pictures, empty pages', () => {
  const styles = '<text:list-style style:name="L2"><text:list-level-style-bullet text:level="1"/></text:list-style>';
  const body = `<office:presentation>
    <draw:page draw:name="p1">
      <draw:frame presentation:class="outline"><draw:text-box><text:list text:style-name="L2"><text:list-item><text:p>Point A</text:p></text:list-item><text:list-item><text:p>Point B</text:p></text:list-item></text:list></draw:text-box></draw:frame>
      <draw:frame presentation:class="title"><draw:text-box><text:p>Plan</text:p></draw:text-box></draw:frame>
      <draw:frame presentation:class="page-number"><draw:text-box><text:p>1</text:p></draw:text-box></draw:frame>
      <draw:frame svg:width="10cm" svg:height="5cm"><draw:image xlink:href="Pictures/p.jpg"/></draw:frame>
    </draw:page>
    <draw:page draw:name="p2"><presentation:notes><draw:frame><draw:text-box><text:p>notes</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>
  </office:presentation>`;
  const res = toBlocks(odf('application/vnd.oasis.opendocument.presentation', styles, body, [['Pictures/p.jpg', JPEG]]), 'odp');
  assert.equal(res.landscape, true);
  const b = res.blocks;
  assert.deepEqual(b[0], { type: 'heading', level: 1, runs: [{ text: 'Plan' }] });
  assert.deepEqual(b[1], { type: 'list', ordered: false, items: [{ runs: [{ text: 'Point A' }], level: 0 }, { runs: [{ text: 'Point B' }], level: 0 }] });
  assert.equal(b[3].type, 'image');
  assert.equal(b[3].width, 283.46);
  assert.deepEqual(b.slice(4).map((x) => x.type), ['pagebreak', 'paragraph']);
  assert.deepEqual(b[5].runs, [{ text: '(Slide 2 has no text)', italic: true }]);
});

test('odf: a password-protected file and a missing content.xml', () => {
  const locked = zip([['mimetype', 'application/vnd.oasis.opendocument.text', { stored: true }], ['META-INF/manifest.xml', '<m:manifest><m:file-entry><m:encryption-data/></m:file-entry></m:manifest>'], ['content.xml', 'garbage']]);
  assert.throws(() => toBlocks(locked, 'odt'), /protected with a password/);
  assert.throws(() => toBlocks(zip([['mimetype', 'x', { stored: true }]]), 'ods'), /not an OpenDocument spreadsheet ATLAS can read/);
});

test('txt: paragraphs, line breaks, columns as code, Latin-1 and BOM', () => {
  const text = '﻿First line\nsecond line\n\n\n\nNext paragraph\r\n\r\nName      Qty   Price\nApple     3     1.20\nPear      10    0.80\n\nThe end.';
  const res = toBlocks(Buffer.from(text, 'utf8'), 'txt');
  assert.equal(res.title, null);
  assert.deepEqual(res.blocks, [
    { type: 'paragraph', runs: [{ text: 'First line\nsecond line' }] },
    { type: 'paragraph', runs: [{ text: 'Next paragraph' }] },
    { type: 'code', text: 'Name      Qty   Price\nApple     3     1.20\nPear      10    0.80' },
    { type: 'paragraph', runs: [{ text: 'The end.' }] },
  ]);
  const latin = toBlocks(Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x35]), 'txt');
  assert.deepEqual(latin.blocks[0].runs, [{ text: 'Café €5' }], 'not UTF-8: read as Windows-1252');
  const long = toBlocks(Buffer.from(`${'x'.repeat(300)}\nshort`), 'txt');
  assert.equal(long.blocks[0].type, 'code');
  assert.deepEqual(toBlocks(Buffer.from('  \n'), 'txt').blocks, []);
});

test('txt: a very long file stops at the block limit with a warning', () => {
  const res = toBlocks(Buffer.from(Array.from({ length: 20100 }, (_, i) => `Paragraph ${i}`).join('\n\n')), 'txt');
  assert.equal(res.blocks.length, 20000);
  assert.match(res.warnings[0], /only its first 20,000/);
});

test('md: headings, inline formatting, links, lists, code, rules, tables, quotes', () => {
  const md = [
    '# The *Title*', '', 'Intro with **bold**, *italic*, _also italic_, `code`, snake_case_name and 2 * 3 * 4.',
    'Soft wrap  ', 'hard break and [a link](https://example.com "t") and [bad](javascript:alert(1)) and <https://auto.example>.',
    '', '![A cat](https://cats.example/cat.png)', '', '##### Deep', '', 'Setext', '======', '',
    '- one', '- two', '  - two a', '    - two a i', '- three', '', '3. third', '4. fourth', '',
    '```js', 'const a = 1;', '', '  return a;', '```', '', '---', '', '| Name | Qty | Note |', '|:-----|----:|:---:|',
    '| Pen | 2 | *blue* |', '| Ink \\| cartridge | 10 |', '', '> Quoted **text**', '> goes on', '', '***bold italic*** end',
  ].join('\n');
  const res = toBlocks(Buffer.from(md), 'md');
  assert.equal(res.title, 'The Title');
  const b = res.blocks;
  assert.deepEqual(b[0], { type: 'heading', level: 1, runs: [{ text: 'The ' }, { text: 'Title', italic: true }] });
  assert.deepEqual(b[1], {
    type: 'paragraph', runs: [
      { text: 'Intro with ' }, { text: 'bold', bold: true }, { text: ', ' }, { text: 'italic', italic: true }, { text: ', ' },
      { text: 'also italic', italic: true }, { text: ', ' }, { text: 'code', mono: true },
      { text: ', snake_case_name and 2 * 3 * 4. Soft wrap\nhard break and ' }, { text: 'a link', link: 'https://example.com' },
      { text: ' and bad and ' }, { text: 'https://auto.example', link: 'https://auto.example' }, { text: '.' },
    ],
  });
  assert.deepEqual(b[2], { type: 'paragraph', runs: [{ text: 'A cat', italic: true }] });
  assert.deepEqual(b[3], { type: 'heading', level: 4, runs: [{ text: 'Deep' }] });
  assert.deepEqual(b[4], { type: 'heading', level: 1, runs: [{ text: 'Setext' }] });
  assert.deepEqual(b[5], {
    type: 'list', ordered: false, items: [
      { runs: [{ text: 'one' }], level: 0 }, { runs: [{ text: 'two' }], level: 0 }, { runs: [{ text: 'two a' }], level: 1 },
      { runs: [{ text: 'two a i' }], level: 2 }, { runs: [{ text: 'three' }], level: 0 },
    ],
  });
  assert.deepEqual(b[6], { type: 'list', ordered: true, start: 3, items: [{ runs: [{ text: 'third' }], level: 0 }, { runs: [{ text: 'fourth' }], level: 0 }] });
  assert.deepEqual(b[7], { type: 'code', text: 'const a = 1;\n\n  return a;' });
  assert.deepEqual(b[8], { type: 'rule' });
  assert.deepEqual(b[9], {
    type: 'table', rows: [
      { header: true, cells: [{ runs: [{ text: 'Name' }], align: 'left' }, { runs: [{ text: 'Qty' }], align: 'right' }, { runs: [{ text: 'Note' }], align: 'center' }] },
      { cells: [{ runs: [{ text: 'Pen' }], align: 'left' }, { runs: [{ text: '2' }], align: 'right' }, { runs: [{ text: 'blue', italic: true }], align: 'center' }] },
      { cells: [{ runs: [{ text: 'Ink | cartridge' }], align: 'left' }, { runs: [{ text: '10' }], align: 'right' }, { runs: [], align: 'center' }] },
    ],
  });
  assert.deepEqual(b[10], { type: 'paragraph', runs: [{ text: 'Quoted ', italic: true }, { text: 'text', bold: true, italic: true }, { text: ' goes on', italic: true }], indent: 1 });
  assert.deepEqual(b[11], { type: 'paragraph', runs: [{ text: 'bold italic', bold: true, italic: true }, { text: ' end' }] });
  assert.equal(b.length, 12);
});

test('csv: separator found, header row, numbers right-aligned, limits', () => {
  const res = toBlocks(Buffer.from('Name;Amount;Note\n"Smith; J.";1.234,50;"said ""hi"""\nLee;-12;\n'), 'csv');
  assert.deepEqual(res.blocks, [{
    type: 'table', rows: [
      { header: true, cells: [{ runs: [{ text: 'Name' }] }, { runs: [{ text: 'Amount' }] }, { runs: [{ text: 'Note' }] }] },
      { cells: [{ runs: [{ text: 'Smith; J.' }] }, { runs: [{ text: '1.234,50' }], align: 'right' }, { runs: [{ text: 'said "hi"' }] }] },
      { cells: [{ runs: [{ text: 'Lee' }] }, { runs: [{ text: '-12' }], align: 'right' }, { runs: [] }] },
    ],
  }]);
  assert.equal(res.landscape, false);
  const tabs = toBlocks(Buffer.from('a\tb\tc\td\te\tf\tg\n1\t2\t3\t4\t5\t6\t$7.00\n'), 'csv');
  assert.equal(tabs.blocks[0].rows[0].cells.length, 7);
  assert.equal(tabs.blocks[0].rows[1].cells[6].align, 'right');
  assert.equal(tabs.landscape, true);
  const big = toBlocks(Buffer.from(Array.from({ length: 2100 }, (_, i) => `${i},${Array.from({ length: 50 }, () => 'x').join(',')}`).join('\n')), 'csv');
  assert.equal(big.blocks[0].rows.length, 2000);
  assert.equal(big.blocks[0].rows[0].cells.length, 40);
  assert.deepEqual(big.warnings, ['Only the first 2,000 rows were kept.', 'Only the first 40 columns were kept.']);
});

test('html: safe, limited conversion', () => {
  const html = `<!DOCTYPE html><html><head><title>My &amp; page</title><style>p { color: red }</style>
    <script>document.write("<p>injected</p>")</script></head><body>
    <!-- a comment <p>hidden</p> -->
    <h1>Welcome&nbsp;home</h1><h5>Small</h5>
    <p align="center">Text with <b>bold</b>, <em>em</em>, <u>under</u>, <code>x = 1</code> and <a href="https://example.com">link</a>
      and <a href="javascript:alert(1)">bad</a>.<br>New line &ndash; &mdash; &hellip; &rsquo;&copy;&euro;&peso;&#8364;&#x41;&eacute;&unknown;</p>
    <ul><li>One<ul><li>One A</li></ul></li><li>Two</li></ul>
    <ol start="5"><li>Five</li></ol>
    <pre>  line 1
  &lt;b&gt;line 2&lt;/b&gt;</pre>
    <hr>
    <table><thead><tr><th>H1</th><th colspan="2">H2</th></tr></thead><tbody><tr><td>a<br>b</td><td align="right">1</td><td><p>x</p><p>y</p></td></tr></tbody></table>
    <p><img src="data:image/png;base64,${PNG.toString('base64')}" alt="dot" width="100" height="50"> <img src="https://example.com/x.png" alt="remote"></p>
    <blockquote>Said once</blockquote>
    <iframe src="https://evil.example">frame</iframe><noscript>nojs</noscript>
    loose text</body></html>`;
  const res = toBlocks(Buffer.from(html), 'html');
  assert.equal(res.title, 'My & page');
  const b = res.blocks;
  assert.deepEqual(b[0], { type: 'heading', level: 1, runs: [{ text: 'Welcome home' }] });
  assert.deepEqual(b[1], { type: 'heading', level: 4, runs: [{ text: 'Small' }] });
  assert.deepEqual(b[2], {
    type: 'paragraph', align: 'center', runs: [
      { text: 'Text with ' }, { text: 'bold', bold: true }, { text: ', ' }, { text: 'em', italic: true }, { text: ', ' },
      { text: 'under', underline: true }, { text: ', ' }, { text: 'x = 1', mono: true }, { text: ' and ' },
      { text: 'link', link: 'https://example.com' }, { text: ' and bad.\nNew line – — … ’©€₱€Aé&unknown;' },
    ],
  });
  assert.deepEqual(b[3], { type: 'list', ordered: false, items: [{ runs: [{ text: 'One' }], level: 0 }, { runs: [{ text: 'One A' }], level: 1 }, { runs: [{ text: 'Two' }], level: 0 }] });
  assert.deepEqual(b[4], { type: 'list', ordered: true, start: 5, items: [{ runs: [{ text: 'Five' }], level: 0 }] });
  assert.deepEqual(b[5], { type: 'code', text: '  line 1\n  <b>line 2</b>' });
  assert.deepEqual(b[6], { type: 'rule' });
  assert.deepEqual(b[7], {
    type: 'table', rows: [
      { header: true, cells: [{ runs: [{ text: 'H1', bold: true }] }, { runs: [{ text: 'H2', bold: true }], colspan: 2 }] },
      { cells: [{ runs: [{ text: 'a\nb' }] }, { runs: [{ text: '1' }], align: 'right' }, { runs: [{ text: 'x\ny' }] }] },
    ],
  });
  assert.deepEqual(b[8], { type: 'image', data: PNG, mime: 'image/png', width: 75, height: 37.5, alt: 'dot' });
  assert.deepEqual(b[9], { type: 'paragraph', runs: [{ text: 'remote', italic: true }] });
  assert.deepEqual(b[10], { type: 'paragraph', runs: [{ text: 'Said once' }], indent: 1 });
  assert.deepEqual(b[11], { type: 'paragraph', runs: [{ text: 'loose text' }] });
  assert.equal(b.length, 12);
  const all = JSON.stringify(b);
  for (const word of ['injected', 'hidden', 'color: red', 'frame', 'nojs']) assert.ok(!all.includes(word), word);
});

test('readZip: names, stored and deflated parts, and unsafe names refused', () => {
  const z = readZip(zip([['/a/b.txt', 'hello', { stored: true }], ['c.txt', 'world'], ['dir/', '']]));
  assert.deepEqual(z.names, ['a/b.txt', 'c.txt']);
  assert.equal(z.has('a/b.txt'), true);
  assert.equal(z.has('A/B.TXT'), true, 'part names are not case-sensitive');
  assert.equal(z.read('a/b.txt').toString(), 'hello');
  assert.equal(z.read('c.txt').toString(), 'world');
  assert.throws(() => z.read('missing.txt'), /missing/);
  assert.throws(() => readZip(zip([['../evil.txt', 'x']])), /unsafe name/);
  assert.throws(() => readZip(zip([['word/../../evil.txt', 'x']])), /unsafe name/);
  assert.throws(() => readZip(Buffer.from('PK not really')), /damaged/);
  // Files made by server/zip.js read back too.
  const made = readZip(zipFiles([{ name: 'note.txt', buffer: Buffer.from('from zipFiles'), type: 'text/plain' }, { name: 'pic.png', buffer: PNG, type: 'image/png' }]));
  assert.equal(made.read('note.txt').toString(), 'from zipFiles');
  assert.deepEqual(made.read('pic.png'), PNG);
});

test('readZip: zip bombs stop at the limits', () => {
  const big = Buffer.alloc(5 * 1024 * 1024, 0x41); // 5 MB of "A" packs into a few KB
  const honest = zip([['bomb.xml', big]]);
  assert.ok(honest.length < 20000);
  assert.throws(() => readZip(honest, { maxEntryBytes: 1024 * 1024 }).read('bomb.xml'), /far more data/);
  // The directory lies about the size: inflating itself stops at the limit.
  const liar = zip([['bomb.xml', big, { size: 100 }]]);
  assert.throws(() => readZip(liar, { maxEntryBytes: 1024 * 1024 }).read('bomb.xml'), /far more data/);
  // Several parts under the per-part limit, over the total.
  const many = zip([['a', big], ['b', big], ['c', big]]);
  const z = readZip(many, { maxEntryBytes: 6 * 1024 * 1024, maxTotalBytes: 12 * 1024 * 1024 });
  z.read('a');
  z.read('b');
  assert.throws(() => z.read('c'), /far more data/);
  assert.throws(() => readZip(zip([['a', 'x'], ['b', 'y'], ['c', 'z']]), { maxEntries: 2 }), /more than the 2/);
  // Through toBlocks, the message is for the user.
  const doc = zip([['word/document.xml', Buffer.concat([Buffer.from(`<w:document ${W}><w:body><w:p><w:r><w:t>`), big])]]);
  assert.ok(toBlocks(doc, 'docx').blocks.length === 1, 'within the default limits it reads');
});

test('readZip: encrypted entries, ZIP64 and unknown methods are refused', () => {
  assert.throws(() => readZip(zip([['secret.xml', 'x', { flags: 1 }]])), /protected with a password/);
  assert.throws(() => toBlocks(zip([['word/document.xml', 'x', { flags: 1 }]]), 'docx', { fileName: 'pay.docx' }), /“pay\.docx” is protected with a password/);
  const z64 = zip([['a', 'x']]);
  z64.writeUInt16LE(0xffff, z64.length - 22 + 10);
  assert.throws(() => readZip(z64), /ZIP64/);
  const bz = zip([['a', 'x', { stored: true }]]);
  bz.writeUInt16LE(12, 8); // the local header: bzip2
  bz.writeUInt16LE(12, 30 + 1 + 1 + 10); // the central directory entry
  assert.throws(() => readZip(bz).read('a'), /method ATLAS cannot unpack/);
});

test('parseXml: a small tree, entities, CDATA, comments; a DOCTYPE is never read', () => {
  const t = parseXml(`<?xml version="1.0"?><!-- c --><w:doc a='1' b="x &amp; y &#65;&#x42;"><w:p>Hi &lt;there&gt; <![CDATA[<raw> & ]]><w:br/></w:p><e/></w:doc>`);
  assert.deepEqual(t, {
    name: 'w:doc', attrs: { a: '1', b: 'x & y AB' }, children: [
      { name: 'w:p', attrs: {}, children: ['Hi <there> ', '<raw> & ', { name: 'w:br', attrs: {}, children: [] }] },
      { name: 'e', attrs: {}, children: [] },
    ],
  });
  const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY gt2 "a > b">]><root>&lol2; &xxe; &amp;</root>`;
  assert.deepEqual(parseXml(laughs), { name: 'root', attrs: {}, children: ['&lol2; &xxe; &'] });
  // Through a document: the entity stays as written.
  const doc = zip([['word/document.xml', `<!DOCTYPE w [<!ENTITY e "EXPANDED">]><w:document ${W}><w:body>${p(r('&e;'))}</w:body></w:document>`]]);
  assert.deepEqual(toBlocks(doc, 'docx').blocks, [{ type: 'paragraph', runs: [{ text: '&e;' }] }]);
  assert.throws(() => parseXml('no tags'), /not an XML document/);
  // Lenient with a closing tag that does not match.
  assert.deepEqual(parseXml('<a><b>x</c></b></a>'), { name: 'a', attrs: {}, children: [{ name: 'b', attrs: {}, children: ['x'] }] });
});

test('parseXml: a 10 MB part parses quickly', () => {
  const para = '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Some text &amp; more text in a run. </w:t></w:r></w:p>';
  const xml = `<w:document><w:body>${para.repeat(Math.ceil((10 * 1024 * 1024) / para.length))}</w:body></w:document>`;
  const t0 = Date.now();
  const tree = parseXml(xml);
  const ms = Date.now() - t0;
  assert.ok(tree.children[0].children.length > 60000);
  assert.ok(ms < 5000, `took ${ms} ms`);
  // Deep nesting does not overflow the stack.
  const deep = `${'<a>'.repeat(50000)}x${'</a>'.repeat(50000)}`;
  assert.equal(parseXml(deep).name, 'a');
  const nested = (n) => zip([['word/document.xml', `<w:document ${W}><w:body>${'<w:sdt><w:sdtContent>'.repeat(n)}${p(r('deep'))}</w:body></w:document>`]]);
  assert.deepEqual(toBlocks(nested(400), 'docx').blocks, [{ type: 'paragraph', runs: [{ text: 'deep' }] }]);
  assert.ok(Array.isArray(toBlocks(nested(5000), 'docx').blocks), 'past 1,000 levels the rest is flattened, without a crash');
});

test('xlsx number formats: shown as Excel shows them (QA 0.65.1)', async () => {
  const { formatExcel } = await import('../server/pdf/xlsx-format.js');
  const cases = [
    [0.12345, '0%', '12%'], [1234.5, '#,##0.00', '1,234.50'], [1234.5, '"₱"#,##0.00', '₱1,234.50'], [1234.5, '[$₱-3409]#,##0.00', '₱1,234.50'],
    [46096, 'dd/mm/yyyy', '15/03/2026'], [46096, 'mmm d, yyyy', 'Mar 15, 2026'], [46096, 'dddd, mmmm d', 'Sunday, March 15'],
    [46096.5625, 'h:mm AM/PM', '1:30 PM'], [1.5, '[h]:mm', '36:00'], [-1234.5, '#,##0.00;(#,##0.00)', '(1,234.50)'], [-5, '0.0', '-5.0'],
    [0, '#,##0.00;(#,##0.00);"-"', '-'], [1234567, '#,##0,', '1,235'], [5, '00', '05'], [0.5, '0.0%', '50.0%'],
  ];
  for (const [n, code, shown] of cases) assert.equal(formatExcel(n, code), shown, code);
  for (const code of ['General', '@', '0.00E+00', '# ?/?', '[>100]0']) assert.equal(formatExcel(12, code), null, `${code}: the plain number instead`);
});

// Node 20's TextDecoder('windows-1252') reads Latin-1 (0x80-0x9F as control characters): ATLAS
// decodes Windows-1252 itself, the same on every Node.
test('Windows-1252 is decoded by ATLAS, the same on every Node.js', async () => {
  const { decodeCp1252, decodeAs, isCp1252Label } = await import('../server/pdf/cp1252.js');
  assert.equal(decodeCp1252(Buffer.from([0x80, 0x20, 0x93, 0x51, 0x94, 0x96, 0x97, 0x85, 0x99, 0x8c, 0x9f, 0xe9])), '€ “Q”–—…™ŒŸé');
  assert.equal(decodeCp1252(Buffer.from([0x81, 0x8d, 0x8f, 0x90, 0x9d])), '\x81\x8d\x8f\x90\x9d', 'the five unassigned bytes stay as they are (WHATWG)');
  for (const l of ['windows-1252', 'ISO-8859-1', 'latin1', 'us-ascii']) assert.ok(isCp1252Label(l), l);
  assert.equal(decodeAs('iso-8859-1', Buffer.from([0x80])), '€');
  assert.equal(decodeAs('utf-8', Buffer.from('é')), 'é');
  assert.throws(() => decodeAs('no-such-charset', Buffer.from('x')));
});
