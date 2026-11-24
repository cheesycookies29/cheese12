// PDF Studio (0.65): pages drawn as SVG on the server, their text found as runs, and chosen runs
// taken out of a page. Pages are made with PdfWriter, or by hand for operators the writer never
// writes (TJ kerning, spacing, ' and ", Type0 fonts, /Differences, LZW); the SVG is checked for
// being well-formed and safe, pictures for being data: URLs with the right pixels, and runs for
// their text and place. Removing text is checked by drawing the changed page again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { readPdf, importPages } from '../server/pdf/reader.js';
import { renderPage, removeTextOps } from '../server/pdf/render.js';
import { PdfWriter, Content, FONTS, name, ref, textWidth } from '../server/pdf/writer.js';

const fixture = (f) => fs.readFileSync(new URL(`../scripts/fixtures/${f}`, import.meta.url));
const photo = fixture('profile-sample.jpg');
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} is not within ${tol} of ${b}`);

// The SVG is well-formed XML: every "<" starts a tag, tags nest, text and attribute values have
// no raw "<" or stray "&".
function wellFormed(svg) {
  const stack = [];
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/y;
  let i = 0;
  while (i < svg.length) {
    if (svg[i] === '<') {
      tag.lastIndex = i;
      const m = tag.exec(svg);
      assert.ok(m, `a tag at ${i}: ${svg.slice(i, i + 60)}`);
      for (const [, v] of m[3].matchAll(/="([^"]*)"/g)) assert.doesNotMatch(v, /&(?!(amp|lt|gt|quot|apos);)/, 'an attribute value is escaped');
      if (m[1]) assert.equal(stack.pop(), m[2], `</${m[2]}> closes what was opened`);
      else if (!m[4]) stack.push(m[2]);
      i = tag.lastIndex;
    } else {
      const next = svg.indexOf('<', i);
      const text = svg.slice(i, next < 0 ? svg.length : next);
      assert.doesNotMatch(text, /&(?!(amp|lt|gt|quot|apos);)|>/, 'text is escaped');
      i = next < 0 ? svg.length : next;
    }
  }
  assert.deepEqual(stack, [], 'every tag is closed');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+"/);
}
// Nothing in it can run or load anything.
function safe(svg) {
  assert.doesNotMatch(svg, /<script|<foreignObject|\son\w+=|javascript:/i);
  for (const [, v] of svg.matchAll(/href="([^"]*)"/g)) assert.match(v, /^(data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+|#[\w-]+)$/);
}
// The pixels of a PNG the renderer made: { width, height, type, channels, pixels }.
function readPng(buf) {
  assert.equal(buf.readUInt32BE(0), 0x89504e47);
  let at = 8;
  let ihdr = null;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), type: data[9] };
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const channels = { 0: 1, 4: 2, 2: 3, 6: 4 }[ihdr.type];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  const pixels = Buffer.alloc(stride * ihdr.height);
  for (let y = 0; y < ihdr.height; y++) {
    assert.equal(raw[y * (stride + 1)], 0, 'filter 0');
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { ...ihdr, channels, pixels };
}
const dataUrls = (svg, type) => [...svg.matchAll(new RegExp(`href="data:image/${type};base64,([^"]+)"`, 'g'))].map((m) => Buffer.from(m[1], 'base64'));

// A PDF put together object by object.
class HandPdf {
  constructor() {
    this.parts = [];
    this.length = 0;
    this.offsets = {};
    this.text('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  }
  push(buf) { this.parts.push(buf); this.length += buf.length; return this; }
  text(s) { return this.push(Buffer.from(s, 'latin1')); }
  obj(num, body) { this.offsets[num] = this.length; return this.text(`${num} 0 obj\n${body}\nendobj\n`); }
  stream(num, dict, data) {
    this.offsets[num] = this.length;
    const buf = Buffer.from(data, 'latin1');
    return this.text(`${num} 0 obj\n<<${dict} /Length ${buf.length}>>\nstream\n`).push(buf).text('\nendstream\nendobj\n');
  }
  buffer(root = 1) {
    const at = this.length;
    const max = Math.max(...Object.keys(this.offsets).map(Number)) + 1;
    let s = `xref\n0 ${max}\n0000000000 65535 f \n`;
    for (let n = 1; n < max; n++) s += this.offsets[n] === undefined ? '0000000000 00000 f \n' : `${String(this.offsets[n]).padStart(10, '0')} 00000 n \n`;
    this.text(`${s}trailer\n<</Root ${root} 0 R /Size ${max}>>\nstartxref\n${at}\n%%EOF\n`);
    return Buffer.concat(this.parts);
  }
}

// A page made by hand: TJ kerning, Tz/Tc/Tw, ' and ", a Type0 font with ToUnicode and /W, a
// simple font with /Differences, invisible (OCR) text, characters that need escaping.
const CMAP = [
  '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
  '1 begincodespacerange <0000> <FFFF> endcodespacerange',
  '2 beginbfchar <0001> <0048> <0002> <00E9> endbfchar',
  '1 beginbfrange <0010> <0012> <0061> endbfrange',
  'endcmap CMapName currentdict /CMap defineresource pop end end',
].join('\n');
const HAND_CONTENT = [
  'BT /F1 10 Tf 1 0 0 1 50 700 Tm [(A) 120 (B) -500 (C)] TJ ET', // 0
  // Spacing is part of the graphics state and lasts past ET, so these two are kept in q … Q.
  'q BT /F1 10 Tf 50 600 Td 50 Tz 1 Tc 2 Tw (a b) Tj ET Q', // 1
  'q BT /F1 10 Tf 14 TL 50 500 Td (Line one) Tj (Line two) \' 3 0.5 (Line three) " ET Q', // 2 3 4
  'BT /F1 10 Tf 50 400 Td (Remove me) Tj 80 0 Td (keep) Tj ET', // 5 6 (a column apart: two runs)
  'BT /F2 20 Tf 50 300 Td <0001000200100011> Tj ET', // 7
  'BT /F3 12 Tf 50 250 Td (ABC) Tj ET', // 8
  'BT /F1 9 Tf 3 Tr 50 200 Td (hidden ocr) Tj 0 Tr ET', // 9
  'BT /F1 9 Tf 50 150 Td (a < b & c > d) Tj ET', // 10
  '0.2 0.4 0.6 rg 300 100 50 40 re f',
].join('\n');
function handPdf(content = HAND_CONTENT) {
  const pdf = new HandPdf();
  pdf.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  pdf.obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  pdf.obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 8 0 R >> >> /Contents 9 0 R >>');
  pdf.obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  pdf.obj(5, '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+NotoSerif-Bold /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>');
  pdf.obj(6, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+NotoSerif-Bold /W [1 [500 600] 16 18 400] /DW 1000 >>');
  pdf.stream(7, '', CMAP);
  pdf.obj(8, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /FirstChar 65 /Widths [444 611 556] /Encoding << /BaseEncoding /WinAnsiEncoding /Differences [65 /eacute /uni0141 /f_i] >> >>');
  pdf.stream(9, '', content);
  return pdf.buffer();
}

test('runs: TJ kerning, Tz/Tc/Tw, \' and ", Type0 with ToUnicode and /W, /Differences, invisible text', () => {
  const doc = readPdf(handPdf());
  const page = renderPage(doc, 0);
  assert.equal(page.error, undefined);
  assert.deepEqual([page.width, page.height, page.rotate], [612, 792, 0]);
  const byId = Object.fromEntries(page.runs.map((r) => [r.id, r]));
  assert.deepEqual(page.runs.map((r) => r.id), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  // [(A) 120 (B) -500 (C)]: A 667, B 667, C 722 thousandths at 10 pt; 120 pulls B back, -500 is a word gap.
  const tj = byId[0];
  assert.equal(tj.text, 'AB C');
  near(tj.x, 50, 0.01, 'TJ x');
  near(tj.width, 6.67 - 1.2 + 6.67 + 5 + 7.22, 0.01, 'TJ width');
  near(tj.y, 700 - 2, 0.01, 'TJ bottom (descent 0.2 em)');
  near(tj.height, 10, 0.01, 'TJ height');
  assert.deepEqual(tj.matrix, [1, 0, 0, 1, 50, 700]);
  assert.equal(tj.size, 10);
  assert.deepEqual([tj.family, tj.bold, tj.italic, tj.invisible, tj.editable], ['sans', false, false, false, true]);

  // 50 Tz 1 Tc 2 Tw (a b): each glyph (w × size + Tc (+ Tw for the space)) × 0.5.
  near(byId[1].width, ((5.56 + 1) + (2.78 + 1 + 2) + (5.56 + 1)) * 0.5, 0.01, 'Tz/Tc/Tw width');

  // ' and " move to the next line (TL 14); " sets Tw 3 and Tc 0.5 first.
  assert.deepEqual([2, 3, 4].map((i) => byId[i].text), ['Line one', 'Line two', 'Line three']);
  assert.deepEqual([2, 3, 4].map((i) => byId[i].matrix[5]), [500, 486, 472]);
  near(byId[4].width, textWidth('Line three', FONTS.regular, 10) + 10 * 0.5 + 3, 0.01, '" width');

  // Two pieces of text a column apart on one line stay two runs.
  near(byId[6].x, 130, 0.01, 'second Tj x');
  assert.deepEqual([byId[5].ops, byId[6].ops], [[5], [6]]);

  // Type0, Identity-H: codes 1, 2, 16, 17 → "Héab"; widths 500, 600, 400, 400 at 20 pt.
  assert.equal(byId[7].text, 'Héab');
  near(byId[7].width, (0.5 + 0.6 + 0.4 + 0.4) * 20, 0.01, 'CID widths');
  assert.deepEqual([byId[7].family, byId[7].bold], ['serif', true]);

  // /Differences: eacute, uni0141, f_i; /Widths from FirstChar 65.
  assert.equal(byId[8].text, 'éŁfi');
  near(byId[8].width, (0.444 + 0.611 + 0.556) * 12, 0.01, '/Widths');
  assert.deepEqual([byId[8].family, byId[8].italic], ['serif', true]);

  // Text render mode 3 (OCR over a scan): a run, but not drawn.
  assert.equal(byId[9].invisible, true);
  assert.doesNotMatch(page.svg, /hidden ocr/);
  assert.equal(byId[10].text, 'a < b & c > d');

  wellFormed(page.svg);
  safe(page.svg);
  assert.match(page.svg, /a &lt; b &amp; c &gt; d/);
  assert.match(page.svg, /textLength="[\d.]+" lengthAdjust="spacingAndGlyphs"/);
  assert.match(page.svg, /fill="#336699"/);
  assert.match(page.svg, /font-family="serif" font-size="20" font-weight="bold"/);
  // A large TJ gap splits the SVG text, so the browser's font cannot stretch over it.
  assert.match(page.svg, />AB<\/text>.*>C<\/text>/);
});

test('a page from PdfWriter: fonts, rotated text, colour, a clip, a JPEG, a PNG with soft mask, a form', () => {
  const w = new PdfWriter();
  const jpeg = w.stream({ Type: name('XObject'), Subtype: name('Image'), Width: 640, Height: 480, ColorSpace: name('DeviceRGB'), BitsPerComponent: 8, Filter: name('DCTDecode') }, photo);
  // A 16 × 8 RGB picture (red on the left, blue on the right) with a soft mask fading left to right.
  const rgb = Buffer.alloc(16 * 8 * 3);
  const alpha = Buffer.alloc(16 * 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      const i = y * 16 + x;
      rgb[i * 3] = x < 8 ? 255 : 0;
      rgb[i * 3 + 2] = x < 8 ? 0 : 255;
      alpha[i] = x * 16;
    }
  }
  const smask = w.stream({ Type: name('XObject'), Subtype: name('Image'), Width: 16, Height: 8, ColorSpace: name('DeviceGray'), BitsPerComponent: 8 }, alpha);
  const png = w.stream({ Type: name('XObject'), Subtype: name('Image'), Width: 16, Height: 8, ColorSpace: name('DeviceRGB'), BitsPerComponent: 8, SMask: ref(smask) }, rgb);
  const formContent = new Content().text(0, 0, 'In a form', FONTS.regular, 8);
  const form = w.stream({ Type: name('XObject'), Subtype: name('Form'), BBox: [0, -5, 100, 20], Matrix: [1, 0, 0, 1, 300, 100], Resources: w.resourcesFor(formContent) }, formContent.toBuffer());
  const c = new Content()
    .text(72, 700, 'Hello world', FONTS.regular, 12)
    .text(72, 650, 'Bold heading', FONTS.bold, 18)
    .text(72, 620, 'Serif body', FONTS.serif, 11)
    .text(72, 600, 'mono()', FONTS.mono, 10)
    .textRotated(300, 300, 'Turned', FONTS.regular, 14, 90)
    .color(1, 0, 0).rect(400, 600, 100, 50, { fill: true, stroke: false })
    .raw('q 50 50 100 100 re W n 0 0 1 rg 0 0 612 792 re f Q')
    .image('Im1', 72, 400, 160, 120)
    .image('Im2', 300, 400, 32, 16)
    .raw('/Fm1 Do');
  w.addPage({ MediaBox: [0, 0, 612, 792], Resources: w.resourcesFor(c, { XObject: { Fm1: ref(form) } }, { Im1: jpeg, Im2: png }), Contents: ref(w.stream({}, c.toBuffer())) });
  const doc = readPdf(w.toBuffer());
  const page = renderPage(doc, 0);
  assert.equal(page.error, undefined);
  wellFormed(page.svg);
  safe(page.svg);

  const run = (t) => page.runs.find((r) => r.text === t);
  near(run('Hello world').x, 72, 0.01, 'x');
  near(run('Hello world').width, textWidth('Hello world', FONTS.regular, 12), 0.01, 'width');
  assert.deepEqual(run('Hello world').matrix, [1, 0, 0, 1, 72, 700]);
  assert.equal(run('Bold heading').bold, true);
  assert.equal(run('Serif body').family, 'serif');
  near(run('Serif body').width, textWidth('Serif body', FONTS.serif, 11), 0.01, 'Times widths');
  assert.equal(run('mono()').family, 'mono');
  const turned = run('Turned');
  assert.deepEqual(turned.matrix.map((v) => Math.round(v * 1000) / 1000), [0, 1, -1, 0, 300, 300]);
  near(turned.height, textWidth('Turned', FONTS.regular, 14), 0.01, 'a turned run is tall');
  const inForm = run('In a form');
  assert.equal(inForm.editable, false);
  assert.ok(inForm.id < 0, 'runs in forms have ids of their own');
  near(inForm.x, 300, 0.01, 'the form matrix applies');
  assert.deepEqual(page.runs.filter((r) => r.editable).map((r) => r.id), [0, 1, 2, 3, 4]);

  assert.match(page.svg, /fill="#ff0000"/);
  assert.match(page.svg, /<clipPath id="c\d+"><path d="M50 50L150 50L150 150L50 150Z"\/><\/clipPath><g clip-path="url\(#c\d+\)"><path d="M0 0L612 0L612 792L0 792Z" fill="#0000ff"\/><\/g>/);
  const [jpg] = dataUrls(page.svg, 'jpeg');
  assert.ok(jpg.equals(photo), 'the JPEG as it is');
  const pngs = dataUrls(page.svg, 'png').map(readPng);
  const pic = pngs.find((p) => p.width === 16);
  assert.deepEqual([pic.height, pic.channels], [8, 4]);
  assert.deepEqual([...pic.pixels.subarray(0, 4)], [255, 0, 0, 0]);
  assert.deepEqual([...pic.pixels.subarray(15 * 4, 16 * 4)], [0, 0, 255, 240]);
  // The image maps the unit square through the CTM, first row at the top.
  assert.match(page.svg, /<use href="#i\d+" transform="matrix\(160 0 0 -120 72 520\)"\/>/);
  // The page's rotation is left to the browser; the box is the visible one.
  assert.match(page.svg, /viewBox="0 0 612 792"/);
});

test('crop box, rotation and placeholders for pictures that cannot be shown', () => {
  const pdf = new HandPdf();
  pdf.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  pdf.obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  pdf.obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /CropBox [100 50 500 750] /Rotate 90 /Resources << /Font << /F1 4 0 R >> /XObject << /J 5 0 R /I 6 0 R /M 7 0 R >> >> /Contents 8 0 R >>');
  pdf.obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  pdf.stream(5, ' /Type /XObject /Subtype /Image /Width 10 /Height 10 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JPXDecode', 'not really jpx');
  // A 2 × 2 Indexed picture (red, green / blue, white) and a 1-bit stencil mask.
  pdf.stream(6, ' /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace [/Indexed /DeviceRGB 3 <FF0000 00FF00 0000FF FFFFFF>] /BitsPerComponent 8', '\x00\x01\x02\x03');
  pdf.stream(7, ' /Type /XObject /Subtype /Image /Width 8 /Height 1 /ImageMask true', '\x0f');
  pdf.stream(8, '', 'BT /F1 10 Tf 150 100 Td (Courier) Tj ET q 10 0 0 10 120 200 cm /J Do Q q 10 0 0 10 120 300 cm /I Do Q 0 1 0 rg q 80 0 0 10 120 400 cm /M Do Q q 10 0 0 10 120 500 cm BI /W 4 /H 4 /CS /G /BPC 8 ID \x00EI\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d EI Q BT /F1 10 Tf 150 90 Td (after) Tj ET');
  const doc = readPdf(pdf.buffer());
  const page = renderPage(doc, 0);
  assert.deepEqual([page.width, page.height, page.rotate], [400, 700, 90]);
  assert.match(page.svg, /viewBox="0 0 400 700"/);
  assert.match(page.svg, /<g transform="matrix\(1 0 0 -1 -100 750\)">/);
  const courier = page.runs[0];
  near(courier.x, 50, 0.01, 'x from the crop box');
  near(courier.width, 7 * 6, 0.01, 'Courier is 600 wide');
  assert.equal(courier.family, 'mono');
  assert.equal(page.runs[1].text, 'after', 'the inline image is skipped whole, even with "EI" inside it');
  wellFormed(page.svg);
  safe(page.svg);
  assert.match(page.svg, /<path d="M120 200L130 200L130 210L120 210Z" fill="#d9d9d9"\/>/, 'JPX: a grey box');
  assert.match(page.svg, /<path d="M120 500L130 500L130 510L120 510Z" fill="#d9d9d9"\/>/, 'inline image: a grey box');
  const pngs = dataUrls(page.svg, 'png').map(readPng);
  const indexed = pngs.find((p) => p.width === 2);
  assert.deepEqual([...indexed.pixels], [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const stencil = pngs.find((p) => p.width === 8);
  assert.deepEqual([...stencil.pixels.subarray(0, 4)], [0, 255, 0, 255], 'bit 0: painted in the fill colour');
  assert.deepEqual([...stencil.pixels.subarray(28, 32)], [0, 0, 0, 0], 'bit 1: clear');
});

// LZW, as old PDFs compress content (9–12-bit codes, early change).
function lzwEncode(data) {
  const out = [];
  let acc = 0;
  let have = 0;
  let bits = 9;
  const put = (code) => {
    acc = (acc << bits) | code;
    have += bits;
    while (have >= 8) { out.push((acc >>> (have - 8)) & 255); have -= 8; }
    acc &= (1 << have) - 1;
  };
  let dict = new Map();
  let next = 258;
  put(256);
  let w = '';
  for (const c of data.toString('latin1')) {
    const wc = w + c;
    if (wc.length === 1 || dict.has(wc)) { w = wc; continue; }
    put(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
    dict.set(wc, next++);
    if (next + 1 > 1 << bits && bits < 12) bits++;
    if (next >= 4094) { put(256); dict = new Map(); next = 258; bits = 9; }
    w = c;
  }
  if (w) put(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
  put(257);
  if (have) out.push((acc << (8 - have)) & 255);
  return Buffer.from(out);
}

test('content compressed with LZW, ASCII85 over Flate, and several content streams', () => {
  const text = 'BT /F1 10 Tf 50 700 Td (Squeezed with LZW, the old way) Tj ET '.repeat(30);
  const pdf = new HandPdf();
  pdf.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  pdf.obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  pdf.obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents [5 0 R 6 0 R] >>');
  pdf.obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pdf.stream(5, ' /Filter /LZWDecode', lzwEncode(Buffer.from(text, 'latin1')).toString('latin1'));
  pdf.stream(6, ' /Filter [/ASCIIHexDecode /FlateDecode]', `${deflateSync(Buffer.from('BT /F1 10 Tf 50 600 Td (Second stream) Tj ET')).toString('hex')}>`);
  const doc = readPdf(pdf.buffer());
  const page = renderPage(doc, 0);
  assert.equal(page.runs.length, 31);
  assert.equal(page.runs[0].text, 'Squeezed with LZW, the old way');
  assert.equal(page.runs[30].text, 'Second stream');
  assert.equal(page.runs[30].id, 30);
});

// Puts new content on page `index` of `doc` (as the caller does) and reads the result back.
function withContent(doc, index, content) {
  const w = new PdfWriter();
  const [dict] = importPages(doc, w, [index]);
  dict.Contents = ref(w.stream({}, content));
  w.addPage(dict);
  return readPdf(w.toBuffer());
}

test('removeTextOps: the chosen text goes, everything after it stays where it was', () => {
  const doc = readPdf(handPdf());
  const before = renderPage(doc, 0);
  const at = (page, text) => page.runs.find((r) => r.text === text);

  // Nothing removed: the content as it was, byte for byte (one stream, then a line break).
  assert.equal(removeTextOps(doc, 0, []).toString('latin1'), `${HAND_CONTENT}\n`);

  const out = removeTextOps(doc, 0, [0, 1, 3, 5, 8]);
  const text = out.toString('latin1');
  assert.doesNotMatch(text, /\(A\)|\(a b\)|Line two|Remove me|\(ABC\)/);
  assert.match(text, /\(Line one\) Tj T\* \[-?[\d.]+\] TJ 3 0\.5 \(Line three\) "/);
  // Only the removed operators changed.
  assert.equal(text.replace(/\[-?[\d.]+\] TJ/g, '#'), `${HAND_CONTENT}\n`
    .replace('[(A) 120 (B) -500 (C)] TJ', '#').replace('(a b) Tj', '#').replace("(Line two) '", 'T* #').replace('(Remove me) Tj', '#').replace('(ABC) Tj', '#'));

  const after = renderPage(withContent(doc, 0, out), 0);
  for (const gone of ['AB C', 'a b', 'Line two', 'Remove me', 'éŁfi']) assert.equal(at(after, gone), undefined, gone);
  near(at(after, 'keep').x, at(before, 'keep').x, 0.5, 'the text after it on the line');
  assert.deepEqual(at(after, 'Line three').matrix, at(before, 'Line three').matrix, 'the line after a removed \'');
  assert.ok(!after.svg.includes('Remove me'));

  // A removed " keeps its word and character spacing for what follows.
  const quoted = removeTextOps(doc, 0, [4]).toString('latin1');
  assert.match(quoted, /\(Line two\) ' 3 Tw 0\.5 Tc T\* \[-?[\d.]+\] TJ ET Q/);

});

test('a line shown a word at a time is one run; its id removes the whole line, an operator id one word', () => {
  // As ATLAS's layout and many programs write lines: one Tj per word, in a compressed stream.
  const w = new PdfWriter();
  const c = new Content().raw('BT /F1 12 Tf 72 700 Td (Dear) Tj ( Sir,) Tj ( Madam) Tj ET').text(72, 680, 'Signed', FONTS.regular, 12);
  c.fonts.add(FONTS.regular);
  w.addContentPage(c, [612, 792]);
  const doc = readPdf(w.toBuffer());
  const page = renderPage(doc, 0);
  assert.deepEqual(page.runs.map((r) => [r.id, r.text, r.ops]), [[0, 'Dear Sir, Madam', [0, 1, 2]], [3, 'Signed', [3]]]);
  const line = page.runs[0];
  near(line.x, 72, 0.01, 'line x');
  near(line.width, textWidth('Dear Sir, Madam', FONTS.regular, 12), 0.01, 'line width');
  assert.deepEqual(line.matrix, [1, 0, 0, 1, 72, 700]);

  // The line's id: every word of it goes.
  const whole = renderPage(withContent(doc, 0, removeTextOps(doc, 0, [line.id])), 0);
  assert.deepEqual(whole.runs.map((r) => r.text), ['Signed']);
  // One operator's id (not a line's): only that word goes, and the next stays where it was.
  const madamX = 72 + textWidth('Dear Sir,', FONTS.regular, 12); // where " Madam" starts
  const one = renderPage(withContent(doc, 0, removeTextOps(doc, 0, [1])), 0);
  assert.deepEqual(one.runs.map((r) => r.text), ['Dear', 'Madam', 'Signed'], 'a word gap now splits the line');
  near(one.runs[1].x, madamX, 0.5, 'Madam stays put');
});

test('the scanned fixture: one JPEG, no text', () => {
  const doc = readPdf(fixture('Scanned acceptance NSU-2025-118.pdf'));
  const page = renderPage(doc, 0);
  assert.deepEqual([page.width, page.height, page.rotate, page.runs.length], [620, 800, 0, 0]);
  wellFormed(page.svg);
  safe(page.svg);
  const [jpg] = dataUrls(page.svg, 'jpeg');
  assert.equal(jpg.length, 28599);
  assert.match(page.svg, /transform="matrix\(620 0 0 -800 0 800\)"/);
});

test('bad input: a white page with an error, never a throw; work is capped', () => {
  const doc = readPdf(handPdf('BT /F9 10 Tf (no such font) Tj ET q q q 1 0 0 1 0 0 cm 0 0 10 10 re W n [(unclosed) Tj ) ] >> << /Q ET 5 5 m 7 7 l S'));
  const page = renderPage(doc, 0);
  assert.equal(page.error, undefined);
  wellFormed(page.svg);
  assert.equal(page.runs[0].text, 'no such font');

  const missing = renderPage(doc, 7);
  assert.match(missing.error, /no page 8/);
  wellFormed(missing.svg);
  assert.deepEqual(missing.runs, []);
  assert.equal(renderPage({}, 0).error.length > 0, true);

  const capped = renderPage(readPdf(handPdf()), 0, { maxOps: 12 });
  assert.match(capped.error, /part of it is missing/);
  wellFormed(capped.svg);
  assert.ok(capped.runs.length < 11);

  const garbage = renderPage(readPdf(handPdf('\x00\xff(((( <<<< [[[[ \\ q q q W* n 1 2 3 4 5 6 cm /Fm Do BI /W 1 ID xx')), 0);
  wellFormed(garbage.svg);
  safe(garbage.svg);
});

test('a page of 2,000 lines of text draws quickly', () => {
  const lines = [];
  for (let i = 0; i < 2000; i++) lines.push(`BT /F1 8 Tf ${50 + (i % 4) * 130} ${780 - Math.floor(i / 4) * 1.5} Td [(Line ${i} with) -300 (some kerned text)] TJ ET`);
  const doc = readPdf(handPdf(lines.join('\n')));
  const t = process.hrtime.bigint();
  const page = renderPage(doc, 0);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.equal(page.runs.length, 2000);
  assert.ok(ms < 500, `drawn in ${ms} ms`);
  wellFormed(page.svg);
});

test('a page that is one big picture is shown, not a grey box (QA 0.65.2: a CV exported at 300 dpi)', () => {
  // 3000 × 3000 pixels (9 million, over the 4 million shown): an RGB Flate picture with a soft
  // mask, and a JPEG. The Flate one is shown at a lower resolution, the JPEG as it is.
  const w = 3000;
  const rgb = Buffer.alloc(w * w * 3);
  for (let i = 0; i < w * w; i++) rgb[i * 3] = i % w < 1500 ? 200 : 10; // left half red, right half dark
  const pdf = new HandPdf();
  pdf.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  pdf.obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  pdf.obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /XObject << /F 4 0 R /J 5 0 R /X 7 0 R >> >> /Contents 8 0 R >>');
  pdf.stream(4, ` /Type /XObject /Subtype /Image /Width ${w} /Height ${w} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 6 0 R /Filter /FlateDecode`, deflateSync(rgb).toString('latin1'));
  pdf.stream(5, ` /Type /XObject /Subtype /Image /Width ${w} /Height ${w} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, photo.toString('latin1'));
  pdf.stream(6, ` /Type /XObject /Subtype /Image /Width ${w} /Height ${w} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, deflateSync(Buffer.alloc(w * w, 255)).toString('latin1'));
  pdf.stream(7, ' /Type /XObject /Subtype /Image /Width 10 /Height 10 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JPXDecode', 'not really jpx');
  pdf.stream(8, '', 'q 600 0 0 400 0 400 cm /F Do Q q 600 0 0 400 0 0 cm /J Do Q');
  const page = renderPage(readPdf(pdf.buffer()), 0);
  wellFormed(page.svg);
  assert.doesNotMatch(page.svg, /#d9d9d9/, 'no grey box');
  assert.equal(page.error, undefined);
  const [png] = dataUrls(page.svg, 'png').map(readPng);
  assert.ok(png.width * png.height <= 4_000_000 && png.width >= 1500, `shown at ${png.width} × ${png.height}`);
  assert.deepEqual([...png.pixels.subarray(0, 4)], [200, 0, 0, 255], 'colour and soft mask kept');
  assert.equal(dataUrls(page.svg, 'jpeg')[0].length, photo.length, 'the JPEG as it is');

  // A picture ATLAS cannot show is grey, and the page says why.
  const jpx = renderPage(readPdf(Buffer.from(pdf.buffer().toString('latin1').replace('/F Do Q q 600 0 0 400 0 0 cm /J Do', '/X Do Q q 600 0 0 400 0 0 cm /X Do'), 'latin1')), 0);
  assert.match(jpx.svg, /#d9d9d9/);
  assert.match(jpx.error || '', /A picture on this page .*JPEG 2000/, 'one picture, drawn twice');
});
