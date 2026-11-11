// Reading CSV files (RFC 4180, as Excel and Google Sheets save them): fields in double quotes may
// hold commas, line breaks and doubled quotes (""); a byte-order mark at the start is dropped; the
// separator is a comma or a semicolon (Excel in many European settings saves with ";"), whichever
// the first line uses more, outside quotes. No Node or DOM APIs, so the browser can use it too.
// Nothing in a cell is ever run or evaluated: a cell starting with = is just text.

// The separator of a file: , or ;, from its first line (quoted parts ignored).
export function csvSeparator(text) {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const ch of String(text)) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch === ',') commas++;
    else if (!quoted && ch === ';') semis++;
  }
  return semis > commas ? ';' : ',';
}

// Rows of cells (strings). Lines that are entirely empty are left out. Returns { rows, error }:
// error says where a quoted field is never closed (the rows before it are still returned).
export function parseCsv(input, { separator } = {}) {
  const text = String(input ?? '').replace(/^﻿/, '');
  const sep = separator || csvSeparator(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  const endRow = () => {
    row.push(cell);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') (cell += '"'), i++;
        else quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') (quoted = true), (startLine = line);
    else if (ch === sep) row.push(cell), (cell = '');
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
      line++;
    } else if (ch === '\n') endRow(), line++;
    else cell += ch;
  }
  if (quoted) return { rows, error: `A quoted field that starts on line ${startLine} is never closed.` };
  if (cell !== '' || row.length) endRow();
  return { rows, error: null };
}
