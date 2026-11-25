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
import { openPageEditor } from './pdf-editor.js';
import { PDF_LIMITS, PDF_DIRECT_EXTS, PDF_BROWSER_IMAGES, PDF_ACCEPT, PDF_SIZES, PDF_KIND_TAG, PDF_EXPORT_FORMATS, PDF_PICTURE_DPI } from '/shared/pdf-studio.js';
import { zipStore } from '../zip-store.js';

const MB = 1024 * 1024;
const extOf = (name) => String(name).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';
const plural = (n, w, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
const sizeLabel = (n) => (n >= MB ? `${(n / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const option = (v, l, cur) => html`<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`;
// What the export makes (0.68): PDF, a document to edit, a spreadsheet, or pictures of the pages.
const FORMAT = (as) => PDF_EXPORT_FORMATS[as] || PDF_EXPORT_FORMATS.pdf;
const isPictures = (as) => FORMAT(as).group === 'Pictures of the pages';
const stamps = (as) => as === 'pdf' || isPictures(as); // page numbers, header, footer, watermark
const formatOptions = (cur) => {
  const groups = [...new Set(Object.values(PDF_EXPORT_FORMATS).map((f) => f.group))];
  return groups.map((g) => html`<optgroup label="${g}">${Object.entries(PDF_EXPORT_FORMATS).filter(([, f]) => f.group === g).map(([k, f]) => option(k, `${f.label} (.${f.ext})`, cur))}</optgroup>`);
};
// The download button's words.
const downloadLabel = (x) => (isPictures(x.as) ? 'Download pictures' : x.split === 'none' ? `Download ${FORMAT(x.as).label}` : 'Download ZIP');
// The arrangement is kept for this browser tab (a reload keeps it while the files are there).
const STORE = () => `core.pdf.${ctx.user?.id || ''}`;
const DEFAULT_LAYOUT = { size: 'a4', orientation: 'auto', margin: 15, fontSize: 11, fit: 'fit' };
const DEFAULT_EXPORT = { as: 'pdf', dpi: 150, fileName: '', split: 'none', numbers: false, format: 'of', position: 'bottom-center', start: 1, skipFirst: false, header: '', footer: '', watermark: '', opacity: 0.15, color: 'gray', title: '', author: '' };

function load() {
  try {
    return JSON.parse(sessionStorage.getItem(STORE())) || null;
  } catch {
    return null;
  }
}
// When the arrangement is too big for the browser to keep (large pictures in the page editor), the
// person is told once: a reload would lose it (QA 0.65.1: it was lost silently).
let warnedFull = false;
function save(state) {
  try {
    sessionStorage.setItem(STORE(), JSON.stringify({ pages: state.pages, layout: state.layout, exp: state.exp }));
    warnedFull = false;
  } catch {
    if (!warnedFull) toast('Your changes are too large for this browser to keep if the page reloads (large pictures). Download your PDF before you leave or reload.', 'error');
    warnedFull = true;
  }
}

// A file as base64. Pictures the server does not read (WebP, GIF, HEIC…) are drawn on a canvas and
// sent as PNG: what the browser can show, it can convert.
const readBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('The file could not be read.'));
  r.readAsDataURL(blob);
});
// A file sent in pieces (0.66): each piece is one request, sent again on its own if the line drops,
// and sized to the line (smaller on a slow one, so no request runs long). onProgress(0…1).
// Returns the upload's id, for /finish (or /verify).
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function uploadInPieces(blob, name, onProgress = () => {}) {
  const { id, chunkBytes } = await api.post('/api/tools/pdf/uploads', { name, size: blob.size });
  let size = Math.min(chunkBytes, 1024 * 1024);
  let offset = 0;
  try {
    while (offset < blob.size) {
      const piece = blob.slice(offset, Math.min(blob.size, offset + size));
      const data = await readBase64(piece);
      const t0 = performance.now();
      let r = null;
      for (let attempt = 0; ; attempt++) {
        try {
          r = await api.put(`/api/tools/pdf/uploads/${id}`, { offset, data });
          break;
        } catch (err) {
          // The line dropped or the server was busy: wait and send the same piece again.
          if (attempt >= 4 || (err.status && err.status < 500 && err.status !== 408 && err.status !== 429)) throw err;
          await pause([1000, 3000, 6000, 12000][attempt]);
        }
      }
      offset = r.received;
      onProgress(offset / blob.size);
      const secs = (performance.now() - t0) / 1000;
      if (secs < 4 && size < chunkBytes) size = Math.min(chunkBytes, size * 2);
      else if (secs > 20 && size > 256 * 1024) size = Math.max(256 * 1024, Math.floor(size / 2));
    }
  } catch (err) {
    api.del(`/api/tools/pdf/uploads/${id}`).catch(() => {});
    throw err;
  }
  return id;
}
// A protected PDF's password, asked for (null: the person chose not to).
function askPassword(name, wrong) {
  return new Promise((resolve) => {
    let given = null;
    modal({
      title: 'This PDF has a password', submitLabel: 'Open', cancelLabel: 'Skip this file',
      subtitle: wrong ? `That password is not right for ${name}. Try again.` : `Type the password that opens ${name}. CORE uses it once, to read the file, and does not keep it.`,
      body: html`<label class="field"><span>Password</span><input type="password" name="password" autocomplete="off" required /></label>`,
      onSubmit: async (f) => { given = f.password.value; },
      onClose: () => resolve(given),
    });
  });
}

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
      const [w, h] = p.orientation === 'landscape' ? [841.89, 595.28] : [595.28, 841.89];
      return html`<li class="ps-page ${sel ? 'sel' : ''}" data-key="${p.key}" draggable="true">
        <div class="ps-slot"><div class="ps-paper blank" style="--r:${w / h}"><span>Blank page</span><small>${PDF_SIZES[p.size] || 'A4'}</small>${editsShown(p, w, h)}${editBadge(p)}</div></div>
        ${cardFoot(p, i, 'Blank page', '')}</li>`;
    }
    const s = byId(p.source);
    const info = s.pages[p.page] || {};
    const turn = ((info.rotate || 0) + (p.rotate || 0)) % 360;
    const sideways = turn === 90 || turn === 270;
    // The card has the page's shape as shown (turned or not); the picture inside turns with it.
    const [dw, dh] = sideways ? [info.height, info.width] : [info.width, info.height];
    // The page as CORE draws it (0.65: every page, typed or scanned), turned as arranged; a picture
    // shows itself.
    const turned = `transform:rotate(${turn}deg)${sideways ? `;width:${(info.width / info.height) * 100}%;height:${(info.height / info.width) * 100}%` : ''}`;
    const inner = s.kind === 'image' && s.format !== 'tiff' // a TIFF (0.66) is drawn: browsers cannot show one
      ? html`<img class="pic" src="/api/tools/pdf/sources/${s.id}/pages/${p.page}/thumb" alt="" loading="lazy" style="transform:rotate(${p.rotate || 0}deg)" />`
      : html`<img class="ps-svg" src="/api/tools/pdf/sources/${s.id}/pages/${p.page}/svg${s.version ? `?v=${s.version}` : ''}" alt="" loading="lazy" style="${turned}" />`;
    return html`<li class="ps-page ${sel ? 'sel' : ''}" data-key="${p.key}" draggable="true">
      <div class="ps-slot"><div class="ps-paper" style="--r:${dw / dh}">${inner}${editsShown(p, dw, dh)}${tag(s)}${p.rotate ? html`<span class="ps-turned" title="Turned ${p.rotate}°">${icon('rotateCw', 12)} ${p.rotate}°</span>` : ''}${editBadge(p)}</div></div>
      ${cardFoot(p, i, s.name, `page ${p.page + 1} of ${s.pages.length}`)}</li>`;
  }
  // What the page editor added, drawn small on the card (signatures, text, white-out, highlights,
  // marks; changed lines as white boxes with their new words): the card shows the page as exported.
  function editsShown(p, dw, dh) {
    const list = (p.edits || []).filter((e) => e.type !== 'replace' || e.box);
    if (!list.length) return '';
    const pct = (v, of) => `${(v / of) * 100}%`;
    const font = (e) => `font:${e.italic ? 'italic ' : ''}${e.bold ? '700 ' : ''}calc(${e.size / dw} * 100cqw)/1.2 ${{ serif: 'Times, serif', mono: 'Courier, monospace' }[e.family] || 'Helvetica, Arial, sans-serif'};color:${e.color}`;
    return html`<span class="ps-marks" aria-hidden="true">${list.map((e) => {
      if (e.type === 'image') return html`<img src="${e.data}" alt="" style="left:${pct(e.x, dw)};top:${pct(e.y, dh)};width:${pct(e.w, dw)};height:${pct(e.h, dh)}" />`;
      if (e.type === 'box' || e.type === 'highlight') return html`<i class="${e.type}" style="left:${pct(e.x, dw)};top:${pct(e.y, dh)};width:${pct(e.w, dw)};height:${pct(e.h, dh)};background:${e.color}"></i>`;
      if (e.type === 'text') return html`<b style="left:${pct(e.x, dw)};top:${pct(e.y, dh)};${e.w ? `width:${pct(e.w, dw)};` : ''}${font(e)}">${e.text}</b>`;
      if (e.type === 'mark') return html`<i class="mark" style="left:${pct(e.x, dw)};top:${pct(e.y, dh)};width:${pct(e.size, dw)};height:${pct(e.size, dh)};color:${e.color}">${icon(e.kind === 'cross' ? 'x' : e.kind === 'dot' ? 'circle' : 'check', 12)}</i>`;
      // A changed line (its place from the editor, unturned pages only; turned ones show the badge).
      const t = turnOf(p);
      if (t) return '';
      const b = e.box;
      return html`<b class="replaced" style="left:${pct(b.x, dw)};top:${pct(dh - b.y - b.height * 1.15, dh)};min-width:${pct(b.width, dw)};${font(e)}">${e.text}</b>`;
    })}</span>`;
  }
  const turnOf = (p) => (p.blank ? 0 : ((((byId(p.source)?.pages[p.page]?.rotate || 0) + (p.rotate || 0)) % 360) + 360) % 360);
  // How many changes the page editor made on a page, and whether it is signed.
  function editBadge(p) {
    const n = (p.edits || []).length;
    if (!n) return '';
    const signed = p.edits.some((e) => e.type === 'image' && e.signature);
    return html`<span class="ps-edited ${signed ? 'signed' : ''}" title="${n} change${n === 1 ? '' : 's'} in the page editor">${icon(signed ? 'pen' : 'edit', 12)} ${signed ? 'Signed' : n}</span>`;
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
        <button type="button" class="icon-btn" data-act="edit" aria-label="Edit or sign page ${i + 1}" title="Edit text, add text, sign">${icon('edit', 15)}</button>
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
      <label class="field"><span>Format</span><select name="as">${formatOptions(x.as)}</select><small class="hint" id="ps-as-hint">${FORMAT(x.as).hint}</small></label>
      ${x.as !== 'pdf' ? html`<p class="notice ps-as-note">${icon('help', 16)} <span>${isPictures(x.as) ? 'A picture of each page, in a ZIP when there are several.' : 'CORE reads the text, headings, tables and pictures back from the pages. Check the result: a PDF does not keep how its document was made, and scans without recognised text have no text to take.'}</span></p>` : ''}
      ${x.as === 'png' || x.as === 'jpg' ? html`<label class="field"><span>Sharpness</span><select name="dpi">${PDF_PICTURE_DPI.map((d) => option(d, d === 72 ? '72 dpi (screen)' : d === 150 ? '150 dpi (good for most)' : '300 dpi (print)', x.dpi))}</select></label>` : ''}
      <fieldset class="field" ${isPictures(x.as) ? 'hidden' : ''}><legend>Save as</legend>
        <div class="ps-radio">
          ${[['none', `One ${x.as === 'pdf' ? 'PDF' : 'file'}`], ['documents', `One ${x.as === 'pdf' ? 'PDF' : 'file'} per file (ZIP)`], ['pages', `One ${x.as === 'pdf' ? 'PDF' : 'file'} per page (ZIP)`]].map(([v, l]) => html`<label class="check"><input type="radio" name="split" value="${v}" ${x.split === v ? 'checked' : ''} /><span>${l}</span></label>`)}
        </div></fieldset>
      ${stamps(x.as) ? '' : html`<p class="muted small">Page numbers, header, footer and watermark go on PDFs and pictures, not into documents to edit.</p>`}
      <details class="ps-more" ${x.numbers || x.header || x.footer ? 'open' : ''} ${stamps(x.as) ? '' : 'hidden'}><summary>Page numbers, header and footer</summary>
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
      <details class="ps-more" ${x.watermark ? 'open' : ''} ${stamps(x.as) ? '' : 'hidden'}><summary>Watermark</summary>
        <label class="field"><span>Text across each page</span><input name="watermark" value="${x.watermark}" maxlength="60" placeholder="e.g. DRAFT or CONFIDENTIAL" /></label>
        <div class="grid two">
          <label class="field"><span>Strength <output class="muted small" id="ps-opacity">${Math.round(x.opacity * 100)}%</output></span><input type="range" name="opacity" min="0.05" max="0.5" step="0.05" value="${x.opacity}" /></label>
          <label class="field"><span>Colour</span><select name="color">${option('gray', 'Grey', x.color)}${option('red', 'Red', x.color)}${option('blue', 'Blue', x.color)}</select></label>
        </div>
      </details>
      <details class="ps-more"><summary>Document details</summary>
        <label class="field"><span>Title</span><input name="title" value="${x.title}" maxlength="160" /></label>
        <label class="field"><span>Author</span><input name="author" value="${x.author}" maxlength="120" placeholder="${ctx.user?.name || ''}" /></label>
      </details>
      ${signedCount() && x.as !== 'pdf' ? html`<p class="muted small">Signatures are drawn in, but only a PDF gets a signature record that can be verified.</p>` : ''}
      ${signedCount() && x.as === 'pdf' ? html`<label class="check ps-record"><input type="checkbox" name="record" ${x.record !== false ? 'checked' : ''} ${x.split === 'none' ? '' : 'disabled'} /><span>Add a signature record page (who signed, when, and a code to verify the file in CORE)${x.split === 'none' ? '' : ' — with one PDF only'}</span></label>` : ''}
      <div class="ps-go">
        <button type="button" class="btn primary" id="ps-export" ${state.pages.length && !state.busy ? '' : 'disabled'}>${icon('download', 16)} ${downloadLabel(x)}</button>
        <button type="button" class="btn" id="ps-preview" ${state.pages.length && !state.busy && x.split === 'none' && x.as === 'pdf' ? '' : 'disabled'} ${x.as === 'pdf' ? '' : 'hidden'} title="Open the PDF in a new tab">${icon('eye', 16)} Preview</button>
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
        <div class="actions"><button type="button" class="btn" id="ps-verify">${icon('shield', 16)} Verify a signed PDF</button>${state.sources.length ? html`<button type="button" class="btn" id="ps-reset">${icon('trash', 16)} Start over</button>` : ''}</div>
      </header>
      <div class="ps-layout">
        <div class="ps-main">
          <section class="card ps-drop" id="ps-drop" tabindex="-1">
            <span class="ps-drop-ic">${icon('upload', 26)}</span>
            <div><span class="ps-drop-words"><strong>Drop files here</strong> or </span><label class="ps-pick">choose files<input type="file" id="ps-file" multiple accept="${PDF_ACCEPT}" class="sr-only" /></label>
              <small>PDF (protected ones too), Word, Excel and PowerPoint (old and new), OpenDocument, RTF, text, CSV, HTML, code, e-books, e-mails, ZIPs and pictures (JPEG, PNG, TIFF, WebP, HEIC…), up to ${PDF_LIMITS.maxFileBytes / MB} MB each.</small></div>
            ${state.busy ? html`<p class="ps-busy" role="status"><span class="ps-spin" aria-hidden="true"></span> <span class="ps-busy-text">${state.progress != null ? 'Uploading' : 'Converting'} ${state.queue[0] || ''}${state.busy > 1 ? ` and ${state.busy - 1} more` : ''}…</span>${state.progress != null ? html` <progress max="1" value="${state.progress}" aria-label="Uploaded"></progress>` : ''}</p>` : ''}
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
                  <button type="button" class="btn small-btn primary" id="ps-sign">${icon('pen', 14)} Sign</button>
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
      </div>
      ${state.pages.length ? html`<div class="ps-mobilebar" role="region" aria-label="Download">
        <span class="muted small">${plural(state.pages.length, 'page')}</span>
        ${x0().as === 'pdf' ? html`<button type="button" class="btn" data-export="preview" ${state.busy || x0().split !== 'none' ? 'disabled' : ''}>${icon('eye', 16)} Preview</button>` : ''}
        <button type="button" class="btn primary" data-export="download" ${state.busy ? 'disabled' : ''}>${icon('download', 16)} ${downloadLabel(x0())}</button>
      </div>` : ''}`);
    wire();
  }
  const x0 = () => state.exp;

  // ----- Uploading -----
  async function add(files) {
    const list = [...files];
    const refused = [];
    const ok = list.filter((f) => {
      const ext = extOf(f.name);
      if (![...PDF_DIRECT_EXTS, ...PDF_BROWSER_IMAGES].includes(ext) && !/^image\//.test(f.type)) return refused.push(`${f.name} (not a kind of file PDF Studio takes)`), false;
      if (f.size > PDF_LIMITS.maxFileBytes) return refused.push(`${f.name} (larger than ${PDF_LIMITS.maxFileBytes / MB} MB)`), false;
      if (!f.size) return refused.push(`${f.name} (empty)`), false;
      return true;
    });
    const failed = [...refused];
    let added = 0;
    const notes = [];
    state.queue.push(...ok.map((f) => f.name));
    state.busy += ok.length;
    draw();
    for (const f of ok) {
      try {
        const ext = extOf(f.name);
        const conv = !PDF_DIRECT_EXTS.includes(ext) && /^image\//.test(f.type || 'image/') ? await toPng(f) : { name: f.name, type: f.type, blob: f };
        state.progress = 0;
        const id = await uploadInPieces(conv.blob, conv.name, (p) => {
          state.progress = p;
          const bar = el.querySelector('.ps-busy progress');
          if (bar) bar.value = p;
          else draw();
        });
        state.progress = null;
        draw();
        let r = await api.post(`/api/tools/pdf/uploads/${id}/finish`, { layout: state.layout });
        while (r.needsPassword) {
          const password = await askPassword(conv.name, r.wrongPassword);
          if (password === null) {
            api.del(`/api/tools/pdf/uploads/${id}`).catch(() => {});
            throw new Error('it needs a password');
          }
          r = await api.post(`/api/tools/pdf/uploads/${id}/finish`, { layout: state.layout, password });
        }
        for (const s of r.sources) {
          state.sources.push(s);
          s.pages.forEach((x, i) => state.pages.push({ key: key(), source: s.id, page: i, rotate: 0 }));
          if (s.warnings?.length) notes.push(`${s.name}: ${s.warnings.join(' ')}`);
          added += 1;
        }
        notes.push(...(r.notes || []));
      } catch (err) {
        failed.push(`${f.name} (${err.message.replace(/\.$/, '')})`);
      } finally {
        state.busy -= 1;
        state.queue.shift();
        changed();
      }
    }
    // One message for the whole batch: what was added, and each file that was not, with why.
    if (failed.length) toast(`${added ? `${plural(added, 'file')} added. ` : ''}Not added: ${failed.join('; ')}.`, 'error');
    else if (added) toast(`${plural(added, 'file')} added.${notes.length ? ` ${notes.join(' ')}` : ''}`);
  }

  // ----- Arranging -----
  const indexOf = (k) => state.pages.findIndex((p) => p.key === k);
  // Turning a page turns what the page editor added with it (QA 0.65.1): each thing keeps its place
  // on the page's content (a signature stays by its line), and stays upright to read; white-out and
  // highlights turn their shape with the page. Changed lines are in the page itself: nothing to do.
  const shownDims = (p) => {
    if (p.blank) return p.orientation === 'landscape' ? [841.89, 595.28] : [595.28, 841.89];
    const info = byId(p.source)?.pages[p.page] || { width: 595.28, height: 841.89 };
    const t = turnOf(p);
    return t === 90 || t === 270 ? [info.height, info.width] : [info.width, info.height];
  };
  const turn = (p, by) => {
    const [W, H] = shownDims(p);
    const cw = ((by % 360) + 360) % 360 === 90;
    // A point of the page as shown, after a quarter turn (clockwise or not).
    const move = (x, y) => (cw ? [H - y, x] : [y, W - x]);
    for (const e of p.edits || []) {
      if (e.type === 'replace') continue;
      if (e.type === 'box' || e.type === 'highlight') {
        const [a, b] = move(e.x, e.y);
        const [c, d] = move(e.x + e.w, e.y + e.h);
        Object.assign(e, { x: Math.min(a, c), y: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b) });
      } else {
        const w = e.type === 'image' ? e.w : e.type === 'mark' ? e.size : e.w || (e.size || 12) * 6;
        const h = e.type === 'image' ? e.h : e.type === 'mark' ? e.size : (e.size || 12) * 1.2;
        const [cx, cy] = move(e.x + w / 2, e.y + h / 2);
        e.x = cx - w / 2;
        e.y = cy - h / 2;
      }
    }
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
      submitLabel: 'Apply', className: 'ps-setup-modal',
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
        let lost = 0;
        for (const s of redo) {
          const next = await api.post(`/api/tools/pdf/sources/${s.id}/layout`, { layout: only || s.kind === 'image' || layout.size !== 'auto' ? layout : { ...layout, size: 'a4' } });
          // The arrangement is kept (QA 0.65.1): each page of the file stays where it was, with its
          // turn and what was added on it; pages it no longer has go; new ones follow its last page.
          // Changed lines of text are left behind (the text has moved), and said so.
          const count = next.pages.length;
          let dropped = 0;
          state.pages = state.pages.filter((p) => {
            if (p.source !== s.id) return true;
            if (p.page >= count) return false;
            const before = (p.edits || []).length;
            p.edits = (p.edits || []).filter((e) => e.type !== 'replace');
            dropped += before - p.edits.length;
            return true;
          });
          const had = Math.max(-1, ...s.pages.map((x, i) => i));
          const lastAt = state.pages.reduce((at, p, i) => (p.source === s.id ? i : at), -1);
          const fresh = next.pages.map((x, i) => i).filter((i) => i > had).map((i) => ({ key: key(), source: s.id, page: i, rotate: 0 }));
          if (fresh.length && lastAt >= 0) state.pages.splice(lastAt + 1, 0, ...fresh);
          if (dropped) lost += dropped;
          Object.assign(s, next);
        }
        changed();
        toast(`${redo.length ? `${plural(redo.length, 'file')} laid out again.` : 'Saved for the next files.'}${lost ? ` ${plural(lost, 'changed line')} of text could not be kept (the text moved): change ${lost === 1 ? 'it' : 'them'} again in the page editor.` : ''}`, lost ? 'error' : 'ok');
      },
    });
  }

  // ----- Export -----
  function readExport() {
    const f = el.querySelector('.ps-export');
    if (!f) return;
    const v = (n) => f.querySelector(`[name="${n}"]`);
    Object.assign(state.exp, {
      as: Object.hasOwn(PDF_EXPORT_FORMATS, v('as').value) ? v('as').value : 'pdf', dpi: v('dpi') ? Number(v('dpi').value) || 150 : state.exp.dpi,
      fileName: v('fileName').value, split: f.querySelector('[name=split]:checked')?.value || 'none', numbers: v('numbers').checked, format: v('format').value, position: v('position').value,
      start: v('start').value === '' ? 1 : Math.max(0, Number(v('start').value) || 0), skipFirst: v('skipFirst').checked, header: v('header').value, footer: v('footer').value, watermark: v('watermark').value,
      opacity: Number(v('opacity').value), color: v('color').value, title: v('title').value, author: v('author').value, record: v('record') ? v('record').checked : state.exp.record,
    });
    save(state);
  }
  async function exportPdf(preview = false, from = null) {
    readExport();
    const x = state.exp;
    const body = {
      pages: state.pages.map((p) => ({ ...(p.blank ? { blank: true, size: p.size, orientation: p.orientation } : { source: p.source, page: p.page }), rotate: p.rotate || 0, edits: editsOut(p) })),
      sign: { record: x.record !== false },
      stamp: {
        ...(x.numbers ? { numbers: { format: x.format, position: x.position, start: x.start, skipFirst: x.skipFirst } } : {}),
        header: x.header, footer: x.footer, ...(x.watermark ? { watermark: { text: x.watermark, opacity: x.opacity, color: x.color } } : {}),
      },
      meta: { title: x.title, author: x.author || ctx.user?.name || '' },
      split: preview ? 'none' : x.split, fileName: x.fileName || defaultName(), preview, as: preview ? 'pdf' : x.as || 'pdf',
    };
    // Preview: the tab is opened now, while the click counts (a tab opened after the PDF is made
    // would be stopped as a pop-up), and shows the PDF once it is ready.
    let tab = null;
    if (preview) {
      tab = window.open('', '_blank');
      if (!tab) return toast('Allow pop-ups for CORE to preview, or download the PDF instead.', 'error');
      tab.document.title = 'Making the PDF…';
      tab.document.body.style.cssText = 'font: 15px system-ui, sans-serif; color: #555; display: grid; place-items: center; height: 100vh; margin: 0';
      tab.document.body.textContent = 'Making the PDF…';
    }
    const btn = from || el.querySelector(preview ? '#ps-preview' : '#ps-export');
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.textContent = 'Making…';
    try {
      const res = await fetch('/api/tools/pdf/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (${res.status})`);
      // PNG and JPEG (0.68): the server sends each page as SVG; this browser draws them.
      if (!preview && FORMAT(body.as).browser) {
        const drawn = await drawPictures(await res.json(), body.as, x.dpi, btn);
        const url = URL.createObjectURL(drawn.blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: drawn.name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        toast(`${drawn.name} downloaded (${sizeLabel(drawn.blob.size)}).`, 'ok');
        return;
      }
      const blob = await res.blob();
      const warning = res.headers.get('X-Core-Warning') || res.headers.get('X-Core-Note');
      const name = decodeURIComponent((res.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || 'document.pdf');
      const url = URL.createObjectURL(blob);
      if (preview) {
        tab.location.replace(url);
        tab.opener = null;
      } else {
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast(`${name} downloaded (${sizeLabel(blob.size)}).${warning ? ` ${decodeURIComponent(warning)}` : ''}`, warning ? 'error' : 'ok');
      }
      setTimeout(() => URL.revokeObjectURL(url), preview ? 30 * 60000 : 60000);
    } catch (err) {
      tab?.close();
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }

  // Each page's SVG drawn at `dpi` on a canvas and saved as PNG or JPEG; several go in a ZIP.
  async function drawPictures(r, as, dpi, btn) {
    const type = as === 'jpg' ? 'image/jpeg' : 'image/png';
    const pad = String(r.pages.length).length;
    const files = [];
    for (const [i, p] of r.pages.entries()) {
      btn.textContent = `Drawing page ${i + 1} of ${r.pages.length}…`;
      // Not more than 40 million dots a page (what browsers draw on one canvas).
      const k = Math.min(dpi / 72, Math.sqrt(40e6 / Math.max(1, p.width * p.height)));
      const w = Math.max(1, Math.round(p.width * k));
      const h = Math.max(1, Math.round(p.height * k));
      const url = URL.createObjectURL(new Blob([p.svg], { type: 'image/svg+xml' }));
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
        const g = canvas.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, w, h);
        g.drawImage(img, 0, 0, w, h);
        const blob = await new Promise((done) => canvas.toBlob(done, type, 0.9));
        if (!blob) throw new Error(`Page ${i + 1} is too large for this browser to draw. Choose a lower sharpness.`);
        files.push({ name: r.pages.length === 1 ? `${r.base}.${r.ext}` : `${r.base} - page ${String(i + 1).padStart(pad, '0')}.${r.ext}`, data: new Uint8Array(await blob.arrayBuffer()) });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (files.length === 1) return { name: files[0].name, blob: new Blob([files[0].data], { type }) };
    return { name: `${r.base}.zip`, blob: zipStore(files) };
  }

  // ----- The page editor (0.65) -----
  const signedCount = () => state.pages.filter((p) => (p.edits || []).some((e) => e.type === 'image' && e.signature)).length;
  // What the export sends of a page's changes (not what the editor keeps for itself).
  const editsOut = (p) => (p.edits || []).map(({ id, was, box, ...e }) => e);
  function editPage(i, signNow = false) {
    if (i < 0 || !state.pages.length) return;
    openPageEditor({ pages: state.pages, at: i, source: byId, signNow, onChange: changed, onSave: () => save(state) });
  }
  // Is this file the one that was signed? CORE compares it with the record kept when it was signed.
  function verify() {
    modal({
      title: 'Verify a signed PDF', submitLabel: 'Check', subtitle: 'Choose a PDF signed in CORE\'s PDF Studio. CORE checks that it is exactly the file that was signed.',
      body: html`<label class="field"><span>The signed PDF</span><input type="file" name="file" accept=".pdf,application/pdf" required /></label><div id="verify-out" aria-live="polite"></div>`,
      onSubmit: async (f) => {
        const file = f.file.files[0];
        if (!file) throw new Error('Choose the PDF.');
        if (file.size > PDF_LIMITS.maxFileBytes) throw new Error(`The file is larger than ${PDF_LIMITS.maxFileBytes / MB} MB.`);
        const r = await api.post('/api/tools/pdf/verify', { upload: await uploadInPieces(file, file.name) });
        const box = f.querySelector('#verify-out');
        const when = (iso) => new Date(iso).toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });
        mount(box, r.result === 'valid'
          ? html`<p class="notice ok">${icon('checkCircle', 18)} <span><strong>Unchanged since it was signed.</strong> Signed by ${r.record.name} on ${when(r.record.at)}, on page${r.record.signedPages.length === 1 ? '' : 's'} ${r.record.signedPages.join(', ')} (record ${r.record.code}).</span></p>`
          : r.result === 'changed'
            ? html`<p class="notice bad">${icon('alert', 18)} <span><strong>This file was changed after it was signed.</strong> It names record ${r.record.code} (signed by ${r.record.name} on ${when(r.record.at)}), but its contents are not the ones signed. Ask the signer for the original.</span></p>`
            : html`<p class="notice">${icon('help', 18)} <span>${r.reason}</span></p>`);
        // The result stays; the buttons now say what can be done next.
        f.querySelector('[type=submit]').textContent = 'Check another';
        f.querySelector('footer [data-close]').textContent = 'Close';
        throw Object.assign(new Error(''), { keepOpen: true });
      },
    });
  }

  // ----- Events -----
  function wire() {
    el.querySelector('#ps-file')?.addEventListener('change', (ev) => {
      add(ev.target.files);
      ev.target.value = '';
    });
    el.querySelector('#ps-sign')?.addEventListener('click', () => editPage(Math.max(0, state.pages.findIndex((p) => state.selected.has(p.key))), true));
    el.querySelector('#ps-verify').addEventListener('click', verify);
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
      // Only the pages not in the PDF any more, at the end.
      const s = byId(b.dataset.readd);
      const there = new Set(state.pages.filter((p) => p.source === s.id).map((p) => p.page));
      s.pages.forEach((x, i) => !there.has(i) && state.pages.push({ key: key(), source: s.id, page: i, rotate: 0 }));
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
    // The download bar of tablets and phones (where the export panel is below the pages).
    el.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => {
      readExport();
      exportPdf(b.dataset.export === 'preview', b);
    }));
    const grid = el.querySelector('#ps-grid');
    if (grid) {
      grid.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-act]');
        if (!b) return;
        const k = b.closest('[data-key]').dataset.key;
        if (b.dataset.act === 'edit') return editPage(indexOf(k));
        act(k, b.dataset.act);
      });
      // A double click on a page opens it in the editor.
      grid.addEventListener('dblclick', (ev) => {
        const li = ev.target.closest('[data-key]');
        if (li && !ev.target.closest('button, input, label')) editPage(indexOf(li.dataset.key));
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
        if (['numbers', 'split', 'as'].includes(ev.target.name)) draw();
      });
      exp.addEventListener('input', () => readExport());
      el.querySelector('#ps-export').addEventListener('click', () => exportPdf(false));
      exp.addEventListener('input', (ev) => {
        if (ev.target.name === 'opacity') el.querySelector('#ps-opacity').textContent = `${Math.round(Number(ev.target.value) * 100)}%`;
      });
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
