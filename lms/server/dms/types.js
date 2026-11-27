// Document Management (MOD-08): what a file really is, from its bytes, and whether the company accepts
// it. Shared by CORE (server/dms/) and ATLAS (lms/server/dms/): the same file in both, Node's standard
// library only, no imports from either app.
//
// The type always comes from the content (magic numbers, the parts inside a ZIP or an Office compound
// file); the name's extension must then agree with it. Programs, scripts, web pages, SVG, Office files
// with macros, PDFs with scripts or automatic actions, and password-protected (encrypted) files are
// refused whatever the settings (BLOCKED_*). A file, or a part of one, that cannot be read whole to be
// checked is refused, never taken as safe.
import { inflateRawSync, inflateSync, constants as zlibConstants } from 'node:zlib';
import { readCfb, CfbError } from './cfb.js';

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

// Always refused, whatever the control panel says: they can run code on a computer or in a browser
// (programs, installers, scripts, shortcuts, disk images, web pages, Office files with macros).
export const BLOCKED_EXTS = [
  'exe', 'dll', 'com', 'scr', 'pif', 'msi', 'msp', 'mst', 'msu', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'application', 'appref-ms', 'xbap',
  'gadget', 'cpl', 'ocx', 'sys', 'drv', 'inf', 'ins', 'isp', 'reg', 'scf', 'lnk', 'url', 'website', 'library-ms', 'searchconnector-ms', 'settingcontent-ms', 'msc', 'job',
  'bat', 'cmd', 'command', 'ps1', 'ps1xml', 'ps2', 'ps2xml', 'psc1', 'psc2', 'psd1', 'psm1', 'msh', 'msh1', 'msh2', 'mshxml', 'msh1xml', 'msh2xml',
  'vb', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'wsf', 'wsh', 'wsc', 'ws', 'sct', 'hta', 'jar', 'jnlp', 'class', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'py', 'pyw', 'pl', 'rb', 'php',
  'apk', 'app', 'dmg', 'pkg', 'mpkg', 'deb', 'rpm', 'desktop', 'iso', 'img', 'vhd', 'vhdx', 'wim', 'diagcab',
  'html', 'htm', 'xhtml', 'shtml', 'mht', 'mhtml', 'svg', 'svgz', 'swf', 'chm', 'hlp', 'xll', 'xla', 'xlm', 'iqy', 'slk', 'one', 'ade', 'adp', 'mde', 'accde', 'mda',
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'xlsb', 'pptm', 'potm', 'ppsm', 'ppam', 'sldm',
];
export const BLOCKED_LABEL = 'Programs and scripts, web pages and SVG, and Office files with macros';
const BLOCKED = new Set(BLOCKED_EXTS);
// Inside an Office or OpenDocument file, the pictures and pages it shows itself (SVG icons, HTML
// chunks) are part of the document; programs and scripts are not.
const WEB_EXTS = new Set(['html', 'htm', 'xhtml', 'shtml', 'mht', 'mhtml', 'svg', 'svgz']);
// Archives whose contents cannot be looked at here: refused inside a ZIP.
const OPAQUE_ARCHIVES = new Set(['7z', 'rar', 'cab', 'tar', 'gz', 'tgz', 'bz2', 'tbz', 'tbz2', 'xz', 'txz', 'lz', 'lzma', 'zst', 'z', 'zipx', 'arj', 'lzh', 'lha', 'ace', 'sit', 'sitx']);

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

// Characters that change how a name reads without being seen: text-direction controls (with them a
// name can show its extension backwards) and byte-order marks.
const INVISIBLE = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
// A file name that is safe to keep and to send back: no folders, control, direction or reserved
// characters, no leading dots, at most 200 characters (the extension kept).
export function cleanName(name) {
  let n = String(name ?? '').normalize('NFC').replace(INVISIBLE, '').split(/[\\/]/).pop();
  n = n.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>:"|?*]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!n) n = 'file';
  if (n.length > 200) {
    const ext = extOf(n);
    n = ext && ext.length < 12 ? `${n.slice(0, 199 - ext.length).trim()}.${ext}` : n.slice(0, 200);
  }
  return n;
}
export const extOf = (name) => String(name || '').match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase() || '';
// Content-Disposition for a stored file: an ASCII name for old browsers, and the whole name in
// filename* with every character outside RFC 8187's attr-char percent-encoded (' ( ) * included).
export const encodeRfc5987 = (value) => encodeURIComponent(String(value)).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export function contentDisposition(kind, name) {
  const n = String(name ?? '').replace(INVISIBLE, '').replace(CONTROL, ' ');
  return `${kind}; filename="${n.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeRfc5987(n)}`;
}

const ascii = (buf, a, b) => buf.subarray(a, b).toString('latin1');
// Programs, whatever they are called: Windows, Linux and Mac programs, Java classes, scripts with #!.
const isProgram = (b) => {
  const s4 = ascii(b, 0, 4);
  return s4.startsWith('MZ') || s4 === '\x7fELF' || ascii(b, 0, 2) === '#!' || (b.length >= 4 && [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(b.readUInt32BE(0)));
};
const isZipStart = (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6));
const isCompoundStart = (b) => b.length >= 8 && b.readUInt32BE(0) === 0xd0cf11e0 && b.readUInt32BE(4) === 0xa1b11ae1;

// Refusals the checks below share.
const PASSWORD = 'The file is protected with a password. Remove the password and upload it again.';
const MACROS = 'The file contains macros, which are never accepted. Save it without macros and upload it again.';
const MACRO_PARTS = 'The file contains macros, which are never accepted. Save it without macros (.docx, .xlsx, .pptx) and upload it again.';
const UNCHECKED = 'The file could not be checked whole (a part of it is too large, damaged or stored in a way CORE cannot read), so it is not accepted. Open it, save it again and upload that copy.';

// ----- ZIP (Office Open XML, OpenDocument, ZIP archives) -----
// The central directory: names, sizes, flags. Refuses ZIP64 and damaged directories (they are not
// needed for documents of up to 100 MB).
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
    const rawName = buf.subarray(at + 46, at + 46 + nameLen);
    out.push({ name: rawName.toString('utf8'), rawName, flags, method, packed, size, local });
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}
// Where an entry's data starts, from its local header. The local header must name the same file as
// the central directory: a program that unpacks by local headers would otherwise write another file.
function zipLocal(buf, e) {
  const at = e.local;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(at + 26);
  const start = at + 30 + nameLen + buf.readUInt16LE(at + 28);
  if (start + e.packed > buf.length) return null;
  return { flags: buf.readUInt16LE(at + 6), sameName: buf.subarray(at + 30, at + 30 + nameLen).equals(e.rawName), start };
}
// An entry's content, whole: only when it unpacks to exactly the size it states and to at most `max`
// bytes. Anything else (too large, more data than stated, damaged, another compression) is null.
function zipRead(buf, e, max) {
  const l = zipLocal(buf, e);
  if (!l || e.size > max) return null;
  const raw = buf.subarray(l.start, l.start + e.packed);
  try {
    const out = e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.max(1, max) }) : null;
    return out && out.length === e.size ? out : null;
  } catch {
    return null;
  }
}
// The first bytes of an entry (what kind of file it is), without unpacking the rest.
function zipHead(buf, e) {
  const l = zipLocal(buf, e);
  if (!l) return null;
  const raw = buf.subarray(l.start, l.start + e.packed);
  if (e.method === 0) return raw.subarray(0, 8);
  try {
    return inflateRawSync(raw.subarray(0, 1024), { finishFlush: zlibConstants.Z_SYNC_FLUSH, maxOutputLength: 4 * 1024 * 1024 }).subarray(0, 8);
  } catch {
    return null;
  }
}
// Limits for an archive: far more data than it holds is a "zip bomb"; archives inside archives are
// looked into, at most ZIP_MAX_DEPTH deep and with at most ZIP_LOOK_MAX bytes unpacked to do it.
const ZIP_MAX_TOTAL = 1024 * 1024 * 1024;
const ZIP_MAX_RATIO = 200;
export const ZIP_MAX_DEPTH = 3;
const ZIP_LOOK_MAX = 256 * 1024 * 1024;
const ZIP_PART_MAX = 1024 * 1024; // [Content_Types].xml: a few KB in real files
// Parts that hold macros or controls, by name (whatever [Content_Types].xml says): VBA projects and
// their signatures, Word's VBA data and toolbars, Excel 4.0 macro sheets, ActiveX controls, a binary
// part at the top of word/, xl/ or ppt/ (where Office keeps the VBA project), OpenDocument's Basic.
const MACRO_PART = /(^|\/)(vbaproject\.bin|vbadata\.xml|vbaprojectsignature\w*\.bin|attachedtoolbars\.bin)$|(^|\/)(macrosheets|intl-macrosheets|activex)\/|^(word|xl|ppt)\/[^/]+\.bin$|^(basic|scripts)\//;
// Content types of the same parts.
const MACRO_TYPE = /macroEnabled|vbaProject|vbaData|macrosheet|activeX|ms-office\.vba/i;
const ODF_KINDS = {
  'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.spreadsheet': 'ods', 'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.text-template': 'ott', 'application/vnd.oasis.opendocument.spreadsheet-template': 'ots', 'application/vnd.oasis.opendocument.presentation-template': 'otp',
};
// A name inside an archive as it may be shown in a message: no folders, no invisible characters.
const shownName = (name) => (name.split('/').filter(Boolean).pop() || name).replace(INVISIBLE, '').replace(CONTROL, ' ').slice(0, 120);
// The extensions a name inside an archive really has, as Windows would save it: no folder, no stream
// suffix (":…"), no control or direction characters, no trailing dots or spaces; in lower case.
export function entryExts(name) {
  const base = String(name).replace(/\\/g, '/').split('/').pop().replace(INVISIBLE, '').replace(CONTROL, '');
  return base.split(':').map((p) => p.replace(/[.\s]+$/, '').toLowerCase().match(/\.([^.]+)$/)?.[1] || '').filter(Boolean);
}

// depth: how many archives this one is inside; budget: { left } bytes that may still be unpacked to
// look inside the files it holds (shared with the archives inside it).
function inspectZip(buf, depth = 0, budget = { left: ZIP_LOOK_MAX }) {
  const entries = zipEntries(buf);
  if (!entries) return { refuse: 'The file looks like a ZIP but is damaged or uses a ZIP format CORE does not read (ZIP64).' };
  if (entries.some((e) => e.flags & 1)) return { refuse: PASSWORD };
  const total = entries.reduce((n, e) => n + e.size, 0);
  if (total > ZIP_MAX_TOTAL || (buf.length > 0 && total / buf.length > ZIP_MAX_RATIO && total > 50 * 1024 * 1024)) return { refuse: 'The ZIP file unpacks to far more data than it holds, so it is refused.' };
  const names = entries.map((e) => e.name.replace(/\\/g, '/'));
  const lower = names.map((n) => n.replace(INVISIBLE, '').replace(CONTROL, '').toLowerCase());
  if (new Set(lower).size !== lower.length) return { refuse: 'The file holds two files with the same name, so it cannot be checked and is refused.' };
  for (const e of entries) {
    const l = zipLocal(buf, e);
    if (!l) return { refuse: 'The file looks like a ZIP but is damaged or uses a ZIP format CORE does not read (ZIP64).' };
    if (!l.sameName) return { refuse: 'The file is damaged: the names inside it do not agree with each other, so it is refused.' };
    if (l.flags & 1) return { refuse: PASSWORD };
  }
  if (lower.some((n) => MACRO_PART.test(n))) return { refuse: MACRO_PARTS };
  // Office Open XML: [Content_Types].xml must be read whole, and the main part names the kind.
  let kind = null;
  let office = false;
  const ct = entries.filter((_, i) => lower[i] === '[content_types].xml');
  if (ct.length) {
    office = true;
    const xml = zipRead(buf, ct[0], ZIP_PART_MAX)?.toString('utf8');
    if (xml == null) return { refuse: UNCHECKED };
    if (MACRO_TYPE.test(xml)) return { refuse: MACROS };
    if (lower.includes('word/document.xml')) kind = /template\.main/i.test(xml) ? 'dotx' : 'docx';
    else if (lower.includes('xl/workbook.xml')) kind = /template\.main/i.test(xml) ? 'xltx' : 'xlsx';
    else if (lower.includes('ppt/presentation.xml')) kind = /template\.main/i.test(xml) ? 'potx' : /slideshow\.main/i.test(xml) ? 'ppsx' : 'pptx';
    else if (!depth) return { refuse: 'The file is an Office package of a kind CORE does not keep.' };
  } else {
    // OpenDocument: a stored "mimetype" part names the kind.
    const mt = entries.find((_, i) => lower[i] === 'mimetype');
    kind = (mt && ODF_KINDS[zipRead(buf, mt, 200)?.toString('latin1').trim()]) || null;
    office = Boolean(kind);
  }
  const bad = inspectEntries(buf, entries, names, lower, office, depth, budget);
  return bad ? { refuse: bad } : { kind: kind || 'zip' };
}

// Every file in an archive, or part of an Office or OpenDocument file: no program or script by its
// name or by its first bytes, no archive that cannot be looked into, and archives and Office 97–2003
// files inside it checked as the file itself is. Returns a refusal, or null.
function inspectEntries(buf, entries, names, lower, office, depth, budget) {
  const what = office ? 'The file' : 'The ZIP file';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const shown = shownName(names[i]);
    if (lower[i].split('/').includes('..') || lower[i].startsWith('/') || /^[a-z]:/.test(lower[i])) return `${what} contains “${shown}”, which would be unpacked outside its folder, so it is refused.`;
    const exts = entryExts(names[i]);
    if (exts.some((x) => BLOCKED.has(x) && !(office && WEB_EXTS.has(x)))) return `${what} contains “${shown}”, a kind of file that is never accepted (programs, scripts and web pages).`;
    if (exts.some((x) => OPAQUE_ARCHIVES.has(x))) return `${what} contains “${shown}”, an archive that cannot be checked, so it is refused. Unpack it and add the files themselves.`;
    if (lower[i].endsWith('/') || e.size === 0) continue;
    if (e.method !== 0 && e.method !== 8) return `${what} uses a kind of compression that cannot be checked, so it is refused. Make it again with ordinary ZIP compression.`;
    const head = zipHead(buf, e);
    if (!head || head.length < Math.min(8, e.size)) return UNCHECKED;
    if (isProgram(head)) return `${what} contains “${shown}”, a program or a script, which is never accepted.`;
    const zip = isZipStart(head);
    if (!zip && !isCompoundStart(head)) continue;
    if (zip && depth >= ZIP_MAX_DEPTH) return `${what} holds archives inside archives more than ${ZIP_MAX_DEPTH} deep, so it cannot be checked and is refused.`;
    const data = zipRead(buf, e, budget.left);
    if (!data) return UNCHECKED;
    budget.left -= data.length;
    const inner = zip ? inspectZip(data, depth + 1, budget) : inspectCompound(data, '', true);
    if (inner.refuse) return inner.refuse;
  }
  return null;
}

// ----- Office 97–2003 and Outlook (.doc, .xls, .ppt, .msg: "compound files") -----
// Read as the small file system they are (cfb.js): the names of their streams tell them apart, and
// tell encryption and macros; Word's file header and Excel's workbook records tell the rest.
const utf16 = (s) => Buffer.from(s, 'utf16le');
const lastPart = (p) => p.split('/').pop();
// Word 6 to 2003: the file header (FIB) says whether the document is encrypted (fEncrypted).
const wordEncrypted = (s) => s.length >= 12 && [0xa5ec, 0xa5dc].includes(s.readUInt16LE(0)) && (s.readUInt16LE(0x0a) & 0x0100) !== 0;
// Excel 5 to 2003 (BIFF): the workbook's first records. FILEPASS: the workbook is encrypted.
// BOUNDSHEET: each sheet with its type; 1 is an Excel 4.0 macro sheet, 6 a VBA module.
function inspectBiff(s) {
  for (let at = 0; at + 4 <= s.length;) {
    const type = s.readUInt16LE(at);
    const len = s.readUInt16LE(at + 2);
    if (type === 0x002f) return PASSWORD;
    if (type === 0x0085 && len >= 6 && at + 10 <= s.length && (s[at + 9] === 0x01 || s[at + 9] === 0x06)) return MACROS;
    if (type === 0x000a) break; // the end of the workbook's own records
    at += 4 + len;
  }
  return null;
}
// An object packaged into a document (Ole10Native): the names it carries (label, file, temporary
// copy) must not be a program or a script.
function packagedBlocked(s) {
  return s.subarray(0, 4096).toString('latin1').split('\0').some((piece) => entryExts(piece).some((x) => BLOCKED.has(x)));
}
// nested: a compound file inside another file (an embedded object): only what it holds is checked,
// not whether it is a kind CORE keeps.
function inspectCompound(buf, ext, nested = false) {
  const look = (s) => buf.indexOf(utf16(s)) >= 0;
  if (look('EncryptedPackage') || look('EncryptionInfo')) return { refuse: PASSWORD };
  if (look('_VBA_PROJECT') || look('VBA') && look('Macros')) return { refuse: MACROS };
  let kind = null;
  try {
    const cfb = readCfb(buf);
    const streams = cfb.names.map((n) => n.toLowerCase());
    const storages = cfb.storages.map((n) => n.toLowerCase());
    if (streams.some((n) => ['encryptedpackage', 'encryptioninfo', 'encryptedsummary'].includes(lastPart(n)))) return { refuse: PASSWORD };
    if (storages.some((n) => ['vba', 'macros', '_vba_project_cur'].includes(lastPart(n))) || streams.some((n) => lastPart(n) === '_vba_project')) return { refuse: MACROS };
    for (let i = 0; i < streams.length; i++) {
      const n = lastPart(streams[i]);
      const refuse = n === 'worddocument' ? (wordEncrypted(cfb.read(cfb.names[i])) ? PASSWORD : null)
        : n === 'workbook' || n === 'book' ? inspectBiff(cfb.read(cfb.names[i]))
          : n === '\u0001ole10native' ? (packagedBlocked(cfb.read(cfb.names[i])) ? 'The file contains a program or a script packaged inside it, which is never accepted.' : null) : null;
      if (refuse) return { refuse };
    }
    if (cfb.has('WordDocument')) kind = ext === 'dot' ? 'dot' : 'doc';
    else if (cfb.has('Workbook') || cfb.has('Book')) kind = ext === 'xlt' ? 'xlt' : 'xls';
    else if (cfb.has('PowerPoint Document')) kind = ['pps', 'pot'].includes(ext) ? ext : 'ppt';
    else if (streams.some((n) => n.startsWith('__substg1.0_'))) kind = 'msg';
  } catch (err) {
    if (err instanceof CfbError) return { refuse: 'The Office 97–2003 file is damaged, so it cannot be checked and is not accepted. Open it, save it again and upload that copy.' };
    throw err;
  }
  if (kind) return { kind };
  if (nested) return { kind: 'ole' };
  return { refuse: 'The file is an Office 97–2003 file of a kind CORE does not keep (or an installer).' };
}

// ----- PDF -----
// Refused: encrypted PDFs (an /Encrypt dictionary: they cannot be checked) and PDFs with JavaScript
// or actions that run by themselves (/JS, /JavaScript, /S /Launch, /AA). The keys are looked for in
// the whole file (objects can hide anywhere a reader may look), with names spelled with #xx read as
// letters and comments read as spaces, and in every Flate stream that starts like an object stream.
const PDF_DELIMS = '\0\t\n\f\r ()<>[]{}/%';
const PDF_LOOK_MAX = 128 * 1024 * 1024; // unpacked from object streams, in all
const PDF_ENCRYPTED = 'The PDF is encrypted (protected with a password, or against printing or copying), so it cannot be checked and is not accepted. Save or print it as a new PDF without protection and upload that.';
const PDF_ACTIVE = 'The PDF contains JavaScript or actions that run by themselves when it is opened, which are never accepted. Print it to a new PDF and upload that.';
const PDF_UNCHECKED = 'The PDF could not be checked whole (a part of it is too large or damaged), so it is not accepted. Print it to a new PDF and upload that.';
const pdfNames = (text) => text.replace(/\/[^\0\t\n\f\r ()<>[\]{}/%]*/g, (n) => (n.includes('#') ? n.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : n));
// Past white space and comments from `i` (at most `max` characters).
function pdfSkip(t, i, max = 512) {
  const end = Math.min(t.length, i + max);
  while (i < end) {
    const c = t.charCodeAt(i);
    if (c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32) i++;
    else if (c === 37) while (i < end && t[i] !== '\n' && t[i] !== '\r') i++;
    else break;
  }
  return i;
}
const digitsAt = (t, i, max) => {
  let j = i;
  while (j < i + max && t.charCodeAt(j) >= 48 && t.charCodeAt(j) <= 57) j++;
  return j;
};
// "12 0 R": a reference to another object.
function pdfRef(t, i) {
  const a = digitsAt(t, i, 10);
  const b = pdfSkip(t, a);
  if (a === i || b === a) return false;
  const c = digitsAt(t, b, 5);
  const r = pdfSkip(t, c);
  return c > b && r > c && t[r] === 'R' && (r + 1 >= t.length || PDF_DELIMS.includes(t[r + 1]));
}
const pdfDict = (t, i) => t.startsWith('<<', i) && (t[pdfSkip(t, i + 2)] === '/' || t.startsWith('>>', pdfSkip(t, i + 2)));
function pdfScan(t) {
  const found = { encrypted: false, active: false };
  for (const m of t.matchAll(/\/(JS|JavaScript|AA|S|Encrypt)(?=[\0\t\n\f\r ()<>[\]{}/%]|$)/g)) {
    const i = pdfSkip(t, m.index + m[0].length);
    if (m[1] === 'Encrypt') found.encrypted ||= pdfRef(t, i) || pdfDict(t, i);
    else if (m[1] === 'S') found.active ||= /^\/(JavaScript|Launch)(?![^\0\t\n\f\r ()<>[\]{}/%])/.test(t.slice(i, i + 12));
    else if (m[1] === 'JS') found.active ||= pdfRef(t, i) || (t[i] === '(' && (t.startsWith('(\xfe\xff', i) || /^[\x20-\x7e\t\r\n]{4}/.test(t.slice(i + 1, i + 5)))) || /^<[0-9A-Fa-f\s]{4}/.test(t.slice(i, i + 5));
    else found.active ||= pdfRef(t, i) || pdfDict(t, i);
    if (found.encrypted) break;
  }
  return found;
}
const zlibStart = (d) => d.length >= 2 && (d[0] & 0x0f) === 8 && d[0] >> 4 <= 7 && ((d[0] << 8) | d[1]) % 31 === 0;
// An object stream starts with pairs of numbers (object, offset), after any white space or comments.
const objectsStart = (h) => {
  const i = pdfSkip(h, 0, h.length);
  return i >= h.length || /^\d+[\0\t\n\f\r ]+\d/.test(h.slice(i, i + 40));
};
function inspectPdf(buf) {
  const raw = buf.toString('latin1');
  const found = pdfScan(pdfNames(raw));
  if (found.encrypted) return { refuse: PDF_ENCRYPTED };
  if (found.active) return { refuse: PDF_ACTIVE };
  let left = PDF_LOOK_MAX;
  for (let at = raw.indexOf('stream'); at >= 0; at = raw.indexOf('stream', at + 6)) {
    if (raw.startsWith('end', at - 3)) continue;
    let start = at + 6;
    if (raw[start] === '\r') start++;
    if (raw[start] === '\n') start++;
    if (start === at + 6) continue;
    const stop = raw.indexOf('endstream', start);
    const data = buf.subarray(start, stop < 0 ? buf.length : stop);
    if (!zlibStart(data)) continue;
    let head;
    try {
      head = inflateSync(data.subarray(0, 1024), { finishFlush: zlibConstants.Z_SYNC_FLUSH, maxOutputLength: 4 * 1024 * 1024 });
    } catch {
      continue; // unreadable from its start: no reader finds objects in it either
    }
    if (!objectsStart(head.toString('latin1'))) continue;
    let body;
    try {
      body = inflateSync(data, { finishFlush: zlibConstants.Z_SYNC_FLUSH, maxOutputLength: Math.max(1, left) });
    } catch {
      return { refuse: PDF_UNCHECKED };
    }
    left -= body.length;
    const inner = pdfScan(pdfNames(body.toString('latin1')));
    if (inner.encrypted || inner.active) return { refuse: inner.encrypted ? PDF_ENCRYPTED : PDF_ACTIVE };
  }
  return { kind: 'pdf' };
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
  if (isProgram(b)) return { refuse: 'The file is a program or a script, which is never accepted.' };
  // A PDF starts with %PDF-. A file named .pdf may have a few bytes before it that some writers put
  // there (a byte-order mark, blank bytes): at most 8, and never text, so a web page that mentions
  // %PDF- further on is not taken for a PDF.
  const pdfAt = b.subarray(0, 16).indexOf('%PDF-');
  if (pdfAt === 0 || (pdfAt > 0 && pdfAt <= 8 && nameExt === 'pdf' && b.subarray(0, pdfAt).every((c) => c < 0x21 || c > 0x7e))) return inspectPdf(b);
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
  if (isCompoundStart(b)) return inspectCompound(b, nameExt);
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
