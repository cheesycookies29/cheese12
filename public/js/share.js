// The page a link for someone outside the company opens (/share/<token>, 0.67): no account, no CORE
// menus. It shows what the link shares (view or download), or a drop zone for an upload link, after the
// link's password when it has one. Everything is checked again by the server on every request
// (server/documents.js): an expired, used-up or turned-off link is simply "not available".
import { api } from './api.js';
import { html, mount, toast } from './ui.js';
import { iconSvg, icon } from './icons.js';
import { applyBrand } from './state.js';
import { uploadInPieces, sizeText } from './chunked.js';

const el = document.getElementById('sh');
const token = (location.pathname.match(/^\/share\/([A-Za-z0-9_-]{43})\/?$/) || [])[1] || '';
const base = `/api/public/share/${encodeURIComponent(token)}`;
const MB = 1024 * 1024;
const day = (iso) => new Date(iso).toLocaleDateString('en-PH', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
const FAMILY_ICON = { pdf: 'filePdf', jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', xlsx: 'table', xls: 'table', csv: 'table', pptx: 'slides', ppt: 'slides', eml: 'mail', msg: 'mail', zip: 'box', mp3: 'music', wav: 'music', mp4: 'video', mov: 'video' };

// ----- Light or dark, and the company's colours and logo -----
const themeBtn = document.getElementById('sh-theme');
const isDark = () => document.documentElement.dataset.theme === 'dark';
const paintTheme = () => {
  themeBtn.innerHTML = iconSvg(isDark() ? 'sun' : 'moon');
  themeBtn.title = isDark() ? 'Light mode' : 'Dark mode';
  themeBtn.setAttribute('aria-label', themeBtn.title);
};
themeBtn.addEventListener('click', () => {
  if (isDark()) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = 'dark';
  try {
    localStorage.setItem('core-theme', isDark() ? 'dark' : 'light');
  } catch {}
  paintTheme();
});
paintTheme();
let company = '';
function setCompany(name) {
  company = name || company;
  document.getElementById('sh-company').textContent = company;
  mount(document.getElementById('sh-foot'), html`<p>${company ? `${company} · ` : ''}Shared securely with CORE · ERP by Lancaster. Files are checked and stored encrypted.</p>`);
}
api.get('/api/auth/status').then((st) => {
  if (st.brand) applyBrand(st.brand);
  if (st.brand?.logo) for (const id of ['sh-logo', 'sh-logo-dark']) document.getElementById(id).src = st.brand.logo;
  if (st.brand?.companyName) setCompany(st.brand.companyName);
}).catch(() => {});

const card = (body, cls = '') => html`<section class="sp-card sh-card ${cls}">${body}</section>`;
function unavailable(message) {
  document.title = 'Link not available';
  document.getElementById('sh-kind').textContent = 'Shared with you';
  mount(el, card(html`<div class="sh-calm"><span class="sh-calm-ic">${icon('link', 28)}</span>
    <h1>This link is not available</h1>
    <p class="sp-intro">${message || 'It may have expired, reached its limit or been turned off.'}</p>
    <p class="sp-intro">Ask the person who sent it to you for a new link.</p></div>`));
}

async function start() {
  if (!token) return unavailable();
  let info;
  try {
    info = await api.get(base);
  } catch (err) {
    return unavailable(err.status === 429 ? err.message : '');
  }
  setCompany(info.company);
  if (info.needsPassword) return passwordForm(info);
  if (info.mode === 'upload') return uploadPage(info);
  return filesPage(info);
}

// ----- A link with a password -----
function passwordForm(info) {
  document.title = 'Password needed';
  mount(el, card(html`
    <p class="sp-kicker">${info.kind === 'folder' ? 'A shared folder' : 'A shared document'}${company ? ` from ${company}` : ''}</p>
    <h1>Type the password</h1>
    <p class="sp-intro">The person who sent you this link protected it with a password. They should have sent it to you separately.</p>
    <form id="sh-pw" class="sh-pw" novalidate>
      <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required autofocus /></label>
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" class="btn primary sp-submit">Open</button>
    </form>
    <p class="muted small">The link works until ${day(info.expiresAt)}.</p>`));
  const form = el.querySelector('#sh-pw');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    err.hidden = true;
    if (!form.password.value) {
      err.textContent = 'Type the password.';
      err.hidden = false;
      return;
    }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await api.post(`${base}/unlock`, { password: form.password.value });
      start();
    } catch (ex) {
      if (ex.status === 404) return unavailable();
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
      form.password.select();
    }
  });
}

// ----- View and download links -----
function filesPage(info) {
  document.title = `${info.name}${company ? ` · ${company}` : ''}`;
  document.getElementById('sh-kind').textContent = info.kind === 'folder' ? 'Shared folder' : 'Shared document';
  let left = info.downloadsLeft;
  const download = info.mode === 'download';
  const draw = () => mount(el, card(html`
    <p class="sp-kicker">${info.kind === 'folder' ? 'Shared folder' : 'Shared document'}${company ? ` from ${company}` : ''}</p>
    <h1>${info.name}</h1>
    ${info.note ? html`<blockquote class="sh-note">${info.note}</blockquote>` : ''}
    <p class="sh-meta">${icon('clock', 14)} Works until ${day(info.expiresAt)}${download && left != null ? html` · <strong>${left}</strong> download${left === 1 ? '' : 's'} left` : ''}${download ? '' : ' · View only'}</p>
    ${info.documents.length ? html`<ul class="sh-docs">${info.documents.map((d) => html`<li>
      <span class="sh-ic">${icon(FAMILY_ICON[d.ext] || 'file', 20)}</span>
      <span class="grow"><strong>${d.title}</strong><small>${d.name} · ${sizeText(d.size)}</small></span>
      <span class="sh-acts">
        ${d.inline ? html`<a class="btn" href="${base}/file?doc=${encodeURIComponent(d.id)}&inline=1" target="_blank" rel="noopener">${icon('eye', 16)} View</a>` : ''}
        ${download && (left == null || left > 0) ? html`<a class="btn primary" href="${base}/file?doc=${encodeURIComponent(d.id)}" download data-dl>${icon('download', 16)} Download</a>` : ''}
        ${!download && !d.inline ? html`<span class="muted small">This kind of file cannot be shown in the browser; ask for a download link.</span>` : ''}
      </span></li>`)}</ul>` : html`<p class="sp-intro">There is nothing in this folder at the moment.</p>`}
    ${download && left === 0 ? html`<p class="notice">${icon('alert', 16)} This link has been used as many times as allowed. Ask the person who sent it for a new one.</p>` : ''}`));
  draw();
  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-dl]') || left == null) return;
    left = Math.max(0, left - 1);
    setTimeout(draw, 300);
  });
}

// ----- Upload links: a drop zone into a folder -----
function uploadPage(info) {
  document.title = `Send files${company ? ` to ${company}` : ''}`;
  document.getElementById('sh-kind').textContent = 'Send files';
  const exts = info.families.flatMap((f) => f.exts);
  const sent = [];
  mount(el, card(html`
    <p class="sp-kicker">Send files${company ? ` to ${company}` : ''}</p>
    <h1>${info.folder}</h1>
    <p class="sp-intro">Files you send here go straight into this folder. You will not see what else is in it. The link works until ${day(info.expiresAt)}.</p>
    <form id="sh-up" class="sh-up" novalidate>
      <div class="sp-grid">
        <label class="field"><span>Your name (optional)</span><input name="name" autocomplete="name" maxlength="100" /></label>
        <label class="field"><span>Your email (optional)</span><input name="email" type="email" autocomplete="email" maxlength="160" /></label>
      </div>
      <label class="field"><span>Message (optional)</span><textarea name="message" rows="3" maxlength="2000" placeholder="What the files are"></textarea></label>
      <div class="ps-drop sh-drop" id="sh-drop">
        <span class="ps-drop-ic">${icon('upload', 24)}</span>
        <div><span class="ps-drop-words"><strong>Drop files here</strong> or </span><label class="ps-pick">choose files<input type="file" id="sh-file" multiple class="sr-only" accept="${exts.map((x) => `.${x}`).join(',')}" /></label>
          <small>Accepted: ${info.families.map((f) => f.label).join(', ')}; up to ${info.maxUploadMB} MB each. Programs, scripts, web pages and files with macros are never accepted.</small></div>
      </div>
    </form>
    <ul class="sh-sent" id="sh-sent" aria-live="polite"></ul>`));
  const list = el.querySelector('#sh-sent');
  const form = el.querySelector('#sh-up');
  const paint = () => mount(list, html`${sent.map((q, i) => html`<li class="dm-q ${q.state}" data-i="${i}">
    <span class="dm-q-ic">${q.state === 'done' ? icon('checkCircle', 18) : q.state === 'refused' ? icon('alert', 18) : q.state === 'up' ? html`<span class="ps-spin"></span>` : icon('clock', 18)}</span>
    <span class="grow"><strong>${q.name}</strong> <span class="muted small">${sizeText(q.size)}</span>
      ${q.state === 'up' ? html`<progress max="1" value="${q.progress}" aria-label="Sent"></progress>` : ''}
      ${q.state === 'waiting' ? html`<small>Waiting…</small>` : ''}
      ${q.state === 'done' ? html`<small>Received. Thank you.</small>` : ''}
      ${q.state === 'refused' ? html`<small class="dm-refused">Not accepted: ${q.message}</small>` : ''}</span></li>`)}`);
  let busy = false;
  async function send(files) {
    for (const file of files) {
      const q = { file, name: file.name, size: file.size, state: 'waiting', progress: 0 };
      if (!file.size) Object.assign(q, { state: 'refused', message: 'The file is empty.' });
      else if (file.size > info.maxUploadMB * MB) Object.assign(q, { state: 'refused', message: `It is larger than ${info.maxUploadMB} MB, the most accepted here.` });
      sent.push(q);
    }
    paint();
    if (busy) return;
    busy = true;
    for (const q of sent) {
      if (q.state !== 'waiting') continue;
      q.state = 'up';
      paint();
      try {
        const id = await uploadInPieces(`${base}/uploads`, q.file, q.name, (p) => {
          q.progress = p;
          const bar = list.querySelector(`[data-i="${sent.indexOf(q)}"] progress`);
          if (bar) bar.value = p;
        });
        await api.post(`${base}/uploads/${id}/finish`, { name: form.name.value, email: form.email.value, message: form.message.value });
        q.state = 'done';
      } catch (err) {
        if (err.status === 404 && /not available/.test(err.message)) {
          busy = false;
          return unavailable();
        }
        Object.assign(q, { state: 'refused', message: err.message });
      }
      paint();
    }
    busy = false;
    const ok = sent.filter((q) => q.state === 'done').length;
    if (ok) toast(`${ok} file${ok === 1 ? '' : 's'} sent.`);
  }
  el.querySelector('#sh-file').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    send(files);
  });
  const drop = el.querySelector('#sh-drop');
  const fromComputer = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragover', (ev) => {
    if (!fromComputer(ev)) return;
    ev.preventDefault();
    drop.classList.add('over');
  });
  document.addEventListener('dragleave', (ev) => !ev.relatedTarget && drop.classList.remove('over'));
  document.addEventListener('drop', (ev) => {
    if (!fromComputer(ev)) return;
    ev.preventDefault();
    drop.classList.remove('over');
    send([...ev.dataTransfer.files]);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
}

start().catch((err) => unavailable(err.message));
