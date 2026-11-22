// PDF Studio (0.64): documents people upload (Word, Excel, PowerPoint, OpenDocument, text, Markdown,
// CSV and HTML) turned into the simple block model that server/pdf/layout.js lays out on PDF pages:
// headings, paragraphs of formatted runs, lists, tables, pictures, code, rules and page breaks.
//
//   toBlocks(buffer, kind, { fileName }) → { title, blocks, landscape, warnings }
//
// Only what a PDF can show plainly is kept: no fonts are embedded, pictures must be JPEG or PNG, and
// nothing in a file is ever run or fetched from the web. Anything the converter could not keep is
// named in warnings, in words the user can read. A file that cannot be read at all throws an Error
// whose message says why, for the user. The converters live in office-ooxml.js (Word, Excel,
// PowerPoint), office-odf.js (OpenDocument) and office-text.js (text, Markdown, CSV, HTML); the ZIP
// reader, the XML parser and the block collector in office-core.js.
import { Out, ReadError, STOP, readZip } from './office-core.js';
import { docxToBlocks, xlsxToBlocks, pptxToBlocks } from './office-ooxml.js';
import { odfToBlocks } from './office-odf.js';
import { txtToBlocks, mdToBlocks, csvToBlocks, htmlToBlocks } from './office-text.js';
import { readCfb, isCompound } from './office-cfb.js';
import { docToBlocks, xlsToBlocks, pptToBlocks } from './office-legacy.js';
import { rtfToBlocks, isRtf } from './office-rtf.js';
import { msgToBlocks } from './office-msg.js';

export { readZip, parseXml } from './office-core.js';
export { isRtf } from './office-rtf.js';

// File extension → kind of document.
export const KINDS = {
  docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', odt: 'odt', ods: 'ods', odp: 'odp',
  txt: 'txt', md: 'md', markdown: 'md', csv: 'csv', html: 'html', htm: 'html',
  doc: 'doc', dot: 'doc', xls: 'xls', xlt: 'xls', ppt: 'ppt', pps: 'ppt', pot: 'ppt', rtf: 'rtf', msg: 'msg',
};

const NAMES = {
  docx: 'a Word document', xlsx: 'an Excel workbook', pptx: 'a PowerPoint presentation',
  odt: 'an OpenDocument text', ods: 'an OpenDocument spreadsheet', odp: 'an OpenDocument presentation',
  txt: 'a text file', md: 'a Markdown file', csv: 'a CSV file', html: 'a web page',
  doc: 'a Word document', xls: 'an Excel workbook', ppt: 'a PowerPoint presentation', rtf: 'a Rich Text document', msg: 'an Outlook message',
};
// The older Office formats (.doc, .xls, .ppt) and password-protected Office files are not ZIPs but
// "compound files" that start with these bytes.
const COMPOUND = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const OLD = { docx: ['Word', '.doc', '.docx'], xlsx: ['Excel', '.xls', '.xlsx'], pptx: ['PowerPoint', '.ppt', '.pptx'] };

const CONVERT = {
  docx: (src, out, label) => docxToBlocks(readZip(src), out, label),
  xlsx: (src, out, label) => xlsxToBlocks(readZip(src), out, label),
  pptx: (src, out, label) => pptxToBlocks(readZip(src), out, label),
  odt: (src, out, label) => odfToBlocks(readZip(src), out, label, 'odt'),
  ods: (src, out, label) => odfToBlocks(readZip(src), out, label, 'ods'),
  odp: (src, out, label) => odfToBlocks(readZip(src), out, label, 'odp'),
  txt: (src, out) => txtToBlocks(src, out),
  md: (src, out) => mdToBlocks(src, out),
  csv: (src, out) => csvToBlocks(src, out),
  html: (src, out) => htmlToBlocks(src, out),
  doc: (src, out, label) => docToBlocks(readCfb(src), out, label),
  xls: (src, out, label) => xlsToBlocks(readCfb(src), out, label),
  ppt: (src, out, label) => pptToBlocks(readCfb(src), out, label),
  rtf: (src, out) => rtfToBlocks(src, out),
  msg: (src, out, label) => msgToBlocks(readCfb(src), out, label),
};

// What a compound file holds, by the streams in it: 'doc', 'xls', 'ppt', 'msg', 'encrypted-ooxml'
// (a password-protected .docx, .xlsx or .pptx) or null (not a compound file, or none of these).
export function sniffCompound(buf) {
  if (!isCompound(buf)) return null;
  let cfb;
  try {
    cfb = readCfb(buf);
  } catch {
    return null;
  }
  if (cfb.has('EncryptedPackage')) return 'encrypted-ooxml';
  if (cfb.has('WordDocument')) return 'doc';
  if (cfb.has('Workbook') || cfb.has('Book')) return 'xls';
  if (cfb.has('PowerPoint Document')) return 'ppt';
  if (cfb.has('__properties_version1.0') || cfb.names.some((n) => n.startsWith('__substg1.0_'))) return 'msg';
  return null;
}
const LEGACY = { doc: 'docx', xls: 'xlsx', ppt: 'pptx' };

export function toBlocks(buffer, kind, { fileName } = {}) {
  let k = KINDS[String(kind || '').toLowerCase().replace(/^\./, '')];
  if (!k) throw new Error(`CORE cannot turn ${kind ? `.${String(kind).replace(/^\./, '')} files` : 'this kind of file'} into a PDF.`);
  const src = Buffer.isBuffer(buffer) ? buffer : typeof buffer === 'string' ? Buffer.from(buffer, 'utf8') : Buffer.from(buffer ?? []);
  const label = fileName ? `“${String(fileName).slice(0, 120)}”` : 'This file';
  let zipped = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(k);
  // People rename files: an older Office file named .docx is read as what it is, a .docx named
  // .doc as a .docx, and Word's Rich Text saved as .doc as Rich Text.
  if (src.subarray(0, 8).equals(COMPOUND) && (zipped || LEGACY[k] || k === 'msg')) {
    const found = sniffCompound(src);
    if (found === 'encrypted-ooxml') {
      throw new Error(`${label} is protected with a password: open it, remove the password, save it and upload it again.`);
    }
    if (found) k = found;
    else if (zipped) {
      const [app, oldExt, ext] = OLD[k] || ['the office program', 'older', `.${k}`];
      throw new Error(`${label} is protected with a password or saved in the older ${app} format (${oldExt}). Open it, remove any password, save it as ${ext} and upload that copy.`);
    }
    zipped = false;
  } else if (LEGACY[k] && src.length >= 4 && src.readUInt32LE(0) === 0x04034b50) {
    k = LEGACY[k];
    zipped = true;
  } else if ((k === 'doc' || k === 'msg') && isRtf(src)) {
    k = 'rtf';
  } else if ((k === 'doc' || k === 'xls') && !isCompound(src) && /<(html|table)[\s>]/i.test(src.subarray(0, 4096).toString('latin1'))) {
    k = 'html'; // a web page saved with a Word or Excel name, as many programs export
  }
  if (zipped && (src.length < 4 || src.readUInt32LE(0) !== 0x04034b50)) {
    throw new Error(`${label} is not ${NAMES[k]} CORE can read: it may be damaged, or be another kind of file with the wrong name.`);
  }
  const out = new Out();
  try {
    CONVERT[k](src, out, label);
  } catch (err) {
    if (err === STOP) { /* the document was long: what was read is kept (see Out.add) */ } else if (err instanceof ReadError) {
      throw new Error(err.message.replace(/^This file\b/, label));
    } else {
      throw new Error(`${label} could not be read as ${NAMES[k]}: it seems to be damaged. Open it, save it again and try once more.`, { cause: err });
    }
  }
  return out.result();
}
