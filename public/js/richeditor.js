// The editor for formatted text (task descriptions): a toolbar over a plain text box that writes the
// small Markdown of shared/richtext.js, a Preview tab, and pictures inserted from the toolbar, pasted
// from the clipboard or dropped on the box. The text box stays the source, so the form, undo,
// screen readers and phones all work as with any other field.
import { api } from './api.js';
import { html, raw, toast, modal } from './ui.js';
import { icon } from './icons.js';
import { prepareUpload } from './attachments.js';
import { renderRich, toggleWrap, toggleLines, insertBlock, makeLink, continueList, RICH_MAX } from '/shared/richtext.js';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY = MAC ? '⌘' : 'Ctrl+';
const TOOLS = [
  ['heading', 'heading', 'Heading'],
  ['bold', 'bold', 'Bold', 'B'],
  ['italic', 'italic', 'Italic', 'I'],
  ['strike', 'strike', 'Strikethrough'],
  ['code', 'code', 'Code'],
  ['link', 'link', 'Link', 'K'],
  '|',
  ['bullet', 'listBullet', 'Bulleted list'],
  ['number', 'listNumber', 'Numbered list'],
  ['quote', 'quote', 'Quote'],
  ['divider', 'divider', 'Line'],
  '|',
  ['image', 'image', 'Insert a picture'],
];

// The picture's address in CORE, when the task has it.
export const imageUrl = (taskId, images) => (id) => (taskId && images.some((x) => x.id === id) ? `/api/pm/tasks/${encodeURIComponent(taskId)}/images/${encodeURIComponent(id)}` : null);

// A description shown on a page.
export const richView = (text, taskId, images = []) => html`<div class="rich">${raw(renderRich(text, { image: imageUrl(taskId, images) }))}</div>`;

let seq = 0;
// The editor's markup, for a form. taskId: pictures can be added (null for a task not saved yet).
export function richEditor({ name = 'description', value = '', label = 'Description', taskId = null, rows = 10 } = {}) {
  const id = `rich-${++seq}`;
  return html`<div class="field span-2 rich-ed" data-rich data-task="${taskId || ''}">
    <div class="rich-head">
      <label for="${id}">${label}</label>
      <div class="rich-tabs" role="tablist" aria-label="${label}">
        <button type="button" role="tab" aria-selected="true" aria-controls="${id}" data-tab="write">Write</button>
        <button type="button" role="tab" aria-selected="false" aria-controls="${id}-preview" data-tab="preview" tabindex="-1">Preview</button>
      </div>
    </div>
    <div class="rich-bar" role="toolbar" aria-label="Formatting" aria-controls="${id}">
      ${TOOLS.map((t) => (t === '|' ? html`<span class="rich-sep" aria-hidden="true"></span>`
        : html`<button type="button" class="rich-tool" data-tool="${t[0]}" tabindex="-1" aria-label="${t[2]}${t[3] ? ` (${KEY}${t[3]})` : ''}" title="${t[0] === 'image' && !taskId ? 'Pictures can be added once the task is saved' : `${t[2]}${t[3] ? ` (${KEY}${t[3]})` : ''}`}" ${t[0] === 'image' && !taskId ? 'disabled' : ''}>${icon(t[1], 16)}</button>`))}
    </div>
    <textarea id="${id}" name="${name}" rows="${rows}" maxlength="${RICH_MAX}" aria-describedby="${id}-help" spellcheck="true">${value}</textarea>
    <div class="rich rich-preview" id="${id}-preview" role="tabpanel" tabindex="0" hidden></div>
    <input type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple hidden data-pick />
    <div class="rich-foot"><small class="hint" id="${id}-help">${taskId ? 'Paste or drop pictures into the text. ' : ''}**bold**, *italic*, - list, 1. steps, [link](https://…)</small><small class="rich-count" aria-live="polite"></small></div>
  </div>`;
}

// Makes an editor in root work. images: the task's pictures (kept up to date as they are added).
export function wireRichEditor(root, { images = [] } = {}) {
  const box = root.querySelector('[data-rich]');
  if (!box) return null;
  const ta = box.querySelector('textarea');
  const preview = box.querySelector('.rich-preview');
  const pick = box.querySelector('[data-pick]');
  const count = box.querySelector('.rich-count');
  const taskId = box.dataset.task || null;
  const tools = [...box.querySelectorAll('.rich-tool')];
  tools.find((b) => !b.disabled).tabIndex = 0;

  const state = () => ({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd });
  // Applies an edit through the browser's own editing, so Ctrl+Z undoes it.
  const apply = (next) => {
    if (!next) return;
    ta.focus();
    if (next.value.length > RICH_MAX) return toast(`A description can be up to ${RICH_MAX.toLocaleString('en-PH')} characters.`, 'error');
    const cur = ta.value;
    let a = 0;
    while (a < cur.length && a < next.value.length && cur[a] === next.value[a]) a++;
    let b = 0;
    while (b < cur.length - a && b < next.value.length - a && cur[cur.length - 1 - b] === next.value[next.value.length - 1 - b]) b++;
    ta.setSelectionRange(a, cur.length - b);
    const text = next.value.slice(a, next.value.length - b);
    if (!(document.execCommand && document.execCommand('insertText', false, text)) || ta.value !== next.value) ta.value = next.value;
    ta.setSelectionRange(next.start, next.end);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // A link: the address (and the words to show, taken from the selection).
  const askLink = () => {
    const at = state();
    const sel = ta.value.slice(at.start, at.end).trim();
    modal({
      title: 'Add a link', submitLabel: 'Add link',
      body: html`<label class="field"><span>Web address<em>*</em></span><input name="url" type="url" required inputmode="url" placeholder="https://" data-msg="Enter the web address." /><small class="hint">Starts with https:// or http://, or mailto: for an email address.</small></label>
        <label class="field"><span>Text to show</span><input name="label" value="${sel}" placeholder="The address itself" /></label>`,
      onSubmit: async (f) => {
        const label = f.label.value.trim();
        const base = { value: ta.value.slice(0, at.start) + label + ta.value.slice(at.end), start: at.start, end: at.start + label.length };
        const next = makeLink(base, f.url.value);
        if (!next) throw new Error('Enter a web address that starts with https:// or http://, or a mailto: address.');
        setTimeout(() => apply(next));
      },
    });
  };
  const ACTIONS = {
    heading: () => apply(toggleLines(state(), 'heading')),
    bold: () => apply(toggleWrap(state(), '**', 'bold text')),
    italic: () => apply(toggleWrap(state(), '*', 'italic text')),
    strike: () => apply(toggleWrap(state(), '~~', 'struck text')),
    code: () => {
      const s = state();
      if (ta.value.slice(s.start, s.end).includes('\n')) apply(insertBlock(s, `\`\`\`\n${ta.value.slice(s.start, s.end)}\n\`\`\``));
      else apply(toggleWrap(s, '`', 'code'));
    },
    link: askLink,
    bullet: () => apply(toggleLines(state(), 'bullet')),
    number: () => apply(toggleLines(state(), 'number')),
    quote: () => apply(toggleLines(state(), 'quote')),
    divider: () => apply(insertBlock(state(), '---')),
    image: () => pick.click(),
  };
  tools.forEach((b) => b.addEventListener('click', () => ACTIONS[b.dataset.tool]()));
  // The toolbar is one Tab stop; arrow keys move between its buttons.
  box.querySelector('.rich-bar').addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const on = tools.filter((x) => !x.disabled);
    const i = on.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? on.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + on.length) % on.length;
    e.preventDefault();
    on.forEach((x, k) => (x.tabIndex = k === next ? 0 : -1));
    on[next].focus();
  });
  ta.addEventListener('keydown', (e) => {
    const mod = MAC ? e.metaKey : e.ctrlKey;
    if (mod && !e.altKey && !e.shiftKey && ['b', 'i', 'k'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      ({ b: ACTIONS.bold, i: ACTIONS.italic, k: ACTIONS.link })[e.key.toLowerCase()]();
    } else if (e.key === 'Enter' && !e.shiftKey && !mod && !e.isComposing) {
      const next = continueList(state());
      if (next) {
        e.preventDefault();
        apply(next);
      }
    }
  });

  // ----- Pictures -----
  async function addPictures(list) {
    const pics = [...list].filter((f) => f.type.startsWith('image/'));
    if (!taskId || !pics.length) return;
    for (const f of pics) {
      const label = f.name.replace(/\.[^.]+$/, '').replace(/[[\]\n]/g, ' ').trim().slice(0, 80) || 'Picture';
      const holder = `![Uploading ${label}…]()`;
      apply(insertBlock(state(), holder));
      try {
        const file = await prepareUpload(f);
        const x = await api.post(`/api/pm/tasks/${taskId}/images`, { file });
        images.push(x);
        const at = ta.value.indexOf(holder);
        const ref = `![${label}](img:${x.id})`;
        if (at >= 0) {
          const keep = state();
          ta.setSelectionRange(at, at + holder.length);
          apply({ value: ta.value.slice(0, at) + ref + ta.value.slice(at + holder.length), start: keep.start + (keep.start > at ? ref.length - holder.length : 0), end: keep.end + (keep.end > at ? ref.length - holder.length : 0) });
        } else apply(insertBlock(state(), ref));
      } catch (err) {
        const at = ta.value.indexOf(holder);
        if (at >= 0) apply({ value: (ta.value.slice(0, at) + ta.value.slice(at + holder.length)).replace(/\n{3,}/g, '\n\n'), start: at, end: at });
        toast(err.message || 'The picture could not be added.', 'error');
      }
    }
  }
  pick.addEventListener('change', () => {
    addPictures(pick.files);
    pick.value = '';
  });
  ta.addEventListener('paste', (e) => {
    const list = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!list.length || !taskId) return;
    e.preventDefault();
    addPictures(list);
  });
  ta.addEventListener('dragover', (e) => {
    if (!taskId || ![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    box.classList.add('drop');
  });
  ta.addEventListener('dragleave', () => box.classList.remove('drop'));
  ta.addEventListener('drop', (e) => {
    box.classList.remove('drop');
    const list = [...(e.dataTransfer?.files || [])];
    if (!taskId || !list.some((f) => f.type.startsWith('image/'))) return;
    e.preventDefault();
    const at = ta.selectionStart;
    ta.setSelectionRange(at, at);
    addPictures(list);
  });

  // ----- Write / Preview -----
  const tabs = [...box.querySelectorAll('[data-tab]')];
  const show = (which) => {
    const p = which === 'preview';
    tabs.forEach((t) => {
      t.setAttribute('aria-selected', String(t.dataset.tab === which));
      t.tabIndex = t.dataset.tab === which ? 0 : -1;
    });
    if (p) preview.innerHTML = renderRich(ta.value, { image: imageUrl(taskId, images) }) || '<p class="muted">Nothing to preview yet.</p>';
    preview.hidden = !p;
    ta.hidden = p;
    box.querySelector('.rich-bar').classList.toggle('off', p);
    tools.forEach((b) => (b.disabled = p || (b.dataset.tool === 'image' && !taskId)));
  };
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
  box.querySelector('.rich-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs.find((t) => t.getAttribute('aria-selected') !== 'true');
    show(next.dataset.tab);
    next.focus();
  });
  const counter = () => {
    const n = ta.value.length;
    count.textContent = n > RICH_MAX * 0.8 ? `${n.toLocaleString('en-PH')} / ${RICH_MAX.toLocaleString('en-PH')}` : '';
  };
  ta.addEventListener('input', counter);
  counter();
  return { textarea: ta, images };
}
