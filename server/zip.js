// A ZIP file made from files in memory (0.57), with Node's own zlib: "Download all" of a task's or a
// milestone's files. Text and PDFs are compressed (deflate); files that are compressed already
// (photos, Office and OpenDocument files, which are ZIPs themselves) are stored as they are. Names
// are UTF-8 (flag bit 11); the same name twice becomes "name (2).ext". No ZIP64: CORE's limits keep
// an archive far below 4 GB (zipFiles refuses more than MAX_ZIP_BYTES of files).
import { deflateRawSync } from 'node:zlib';
import * as zlib from 'node:zlib';
import { HttpError } from './util.js';

export const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const STORED = /^(image\/|application\/vnd\.openxmlformats|application\/vnd\.oasis|application\/zip)/;

let table = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// The DOS date and time a ZIP entry carries (local time, 2-second steps, from 1980).
function dosTime(when) {
  const d = new Date(when || Date.now());
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
// A name safe in an archive: no folders, no characters Windows refuses; each name used once.
function uniqueNames(names) {
  const used = new Set();
  return names.map((raw) => {
    const clean = String(raw || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim() || 'file';
    let name = clean;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const dot = clean.lastIndexOf('.');
      name = dot > 0 ? `${clean.slice(0, dot)} (${n})${clean.slice(dot)}` : `${clean} (${n})`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

// files: [{ name, type, at, buffer }] → the ZIP as one Buffer.
export function zipFiles(files) {
  const total = files.reduce((n, f) => n + f.buffer.length, 0);
  if (total > MAX_ZIP_BYTES) throw new HttpError(413, `These files come to ${(total / 1048576).toFixed(0)} MB, over the ${MAX_ZIP_BYTES / 1048576} MB a download of them all may hold. Download them one by one.`);
  const names = uniqueNames(files.map((f) => f.name));
  const parts = [];
  const central = [];
  let offset = 0;
  files.forEach((f, i) => {
    const name = Buffer.from(names[i], 'utf8');
    const store = STORED.test(f.type || '');
    const data = store ? f.buffer : deflateRawSync(f.buffer, { level: 6 });
    const method = store ? 0 : 8;
    const crc = crc32(f.buffer);
    const { time, date } = dosTime(f.at);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(f.buffer.length, 22);
    local.writeUInt16LE(name.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(f.buffer.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--
    head.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    central.push(head, name);
    offset += local.length + name.length + data.length;
  });
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
