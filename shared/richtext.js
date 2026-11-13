// Formatted text for task descriptions: a small Markdown, written with the editor's toolbar (or by
// hand) and shown as HTML. Everything is escaped first, so a description can format text, link to
// web pages and show the task's own pictures, but never add HTML, styles or scripts.
//
//   **bold**  *italic*  ~~struck~~  `code`  [label](https://…)  bare https://… links
//   # Heading  ## Smaller heading  ### Smallest
//   - bullets  1. numbers  > quote  ``` code block ```  --- line
//   ![caption](img:<id>)  a picture uploaded to the task, on its own line
//
// A single line break is kept as a line break (descriptions written before formatting existed read
// as they did). Shared by the browser (preview and task page) and the server (which pictures a
// description uses).

export const RICH_MAX = 8000;
export const IMAGE_REF = /!\[([^\]\n]*)\]\(img:([0-9a-f-]{36})\)/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Web and mail links only (no javascript:, data: or relative links).
export function safeUrl(url) {
  const u = String(url || '').trim();
  if (!/^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+)$/i.test(u)) return null;
  return u;
}

// The ids of the task's pictures that a description shows, in order, without repeats.
export function imageIdsOf(text) {
  return [...new Set([...String(text || '').matchAll(IMAGE_REF)].map((m) => m[2]))];
}

// Inline formatting of one line (already split from blocks). Escapes first, then formats.
function inline(text) {
  const keep = [];
  const hold = (h) => `\u0000${keep.push(h) - 1}\u0000`;
  let s = String(text).replace(/\u0000/g, '');
  // Code first: nothing inside it is formatted.
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  // [label](url): a web or mail link; anything else stays as the text.
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (all, label, url) => {
    const u = safeUrl(url);
    return u ? hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${inline(label)}</a>`) : all;
  });
  // Bare web addresses become links.
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?])/g, (_, pre, url) => `${pre}${hold(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`)}`);
  s = esc(s);
  s = s.replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i]);
}

const BULLET = /^\s*[-*+]\s+/;
const NUMBER = /^\s*(\d{1,6})[.)]\s+/;
const IMAGE_LINE = /^!\[([^\]\n]*)\]\(img:([0-9a-f-]{36})\)$/;
const isBlockStart = (l) => /^(#{1,3}\s|>|```|---+\s*$|\*\*\*+\s*$)/.test(l) || BULLET.test(l) || NUMBER.test(l) || IMAGE_LINE.test(l.trim());

// text -> HTML. opts.image(id) -> the picture's URL, or null when the task has no such picture.
export function renderRich(text, opts = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').slice(0, RICH_MAX * 2).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      out.push(`<h${h[1].length + 2}>${inline(h[2].trim())}</h${h[1].length + 2}>`);
      i++;
      continue;
    }
    if (/^(---+|\*\*\*+)\s*$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }
    const img = line.trim().match(IMAGE_LINE);
    if (img) {
      const id = img[2];
      const src = UUID.test(id) && opts.image ? opts.image(id) : null;
      out.push(src
        ? `<figure class="rich-img"><a href="${esc(src)}" target="_blank" rel="noopener" title="Open full size"><img src="${esc(src)}" alt="${esc(img[1])}" loading="lazy" /></a>${img[1] ? `<figcaption>${inline(img[1])}</figcaption>` : ''}</figure>`
        : `<p class="rich-missing">${esc(img[1] ? `Picture not found: ${img[1]}` : 'Picture not found')}</p>`);
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(inline(lines[i++].replace(/^>\s?/, '')));
      out.push(`<blockquote><p>${quote.join('<br />')}</p></blockquote>`);
      continue;
    }
    if (BULLET.test(line) || NUMBER.test(line)) {
      const ordered = NUMBER.test(line);
      const re = ordered ? NUMBER : BULLET;
      const start = ordered ? Number(line.match(NUMBER)[1]) : 1;
      const items = [];
      while (i < lines.length && lines[i].trim() && (re.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (re.test(lines[i])) items.push([inline(lines[i].replace(re, ''))]);
        else items[items.length - 1].push(inline(lines[i].trim()));
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}${ordered && start > 1 ? ` start="${start}"` : ''}>${items.map((x) => `<li>${x.join('<br />')}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && (!para.length || !isBlockStart(lines[i]))) para.push(inline(lines[i++]));
    out.push(`<p>${para.join('<br />')}</p>`);
  }
  return out.join('\n');
}

// Plain text of a description (for lists, search and CSV): the formatting marks dropped.
export function richToText(text) {
  return String(text || '')
    .replace(IMAGE_REF, (_, alt) => (alt ? `[${alt}]` : '[picture]'))
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1');
}

// ----- Editing (the toolbar): pure functions on the text and the selection -----
// Each takes { value, start, end } and returns the new { value, start, end }.

// Wraps the selection in marks (**, *, ~~, `), or removes them when it is already wrapped.
export function toggleWrap({ value, start, end }, mark, placeholder = 'text') {
  const before = value.slice(0, start);
  const sel = value.slice(start, end);
  const after = value.slice(end);
  if (before.endsWith(mark) && after.startsWith(mark)) {
    return { value: before.slice(0, -mark.length) + sel + after.slice(mark.length), start: start - mark.length, end: end - mark.length };
  }
  if (sel.length >= mark.length * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(mark.length, -mark.length);
    return { value: before + inner + after, start, end: start + inner.length };
  }
  // Spaces at the ends of a selection stay outside the marks (**word** not ** word**).
  const lead = sel.match(/^\s*/)[0];
  const trail = sel.slice(lead.length).match(/\s*$/)[0];
  const core = sel.slice(lead.length, sel.length - trail.length) || placeholder;
  const v = before + lead + mark + core + mark + trail + after;
  const s = start + lead.length + mark.length;
  return { value: v, start: s, end: s + core.length };
}

// The whole lines the selection touches.
function lineRange(value, start, end) {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  let to = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
  if (to < 0) to = value.length;
  return [from, to];
}

const PREFIX = {
  bullet: { re: BULLET, make: () => '- ' },
  number: { re: NUMBER, make: (n) => `${n}. ` },
  quote: { re: /^>\s?/, make: () => '> ' },
  heading: { re: /^#{1,3}\s+/, make: () => '## ' },
};
// Turns the lines into a list, quote or heading, or back to plain lines when they all already are.
export function toggleLines({ value, start, end }, kind) {
  const p = PREFIX[kind];
  const [from, to] = lineRange(value, start, end);
  const lines = value.slice(from, to).split('\n');
  const filled = lines.filter((l) => l.trim());
  const all = filled.length > 0 && filled.every((l) => p.re.test(l));
  let n = 0;
  const next = lines.map((l) => {
    if (!l.trim() && lines.length > 1) return l;
    const bare = l.replace(PREFIX.bullet.re, '').replace(PREFIX.number.re, '').replace(PREFIX.quote.re, '').replace(PREFIX.heading.re, '');
    return all ? bare : p.make(++n) + bare;
  }).join('\n');
  const v = value.slice(0, from) + next + value.slice(to);
  // A single empty line: the cursor goes after the new mark, ready to type.
  if (start === end && lines.length === 1) {
    const pos = from + next.length - lines[0].replace(/^(\s*[-*+]\s+|\s*\d+[.)]\s+|>\s?|#{1,3}\s+)/, '').length;
    return { value: v, start: pos, end: pos };
  }
  return { value: v, start: from, end: from + next.length };
}

// Puts a block (a picture, a line, a code block) on lines of its own at the cursor.
export function insertBlock({ value, start, end }, block, select = null) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const v = before + pre + block + post + after;
  const at = before.length + pre.length;
  if (select) {
    const k = block.indexOf(select);
    if (k >= 0) return { value: v, start: at + k, end: at + k + select.length };
  }
  const pos = at + block.length + post.length;
  return { value: v, start: pos, end: pos };
}

// A link: the selection becomes its label (or the address is the label when nothing is selected).
export function makeLink({ value, start, end }, url) {
  const u = safeUrl(url);
  if (!u) return null;
  const sel = value.slice(start, end).trim();
  const text = `[${(sel || u).replace(/[[\]]/g, '')}](${u})`;
  return { value: value.slice(0, start) + text + value.slice(end), start: start + text.length, end: start + text.length };
}

// Enter inside a list: the next line gets the next bullet or number; Enter on an empty item ends the
// list. Returns null when the cursor is not in a list (the textarea's own Enter then applies).
export function continueList({ value, start, end }) {
  if (start !== end) return null;
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const line = value.slice(from, start);
  const m = line.match(/^(\s*)([-*+]|\d{1,6}[.)])(\s+)(.*)$/) || line.match(/^(>)(\s?)(.*)$/);
  if (!m) return null;
  if (m[1] === '>') {
    if (!m[3].trim()) return { value: value.slice(0, from) + value.slice(start), start: from, end: from };
    const ins = '\n> ';
    return { value: value.slice(0, start) + ins + value.slice(end), start: start + ins.length, end: start + ins.length };
  }
  if (!m[4].trim()) return { value: value.slice(0, from) + value.slice(start), start: from, end: from };
  const n = m[2].match(/^(\d+)([.)])$/);
  const ins = `\n${m[1]}${n ? `${Number(n[1]) + 1}${n[2]}` : m[2]}${m[3]}`;
  return { value: value.slice(0, start) + ins + value.slice(end), start: start + ins.length, end: start + ins.length };
}
