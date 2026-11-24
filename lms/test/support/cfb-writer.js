// A small compound file (MS-CFB) writer for tests: version 3 (512-byte sectors) or 4 (4096-byte
// sectors), streams under 4096 bytes in the mini stream, storages from "a/b" paths. Options let a
// test damage the file on purpose:
//   patchFat(fat, info)  change the allocation table before it is written (loops, bad links);
//   headerDifat: n       keep only n allocation-table sectors in the header and chain the rest
//                        through DIFAT sectors (as files over 7 MB do).
// info: { streams: Map(path → { start, size, mini }), dirStart, fatSectors }.

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;

const compare = (a, b) => a.name.length - b.name.length || (a.name.toUpperCase() < b.name.toUpperCase() ? -1 : a.name.toUpperCase() > b.name.toUpperCase() ? 1 : 0);

export function writeCfb(files, { version = 3, patchFat, headerDifat = 109 } = {}) {
  const shift = version === 4 ? 12 : 9;
  const size = 1 << shift;
  const per = size / 4;
  // The directory tree: the root, storages and streams.
  const root = { name: 'Root Entry', type: 5, kids: [] };
  const nodes = [root];
  const storages = new Map([['', root]]);
  const entries = files instanceof Map ? [...files] : Object.entries(files);
  for (const [path, data] of entries) {
    const parts = path.split('/');
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts.slice(0, i + 1).join('/');
      if (!storages.has(key)) {
        const s = { name: parts[i], type: 1, kids: [] };
        storages.set(key, s);
        parent.kids.push(s);
        nodes.push(s);
      }
      parent = storages.get(key);
    }
    const node = { name: parts[parts.length - 1], type: 2, data: Buffer.from(data), path };
    parent.kids.push(node);
    nodes.push(node);
  }
  nodes.forEach((n, i) => { n.id = i; n.left = n.right = n.child = FREESECT; });
  const balance = (list) => {
    if (!list.length) return FREESECT;
    const mid = list.length >> 1;
    const n = list[mid];
    n.left = balance(list.slice(0, mid));
    n.right = balance(list.slice(mid + 1));
    return n.id;
  };
  for (const n of nodes) if (n.kids) n.child = balance([...n.kids].sort(compare));

  // Small streams go to the mini stream, the rest to sectors of their own.
  const streams = nodes.filter((n) => n.type === 2);
  const miniFat = [];
  const miniParts = [];
  for (const s of streams) {
    if (s.data.length >= 4096 || !s.data.length) continue;
    const count = Math.ceil(s.data.length / 64);
    s.start = miniFat.length;
    s.mini = true;
    for (let k = 0; k < count; k++) miniFat.push(k === count - 1 ? ENDOFCHAIN : s.start + k + 1);
    miniParts.push(s.data, Buffer.alloc(count * 64 - s.data.length));
  }
  const miniStream = Buffer.concat(miniParts);
  const big = streams.filter((s) => s.data.length >= 4096);
  const sectorsOf = (bytes) => Math.ceil(bytes / size);
  const dirSectors = sectorsOf(nodes.length * 128);
  const miniFatSectors = sectorsOf(miniFat.length * 4);
  const miniStreamSectors = sectorsOf(miniStream.length);
  const dataSectors = big.reduce((n, s) => n + sectorsOf(s.data.length), 0);
  let fatSectors = 1;
  let difatSectors = 0;
  for (;;) {
    const extra = Math.max(0, fatSectors - headerDifat);
    difatSectors = Math.ceil(extra / (per - 1));
    const total = fatSectors + difatSectors + miniFatSectors + dirSectors + miniStreamSectors + dataSectors;
    if (Math.ceil(total / per) <= fatSectors) break;
    fatSectors++;
  }
  const total = fatSectors + difatSectors + miniFatSectors + dirSectors + miniStreamSectors + dataSectors;
  const fat = new Array(fatSectors * per).fill(FREESECT);
  let next = 0;
  const chain = (count) => {
    const start = next;
    for (let k = 0; k < count; k++) fat[next + k] = k === count - 1 ? ENDOFCHAIN : next + k + 1;
    next += count;
    return count ? start : ENDOFCHAIN;
  };
  const fatList = [];
  for (let k = 0; k < fatSectors; k++) { fat[next] = FATSECT; fatList.push(next++); }
  const difatList = [];
  for (let k = 0; k < difatSectors; k++) { fat[next] = DIFSECT; difatList.push(next++); }
  const miniFatStart = chain(miniFatSectors);
  const dirStart = chain(dirSectors);
  root.start = chain(miniStreamSectors);
  root.size = miniStream.length;
  for (const s of big) s.start = chain(sectorsOf(s.data.length));
  if (patchFat) patchFat(fat, { streams: new Map(streams.map((s) => [s.path, { start: s.start, size: s.data.length, mini: !!s.mini }])), dirStart, fatSectors: fatList });

  const out = Buffer.alloc(size + total * size);
  const header = out.subarray(0, 512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(version, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(shift, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(version === 4 ? dirSectors : 0, 0x28);
  header.writeUInt32LE(fatSectors, 0x2c);
  header.writeUInt32LE(dirStart, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(miniFatSectors ? miniFatStart : ENDOFCHAIN, 0x3c);
  header.writeUInt32LE(miniFatSectors, 0x40);
  header.writeUInt32LE(difatSectors ? difatList[0] : ENDOFCHAIN, 0x44);
  header.writeUInt32LE(difatSectors, 0x48);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i < Math.min(headerDifat, fatList.length) ? fatList[i] : FREESECT, 0x4c + i * 4);
  const at = (n) => size + n * size;
  // DIFAT sectors: the allocation-table sectors after the header's, then the next DIFAT sector.
  const rest = fatList.slice(Math.min(headerDifat, fatList.length));
  difatList.forEach((n, k) => {
    for (let i = 0; i < per - 1; i++) out.writeUInt32LE(rest[k * (per - 1) + i] ?? FREESECT, at(n) + i * 4);
    out.writeUInt32LE(difatList[k + 1] ?? ENDOFCHAIN, at(n) + (per - 1) * 4);
  });
  fat.forEach((v, i) => out.writeUInt32LE(v >>> 0, at(fatList[Math.floor(i / per)]) + (i % per) * 4));
  miniFat.forEach((v, i) => out.writeUInt32LE(v >>> 0, at(miniFatStart) + i * 4));
  if (miniFatSectors) for (let i = miniFat.length; i < miniFatSectors * per; i++) out.writeUInt32LE(FREESECT, at(miniFatStart) + i * 4);
  nodes.forEach((n) => {
    const e = out.subarray(at(dirStart) + n.id * 128, at(dirStart) + n.id * 128 + 128);
    const name = Buffer.from(`${n.name}\0`, 'utf16le');
    name.copy(e, 0, 0, Math.min(64, name.length));
    e.writeUInt16LE(Math.min(64, name.length), 0x40);
    e[0x42] = n.type;
    e[0x43] = 1; // black
    e.writeUInt32LE(n.left, 0x44);
    e.writeUInt32LE(n.right, 0x48);
    e.writeUInt32LE(n.child, 0x4c);
    const start = n.type === 1 ? 0 : n.type === 5 ? root.start : n.data.length ? n.start : ENDOFCHAIN;
    e.writeUInt32LE(start >>> 0, 0x74);
    e.writeUInt32LE(n.type === 5 ? root.size : n.type === 2 ? n.data.length : 0, 0x78);
  });
  // Unused directory slots are empty entries.
  for (let i = nodes.length; i < (dirSectors * size) / 128; i++) {
    const e = at(dirStart) + i * 128;
    out.writeUInt32LE(FREESECT, e + 0x44);
    out.writeUInt32LE(FREESECT, e + 0x48);
    out.writeUInt32LE(FREESECT, e + 0x4c);
  }
  if (miniStream.length) miniStream.copy(out, at(root.start));
  for (const s of big) s.data.copy(out, at(s.start));
  return out;
}
