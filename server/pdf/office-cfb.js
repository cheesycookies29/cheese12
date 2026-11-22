// PDF Studio (0.66): the "compound file" (Microsoft Compound File Binary, MS-CFB) that the older
// Office formats (.doc, .xls, .ppt), Outlook messages (.msg) and password-protected Office files are
// stored in: a small file system inside one file, made of sectors chained by an allocation table.
//
//   readCfb(buffer) → { names, storages, has(path), size(path), read(path) }
//
// Stream paths are the names inside the file joined by "/": "WordDocument", "1Table",
// "__attach_version1.0_#00000000/__substg1.0_37010102". Uploaded files are never trusted: every chain
// of sectors is checked for loops and for sectors outside the file, and a stream (or all streams read
// together) may not be larger than the limits allow. Node's standard library only.
import { fail } from './office-core.js';

export const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
export const isCompound = (buf) => Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 8).equals(CFB_SIGNATURE);

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAXREGSECT = 0xfffffffa;
const NOSTREAM = 0xffffffff;

const DAMAGED = 'This file is damaged or was only partly uploaded, so CORE cannot read it. Open it, save it again and upload that copy.';
const NOT_CFB = 'This file is not an Office file CORE can read: it may be damaged, or be another kind of file with the wrong name.';
const TOO_BIG = 'This file holds far more data than a document should, so CORE stopped reading it.';

export function readCfb(buffer, { maxStreamBytes = 64 * 1024 * 1024, maxTotalBytes = 160 * 1024 * 1024, maxEntries = 20000 } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!isCompound(buf)) fail(NOT_CFB);
  if (buf.length < 512) fail(DAMAGED);
  const major = buf.readUInt16LE(0x1a);
  const shift = buf.readUInt16LE(0x1e);
  const miniShift = buf.readUInt16LE(0x20);
  if (buf.readUInt16LE(0x1c) !== 0xfffe || (shift !== 9 && shift !== 12) || miniShift !== 6 || (major !== 3 && major !== 4)) fail(NOT_CFB);
  const size = 1 << shift;
  const perSector = size / 4;
  // Sectors that exist in the file (the last may be cut short by a writer; it reads as zeros).
  const sectors = Math.ceil((buf.length - size) / size);
  if (sectors < 1) fail(DAMAGED);
  const sector = (n) => {
    if (n >= sectors) fail(DAMAGED);
    const start = (n + 1) * size;
    const s = buf.subarray(start, start + size);
    return s.length === size ? s : Buffer.concat([s, Buffer.alloc(size - s.length)]);
  };
  const fatCount = buf.readUInt32LE(0x2c);
  const dirStart = buf.readUInt32LE(0x30);
  const cutoff = buf.readUInt32LE(0x38) || 4096;
  const miniFatStart = buf.readUInt32LE(0x3c);
  const miniFatCount = buf.readUInt32LE(0x40);
  let difatNext = buf.readUInt32LE(0x44);
  const difatCount = buf.readUInt32LE(0x48);
  if (fatCount > sectors + 1 || difatCount > sectors + 1 || miniFatCount > sectors + 1) fail(DAMAGED);

  // The sectors of the allocation table (FAT): 109 in the header, the rest in a chain of DIFAT sectors.
  const fatSectors = [];
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) {
    const v = buf.readUInt32LE(0x4c + i * 4);
    if (v > MAXREGSECT) break;
    fatSectors.push(v);
  }
  const seenDifat = new Set();
  while (fatSectors.length < fatCount && difatNext <= MAXREGSECT) {
    if (seenDifat.has(difatNext) || seenDifat.size > difatCount) fail(DAMAGED);
    seenDifat.add(difatNext);
    const s = sector(difatNext);
    for (let i = 0; i < perSector - 1 && fatSectors.length < fatCount; i++) {
      const v = s.readUInt32LE(i * 4);
      if (v <= MAXREGSECT) fatSectors.push(v);
    }
    difatNext = s.readUInt32LE((perSector - 1) * 4);
  }
  if (!fatSectors.length) fail(DAMAGED);
  const fat = new Uint32Array(fatSectors.length * perSector);
  fatSectors.forEach((n, i) => {
    const s = sector(n);
    for (let k = 0; k < perSector; k++) fat[i * perSector + k] = s.readUInt32LE(k * 4);
  });

  // A chain of sectors from the table, with loops and sectors outside the table refused.
  const chain = (start, table, limit) => {
    const out = [];
    const seen = new Uint8Array(table.length);
    let n = start;
    while (n !== ENDOFCHAIN && n !== FREESECT) {
      if (n >= table.length || seen[n]) fail(DAMAGED);
      seen[n] = 1;
      out.push(n);
      if (out.length > limit) fail(TOO_BIG);
      n = table[n];
    }
    return out;
  };
  const maxSectors = (bytes, unit) => Math.ceil(bytes / unit) + 1;

  // The directory: 128-byte entries in a chain of sectors.
  const dirChain = chain(dirStart, fat, Math.min(sectors, maxSectors(maxEntries * 128, size)));
  const dir = Buffer.concat(dirChain.map(sector));
  const count = Math.min(dir.length / 128, maxEntries);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const e = dir.subarray(i * 128, i * 128 + 128);
    const type = e[0x42];
    const nameLen = Math.min(64, e.readUInt16LE(0x40));
    const name = nameLen >= 2 ? e.subarray(0, nameLen - 2).toString('utf16le').replace(/\0+$/, '') : '';
    const lo = e.readUInt32LE(0x78);
    const hi = e.readUInt32LE(0x7c);
    entries.push({
      name, type, left: e.readUInt32LE(0x44), right: e.readUInt32LE(0x48), child: e.readUInt32LE(0x4c),
      start: e.readUInt32LE(0x74), size: major === 3 ? lo : hi ? Infinity : lo,
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) fail(DAMAGED);

  // The mini stream (small streams, in 64-byte sectors) lives in the root entry's chain.
  let miniFat = null;
  let miniStream = null;
  const mini = () => {
    if (miniStream) return;
    const mfChain = miniFatStart <= MAXREGSECT ? chain(miniFatStart, fat, Math.min(sectors, miniFatCount + 1)) : [];
    miniFat = new Uint32Array(mfChain.length * perSector);
    mfChain.forEach((n, i) => {
      const s = sector(n);
      for (let k = 0; k < perSector; k++) miniFat[i * perSector + k] = s.readUInt32LE(k * 4);
    });
    if (root.size > maxStreamBytes) fail(TOO_BIG);
    const rootChain = root.start <= MAXREGSECT ? chain(root.start, fat, maxSectors(root.size, size)) : [];
    miniStream = Buffer.concat(rootChain.map(sector));
  };

  // Paths of the streams and storages, by walking each storage's tree of children (left, right and
  // child links), with entries met twice or nested too deeply refused.
  const streams = new Map();
  const storages = new Map();
  const visited = new Uint8Array(entries.length);
  const walk = [[root.child, '', 0]];
  while (walk.length) {
    const [id, prefix, depth] = walk.pop();
    if (id === NOSTREAM) continue;
    if (id >= entries.length || visited[id] || depth > 64) fail(DAMAGED);
    visited[id] = 1;
    const e = entries[id];
    walk.push([e.left, prefix, depth], [e.right, prefix, depth]);
    if (!e.name || e.name.includes('/')) continue;
    const path = prefix + e.name;
    if (e.type === 2) streams.set(path, e);
    else if (e.type === 1) {
      storages.set(path, e);
      walk.push([e.child, `${path}/`, depth + 1]);
    }
  }
  const lower = new Map([...streams.keys()].map((k) => [k.toLowerCase(), k]));
  const key = (name) => (streams.has(name) ? name : lower.get(String(name).toLowerCase()));
  let total = 0;
  const cache = new Map();
  return {
    names: [...streams.keys()],
    storages: [...storages.keys()],
    has: (name) => key(name) !== undefined,
    size: (name) => streams.get(key(name))?.size ?? 0,
    read(name) {
      const k = key(name);
      if (k === undefined) fail(`A part of this file (${name}) is missing.`);
      if (cache.has(k)) return cache.get(k);
      const e = streams.get(k);
      if (e.size > maxStreamBytes || total + e.size > maxTotalBytes) fail(TOO_BIG);
      let data;
      if (e.size === 0) data = Buffer.alloc(0);
      else if (e.size < cutoff) {
        mini();
        const c = chain(e.start, miniFat, maxSectors(e.size, 64));
        data = Buffer.concat(c.map((n) => {
          if ((n + 1) * 64 > miniStream.length) fail(DAMAGED);
          return miniStream.subarray(n * 64, n * 64 + 64);
        }));
      } else {
        data = Buffer.concat(chain(e.start, fat, maxSectors(e.size, size)).map(sector));
      }
      if (data.length < e.size) fail(DAMAGED);
      data = data.subarray(0, e.size);
      total += data.length;
      cache.set(k, data);
      return data;
    },
  };
}
