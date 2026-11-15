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
// opts.image(id): a picture's address (a picture written inside a sentence shows small, in the line).
const URL_CHARS = String.raw`(?:[^\s<>"'()]|\([^\s<>"'()]*\))+`;
const LINK_RE = new RegExp(String.raw`\[([^\]\n]+)\]\((${URL_CHARS})\)`, 'g');
const BARE_RE = new RegExp(String.raw`(^|[\s(])(https?:\/\/${URL_CHARS})`, 'g');
// Bold, italic, struck: on text already escaped (held pieces stay as their placeholders).
const emphasis = (s) => s.replace(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, '<strong><em>$1</em></strong>')
  .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
  .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]?)\*(?![\w*])/g, (all, pre, t) => (t ? `${pre}<em>${t}</em>` : all))
  .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, '$1<em>$2</em>')
  .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<del>$1</del>');
function inline(text, opts = {}) {
  const keep = [];
  const hold = (h) => `\u0000${keep.push(h) - 1}\u0000`;
  let s = String(text).replace(/\u0000/g, '');
  // Code first: nothing inside it is formatted.
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  // A backslash before a mark keeps the mark as text (the editor writes \* for a typed *).
  s = s.replace(/\\([\\*_~`[\]|#>.+!()-])/g, (_, ch) => hold(esc(ch)));
  // A picture of the task inside a sentence.
  s = s.replace(/!\[([^\]\n]*)\]\(img:([0-9a-f-]{36})\)/g, (all, alt, id) => {
    const src = UUID.test(id) && opts.image ? opts.image(id) : null;
    return hold(src ? `<img class="rich-inline-img" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" />` : `<span class="rich-missing">${esc(alt ? `Picture not found: ${alt}` : 'Picture not found')}</span>`);
  });
  // [label](url): a web or mail link (brackets inside the address are kept); anything else stays as
  // the text. Its words are formatted like the rest (with what is already held inside them).
  s = s.replace(LINK_RE, (all, label, url) => {
    const u = safeUrl(url);
    return u ? hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${emphasis(esc(label))}</a>`) : all;
  });
  // Bare web addresses become links (a full stop or comma after one is not part of it).
  s = s.replace(BARE_RE, (_, pre, url) => {
    const tail = url.match(/[.,;:!?]+$/)?.[0] || '';
    const u = tail ? url.slice(0, -tail.length) : url;
    return `${pre}${hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`)}${tail}`;
  });
  s = emphasis(esc(s));
  // Held pieces back in (a link can hold others: repeat until none is left).
  for (let n = 0; n < 4 && s.includes('\u0000'); n++) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i] ?? '');
  return s.replace(/\u0000/g, '');
}

const ITEM = /^(\s*)([-*+]|\d{1,6}[.)])\s+(.*)$/;
const IMAGE_LINE = /^!\[([^\]\n]*)\]\(img:([0-9a-f-]{36})\)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const tableAlign = (c) => {
  const t = c.trim();
  return t.startsWith(':') && t.endsWith(':') ? 'center' : t.endsWith(':') ? 'right' : t.startsWith(':') ? 'left' : null;
};
const isBlockStart = (l, next = '') => /^(#{1,3}\s|>|```|---+\s*$|\*\*\*+\s*$)/.test(l) || ITEM.test(l) || IMAGE_LINE.test(l.trim()) || (l.trim().startsWith('|') && TABLE_SEP.test(next));
const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, '    ').length;

// A list starting at lines[i] (bullets or numbers, as its first line says), with the items under it
// that are indented more as lists of their own. Items separated by one empty line stay in the list.
// Returns [html, next line].
function list(lines, i, opts) {
  const first = lines[i].match(ITEM);
  const base = indentOf(lines[i]);
  const ordered = /\d/.test(first[2]);
  const start = ordered ? Number(first[2].match(/\d+/)[0]) : 1;
  const items = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // An empty line: the list goes on only if what follows is its next item, or belongs to one.
      let k = i + 1;
      while (k < lines.length && !lines[k].trim()) k++;
      const m = k < lines.length && lines[k].match(ITEM);
      const sameList = m && indentOf(lines[k]) === base && /\d/.test(m[2]) === ordered;
      const deeper = k < lines.length && indentOf(lines[k]) > base && items.length;
      if (k - i > 1 || !(sameList || deeper)) break;
      i = k;
      continue;
    }
    const m = line.match(ITEM);
    const ind = indentOf(line);
    if (m && ind === base) {
      if (/\d/.test(m[2]) !== ordered) break;
      const task = m[3].match(/^\[([ xX])\]\s+(.*)$/);
      items.push({ task: task ? task[1].toLowerCase() === 'x' : null, parts: [inline(task ? task[2] : m[3], opts)], sub: [] });
      i++;
    } else if (m && ind > base && items.length) {
      const [h, next] = list(lines, i, opts);
      items[items.length - 1].sub.push(h);
      i = next;
    } else if (ind > base && items.length) {
      items[items.length - 1].parts.push(inline(line.trim(), opts));
      i++;
    } else break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const li = (x) => {
    const box = x.task === null ? '' : `<input type="checkbox" disabled${x.task ? ' checked' : ''} aria-label="${x.task ? 'Done' : 'Not done'}" /> `;
    return `<li${x.task === null ? '' : ` class="rich-task${x.task ? ' done' : ''}"`}>${box}${x.parts.join('<br />')}${x.sub.join('')}</li>`;
  };
  const tasks = items.some((x) => x.task !== null);
  return [`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}${tasks ? ' class="rich-tasks"' : ''}>${items.map(li).join('')}</${tag}>`, i];
}

// text -> HTML. opts.image(id) -> the picture's URL, or null when the task has no such picture.
export function renderRich(text, opts = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').slice(0, RICH_MAX * 2).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.trimStart().startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      out.push(`<h${h[1].length + 2}>${inline(h[2].trim(), opts)}</h${h[1].length + 2}>`);
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
        ? `<figure class="rich-img"><a href="${esc(src)}" target="_blank" rel="noopener" title="Open full size"><img src="${esc(src)}" alt="${esc(img[1])}" loading="lazy" /></a>${img[1] ? `<figcaption>${inline(img[1], opts)}</figcaption>` : ''}</figure>`
        : `<p class="rich-missing">${esc(img[1] ? `Picture not found: ${img[1]}` : 'Picture not found')}</p>`);
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      // An empty quoted line starts a new paragraph inside the quote.
      const paras = quote.join('\n').split(/\n\s*\n/).map((p) => `<p>${p.split('\n').map((l) => inline(l, opts)).join('<br />')}</p>`);
      out.push(`<blockquote>${paras.join('')}</blockquote>`);
      continue;
    }
    if (line.trim().startsWith('|') && TABLE_SEP.test(lines[i + 1] || '')) {
      // Cells split at | (a \| inside a cell is text).
      const cells = (l) => l.trim().replace(/^\||(?<!\\)\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
      const head = cells(line);
      // A column's alignment, from its line under the header: :--- left, :---: centre, ---: right.
      const align = cells(lines[i + 1]).map(tableAlign);
      const cls = (k) => (align[k] === 'center' || align[k] === 'right' ? ` class="ta-${align[k]}"` : '');
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="rich-table"><table><thead><tr>${head.map((c, k) => `<th${cls(k)}>${inline(c, opts)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td${cls(k)}>${inline(r[k] || '', opts)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (ITEM.test(line)) {
      const [html, next] = list(lines, i, opts);
      out.push(html);
      i = next;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && (!para.length || !isBlockStart(lines[i], lines[i + 1]))) para.push(inline(lines[i++], opts));
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

// ----- From the visual editor: a document model to Markdown -----
// The editor (public/js/richeditor.js) reads what is on screen into this model; the model is
// written as the Markdown above, so what is stored is always the same small, safe format.
//
//   Block:  { t: 'p', c: Inline[] } | { t: 'h', level: 1|2|3, c } | { t: 'quote', paras: Inline[][] }
//           | { t: 'list', ordered, task, start, items: [{ c: Inline[], checked, sub: Block[] }] }
//           | { t: 'code', text } | { t: 'hr' } | { t: 'img', id, alt }
//           | { t: 'table', head: Inline[][], rows: Inline[][][] }
//   Inline: { text, b, i, s, code, href } | { br: true } | { img: id, alt }

// Text as text: the marks are escaped, so a typed * or # stays a * or #.
export const escapeMd = (s) => String(s).replace(/\\/g, '\\\\').replace(/([*_~`[\]|])/g, '\\$1');
// A line that would otherwise start a block (# heading, > quote, - list, 1. list, ``` code, ---).
const escapeLineStart = (line) => line.replace(/^(\s*)(#|>|[-+](?=\s|$)|\d+(?=[.)](?:\s|$))|`{3}|-{3})/, '$1\\$2');
const sameMarks = (a, b) => !a.br && !b.br && !a.img && !b.img && a.b === b.b && a.i === b.i && a.s === b.s && a.code === b.code && (a.href || '') === (b.href || '');
const cleanText = (s) => String(s ?? '').replace(/ /g, ' ').replace(/[​﻿]/g, '');

// Inline runs -> one line of Markdown (a line break -> "\n", or `br` where given).
export function inlineToMarkdown(runs, { br = '\n' } = {}) {
  // Neighbours with the same marks become one run (**ab**, not **a****b**).
  const merged = [];
  for (const r of runs || []) {
    const x = r.br || r.img ? { ...r } : { ...r, text: cleanText(r.text) };
    const last = merged[merged.length - 1];
    if (last && sameMarks(last, x) && !x.br && !x.img) last.text += x.text;
    else if (x.br || x.img || x.text) merged.push(x);
  }
  // Links take their runs together: [**a** b](url).
  const out = [];
  for (let k = 0; k < merged.length; k++) {
    const r = merged[k];
    if (r.br) { out.push(br); continue; }
    if (r.img) { out.push(`![${cleanText(r.alt).replace(/[[\]\n]/g, ' ').trim()}](img:${r.img})`); continue; }
    const href = r.href && safeUrl(r.href);
    if (href) {
      const group = [];
      while (k < merged.length && !merged[k].br && !merged[k].img && merged[k].href === r.href) group.push({ ...merged[k++], href: null });
      k--;
      const label = inlineToMarkdown(group, { br: ' ' }).trim();
      out.push(label ? `[${label}](${href})` : '');
      continue;
    }
    out.push(markRun(r));
    // *italic* right next to a letter (pasted "<i>a</i>b") would not read as italic: an invisible
    // separator keeps it apart (the editor drops it when reading back).
    if (r.i && !r.code && !r.b) out[out.length - 1] = { em: out[out.length - 1] };
  }
  return out.map((x, k) => {
    if (typeof x === 'string') return x;
    const prev = typeof out[k - 1] === 'string' ? out[k - 1] : out[k - 1]?.em || '';
    const next = typeof out[k + 1] === 'string' ? out[k + 1] : out[k + 1]?.em || '';
    return `${/\w$/.test(prev) && /^\*/.test(x.em) ? '\u200b' : ''}${x.em}${/^\w/.test(next) && /\*$/.test(x.em) ? '\u200b' : ''}`;
  }).join('');
}
// One run with its marks; spaces at its ends stay outside them (**word** , not **word **).
function markRun(r) {
  if (r.code) {
    const t = r.text.replace(/`/g, "'");
    return t.trim() ? `\`${t}\`` : t;
  }
  const lead = r.text.match(/^\s*/)[0];
  const rest = r.text.slice(lead.length);
  const trail = rest.match(/\s*$/)[0];
  const core = rest.slice(0, rest.length - trail.length);
  if (!core) return r.text;
  let t = escapeMd(core);
  if (r.s) t = `~~${t}~~`;
  if (r.i) t = `*${t}*`;
  if (r.b) t = `**${t}**`;
  return lead + t + trail;
}
const lines = (md) => md.split('\n');
// The Markdown of a document model.
export function modelToMarkdown(blocks) {
  const out = [];
  let prev = null;
  for (const b of blocks || []) {
    const md = blockToMarkdown(b, '');
    if (md === null) continue;
    // Two lists of the same kind one after the other stay two lists (two empty lines end a list).
    const sep = prev && prev.t === 'list' && b.t === 'list' && prev.ordered === b.ordered ? '\n\n\n' : '\n\n';
    out.push(out.length ? sep + md : md);
    prev = b;
  }
  return out.join('').replace(/\n{4,}/g, '\n\n\n').trim();
}
function blockToMarkdown(b, indent) {
  switch (b.t) {
    case 'p': {
      const md = inlineToMarkdown(b.c);
      if (!md.trim()) return null;
      return lines(md).map((l) => indent + escapeLineStart(l)).join('\n');
    }
    case 'h': {
      const md = inlineToMarkdown(b.c, { br: ' ' }).trim();
      return md ? `${'#'.repeat(Math.min(3, Math.max(1, b.level || 1)))} ${md}` : null;
    }
    case 'quote': {
      const paras = (b.paras || []).map((c) => inlineToMarkdown(c)).filter((x) => x.trim());
      if (!paras.length) return null;
      return paras.map((p) => lines(p).map((l) => `> ${escapeLineStart(l)}`.trimEnd()).join('\n')).join('\n>\n');
    }
    case 'code': {
      // Three backticks inside the code would end it: a zero-width joiner keeps them as text.
      const text = String(b.text ?? '').replace(/\u00a0/g, ' ').replace(/\n+$/, '').replace(/```/g, '``\u200d`');
      return `\`\`\`\n${text}\n\`\`\``;
    }
    case 'hr': return '---';
    case 'img': return b.id ? `![${cleanText(b.alt).replace(/[[\]\n]/g, ' ').trim()}](img:${b.id})` : null;
    case 'table': {
      const cell = (c) => inlineToMarkdown(c, { br: ' ' }).trim() || ' ';
      const width = Math.max(1, (b.head || []).length, ...(b.rows || []).map((r) => r.length));
      const row = (cells) => `| ${Array.from({ length: width }, (_, k) => cell(cells[k] || [])).join(' | ')} |`;
      const rule = (k) => ({ left: ':---', center: ':---:', right: '---:' })[b.align?.[k]] || '---';
      return [row(b.head || []), `| ${Array.from({ length: width }, (_, k) => rule(k)).join(' | ')} |`, ...(b.rows || []).map(row)].join('\n');
    }
    case 'list': return listToMarkdown(b, indent);
    default: return null;
  }
}
function listToMarkdown(b, indent) {
  const out = [];
  let n = Number.isInteger(b.start) ? b.start : 1;
  for (const item of b.items || []) {
    const mark = b.ordered ? `${n++}. ` : b.task ? `- [${item.checked ? 'x' : ' '}] ` : '- ';
    const pad = indent + ' '.repeat(b.ordered ? mark.length : 2);
    const [first = '', ...more] = lines(inlineToMarkdown(item.c));
    out.push(`${indent}${mark}${escapeLineStart(first).trimStart()}`.trimEnd() || `${indent}${mark}`.trimEnd());
    for (const l of more) if (l.trim()) out.push(pad + l.trim());
    for (const sub of item.sub || []) {
      const md = blockToMarkdown(sub, pad);
      if (md) out.push(md);
    }
  }
  return out.join('\n');
}
