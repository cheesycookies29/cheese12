// Document Management (MOD-08): what a file really is, from its bytes, and whether the company accepts
// it. Shared by CORE (server/dms/) and ATLAS (lms/server/dms/): the same file in both, Node's standard
// library only, no imports from either app.
//
// The type always comes from the content (magic numbers, the parts inside a ZIP or an Office compound
// file); the name's extension must then agree with it. Programs, scripts, web pages, SVG, Office files
// with macros and password-protected Office files are refused whatever the settings (BLOCKED_*).
import { inflateRawSync } from 'node:zlib';

// The families the control panel switches on and off, each with its extensions and its browser type.
// `inline`: may open in the browser (passive content only); everything else downloads.
export const FAMILIES = [
  { id: 'pdf', label: 'PDF', exts: ['pdf'], inline: true },
  { id: 'image', label: 'Pictures', exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'heic', 'heif'], inline: true },
  { id: 'word', label: 'Word', exts: ['docx', 'dotx'] },
  { id: 'excel', label: 'Excel', exts: ['xlsx', 'xltx'] },
  { id: 'powerpoint', label: 'PowerPoint', exts: ['pptx', 'potx', 'ppsx'] },
  { id: 'legacy', label: 'Office 97–2003 (Word, Excel, PowerPoint)', exts: ['doc', 'dot', 'xls', 'xlt', 'ppt', 'pps', 'pot'] },
  { id: 'opendocument', label: 'OpenDocument', exts: ['odt', 'ods', 'odp', 'ott', 'ots', 'otp'] },
  { id: 'rtf', label: 'Rich Text (RTF)', exts: ['rtf'] },
  { id: 'text', label: 'Text, CSV and data', exts: ['txt', 'csv', 'tsv', 'md', 'log', 'json', 'xml'] },
  { id: 'email', label: 'E-mail messages', exts: ['eml', 'msg'] },
  { id: 'archive', label: 'ZIP archives', exts: ['zip'] },
  { id: 'audio', label: 'Audio', exts: ['mp3', 'wav', 'ogg', 'm4a'] },
  { id: 'video', label: 'Video', exts: ['mp4', 'webm', 'mov'] },
  { id: 'cad', label: 'CAD drawings', exts: ['dwg', 'dxf'] },
];
export const FAMILY = Object.fromEntries(FAMILIES.map((f) => [f.id, f]));
export const FAMILY_OF_EXT = Object.fromEntries(FAMILIES.flatMap((f) => f.exts.map((e) => [e, f.id])));
// Families accepted until an administrator changes them: everyday office documents. Archives, audio,
// video and CAD are off until someone needs them.
export const DEFAULT_FAMILIES = ['pdf', 'image', 'word', 'excel', 'powerpoint', 'legacy', 'opendocument', 'rtf', 'text', 'email'];

// Always refused, whatever the control panel says: they can run code on a computer or in a browser.
export const BLOCKED_EXTS = [
  'exe', 'dll', 'com', 'scr', 'msi', 'msp', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'wsf', 'wsh', 'hta',
  'jar', 'class', 'sh', 'bash', 'zsh', 'py', 'pl', 'rb', 'php', 'lnk', 'url', 'reg', 'inf', 'cpl', 'sys', 'drv', 'apk', 'app',
  'dmg', 'pkg', 'deb', 'rpm', 'iso', 'img', 'vhd', 'html', 'htm', 'xhtml', 'shtml', 'svg', 'svgz', 'swf', 'chm',
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppsm', 'ppam',
];
export const BLOCKED_LABEL = 'Programs and scripts, web pages and SVG, and Office files with macros';
const BLOCKED = new Set(BLOCKED_EXTS);

const MIME = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
  bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  doc: 'application/msword', dot: 'application/msword', xls: 'application/vnd.ms-excel', xlt: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  pps: 'application/vnd.ms-powerpoint', pot: 'application/vnd.ms-powerpoint', msg: 'application/vnd.ms-outlook',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  ott: 'application/vnd.oasis.opendocument.text-template', ots: 'application/vnd.oasis.opendocument.spreadsheet-template', otp: 'application/vnd.oasis.opendocument.presentation-template',
  rtf: 'application/rtf', txt: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', md: 'text/markdown', log: 'text/plain', json: 'application/json',
  xml: 'application/xml', eml: 'message/rfc822', zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', dwg: 'image/vnd.dwg', dxf: 'image/vnd.dxf',
};
export const mimeOf = (ext) => MIME[ext] || 'application/octet-stream';

// A file name that is safe to keep and to send back: no folders, control or reserved characters, no
// leading dots, at most 200 characters (the extension kept).
export function cleanName(name) {
  let n = String(name ?? '').normalize('NFC').split(/[\\/]/).pop();
  n = n.replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!n) n = 'file';
  if (n.length > 200) {
    const ext = extOf(n);
    n = ext && ext.length < 12 ? `${n.slice(0, 199 - ext.length).trim()}.${ext}` : n.slice(0, 200);
  }
  return n;
}
export const extOf = (name) => String(name || '').match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase() || '';

const ascii = (buf, a, b) => buf.subarray(a, b).toString('latin1');

// ----- ZIP (Office Open XML, OpenDocument, ZIP archives) -----
// The central directory: names, sizes, flags. Nothing is unpacked here except, on request, one small
// part. Refuses ZIP64 and damaged directories (they are not needed for documents of up to 100 MB).
function zipEntries(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return null;
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff || count > 20000) return null;
  const out = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return null;
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    out.push({ name, flags, method, packed, size, local });
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}
function zipRead(buf, e, max = 256 * 1024) {
  if (e.size > max || e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) return null;
  const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
  const raw = buf.subarray(start, start + e.packed);
  try {
    return e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw, { maxOutputLength: max }) : null;
  } catch {
    return null;
  }
}
// Limits for an archive that is kept as an archive: far more data than it holds is a "zip bomb".
const ZIP_MAX_TOTAL = 1024 * 1024 * 1024;
const ZIP_MAX_RATIO = 200;

function inspectZip(buf) {
  const entries = zipEntries(buf);
  if (!entries) return { refuse: 'The file looks like a ZIP but is damaged or uses a ZIP format CORE does not read (ZIP64).' };
  if (entries.some((e) => e.flags & 1)) return { refuse: 'The file is protected with a password. Remove the password and upload it again.' };
  const names = entries.map((e) => e.name.replace(/\\/g, '/'));
  const lower = names.map((n) => n.toLowerCase());
  if (lower.some((n) => /(^|\/)vbaproject\.bin$/.test(n) || /^(basic|scripts)\//.test(n))) return { refuse: 'The file contains macros, which are never accepted. Save it without macros (.docx, .xlsx, .pptx) and upload it again.' };
  // Office Open XML: the main part names the kind.
  const ct = entries.find((e) => e.name === '[Content_Types].xml');
  if (ct) {
    const xml = zipRead(buf, ct)?.toString('utf8') || '';
    if (/macroEnabled/i.test(xml)) return { refuse: 'The file contains macros, which are never accepted. Save it without macros and upload it again.' };
    if (lower.includes('word/document.xml')) return { kind: /template\.main/i.test(xml) ? 'dotx' : 'docx' };
    if (lower.includes('xl/workbook.xml')) return { kind: /template\.main/i.test(xml) ? 'xltx' : 'xlsx' };
    if (lower.includes('ppt/presentation.xml')) return { kind: /template\.main/i.test(xml) ? 'potx' : /slideshow\.main/i.test(xml) ? 'ppsx' : 'pptx' };
    return { refuse: 'The file is an Office package of a kind CORE does not keep.' };
  }
  // OpenDocument: a stored "mimetype" part names the kind.
  const mt = entries.find((e) => e.name === 'mimetype');
  if (mt) {
    const kind = zipRead(buf, mt, 200)?.toString('latin1').trim() || '';
    const odf = { 'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.spreadsheet': 'ods', 'application/vnd.oasis.opendocument.presentation': 'odp',
      'application/vnd.oasis.opendocument.text-template': 'ott', 'application/vnd.oasis.opendocument.spreadsheet-template': 'ots', 'application/vnd.oasis.opendocument.presentation-template': 'otp' }[kind];
    if (odf) return { kind: odf };
  }
  // A plain ZIP archive: nothing refused inside it, and no bomb.
  const total = entries.reduce((n, e) => n + e.size, 0);
  if (total > ZIP_MAX_TOTAL || (buf.length > 0 && total / buf.length > ZIP_MAX_RATIO && total > 50 * 1024 * 1024)) return { refuse: 'The ZIP file unpacks to far more data than it holds, so it is refused.' };
  const bad = names.find((n) => BLOCKED.has(extOf(n)) || n.split('/').includes('..'));
  if (bad) return { refuse: `The ZIP file contains “${bad.split('/').pop()}”, a kind of file that is never accepted (programs, scripts and web pages).` };
  return { kind: 'zip' };
}

// ----- Office 97–2003 and Outlook (.doc, .xls, .ppt, .msg: "compound files") -----
// Told apart by the names of the streams in their directory (UTF-16), looked for in the file.
const utf16 = (s) => Buffer.from(s, 'utf16le');
function inspectCompound(buf, ext) {
  const look = (s) => buf.indexOf(utf16(s)) >= 0;
  if (look('EncryptedPackage') || look('EncryptionInfo')) return { refuse: 'The file is protected with a password. Remove the password and upload it again.' };
  if (look('_VBA_PROJECT') || look('VBA') && look('Macros')) return { refuse: 'The file contains macros, which are never accepted. Save it without macros and upload it again.' };
  if (look('WordDocument')) return { kind: ext === 'dot' ? 'dot' : 'doc' };
  if (look('Workbook') || look('Book')) return { kind: ext === 'xlt' ? 'xlt' : 'xls' };
  if (look('PowerPoint Document')) return { kind: ['pps', 'pot'].includes(ext) ? ext : 'ppt' };
  if (look('__substg1.0_')) return { kind: 'msg' };
  return { refuse: 'The file is an Office 97–2003 file of a kind CORE does not keep (or an installer).' };
}

// ----- Text -----
function isText(buf) {
  const head = buf.subarray(0, 64 * 1024);
  if (head.includes(0)) return false;
  // UTF-16 with a byte-order mark is text too (but then has zeros); handled by the caller if needed.
  let bad = 0;
  for (const b of head) if (b < 9 || (b > 13 && b < 32 && b !== 27)) bad++;
  return bad <= head.length / 200;
}
const looksLikeMail = (buf) => {
  const h = buf.subarray(0, 4096).toString('latin1');
  return /^(received|from|to|subject|date|message-id|mime-version|return-path|delivered-to|x-[\w-]+):/im.test(h) && /^(from|subject|to):/im.test(h);
};

// The kind of file by its first bytes: an extension, or { refuse } with a message for the person.
export function sniff(buf, nameExt = '') {
  if (!buf?.length) return { refuse: 'The file is empty.' };
  const b = buf;
  const s4 = ascii(b, 0, 4);
  // Programs, whatever they are called.
  if (s4.startsWith('MZ') || s4 === '\x7fELF' || [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(b.length >= 4 ? b.readUInt32BE(0) : 0)
    || (b.length >= 4 && b.readUInt32BE(0) === 0xcafebabe) || ascii(b, 0, 2) === '#!') return { refuse: 'The file is a program or a script, which is never accepted.' };
  if (ascii(b, 0, 5) === '%PDF-' || b.subarray(0, 1024).indexOf('%PDF-') >= 0 && nameExt === 'pdf') return { kind: 'pdf' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'jpg' };
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47) return { kind: 'png' };
  if (/^GIF8[79]a$/.test(ascii(b, 0, 6))) return { kind: 'gif' };
  if (s4 === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { kind: 'webp' };
  if (s4 === 'RIFF' && ascii(b, 8, 12) === 'WAVE') return { kind: 'wav' };
  if ((s4 === 'II*\0') || (s4 === 'MM\0*')) return { kind: 'tif' };
  if (ascii(b, 0, 2) === 'BM' && b.length > 26 && b.readUInt32LE(2) <= b.length + 16) return { kind: 'bmp' };
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return { kind: nameExt === 'heif' ? 'heif' : 'heic' };
    if (brand === 'qt  ') return { kind: 'mov' };
    if (/^M4A/.test(brand)) return { kind: 'm4a' };
    return { kind: nameExt === 'm4a' ? 'm4a' : nameExt === 'mov' ? 'mov' : 'mp4' };
  }
  if (b.length > 4 && b.readUInt32BE(0) === 0x1a45dfa3) return { kind: 'webm' };
  if (s4 === 'OggS') return { kind: 'ogg' };
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && nameExt === 'mp3')) return { kind: 'mp3' };
  if (/^AC1\d{3}$/.test(ascii(b, 0, 6))) return { kind: 'dwg' };
  if (s4 === 'PK\x03\x04' || s4 === 'PK\x05\x06') return inspectZip(b);
  if (b.length >= 8 && b.readUInt32BE(0) === 0xd0cf11e0 && b.readUInt32BE(4) === 0xa1b11ae1) return inspectCompound(b, nameExt);
  if (/^\s*\{\\rtf/.test(ascii(b, 0, 64))) return { kind: 'rtf' };
  // Text-like: the name decides which (txt, csv, md, json, xml, eml, dxf), as long as it is text.
  const utf16Bom = (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff);
  if (utf16Bom || isText(b)) {
    const head = (utf16Bom ? b.subarray(2, 8192).toString(b[0] === 0xff ? 'utf16le' : 'latin1') : b.subarray(0, 8192).toString('utf8')).trimStart().toLowerCase();
    if (/^(<!doctype html|<html|<svg|<\?xml[^>]*>\s*<svg|<script)/.test(head)) return { refuse: 'The file is a web page or SVG drawing, which can run code in a browser, so it is never accepted. Save it as PDF and upload that.' };
    if (nameExt === 'eml' || looksLikeMail(b)) return { kind: 'eml' };
    if (nameExt === 'dxf' && /^\s*0\s*\r?\n\s*section/.test(head)) return { kind: 'dxf' };
    if (['txt', 'csv', 'tsv', 'md', 'log', 'json', 'xml'].includes(nameExt)) return { kind: nameExt };
    return { kind: 'txt' };
  }
  return { refuse: 'CORE could not tell what kind of file this is, so it is not accepted.' };
}

// Whether `buf` named `name` may be kept under the accepted families. Returns { ok, name, ext, family,
// mime } or { ok: false, reason, code } with a message for the person who uploaded it.
export function checkFile(buf, name, acceptedFamilies = DEFAULT_FAMILIES) {
  const clean = cleanName(name);
  const nameExt = extOf(clean);
  if (BLOCKED.has(nameExt)) return { ok: false, code: 'blocked', reason: `.${nameExt} files are never accepted (${BLOCKED_LABEL.toLowerCase()}).` };
  const s = sniff(buf, nameExt);
  if (s.refuse) return { ok: false, code: 'content', reason: s.refuse };
  const family = FAMILY_OF_EXT[s.kind];
  if (!family) return { ok: false, code: 'content', reason: 'CORE could not tell what kind of file this is, so it is not accepted.' };
  // The name must agree with the content: a ".pdf" that is a ZIP is refused, not renamed.
  const nameFamily = FAMILY_OF_EXT[nameExt];
  if (nameExt && nameFamily && nameFamily !== family && !(family === 'text' && nameFamily === 'text')) {
    return { ok: false, code: 'mismatch', reason: `The file is called .${nameExt} but it is ${article(FAMILY[family].label)} file. Check that it is the right file, and upload it with its real extension.` };
  }
  if (!acceptedFamilies.includes(family)) return { ok: false, code: 'type', reason: `${FAMILY[family].label} files are not accepted here. An administrator can allow them in Document control.` };
  // A text file named only by the bytes keeps its own extension when it is a text one.
  const ext = nameFamily === family ? nameExt : s.kind;
  const finalName = nameExt === ext ? clean : `${clean}.${ext}`;
  return { ok: true, name: finalName, ext, family, mime: mimeOf(ext), inline: Boolean(FAMILY[family].inline) };
}
const article = (label) => (/^[AEIOU]/i.test(label) ? `an ${label}` : `a ${label}`);

// Families that open in the browser (passive content); everything else downloads.
export const isInline = (ext) => Boolean(FAMILY[FAMILY_OF_EXT[ext]]?.inline) && !['tif', 'tiff', 'heic', 'heif', 'bmp'].includes(ext);
