// The description editor: what you see is what you get. You type and format in place, with a
// toolbar (whose buttons show what is on at the cursor), a small menu over selected text, a "/" menu
// for blocks, and the usual shortcuts; typing "- " or "1. " or "# " at the start of a line also
// turns it into a list or heading, as in many editors. Pictures upload in the background.
//
// What is stored stays the small Markdown of shared/richtext.js: the editable area is read into a
// document model (only the kinds of content CORE knows), and the model is written as Markdown into
// a hidden form field. Nothing is stored as HTML, so nothing typed or pasted can add HTML or scripts;
// and the task page shows the same Markdown the same way.
//
// References (open source on GitHub): pell (contenteditable with the browser's own editing commands,
// so undo works), Trix (the editable area as input and output only, read into its own model; files
// as attachments that upload while you write), Tiptap and Milkdown (Markdown shortcuts as "input
// rules", a floating menu over the selection, Markdown kept underneath).
import { api } from './api.js';
import { html, raw, toast, modal } from './ui.js';
import { icon } from './icons.js';
import { prepareUpload } from './attachments.js';
import { renderRich, modelToMarkdown, safeUrl, RICH_MAX } from '/shared/richtext.js';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY = MAC ? '⌘' : 'Ctrl+';
const UUID_IN = /\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The picture's address in CORE, when the task has it.
export const imageUrl = (taskId, images) => (id) => (taskId && images.some((x) => x.id === id) ? `/api/pm/tasks/${encodeURIComponent(taskId)}/images/${encodeURIComponent(id)}` : null);

// A description shown on a page.
export const richView = (text, taskId, images = []) => html`<div class="rich">${raw(renderRich(text, { image: imageUrl(taskId, images) }))}</div>`;

// ----- Reading the editable area into the document model (shared/richtext.js) -----
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'FIGURE', 'TABLE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'ADDRESS', 'DL', 'DT', 'DD', 'FIGCAPTION', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CENTER']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'BUTTON', 'SELECT', 'TEXTAREA', 'HEAD', 'META', 'LINK', 'TITLE']);
const isBlock = (n) => n.nodeType === 1 && BLOCK_TAGS.has(n.tagName);
const hasBlockChild = (n) => [...n.childNodes].some((k) => isBlock(k) && k.tagName !== 'BR');
const imageIdOf = (img) => img.getAttribute('data-img') || (img.getAttribute('src') || '').match(UUID_IN)?.[1] || null;

// Inline content of a node: runs of text with their marks, line breaks and pictures.
function readInline(node, marks = {}, pre = false) {
  if (node.nodeType === 3) {
    const t = pre ? node.nodeValue : node.nodeValue.replace(/[\t\n\r ]+/g, ' ');
    return t ? [{ text: t, ...marks }] : [];
  }
  if (node.nodeType !== 1 || SKIP_TAGS.has(node.tagName) || node.classList?.contains('wys-ui')) return [];
  const tag = node.tagName;
  if (tag === 'BR') return [{ br: true }];
  if (tag === 'INPUT') return [];
  if (tag === 'IMG') {
    const id = imageIdOf(node);
    return id ? [{ img: id, alt: node.getAttribute('alt') || '' }] : [];
  }
  const m = { ...marks };
  const style = node.getAttribute?.('style') || '';
  if (tag === 'B' || tag === 'STRONG') m.b = !/font-weight\s*:\s*(normal|[1-4]00)/i.test(style);
  if (tag === 'I' || tag === 'EM') m.i = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') m.s = true;
  if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') m.code = true;
  if (tag === 'A' && node.getAttribute('href')) m.href = node.getAttribute('href');
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) m.b = true;
  if (/font-style\s*:\s*italic/i.test(style)) m.i = true;
  if (/text-decoration[^;]*line-through/i.test(style)) m.s = true;
  const out = [];
  for (const k of node.childNodes) {
    // A block inside a line (pasted content): a line break around it.
    if (isBlock(k) && out.length && !out[out.length - 1].br) out.push({ br: true });
    out.push(...readInline(k, m, pre));
  }
  return out;
}
// Leading and trailing line breaks and spaces dropped.
function trimRuns(runs) {
  const r = [...runs];
  while (r.length && (r[0].br || (r[0].text !== undefined && !r[0].text.trim()))) r.shift();
  while (r.length && (r[r.length - 1].br || (r[r.length - 1].text !== undefined && !r[r.length - 1].text.trim()))) r.pop();
  if (r.length && r[0].text !== undefined) r[0] = { ...r[0], text: r[0].text.replace(/^\s+/, '') };
  if (r.length && r[r.length - 1].text !== undefined) r[r.length - 1] = { ...r[r.length - 1], text: r[r.length - 1].text.replace(/\s+$/, '') };
  return r;
}
const preText = (node) => {
  let s = '';
  for (const k of node.childNodes) {
    if (k.nodeType === 3) s += k.nodeValue;
    else if (k.nodeType === 1 && k.tagName === 'BR') s += '\n';
    else if (k.nodeType === 1) s += (isBlock(k) && s && !s.endsWith('\n') ? '\n' : '') + preText(k);
  }
  return s;
};
function readList(n) {
  const ordered = n.tagName === 'OL';
  const start = ordered ? Number.parseInt(n.getAttribute('start') || '1', 10) || 1 : 1;
  const items = [];
  let task = n.classList.contains('rich-tasks');
  for (const c of n.childNodes) {
    if (c.nodeType !== 1) continue;
    if (c.tagName === 'LI') {
      const box = [...c.childNodes].find((k) => k.nodeType === 1 && k.tagName === 'INPUT' && k.type === 'checkbox');
      if (box) task = true;
      const sub = [];
      let runs = [];
      for (const k of c.childNodes) {
        if (k.nodeType === 1 && (k.tagName === 'UL' || k.tagName === 'OL')) sub.push(readList(k));
        else if (k.nodeType === 1 && isBlock(k)) {
          if (runs.length) runs.push({ br: true });
          runs.push(...readInline(k));
        } else runs.push(...readInline(k));
      }
      items.push({ c: trimRuns(runs), checked: Boolean(box?.checked), sub });
    } else if (c.tagName === 'UL' || c.tagName === 'OL') {
      // A list inside a list as the browser makes it (next to the items, not in one).
      if (items.length) items[items.length - 1].sub.push(readList(c));
      else items.push({ c: [], checked: false, sub: [readList(c)] });
    }
  }
  return { t: 'list', ordered, task: !ordered && task, start, items };
}
function readTable(t) {
  const rows = [...t.querySelectorAll('tr')].map((tr) => [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map((c) => trimRuns(readInline(c))));
  if (!rows.length) return [];
  // A column's alignment, from its header cell.
  const first = [...t.querySelector('tr').children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
  const align = first.map((c) => (c.classList.contains('ta-center') ? 'center' : c.classList.contains('ta-right') ? 'right' : null));
  return [{ t: 'table', head: rows[0], rows: rows.slice(1), ...(align.some(Boolean) ? { align } : {}) }];
}
function readBlock(n) {
  const tag = n.tagName;
  if (SKIP_TAGS.has(tag) || n.classList?.contains('wys-ui')) return [];
  if (/^H[1-6]$/.test(tag)) return [{ t: 'h', level: tag <= 'H3' ? 1 : tag === 'H4' ? 2 : 3, c: trimRuns(readInline(n)) }];
  if (tag === 'UL' || tag === 'OL') return [readList(n)];
  if (tag === 'LI') return [{ t: 'list', ordered: false, task: false, items: [{ c: trimRuns(readInline(n)), sub: [] }] }];
  if (tag === 'BLOCKQUOTE') return [{ t: 'quote', paras: readBlocks(n).map((b) => (b.c ? b.c : b.t === 'list' ? b.items.flatMap((x) => x.c) : [])).filter((c) => c.length) }];
  if (tag === 'PRE') return [{ t: 'code', text: preText(n) }];
  if (tag === 'HR') return [{ t: 'hr' }];
  if (tag === 'TABLE') return readTable(n);
  if (tag === 'FIGURE') {
    const img = n.querySelector('img');
    const id = img && imageIdOf(img);
    if (id) return [{ t: 'img', id, alt: img.getAttribute('alt') || '' }];
  }
  if (n.classList?.contains('rich-table')) {
    const t = n.querySelector('table');
    return t ? readTable(t) : [];
  }
  if (hasBlockChild(n)) return readBlocks(n);
  return [{ t: 'p', c: trimRuns(readInline(n)) }];
}
// The blocks of a container, its loose text and inline pieces gathered into paragraphs.
export function readBlocks(root) {
  const blocks = [];
  let para = null;
  const flush = () => {
    if (para) {
      const c = trimRuns(para);
      if (c.length) blocks.push({ t: 'p', c });
    }
    para = null;
  };
  for (const n of root.childNodes) {
    if (n.nodeType === 3) {
      (para ||= []).push(...readInline(n));
      continue;
    }
    if (n.nodeType !== 1) continue;
    if (!isBlock(n)) {
      if (n.tagName === 'IMG' && imageIdOf(n)) {
        flush();
        blocks.push({ t: 'img', id: imageIdOf(n), alt: n.getAttribute('alt') || '' });
        continue;
      }
      (para ||= []).push(...readInline(n));
      continue;
    }
    flush();
    blocks.push(...readBlock(n));
  }
  flush();
  return blocks;
}
// Any HTML (pasted) -> the Markdown CORE keeps. Read in a detached document: nothing in it runs.
export function htmlToMarkdown(htmlText) {
  const doc = new DOMParser().parseFromString(String(htmlText || ''), 'text/html');
  return modelToMarkdown(readBlocks(doc.body));
}

// ----- The editor's markup -----
const TOOLS = [
  ['bold', 'bold', 'Bold', 'B'],
  ['italic', 'italic', 'Italic', 'I'],
  ['strike', 'strike', 'Strikethrough', 'Shift+X'],
  ['code', 'code', 'Code', 'E'],
  ['link', 'link', 'Link', 'K'],
  '|',
  ['bullet', 'listBullet', 'Bulleted list', 'Shift+8'],
  ['number', 'listNumber', 'Numbered list', 'Shift+7'],
  ['task', 'checkSquare', 'Checklist', 'Shift+9'],
  ['quote', 'quote', 'Quote'],
  ['codeblock', 'codeBlock', 'Code block'],
  ['divider', 'divider', 'Line'],
  ['table', 'table', 'Table'],
  '|',
  ['image', 'image', 'Picture'],
  '|',
  ['undo', 'undo', 'Undo', 'Z'],
  ['redo', 'redo', 'Redo', MAC ? 'Shift+Z' : 'Y'],
];
const STYLES = [['p', 'Text'], ['h3', 'Heading'], ['h4', 'Subheading'], ['h5', 'Small heading']];
const BUBBLE = [['bold', 'bold', 'Bold'], ['italic', 'italic', 'Italic'], ['strike', 'strike', 'Strikethrough'], ['code', 'code', 'Code'], ['link', 'link', 'Link']];
const SLASH = [
  ['p', 'Text', 'Plain text', 'text paragraph'],
  ['h3', 'Heading', 'A large section heading', 'heading title h1'],
  ['h4', 'Subheading', 'A smaller heading', 'subheading h2'],
  ['h5', 'Small heading', 'The smallest heading', 'h3 small'],
  ['bullet', 'Bulleted list', 'A list with bullets', 'list bullet unordered ul'],
  ['number', 'Numbered list', 'Steps in order', 'list numbered ordered steps ol'],
  ['task', 'Checklist', 'Items to tick off', 'todo task check checklist'],
  ['quote', 'Quote', 'Quoted text', 'quote blockquote'],
  ['codeblock', 'Code block', 'Code or a log, as typed', 'code pre log'],
  ['divider', 'Line', 'A line between parts', 'divider hr line separator'],
  ['table', 'Table', 'Rows and columns', 'table grid'],
  ['image', 'Picture', 'Upload a picture', 'image picture photo screenshot'],
];
// The table's own commands (as Tiptap's table extension has them), on a small bar over the table
// where the cursor is and in a menu (right-click, or Shift+F10), as in quill-better-table.
const TABLE_BAR = [
  ['rowAbove', 'rowAbove', 'Insert row above'], ['rowBelow', 'rowBelow', 'Insert row below'],
  ['colLeft', 'colLeft', 'Insert column left'], ['colRight', 'colRight', 'Insert column right'],
  '|', ['delRow', 'rowDelete', 'Delete row'], ['delCol', 'colDelete', 'Delete column'],
];
const TABLE_MENU = [
  [['rowAbove', 'Insert row above'], ['rowBelow', 'Insert row below'], ['colLeft', 'Insert column left'], ['colRight', 'Insert column right']],
  [['rowUp', 'Move row up'], ['rowDown', 'Move row down'], ['colBack', 'Move column left'], ['colFwd', 'Move column right']],
  [['alignLeft', 'Align column left'], ['alignCenter', 'Align column center'], ['alignRight', 'Align column right']],
  [['delRow', 'Delete row'], ['delCol', 'Delete column'], ['delTable', 'Delete table']],
];
const tip = (t) => `${t[2]}${t[3] ? ` (${KEY}${t[3]})` : ''}`;

let seq = 0;
// The editor, for a form. taskId: pictures can be added (null for a task not saved yet).
export function richEditor({ name = 'description', value = '', label = 'Description', taskId = null, placeholder = 'Write the description… Type / for headings, lists, tables and more.' } = {}) {
  const id = `rich-${++seq}`;
  const noPics = !taskId;
  return html`<div class="field span-2 rich-ed wys" data-rich data-task="${taskId || ''}">
    <div class="rich-head"><span class="rich-label" id="${id}-label">${label}</span></div>
    <div class="wys-box">
      <div class="rich-bar" role="toolbar" aria-label="Formatting" aria-controls="${id}">
        <select class="wys-style" aria-label="Text style" title="Text style">${STYLES.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select>
        <span class="rich-sep" aria-hidden="true"></span>
        ${TOOLS.map((t) => (t === '|' ? html`<span class="rich-sep" aria-hidden="true"></span>`
          : html`<button type="button" class="rich-tool" data-tool="${t[0]}" tabindex="-1" aria-label="${tip(t)}" title="${t[0] === 'image' && noPics ? 'Pictures can be added once the task is saved' : tip(t)}" ${['bold', 'italic', 'strike', 'code', 'link', 'bullet', 'number', 'task', 'quote', 'codeblock'].includes(t[0]) ? 'aria-pressed="false"' : ''} ${t[0] === 'image' && noPics ? 'disabled' : ''}>${icon(t[1], 16)}</button>`))}
      </div>
      <div class="wys-area rich" id="${id}" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="${id}-label" aria-describedby="${id}-help" data-placeholder="${placeholder}" spellcheck="true"></div>
      <div class="wys-bubble wys-ui" role="toolbar" aria-label="Format the selected text" hidden>${BUBBLE.map((t) => html`<button type="button" data-tool="${t[0]}" tabindex="-1" aria-label="${t[2]}" title="${t[2]}" aria-pressed="false">${icon(t[1], 15)}</button>`)}</div>
      <div class="wys-slash wys-ui" role="listbox" id="${id}-slash" aria-label="Insert" hidden></div>
      <div class="wys-tbar wys-ui" role="toolbar" aria-label="Table" hidden>${TABLE_BAR.map((t) => (t === '|' ? html`<span class="rich-sep" aria-hidden="true"></span>`
        : html`<button type="button" data-top="${t[0]}" tabindex="-1" aria-label="${t[2]}" title="${t[2]}">${icon(t[1], 16)}</button>`))}<span class="rich-sep" aria-hidden="true"></span><button type="button" data-tmenu tabindex="-1" aria-label="More table options" title="More table options (Shift+F10)" aria-haspopup="menu" aria-expanded="false">${icon('more', 16)}</button></div>
      <div class="wys-tmenu wys-ui" role="menu" aria-label="Table" hidden>${TABLE_MENU.map((group, g) => html`${g ? html`<div class="wys-tmenu-sep" role="separator"></div>` : ''}${group.map(([op, label]) => html`<button type="button" role="${op.startsWith('align') ? 'menuitemradio' : 'menuitem'}" data-top="${op}" tabindex="-1" class="${op.startsWith('del') ? 'danger' : ''}">${label}</button>`)}`)}</div>
    </div>
    <textarea name="${name}" hidden>${value}</textarea>
    <input type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple hidden data-pick />
    <div class="rich-foot"><small class="hint" id="${id}-help">Type <kbd>/</kbd> for headings, lists and more.${noPics ? '' : ' Paste or drop pictures in.'} In a list, <kbd>Tab</kbd> indents; in a table, right-click a cell for rows and columns.</small><small class="rich-count" aria-live="polite"></small></div>
  </div>`;
}

// ----- Making it work -----
// root: where the editor's markup is; images: the task's pictures (kept up to date as they are added).
export function wireRichEditor(root, { images = [] } = {}) {
  const box = root.querySelector('[data-rich]');
  if (!box) return null;
  const area = box.querySelector('.wys-area');
  const ta = box.querySelector('textarea');
  const pick = box.querySelector('[data-pick]');
  const count = box.querySelector('.rich-count');
  const styleSel = box.querySelector('.wys-style');
  const bubble = box.querySelector('.wys-bubble');
  const slash = box.querySelector('.wys-slash');
  const taskId = box.dataset.task || null;
  const tools = [...box.querySelectorAll('.rich-bar .rich-tool')];
  const image = imageUrl(taskId, images);
  tools.find((b) => !b.disabled).tabIndex = 0;

  // -- Content in and out --
  const blank = () => {
    const p = document.createElement('p');
    p.append(document.createElement('br'));
    return p;
  };
  // What renderRich shows, made ready for editing: pictures as blocks you can remove, checklists
  // you can tick, a paragraph to type in after a last code block, table or picture.
  function prepare(el) {
    el.querySelectorAll('input[type=checkbox]').forEach((c) => {
      c.removeAttribute('disabled');
      c.setAttribute('contenteditable', 'false');
      c.tabIndex = -1;
    });
    el.querySelectorAll('figure').forEach((f) => {
      const img = f.querySelector('img');
      const id = img && imageIdOf(img);
      if (!id) return;
      f.className = 'rich-img';
      f.setAttribute('contenteditable', 'false');
      f.dataset.img = id;
      const pic = document.createElement('img');
      pic.src = img.getAttribute('src');
      pic.alt = img.getAttribute('alt') || '';
      pic.dataset.img = id;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'wys-img-del wys-ui';
      del.setAttribute('aria-label', `Remove the picture ${pic.alt}`.trim());
      del.title = 'Remove the picture';
      del.textContent = '×';
      f.replaceChildren(pic, del);
    });
    el.querySelectorAll('a').forEach((a) => {
      a.removeAttribute('target');
      a.removeAttribute('rel');
    });
    el.querySelectorAll('ul.rich-tasks').forEach(ensureChecks);
    // An empty cell holds a line break, so the cursor can go in it.
    el.querySelectorAll('td, th').forEach((c) => {
      if (!c.firstChild) c.append(document.createElement('br'));
    });
    const last = el.lastElementChild;
    if (!last || /^(PRE|TABLE|HR|FIGURE|UL|OL|BLOCKQUOTE)$/.test(last.tagName) || last.classList.contains('rich-table')) el.append(blank());
  }
  function load(md) {
    area.innerHTML = renderRich(md, { image }) || '<p><br></p>';
    prepare(area);
    sync();
  }
  let lastMd = null;
  function sync() {
    const md = modelToMarkdown(readBlocks(area));
    if (md !== lastMd) {
      lastMd = md;
      ta.value = md;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    area.classList.toggle('is-empty', !md && !area.querySelector('img, hr, table, ul, ol, pre, blockquote, h3, h4, h5'));
    const n = md.length;
    count.textContent = n > RICH_MAX ? `Too long: ${n.toLocaleString('en-PH')} of ${RICH_MAX.toLocaleString('en-PH')} characters` : n > RICH_MAX * 0.8 ? `${n.toLocaleString('en-PH')} / ${RICH_MAX.toLocaleString('en-PH')}` : '';
    box.classList.toggle('too-long', n > RICH_MAX);
  }

  // -- Where the cursor is --
  const sel = () => window.getSelection();
  const inArea = (node) => node && (node === area || area.contains(node));
  const range = () => {
    const s = sel();
    return s.rangeCount && inArea(s.getRangeAt(0).commonAncestorContainer) ? s.getRangeAt(0) : null;
  };
  const elOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement);
  const closest = (selector) => {
    const r = range();
    const el = r && elOf(r.startContainer);
    const hit = el?.closest(selector);
    return hit && inArea(hit) && hit !== area ? hit : null;
  };
  const blockAt = () => closest('p, div:not(.wys-area):not(.rich-table), h1, h2, h3, h4, h5, h6, li, pre, blockquote, td, th');
  // The text from the start of the cursor's block to the cursor.
  const textBefore = (block) => {
    const r = range();
    if (!r || !block) return '';
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString();
  };
  let saved = null;
  const keep = () => {
    const r = range();
    if (r) saved = r.cloneRange();
  };
  const restore = () => {
    area.focus({ preventScroll: true });
    if (saved) {
      const s = sel();
      s.removeAllRanges();
      s.addRange(saved);
    }
  };
  const exec = (cmd, value = null) => {
    area.focus({ preventScroll: true });
    document.execCommand(cmd, false, value);
  };
  try {
    document.execCommand('defaultParagraphSeparator', false, 'p');
  } catch {}

  // -- Keeping the content tidy --
  // The browser's own commands can leave a list (or another block) inside a paragraph, or a box
  // outside a checklist: lifted out here after each change, the cursor kept where it was.
  const LIFT = 'ul, ol, pre, blockquote, table, .rich-table, figure, hr, p, h1, h2, h3, h4, h5, h6';
  function tidy() {
    const s = sel();
    const at = s.rangeCount ? { node: s.anchorNode, offset: s.anchorOffset } : null;
    let moved = false;
    for (const holder of [...area.querySelectorAll('p, h1, h2, h3, h4, h5, h6')]) {
      if (!holder.isConnected || !holder.querySelector(`:scope > :is(${LIFT})`)) continue;
      const parent = holder.parentNode;
      let run = null;
      for (const k of [...holder.childNodes]) {
        if (k.nodeType === 1 && k.matches(LIFT)) {
          run = null;
          parent.insertBefore(k, holder);
        } else {
          if (k.nodeType === 3 && !k.nodeValue.trim() && !run) continue;
          if (!run) {
            run = document.createElement(holder.tagName.toLowerCase());
            parent.insertBefore(run, holder);
          }
          run.append(k);
        }
      }
      holder.remove();
      moved = true;
    }
    // A table put back by undo comes back as it was during a row or column change (see tableOp).
    area.querySelectorAll('[contenteditable="false"]:is(.rich-table, table)').forEach((x) => x.removeAttribute('contenteditable'));
    // Boxes left in a paragraph (a checklist item turned back into text).
    area.querySelectorAll('input[type=checkbox]').forEach((c) => {
      if (!c.closest('ul.rich-tasks > li')) {
        c.remove();
        moved = true;
      }
    });
    // A paragraph that only holds a line break next to another: one empty line is enough.
    if (moved && at?.node?.isConnected) {
      try {
        const r = document.createRange();
        r.setStart(at.node, Math.min(at.offset, at.node.nodeType === 3 ? at.node.nodeValue.length : at.node.childNodes.length));
        r.collapse(true);
        s.removeAllRanges();
        s.addRange(r);
      } catch {}
    }
  }
  // Enter on an empty item: a list inside a list moves out a level; otherwise the list ends there
  // and a paragraph takes the item's place (the list is split when the item was in the middle).
  function exitItem(li) {
    const list = li.parentElement;
    if (list.parentElement?.closest('li, ul, ol') && list.parentElement !== area) {
      exec('outdent');
      return;
    }
    const p = blank();
    const after = [...list.children].slice([...list.children].indexOf(li) + 1);
    li.remove();
    if (after.length) {
      const rest = list.cloneNode(false);
      if (list.tagName === 'OL') rest.setAttribute('start', String((Number(list.getAttribute('start')) || 1) + list.children.length));
      rest.append(...after);
      list.after(p, rest);
    } else list.after(p);
    if (!list.children.length) list.remove();
    caretIn(p);
  }

  // -- Blocks --
  function setBlock(tag) {
    const li = closest('li');
    if (li) exec(li.parentElement.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList'); // out of the list first
    const q = closest('blockquote');
    if (q && tag !== 'blockquote') unwrap(q);
    const pre = closest('pre');
    if (pre) return fromPre(pre, tag);
    exec('formatBlock', `<${tag}>`);
  }
  function unwrap(el) {
    const parent = el.parentNode;
    const kids = [...el.childNodes];
    if (!kids.some((k) => isBlock(k))) {
      const p = document.createElement('p');
      p.append(...kids);
      parent.replaceChild(p, el);
      return;
    }
    for (const k of kids) parent.insertBefore(k, el);
    el.remove();
  }
  // A code block back to text: each line its own paragraph (or heading).
  function fromPre(pre, tag = 'p') {
    const lines = preText(pre).split('\n');
    const made = lines.map((l) => {
      const b = document.createElement(tag === 'pre' ? 'p' : tag);
      b.textContent = l;
      if (!l) b.append(document.createElement('br'));
      return b;
    });
    pre.replaceWith(...made);
    caretIn(made[0]);
    changed();
  }
  function toPre() {
    const block = blockAt();
    if (!block) return exec('formatBlock', '<pre>');
    const pre = document.createElement('pre');
    pre.textContent = block.tagName === 'LI' ? block.textContent : block.innerText ?? block.textContent;
    if (!pre.textContent) pre.append(document.createElement('br'));
    if (block.tagName === 'LI') {
      const list = block.parentElement;
      list.after(pre);
      block.remove();
      if (!list.querySelector('li')) list.remove();
    } else block.replaceWith(pre);
    if (!pre.nextElementSibling) pre.after(blank());
    caretIn(pre, true);
    changed();
  }
  const caretIn = (el, end = false) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!end);
    const s = sel();
    s.removeAllRanges();
    s.addRange(r);
  };
  function ensureChecks(ul) {
    for (const li of ul.children) {
      if (li.tagName !== 'LI') continue;
      // One box per item (the browser copies it into a new item on Enter).
      [...li.childNodes].filter((k) => k.nodeType === 1 && k.tagName === 'INPUT').slice(1).forEach((k) => k.remove());
      li.querySelectorAll(':scope > :not(ul):not(ol) input[type=checkbox]').forEach((k) => k.remove());
      const first = [...li.childNodes].find((k) => k.nodeType !== 3 || k.nodeValue.trim());
      if (!(first?.nodeType === 1 && first.tagName === 'INPUT')) {
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.setAttribute('contenteditable', 'false');
        c.tabIndex = -1;
        c.setAttribute('aria-label', 'Done');
        li.prepend(c);
      }
      li.classList.add('rich-task');
      li.classList.toggle('done', li.querySelector(':scope > input')?.checked || false);
    }
  }
  function toggleTask() {
    const list = closest('ul, ol');
    if (list?.classList.contains('rich-tasks')) {
      list.classList.remove('rich-tasks');
      list.querySelectorAll(':scope > li > input[type=checkbox]').forEach((c) => c.remove());
      list.querySelectorAll(':scope > li').forEach((li) => li.classList.remove('rich-task', 'done'));
    } else if (!list) {
      // Lines of text become a checklist of their own (not merged into a bulleted list next to them).
      const r = range();
      const top = (n) => {
        while (n && n.parentNode !== area) n = n.parentNode;
        return n;
      };
      const first = top(r?.startContainer);
      const last = top(r?.endContainer) || first;
      if (!first || first === area) return;
      const blocks = [];
      for (let n = first; n; n = n.nextSibling) {
        if (n.nodeType === 1 && /^(P|DIV|H[1-6])$/.test(n.tagName)) blocks.push(n);
        if (n === last) break;
      }
      if (!blocks.length) return;
      const ul = document.createElement('ul');
      ul.className = 'rich-tasks';
      blocks[0].before(ul);
      for (const b of blocks) {
        const li = document.createElement('li');
        li.append(...b.childNodes);
        if (!li.childNodes.length) li.append(document.createElement('br'));
        ul.append(li);
        b.remove();
      }
      const prev = ul.previousElementSibling;
      const host = prev?.matches('ul.rich-tasks') ? prev : ul;
      if (host !== ul) {
        host.append(...ul.children);
        ul.remove();
      }
      ensureChecks(host);
      caretIn(host.lastElementChild, true);
    } else {
      if (list.tagName === 'OL') exec('insertUnorderedList');
      tidy();
      const ul = closest('ul');
      if (ul) {
        ul.classList.add('rich-tasks');
        ensureChecks(ul);
      }
    }
    changed();
  }
  function toggleList(kind) {
    const list = closest('ul, ol');
    if (list?.classList.contains('rich-tasks') && kind === 'bullet') return toggleTask();
    if (list?.classList.contains('rich-tasks')) toggleTask();
    exec(kind === 'number' ? 'insertOrderedList' : 'insertUnorderedList');
    tidy();
    changed();
  }
  function toggleQuote() {
    const q = closest('blockquote');
    if (q) {
      unwrap(q);
      changed();
    } else exec('formatBlock', '<blockquote>');
  }
  function insertBlockHtml(markup) {
    exec('insertHTML', markup);
    prepare(area);
    changed();
  }
  const TABLE = '<div class="rich-table"><table><thead><tr><th>Column</th><th>Column</th></tr></thead><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table></div><p><br></p>';

  // -- Table rows and columns --
  // The table at the cursor: its cell, row and column (row 0 is the header).
  function tableAt() {
    const cell = closest('td, th');
    const table = cell?.closest('table');
    if (!table || !inArea(table)) return null;
    const rows = [...table.querySelectorAll('tr')];
    const tr = cell.closest('tr');
    const cells = [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    return { cell, table, wrap: table.closest('.rich-table') || table, r: rows.indexOf(tr), c: cells.indexOf(cell), rows: rows.length, cols: Math.max(1, ...rows.map((x) => x.children.length)) };
  }
  // A change to the table is made on its model and written back as one edit, so undo takes it back.
  function tableOp(op) {
    const at = tableAt();
    if (!at) return;
    const [b] = readTable(at.table);
    if (!b) return;
    const width = Math.max(1, b.head.length, ...b.rows.map((x) => x.length));
    let grid = [b.head, ...b.rows].map((row) => Array.from({ length: width }, (_, k) => row[k] || []));
    const align = Array.from({ length: width }, (_, k) => b.align?.[k] || null);
    let { r, c } = at;
    const swap = (list, i, j) => ([list[i], list[j]] = [list[j], list[i]]);
    const emptyRow = () => Array.from({ length: width }, () => []);
    switch (op) {
      case 'rowAbove': grid.splice(r, 0, emptyRow()); break;
      case 'rowBelow': grid.splice(++r, 0, emptyRow()); break;
      case 'colLeft': grid.forEach((row) => row.splice(c, 0, [])); align.splice(c, 0, null); break;
      case 'colRight': c += 1; grid.forEach((row) => row.splice(c, 0, [])); align.splice(c, 0, null); break;
      case 'rowUp': if (r > 0) swap(grid, r, --r); break;
      case 'rowDown': if (r < grid.length - 1) swap(grid, r, ++r); break;
      case 'colBack': if (c > 0) { grid.forEach((row) => swap(row, c, c - 1)); swap(align, c, --c); } break;
      case 'colFwd': if (c < width - 1) { grid.forEach((row) => swap(row, c, c + 1)); swap(align, c, ++c); } break;
      case 'alignLeft': align[c] = null; break;
      case 'alignCenter': align[c] = 'center'; break;
      case 'alignRight': align[c] = 'right'; break;
      case 'delRow': grid.splice(r, 1); r = Math.min(r, grid.length - 1); break;
      case 'delCol': grid.forEach((row) => row.splice(c, 1)); align.splice(c, 1); c = Math.min(c, width - 2); break;
      case 'delTable': grid = []; break;
      default: return;
    }
    const tables = [...area.querySelectorAll('table')];
    const index = tables.indexOf(at.table);
    const place = [...area.children].indexOf(at.wrap);
    const gone = !grid.length || !grid[0].length;
    const markup = gone ? '<p><br></p>' : renderRich(modelToMarkdown([{ t: 'table', head: grid[0], rows: grid.slice(1), align }]), { image });
    const before = area.innerHTML;
    // Swapped as one edit: the browser replaces the table whole only while it is not editable
    // inside (otherwise it puts the new table in the old one). Undo brings it back as it was.
    at.wrap.contentEditable = 'false';
    const whole = document.createRange();
    whole.selectNode(at.wrap);
    sel().removeAllRanges();
    sel().addRange(whole);
    exec('insertHTML', markup);
    if (at.wrap.isConnected || area.querySelectorAll('table').length !== tables.length - (gone ? 1 : 0)) {
      // A browser that does it another way: swapped directly (undo then skips it).
      area.innerHTML = before;
      const old = area.querySelectorAll('table')[index];
      const t = document.createElement('template');
      t.innerHTML = markup;
      (old.closest('.rich-table') || old).replaceWith(t.content);
      if (gone) caretIn(area.children[Math.max(0, Math.min(place, area.children.length - 1))] || area);
    }
    prepare(area);
    closeTableMenu(false);
    if (gone) {
      // The cursor goes to the line where the table was.
      const p = area.children[Math.max(0, Math.min(place, area.children.length - 1))];
      if (!range() && p) caretIn(p);
    } else {
      const table = area.querySelectorAll('table')[index];
      const row = table && [...table.querySelectorAll('tr')][Math.max(0, r)];
      const cell = row && [...row.children][Math.max(0, c)];
      if (cell) caretIn(cell, true);
    }
    changed();
  }

  // -- Inline --
  function toggleCode() {
    const c = closest('code');
    if (c && !c.closest('pre')) {
      const r = document.createRange();
      r.selectNode(c);
      const s = sel();
      s.removeAllRanges();
      s.addRange(r);
      exec('insertText', c.textContent);
    } else {
      const r = range();
      const text = r ? r.toString() : '';
      exec('insertHTML', `<code>${esc(text || 'code')}</code>​`);
    }
    changed();
  }
  function editLink() {
    keep();
    const a = closest('a');
    const text = a ? a.textContent : saved ? saved.toString() : '';
    const { form, close } = modal({
      title: a ? 'Edit link' : 'Add a link', submitLabel: a ? 'Save link' : 'Add link',
      body: html`<label class="field"><span>Web address<em>*</em></span><input name="url" type="url" required inputmode="url" placeholder="https://" value="${a?.getAttribute('href') || ''}" data-msg="Enter the web address." /><small class="hint">Starts with https:// or http://, or mailto: for an email address.</small></label>
        <label class="field"><span>Text to show</span><input name="label" value="${text}" placeholder="The address itself" /></label>
        ${a ? html`<p><button type="button" class="btn ghost danger" data-unlink>Remove link</button></p>` : ''}`,
      onSubmit: async (f) => {
        const url = safeUrl(f.url.value);
        if (!url) throw new Error('Enter a web address that starts with https:// or http://, or a mailto: address.');
        const label = f.label.value.trim() || url;
        setTimeout(() => {
          restore();
          if (a) {
            const r = document.createRange();
            r.selectNode(a);
            sel().removeAllRanges();
            sel().addRange(r);
          }
          exec('insertHTML', `<a href="${esc(url)}">${esc(label)}</a>​`);
          changed();
        });
      },
    });
    form.querySelector('[data-unlink]')?.addEventListener('click', () => {
      close();
      setTimeout(() => {
        restore();
        const r = document.createRange();
        r.selectNodeContents(a);
        sel().removeAllRanges();
        sel().addRange(r);
        exec('unlink');
        changed();
      });
    });
  }

  // -- The commands, from the toolbar, the bubble, the "/" menu and the keyboard --
  const ACTIONS = {
    p: () => setBlock('p'), h3: () => setBlock('h3'), h4: () => setBlock('h4'), h5: () => setBlock('h5'),
    bold: () => exec('bold'), italic: () => exec('italic'), strike: () => exec('strikeThrough'),
    code: toggleCode, link: editLink,
    bullet: () => toggleList('bullet'), number: () => toggleList('number'), task: toggleTask,
    quote: toggleQuote, codeblock: () => (closest('pre') ? fromPre(closest('pre')) : toPre()),
    divider: () => insertBlockHtml('<hr><p><br></p>'), table: () => insertBlockHtml(TABLE),
    image: () => pick.click(), undo: () => exec('undo'), redo: () => exec('redo'),
  };
  const run = (name) => {
    if (!ACTIONS[name]) return;
    ACTIONS[name]();
    changed();
  };
  tools.forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault())); // the selection stays
  tools.forEach((b) => b.addEventListener('click', () => run(b.dataset.tool)));
  styleSel.addEventListener('change', () => {
    // The text where the cursor is now (the selection stays in the editor while the list is open).
    if (range()) area.focus({ preventScroll: true });
    else restore();
    run(styleSel.value);
  });
  styleSel.addEventListener('mousedown', keep);
  styleSel.addEventListener('focus', keep);
  bubble.querySelectorAll('button').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => run(b.dataset.tool));
  });
  // The table's bar and menu.
  const tbar = box.querySelector('.wys-tbar');
  const tmenu = box.querySelector('.wys-tmenu');
  const tmenuBtn = tbar.querySelector('[data-tmenu]');
  let menuAt = 0;
  const menuItems = () => [...tmenu.querySelectorAll('button')].filter((b) => !b.disabled);
  tbar.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  tbar.querySelectorAll('[data-top]').forEach((b) => b.addEventListener('click', () => tableOp(b.dataset.top)));
  tmenuBtn.addEventListener('click', () => (tmenu.hidden ? openTableMenu({ from: tmenuBtn, focus: true }) : closeTableMenu()));
  // Where the menu is open from: a cell (the cursor is kept and put back before the command runs).
  function openTableMenu({ x = null, y = null, from = null, focus = false } = {}) {
    const at = tableAt();
    if (!at) return;
    keep();
    const { r, c, rows, cols } = at;
    const [b] = readTable(at.table);
    const now = b?.align?.[c] || 'left';
    const off = { rowUp: r === 0, rowDown: r === rows - 1, colBack: c === 0, colFwd: c === cols - 1 };
    tmenu.querySelectorAll('[data-top]').forEach((m) => {
      m.disabled = Boolean(off[m.dataset.top]);
      if (m.getAttribute('role') === 'menuitemradio') m.setAttribute('aria-checked', String(m.dataset.top === `align${now[0].toUpperCase()}${now.slice(1)}`));
    });
    tmenu.hidden = false;
    menuAt = performance.now();
    tmenuBtn.setAttribute('aria-expanded', 'true');
    // Under the pointer (or the button, or the cell); above it when it fits there and not under;
    // otherwise moved up as far as it takes to fit on screen.
    const rect = x != null ? { left: x, top: y, bottom: y } : (from || at.cell).getBoundingClientRect();
    const w = tmenu.offsetWidth;
    const h = tmenu.offsetHeight;
    const room = window.innerHeight - 8;
    const vy = rect.bottom + 4 + h <= room ? rect.bottom + 4 : rect.top - 4 - h >= 8 ? rect.top - 4 - h : Math.max(8, room - h);
    // On the screen itself (fixed), so a dialog's edge does not cut it off.
    tmenu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, rect.left))}px`;
    tmenu.style.top = `${vy}px`;
    if (focus) menuItems()[0]?.focus({ preventScroll: true });
  }
  function closeTableMenu(back = true) {
    if (tmenu.hidden) return;
    const had = tmenu.contains(document.activeElement);
    tmenu.hidden = true;
    tmenuBtn.setAttribute('aria-expanded', 'false');
    if (back && had) restore();
  }
  tmenu.addEventListener('mousedown', (e) => e.preventDefault());
  tmenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-top]');
    if (!b || b.disabled) return;
    if (!range()) restore();
    tableOp(b.dataset.top);
  });
  tmenu.addEventListener('keydown', (e) => {
    const items = menuItems();
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      closeTableMenu();
    }
  });
  area.addEventListener('contextmenu', (e) => {
    if (!e.target.closest?.('td, th')) return;
    // Right-click puts the cursor in the cell first (the browser's own menu is still there with Shift).
    if (e.shiftKey) return;
    e.preventDefault();
    if (!closest('td, th') || closest('td, th') !== e.target.closest('td, th')) caretIn(e.target.closest('td, th'), true);
    openTableMenu({ x: e.clientX, y: e.clientY, focus: true });
  });
  document.addEventListener('mousedown', function outside(e) {
    if (!box.isConnected) return document.removeEventListener('mousedown', outside, true);
    if (!tmenu.hidden && !tmenu.contains(e.target) && e.target !== tmenuBtn && !tmenuBtn.contains(e.target)) closeTableMenu(false);
  }, true);
  // Anything scrolling (the text, a dialog, the page) moves the table away from the menu: it closes.
  window.addEventListener('scroll', function moved(e) {
    if (!box.isConnected) return window.removeEventListener('scroll', moved, true);
    // (Not the scroll a phone makes as it puts its keyboard away when the menu opens.)
    if (tmenu.contains(e.target) || performance.now() - menuAt < 400) return;
    closeTableMenu(false);
    if (e.target === area) refresh();
  }, { capture: true, passive: true });

  // The toolbar is one Tab stop; arrow keys move between its buttons.
  box.querySelector('.rich-bar').addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key) || e.target === styleSel) return;
    const on = tools.filter((x) => !x.disabled);
    const i = on.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? on.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + on.length) % on.length;
    e.preventDefault();
    on.forEach((x, k) => (x.tabIndex = k === next ? 0 : -1));
    on[next].focus();
  });

  // -- What is on at the cursor: the toolbar and the bubble show it --
  function refresh() {
    const r = range();
    if (!r) {
      bubble.hidden = true;
      return;
    }
    const q = (c) => {
      try {
        return document.queryCommandState(c);
      } catch {
        return false;
      }
    };
    const list = closest('ul, ol');
    const state = {
      bold: q('bold'), italic: q('italic'), strike: q('strikeThrough'),
      code: Boolean(closest('code') && !closest('pre')), link: Boolean(closest('a')),
      bullet: list?.tagName === 'UL' && !list.classList.contains('rich-tasks'), number: list?.tagName === 'OL',
      task: Boolean(list?.classList.contains('rich-tasks')), quote: Boolean(closest('blockquote')), codeblock: Boolean(closest('pre')),
    };
    box.querySelectorAll('[data-tool][aria-pressed]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Boolean(state[b.dataset.tool])));
      b.classList.toggle('on', Boolean(state[b.dataset.tool]));
    });
    const h = closest('h1, h2, h3, h4, h5, h6');
    styleSel.value = !h ? 'p' : h.tagName <= 'H3' ? 'h3' : h.tagName === 'H4' ? 'h4' : 'h5';
    styleSel.disabled = Boolean(closest('pre'));
    // The bubble over a selection (on a touch screen the phone's own menu is used instead).
    if (!r.collapsed && r.toString().trim() && !matchMedia('(pointer: coarse)').matches && !closest('pre')) {
      const rect = r.getBoundingClientRect();
      const host = box.querySelector('.wys-box').getBoundingClientRect();
      bubble.hidden = false;
      const w = bubble.offsetWidth;
      bubble.style.left = `${Math.max(4, Math.min(host.width - w - 4, rect.left - host.left + rect.width / 2 - w / 2))}px`;
      bubble.style.top = `${Math.max(4, rect.top - host.top - bubble.offsetHeight - 8)}px`;
    } else bubble.hidden = true;
    placeTableBar();
  }
  // The table's bar sits over the table where the cursor is (under it when there is no room above).
  function placeTableBar() {
    const at = range() && tableAt();
    if (!at || !bubble.hidden) {
      if (!tmenu.contains(document.activeElement)) tbar.hidden = true;
      return;
    }
    const host = box.querySelector('.wys-box').getBoundingClientRect();
    const view = area.getBoundingClientRect();
    const t = at.wrap.getBoundingClientRect();
    if (t.bottom < view.top || t.top > view.bottom) {
      tbar.hidden = true;
      return;
    }
    tbar.hidden = false;
    const h = tbar.offsetHeight;
    const w = tbar.offsetWidth;
    let top = t.top - h - 6;
    if (top < view.top) top = t.bottom + 6 + h <= view.bottom ? t.bottom + 6 : view.top + 4;
    tbar.style.top = `${top - host.top}px`;
    tbar.style.left = `${Math.max(4, Math.min(host.width - w - 4, t.left - host.left))}px`;
  }
  const onSel = () => {
    if (!box.isConnected) return document.removeEventListener('selectionchange', onSel);
    refresh();
  };
  document.addEventListener('selectionchange', onSel);
  area.addEventListener('blur', () => setTimeout(() => {
    if (!box.contains(document.activeElement)) {
      bubble.hidden = true;
      tbar.hidden = true;
      closeTableMenu(false);
    }
  }, 100));

  // -- Typing: Markdown shortcuts at the start of a line, and around words --
  const BLOCK_RULES = [
    [/^#$/, 'h3'], [/^##$/, 'h4'], [/^###$/, 'h5'], [/^[-*+]$/, 'bullet'], [/^1[.)]$/, 'number'],
    [/^\[ ?\]$/, 'task'], [/^-\s?\[ ?\]$/, 'task'], [/^>$/, 'quote'],
  ];
  function blockRule() {
    const block = blockAt();
    if (!block || !/^(P|DIV|LI)$/.test(block.tagName)) return false;
    const before = textBefore(block);
    const rule = BLOCK_RULES.find(([re, name]) => re.test(before) && (block.tagName !== 'LI' || name === 'task'));
    if (!rule) return false;
    const r = range();
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(r.startContainer, r.startOffset);
    sel().removeAllRanges();
    sel().addRange(pre);
    exec('delete');
    if (!block.textContent && !block.querySelector('br')) block.append(document.createElement('br'));
    run(rule[1]);
    return true;
  }
  const INLINE_RULES = [
    [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, 'strong'],
    [/(?:^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, 'em'],
    [/(?:^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, 'em'],
    [/~~([^~\s](?:[^~]*[^~\s])?)~~$/, 's'],
    [/`([^`]+)`$/, 'code'],
  ];
  function inlineRule() {
    const r = range();
    if (!r || !r.collapsed || r.startContainer.nodeType !== 3 || closest('pre, code')) return;
    const node = r.startContainer;
    const text = node.nodeValue.slice(0, r.startOffset);
    for (const [re, tag] of INLINE_RULES) {
      const m = text.match(re);
      if (!m) continue;
      const whole = m[0].startsWith('*') || m[0].startsWith('_') || m[0].startsWith('~') || m[0].startsWith('`') ? m[0] : m[0].slice(1);
      const from = r.startOffset - whole.length;
      const span = document.createRange();
      span.setStart(node, from);
      span.setEnd(node, r.startOffset);
      sel().removeAllRanges();
      sel().addRange(span);
      exec('insertHTML', `<${tag}>${esc(m[1])}</${tag}>​`);
      return;
    }
  }

  // -- Pictures --
  let up = 0;
  async function addPictures(list) {
    const pics = [...list].filter((f) => f.type.startsWith('image/'));
    if (!taskId || !pics.length) return;
    for (const f of pics) {
      const label = f.name.replace(/\.[^.]+$/, '').replace(/[[\]\n]/g, ' ').trim().slice(0, 80) || 'Picture';
      const key = `up${++up}`;
      area.focus({ preventScroll: true });
      exec('insertHTML', `<figure class="rich-img uploading" contenteditable="false" data-up="${key}"><span class="wys-uploading"><span class="spin" aria-hidden="true"></span>Uploading ${esc(label)}…</span></figure><p><br></p>`);
      try {
        const file = await prepareUpload(f);
        const x = await api.post(`/api/pm/tasks/${taskId}/images`, { file });
        images.push(x);
        const holder = area.querySelector(`[data-up="${key}"]`);
        if (holder) {
          const tmp = document.createElement('div');
          tmp.innerHTML = renderRich(`![${label}](img:${x.id})`, { image });
          prepare(tmp);
          holder.replaceWith(...[...tmp.childNodes].filter((n) => n.tagName === 'FIGURE'));
        }
      } catch (err) {
        area.querySelector(`[data-up="${key}"]`)?.remove();
        toast(err.message || 'The picture could not be added.', 'error');
      }
      changed();
    }
  }
  pick.addEventListener('change', () => {
    addPictures(pick.files);
    pick.value = '';
  });
  // A tick box keeps the cursor in the text: it is ticked by the click, not focused.
  area.addEventListener('mousedown', (e) => {
    if (e.target.matches?.('input[type=checkbox], .wys-img-del')) {
      keep();
      e.preventDefault();
    }
  });
  area.addEventListener('click', (e) => {
    const del = e.target.closest('.wys-img-del');
    if (del) {
      e.preventDefault();
      del.closest('figure')?.remove();
      changed();
      return;
    }
    const box2 = e.target.closest('input[type=checkbox]');
    if (box2) {
      const li = box2.closest('li');
      li?.classList.toggle('done', box2.checked);
      if (box2.checked) box2.setAttribute('checked', '');
      else box2.removeAttribute('checked');
      // Writing goes on where it was, not in the box (a space would tick it again).
      if (saved && inArea(saved.startContainer)) restore();
      else if (li) caretIn(li, true);
      changed();
      return;
    }
    // A link in the editor is edited, not followed (Ctrl/⌘ + click opens it).
    const a = e.target.closest('a');
    if (a && !(e.ctrlKey || e.metaKey)) e.preventDefault();
    else if (a) window.open(safeUrl(a.getAttribute('href')) || 'about:blank', '_blank', 'noopener');
  });

  // -- Paste and drop: pictures upload; anything else becomes CORE's own formatting --
  area.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      if (taskId) addPictures(files);
      else toast('Pictures can be added once the task is saved.', 'error');
      return;
    }
    const htmlText = e.clipboardData?.getData('text/html');
    if (htmlText && !closest('pre')) {
      e.preventDefault();
      const md = htmlToMarkdown(htmlText);
      if (!md) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = renderRich(md, { image });
      prepare(tmp);
      if (tmp.lastElementChild?.tagName === 'P' && tmp.lastElementChild.textContent === '' && tmp.children.length > 1) tmp.lastElementChild.remove();
      // One paragraph pasted inside a line: just its text and marks, not a new block.
      const only = tmp.children.length === 1 && tmp.firstElementChild.tagName === 'P' ? tmp.firstElementChild.innerHTML : tmp.innerHTML;
      exec('insertHTML', only);
      prepare(area);
      changed();
      return;
    }
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      e.preventDefault();
      exec('insertText', text);
    }
  });
  area.addEventListener('dragover', (e) => {
    if (taskId && [...(e.dataTransfer?.types || [])].includes('Files')) {
      e.preventDefault();
      box.classList.add('drop');
    }
  });
  area.addEventListener('dragleave', () => box.classList.remove('drop'));
  area.addEventListener('drop', (e) => {
    box.classList.remove('drop');
    const list = [...(e.dataTransfer?.files || [])];
    if (!list.some((f) => f.type.startsWith('image/'))) {
      // Dropped text or HTML: the browser places it, then it is tidied like a paste.
      setTimeout(() => {
        prepare(area);
        changed();
      });
      return;
    }
    e.preventDefault();
    if (!taskId) return toast('Pictures can be added once the task is saved.', 'error');
    const caret = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (caret) {
      sel().removeAllRanges();
      sel().addRange(caret);
    }
    addPictures(list);
  });

  // -- The "/" menu --
  let slashItems = [];
  let slashAt = 0;
  const slashOpen = () => !slash.hidden;
  function closeSlash() {
    slash.hidden = true;
    area.removeAttribute('aria-activedescendant');
    area.setAttribute('aria-expanded', 'false');
  }
  function drawSlash() {
    slash.innerHTML = '';
    slashItems.forEach(([cmd, name, desc], k) => {
      const b = document.createElement('div');
      b.className = `wys-slash-item${k === slashAt ? ' on' : ''}`;
      b.id = `${slash.id}-${k}`;
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(k === slashAt));
      b.dataset.cmd = cmd;
      const strong = document.createElement('strong');
      strong.textContent = name;
      const small = document.createElement('small');
      small.textContent = desc;
      b.append(strong, small);
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        slashAt = k;
        pickSlash();
      });
      slash.append(b);
    });
    area.setAttribute('aria-activedescendant', `${slash.id}-${slashAt}`);
  }
  function checkSlash() {
    const block = blockAt();
    const r = range();
    if (!block || !r?.collapsed || !/^(P|DIV)$/.test(block.tagName)) return closeSlash();
    const m = textBefore(block).match(/^\/([a-z ]{0,20})$/i);
    if (!m || block.textContent.trim().length !== textBefore(block).trim().length) return closeSlash();
    const q = m[1].trim().toLowerCase();
    slashItems = SLASH.filter(([cmd, name, , words]) => (cmd !== 'image' || taskId) && (!q || name.toLowerCase().includes(q) || words.includes(q)));
    if (!slashItems.length) return closeSlash();
    slashAt = Math.min(slashAt, slashItems.length - 1);
    drawSlash();
    const rect = r.getBoundingClientRect();
    const host = box.querySelector('.wys-box').getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();
    slash.hidden = false;
    area.setAttribute('aria-expanded', 'true');
    slash.style.left = `${Math.max(4, Math.min(host.width - slash.offsetWidth - 4, (rect.left || blockRect.left) - host.left))}px`;
    slash.style.top = `${(rect.bottom || blockRect.bottom) - host.top + 6}px`;
  }
  function pickSlash() {
    const item = slashItems[slashAt];
    closeSlash();
    const block = blockAt();
    if (block) {
      const r = document.createRange();
      r.selectNodeContents(block);
      sel().removeAllRanges();
      sel().addRange(r);
      exec('delete');
    }
    if (item) run(item[0]);
  }

  // -- Keys --
  area.addEventListener('keydown', (e) => {
    const mod = MAC ? e.metaKey : e.ctrlKey;
    if (slashOpen()) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        slashAt = (slashAt + (e.key === 'ArrowDown' ? 1 : -1) + slashItems.length) % slashItems.length;
        drawSlash();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickSlash();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeSlash();
        return;
      }
    }
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      const map = e.shiftKey ? { x: 'strike', 8: 'bullet', '*': 'bullet', 7: 'number', '&': 'number', 9: 'task', '(': 'task' } : { b: 'bold', i: 'italic', k: 'link', e: 'code' };
      if (map[k]) {
        e.preventDefault();
        return run(map[k]);
      }
    }
    if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && closest('td, th')) {
      e.preventDefault();
      openTableMenu({ focus: true });
      return;
    }
    if (e.key === ' ' && !mod && blockRule()) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.isComposing) {
      const pre = closest('pre');
      if (pre) {
        e.preventDefault();
        // Enter on an empty last line leaves the code block (the empty line goes).
        const r = range();
        const head = document.createRange();
        head.selectNodeContents(pre);
        head.setEnd(r.startContainer, r.startOffset);
        const tail = document.createRange();
        tail.selectNodeContents(pre);
        tail.setStart(r.endContainer, r.endOffset);
        const before = preText(head.cloneContents());
        const atEnd = !preText(tail.cloneContents()).replace(/\n/g, '');
        if (atEnd && (before.endsWith('\n') || !before)) {
          // Line breaks and newlines at the end of the block are its empty last line(s): remove them.
          while (pre.lastChild && (pre.lastChild.nodeName === 'BR' || (pre.lastChild.nodeType === 3 && !pre.lastChild.nodeValue.replace(/\n/g, '')))) pre.lastChild.remove();
          if (pre.lastChild?.nodeType === 3) pre.lastChild.nodeValue = pre.lastChild.nodeValue.replace(/\n+$/, '');
          if (!pre.textContent) pre.replaceWith(blank());
          const next = pre.isConnected ? pre.nextElementSibling : null;
          const p = next && next.tagName === 'P' && !next.textContent ? next : blank();
          if (!p.isConnected) pre.after(p);
          caretIn(p);
          changed();
        } else {
          exec('insertLineBreak');
          changed();
        }
        return;
      }
      const block = blockAt();
      const line = block && /^(P|DIV)$/.test(block.tagName) ? block.textContent.trim() : '';
      if (line === '```') {
        e.preventDefault();
        block.textContent = '';
        caretIn(block);
        toPre();
        return;
      }
      if (line === '---' || line === '***') {
        e.preventDefault();
        block.textContent = '';
        caretIn(block);
        insertBlockHtml('<hr><p><br></p>');
        return;
      }
      // Enter on an empty item: out a level, or the list ends.
      const li = closest('li');
      if (li && !li.textContent.trim() && !li.querySelector('img, ul, ol')) {
        e.preventDefault();
        exitItem(li);
        changed();
      }
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      if (closest('li')) {
        e.preventDefault();
        exec(e.shiftKey ? 'outdent' : 'indent');
        changed();
        return;
      }
      const cell = closest('td, th');
      if (cell) {
        e.preventDefault();
        const cells = [...cell.closest('table').querySelectorAll('th, td')];
        let next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
        if (!next && !e.shiftKey) {
          // Tab in the last cell adds a row.
          const row = cell.closest('tr').cloneNode(true);
          row.querySelectorAll('td, th').forEach((c) => {
            const td = document.createElement('td');
            td.append(document.createElement('br'));
            c.replaceWith(td);
          });
          cell.closest('table').querySelector('tbody').append(row);
          next = row.firstElementChild;
          changed();
        }
        if (next) caretIn(next, true);
      }
    }
    if (e.key === 'Escape' && bubble && !bubble.hidden) bubble.hidden = true;
  });
  area.addEventListener('input', (e) => {
    if (e.inputType === 'insertText' && /[*_~`]/.test(e.data || '')) inlineRule();
    area.querySelectorAll('ul.rich-tasks').forEach(ensureChecks);
    // A list inside a checklist made by Tab is a checklist too.
    area.querySelectorAll('ul.rich-tasks ul:not(.rich-tasks)').forEach((u) => {
      u.classList.add('rich-tasks');
      ensureChecks(u);
    });
    checkSlash();
    changed();
  });
  let queued = false;
  function changed() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!area.isConnected) return;
      tidy();
      area.querySelectorAll('ul.rich-tasks').forEach(ensureChecks);
      sync();
      refresh();
    });
  }

  load(ta.value);
  return {
    textarea: ta, images, area,
    focus(end = true) {
      area.focus();
      if (end) caretIn(area.lastElementChild || area, true);
    },
    value: () => (sync(), ta.value),
  };
}
