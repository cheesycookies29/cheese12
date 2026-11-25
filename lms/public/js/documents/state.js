// ATLAS Documents: what the pages share: the person's settings from the server (meta), and how a
// document, a folder, a classification or an access level is shown.
import { api } from '../api.js';
import { ctx } from '../shell.js';
import { html, badge, fmtSize, timeAgo } from '../ui.js';
import { icon } from '../icons.js';
import { sendInPieces } from './upload.js';

export const docs = {
  meta: null,
  async refresh() {
    docs.meta = await api.get('/api/docs/meta');
    return docs.meta;
  },
};
export const isStudent = () => ctx.user?.role === 'student';
export const isManager = () => Boolean(docs.meta?.manager);

// The icon of a kind of file (its family).
const FAMILY_ICON = { pdf: 'file', image: 'image', word: 'file', excel: 'table', powerpoint: 'slides', legacy: 'file', opendocument: 'file', rtf: 'file', text: 'file', email: 'mail', archive: 'box', audio: 'music', video: 'video', cad: 'layers' };
const FAMILY_TONE = { pdf: 'danger', image: 'ok', word: 'info', excel: 'ok', powerpoint: 'warn', email: 'info', text: '' };
export const docIcon = (d, size = 18) => html`<span class="item-ic doc-ic ${FAMILY_TONE[d.family] || ''}" aria-hidden="true">${icon(FAMILY_ICON[d.family] || 'file', size)}</span>`;
export const folderIcon = (f, size = 18) => html`<span class="item-ic doc-ic folder" aria-hidden="true">${icon(f?.personal && !f.parentId ? 'user' : 'folder', size)}</span>`;

export const CLASS_LABEL = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };
const CLASS_KIND = { public: 'green', internal: 'gray', confidential: 'amber', restricted: 'red' };
export const classBadge = (c, always = false) => (c === 'internal' && !always ? '' : badge(CLASS_LABEL[c] || c, CLASS_KIND[c] || ''));
export const STATUS_LABEL = { draft: 'Draft', final: 'Final', obsolete: 'Obsolete' };
export const LEVEL_LABEL = { view: 'Can view', edit: 'Can edit', manage: 'Can manage' };
export const MODE_LABEL = { view: 'View only', download: 'View and download', upload: 'Upload only' };
export const LINK_STATE = { active: ['Active', 'green'], used: ['Downloads used up', 'gray'], expired: ['Expired', 'gray'], revoked: ['Turned off', 'gray'], off: ['Links are off', 'amber'], creator: ['Its maker can no longer share it', 'amber'], gone: ['In the trash', 'gray'], classification: ['Not shareable by link', 'amber'], password: ['Needs a password now', 'amber'] };

// The small marks after a document's title: classification, checked out, legal hold, received.
export function docMarks(d) {
  return html`${classBadge(d.classification)}${d.status === 'final' ? badge('Final', 'blue') : d.status === 'obsolete' ? badge('Obsolete', 'gray') : ''}${d.checkout ? html` <span class="badge amber">${icon('lock', 12)} ${d.checkout.userId === ctx.user.id ? 'Checked out by you' : `Checked out: ${d.checkout.name}`}</span>` : ''}${d.legalHold ? html` ${badge('Legal hold', 'red')}` : ''}${!d.reviewed ? html` ${badge('Received, not reviewed', 'amber')}` : ''}`;
}

export const fileUrl = (d, { inline = false, v = null } = {}) => `/api/docs/documents/${encodeURIComponent(d.id)}/file${inline || v ? '?' : ''}${inline ? 'inline=1' : ''}${inline && v ? '&' : ''}${v ? `v=${v}` : ''}`;
export const when = (iso) => (iso ? timeAgo(iso) : '');
export { fmtSize };

// Adds `files` (a FileList) to a folder, or as new versions of a document, one after another, in
// pieces, each with its own line in `panel`: a bar while it goes, then what became of it (the
// server's reason when it was refused). Returns how many were added.
export async function uploadFiles(files, panel, { folderId = null, documentId = null, extra = {} } = {}) {
  const list = [...files];
  if (!list.length) return 0;
  const max = (docs.meta?.maxUploadMB || 50) * 1024 * 1024;
  panel.hidden = false;
  let ok = 0;
  for (const file of list) {
    const row = document.createElement('li');
    row.className = 'upload-row';
    row.innerHTML = String(html`<span class="upload-name">${icon('file', 16)} <strong>${file.name}</strong> <small class="muted">${fmtSize(file.size)}</small></span><span class="progress" role="progressbar" aria-label="${file.name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i style="width:0%"></i></span><span class="upload-state muted">Waiting…</span>`);
    panel.querySelector('ul').appendChild(row);
    const bar = row.querySelector('.progress');
    const state = row.querySelector('.upload-state');
    const done = (msg, kind) => {
      state.textContent = msg;
      state.className = `upload-state ${kind}`;
      row.classList.add(kind === 'bad' ? 'refused' : 'added');
    };
    if (file.size > max) {
      done(`Not added: larger than ${docs.meta.maxUploadMB} MB, the most accepted here.`, 'bad');
      continue;
    }
    if (!file.size) {
      done('Not added: the file is empty.', 'bad');
      continue;
    }
    try {
      state.textContent = 'Sending…';
      const r = await sendInPieces(file, {
        request: (m, u, b) => (m === 'GET' ? api.get(u) : m === 'POST' ? api.post(u, b) : m === 'PUT' ? api.put(u, b) : api.del(u)),
        base: '/api/docs/uploads',
        finish: documentId ? { documentId, ...extra } : { folderId, ...extra },
        onProgress: (p) => {
          bar.querySelector('i').style.width = `${Math.round(p * 100)}%`;
          bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
          if (p >= 1) state.textContent = 'Checking the file…';
        },
      });
      ok++;
      done(documentId ? `Added as version ${r.document.version}.` : `Added as ${r.document.number}.${r.duplicate ? ` The same file is already here as ${r.duplicate}.` : ''}`, r.duplicate ? 'warn' : 'ok');
    } catch (err) {
      done(`Not added: ${err.message}`, 'bad');
    }
  }
  return ok;
}

export const uploadPanel = () => html`<section class="card upload-panel" id="upload-panel" aria-live="polite" hidden><div class="card-head"><h2>${icon('upload')} Uploads</h2><button type="button" class="btn sm quiet" id="upload-clear">Clear</button></div><ul class="upload-list"></ul></section>`;
