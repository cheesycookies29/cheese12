// PDF Studio (0.64): a tool on the CORE home. Drop or choose files (PDFs, pictures, Word, Excel,
// PowerPoint, OpenDocument, text, Markdown, CSV, HTML); each becomes PDF pages on the server
// (server/tools-pdf.js). Arrange the pages of all of them in one grid (drag, or the arrows; turn,
// remove, add blank pages), set the page layout of documents and pictures, then export one PDF —
// or one per file, or one per page, in a ZIP — with page numbers, a header, a footer or a
// watermark. Files stay a few hours, for this person only.
import { api } from '../api.js';
import { ctx } from '../state.js';
import { html, mount, toast, confirmDialog, modal } from '../ui.js';
import { icon } from '../icons.js';
import { PDF_LIMITS, PDF_DIRECT_EXTS, PDF_BROWSER_IMAGES, PDF_ACCEPT, PDF_SIZES, PDF_KIND_TAG } from '/shared/pdf-studio.js';

const MB = 1024 * 1024;
const extOf = (name) => String(name).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
const plural = (n, w, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
const sizeLabel = (n) => (n >= MB ? `${(n / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const option = (v, l, cur) => html`<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`;
// The arrangement is kept for this browser tab (a reload keeps it while the files are there).
const STORE = () => `core.pdf.${ctx.user?.id || ''}`;
const DEFAULT_LAYOUT = { size: 'a4', orientation: 'auto', margin: 15, fontSize: 11, fit: 'fit' };
const DEFAULT_EXPORT = { fileName: '', split: 'none', numbers: false, format: 'of', position: 'bottom-center', start: 1, skipFirst: false, header: '', footer: '', watermark: '', opacity: 0.15, color: 'gray', title: '', author: '' };

function load() {
  try {
    return JSON.parse(sessionStorage.getItem(STORE())) || null;
  } catch {
    return null;
  }
}
function save(state) {
  try {
    sessionStorage.setItem(STORE(), JSON.stringify({ pages: state.pages, layout: state.layout, exp: state.exp }));
  } catch {}
}

// A file as base64. Pictures the server does not read (WebP, GIF, HEIC…) are drawn on a canvas and
// sent as PNG: what the browser can show, it can convert.
const readBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('The file could not be read.'));
  r.readAsDataURL(blob);
});
async function toPng(file) {
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`Your browser cannot open ${file.name}. Save it as JPEG or PNG and try again.`));
    img.src = url;
  });
  const w = img.naturalWidth || 1200;
  const h = img.naturalHeight || 1200;
  if (w * h > 60e6) throw new Error(`${file.name} is too large (more than 60 megapixels).`);
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error(`${file.name} could not be converted.`);
  return { name: file.name.replace(/\.[a-z0-9]+$/i, '.png'), type: 'image/png', blob };
}

export async function pdfStudioView(el) {
  const data = await api.get('/api/tools/pdf');
  const kept = load();
  const state = {
    sources: data.sources,
    pages: [], // { key, source, page, rotate } | { key, blank: true, size, orientation }
    selected: new Set(),
    layout: { ...DEFAULT_LAYOUT, ...(kept?.layout || {}) },
    exp: { ...DEFAULT_EXPORT, ...(kept?.exp || {}) },
    busy: 0,
    queue: [],
  };
  let seq = 0;
  const key = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;
  const byId = (id) => state.sources.find((s) => s.id === id);
  // The kept arrangement, minus pages of files that are gone; files not in it are added at the end.
  if (kept?.pages) state.pages = kept.pages.filter((p) => p.blank || (byId(p.source) && p.page < byId(p.source).pages.length));
  for (const s of state.sources) if (!state.pages.some((p) => p.source === s.id)) s.pages.forEach((x, i) => state.pages.push({ key: key(), source: s.id, page: i, rotate: 0 }));
  for (const p of state.pages) p.key ||= key();

  const changed = () => {
    save(state);
    draw();
  };

  // ----- Drawing -----
  const tag = (s) => {
    const [label, color] = PDF_KIND_TAG[s.kind === 'image' ? 'image' : s.format] || ['FILE', 'gray'];
    return html`<span class="ps-tag ps-${color}">${label}</span>`;
  };
  const totalPages = () => state.pages.length;
  function pageCard(p, i) {
    const sel = state.selected.has(p.key);
    if (p.blank) {
      const [w, h] = p.orientation === 'landscape' ? [297, 210] : [210, 297];
      return html`<li class="ps-page ${sel ? 'sel' : ''}" data-key="${p.key}" draggable="true">
        <div class="ps-paper blank" style="aspect-ratio:${w}/${h}"><span>Blank page</span><small>${PDF_SIZES[p.size] || 'A4'}</small></div>
        ${cardFoot(p, i, 'Blank page', '')}</li>`;
    }
    const s = byId(p.source);
    const info = s.pages[p.page] || {};
    const turn = ((info.rotate || 0) + (p.rotate || 0)) % 360;
    const sideways = turn === 90 || turn === 270;
    // The card has the page's shape as shown (turned or not); the picture inside turns with it.
    const ratio = sideways ? `${info.height}/${info.width}` : `${info.width}/${info.height}`;
    const inner = info.thumb
      ? html`<img class="${s.kind === 'image' ? 'pic' : ''}" src="/api/tools/pdf/sources/${s.id}/pages/${p.page}/thumb" alt="" loading="lazy" style="transform:rotate(${p.rotate || 0}deg)" />`
      : html`<span class="ps-lines" style="transform:rotate(${p.rotate || 0}deg)">${info.caption ? html`<b>${info.caption}</b>` : ''}<i></i><i></i><i></i><i></i><i class="short"></i></span>`;
    return html`<li class="ps-page ${sel ? 'sel' : ''}" data-key="${p.key}" draggable="true">
      <div class="ps-paper" style="aspect-ratio:${ratio}">${inner}${tag(s)}${p.rotate ? html`<span class="ps-turned" title="Turned ${p.rotate}°">${icon('rotateCw', 12)} ${p.rotate}°</span>` : ''}</div>
      ${cardFoot(p, i, s.name, `page ${p.page + 1} of ${s.pages.length}`)}</li>`;
  }
  function cardFoot(p, i, title, sub) {
    const sel = state.selected.has(p.key);
    return html`<div class="ps-foot">
        <label class="ps-check" title="Select"><input type="checkbox" data-sel="${p.key}" ${sel ? 'checked' : ''} aria-label="Select page ${i + 1}" /></label>
        <span class="ps-no">${i + 1}</span>
        <span class="ps-from" title="${title}${sub ? `, ${sub}` : ''}">${title}<small>${sub}</small></span>
      </div>
      <div class="ps-tools" role="group" aria-label="Page ${i + 1}">
        <button type="button" class="icon-btn" data-act="left" aria-label="Move page ${i + 1} earlier" title="Move earlier" ${i === 0 ? 'disabled' : ''}>${icon('chevronLeft', 15)}</button>
        <button type="button" class="icon-btn" data-act="ccw" aria-label="Turn page ${i + 1} left" title="Turn left">${icon('rotateCcw', 15)}</button>
        <button type="button" class="icon-btn" data-act="cw" aria-label="Turn page ${i + 1} right" title="Turn right">${icon('rotateCw', 15)}</button>
        <button type="button" class="icon-btn danger" data-act="del" aria-label="Remove page ${i + 1}" title="Remove from the PDF">${icon('trash', 15)}</button>
        <button type="button" class="icon-btn" data-act="right" aria-label="Move page ${i + 1} later" title="Move later" ${i === totalPages() - 1 ? 'disabled' : ''}>${icon('chevronRight', 15)}</button>
      </div>`;
  }
  function sourceRow(s) {
    const inPdf = state.pages.filter((p) => p.source === s.id).length;
    return html`<li class="ps-src" data-src="${s.id}">
      <span class="ps-src-ic">${tag(s)}</span>
      <span class="ps-src-main"><strong title="${s.name}">${s.name}</strong>
        <small>${s.formatName} · ${sizeLabel(s.size)} · ${plural(s.pages.length, 'page')}${inPdf !== s.pages.length ? html` · <b>${inPdf} in the PDF</b>` : ''}</small>
        ${s.warnings?.length ? html`<small class="ps-warn">${icon('alert', 12)} ${s.warnings.join(' ')}</small>` : ''}</span>
      <span class="ps-src-act">
        ${inPdf !== s.pages.length ? html`<button type="button" class="btn small-btn ghost" data-readd="${s.id}" title="Put all its pages back, at the end">Add all pages</button>` : ''}
        ${s.canLayout ? html`<button type="button" class="icon-btn" data-layout="${s.id}" aria-label="Page setup of ${s.name}" title="Page setup">${icon('settings', 16)}</button>` : ''}
        <button type="button" class="icon-btn danger" data-remove="${s.id}" aria-label="Remove ${s.name}" title="Remove the file and its pages">${icon('x', 16)}</button>
      </span></li>`;
  }
  const e = () => state.exp;
  function exportPanel() {
    const x = e();
    return html`<section class="card ps-export" aria-labelledby="ps-exp-h">
      <h2 id="ps-exp-h">${icon('download')} Export</h2>
      <label class="field"><span>File name</span><input name="fileName" value="${x.fileName}" maxlength="120" placeholder="${defaultName()}" /></label>
      <fieldset class="field"><legend>Save as</legend>
        <div class="ps-radio">
          ${[['none', 'One PDF'], ['documents', 'One PDF per file (ZIP)'], ['pages', 'One PDF per page (ZIP)']].map(([v, l]) => html`<label class="check"><input type="radio" name="split" value="${v}" ${x.split === v ? 'checked' : ''} /><span>${l}</span></label>`)}
        </div></fieldset>
      <details class="ps-more" ${x.numbers || x.header || x.footer ? 'open' : ''}><summary>Page numbers, header and footer</summary>
        <label class="check"><input type="checkbox" name="numbers" ${x.numbers ? 'checked' : ''} /><span>Number the pages</span></label>
        <div class="grid two ps-num" ${x.numbers ? '' : 'hidden'}>
          <label class="field"><span>Style</span><select name="format">${Object.entries(data.numberFormats).map(([k, v]) => option(k, v, x.format))}</select></label>
          <label class="field"><span>Where</span><select name="position">${Object.entries(data.numberPositions).map(([k, v]) => option(k, v, x.position))}</select></label>
          <label class="field"><span>Start at</span><input type="number" name="start" min="0" max="100000" value="${x.start}" inputmode="numeric" /></label>
          <label class="check ps-skip"><input type="checkbox" name="skipFirst" ${x.skipFirst ? 'checked' : ''} /><span>Not on the first page (a cover)</span></label>
        </div>
        <label class="field"><span>Header</span><input name="header" value="${x.header}" maxlength="120" placeholder="e.g. {title}" /></label>
        <label class="field"><span>Footer</span><input name="footer" value="${x.footer}" maxlength="120" placeholder="e.g. Confidential · {date}" /></label>
        <small class="hint">You can use {page}, {pages}, {title}, {date} and {file}.</small>
      </details>
      <details class="ps-more" ${x.watermark ? 'open' : ''}><summary>Watermark</summary>
        <label class="field"><span>Text across each page</span><input name="watermark" value="${x.watermark}" maxlength="60" placeholder="e.g. DRAFT or CONFIDENTIAL" /></label>
        <div class="grid two">
          <label class="field"><span>Strength</span><input type="range" name="opacity" min="0.05" max="0.5" step="0.05" value="${x.opacity}" /></label>
          <label class="field"><span>Colour</span><select name="color">${option('gray', 'Grey', x.color)}${option('red', 'Red', x.color)}${option('blue', 'Blue', x.color)}</select></label>
        </div>
      </details>
      <details class="ps-more"><summary>Document details</summary>
        <label class="field"><span>Title</span><input name="title" value="${x.title}" maxlength="160" /></label>
        <label class="field"><span>Author</span><input name="author" value="${x.author}" maxlength="120" placeholder="${ctx.user?.name || ''}" /></label>
      </details>
      <div class="ps-go">
        <button type="button" class="btn primary" id="ps-export" ${state.pages.length && !state.busy ? '' : 'disabled'}>${icon('download', 16)} ${x.split === 'none' ? 'Download PDF' : 'Download ZIP'}</button>
        <button type="button" class="btn" id="ps-preview" ${state.pages.length && !state.busy && x.split === 'none' ? '' : 'disabled'} title="Open the PDF in a new tab">${icon('eye', 16)} Preview</button>
      </div>
      <p class="muted small" id="ps-summary">${plural(state.pages.length, 'page')} from ${plural(new Set(state.pages.filter((p) => !p.blank).map((p) => p.source)).size, 'file')}.</p>
    </section>`;
  }
  const defaultName = () => {
    const first = state.pages.find((p) => !p.blank);
    const s = first && byId(first.source);
    return s ? (s.title || s.name.replace(/\.[a-z0-9]+$/i, '')) : 'document';
  };

  function draw() {
    const sel = state.selected.size;
    mount(el, html`
      <header class="page-head">
        <div><h1 class="ps-title"><span class="ps-logo">${icon('filePdf', 22)}</span> PDF Studio</h1>
          <p class="muted">Turn documents and pictures into a PDF, put PDFs together, arrange the pages and export. Your files are yours only and are deleted after ${PDF_LIMITS.sourceHours} hours.</p></div>
        <div class="actions">${state.sources.length ? html`<button type="button" class="btn" id="ps-reset">${icon('trash', 16)} Start over</button>` : ''}</div>
      </header>
      <div class="ps-layout">
        <div class="ps-main">
          <section class="card ps-drop" id="ps-drop" tabindex="-1">
            <span class="ps-drop-ic">${icon('upload', 26)}</span>
            <div><strong>Drop files here</strong> or <label class="ps-pick">choose files<input type="file" id="ps-file" multiple accept="${PDF_ACCEPT}" class="sr-only" /></label>
              <small>PDF, Word, Excel, PowerPoint, OpenDocument, text, Markdown, CSV, HTML and pictures (JPEG, PNG, WebP, GIF…), up to ${PDF_LIMITS.maxFileBytes / MB} MB each.</small></div>
            ${state.busy ? html`<p class="ps-busy" role="status">${icon('clock', 14)} Converting ${state.queue[0] || ''}${state.busy > 1 ? ` and ${state.busy - 1} more` : ''}…</p>` : ''}
          </section>
          ${state.pages.length ? html`
          <section class="card ps-pages-card" aria-labelledby="ps-pages-h">
            <div class="card-head"><h2 id="ps-pages-h">${icon('layers')} Pages <span class="muted small">${plural(state.pages.length, 'page')}</span></h2>
              <div class="ps-bar">
                ${sel ? html`<span class="ps-selected">${sel} selected</span>
                  <button type="button" class="btn small-btn" data-bulk="ccw">${icon('rotateCcw', 14)} Turn left</button>
                  <button type="button" class="btn small-btn" data-bulk="cw">${icon('rotateCw', 14)} Turn right</button>
                  <button type="button" class="btn small-btn" data-bulk="first">To the start</button>
                  <button type="button" class="btn small-btn" data-bulk="last">To the end</button>
                  <button type="button" class="btn small-btn danger" data-bulk="del">${icon('trash', 14)} Remove</button>
                  <button type="button" class="btn small-btn ghost" data-bulk="none">Clear</button>`
                : html`<button type="button" class="btn small-btn ghost" data-bulk="all">Select all</button>
                  <button type="button" class="btn small-btn" id="ps-blank">${icon('plus', 14)} Blank page</button>
                  <button type="button" class="btn small-btn" id="ps-reverse" title="Last page first">Reverse</button>`}
              </div></div>
            <ol class="ps-grid" id="ps-grid">${state.pages.map(pageCard)}</ol>
            <p class="muted small ps-tip">Drag pages to put them in order, or use the arrows. Turning a page here turns it in the PDF.</p>
          </section>` : ''}
        </div>
        <aside class="ps-side">
          ${state.sources.length ? html`<section class="card ps-files" aria-labelledby="ps-files-h">
            <div class="card-head"><h2 id="ps-files-h">${icon('file')} Files</h2><button type="button" class="btn small-btn ghost" id="ps-setup">${icon('settings', 14)} Page setup</button></div>
            <ul class="ps-srcs">${state.sources.map(sourceRow)}</ul></section>` : ''}
          ${state.sources.length ? exportPanel() : html`<section class="card ps-how"><h2>${icon('help')} How it works</h2><ol>
            <li><strong>Add files</strong>: PDFs keep their pages; documents, sheets, slides and pictures are laid out on pages (A4 unless you choose another size).</li>
            <li><strong>Arrange</strong> the pages of all the files together: drag them, turn them, remove the ones you do not need, add blank pages.</li>
            <li><strong>Export</strong> one PDF, or one per file or per page in a ZIP, with page numbers, a header, a footer or a watermark if you like.</li></ol></section>`}
        </aside>
      </div>`);
    wire();
  }

  // ----- Uploading -----
  async function add(files) {
    const list = [...files];
    const refused = [];
    const ok = list.filter((f) => {
      const ext = extOf(f.name);
      if (![...PDF_DIRECT_EXTS, ...PDF_BROWSER_IMAGES].includes(ext) && !/^image\//.test(f.type)) return refused.push(`${f.name} (not a kind of file PDF Studio takes)`), false;
      if (f.size > PDF_LIMITS.maxFileBytes) return refused.push(`${f.name} (larger than ${PDF_LIMITS.maxFileBytes / MB} MB)`), false;
      return true;
    });
    if (refused.length) toast(`Not added: ${refused.join('; ')}.`, 'error');
    state.queue.push(...ok.map((f) => f.name));
    state.busy += ok.length;
    draw();
    for (const f of ok) {
      try {
        const ext = extOf(f.name);
        const conv = !PDF_DIRECT_EXTS.includes(ext) ? await toPng(f) : { name: f.name, type: f.type, blob: f };
        const s = await api.post('/api/tools/pdf/sources', { file: { name: conv.name, type: conv.type, data: await readBase64(conv.blob) }, layout: state.layout });
        state.sources.push(s);
        s.pages.forEach((x, i) => state.pages.push({ key: key(), source: s.id, page: i, rotate: 0 }));
        if (s.warnings?.length) toast(`${s.name}: ${s.warnings.join(' ')}`);
      } catch (err) {
        toast(`${f.name}: ${err.message}`, 'error');
      } finally {
        state.busy -= 1;
        state.queue.shift();
        changed();
      }
    }
    if (ok.length) toast(`${plural(ok.length, 'file')} added.`);
  }

  // ----- Arranging -----
  const indexOf = (k) => state.pages.findIndex((p) => p.key === k);
  const turn = (p, by) => {
    p.rotate = (((p.rotate || 0) + by) % 360 + 360) % 360;
  };
  function act(k, what) {
    const i = indexOf(k);
    if (i < 0) return;
    const p = state.pages[i];
    if (what === 'cw') turn(p, 90);
    else if (what === 'ccw') turn(p, -90);
    else if (what === 'del') {
      state.pages.splice(i, 1);
      state.selected.delete(k);
    } else if (what === 'left' && i > 0) state.pages.splice(i - 1, 0, ...state.pages.splice(i, 1));
    else if (what === 'right' && i < state.pages.length - 1) state.pages.splice(i + 1, 0, ...state.pages.splice(i, 1));
    changed();
    // Keyboard users stay on the page they moved.
    const card = el.querySelector(`[data-key="${k}"] [data-act="${what}"]:not([disabled])`) || el.querySelector(`[data-key="${k}"] [data-act]`);
    card?.focus();
  }
  function bulk(what) {
    const keys = state.selected;
    if (what === 'all') state.pages.forEach((p) => keys.add(p.key));
    else if (what === 'none') keys.clear();
    else if (what === 'cw' || what === 'ccw') state.pages.filter((p) => keys.has(p.key)).forEach((p) => turn(p, what === 'cw' ? 90 : -90));
    else if (what === 'del') {
      state.pages = state.pages.filter((p) => !keys.has(p.key));
      keys.clear();
    } else if (what === 'first' || what === 'last') {
      const picked = state.pages.filter((p) => keys.has(p.key));
      const rest = state.pages.filter((p) => !keys.has(p.key));
      state.pages = what === 'first' ? [...picked, ...rest] : [...rest, ...picked];
    }
    changed();
  }

  // ----- Page setup of documents and pictures -----
  function pageSetup(only = null) {
    const targets = state.sources.filter((s) => s.canLayout && (!only || s.id === only));
    const l = only ? { ...state.layout, ...(byId(only).layout || {}) } : state.layout;
    const hasImages = targets.some((s) => s.kind === 'image') || !only;
    const hasDocs = targets.some((s) => s.kind === 'doc') || !only;
    modal({
      title: only ? `Page setup: ${byId(only).name}` : 'Page setup',
      subtitle: only ? 'Lays this file out again on pages of this size.' : 'For documents, sheets, slides and pictures added from now on, and (ticked) for those already here. PDFs keep their own pages.',
      submitLabel: 'Apply',
      body: html`<div class="grid two">
        <label class="field"><span>Page size</span><select name="size">${Object.entries(PDF_SIZES).map(([k, v]) => option(k, v, l.size))}${hasImages ? option('auto', 'Picture size (pictures only)', l.size) : ''}</select></label>
        <label class="field"><span>Orientation</span><select name="orientation">${option('auto', 'As the file suits', l.orientation)}${option('portrait', 'Portrait', l.orientation)}${option('landscape', 'Landscape', l.orientation)}</select></label>
        <label class="field"><span>Margins (mm)</span><input type="number" name="margin" min="0" max="40" value="${l.margin}" inputmode="numeric" /></label>
        ${hasDocs ? html`<label class="field"><span>Text size (documents)</span><select name="fontSize">${[9, 10, 11, 12, 14].map((n) => option(n, `${n} pt${n === 11 ? ' (usual)' : ''}`, l.fontSize))}</select></label>` : ''}
        ${hasImages ? html`<label class="field span-2"><span>Pictures</span><select name="fit">${option('fit', 'Whole picture, within the margins', l.fit)}${option('fill', 'Fill the page (edges may be cut)', l.fit)}${option('actual', 'Its own size (smaller if needed)', l.fit)}</select></label>` : ''}
        ${only ? '' : html`<label class="check span-2"><input type="checkbox" name="apply" ${targets.length ? 'checked' : ''} ${targets.length ? '' : 'disabled'} /><span>Also lay out again the ${plural(targets.length, 'document or picture', 'documents and pictures')} already here</span></label>`}
      </div>`,
      onSubmit: async (f) => {
        const layout = { size: f.size.value, orientation: f.orientation.value, margin: Number(f.margin.value), fontSize: Number(f.fontSize?.value || l.fontSize), fit: f.fit?.value || l.fit };
        if (!only) state.layout = layout;
        const redo = only ? targets : f.apply?.checked ? targets : [];
        for (const s of redo) {
          const next = await api.post(`/api/tools/pdf/sources/${s.id}/layout`, { layout: only || s.kind === 'image' || layout.size !== 'auto' ? layout : { ...layout, size: 'a4' } });
          // Its pages are replaced where the first of them was (turns are kept page by page); a file
          // whose pages were all removed from the PDF stays out of it.
          const at = state.pages.findIndex((p) => p.source === s.id);
          const turns = state.pages.filter((p) => p.source === s.id).map((p) => p.rotate);
          state.pages = state.pages.filter((p) => p.source !== s.id);
          if (at >= 0) state.pages.splice(at, 0, ...next.pages.map((x, i) => ({ key: key(), source: s.id, page: i, rotate: turns[i] || 0 })));
          Object.assign(s, next);
        }
        changed();
        toast(redo.length ? `${plural(redo.length, 'file')} laid out again.` : 'Saved for the next files.');
      },
    });
  }

  // ----- Export -----
  function readExport() {
    const f = el.querySelector('.ps-export');
    if (!f) return;
    const v = (n) => f.querySelector(`[name="${n}"]`);
    Object.assign(state.exp, {
      fileName: v('fileName').value, split: f.querySelector('[name=split]:checked')?.value || 'none', numbers: v('numbers').checked, format: v('format').value, position: v('position').value,
      start: Number(v('start').value) || 0, skipFirst: v('skipFirst').checked, header: v('header').value, footer: v('footer').value, watermark: v('watermark').value,
      opacity: Number(v('opacity').value), color: v('color').value, title: v('title').value, author: v('author').value,
    });
    save(state);
  }
  async function exportPdf(preview = false) {
    readExport();
    const x = state.exp;
    const body = {
      pages: state.pages.map((p) => (p.blank ? { blank: true, size: p.size, orientation: p.orientation } : { source: p.source, page: p.page, rotate: p.rotate || 0 })),
      stamp: {
        ...(x.numbers ? { numbers: { format: x.format, position: x.position, start: x.start, skipFirst: x.skipFirst } } : {}),
        header: x.header, footer: x.footer, ...(x.watermark ? { watermark: { text: x.watermark, opacity: x.opacity, color: x.color } } : {}),
      },
      meta: { title: x.title, author: x.author || ctx.user?.name || '' },
      split: preview ? 'none' : x.split, fileName: x.fileName || defaultName(),
    };
    const btn = el.querySelector(preview ? '#ps-preview' : '#ps-export');
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.textContent = 'Making…';
    try {
      const res = await fetch('/api/tools/pdf/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (${res.status})`);
      const blob = await res.blob();
      const name = decodeURIComponent((res.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || 'document.pdf');
      const url = URL.createObjectURL(blob);
      if (preview) {
        const w = window.open(url, '_blank', 'noopener');
        if (!w) toast('Allow pop-ups for CORE to preview, or download the PDF instead.', 'error');
      } else {
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast(`${name} downloaded (${sizeLabel(blob.size)}).`);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }

  // ----- Events -----
  function wire() {
    el.querySelector('#ps-file')?.addEventListener('change', (ev) => {
      add(ev.target.files);
      ev.target.value = '';
    });
    el.querySelector('#ps-reset')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Remove all your files from PDF Studio and start over? Download what you need first.', { title: 'Start over', confirmLabel: 'Start over' }))) return;
      await api.del('/api/tools/pdf/sources');
      Object.assign(state, { sources: [], pages: [], selected: new Set() });
      changed();
    });
    el.querySelector('#ps-setup')?.addEventListener('click', () => pageSetup());
    el.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => pageSetup(b.dataset.layout)));
    el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      const s = byId(b.dataset.remove);
      try {
        await api.del(`/api/tools/pdf/sources/${s.id}`);
      } catch (err) {
        if (err.status !== 404) return toast(err.message, 'error');
      }
      state.sources = state.sources.filter((x) => x !== s);
      state.pages = state.pages.filter((p) => p.source !== s.id);
      changed();
      toast(`${s.name} removed.`);
    }));
    el.querySelectorAll('[data-readd]').forEach((b) => b.addEventListener('click', () => {
      const s = byId(b.dataset.readd);
      s.pages.forEach((x, i) => state.pages.push({ key: key(), source: s.id, page: i, rotate: 0 }));
      changed();
    }));
    el.querySelector('#ps-blank')?.addEventListener('click', () => {
      state.pages.push({ key: key(), blank: true, size: state.layout.size === 'auto' ? 'a4' : state.layout.size, orientation: state.layout.orientation === 'landscape' ? 'landscape' : 'portrait' });
      changed();
    });
    el.querySelector('#ps-reverse')?.addEventListener('click', () => {
      state.pages.reverse();
      changed();
    });
    el.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => bulk(b.dataset.bulk)));
    const grid = el.querySelector('#ps-grid');
    if (grid) {
      grid.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-act]');
        if (b) act(b.closest('[data-key]').dataset.key, b.dataset.act);
      });
      grid.addEventListener('change', (ev) => {
        const k = ev.target.dataset.sel;
        if (!k) return;
        if (ev.target.checked) state.selected.add(k);
        else state.selected.delete(k);
        draw();
        el.querySelector(`[data-sel="${k}"]`)?.focus();
      });
      // Dragging a page to another place (not files: those go to the drop zone).
      let dragKey = null;
      grid.addEventListener('dragstart', (ev) => {
        const li = ev.target.closest?.('[data-key]');
        if (!li) return;
        dragKey = li.dataset.key;
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', dragKey);
        li.classList.add('dragging');
      });
      grid.addEventListener('dragend', () => {
        dragKey = null;
        grid.querySelectorAll('.drop-before, .drop-after, .dragging').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'dragging'));
      });
      grid.addEventListener('dragover', (ev) => {
        if (!dragKey) return;
        const li = ev.target.closest?.('[data-key]');
        if (!li || li.dataset.key === dragKey) return;
        ev.preventDefault();
        const r = li.getBoundingClientRect();
        const after = ev.clientX > r.left + r.width / 2;
        grid.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
        li.classList.add(after ? 'drop-after' : 'drop-before');
      });
      grid.addEventListener('drop', (ev) => {
        if (!dragKey) return;
        const li = ev.target.closest?.('[data-key]');
        if (!li) return;
        ev.preventDefault();
        const after = li.classList.contains('drop-after');
        const moving = state.selected.has(dragKey) ? state.pages.filter((p) => state.selected.has(p.key)) : [state.pages[indexOf(dragKey)]];
        if (moving.some((p) => p.key === li.dataset.key)) return;
        state.pages = state.pages.filter((p) => !moving.includes(p));
        const at = indexOf(li.dataset.key) + (after ? 1 : 0);
        state.pages.splice(at, 0, ...moving);
        changed();
      });
    }
    const exp = el.querySelector('.ps-export');
    if (exp) {
      exp.addEventListener('change', (ev) => {
        readExport();
        if (['numbers', 'split'].includes(ev.target.name)) draw();
      });
      exp.addEventListener('input', () => readExport());
      el.querySelector('#ps-export').addEventListener('click', () => exportPdf(false));
      el.querySelector('#ps-preview').addEventListener('click', () => exportPdf(true));
    }
  }

  // Files from the computer can be let go anywhere on the page (the drop zone lights up).
  const fromComputer = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
  el.addEventListener('dragover', (ev) => {
    if (!fromComputer(ev)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    el.querySelector('#ps-drop')?.classList.add('over');
  });
  el.addEventListener('dragleave', (ev) => {
    if (!el.contains(ev.relatedTarget)) el.querySelector('#ps-drop')?.classList.remove('over');
  });
  el.addEventListener('drop', (ev) => {
    if (!fromComputer(ev) || !ev.dataTransfer.files?.length) return;
    ev.preventDefault();
    el.querySelector('#ps-drop')?.classList.remove('over');
    add(ev.dataTransfer.files);
  });
  save(state);
  draw();
}
