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
function inline(text, opts = {}) {
  const keep = [];
  const hold = (h) => `\u0000${keep.push(h) - 1}\u0000`;
  let s = String(text).replace(/\u0000/g, '');
  // Code first: nothing inside it is formatted.
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  // A picture of the task inside a sentence.
  s = s.replace(/!\[([^\]\n]*)\]\(img:([0-9a-f-]{36})\)/g, (all, alt, id) => {
    const src = UUID.test(id) && opts.image ? opts.image(id) : null;
    return hold(src ? `<img class="rich-inline-img" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" />` : `<span class="rich-missing">${esc(alt ? `Picture not found: ${alt}` : 'Picture not found')}</span>`);
  });
  // [label](url): a web or mail link (brackets inside the address are kept); anything else stays as the text.
  s = s.replace(LINK_RE, (all, label, url) => {
    const u = safeUrl(url);
    return u ? hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${inline(label, opts)}</a>`) : all;
  });
  // Bare web addresses become links (a full stop or comma after one is not part of it).
  s = s.replace(BARE_RE, (_, pre, url) => {
    const tail = url.match(/[.,;:!?]+$/)?.[0] || '';
    const u = tail ? url.slice(0, -tail.length) : url;
    return `${pre}${hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`)}${tail}`;
  });
  s = esc(s);
  s = s.replace(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]?)\*(?![\w*])/g, (all, pre, t) => (t ? `${pre}<em>${t}</em>` : all))
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i]);
}

const ITEM = /^(\s*)([-*+]|\d{1,6}[.)])\s+(.*)$/;
const IMAGE_LINE = /^!\[([^\]\n]*)\]\(img:([0-9a-f-]{36})\)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
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
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="rich-table"><table><thead><tr>${head.map((c) => `<th>${inline(c, opts)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '', opts)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
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

// ----- Editing (the toolbar): pure functions on the text and the selection -----
// Each takes { value, start, end } and returns the new { value, start, end }.

// The marks at the start of a line the toolbar puts there: indent, then a bullet, number, checklist
// box, quote or heading.
const LINE_MARK = /^(\s*)((?:[-*+]|\d{1,6}[.)])\s+(?:\[[ xX]\]\s+)?|>\s?|#{1,3}\s+)?/;
const BULLET = /^\s*[-*+]\s+(?!\[[ xX]\]\s)/;
const NUMBER = /^\s*\d{1,6}[.)]\s+/;
const TASK = /^\s*[-*+]\s+\[[ xX]\]\s+/;

// Wraps the selection in marks (**, *, ~~, `), or removes them when it is already wrapped. Over
// several lines, each line is wrapped on its own (after its bullet or number), as marks do not reach
// across lines.
export function toggleWrap({ value, start, end }, mark, placeholder = 'text') {
  const before = value.slice(0, start);
  const sel = value.slice(start, end);
  const after = value.slice(end);
  if (sel.includes('\n')) {
    const lines = sel.split('\n');
    const parts = lines.map((l) => {
      const head = l.match(LINE_MARK)[0];
      return [head, l.slice(head.length)];
    });
    const filled = parts.filter(([, t]) => t.trim());
    const all = filled.length > 0 && filled.every(([, t]) => t.trim().length >= mark.length * 2 && t.trim().startsWith(mark) && t.trim().endsWith(mark));
    const next = parts.map(([head, t]) => {
      if (!t.trim()) return head + t;
      const lead = t.match(/^\s*/)[0];
      const trail = t.slice(lead.length).match(/\s*$/)[0];
      const core = t.slice(lead.length, t.length - trail.length);
      return head + lead + (all ? core.slice(mark.length, -mark.length) : mark + core + mark) + trail;
    }).join('\n');
    return { value: before + next + after, start, end: start + next.length };
  }
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
  task: { re: TASK, make: () => '- [ ] ' },
  quote: { re: /^>\s?/, make: () => '> ' },
};
// Turns the lines into a list (bullets, numbers, a checklist) or a quote, or back to plain lines when
// they all already are; indented lines keep their indent (a list inside a list). Headings go round:
// plain → ## → ### → plain.
export function toggleLines({ value, start, end }, kind) {
  const [from, to] = lineRange(value, start, end);
  const lines = value.slice(from, to).split('\n');
  const filled = lines.filter((l) => l.trim());
  const split = (l) => {
    const m = l.match(LINE_MARK);
    return { indent: m[1], mark: m[2] || '', text: l.slice(m[0].length) };
  };
  let make;
  if (kind === 'heading') {
    const level = (l) => (l.match(/^(#{1,3})\s+/) || ['', ''])[1].length;
    const lv = filled.length ? Math.min(...filled.map(level)) : 0;
    const allSame = filled.length > 0 && filled.every((l) => level(l) === lv);
    const nextLevel = !allSame || lv === 0 ? 2 : lv === 2 ? 3 : lv === 1 ? 2 : 0;
    make = () => (nextLevel ? `${'#'.repeat(nextLevel)} ` : '');
  } else {
    const p = PREFIX[kind];
    const all = filled.length > 0 && filled.every((l) => p.re.test(l));
    let n = 0;
    make = () => (all ? '' : p.make(++n));
  }
  const next = lines.map((l) => {
    if (!l.trim() && lines.length > 1) return l;
    const { indent, text } = split(l);
    // A heading or a quote starts at the margin; list items keep their indent.
    return (kind === 'heading' || kind === 'quote' ? '' : indent) + make() + text;
  }).join('\n');
  const v = value.slice(0, from) + next + value.slice(to);
  // One line and no selection: the cursor goes to the end of its marks, ready to type.
  if (start === end && lines.length === 1) {
    const pos = from + next.length - split(lines[0]).text.length + Math.max(0, start - from - (lines[0].length - split(lines[0]).text.length));
    return { value: v, start: Math.min(pos, from + next.length), end: Math.min(pos, from + next.length) };
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

// Enter inside a list: the next line gets the next bullet, number or checklist box, at the same
// indent. Enter on an empty item moves it out one level, or ends the list at the margin. Inside a
// code block, or outside a list, returns null (the text box's own Enter applies).
export function continueList({ value, start, end }) {
  if (start !== end) return null;
  const fences = (value.slice(0, start).match(/^\s*```/gm) || []).length;
  if (fences % 2) return null;
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const line = value.slice(from, start);
  const q = line.match(/^(>)(\s?)(.*)$/);
  if (q) {
    if (!q[3].trim()) return { value: value.slice(0, from) + value.slice(start), start: from, end: from };
    const ins = '\n> ';
    return { value: value.slice(0, start) + ins + value.slice(end), start: start + ins.length, end: start + ins.length };
  }
  const m = line.match(/^(\s*)([-*+]|\d{1,6}[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/);
  if (!m) return null;
  if (!m[5].trim()) {
    // An empty item in a list inside a list: it becomes the next item of the list around it (the next
    // number, or a bullet), at that list's indent. At the margin, the list ends.
    if (m[1].length) {
      const above = value.slice(0, from).split('\n').reverse();
      for (const l of above) {
        const pm = l.match(/^(\s*)([-*+]|\d{1,6}[.)])(\s+)(\[[ xX]\]\s+)?/);
        if (!pm) continue;
        if (pm[1].length >= m[1].length) continue;
        const pn = pm[2].match(/^(\d+)([.)])$/);
        const repl = `${pm[1]}${pn ? `${Number(pn[1]) + 1}${pn[2]}` : pm[2]}${pm[3]}${pm[4] ? '[ ] ' : ''}`;
        return { value: value.slice(0, from) + repl + value.slice(start), start: from + repl.length, end: from + repl.length };
      }
    }
    return { value: value.slice(0, from) + value.slice(start), start: from, end: from };
  }
  const n = m[2].match(/^(\d+)([.)])$/);
  const ins = `\n${m[1]}${n ? `${Number(n[1]) + 1}${n[2]}` : m[2]}${m[3]}${m[4] ? '[ ] ' : ''}`;
  return { value: value.slice(0, start) + ins + value.slice(end), start: start + ins.length, end: start + ins.length };
}
