// Document Management (0.67): the words of a document, for search. CORE reads PDFs and Office,
// OpenDocument and RTF files with the readers of PDF Studio (server/pdf); text files as they are.
// Kept short (the index keeps 60,000 characters of each document) and never fatal: a file whose
// words cannot be read is still found by its title, name, number and tags.
import { readPdf, pageText } from './pdf/reader.js';
import { toBlocks } from './pdf/office.js';

const OFFICE = { docx: 'docx', dotx: 'docx', xlsx: 'xlsx', xltx: 'xlsx', pptx: 'pptx', potx: 'pptx', ppsx: 'pptx', odt: 'odt', ott: 'odt', ods: 'ods', ots: 'ods', odp: 'odp', otp: 'odp', doc: 'doc', dot: 'doc', xls: 'xls', xlt: 'xls', ppt: 'ppt', pps: 'ppt', pot: 'ppt', rtf: 'rtf', msg: 'msg' };
const TEXT = new Set(['txt', 'csv', 'tsv', 'md', 'log', 'json', 'xml', 'eml', 'dxf']);
const MAX = 80000;

function blocksText(blocks, out = []) {
  for (const b of blocks || []) {
    for (const r of b.runs || []) out.push(r.text || '');
    if (b.text) out.push(b.text);
    for (const it of b.items || []) for (const r of it.runs || []) out.push(r.text || '');
    for (const row of b.rows || []) for (const c of row.cells || []) for (const r of c.runs || []) out.push(r.text || '');
    out.push(' ');
    if (out.length > 20000) break;
  }
  return out.join(' ');
}

export function documentText(buf, ext) {
  if (TEXT.has(ext)) return buf.subarray(0, MAX * 2).toString('utf8').slice(0, MAX);
  if (ext === 'pdf') {
    const doc = readPdf(buf, { maxPages: 2000 });
    const parts = [];
    let n = 0;
    for (let i = 0; i < doc.pageCount && n < MAX; i++) {
      const t = pageText(doc, i, 4000);
      parts.push(t);
      n += t.length;
    }
    return parts.join(' ').slice(0, MAX);
  }
  if (OFFICE[ext]) return blocksText(toBlocks(buf, OFFICE[ext]).blocks).slice(0, MAX);
  return '';
}
