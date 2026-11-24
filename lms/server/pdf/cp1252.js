// Windows-1252, the 8-bit code page of older Word, Excel, RTF, Outlook and text files, decoded by
// ATLAS itself. Node 20's TextDecoder('windows-1252') reads it as Latin-1, so bytes 0x80-0x9F (the
// euro sign, curly quotes, dashes, ellipsis, ™, Œ, Ž…) came out as control characters there; the
// web's labels for Latin-1 and ASCII mean Windows-1252 too (WHATWG Encoding), so they come here.
const HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];
export const CP1252_CHARS = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i >= 0x80 && i < 0xa0 ? HIGH[i - 0x80] : i)).join('');

export function decodeCp1252(bytes, start = 0, end = bytes.length) {
  let s = '';
  for (let i = start; i < end; i++) s += CP1252_CHARS[bytes[i]];
  return s;
}

const LABELS = new Set(['ansi_x3.4-1968', 'ascii', 'cp1252', 'cp819', 'csisolatin1', 'ibm819', 'iso-8859-1', 'iso-ir-100', 'iso8859-1', 'iso88591', 'iso_8859-1', 'iso_8859-1:1987', 'l1', 'latin1', 'us-ascii', 'windows-1252', 'x-cp1252']);
export const isCp1252Label = (label) => LABELS.has(String(label || '').trim().toLowerCase());

// TextDecoder for any label, with Windows-1252 (and its aliases) decoded here. Throws for an
// unknown label, as TextDecoder does.
export function decodeAs(label, bytes) {
  return isCp1252Label(label) ? decodeCp1252(bytes) : new TextDecoder(label).decode(bytes);
}
