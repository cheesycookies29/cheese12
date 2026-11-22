// The fax test pattern and a minimal TIFF strip reader, shared by test/pdf-ccitt.test.js and
// test/pdf-tiff.test.js. The fax fixtures in scripts/fixtures/tiff were drawn from the same pattern
// by scripts/fixtures/tiff/make-fixtures.py.

// The picture in the fax fixtures (1 = black), as make-fixtures.py draws it: whole black rows, a run
// of 2000 (extended make-up codes), pixels at both edges, a checkerboard, slanted edges (vertical
// modes), dots, 60 rectangles and thin diagonal lines.
export function faxPattern(W, H) {
  const px = new Uint8Array(W * H);
  const put = (x, y) => {
    if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = 1;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y === 10 || y === 11) put(x, y);
      else if ((y === 20 || y === 21) && x < 2000) put(x, y);
      else if (y >= 30 && y < 33 && (x === 0 || x === W - 1)) put(x, y);
      else if (y >= 40 && y < 72 && x >= 100 && x < 164 && (x + y) % 2) put(x, y);
      else if (y >= 72 && y < 80 && (x < 500 + (y - 72) * 2 || (x >= 1000 - (y - 72) * 3 && x < 1100))) put(x, y);
      else if ((x * 7 + y * 13) % 997 === 0) put(x, y);
    }
  }
  let seed = 12345;
  const rnd = (n) => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
  for (let i = 0; i < 60; i++) {
    const x0 = rnd(W - 100);
    const y0 = 80 + rnd(110);
    const w = 1 + rnd(90);
    const h = 1 + rnd(12);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y);
  }
  for (let y = 200; y < H; y++) {
    const a = (y * 37) % W;
    for (let x = a; x < a + 3; x++) put(x, y);
    put((y * 11) % W, y);
  }
  return px;
}
// A TIFF's first page, read here without server/pdf/tiff.js: its fields and strips.
export function tiffStrips(buf) {
  const le = buf[0] === 0x49;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = u32(4);
  const tags = {};
  for (let i = 0; i < u16(ifd); i++) {
    const e = ifd + 2 + i * 12;
    const type = u16(e + 2);
    const count = u32(e + 4);
    const size = type === 3 ? 2 : 4;
    const at = count * size <= 4 ? e + 8 : u32(e + 8);
    tags[u16(e)] = Array.from({ length: count }, (_, j) => (type === 3 ? u16(at + j * 2) : u32(at + j * 4)));
  }
  const rps = tags[278]?.[0] ?? tags[257][0];
  const strips = tags[273].map((off, i) => ({ data: buf.subarray(off, off + tags[279][i]), y: i * rps, rows: Math.min(rps, tags[257][0] - i * rps) }));
  return { tags, strips };
}
