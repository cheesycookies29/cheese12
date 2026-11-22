// PDF Studio's page editor (0.65): one page, drawn by the server (an SVG of the page), with what you
// add on top — text, white-out, highlights, ticks and crosses, today's date, pictures and your
// signature — and the page's own lines of text, which you can change (the old words are taken out
// of the page when it is exported; the new ones are written where they began).
//
// Positions are kept in points, from the top-left corner of the page as it is shown (turned as
// arranged); the server draws them the same way (server/pdf/edits.js).
import { api } from '../api.js';
import { ctx } from '../state.js';
import { html, mount, toast, modal } from '../ui.js';
import { icon } from '../icons.js';

const FAMILY_CSS = { sans: 'Helvetica, Arial, sans-serif', serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };
const COLORS = ['#111111', '#1d4ed8', '#b91c1c', '#15803d', '#ffffff'];
const today = () => new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
const hex = (rgb) => (Array.isArray(rgb) ? `#${rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}` : '#111111');
let nextId = 1;
const uid = () => `e${Date.now().toString(36)}${(nextId++).toString(36)}`;

// The page's size as shown, in points: [width, height] after turning.
export function shownSize(info, turn) {
  return turn === 90 || turn === 270 ? [info.height, info.width] : [info.width, info.height];
}
// A box in the page's own space (from its bottom-left, not turned) as shown: top-left x, y, w, h.
export function shownBox(r, W, H, turn) {
  if (turn === 90) return { x: r.y, y: r.x, w: r.height, h: r.width };
  if (turn === 180) return { x: W - r.x - r.width, y: r.y, w: r.width, h: r.height };
  if (turn === 270) return { x: H - r.y - r.height, y: W - r.x - r.width, w: r.height, h: r.width };
  return { x: r.x, y: H - r.y - r.height, w: r.width, h: r.height };
}

// ---------- Signatures ----------
const SIG_KEY = () => `core.signature.${ctx.user?.id || ''}`;
export const savedSignature = () => {
  try {
    return JSON.parse(localStorage.getItem(SIG_KEY()));
  } catch {
    return null;
  }
};
// The drawn part of a canvas only (transparent edges trimmed), as a PNG data URL with its size.
function trimmed(canvas) {
  const g = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const px = g.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const out = Object.assign(document.createElement('canvas'), { width: x1 - x0 + 1, height: y1 - y0 + 1 });
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { data: out.toDataURL('image/png'), width: out.width, height: out.height };
}
// Draw, type or upload a signature. Resolves to { data, width, height } or null.
export function signaturePad() {
  return new Promise((resolve) => {
    let done = false;
    const saved = savedSignature();
    // Handwriting faces shipped with CORE (public/fonts, SIL Open Font License), so every computer and
    // phone shows the same three styles.
    const fonts = ['"CORE Sign Vibes", cursive', '"CORE Sign Dancing", cursive', '"CORE Sign Caveat", cursive'];
    const { form } = modal({
      title: 'Your signature', wide: true, className: 'ps-sig-modal', submitLabel: 'Use this signature',
      subtitle: 'Draw it, type it, or upload a picture of it. Then click where it goes on the page.',
      body: html`<div class="seg-btns ps-sig-tabs" role="tablist">
          <button type="button" role="tab" data-tab="draw" class="active" aria-selected="true">${icon('edit', 14)} Draw</button>
          <button type="button" role="tab" data-tab="type" aria-selected="false">${icon('file', 14)} Type</button>
          <button type="button" role="tab" data-tab="upload" aria-selected="false">${icon('upload', 14)} Upload</button>
          ${saved ? html`<button type="button" role="tab" data-tab="saved" aria-selected="false">${icon('check', 14)} Saved</button>` : ''}
        </div>
        <div class="ps-sig-pane" data-pane="draw">
          <canvas class="ps-sig-canvas" width="900" height="300" aria-label="Draw your signature here with the mouse, a finger or a pen"></canvas>
          <div class="ps-sig-row"><span class="muted small">Sign above the line.</span><span class="spacer"></span>
            <label class="ps-ink"><input type="radio" name="ink" value="#111827" checked /><i style="background:#111827"></i><span class="sr-only">Black</span></label>
            <label class="ps-ink"><input type="radio" name="ink" value="#1d3fbf" /><i style="background:#1d3fbf"></i><span class="sr-only">Blue</span></label>
            <button type="button" class="btn small-btn ghost" id="sig-clear">Clear</button></div>
        </div>
        <div class="ps-sig-pane" data-pane="type" hidden>
          <label class="field"><span>Your name</span><input name="sigName" value="${ctx.user?.name || ''}" maxlength="80" /></label>
          <div class="ps-sig-fonts" role="radiogroup" aria-label="Style">${fonts.map((f, i) => html`<label class="ps-sig-font"><input type="radio" name="sigFont" value="${i}" ${i === 0 ? 'checked' : ''} /><canvas width="600" height="140" data-font="${i}"></canvas></label>`)}</div>
        </div>
        <div class="ps-sig-pane" data-pane="upload" hidden>
          <label class="field"><span>A picture of your signature (PNG or JPEG)</span><input type="file" name="sigFile" accept="image/png,image/jpeg,image/webp" /></label>
          <label class="check"><input type="checkbox" name="sigClean" checked /><span>Make the paper around it see-through</span></label>
          <canvas class="ps-sig-up" width="900" height="300" hidden></canvas>
        </div>
        ${saved ? html`<div class="ps-sig-pane" data-pane="saved" hidden><img class="ps-sig-saved" src="${saved.data}" alt="Your saved signature" /></div>` : ''}
        <label class="check ps-sig-keep"><input type="checkbox" name="sigKeep" ${saved ? 'checked' : ''} /><span>Remember it in this browser, for next time</span></label>`,
      onSubmit: async () => {
        const out = current();
        if (!out) throw new Error(tab === 'type' ? 'Type your name.' : tab === 'upload' ? 'Choose a picture of your signature.' : 'Sign in the box first.');
        try {
          if (form.sigKeep.checked) localStorage.setItem(SIG_KEY(), JSON.stringify(out));
          else localStorage.removeItem(SIG_KEY());
        } catch {}
        done = true;
        resolve(out);
      },
      onClose: () => !done && resolve(null),
    });
    let tab = 'draw';
    form.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      form.querySelectorAll('[data-tab]').forEach((x) => (x.classList.toggle('active', x === b), x.setAttribute('aria-selected', String(x === b))));
      form.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== tab));
      if (tab === 'type') drawTyped();
    }));
    // Drawing: smooth strokes from pointer events (mouse, finger, pen).
    const pad = form.querySelector('.ps-sig-canvas');
    const g = pad.getContext('2d');
    const guide = () => {
      g.save();
      g.strokeStyle = '#c9ced8';
      g.setLineDash([6, 6]);
      g.beginPath();
      g.moveTo(40, 230);
      g.lineTo(860, 230);
      g.stroke();
      g.restore();
    };
    let drawn = false;
    let last = null;
    const at = (e) => {
      const r = pad.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * pad.width, y: ((e.clientY - r.top) / r.height) * pad.height };
    };
    pad.addEventListener('pointerdown', (e) => {
      pad.setPointerCapture(e.pointerId);
      last = at(e);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = form.querySelector('[name=ink]:checked').value;
      g.lineWidth = 4.5;
    });
    pad.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = at(e);
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      g.beginPath();
      g.moveTo(last.mx ?? last.x, last.my ?? last.y);
      g.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      g.stroke();
      last = { ...p, mx: mid.x, my: mid.y };
      drawn = true;
    });
    const up = () => (last = null);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    form.querySelector('#sig-clear').addEventListener('click', () => {
      g.clearRect(0, 0, pad.width, pad.height);
      guide();
      drawn = false;
    });
    guide();
    // Typed: the name in each style.
    const drawTyped = async () => {
      // The faces load when first used: wait for them, so the name is not drawn in a stand-in.
      await Promise.all(fonts.map((f) => document.fonts?.load(`64px ${f}`).catch(() => null)));
      for (const c of form.querySelectorAll('[data-font]')) {
        const cg = c.getContext('2d');
        cg.clearRect(0, 0, c.width, c.height);
        cg.fillStyle = '#111827';
        let size = 72;
        cg.font = `${size}px ${fonts[c.dataset.font]}`;
        const name = form.sigName.value.trim() || 'Your name';
        while (cg.measureText(name).width > c.width - 40 && size > 20) cg.font = `${(size -= 4)}px ${fonts[c.dataset.font]}`;
        cg.fillText(name, 20, 95);
      }
    };
    form.sigName.addEventListener('input', drawTyped);
    // Uploaded: drawn on a canvas, near-white made see-through if asked.
    const upCanvas = form.querySelector('.ps-sig-up');
    let uploaded = false;
    const loadUpload = async () => {
      const file = form.sigFile.files[0];
      if (!file) return;
      const url = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(file);
      });
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      }).catch(() => toast('That picture could not be opened.', 'error'));
      const scale = Math.min(1, 1200 / img.naturalWidth, 600 / img.naturalHeight);
      upCanvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      upCanvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ug = upCanvas.getContext('2d');
      ug.drawImage(img, 0, 0, upCanvas.width, upCanvas.height);
      if (form.sigClean.checked) {
        const d = ug.getImageData(0, 0, upCanvas.width, upCanvas.height);
        for (let i = 0; i < d.data.length; i += 4) {
          const light = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
          if (light > 200) d.data[i + 3] = 0;
          else if (light > 150) d.data[i + 3] = Math.round(((200 - light) / 50) * 255);
        }
        ug.putImageData(d, 0, 0);
      }
      upCanvas.hidden = false;
      uploaded = true;
    };
    form.sigFile.addEventListener('change', loadUpload);
    form.sigClean.addEventListener('change', loadUpload);
    const current = () => {
      if (tab === 'saved') return saved;
      if (tab === 'draw') {
        if (!drawn) return null;
        const copy = Object.assign(document.createElement('canvas'), { width: pad.width, height: pad.height });
        // Without the guide line: redraw the strokes only (the guide is light grey: drop it).
        const cg = copy.getContext('2d');
        cg.drawImage(pad, 0, 0);
        const d = cg.getImageData(0, 0, copy.width, copy.height);
        for (let i = 0; i < d.data.length; i += 4) if (d.data[i] > 180 && d.data[i + 1] > 180 && d.data[i + 2] > 180) d.data[i + 3] = 0;
        cg.putImageData(d, 0, 0);
        return trimmed(copy);
      }
      if (tab === 'type') {
        if (!form.sigName.value.trim()) return null;
        return trimmed(form.querySelector(`[data-font="${form.querySelector('[name=sigFont]:checked').value}"]`));
      }
      return uploaded ? trimmed(upCanvas) : null;
    };
    if (saved) form.querySelector('[data-tab="saved"]').click();
  });
}

// ---------- The editor ----------
// pages: the arrangement; at: the index to open; sources(id) → source; onChange() saves.
export function openPageEditor({ pages, at, source, onChange, onSave = () => {}, signNow = false }) {
  let index = at;
  let tool = signNow ? 'sign' : 'select';
  let selected = null;
  let runs = null; // the page's lines of text, when changing them
  let pendingSig = null; // a signature waiting to be placed
  const undo = [];
  const shell = document.createElement('div');
  shell.className = 'ps-editor';
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'true');
  shell.setAttribute('aria-label', 'Page editor');
  document.body.appendChild(shell);
  document.body.classList.add('ps-editing');
  const opener = document.activeElement;
  const page = () => pages[index];
  const edits = () => (page().edits ||= []);
  const snapshot = () => {
    undo.push(JSON.stringify(page().edits || []));
    if (undo.length > 60) undo.shift();
  };
  const info = () => {
    const p = page();
    if (p.blank) {
      const [w, h] = p.orientation === 'landscape' ? [841.89, 595.28] : [595.28, 841.89];
      return { width: w, height: h, rotate: 0 };
    }
    return source(p.source).pages[p.page];
  };
  const turn = () => (((info().rotate || 0) + (page().rotate || 0)) % 360 + 360) % 360;
  // Text boxes left empty are not changes.
  const tidy = () => pages.forEach((p) => p.edits && (p.edits = p.edits.filter((e) => e.type !== 'text' || e.text.trim() || e.id === selected)));
  const close = () => {
    selected = null;
    tidy();
    shell.remove();
    document.body.classList.remove('ps-editing');
    document.removeEventListener('keydown', onKey);
    removeEventListener('resize', layout);
    removeEventListener('hashchange', close);
    onChange();
    opener?.focus?.();
  };

  const TOOLS = [
    ['select', 'Select and move', 'grid'], ['edit', 'Change text on the page', 'edit'], ['text', 'Add text', 'file'], ['box', 'White-out', 'square'],
    ['highlight', 'Highlight', 'sparkle'], ['check', 'Tick', 'check'], ['cross', 'Cross', 'x'], ['date', 'Today\'s date', 'calendar'], ['sign', 'Signature', 'pen'], ['picture', 'Picture', 'image'],
  ];
  function draw() {
    const p = page();
    const s = p.blank ? null : source(p.source);
    mount(shell, html`
      <header class="ps-ed-top">
        <div class="ps-ed-title"><strong>Edit page ${index + 1} of ${pages.length}</strong><small class="muted">${s ? `${s.name} · page ${p.page + 1}` : 'Blank page'}</small></div>
        <div class="ps-ed-nav">
          <button type="button" class="icon-btn" id="ed-prev" aria-label="Previous page" ${index === 0 ? 'disabled' : ''}>${icon('chevronLeft', 18)}</button>
          <button type="button" class="icon-btn" id="ed-next" aria-label="Next page" ${index === pages.length - 1 ? 'disabled' : ''}>${icon('chevronRight', 18)}</button>
        </div>
        <span class="spacer"></span>
        <div class="ps-ed-zoom" role="group" aria-label="Zoom">
          <button type="button" class="icon-btn" data-zoom="-1" aria-label="Zoom out" title="Zoom out">−</button>
          <button type="button" class="btn small-btn ghost" data-zoom="0" title="Fit the page's width">${Math.round(zoom * 100)}%</button>
          <button type="button" class="icon-btn" data-zoom="1" aria-label="Zoom in" title="Zoom in">+</button>
        </div>
        <button type="button" class="btn small-btn ghost" id="ed-undo" ${undo.length ? '' : 'disabled'}>${icon('undo', 14)} Undo</button>
        <button type="button" class="btn primary" id="ed-done">Done</button>
      </header>
      <div class="ps-ed-tools" role="toolbar" aria-label="Tools">${TOOLS.map(([k, label, ic]) => html`<button type="button" class="ps-ed-tool ${tool === k ? 'on' : ''}" data-tool="${k}" aria-pressed="${tool === k}" title="${label}">${icon(ic, 18)}<span>${label}</span></button>`)}</div>
      <div class="ps-ed-body">
        <div class="ps-ed-stage" id="ed-stage"><div class="ps-ed-page" id="ed-page"></div></div>
        <aside class="ps-ed-side" id="ed-side"></aside>
      </div>`);
    shell.querySelector('#ed-prev').addEventListener('click', () => go(index - 1));
    shell.querySelector('#ed-next').addEventListener('click', () => go(index + 1));
    shell.querySelector('#ed-done').addEventListener('click', close);
    shell.querySelector('#ed-undo').addEventListener('click', () => {
      if (!undo.length) return;
      page().edits = JSON.parse(undo.pop());
      selected = null;
      draw();
    });
    shell.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.tool)));
    shell.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
      const d = Number(b.dataset.zoom);
      zoom = d === 0 ? 1 : Math.max(0.5, Math.min(4, zoom * (d > 0 ? 1.25 : 0.8)));
      draw();
    }));
    layout();
    side();
  }
  function go(i) {
    if (i < 0 || i >= pages.length) return;
    index = i;
    selected = null;
    runs = null;
    undo.length = 0;
    draw();
    if (tool === 'edit') loadRuns();
  }
  async function pick(k) {
    if (k === 'sign') {
      const sig = await signaturePad();
      if (!sig) return;
      pendingSig = sig;
      tool = 'sign';
      draw();
      return;
    }
    if (k === 'picture') {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
      input.addEventListener('change', async () => {
        const f = input.files[0];
        if (!f) return;
        if (f.size > 8 * 1024 * 1024) return toast('Choose a picture smaller than 8 MB.', 'error');
        const img = await pictureData(f).catch((err) => toast(err.message, 'error'));
        if (!img) return;
        pendingSig = { ...img, picture: true };
        tool = 'sign';
        draw();
      });
      input.click();
      return;
    }
    tool = k;
    selected = null;
    draw();
    if (k === 'edit') loadRuns();
  }
  async function loadRuns() {
    const p = page();
    if (p.blank) return toast('A blank page has no text to change. Use Add text.', 'error');
    try {
      runs = (await api.get(`/api/tools/pdf/sources/${p.source}/pages/${p.page}/text`)).runs;
      if (!runs.length) toast('No text was found on this page (a scan is a picture: use White-out and Add text instead).');
    } catch (err) {
      toast(err.message, 'error');
      runs = [];
    }
    layout();
  }

  // ----- The page and what is on it -----
  let saveTimer = null;
  let scale = 1;
  let zoom = 1; // × the page's width fitted to the screen
  function layout() {
    const stage = shell.querySelector('#ed-stage');
    const el = shell.querySelector('#ed-page');
    if (!stage || !el) return;
    const p = page();
    const inf = info();
    const t = turn();
    const [dw, dh] = shownSize(inf, t);
    scale = Math.min((stage.clientWidth - 32) / dw, 2.2) * zoom;
    if (scale <= 0) scale = 1;
    el.style.width = `${dw * scale}px`;
    el.style.height = `${dh * scale}px`;
    // The server's drawing of the page, turned as arranged (it is drawn unturned).
    const bg = p.blank ? '' : html`<img class="ps-ed-bg" alt="" src="/api/tools/pdf/sources/${p.source}/pages/${p.page}/svg${source(p.source).version ? `?v=${source(p.source).version}` : ''}" style="width:${inf.width * scale}px;height:${inf.height * scale}px;transform:translate(-50%,-50%) rotate(${t}deg)" />`;
    const k = scale;
    const item = (e) => {
      const sel = selected === e.id ? 'sel' : '';
      const at = `left:${e.x * k}px;top:${e.y * k}px`;
      if (e.type === 'text') return html`<div class="ps-ed-item ps-ed-text ${sel}" data-id="${e.id}" style="${at};${e.w ? `width:${e.w * k}px;` : `max-width:${Math.max(20, dw - e.x - 8) * k}px;`}font:${e.italic ? 'italic ' : ''}${e.bold ? '700 ' : ''}${e.size * k}px/${1.2} ${FAMILY_CSS[e.family]};color:${e.color}">${e.text || ' '}${sel ? html`<span class="ps-ed-grip" data-grip="w"></span>` : ''}</div>`;
      if (e.type === 'box' || e.type === 'highlight') return html`<div class="ps-ed-item ps-ed-${e.type} ${sel}" data-id="${e.id}" style="${at};width:${e.w * k}px;height:${e.h * k}px;background:${e.color}">${sel ? html`<span class="ps-ed-grip" data-grip="wh"></span>` : ''}</div>`;
      if (e.type === 'image') return html`<div class="ps-ed-item ps-ed-image ${sel}" data-id="${e.id}" style="${at};width:${e.w * k}px;height:${e.h * k}px"><img src="${e.data.startsWith('data:') ? e.data : `data:image/png;base64,${e.data}`}" alt="${e.signature ? 'Signature' : 'Picture'}" draggable="false" />${sel ? html`<span class="ps-ed-grip" data-grip="ratio"></span>` : ''}</div>`;
      if (e.type === 'mark') return html`<div class="ps-ed-item ps-ed-mark ${sel}" data-id="${e.id}" style="${at};width:${e.size * k}px;height:${e.size * k}px;color:${e.color}">${icon(e.kind === 'cross' ? 'x' : e.kind === 'dot' ? 'circle' : 'check', Math.round(e.size * k))}${sel ? html`<span class="ps-ed-grip" data-grip="size"></span>` : ''}</div>`;
      if (e.type === 'replace') {
        const r = (runs || []).find((x) => x.id === e.run) || e.box;
        if (!r) return '';
        const rb = r.width !== undefined ? r : e.box;
        const b = shownBox(rb, inf.width, inf.height, t);
        // On a turned page the line runs along the page: drawn turned the same way, from its start.
        const turnCss = t ? `transform-origin:0 0;transform:rotate(${t}deg);left:${(t === 90 ? b.x + b.w : t === 180 ? b.x + b.w : b.x) * k}px;top:${(t === 90 ? b.y : b.y + b.h) * k}px;` : `left:${b.x * k}px;top:${(b.y - b.h * 0.15) * k}px;`;
        return html`<div class="ps-ed-item ps-ed-replaced ${sel}" data-id="${e.id}" style="${turnCss}min-width:${rb.width * k}px;height:${rb.height * 1.3 * k}px;font:${e.italic ? 'italic ' : ''}${e.bold ? '700 ' : ''}${e.size * k}px/${1.25} ${FAMILY_CSS[e.family]};color:${e.color}">${e.text || ' '}</div>`;
      }
      return '';
    };
    const replaced = new Set(edits().filter((e) => e.type === 'replace').map((e) => e.run));
    const runBoxes = tool === 'edit' && runs ? runs.filter((r) => !replaced.has(r.id)).map((r) => {
      const b = shownBox(r, inf.width, inf.height, t);
      // At least 16 px tall, so a finger can hit a line of small text (centred on the line).
      const hh = Math.max(16, b.h * k);
      return html`<button type="button" class="ps-ed-run ${r.editable ? '' : 'locked'}" data-run="${r.id}" style="left:${b.x * k}px;top:${b.y * k - (hh - b.h * k) / 2}px;width:${Math.max(8, b.w * k)}px;height:${hh}px" title="${r.editable ? `Change: ${r.text}` : 'This text is inside a drawing and cannot be changed here'}" aria-label="Change the text ${r.text}"></button>`;
    }) : '';
    mount(el, html`${bg}${edits().map(item)}${runBoxes}`);
    el.dataset.tool = tool;
    // Kept as you go (a reload or a closed tab keeps what was done), a moment after the last change.
    clearTimeout(saveTimer);
    saveTimer = setTimeout(onSave, 600);
  }

  // ----- The side panel: what is selected -----
  function side() {
    const box = shell.querySelector('#ed-side');
    const e = edits().find((x) => x.id === selected);
    const n = edits().length;
    const signed = edits().some((x) => x.type === 'image' && x.signature);
    if (!e) {
      box.oninput = null;
      box.onchange = null;
      mount(box, html`<h3>${icon('help', 16)} ${{ select: 'Select and move', edit: 'Change text', text: 'Add text', box: 'White-out', highlight: 'Highlight', check: 'Tick', cross: 'Cross', date: 'Date', sign: 'Signature' }[tool] || 'Edit'}</h3>
        <p class="muted small">${{
          select: 'Click something you added to change it; drag it to move it; drag its corner to resize. Delete removes it; the arrow keys nudge it.',
          edit: 'Click a line of text on the page to change it. The old words are taken out of the page and the new ones are written where they began, in the closest standard font.',
          text: 'Click on the page where the text begins, then type it here.',
          box: 'Drag over what to cover: a white box hides it. (The text underneath is still in the file: to take text out, use Change text.)',
          highlight: 'Drag over what to highlight.',
          check: 'Click where the tick goes.', cross: 'Click where the cross goes.', date: 'Click where today\'s date goes.',
          sign: pendingSig ? `Click on the page where the ${pendingSig.picture ? 'picture' : 'signature'} goes; then drag its corner to size it.` : 'Choose Signature to draw, type or upload it.',
        }[tool] || ''}</p>
        <p class="small"><strong>${n}</strong> change${n === 1 ? '' : 's'} on this page${signed ? ' · signed' : ''}.</p>
        ${n ? html`<button type="button" class="btn small-btn danger" id="ed-clear">${icon('trash', 14)} Remove all changes on this page</button>` : ''}`);
      box.querySelector('#ed-clear')?.addEventListener('click', () => {
        snapshot();
        page().edits = [];
        draw();
      });
      return;
    }
    const isText = e.type === 'text' || e.type === 'replace';
    mount(box, html`<h3>${{ text: 'Text', replace: 'Changed text', box: 'White-out', highlight: 'Highlight', image: e.signature ? 'Signature' : 'Picture', mark: 'Mark' }[e.type]}</h3>
      ${e.type === 'replace' ? html`<p class="muted small">Was: <q>${e.was || ''}</q></p>` : ''}
      ${isText ? html`
        <label class="field"><span>Text</span><textarea name="text" rows="4" maxlength="4000">${e.text}</textarea></label>
        <div class="grid two">
          <label class="field"><span>Size</span><input type="number" name="size" min="3" max="200" step="0.5" value="${e.size}" /></label>
          <label class="field"><span>Font</span><select name="family" title="Sans: Helvetica; Serif: Times; Fixed: Courier">${[['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Fixed']].map(([v, l]) => html`<option value="${v}" ${e.family === v ? 'selected' : ''}>${l}</option>`)}</select></label>
        </div>
        <div class="ps-ed-styles"><label class="check"><input type="checkbox" name="bold" ${e.bold ? 'checked' : ''} /><span><b>Bold</b></span></label><label class="check"><input type="checkbox" name="italic" ${e.italic ? 'checked' : ''} /><span><i>Italic</i></span></label></div>` : ''}
      ${e.type !== 'image' ? html`<div class="field"><span>Colour</span><div class="ps-ed-colors">${(e.type === 'highlight' ? ['#ffe066', '#a7f3d0', '#bfdbfe', '#fbcfe8'] : e.type === 'box' ? ['#ffffff', '#111111', '#f3f4f6'] : COLORS).map((c) => html`<label class="ps-ed-color" title="${c}"><input type="radio" name="color" value="${c}" ${e.color === c ? 'checked' : ''} /><i style="background:${c}"></i></label>`)}<input type="color" name="colorPick" value="${e.color}" aria-label="Another colour" /></div></div>` : ''}
      ${e.type === 'mark' ? html`<label class="field"><span>Kind</span><select name="kind">${[['check', 'Tick'], ['cross', 'Cross'], ['dot', 'Dot']].map(([v, l]) => html`<option value="${v}" ${e.kind === v ? 'selected' : ''}>${l}</option>`)}</select></label>` : ''}
      <button type="button" class="btn small-btn danger" id="ed-del">${icon('trash', 14)} ${e.type === 'replace' ? 'Undo this change' : 'Remove'}</button>`);
    // One undo step for all the typing while this is selected.
    let snapped = false;
    box.oninput = update;
    box.onchange = update;
    box.querySelector('#ed-del').addEventListener('click', () => remove(e.id));
    if (isText) box.querySelector('[name=text]').focus();
    function update(ev) {
      const f = ev.target;
      if (!f.name) return;
      if (!snapped) (snapshot(), (snapped = true));
      if (f.name === 'text') e.text = f.value;
      else if (f.name === 'size') e.size = Math.max(3, Math.min(200, Number(f.value) || e.size));
      else if (f.name === 'family') e.family = f.value;
      else if (f.name === 'bold' || f.name === 'italic') e[f.name] = f.checked;
      else if (f.name === 'color' || f.name === 'colorPick') e.color = f.value;
      else if (f.name === 'kind') e.kind = f.value;
      layout();
    }
  }
  function remove(id) {
    snapshot();
    page().edits = edits().filter((x) => x.id !== id);
    selected = null;
    layout();
    side();
  }

  // A line of the page's text to change (by pointer, or Enter / Space on its outline).
  function changeRun(runBtn) {
    const r = runs.find((x) => x.id === Number(runBtn.dataset.run));
    if (!r?.editable) return toast('This text is inside a drawing on the page and cannot be changed here. Cover it with White-out and add text instead.', 'error');
    snapshot();
    const e = { id: uid(), type: 'replace', run: r.id, was: r.text, text: r.text, size: Math.max(3, Math.min(200, Math.round(r.size * 10) / 10)), family: r.family, bold: r.bold, italic: r.italic, color: hex(r.color), box: { x: r.x, y: r.y, width: r.width, height: r.height } };
    edits().push(e);
    selected = e.id;
    layout();
    side();
  }
  shell.addEventListener('click', (ev) => {
    const runBtn = ev.detail === 0 && ev.target.closest?.('[data-run]');
    if (runBtn) changeRun(runBtn);
  });
  // ----- Pointer: place, select, move, resize -----
  const pointPt = (ev) => {
    const r = shell.querySelector('#ed-page').getBoundingClientRect();
    return { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale };
  };
  let drag = null;
  shell.addEventListener('pointerdown', (ev) => {
    const pageEl = shell.querySelector('#ed-page');
    if (!pageEl?.contains(ev.target)) return;
    const pt = pointPt(ev);
    const runBtn = ev.target.closest('[data-run]');
    if (runBtn) return changeRun(runBtn);
    const itemEl = ev.target.closest('[data-id]');
    if (itemEl && !(tool === 'sign' && pendingSig)) {
      const e = edits().find((x) => x.id === itemEl.dataset.id);
      selected = e.id;
      const grip = ev.target.closest('[data-grip]')?.dataset.grip;
      snapshot();
      drag = { e, grip, start: pt, orig: { ...e } };
      pageEl.setPointerCapture(ev.pointerId);
      layout();
      side();
      return;
    }
    if (tool === 'select' || tool === 'edit') {
      selected = null;
      layout();
      side();
      return;
    }
    snapshot();
    let e = null;
    if (tool === 'text') e = { type: 'text', x: pt.x, y: pt.y - 6, w: null, text: '', size: 12, family: 'sans', bold: false, italic: false, color: '#111111' };
    else if (tool === 'date') e = { type: 'text', x: pt.x, y: pt.y - 6, w: null, text: today(), size: 11, family: 'sans', bold: false, italic: false, color: '#111111' };
    else if (tool === 'check' || tool === 'cross') e = { type: 'mark', kind: tool, x: pt.x - 7, y: pt.y - 7, size: 14, color: tool === 'check' ? '#15803d' : '#b91c1c' };
    else if (tool === 'box' || tool === 'highlight') e = { type: tool, x: pt.x, y: pt.y, w: 1, h: 1, color: tool === 'box' ? '#ffffff' : '#ffe066', __new: true };
    else if (tool === 'sign' && pendingSig) {
      const w = pendingSig.picture ? Math.min(200, pendingSig.width * 0.75) : 150;
      const h = (w * pendingSig.height) / pendingSig.width;
      e = { type: 'image', x: pt.x - w / 2, y: pt.y - h / 2, w, h, data: pendingSig.data, signature: !pendingSig.picture };
      pendingSig = null;
      tool = 'select';
    }
    if (!e) return;
    // The mouse press that follows would move the focus to the page, away from the new text's box
    // (QA 0.65.1: the first words typed were lost).
    if (e.type === 'text') ev.preventDefault();
    e.id = uid();
    edits().push(e);
    selected = e.id;
    if (e.__new) {
      drag = { e, grip: 'wh', start: pt, orig: { ...e, w: 0, h: 0 }, fresh: true };
      pageEl.setPointerCapture(ev.pointerId);
    }
    if (tool === 'date' || tool === 'check' || tool === 'cross') tool = 'select';
    draw();
  });
  shell.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const pt = pointPt(ev);
    const dx = pt.x - drag.start.x;
    const dy = pt.y - drag.start.y;
    const { e, orig } = drag;
    if (!drag.grip) {
      e.x = orig.x + dx;
      e.y = orig.y + dy;
    } else if (drag.grip === 'wh') {
      e.x = dx < 0 ? orig.x + dx : orig.x;
      e.y = dy < 0 ? orig.y + dy : orig.y;
      e.w = Math.max(2, Math.abs(orig.w + dx));
      e.h = Math.max(2, Math.abs(orig.h + dy));
    } else if (drag.grip === 'ratio') {
      e.w = Math.max(10, orig.w + dx);
      e.h = (e.w * orig.h) / orig.w;
    } else if (drag.grip === 'w') e.w = Math.max(20, (orig.w || 200) + dx);
    else if (drag.grip === 'size') e.size = Math.max(6, orig.size + Math.max(dx, dy));
    if (e.type === 'replace') return;
    layout();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.fresh && drag.e.w < 3 && drag.e.h < 3) Object.assign(drag.e, { w: 120, h: 18 });
    delete drag.e.__new;
    drag = null;
    layout();
    side();
  };
  shell.addEventListener('pointerup', endDrag);
  shell.addEventListener('pointercancel', endDrag);

  // ----- Keys -----
  const onKey = (ev) => {
    if (!shell.isConnected) return;
    if ([...document.querySelectorAll('.modal-backdrop')].length) return; // a dialog on top
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (selected) {
        selected = null;
        layout();
        side();
      } else close();
      return;
    }
    if (typing) return;
    const e = edits().find((x) => x.id === selected);
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && e) {
      ev.preventDefault();
      remove(e.id);
    } else if (e && e.type !== 'replace' && ev.key.startsWith('Arrow')) {
      ev.preventDefault();
      const step = ev.shiftKey ? 10 : 1;
      if (ev.key === 'ArrowLeft') e.x -= step;
      if (ev.key === 'ArrowRight') e.x += step;
      if (ev.key === 'ArrowUp') e.y -= step;
      if (ev.key === 'ArrowDown') e.y += step;
      layout();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && undo.length) {
      ev.preventDefault();
      page().edits = JSON.parse(undo.pop());
      selected = null;
      draw();
    }
  };
  document.addEventListener('keydown', onKey);
  addEventListener('resize', layout);
  // Leaving the page (Back, a link) closes the editor (QA 0.65.1: it stayed on top).
  addEventListener('hashchange', close);
  draw();
  if (signNow) pick('sign');
  shell.querySelector('#ed-done').focus();
}

// A picture for the page, as PNG (or JPEG as it is), at most 1600 px wide.
async function pictureData(file) {
  const url = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('The picture could not be read.'));
    r.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('Your browser cannot open this picture.'));
    img.src = url;
  });
  // Under the server's 2 MB a picture (QA 0.65.1: a large PNG was taken here, then refused at
  // export): a photo as JPEG; a PNG as it is if small enough, else smaller, and as JPEG at the last.
  const LIMIT = 1.9 * 1024 * 1024;
  const bytes = (url) => Math.floor((url.length - url.indexOf(',') - 1) * 0.75);
  let s = Math.min(1, 1600 / img.naturalWidth);
  const jpeg = /jpe?g/i.test(file.type);
  for (let tries = 0; tries < 8; tries++) {
    const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(img.naturalWidth * s)), height: Math.max(1, Math.round(img.naturalHeight * s)) });
    const g = c.getContext('2d');
    if (jpeg || tries >= 4) {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
    }
    g.drawImage(img, 0, 0, c.width, c.height);
    const data = jpeg || tries >= 4 ? c.toDataURL('image/jpeg', 0.85) : c.toDataURL('image/png');
    if (bytes(data) <= LIMIT) return { data, width: c.width, height: c.height };
    s *= 0.75;
  }
  throw new Error('This picture is too large even made smaller. Choose a smaller one.');
}
