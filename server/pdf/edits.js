// PDF Studio (0.65): what someone adds to a page in the page editor, and how it is drawn.
//
// Edits are in the page as it is shown (turned as arranged, upright), in points, from its top-left
// corner — the way the editor places them; build.js draws them through the same turning matrix as
// the page numbers. Kinds:
//   text       { x, y, w?, text, size, family, bold, italic, color }    a text box (w: wrap width)
//   box        { x, y, w, h, color }                                     a filled box (white-out)
//   highlight  { x, y, w, h, color }                                     see-through colour
//   image      { x, y, w, h, data, signature? }                          a picture: a signature
//   mark       { x, y, size, kind: check | cross | dot, color }          a tick, a cross, a dot
//   replace    { run, text, size, family, bold, italic, color }          an existing line of text,
//              changed: the original is taken out of the page (render.js removeTextOps) and the
//              new words are drawn where it started, in the page's own space.
import { faceOf, encodeWinAnsi, widthOf } from './writer.js';
import { decodePng, jpegInfo } from './images.js';

export const MAX_EDITS = 300; // per page
export const MAX_EDIT_IMAGE_BYTES = 2 * 1024 * 1024;
const FAMILIES = ['sans', 'serif', 'mono'];
const MARKS = ['check', 'cross', 'dot'];
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const num = (v, lo, hi, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`Page editor: ${label} is out of range.`);
  return Math.round(n * 100) / 100;
};
const color = (v, fallback = '#111111') => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const text = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max) : '');

// The edits of one page as sent by the editor, checked. Unknown kinds are refused.
export function cleanEdits(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw bad('Page editor: send the changes as a list.');
  if (list.length > MAX_EDITS) throw bad(`A page can have up to ${MAX_EDITS} changes.`);
  return list.map((e) => {
    const t = e?.type;
    const pos = () => ({ x: num(e.x, -50, 20000, 'a position'), y: num(e.y, -50, 20000, 'a position') });
    const size = () => ({ w: num(e.w, 0.5, 20000, 'a width'), h: num(e.h, 0.5, 20000, 'a height') });
    const font = () => ({ size: num(e.size ?? 12, 3, 200, 'the text size'), family: FAMILIES.includes(e.family) ? e.family : 'sans', bold: e.bold === true, italic: e.italic === true, color: color(e.color) });
    if (t === 'text') {
      const words = text(e.text, 4000);
      return { type: t, ...pos(), w: e.w == null || e.w === '' ? null : num(e.w, 4, 20000, 'a width'), text: words, ...font() };
    }
    if (t === 'box') return { type: t, ...pos(), ...size(), color: color(e.color, '#ffffff') };
    if (t === 'highlight') return { type: t, ...pos(), ...size(), color: color(e.color, '#ffe066') };
    if (t === 'mark') return { type: t, ...pos(), size: num(e.size ?? 14, 4, 200, 'a mark\'s size'), kind: MARKS.includes(e.kind) ? e.kind : 'check', color: color(e.color, '#1f6f43') };
    if (t === 'image') {
      const data = typeof e.data === 'string' ? Buffer.from(e.data.replace(/^data:image\/(png|jpeg);base64,/, ''), 'base64') : null;
      if (!data?.length) throw bad('Page editor: a picture or signature is missing.');
      if (data.length > MAX_EDIT_IMAGE_BYTES) throw bad('Page editor: a picture or signature is larger than 2 MB.');
      const png = data.length > 8 && data.readUInt32BE(0) === 0x89504e47;
      const jpeg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8;
      if (!png && !jpeg) throw bad('Page editor: a picture or signature must be a PNG or JPEG.');
      // Read now, so a damaged picture is refused with a message rather than failing the export.
      try {
        if (png) decodePng(data);
        else jpegInfo(data);
      } catch {
        throw bad('Page editor: a picture or signature is damaged. Add it again.');
      }
      return { type: t, ...pos(), ...size(), data, signature: e.signature === true };
    }
    if (t === 'replace') {
      const run = Number(e.run);
      if (!Number.isInteger(run) || run < 0 || run > 1_000_000) throw bad('Page editor: that line of text is not on the page.');
      return { type: t, run, text: text(e.text, 4000), ...font() };
    }
    throw bad('Page editor: an unknown kind of change.');
  });
}

// Lines of a text box: its own line breaks, then wrapped to `width` (when set).
export const MAX_BOX_LINES = 400;
export function boxLines(words, face, size, width) {
  const out = [];
  for (const para of String(words).split('\n')) {
    if (out.length >= MAX_BOX_LINES) break;
    if (!width) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && widthOf(encodeWinAnsi(next.trimEnd()), face, size) > width) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out.slice(0, MAX_BOX_LINES);
}

// Draws the edits that sit on the page as shown (all but replace) into `c`, already turned so that
// (0, 0) is the bottom-left of the page as shown and it is h tall. image(data) embeds a picture and
// returns its key. W: the page's width as shown (a text box without a width wraps at its edge, as
// the editor shows it).
export function drawEdits(c, edits, h, image, W = 10000) {
  for (const e of edits) {
    if (e.type === 'replace') continue;
    if (e.type === 'box' || e.type === 'highlight') {
      c.save();
      if (e.type === 'highlight') c.opacity(0.85, { multiply: true });
      c.color(...rgb(e.color)).rect(e.x, h - e.y - e.h, e.w, e.h, { fill: true, stroke: false });
      c.restore();
    } else if (e.type === 'image') {
      c.image(image(e.data), e.x, h - e.y - e.h, e.w, e.h);
    } else if (e.type === 'text') {
      const face = faceOf(e.family, e.bold, e.italic);
      const lines = boxLines(e.text, face, e.size, e.w || Math.max(20, W - e.x - 8));
      c.save().color(...rgb(e.color));
      lines.forEach((line, i) => c.text(e.x, h - e.y - e.size * 0.85 - i * e.size * 1.2, line, face, e.size));
      c.restore();
    } else if (e.type === 'mark') {
      const s = e.size;
      const x = e.x;
      const y = h - e.y - s;
      c.save().stroke(...rgb(e.color)).color(...rgb(e.color)).lineWidth(Math.max(1, s / 8)).raw('1 J 1 j');
      if (e.kind === 'check') c.raw(`${x + s * 0.12} ${y + s * 0.5} m ${x + s * 0.4} ${y + s * 0.18} l ${x + s * 0.9} ${y + s * 0.85} l S`);
      else if (e.kind === 'cross') c.line(x + s * 0.15, y + s * 0.15, x + s * 0.85, y + s * 0.85).line(x + s * 0.15, y + s * 0.85, x + s * 0.85, y + s * 0.15);
      else {
        // A dot: a circle from four curves.
        const r = s * 0.3;
        const cx = x + s / 2;
        const cy = y + s / 2;
        const k = r * 0.5523;
        c.raw(`${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c f`);
      }
      c.restore();
    }
  }
}

// A run's size as it looks on the page, and its matrix without that scale: a line set as "1 Tf" in
// a text matrix scaled 30 times (Quartz, Ghostscript…) is 30 pt, drawn through an unscaled matrix
// (QA 0.65.1: it was 1 pt, refused, or drawn 30 times too large).
export function runScale(run) {
  const [a, b, c, d] = run.matrix || [1, 0, 0, 1];
  const s = Math.sqrt(Math.abs(a * d - b * c)) || 1;
  return { size: Math.round(run.size * s * 100) / 100, matrix: [a / s, b / s, c / s, d / s, run.matrix?.[4] || 0, run.matrix?.[5] || 0] };
}
// Draws the changed lines of text in the page's own space: each where its original started, through
// the original's matrix (render.js run.matrix, from the page box's bottom-left), at (bx, by).
export function drawReplacements(c, edits, runs, bx, by) {
  for (const e of edits) {
    if (e.type !== 'replace' || !e.text) continue;
    const run = runs.get(e.run);
    if (!run) continue;
    const face = faceOf(e.family, e.bold, e.italic);
    c.save().transform(1, 0, 0, 1, bx, by).transform(...runScale(run).matrix).color(...rgb(e.color));
    String(e.text).split('\n').forEach((line, i) => c.text(0, -i * e.size * 1.2, line, face, e.size));
    c.restore();
  }
}
export const hasSignature = (edits) => edits.some((e) => e.type === 'image' && e.signature);
