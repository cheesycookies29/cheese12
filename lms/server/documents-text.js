// ATLAS Documents: the words of a file, for search. ATLAS has no PDF or Office readers, so it reads
// only what is cheap and safe to read with Node's standard library:
//  - text files (txt, csv, tsv, md, log, json, xml) and e-mail messages (eml), as UTF-8 or UTF-16;
//  - the text parts of Word, Excel and PowerPoint files (docx, xlsx, pptx and their templates) and of
//    OpenDocument files: word/document.xml, xl/sharedStrings.xml, ppt/slides/slideN.xml, content.xml,
//    unpacked (stored or deflated) with node:zlib, each part limited in size, and the tags stripped.
// Anything else (PDF, pictures, old Office files) is found by its title, name, tags and description.
import { inflateRawSync } from 'node:zlib';

const MAX_TEXT_BYTES = 4 * 1024 * 1024; // of a text file read for words
const MAX_PART = 8 * 1024 * 1024; // one unpacked XML part
const MAX_TOTAL = 24 * 1024 * 1024; // all unpacked parts of one file
const MAX_PARTS = 300; // slides

const TEXT_EXTS = new Set(['txt', 'csv', 'tsv', 'md', 'log', 'json', 'xml', 'eml']);
const OOXML = { docx: /^word\/document\.xml$/, dotx: /^word\/document\.xml$/, xlsx: /^xl\/sharedStrings\.xml$/, xltx: /^xl\/sharedStrings\.xml$/, pptx: /^ppt\/slides\/slide\d+\.xml$/, potx: /^ppt\/slides\/slide\d+\.xml$/, ppsx: /^ppt\/slides\/slide\d+\.xml$/ };
const ODF = new Set(['odt', 'ods', 'odp', 'ott', 'ots', 'otp']);

function decodeText(buf) {
  const b = buf.subarray(0, MAX_TEXT_BYTES);
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2)).swap16().toString('utf16le');
  return b.toString('utf8').replace(/^﻿/, '');
}

// The central directory of a ZIP: name, method, sizes and where each part starts.
function entries(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return [];
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = [];
  for (let n = 0; n < count && n < 20000; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(at + 28);
    out.push({
      name: buf.subarray(at + 46, at + 46 + nameLen).toString('utf8'), flags: buf.readUInt16LE(at + 8), method: buf.readUInt16LE(at + 10),
      packed: buf.readUInt32LE(at + 20), size: buf.readUInt32LE(at + 24), local: buf.readUInt32LE(at + 42),
    });
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}
function unpack(buf, e) {
  if (e.flags & 1 || e.size > MAX_PART || e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) return null;
  const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
  const raw = buf.subarray(start, start + e.packed);
  try {
    return e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_PART }) : null;
  } catch {
    return null;
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function xmlText(xml) {
  return String(xml)
    .replace(/<\/(w:p|a:p|text:p|text:h|si|row|table:table-row)>|<(w:tab|w:br|text:tab|text:line-break|text:s)\b[^>]*\/?>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// The words of `buf`, a file whose kind (from its bytes) is `ext`; '' when there are none to read.
export function extractText(buf, ext) {
  if (!buf?.length) return '';
  if (TEXT_EXTS.has(ext)) {
    let t = decodeText(buf);
    if (ext === 'eml') t = t.replace(/^[A-Za-z0-9+/=]{60,}$/gm, ' '); // attachments in base64 carry no words
    if (ext === 'xml') t = xmlText(t);
    return t.replace(/\s+/g, ' ').trim();
  }
  const want = OOXML[ext] || (ODF.has(ext) ? /^content\.xml$/ : null);
  if (!want) return '';
  const parts = entries(buf).filter((e) => want.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).slice(0, MAX_PARTS);
  let total = 0;
  const out = [];
  for (const e of parts) {
    total += e.size;
    if (total > MAX_TOTAL) break;
    const xml = unpack(buf, e);
    if (xml) out.push(xmlText(xml.toString('utf8')));
  }
  return out.join(' ').trim();
}
