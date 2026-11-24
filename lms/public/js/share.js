// The page a link from ATLAS Documents opens (/share/<token>), for someone outside the school: no
// ATLAS account, no session. It asks for the link's password when it has one, then shows the shared
// document or folder (view, or view and download), or, for an upload link, a form to send files in.
// Everything is checked again by the server on every request; this page only shows its answers.
import { html, mount, toast, fmtSize, fmtDateTime } from './ui.js';
import { icon, iconSvg } from './icons.js';
import { sendInPieces } from './documents/upload.js';

const el = document.getElementById('share');
const token = decodeURIComponent(location.pathname.split('/share/')[1] || '').replace(/\/$/, '');
const base = `/api/public/share/${encodeURIComponent(token)}`;

// The page's own requests (not ATLAS's api.js: a missing password is not a signed-out session).
async function request(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

// Dark mode, as everywhere in ATLAS.
const dark = () => document.documentElement.dataset.theme === 'dark';
const themeBtn = document.getElementById('theme-btn');
const drawTheme = () => {
  themeBtn.innerHTML = iconSvg(dark() ? 'sun' : 'moon');
  themeBtn.title = dark() ? 'Light mode' : 'Dark mode';
  document.getElementById('share-logo').src = `/img/brand/atlas-mark${dark() ? '-dark' : ''}.svg`;
};
themeBtn.addEventListener('click', () => {
  if (dark()) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = 'dark';
  try {
    localStorage.setItem('lms-theme', dark() ? 'dark' : 'light');
  } catch {}
  drawTheme();
});
drawTheme();
// The school's name and colours.
request('GET', '/api/hub/status').then(({ branding: b }) => {
  if (b?.brand) document.documentElement.style.setProperty('--brand', b.brand);
  if (b?.accent) document.documentElement.style.setProperty('--accent', b.accent);
  if (b?.schoolName) {
    document.getElementById('share-school').textContent = b.schoolName;
    document.title = `Shared documents · ${b.schoolName}`;
  }
}).catch(() => {});

const ICON = { pdf: 'file', jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', xlsx: 'table', csv: 'table', pptx: 'slides', mp4: 'video', mp3: 'music' };
const fileUrl = (d, inline) => `${base}/file?doc=${encodeURIComponent(d.id)}${inline ? '&inline=1' : ''}`;

function unavailable(message) {
  mount(el, html`<section class="card empty share-card">${icon('lock', 40)}<h2>This link is not available</h2><p>${message || 'It may have expired or been turned off.'} Ask the person who sent it for a new one.</p></section>`);
}

async function load() {
  let info;
  try {
    info = await request('GET', base);
  } catch (err) {
    if (err.status === 429) {
      mount(el, html`<section class="card empty share-card">${icon('clock', 40)}<h2>Please wait a moment</h2><p>${err.message}</p><p><button class="btn primary" type="button" id="again">Try again</button></p></section>`);
      return el.querySelector('#again').addEventListener('click', load);
    }
    if (err.status) return unavailable();
    return mount(el, html`<section class="card empty share-card">${icon('flag', 40)}<h2>Cannot reach the school's server</h2><p>Check your internet connection, then try again.</p></section>`);
  }
  if (info.needsPassword) return passwordView();
  if (info.mode === 'upload') return uploadView(info);
  return filesView(info);
}

function passwordView() {
  mount(el, html`<form class="card share-card stack tight" id="unlock" novalidate>
    <h2>${icon('lock')} This link has a password</h2>
    <p class="muted">The person who sent you the link should have given you its password separately.</p>
    <label class="field"><span>Password</span><div class="pw-wrap"><input type="password" name="password" autocomplete="off" required /><button type="button" class="link" id="show-pw">Show</button></div></label>
    <p class="form-error" hidden></p>
    <button class="btn primary block" type="submit">Open</button>
  </form>`);
  const form = el.querySelector('#unlock');
  const input = form.querySelector('input');
  input.focus();
  form.querySelector('#show-pw').addEventListener('click', (e) => {
    input.type = input.type === 'password' ? 'text' : 'password';
    e.target.textContent = input.type === 'password' ? 'Show' : 'Hide';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const err = form.querySelector('.form-error');
    btn.disabled = true;
    err.hidden = true;
    try {
      await request('POST', `${base}/unlock`, { password: input.value });
      load();
    } catch (x) {
      if (x.status === 404) return unavailable();
      err.textContent = x.message;
      err.hidden = false;
      btn.disabled = false;
      input.select();
    }
  });
}

function filesView(info) {
  const download = info.mode === 'download';
  const one = info.kind === 'document' && info.documents.length === 1;
  mount(el, html`
    <div class="page-head"><div><h1>${icon(info.kind === 'folder' ? 'folder' : 'file', 24)} ${info.name}</h1>
      <p class="muted">${download ? 'You can view and download' : 'You can view'} ${info.kind === 'folder' ? 'the files in this folder' : 'this document'} until ${fmtDateTime(info.expiresAt)}.${info.downloadsLeft != null ? ` Downloads left: ${info.downloadsLeft}.` : ''}</p>
      ${info.note ? html`<p class="share-note">“${info.note}”</p>` : ''}</div></div>
    ${info.documents.length ? html`<div class="card scroll-x"><table class="table doc-table share-files">
      <thead><tr><th>Name</th><th class="num">Size</th><th>Changed</th><th></th></tr></thead>
      <tbody>${info.documents.map((d) => html`<tr>
        <td><span class="doc-name"><span class="item-ic doc-ic" aria-hidden="true">${icon(ICON[d.ext] || 'file', 18)}</span><span><strong>${d.title}</strong><small>${d.name}</small></span></span></td>
        <td class="num" data-label="Size">${fmtSize(d.size)}</td>
        <td data-label="Changed">${fmtDateTime(d.updatedAt)}</td>
        <td class="row-actions">${d.inline ? html`<button type="button" class="btn sm" data-view="${d.id}">${icon('search', 14)} View</button>` : ''}${download ? html` <a class="btn sm primary" href="${fileUrl(d, false)}" download>${icon('download', 14)} Download</a>` : d.inline ? '' : html`<span class="muted small">Shown to you, not downloadable</span>`}</td>
      </tr>`)}</tbody></table></div>` : html`<div class="card empty">${icon('folder', 40)}<h2>Nothing to show</h2><p>The folder has no files that may be shared by link.</p></div>`}
    <section class="card share-preview" id="preview" hidden></section>`);
  const show = (id) => {
    const d = info.documents.find((x) => x.id === id);
    const box = el.querySelector('#preview');
    box.hidden = false;
    mount(box, /^(jpg|jpeg|png|gif|webp)$/.test(d.ext) ? html`<img src="${fileUrl(d, true)}" alt="${d.title}" />` : html`<iframe src="${fileUrl(d, true)}" title="${d.title}"></iframe>`);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  if (one && info.documents[0].inline) show(info.documents[0].id);
}

function uploadView(info) {
  const accepts = info.families.map((f) => f.label).join(', ');
  mount(el, html`
    <form class="card share-card stack tight" id="send" novalidate>
      <h2>${icon('upload')} Send files to “${info.folder}”</h2>
      ${info.note ? html`<p class="share-note">“${info.note}”</p>` : ''}
      <p class="muted small">Up to ${info.maxUploadMB} MB each. Accepted: ${accepts}. Programs, scripts, web pages and Office files with macros are never accepted. Until ${fmtDateTime(info.expiresAt)}.</p>
      <label class="field"><span>Your name</span><input name="name" autocomplete="name" maxlength="100" /></label>
      <label class="field"><span>Your e-mail (optional)</span><input name="email" type="email" autocomplete="email" maxlength="160" /></label>
      <label class="field"><span>Message (optional)</span><textarea name="message" maxlength="2000" rows="3"></textarea></label>
      <label class="field"><span>Files</span><input type="file" name="files" multiple required /></label>
      <button class="btn primary block" type="submit">${icon('upload', 16)} Send</button>
      <ul class="upload-list" id="sent" aria-live="polite"></ul>
    </form>`);
  const form = el.querySelector('#send');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const files = [...f.files.files];
    if (!files.length) return toast('Choose the files to send.', 'error');
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    const who = { name: f.name.value, email: f.email.value, message: f.message.value };
    let sent = 0;
    for (const file of files) {
      const row = document.createElement('li');
      row.className = 'upload-row';
      row.innerHTML = String(html`<span class="upload-name">${icon('file', 16)} <strong>${file.name}</strong> <small class="muted">${fmtSize(file.size)}</small></span><span class="progress" role="progressbar" aria-label="${file.name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i style="width:0%"></i></span><span class="upload-state muted">Sending…</span>`);
      form.querySelector('#sent').appendChild(row);
      const state = row.querySelector('.upload-state');
      const bar = row.querySelector('.progress');
      try {
        if (file.size > info.maxUploadMB * 1024 * 1024) throw new Error(`larger than ${info.maxUploadMB} MB, the most accepted.`);
        if (!file.size) throw new Error('the file is empty.');
        await sendInPieces(file, {
          request, base: `${base}/uploads`, finish: who,
          onProgress: (p) => {
            bar.querySelector('i').style.width = `${Math.round(p * 100)}%`;
            bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
            if (p >= 1) state.textContent = 'Checking the file…';
          },
        });
        sent++;
        state.textContent = 'Sent. Thank you.';
        state.className = 'upload-state ok';
        row.classList.add('added');
      } catch (err) {
        state.textContent = `Not sent: ${err.message}`;
        state.className = 'upload-state bad';
        row.classList.add('refused');
      }
    }
    f.files.value = '';
    btn.disabled = false;
    if (sent) toast(`${sent} file${sent === 1 ? '' : 's'} sent.`);
  });
}

if (!/^[A-Za-z0-9_-]{43}$/.test(token)) unavailable();
else load();
