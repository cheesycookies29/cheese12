// The QR encoder of the event invitations (server/customapp/qr.js, 0.74). Reference symbols made by
// Project Nayuki's QR Code generator (test/support/qr-reference.json: byte mode, levels L to H,
// versions 1 to 13, both 8- and 16-bit counts, with version information) must come out module for
// module, mask included. The browser's own encoder (public/js/vendor/qrcode.js, qrcode-generator
// 1.4.4) chooses its mask by a different score, so against it the symbol must be the same for the
// mask it chose. Format and version information are checked against the BCH codes of ISO/IEC 18004
// Annex C, and the PNG is checked pixel by pixel. Decoding with a real reader (zxing-cpp) was done
// when the encoder was written; it is not needed here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import { qrMatrix, qrSvg, qrPng, matrixPng, formatBits, versionBits, alignmentPositions, capacityBytes, penalty, QR_QUIET } from '../server/customapp/qr.js';
import qrcode from '../public/js/vendor/qrcode.js';

const REF = JSON.parse(fs.readFileSync(new URL('./support/qr-reference.json', import.meta.url), 'utf8'));
const rowsOf = (q) => q.modules.map((r) => r.map((b) => (b ? '1' : '0')).join(''));

describe('QR codes for the invitations (ISO/IEC 18004, byte mode)', () => {
  test('GIVEN the reference symbols WHEN each text is encoded at its level THEN the version, the mask and every module are the same', () => {
    assert.ok(REF.symbols.length >= 7);
    const versions = new Set();
    for (const s of REF.symbols) {
      const q = qrMatrix(s.text, { ecl: s.ecl });
      assert.equal(q.version, s.version, s.text);
      assert.equal(q.mask, s.mask, `mask for ${s.text.slice(0, 30)} at ${s.ecl}`);
      assert.deepEqual(rowsOf(q), s.rows, `modules of ${s.text.slice(0, 30)} at ${s.ecl}`);
      versions.add(q.version);
    }
    assert.ok([...versions].some((v) => v >= 10) && [...versions].some((v) => v >= 7 && v < 10) && versions.has(1), 'covers versions with 8- and 16-bit counts and version information');
  });

  test('GIVEN the browser\'s encoder WHEN it makes the same ASCII symbol THEN ours is identical once given its mask, at every level and length', () => {
    let n = 0;
    for (const ecl of ['L', 'M', 'Q', 'H']) {
      for (const len of [1, 17, 32, 60, 95, 120, 150, 230]) {
        const text = `https://ltdc-core.com/event/legati-yep-2026-k3f9#i=${'AbCdEfGh0123456789_-'.repeat(12)}`.slice(0, len);
        const ref = qrcode(0, ecl);
        ref.addData(text, 'Byte');
        ref.make();
        const size = ref.getModuleCount();
        const want = Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => (ref.isDark(r, c) ? '1' : '0')).join(''));
        const ok = [0, 1, 2, 3, 4, 5, 6, 7].some((mask) => {
          const q = qrMatrix(text, { ecl, mask });
          return q.size === size && rowsOf(q).every((row, i) => row === want[i]);
        });
        assert.ok(ok, `${ecl} ${len} bytes: no mask gives the reference symbol`);
        n++;
      }
    }
    assert.equal(n, 32);
  });

  test('GIVEN the format and version information WHEN computed THEN they are the codes of ISO/IEC 18004 Annex C', () => {
    // Table C.1: level M (00), mask 0 → 101010000010010; level L (01), mask 0 → 111011111000100.
    assert.equal(formatBits(1, 0).toString(2).padStart(15, '0'), '101010000010010');
    assert.equal(formatBits(0, 0).toString(2).padStart(15, '0'), '111011111000100');
    assert.equal(formatBits(3, 7).toString(2).padStart(15, '0'), '000100000111011'); // H, mask 7
    // Table D.1: version 7 → 000111110010010100; version 40 → 101000110001101001.
    assert.equal(versionBits(7).toString(2).padStart(18, '0'), '000111110010010100');
    assert.equal(versionBits(40).toString(2).padStart(18, '0'), '101000110001101001');
    // Annex E: alignment centres.
    assert.deepEqual(alignmentPositions(2), [6, 18]);
    assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
    assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
    assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);
    // Table 7: byte capacities at level M.
    assert.deepEqual([1, 2, 5, 6, 10, 40].map((v) => capacityBytes(v, 1)), [14, 26, 84, 106, 213, 2331]);
  });

  test('GIVEN an invitation link of about 100 bytes WHEN encoded THEN it fits a small version at M, the lowest-penalty mask is chosen, and a forced mask is honoured', () => {
    const link = `https://ltdc-core.com/event/legati-yep-2026-k3f9#i=${'x'.repeat(43)}`;
    const q = qrMatrix(link);
    assert.equal(q.ecl, 'M');
    assert.ok(q.version >= 5 && q.version <= 6, `version ${q.version}`);
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => qrMatrix(link, { mask }).penalty);
    assert.equal(q.penalty, Math.min(...scores));
    assert.equal(q.mask, scores.indexOf(Math.min(...scores)));
    assert.equal(penalty(q.modules), q.penalty);
    assert.equal(qrMatrix(link, { mask: 3 }).mask, 3);
    assert.throws(() => qrMatrix('x'.repeat(3000)), /too long/);
    assert.throws(() => qrMatrix('x', { ecl: 'Z' }), /level/);
  });

  test('GIVEN a symbol WHEN drawn as PNG and SVG THEN the PNG is greyscale with a 4-module quiet zone and every pixel matches its module, and the SVG has the same squares', () => {
    const text = 'https://ltdc-core.com';
    const q = qrMatrix(text);
    const scale = 3;
    const png = qrPng(text, { scale });
    assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
    const w = png.readUInt32BE(16);
    assert.equal(w, (q.size + QR_QUIET * 2) * scale);
    assert.equal(png[25], 0, 'greyscale');
    // Read the IDAT back: filter byte 0, then one byte per pixel.
    let off = 8;
    const idat = [];
    while (off < png.length) {
      const len = png.readUInt32BE(off);
      const type = png.subarray(off + 4, off + 8).toString('latin1');
      if (type === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len));
      off += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const px = (x, y) => raw[y * (w + 1) + 1 + x];
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const mx = Math.floor(x / scale) - QR_QUIET;
        const my = Math.floor(y / scale) - QR_QUIET;
        const dark = mx >= 0 && my >= 0 && mx < q.size && my < q.size && q.modules[my][mx];
        if (px(x, y) !== (dark ? 0 : 255)) assert.fail(`pixel ${x},${y}`);
      }
    }
    assert.deepEqual(matrixPng(q.modules, { scale }), png);
    const svg = qrSvg(text, { label: 'A "QR" <code>' });
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 33 33"/);
    assert.match(svg, /aria-label="A &quot;QR&quot; &lt;code&gt;"/);
    const squares = (svg.match(/h1v1h-1z/g) || []).length;
    assert.equal(squares, q.modules.flat().filter(Boolean).length);
  });
});
