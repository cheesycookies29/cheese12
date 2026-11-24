// Document Management (MOD-08, 0.67): folders and documents, uploads in pieces, versions, check-out,
// sharing inside the company and links for people outside it. The rules are the server's
// (server/documents.js, docs/DOCUMENTS-PLAN.md); these screens explain them before someone runs into
// them, and show the server's own words when it refuses something (a program, a renamed file).
import { api } from '../api.js';
import { ctx } from '../state.js';
import { html, mount, toast, modal, confirmDialog, badge } from '../ui.js';
import { icon } from '../icons.js';
import { ROLES } from '/shared/roles.js';
import { uploadInPieces, sizeText } from '../chunked.js';
import { fmtDateTime, timeAgo, plural } from './admin/common.js';

const RANK = { none: 0, view: 1, edit: 2, manage: 3 };
const atLeast = (level, want) => (RANK[level] || 0) >= (RANK[want] || 0);
const MB = 1024 * 1024;
const LEVEL_LABEL = { view: 'Can view', edit: 'Can edit', manage: 'Can manage' };
const CLASS_BADGE = { public: 'green', internal: '', confidential: 'amber', restricted: 'red' };
const CLASS_LABEL = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };
const STATUS_LABEL = { draft: 'Draft', final: 'Final', obsolete: 'Obsolete' };
const MODE_LABEL = { view: 'View only', download: 'Download', upload: 'Upload' };
const LINK_STATE = { active: ['Working', 'green'], used: ['Download limit reached', 'amber'], expired: ['Expired', 'gray'], off: ['Links turned off', 'gray'], creator: ['Its maker can no longer share it', 'gray'], gone: ['In the trash', 'gray'], classification: ['Not allowed for this classification', 'gray'], revoked: ['Turned off', 'gray'] };
// An icon and a colour per kind of file (the family the server read from the content).
const FAMILY = {
  pdf: ['filePdf', 'PDF'], image: ['image', 'IMG'], word: ['file', 'DOC'], excel: ['table', 'XLS'], powerpoint: ['slides', 'PPT'], legacy: ['file', 'OLD'],
  opendocument: ['file', 'ODF'], rtf: ['file', 'RTF'], text: ['file', 'TXT'], email: ['mail', 'MAIL'], archive: ['box', 'ZIP'], audio: ['music', 'AUD'], video: ['video', 'VID'], cad: ['layers', 'CAD'],
};
const fileIcon = (family, size = 18) => html`<span class="dm-ic f-${family || 'other'}" aria-hidden="true">${icon(FAMILY[family]?.[0] || 'file', size)}</span>`;
const folderIcon = (f) => html`<span class="dm-ic f-folder" aria-hidden="true">${icon('folder', 18)}</span>`;
const classBadge = (c) => html`<span class="badge dm-cls ${CLASS_BADGE[c] || ''}" title="Classification">${CLASS_LABEL[c] || c}</span>`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const ymd = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const docHref = (d) => `#/documents/doc/${d.id}`;
const fileUrl = (d, { v = null, inline = false } = {}) => `/api/docs/documents/${encodeURIComponent(d.id)}/file${[v ? `v=${v}` : '', inline ? 'inline=1' : ''].filter(Boolean).length ? `?${[v ? `v=${v}` : '', inline ? 'inline=1' : ''].filter(Boolean).join('&')}` : ''}`;

// What the page needs to know (accepted types, limits, the sharing policy, people), fetched per page.
let META = null;
async function loadMeta() {
  META = await api.get('/api/docs/meta');
  return META;
}
const folderHref = (f) => (f.id === META?.personalRoot ? '#/documents' : `#/documents/folder/${f.id}`);

// ----- The folder tree -----
const open = new Set(); // folders unfolded in the tree, kept while the app is open
function treeOf(folders) {
  const kids = new Map();
  for (const f of folders) {
    if (!f.parentId || f.sharedRoot) continue;
    if (!kids.has(f.parentId)) kids.set(f.parentId, []);
    kids.get(f.parentId).push(f);
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const roots = folders.filter((f) => !f.parentId || f.sharedRoot);
  const mine = roots.find((f) => f.id === META.personalRoot);
  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true });
  return {
    kids,
    mine,
    company: roots.filter((f) => !f.personal).sort(byName),
    sharedPersonal: roots.filter((f) => f.personal && f.parentId).sort(byName),
    people: roots.filter((f) => f.personal && !f.parentId && f.id !== META.personalRoot).sort((a, b) => a.ownerName.localeCompare(b.ownerName)),
  };
}
function treePanel(folders, currentId, pathIds = []) {
  const t = treeOf(folders);
  for (const id of pathIds) open.add(id);
  const node = (f, label = f.name) => {
    const children = t.kids.get(f.id) || [];
    const isOpen = open.has(f.id);
    return html`<li>
      <div class="dm-node ${f.id === currentId ? 'on' : ''}">
        ${children.length ? html`<button type="button" class="dm-tog" data-tog="${f.id}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Fold' : 'Unfold'} ${f.name}">${icon(isOpen ? 'chevronDown' : 'chevronRight', 14)}</button>` : html`<span class="dm-tog-sp"></span>`}
        <a href="${folderHref(f)}" ${f.id === currentId ? 'aria-current="page"' : ''} title="${label}">${icon('folder', 16)}<span>${label}</span>${f.legalHold ? html`<span class="dm-hold-dot" title="Legal hold">${icon('lock', 12)}</span>` : ''}</a>
      </div>
      ${children.length && isOpen ? html`<ul>${children.map((c) => node(c))}</ul>` : ''}
    </li>`;
  };
  const used = META.usedBytes || 0;
  const pct = META.quotaMB ? Math.min(100, Math.round((used / (META.quotaMB * MB)) * 100)) : 0;
  return html`<details class="card dm-tree" id="dm-tree" open>
    <summary>${icon('folder', 16)} Folders</summary>
    <ul class="dm-tree-list">${t.mine ? node(t.mine, 'My files') : ''}</ul>
    <div class="dm-tree-head">Company folders ${META.manager ? html`<button type="button" class="icon-btn dm-tree-add" id="dm-new-top" title="New company folder" aria-label="New company folder">${icon('plus', 16)}</button>` : ''}</div>
    ${t.company.length ? html`<ul class="dm-tree-list">${t.company.map((f) => node(f))}</ul>` : html`<p class="muted small dm-tree-none">${META.manager ? 'None yet. Add one with +.' : 'None shared with you yet.'}</p>`}
    ${t.sharedPersonal.length ? html`<div class="dm-tree-head">Shared with me</div><ul class="dm-tree-list">${t.sharedPersonal.map((f) => node(f, `${f.name} (${f.ownerName})`))}</ul>` : ''}
    ${t.people.length ? html`<div class="dm-tree-head">People's files</div><ul class="dm-tree-list">${t.people.map((f) => node(f, f.ownerName))}</ul>` : ''}
    <div class="dm-quota">${META.quotaMB ? html`<div class="dm-meter" role="img" aria-label="${pct}% of your space used"><span style="width:${pct}%"></span></div><small>${sizeText(used)} of ${META.quotaMB.toLocaleString('en-PH')} MB used</small>` : html`<small>${sizeText(used)} used</small>`}</div>
  </details>`;
}
function wireTree(el, redraw) {
  el.querySelectorAll('[data-tog]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.tog;
    if (open.has(id)) open.delete(id);
    else open.add(id);
    redraw();
  }));
  // On a phone the tree starts folded (the breadcrumb and the list are enough).
  const tree = el.querySelector('#dm-tree');
  if (tree && matchMedia('(max-width: 960px)').matches && !tree.dataset.kept) tree.open = false;
  el.querySelector('#dm-new-top')?.addEventListener('click', () => newFolder(null, () => location.reload()));
}

// ----- New folder, rename, move -----
function newFolder(parentId, done) {
  modal({
    title: parentId ? 'New folder' : 'New company folder',
    subtitle: parentId ? 'Inside this folder. It starts with the same access as this folder.' : 'At the top level, for everyone you share it with. Only document managers add these.',
    body: html`<label class="field"><span>Name</span><input name="name" maxlength="120" required autocomplete="off" /></label>`,
    submitLabel: 'Add folder',
    onSubmit: async (f) => {
      const out = await api.post('/api/docs/folders', { name: f.name.value, parentId });
      toast(`Folder “${out.name}” added.`);
      done(out);
    },
  });
}
// A list of the folders someone may put things in (edit or manage), indented, for Move.
function folderOptions(folders, { except = null, current = null } = {}) {
  const t = treeOf(folders);
  const out = [];
  const walk = (f, depth, label = f.name) => {
    if (f.id === except) return;
    out.push({ f, depth, label, ok: atLeast(f.level, 'edit') && f.id !== current });
    for (const c of t.kids.get(f.id) || []) walk(c, depth + 1);
  };
  if (t.mine) walk(t.mine, 0, 'My files');
  for (const f of t.company) walk(f, 0);
  for (const f of t.sharedPersonal) walk(f, 0, `${f.name} (${f.ownerName})`);
  for (const f of t.people) walk(f, 0, `${f.ownerName}: My files`);
  return out;
}
async function moveDialog({ title, current, except = null, allowTop = false, onMove }) {
  const { folders } = await api.get('/api/docs/folders');
  const opts = folderOptions(folders, { except, current });
  modal({
    title,
    subtitle: 'Choose where it goes. You need edit access to the folder it goes into; it takes that folder’s access from then on.',
    body: html`<label class="field"><span>Move to</span><select name="to" required>
      <option value="">Choose a folder</option>
      ${allowTop ? html`<option value="__top">Top level (company folders)</option>` : ''}
      ${opts.map((o) => html`<option value="${o.f.id}" ${o.ok ? '' : 'disabled'}>${' '.repeat(o.depth)}${o.label}${o.f.id === current ? ' (here now)' : ''}</option>`)}
    </select></label>`,
    submitLabel: 'Move',
    onSubmit: async (f) => onMove(f.to.value === '__top' ? null : f.to.value),
  });
}

// ----- Uploading -----
// Each file goes up in pieces, one after the other, with its own row: progress, then the document,
// or the server's reason for refusing it (a program, a renamed file, a type turned off), or the note
// that the same content is already in the folder.
function uploadOptions(files) {
  return new Promise((resolve) => {
    let picked = null;
    const one = files.length === 1;
    const tooBig = files.filter((f) => f.size > META.maxUploadMB * MB);
    modal({
      title: one ? `Upload ${files[0].name}` : `Upload ${files.length} files`,
      subtitle: 'CORE reads what each file really is from its content, checks it against what the company accepts, and stores it encrypted.',
      body: html`
        ${one ? '' : html`<ul class="dm-up-names">${files.map((f) => html`<li>${f.name} <span class="muted">${sizeText(f.size)}</span></li>`)}</ul>`}
        ${tooBig.length ? html`<p class="notice bad small">${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} larger than ${META.maxUploadMB} MB, the most accepted here, and will be left out.</p>` : ''}
        ${one ? html`<label class="field"><span>Title</span><input name="title" maxlength="200" value="${files[0].name.replace(/\.[^.]+$/, '')}" /></label>` : ''}
        <div class="grid two">
          <label class="field"><span>Classification</span><select name="classification">${META.classifications.map((c) => html`<option value="${c.id}" ${c.id === 'internal' ? 'selected' : ''}>${c.label}</option>`)}</select>
            <small class="muted" id="dm-cls-help">${META.classifications.find((c) => c.id === 'internal')?.help}</small></label>
          <label class="field"><span>Tags (optional)</span><input name="tags" maxlength="300" placeholder="contract, 2026" /><small class="muted">Separate them with commas.</small></label>
        </div>`,
      submitLabel: one ? 'Upload' : `Upload ${files.length - tooBig.length} files`,
      onSubmit: async (f) => {
        picked = { title: one ? f.title.value : '', classification: f.classification.value, tags: f.tags.value };
      },
      onClose: () => resolve(picked),
    });
    const sel = document.querySelector('.modal select[name=classification]');
    sel?.addEventListener('change', () => (document.getElementById('dm-cls-help').textContent = META.classifications.find((c) => c.id === sel.value)?.help || ''));
  });
}
const queue = []; // { name, size, state: 'waiting'|'up'|'done'|'refused', progress, message, doc, duplicate }
function queueCard() {
  if (!queue.length) return '';
  const busy = queue.some((q) => q.state === 'waiting' || q.state === 'up');
  const row = (q, i) => html`<li class="dm-q ${q.state}" data-q="${i}">
    <span class="dm-q-ic">${q.state === 'done' ? icon('checkCircle', 18) : q.state === 'refused' ? icon('alert', 18) : q.state === 'up' ? html`<span class="ps-spin"></span>` : icon('clock', 18)}</span>
    <span class="grow"><strong>${q.name}</strong> <span class="muted small">${sizeText(q.size)}</span>
      ${q.state === 'up' ? html`<progress max="1" value="${q.progress}" aria-label="Uploaded"></progress>` : ''}
      ${q.state === 'waiting' ? html`<small>Waiting…</small>` : ''}
      ${q.state === 'done' ? html`<small>Added as <a href="${docHref(q.doc)}">${q.doc.number}</a>${q.doc.name !== q.name ? html` (kept as ${q.doc.name})` : ''}.</small>` : ''}
      ${q.duplicate ? html`<small class="dm-dup">${icon('alert', 12)} The same content is already in this folder as ${q.duplicate}.</small>` : ''}
      ${q.state === 'refused' ? html`<small class="dm-refused">Not accepted: ${q.message}</small>` : ''}
    </span></li>`;
  return html`<section class="card dm-queue" aria-live="polite" aria-labelledby="dm-q-h">
    <div class="card-head"><h2 id="dm-q-h">${icon('upload')} Uploads <span class="muted small">${queue.filter((q) => q.state === 'done').length} of ${plural(queue.length, 'file')} added</span></h2>
      ${busy ? '' : html`<button type="button" class="btn small-btn ghost" id="dm-q-clear">Clear</button>`}</div>
    <ul class="dm-q-list">${queue.map(row)}</ul></section>`;
}
async function uploadFiles(files, target, after) {
  const list = [...files].filter((f) => f && f.name);
  if (!list.length) return;
  const opts = await uploadOptions(list);
  if (!opts) return;
  const items = list.map((file) => ({ file, name: file.name, size: file.size, state: 'waiting', progress: 0 }));
  for (const q of items) {
    if (!q.size) Object.assign(q, { state: 'refused', message: `${q.name} is empty.` });
    else if (q.size > META.maxUploadMB * MB) Object.assign(q, { state: 'refused', message: `${q.name} is larger than ${META.maxUploadMB} MB, the most accepted here.` });
  }
  queue.splice(0, queue.length, ...queue.filter((q) => q.state === 'waiting' || q.state === 'up'), ...items);
  const paint = () => {
    const box = document.getElementById('dm-queue-box');
    if (box) mount(box, queueCard());
    box?.querySelector('#dm-q-clear')?.addEventListener('click', () => {
      queue.length = 0;
      mount(box, '');
    });
  };
  paint();
  for (const q of items) {
    if (q.state !== 'waiting') continue;
    q.state = 'up';
    paint();
    try {
      const id = await uploadInPieces('/api/docs/uploads', q.file, q.name, (p) => {
        q.progress = p;
        const bar = document.querySelector(`#dm-queue-box [data-q="${queue.indexOf(q)}"] progress`);
        if (bar) bar.value = p;
      });
      const body = target.documentId
        ? { documentId: target.documentId, note: target.note || '', checkin: Boolean(target.checkin) }
        : { folderId: target.folderId, title: list.length === 1 ? opts.title : '', classification: opts.classification, tags: opts.tags };
      const r = await api.post(`/api/docs/uploads/${id}/finish`, body);
      Object.assign(q, { state: 'done', doc: r.document, duplicate: r.duplicate });
    } catch (err) {
      Object.assign(q, { state: 'refused', message: err.message });
    }
    paint();
  }
  const ok = items.filter((q) => q.state === 'done').length;
  const no = items.length - ok;
  toast(no ? `${plural(ok, 'file')} added; ${no} not accepted (see Uploads).` : `${plural(ok, 'file')} added.`, no && !ok ? 'error' : 'ok');
  window.dispatchEvent(new Event('documents:changed'));
  after?.();
}
// Files from the computer can be let go anywhere on the page; the drop zone lights up.
function wireDrop(el, onFiles) {
  const fromComputer = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
  const zone = () => el.querySelector('#dm-drop');
  el.addEventListener('dragover', (ev) => {
    if (!fromComputer(ev) || !zone()) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    zone().classList.add('over');
  });
  el.addEventListener('dragleave', (ev) => {
    if (!el.contains(ev.relatedTarget)) zone()?.classList.remove('over');
  });
  el.addEventListener('drop', (ev) => {
    if (!fromComputer(ev) || !ev.dataTransfer.files?.length || !zone()) return;
    ev.preventDefault();
    zone().classList.remove('over');
    onFiles(ev.dataTransfer.files);
  });
}
const acceptedText = () => META.families.map((f) => f.label).join(', ');
const dropZone = () => html`<section class="card ps-drop dm-drop" id="dm-drop">
  <span class="ps-drop-ic">${icon('upload', 24)}</span>
  <div><span class="ps-drop-words"><strong>Drop files here</strong> or </span><label class="ps-pick">choose files<input type="file" id="dm-file" multiple class="sr-only" /></label>
    <small>Accepted: ${acceptedText()}; up to ${META.maxUploadMB} MB each. Programs, scripts, web pages and Office files with macros are never accepted.</small></div>
</section>`;

// ----- Lists -----
const VIEWS = {
  shared: ['Shared with me', 'Documents and folders other people shared with you, your department or your account type.', 'users'],
  recent: ['Recent', 'The documents you can open, most recently changed first.', 'clock'],
  received: ['Received', 'Files people outside the company sent through your upload links, waiting for you to review them.', 'inbox'],
  trash: ['Trash', '', 'trash'],
  search: ['Search', 'Titles, file names, tags, numbers and the words inside documents.', 'search'],
};
function docRow(d, { trash = false } = {}) {
  const badges = html`${classBadge(d.classification)}${d.status !== 'draft' ? html`<span class="badge ${d.status === 'final' ? 'green' : 'gray'}">${STATUS_LABEL[d.status]}</span>` : ''}${d.checkout ? html`<span class="badge blue" title="Checked out by ${d.checkout.name} until ${fmtDateTime(d.checkout.until)}">${icon('lock', 11)} ${d.checkout.userId === ctx.user.id ? 'Checked out by you' : `Checked out: ${d.checkout.name}`}</span>` : ''}${d.sharing?.links ? html`<span class="badge brand" title="Links for people outside the company">${icon('link', 11)} ${plural(d.sharing.links, 'link')}</span>` : ''}${d.sharing?.grants ? html`<span class="badge" title="Shared inside the company">${icon('users', 11)} Shared</span>` : ''}${d.legalHold ? html`<span class="badge red">${icon('lock', 11)} Legal hold</span>` : ''}${!d.reviewed ? html`<span class="badge amber">${icon('inbox', 11)} Received</span>` : ''}`;
  return html`<li class="dm-row">
    <a class="dm-main" href="${docHref(d)}">${fileIcon(d.family)}<span class="dm-name"><strong>${d.title}</strong><small><span class="mono">${d.number}</span> · ${d.name}</small><span class="dm-badges">${badges}</span></span></a>
    <span class="dm-col dm-ver" data-label="Version">v${d.version}</span>
    <span class="dm-col dm-size" data-label="Size">${sizeText(d.size)}</span>
    <span class="dm-col dm-when" data-label="${trash ? 'Deleted' : 'Updated'}" title="${fmtDateTime(trash ? d.trashedAt : d.updatedAt)}">${timeAgo(trash ? d.trashedAt : d.updatedAt)}</span>
    <span class="dm-col dm-owner" data-label="Owner">${d.ownerName}</span>
    ${trash ? html`<span class="dm-col dm-acts"><button type="button" class="btn small-btn" data-restore-doc="${d.id}">${icon('undo', 14)} Restore</button><button type="button" class="btn small-btn danger ghost" data-purge="${d.id}" ${d.legalHold ? 'disabled title="On legal hold"' : ''}>Delete for good</button></span>` : ''}
  </li>`;
}
function folderRow(f, { trash = false } = {}) {
  const inner = html`${folderIcon(f)}<span class="dm-name"><strong>${f.id === META.personalRoot ? 'My files' : f.name}</strong><small>${f.personal ? (f.ownerId === ctx.user.id ? 'In My files' : `${f.ownerName}’s files`) : `Folder · ${f.ownerName}`}</small>
    <span class="dm-badges">${f.acl?.length ? html`<span class="badge">${icon('users', 11)} Shared</span>` : ''}${f.links?.length ? html`<span class="badge brand">${icon('link', 11)} ${plural(f.links.length, 'link')}</span>` : ''}${f.legalHold ? html`<span class="badge red">${icon('lock', 11)} Legal hold</span>` : ''}</span></span>`;
  return html`<li class="dm-row dm-folder-row">
    ${trash ? html`<span class="dm-main">${inner}</span>` : html`<a class="dm-main" href="${folderHref(f)}">${inner}</a>`}
    <span class="dm-col dm-ver"></span><span class="dm-col dm-size"></span>
    <span class="dm-col dm-when" data-label="${trash ? 'Deleted' : ''}">${trash ? timeAgo(f.trashedAt) : ''}</span>
    <span class="dm-col dm-owner" data-label="Owner">${f.ownerName}</span>
    ${trash ? html`<span class="dm-col dm-acts"><button type="button" class="btn small-btn" data-restore-folder="${f.id}">${icon('undo', 14)} Restore</button></span>` : ''}
  </li>`;
}
function listCard(folders, docs, { trash = false, empty }) {
  if (!folders.length && !docs.length) return html`<section class="card empty dm-empty">${empty}</section>`;
  return html`<section class="card dm-list-card">
    <div class="dm-list-head" aria-hidden="true"><span>Name</span><span>Version</span><span>Size</span><span>${trash ? 'Deleted' : 'Updated'}</span><span>Owner</span>${trash ? html`<span></span>` : ''}</div>
    <ul class="dm-list ${trash ? 'trash' : ''}">${folders.map((f) => folderRow(f, { trash }))}${docs.map((d) => docRow(d, { trash }))}</ul>
  </section>`;
}

async function browse(el, { view, folderId = null }, q = {}) {
  let redraw;
  wireDrop(el, (files) => state.canUpload && uploadFiles(files, { folderId: state.list.folderId }, () => redraw()));
  const state = { list: null, folders: [], canUpload: false };
  redraw = async () => {
    const qs = new URLSearchParams({ view });
    if (view === 'folder' && folderId) qs.set('folder', folderId);
    if (q.q) qs.set('q', q.q);
    if (q.classification) qs.set('classification', q.classification);
    if (q.tag) qs.set('tag', q.tag);
    const [list, tree] = await Promise.all([api.get(`/api/docs/list?${qs}`), api.get('/api/docs/folders'), loadMeta()]);
    if (!el.isConnected) return;
    state.list = list;
    state.folders = tree.folders;
    draw();
  };
  const here = () => (view === 'folder' ? state.folders.find((f) => f.id === state.list.folderId) : null);
  const routeBase = () => (view === 'folder' ? (state.list.folderId === META.personalRoot ? '#/documents' : `#/documents/folder/${state.list.folderId}`) : `#/documents/${view}`);
  function draw() {
    const { list } = state;
    const f = here();
    const isRoot = f && f.id === META.personalRoot;
    state.canUpload = view === 'folder' && atLeast(list.level, 'edit');
    let folders = list.folders;
    if (view === 'shared') folders = state.folders.filter((x) => (x.sharedRoot || (!x.parentId && !x.personal)) && !(x.personal && x.ownerId === ctx.user.id));
    const tags = [...new Set(list.documents.flatMap((d) => d.tags || []))].sort();
    if (q.tag && !tags.includes(q.tag)) tags.unshift(q.tag);
    const [title, sub, ic] = view === 'folder' ? [isRoot ? 'My files' : f?.name || 'Folder', isRoot ? 'Yours only, until you share a document or a folder inside it.' : '', 'folder'] : VIEWS[view];
    const filtered = q.classification || q.tag;
    const empty = view === 'folder'
      ? html`${icon('folder', 40)}<h2>${filtered ? 'Nothing matches these filters' : isRoot ? 'Your files start here' : 'This folder is empty'}</h2><p>${filtered ? 'Clear the filters to see everything in this folder.' : state.canUpload ? 'Drop files on this page, or click Upload. Add folders to keep things in order.' : 'Nothing has been added here yet.'}</p>`
      : view === 'shared' ? html`${icon('users', 40)}<h2>Nothing is shared with you yet</h2><p>When someone shares a document or a folder with you, your department or your account type, it shows here.</p>`
      : view === 'recent' ? html`${icon('clock', 40)}<h2>Nothing yet</h2><p>Documents you can open show here when they are added or changed.</p>`
      : view === 'received' ? html`${icon('inbox', 40)}<h2>No files waiting for review</h2><p>To collect files from someone outside the company, open a folder, click <strong>Share</strong> and make an <strong>Upload</strong> link. What they send shows here until you mark it reviewed.</p>`
      : view === 'trash' ? html`${icon('trash', 40)}<h2>The trash is empty</h2><p>Deleted documents and folders stay here for ${plural(META.trashDays, 'day')}, then they are deleted for good.</p>`
      : html`${icon('search', 40)}<h2>${q.q ? `Nothing matches “${q.q}”` : 'Search your documents'}</h2><p>Search looks in titles, file names, tags, numbers and the words inside PDFs, Word, Excel, PowerPoint and text files you can open.</p>`;
    mount(el, html`
      <div class="dm-page">
        <aside class="dm-side">${treePanel(state.folders, view === 'folder' ? list.folderId : null, list.path.map((p) => p.id))}</aside>
        <div class="dm-main-col">
          ${view === 'folder' && list.path.length > 1 ? html`<nav class="crumbs" aria-label="Folders">${list.path.map((p, i) => (i < list.path.length - 1 ? html`<a href="${p.id === META.personalRoot ? '#/documents' : `#/documents/folder/${p.id}`}">${p.id === META.personalRoot ? 'My files' : p.name}</a><span aria-hidden="true">›</span>` : html`<span class="cur">${p.name}</span>`))}</nav>` : ''}
          <header class="page-head">
            <div><h1>${icon(ic, 22)} ${view === 'search' && q.q ? `Search: “${q.q}”` : title}${f?.legalHold ? html` <span class="badge red">${icon('lock', 12)} Legal hold</span>` : ''}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>
            <div class="actions">
              ${view === 'folder' && f && !isRoot && f.level === 'manage' ? html`<button type="button" class="btn" id="dm-f-share">${icon('users', 16)} Share</button><button type="button" class="btn" id="dm-f-more" aria-haspopup="menu">${icon('more', 16)} Folder</button>` : ''}
              ${view === 'shared' && META.manager ? html`<button type="button" class="btn" id="dm-new-company">${icon('plus', 16)} Company folder</button>` : ''}
              ${view === 'folder' && atLeast(list.level, 'edit') ? html`<button type="button" class="btn" id="dm-new-folder">${icon('plus', 16)} New folder</button>` : ''}
              ${state.canUpload ? html`<label class="btn primary">${icon('upload', 16)} Upload<input type="file" id="dm-file-btn" multiple class="sr-only" /></label>` : ''}
            </div>
          </header>
          ${view === 'folder' && f && !isRoot ? folderInfo(f) : ''}
          ${view === 'received' && list.documents.length ? html`<div class="notice info">${icon('inbox')}<p>These files came from outside the company. CORE checked what each one is and refused programs and other risky files, but read them with care. Open each one and click <strong>Mark reviewed</strong> when it is fine; until then only you (and document managers) see it here.</p></div>` : ''}
          ${view === 'trash' ? html`<div class="notice">${icon('trash')}<p>Deleted documents and folders stay here for <strong>${plural(META.trashDays, 'day')}</strong>, then they are deleted for good. Restore puts them back where they were (or in My files if that folder is gone). Documents on legal hold are never deleted.</p></div>` : ''}
          <div class="toolbar dm-toolbar">
            <input type="search" id="dm-q" placeholder="Search titles, tags, numbers and text…" aria-label="Search documents" value="${q.q || ''}" />
            <select id="dm-cls" aria-label="Classification"><option value="">Any classification</option>${META.classifications.map((c) => html`<option value="${c.id}" ${q.classification === c.id ? 'selected' : ''}>${c.label}</option>`)}</select>
            <select id="dm-tag" aria-label="Tag"><option value="">Any tag</option>${tags.map((t) => html`<option ${q.tag === t ? 'selected' : ''}>${t}</option>`)}</select>
          </div>
          ${state.canUpload ? dropZone() : ''}
          <div id="dm-queue-box">${queueCard()}</div>
          ${listCard(folders, list.documents, { trash: view === 'trash', empty })}
          ${view === 'recent' && list.documents.length >= 50 ? html`<p class="muted small page-note">The 50 most recent are shown. Search to find older ones.</p>` : ''}
        </div>
      </div>`);
    wire();
  }
  function wire() {
    wireTree(el, draw);
    const go = (extra) => {
      const p = new URLSearchParams(Object.entries({ ...q, ...extra }).filter(([, v]) => v));
      if (view !== 'search') p.delete('q');
      location.hash = `${routeBase()}${p.toString() ? `?${p}` : ''}`;
    };
    const search = el.querySelector('#dm-q');
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = search.value.trim();
      if (v) location.hash = `#/documents/search?q=${encodeURIComponent(v)}${q.classification ? `&classification=${q.classification}` : ''}`;
      else if (view === 'search') location.hash = '#/documents';
    });
    el.querySelector('#dm-cls').addEventListener('change', (e) => go({ classification: e.target.value }));
    el.querySelector('#dm-tag').addEventListener('change', (e) => go({ tag: e.target.value }));
    for (const id of ['#dm-file', '#dm-file-btn']) {
      el.querySelector(id)?.addEventListener('change', (e) => {
        const files = [...e.target.files];
        e.target.value = '';
        uploadFiles(files, { folderId: state.list.folderId }, redraw);
      });
    }
    el.querySelector('#dm-q-clear')?.addEventListener('click', () => {
      queue.length = 0;
      mount(el.querySelector('#dm-queue-box'), '');
    });
    el.querySelector('#dm-new-folder')?.addEventListener('click', () => newFolder(state.list.folderId, () => redraw()));
    el.querySelector('#dm-new-company')?.addEventListener('click', () => newFolder(null, () => redraw()));
    const f = here();
    el.querySelector('#dm-f-share')?.addEventListener('click', () => openShare('folder', f, redraw));
    el.querySelector('#dm-f-more')?.addEventListener('click', (e) => folderMenu(e.currentTarget, f, redraw));
    el.querySelector('#dm-f-info-share')?.addEventListener('click', () => openShare('folder', f, redraw));
    // Trash: restore and delete for good.
    el.querySelectorAll('[data-restore-doc]').forEach((b) => b.addEventListener('click', () => act(() => api.post('/api/docs/restore', { documentId: b.dataset.restoreDoc }), 'Restored.')));
    el.querySelectorAll('[data-restore-folder]').forEach((b) => b.addEventListener('click', () => act(() => api.post('/api/docs/restore', { folderId: b.dataset.restoreFolder }), 'Folder restored.')));
    el.querySelectorAll('[data-purge]').forEach((b) => b.addEventListener('click', async () => {
      const d = state.list.documents.find((x) => x.id === b.dataset.purge);
      if (!(await confirmDialog(`Delete ${d.number} “${d.title}” for good? All ${plural(d.versions, 'version')} and its links go, and it cannot be brought back.`, { confirmLabel: 'Delete for good', title: 'Delete for good' }))) return;
      act(() => api.del(`/api/docs/documents/${d.id}/purge`), 'Deleted for good.');
    }));
  }
  async function act(fn, done) {
    try {
      await fn();
      toast(done);
      window.dispatchEvent(new Event('documents:changed'));
      redraw();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  await redraw();
}

// A folder's own line: who owns it, who it is shared with, its links, whether it inherits.
function folderInfo(f) {
  const bits = [`Owner: ${f.ownerName}`, LEVEL_LABEL[f.level] ? `You: ${LEVEL_LABEL[f.level].toLowerCase()}` : ''];
  return html`<div class="dm-finfo">
    <span>${bits.filter(Boolean).join(' · ')}</span>
    ${f.level === 'manage' ? html`<span>${f.acl?.length ? `Shared with ${f.acl.map((g) => g.label).slice(0, 3).join(', ')}${f.acl.length > 3 ? ` and ${f.acl.length - 3} more` : ''}` : 'Not shared with anyone else'}${f.inherit ? ' · takes the access of the folders above' : ' · does not take the access of the folders above'}${f.links?.length ? ` · ${plural(f.links.length, 'link')} outside the company` : ''}</span>
      <button type="button" class="link" id="dm-f-info-share">Manage access</button>` : ''}
  </div>`;
}
// The folder's menu: rename, move, legal hold, delete.
function folderMenu(btn, f, redraw) {
  document.querySelector('.dm-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'menu-pop dm-pop';
  pop.setAttribute('role', 'menu');
  mount(pop, html`
    <button type="button" role="menuitem" data-a="rename">${icon('edit')} Rename</button>
    <button type="button" role="menuitem" data-a="move">${icon('folder')} Move</button>
    ${META.manager ? html`<button type="button" role="menuitem" data-a="hold">${icon('lock')} ${f.legalHold ? 'Lift legal hold' : 'Place legal hold'}</button>` : ''}
    <button type="button" role="menuitem" data-a="delete" class="danger-item">${icon('trash')} Delete folder</button>`);
  btn.parentElement.style.position = 'relative';
  btn.parentElement.appendChild(pop);
  pop.querySelector('button')?.focus();
  const close = () => {
    pop.remove();
    document.removeEventListener('click', outside, true);
  };
  const outside = (e) => !pop.contains(e.target) && e.target !== btn && close();
  setTimeout(() => document.addEventListener('click', outside, true));
  pop.addEventListener('keydown', (e) => e.key === 'Escape' && (close(), btn.focus()));
  pop.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    close();
    if (a === 'rename') {
      modal({
        title: 'Rename folder', body: html`<label class="field"><span>Name</span><input name="name" maxlength="120" value="${f.name}" required /></label>`, submitLabel: 'Rename',
        onSubmit: async (form) => {
          await patchFolder(f.id, { name: form.name.value });
          toast('Folder renamed.');
          redraw();
        },
      });
    } else if (a === 'move') {
      moveDialog({ title: `Move “${f.name}”`, current: f.parentId, except: f.id, allowTop: META.manager, onMove: async (to) => {
        await patchFolder(f.id, { parentId: to });
        toast('Folder moved.');
        redraw();
      } });
    } else if (a === 'hold') {
      try {
        await patchFolder(f.id, { legalHold: !f.legalHold });
        toast(f.legalHold ? 'Legal hold lifted.' : 'Legal hold placed: nothing in this folder can be deleted until it is lifted.');
        redraw();
      } catch (err) {
        toast(err.message, 'error');
      }
    } else if (a === 'delete') {
      if (!(await confirmDialog(`Move the folder “${f.name}” and everything in it to the trash? It stays there for ${plural(META.trashDays, 'day')} and can be restored until then. Its links stop working.`, { confirmLabel: 'Move to trash', title: 'Delete folder' }))) return;
      try {
        await api.del(`/api/docs/folders/${f.id}`);
        toast('Folder moved to the trash.');
        location.hash = f.parentId && f.parentId !== META.personalRoot ? `#/documents/folder/${f.parentId}` : f.personal ? '#/documents' : '#/documents/shared';
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
}
const patchFolder = (id, body) => api.patch(`/api/docs/folders/${id}`, body);
const patch = (url, body) => api.patch(url, body);

export const myFilesView = (el, params, q) => browse(el, { view: 'folder' }, q);
export const folderView = (el, params, q) => browse(el, { view: 'folder', folderId: params.id }, q);
export const sharedDocsView = (el, params, q) => browse(el, { view: 'shared' }, q);
export const recentDocsView = (el, params, q) => browse(el, { view: 'recent' }, q);
export const receivedDocsView = (el, params, q) => browse(el, { view: 'received' }, q);
export const trashDocsView = (el, params, q) => browse(el, { view: 'trash' }, q);
export const searchDocsView = (el, params, q) => browse(el, { view: 'search' }, q);
// The side menu's count of files received through upload links and not reviewed yet.
export const receivedCount = () => api.get('/api/docs/list?view=received').then((r) => r.documents.length);

// ----- One document -----
const EVENT = {
  upload: ['upload', 'uploaded it'], version: ['upload', 'added a version'], view: ['eye', 'viewed it'], download: ['download', 'downloaded it'], change: ['edit', 'changed it'],
  access: ['users', 'changed who has access'], checkout: ['lock', 'checked it out'], checkin: ['check', 'checked it in'], trash: ['trash', 'moved it to the trash'],
  restore: ['undo', 'restored it'], hold: ['lock', 'placed a legal hold'], unhold: ['lock', 'lifted the legal hold'], link: ['link', 'made a link for outside the company'],
  'link-opens': ['external', 'opened the link'], 'link-views': ['eye', 'viewed it through a link'], 'link-downloads': ['download', 'downloaded it through a link'], 'link-uploads': ['upload', 'sent it through an upload link'],
};
export async function documentView(el, params) {
  await loadMeta();
  let d = await api.get(`/api/docs/documents/${encodeURIComponent(params.id)}`);
  wireDrop(el, (files) => canEdit() && !lockedByOther() && newVersion(files[0]));
  const canEdit = () => atLeast(d.level, 'edit') && !d.trashedAt;
  const manage = () => d.level === 'manage';
  const mineOut = () => d.checkout && d.checkout.userId === ctx.user.id;
  const lockedByOther = () => d.checkout && d.checkout.userId !== ctx.user.id;
  // A file sent in through an upload link has no upload event of its own (the link's is on the folder):
  // its arrival is shown from its first version.
  const events = () => (d.source === 'link-upload' && !d.events.some((e) => e.action === 'link-uploads')
    ? [...d.events, { action: 'link-uploads', by: 'link:', byName: d.sender?.name || 'Someone with a link', at: d.createdAt, note: d.versionList[d.versionList.length - 1]?.name || '' }]
    : d.events);
  const reload = async () => {
    d = await api.get(`/api/docs/documents/${encodeURIComponent(params.id)}`);
    if (el.isConnected) draw();
  };

  function draw() {
    const folder = d.path[d.path.length - 1];
    const back = folder ? (folder.id === META.personalRoot ? '#/documents' : `#/documents/folder/${folder.id}`) : '#/documents/shared';
    const editing = canEdit();
    mount(el, html`
      <nav class="crumbs" aria-label="Folders">${d.path.length ? d.path.map((p) => html`<a href="${p.id === META.personalRoot ? '#/documents' : `#/documents/folder/${p.id}`}">${p.id === META.personalRoot ? 'My files' : p.name}</a><span aria-hidden="true">›</span>`) : html`<a href="#/documents/shared">Shared with me</a><span aria-hidden="true">›</span>`}<span class="cur">${d.number}</span></nav>
      <header class="page-head dm-doc-head">
        <div class="dm-doc-title">${fileIcon(d.family, 24)}<div><h1>${d.title}</h1>
          <p class="dm-doc-sub"><span class="mono">${d.number}</span> · ${d.name} · ${sizeText(d.size)} · version ${d.version} of ${d.versions}</p>
          <p class="dm-badges">${classBadge(d.classification)}<span class="badge ${d.status === 'final' ? 'green' : 'gray'}">${STATUS_LABEL[d.status]}</span>${d.legalHold ? html`<span class="badge red">${icon('lock', 11)} Legal hold</span>` : ''}${d.trashedAt ? html`<span class="badge red">${icon('trash', 11)} In the trash</span>` : ''}${!d.reviewed ? html`<span class="badge amber">${icon('inbox', 11)} Received, not reviewed</span>` : ''}</p></div></div>
        <div class="actions dm-doc-actions">
          ${d.inline ? html`<a class="btn" href="${fileUrl(d, { inline: true })}" target="_blank" rel="noopener">${icon('eye', 16)} View</a>` : ''}
          ${d.canDownload ? html`<a class="btn ${d.inline ? '' : 'primary'}" href="${fileUrl(d)}" download>${icon('download', 16)} Download</a>` : ''}
          ${editing ? html`<button type="button" class="btn" id="dm-version" ${lockedByOther() ? `disabled title="${d.checkout.name} has it checked out"` : ''}>${icon('upload', 16)} New version</button>` : ''}
          ${editing ? (d.checkout ? (mineOut() || manage() ? html`<button type="button" class="btn" id="dm-checkin">${icon('check', 16)} Check in</button>` : '') : html`<button type="button" class="btn" id="dm-checkout">${icon('lock', 16)} Check out</button>`) : ''}
          ${!d.trashedAt && (d.canShare || manage()) ? html`<button type="button" class="btn" id="dm-share">${icon('users', 16)} Share</button>` : ''}
          ${!d.trashedAt && (manage() || ctx.user && META.manager) ? html`<button type="button" class="btn" id="dm-more" aria-haspopup="menu">${icon('more', 16)} More</button>` : ''}
        </div>
      </header>
      ${!d.canDownload && !d.trashedAt ? html`<div class="notice info">${icon('eye')}<p>${d.classification === 'restricted' ? 'Restricted documents are downloaded only by the people who manage them.' : 'You can view this document but not download it.'}${d.inline ? ' Click View to read it in your browser.' : ''}</p></div>` : ''}
      ${d.trashedAt ? html`<div class="notice bad">${icon('trash')}<p>Moved to the trash ${fmtDateTime(d.trashedAt)}. It is deleted for good ${plural(META.trashDays, 'day')} after that, unless you restore it.</p>
        <span class="actions"><button type="button" class="btn small-btn" id="dm-restore">${icon('undo', 14)} Restore</button><button type="button" class="btn small-btn danger" id="dm-purge" ${d.legalHold ? 'disabled' : ''}>Delete for good</button></span></div>` : ''}
      ${d.source === 'link-upload' && !d.reviewed ? html`<div class="notice dm-received">${icon('inbox')}<div><p><strong>Received through a link${d.sender?.name ? html` from ${d.sender.name}` : ''}</strong>${d.sender?.email ? html` (${d.sender.email})` : ''}. Someone outside the company sent this file through an upload link. CORE checked what kind of file it is; open it with care, then mark it reviewed.</p>
        ${d.description ? html`<p class="dm-msg">“${d.description}”</p>` : ''}</div>${editing ? html`<button type="button" class="btn small-btn primary" id="dm-reviewed">${icon('check', 14)} Mark reviewed</button>` : ''}</div>` : ''}
      ${d.checkout ? html`<div class="notice info">${icon('lock')}<p>${mineOut() ? html`<strong>You have it checked out</strong> until ${fmtDateTime(d.checkout.until)}. Others can open it but not add versions; check it in when you are done (or upload your new version with “check in after upload”).` : html`<strong>${d.checkout.name}</strong> has it checked out until ${fmtDateTime(d.checkout.until)}, so no one else adds versions until they check it in.${manage() ? ' As a manager of the document you can check it in for them.' : ''}`}</p></div>` : ''}
      <div class="cols wide-left dm-doc-cols">
        <div class="stack">
          <section class="card" aria-labelledby="dm-det-h">
            <div class="card-head"><h2 id="dm-det-h">${icon('file')} Details</h2></div>
            ${editing ? html`<form id="dm-details" class="grid two" novalidate>
              <label class="field span-2"><span>Title</span><input name="title" maxlength="200" value="${d.title}" required /></label>
              <label class="field"><span>Status</span><select name="status">${Object.entries(STATUS_LABEL).map(([k, v]) => html`<option value="${k}" ${d.status === k ? 'selected' : ''}>${v}</option>`)}</select></label>
              <label class="field"><span>Classification</span>${manage() ? html`<select name="classification">${META.classifications.map((c) => html`<option value="${c.id}" ${d.classification === c.id ? 'selected' : ''}>${c.label}</option>`)}</select>` : html`<input value="${CLASS_LABEL[d.classification]}" disabled />`}
                <small class="muted">${META.classifications.find((c) => c.id === d.classification)?.help}${manage() ? '' : ' Only people who manage it change this.'}</small></label>
              <label class="field span-2"><span>Tags</span><input name="tags" maxlength="400" value="${(d.tags || []).join(', ')}" placeholder="contract, 2026" /></label>
              <label class="field span-2"><span>Description</span><textarea name="description" rows="3" maxlength="4000">${d.description}</textarea></label>
              <p class="form-error span-2" hidden></p>
              <div class="actions span-2"><button type="submit" class="btn primary">Save</button></div>
            </form>` : html`<dl class="dm-dl">
              <div><dt>Status</dt><dd>${STATUS_LABEL[d.status]}</dd></div>
              <div><dt>Classification</dt><dd>${CLASS_LABEL[d.classification]} <small class="muted">${META.classifications.find((c) => c.id === d.classification)?.help}</small></dd></div>
              <div><dt>Tags</dt><dd>${d.tags.length ? d.tags.join(', ') : '—'}</dd></div>
              ${d.description ? html`<div><dt>Description</dt><dd class="pre">${d.description}</dd></div>` : ''}
            </dl>`}
            <dl class="dm-dl dm-facts">
              <div><dt>Owner</dt><dd>${d.ownerName}</dd></div>
              <div><dt>Added</dt><dd>${fmtDateTime(d.createdAt)}</dd></div>
              <div><dt>Updated</dt><dd>${fmtDateTime(d.updatedAt)}</dd></div>
              <div><dt>Your access</dt><dd>${LEVEL_LABEL[d.level]}${d.canDownload ? '' : ', no download'}</dd></div>
            </dl>
          </section>
          <section class="card" aria-labelledby="dm-ver-h">
            <div class="card-head"><h2 id="dm-ver-h">${icon('layers')} Versions <span class="muted small">${plural(d.versions, 'version')}</span></h2></div>
            <ul class="dm-versions">${d.versionList.map((v) => html`<li>
              <span class="dm-vno ${v.no === d.version ? 'cur' : ''}">v${v.no}</span>
              <span class="grow"><strong>${v.name}</strong> ${v.no === d.version ? badge('Current', 'green') : ''}<small>${sizeText(v.size)} · ${v.byName} · ${fmtDateTime(v.at)}${v.note ? ` · ${v.note}` : ''}</small><small class="mono dm-sha" title="SHA-256, checked on every download">SHA-256 ${v.sha256.slice(0, 16)}…</small></span>
              <span class="actions">
                ${d.inline ? html`<a class="btn small-btn" href="${fileUrl(d, { v: v.no, inline: true })}" target="_blank" rel="noopener" aria-label="View version ${v.no}">${icon('eye', 14)}</a>` : ''}
                ${d.canDownload ? html`<a class="btn small-btn" href="${fileUrl(d, { v: v.no })}" download aria-label="Download version ${v.no}">${icon('download', 14)}</a>` : ''}
                ${editing && v.no !== d.version && !lockedByOther() ? html`<button type="button" class="btn small-btn" data-restore-v="${v.no}">Restore</button>` : ''}
              </span></li>`)}</ul>
            <p class="muted small">Restoring a version adds it again as the newest one; nothing is lost. The control panel keeps a set number of versions per document.</p>
          </section>
        </div>
        <div class="stack">
          ${manage() && !d.trashedAt ? html`<section class="card" aria-labelledby="dm-acc-h">
            <div class="card-head"><h2 id="dm-acc-h">${icon('users')} Who has access</h2><button type="button" class="link" id="dm-share-2">Manage</button></div>
            <ul class="dm-who">
              <li>${icon('user', 16)} <span class="grow">${d.ownerName}</span> <small>Owner</small></li>
              ${d.acl.map((g) => html`<li>${icon(g.type === 'user' ? 'user' : g.type === 'everyone' ? 'building' : 'users', 16)} <span class="grow">${g.label}</span> <small>${LEVEL_LABEL[g.level]}${g.download ? '' : ', no download'}${g.until ? `, until ${day(g.until)}` : ''}</small></li>`)}
              <li class="muted small">${d.path.length ? 'Plus whoever has access to the folders above it.' : ''}</li>
            </ul>
            ${d.links?.length ? html`<p class="small">${icon('link', 14)} ${plural(d.links.length, 'link')} for people outside the company.</p>` : ''}
          </section>` : ''}
          <section class="card" aria-labelledby="dm-act-h">
            <div class="card-head"><h2 id="dm-act-h">${icon('activity')} Activity</h2></div>
            ${events().length ? html`<ol class="dm-events">${events().map((e) => html`<li>
              <span class="dm-ev-ic ${e.by?.startsWith?.('link:') ? 'ext' : ''}">${icon(EVENT[e.action]?.[0] || 'activity', 14)}</span>
              <span class="grow"><strong>${e.byName}</strong> ${EVENT[e.action]?.[1] || e.action}${e.note ? html`<small>${e.note}</small>` : ''}<small title="${fmtDateTime(e.at)}">${timeAgo(e.at)}${e.ip ? ` · ${e.ip}` : ''}</small></span></li>`)}</ol>` : html`<p class="muted">Nothing yet.</p>`}
          </section>
        </div>
      </div>`);
    wire();
  }
  async function run(fn, done) {
    try {
      await fn();
      if (done) toast(done);
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  function newVersion(file = null) {
    const mine = mineOut();
    modal({
      title: 'Upload a new version',
      subtitle: `It must be the same kind of file (${META.families.find((f) => f.id === d.family)?.label || d.ext.toUpperCase()}). The current version stays in the list.`,
      body: html`
        <label class="field"><span>File</span><input type="file" name="file" ${file ? '' : 'required'} /></label>
        ${file ? html`<p class="small">${icon('file', 14)} ${file.name} (${sizeText(file.size)})</p>` : ''}
        <label class="field"><span>What changed (optional)</span><input name="note" maxlength="300" placeholder="Signed by both parties" /></label>
        ${mine ? html`<label class="field check"><input type="checkbox" name="checkin" checked /> <span>Check it in after the upload</span></label>` : ''}
        <p class="dm-up-progress" hidden><span class="ps-spin"></span> <span>Uploading…</span> <progress max="1" value="0"></progress></p>`,
      submitLabel: 'Upload',
      onSubmit: async (f) => {
        const picked = file || f.file.files[0];
        if (!picked) throw new Error('Choose the file.');
        if (picked.size > META.maxUploadMB * MB) throw new Error(`${picked.name} is larger than ${META.maxUploadMB} MB, the most accepted here.`);
        const bar = f.querySelector('.dm-up-progress');
        bar.hidden = false;
        try {
          const id = await uploadInPieces('/api/docs/uploads', picked, picked.name, (p) => (bar.querySelector('progress').value = p));
          const r = await api.post(`/api/docs/uploads/${id}/finish`, { documentId: d.id, note: f.note.value, checkin: Boolean(f.checkin?.checked) });
          toast(`Version ${r.document.version} added.${r.duplicate ? ` The same content is also in this folder as ${r.duplicate}.` : ''}`);
        } finally {
          bar.hidden = true;
        }
        window.dispatchEvent(new Event('documents:changed'));
        reload();
      },
    });
  }
  function wire() {
    el.querySelector('#dm-version')?.addEventListener('click', () => newVersion());
    el.querySelector('#dm-checkout')?.addEventListener('click', () => run(() => api.post(`/api/docs/documents/${d.id}/checkout`, {}), `Checked out for ${plural(META.checkoutHours, 'hour')}. Check it in when you are done.`));
    el.querySelector('#dm-checkin')?.addEventListener('click', () => run(() => api.post(`/api/docs/documents/${d.id}/checkout`, { release: true }), 'Checked in.'));
    for (const id of ['#dm-share', '#dm-share-2']) el.querySelector(id)?.addEventListener('click', () => openShare('document', d, reload));
    el.querySelector('#dm-more')?.addEventListener('click', (e) => docMenu(e.currentTarget));
    el.querySelector('#dm-reviewed')?.addEventListener('click', () => run(async () => {
      await patch(`/api/docs/documents/${d.id}`, { reviewed: true });
      window.dispatchEvent(new Event('documents:changed'));
    }, 'Marked reviewed.'));
    el.querySelector('#dm-restore')?.addEventListener('click', () => run(() => api.post('/api/docs/restore', { documentId: d.id }), 'Restored.'));
    el.querySelector('#dm-purge')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete ${d.number} “${d.title}” for good? All ${plural(d.versions, 'version')} and its links go, and it cannot be brought back.`, { confirmLabel: 'Delete for good', title: 'Delete for good' }))) return;
      try {
        await api.del(`/api/docs/documents/${d.id}/purge`);
        toast('Deleted for good.');
        location.hash = '#/documents/trash';
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    el.querySelectorAll('[data-restore-v]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog(`Add version ${b.dataset.restoreV} again as the newest version? The current one stays in the list.`, { confirmLabel: 'Restore this version', danger: false, title: 'Restore a version' }))) return;
      run(() => api.post(`/api/docs/documents/${d.id}/restore-version`, { no: Number(b.dataset.restoreV) }), `Version ${b.dataset.restoreV} restored as the newest version.`);
    }));
    const form = el.querySelector('#dm-details');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('.form-error');
      err.hidden = true;
      const body = { title: form.title.value, status: form.status.value, tags: form.tags.value, description: form.description.value };
      if (form.classification && !form.classification.disabled) body.classification = form.classification.value;
      try {
        d = await patch(`/api/docs/documents/${d.id}`, body);
        toast('Saved.');
        draw();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  }
  function docMenu(btn) {
    document.querySelector('.dm-pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'menu-pop dm-pop';
    pop.setAttribute('role', 'menu');
    mount(pop, html`
      ${manage() ? html`<button type="button" role="menuitem" data-a="move">${icon('folder')} Move to another folder</button>` : ''}
      ${META.manager ? html`<button type="button" role="menuitem" data-a="hold">${icon('lock')} ${d.legalHold ? 'Lift legal hold' : 'Place legal hold'}</button>` : ''}
      ${manage() ? html`<button type="button" role="menuitem" data-a="delete" class="danger-item">${icon('trash')} Move to trash</button>` : ''}`);
    btn.parentElement.style.position = 'relative';
    btn.parentElement.appendChild(pop);
    pop.querySelector('button')?.focus();
    const close = () => {
      pop.remove();
      document.removeEventListener('click', outside, true);
    };
    const outside = (e) => !pop.contains(e.target) && e.target !== btn && close();
    setTimeout(() => document.addEventListener('click', outside, true));
    pop.addEventListener('keydown', (e) => e.key === 'Escape' && (close(), btn.focus()));
    pop.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      close();
      if (a === 'move') moveDialog({ title: `Move ${d.number}`, current: d.folderId, onMove: async (to) => {
        d = await patch(`/api/docs/documents/${d.id}`, { folderId: to });
        toast('Moved.');
        draw();
      } });
      if (a === 'hold') run(() => patch(`/api/docs/documents/${d.id}`, { legalHold: !d.legalHold }), d.legalHold ? 'Legal hold lifted.' : 'Legal hold placed: it cannot be deleted, and its old versions are kept, until the hold is lifted.');
      if (a === 'delete') {
        if (!(await confirmDialog(`Move ${d.number} “${d.title}” to the trash? It stays there for ${plural(META.trashDays, 'day')} and can be restored until then. Its links stop working.`, { confirmLabel: 'Move to trash', title: 'Delete document' }))) return;
        try {
          await api.del(`/api/docs/documents/${d.id}`);
          toast('Moved to the trash.');
          const f = d.path[d.path.length - 1];
          location.hash = f ? (f.id === META.personalRoot ? '#/documents' : `#/documents/folder/${f.id}`) : '#/documents';
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    });
  }
  draw();
}

// ----- Sharing: people in the company, and links for people outside it -----
// kind: 'document' | 'folder'; item: the document (full) or the folder as the lists give it.
function openShare(kind, item, done) {
  const sharing = META.sharing;
  const name = kind === 'document' ? item.title : item.name;
  const manage = item.level === 'manage';
  const cls = kind === 'document' ? item.classification : null;
  const st = {
    tab: manage ? 'inside' : 'links',
    grants: (item.acl || []).map((g) => ({ ...g })),
    inherit: item.inherit !== false,
    links: item.links || null,
    made: null, // { url } just made: shown once
    dirty: false,
  };
  const { form } = modal({ title: `Share “${name}”`, subtitle: kind === 'folder' ? 'Everything in the folder, and in the folders inside it, follows.' : `${item.number} · ${CLASS_LABEL[cls]}`, body: html`<div id="dm-share"></div>`, submitLabel: null, wide: true, className: 'dm-share-modal', onClose: () => done?.() });
  const box = form.querySelector('#dm-share');
  const loadLinks = async () => {
    if (manage) {
      const fresh = kind === 'document' ? await api.get(`/api/docs/documents/${item.id}`) : (await api.get('/api/docs/folders')).folders.find((f) => f.id === item.id);
      st.links = fresh?.links || [];
    } else {
      st.links = (await api.get('/api/docs/links')).links.filter((l) => l.target.kind === kind && l.target.id === item.id);
    }
  };

  const levelOptions = (cur) => ['view', 'edit', 'manage'].filter((l) => atLeast(item.level, l)).map((l) => html`<option value="${l}" ${cur === l ? 'selected' : ''}>${LEVEL_LABEL[l]}</option>`);
  const targets = (type) => (type === 'user' ? META.people.filter((p) => p.id !== ctx.user.id).map((p) => [p.id, `${p.name} (${ROLES[p.role]?.label || p.role})`])
    : type === 'role' ? Object.entries(ROLES).map(([id, r]) => [id, r.label])
    : type === 'department' ? META.departments.map((x) => [x, x]) : [['*', 'Everyone signed in']]);
  const insideTab = () => {
    const off = !sharing.internal && !META.manager;
    if (!manage) return html`<p class="muted">Only the people who manage this ${kind} change who has access.</p>`;
    if (off) return html`<div class="notice">${icon('lock')}<p>Sharing inside the company is turned off in Document control. Ask an administrator.</p></div>`;
    const everyoneOk = sharing.everyone && cls !== 'restricted';
    return html`
      <p class="muted small">Give people, an account type, a department${everyoneOk ? ' or everyone signed in' : ''} access. You cannot give more access than you have. Those with <strong>Can edit</strong> add versions and check it out; with <strong>Can manage</strong> they also share it, move it and delete it.</p>
      ${cls === 'restricted' ? html`<p class="notice bad small">${icon('lock', 14)} Restricted: share it with named people only. Only those who manage it download it.</p>` : ''}
      <ul class="dm-grants">
        <li class="dm-grant owner">${icon('user', 16)}<span class="grow"><strong>${item.ownerName}</strong><small>Owner: always manages it</small></span></li>
        ${st.grants.map((g, i) => html`<li class="dm-grant" data-i="${i}">
          ${icon(g.type === 'user' ? 'user' : g.type === 'everyone' ? 'building' : 'users', 16)}
          <span class="grow"><strong>${g.label}</strong><small>${g.type === 'role' ? 'Account type' : g.type === 'department' ? 'Department' : g.type === 'everyone' ? 'Every signed-in account' : 'Person'}</small></span>
          <select data-f="level" aria-label="Access for ${g.label}">${levelOptions(g.level)}</select>
          <label class="dm-chk"><input type="checkbox" data-f="download" ${g.download ? 'checked' : ''} ${g.level !== 'view' ? 'disabled' : ''} /> Can download</label>
          <label class="dm-chk"><input type="checkbox" data-f="share" ${g.share || g.level === 'manage' ? 'checked' : ''} ${g.level === 'manage' ? 'disabled' : ''} /> Can re-share</label>
          <label class="dm-until"><span class="sr-only">Until</span><input type="date" data-f="until" value="${ymd(g.until)}" title="Access ends after this day (optional)" aria-label="Access for ${g.label} ends" /></label>
          <button type="button" class="icon-btn danger" data-remove="${i}" aria-label="Remove ${g.label}">${icon('x', 16)}</button>
        </li>`)}
      </ul>
      <div class="dm-add-grant">
        <select id="dm-g-type" aria-label="Share with">
          <option value="user">A person</option><option value="role">An account type</option>${META.departments.length ? html`<option value="department">A department</option>` : ''}${everyoneOk ? html`<option value="everyone">Everyone signed in</option>` : ''}
        </select>
        <select id="dm-g-target" aria-label="Who"></select>
        <select id="dm-g-level" aria-label="Access">${levelOptions('view')}</select>
        <button type="button" class="btn" id="dm-g-add">${icon('plus', 16)} Add</button>
      </div>
      ${kind === 'folder' ? html`<label class="field check dm-inherit"><input type="checkbox" id="dm-inherit" ${st.inherit ? 'checked' : ''} /> <span><strong>Inherit from parent</strong>: people with access to the folders above also have it here. Untick it to keep this folder to the people listed.</span></label>` : ''}
      <div class="actions end"><span class="muted small" id="dm-g-note">${st.dirty ? 'Not saved yet.' : ''}</span><button type="button" class="btn primary" id="dm-g-save">Save access</button></div>`;
  };
  // Why a link may not be possible, said before anyone tries.
  function linkRules() {
    const out = [];
    let blocked = '';
    if (!sharing.links) blocked = 'Links for people outside the company are turned off, or only document managers make them (Document control).';
    else if (!item.canShare) blocked = `You can see this ${kind} but not share it. Ask the person who manages it.`;
    else if (cls === 'restricted') blocked = 'Restricted documents are never shared by link.';
    else if (cls && !sharing.classifications.includes(cls)) blocked = `${CLASS_LABEL[cls]} documents are not shared by link here (Document control).`;
    const pw = sharing.passwordRequired || cls === 'confidential';
    out.push(`Each link lasts 1 to ${plural(sharing.maxDays, 'day')} (${sharing.defaultDays} unless you change it), and you can turn it off at any time.`);
    out.push(pw ? `A password is required${cls === 'confidential' && !sharing.passwordRequired ? ' for confidential documents' : ''}: at least ${sharing.passwordMin} characters. Send it separately from the link.` : `A password is optional (at least ${sharing.passwordMin} characters). Send it separately from the link.`);
    if (kind === 'folder') out.push(`A folder link shows the documents directly in it${sharing.classifications.length < 3 ? ` that are ${sharing.classifications.map((c) => CLASS_LABEL[c]).join(', ').toLowerCase()}` : ' (never restricted ones)'}.`);
    if (kind === 'folder') out.push(sharing.uploadLinks ? 'An upload link lets people send files into this folder; they arrive as Received, not yet reviewed, with the same checks as any upload.' : 'Upload links are turned off in Document control.');
    if (!item.canDownload && kind === 'document') out.push('You cannot download this document, so you can only make a view link.');
    return { out, blocked, pw };
  }
  const linksTab = () => {
    const r = linkRules();
    const lr = st.links;
    return html`
      <ul class="dm-rules">${r.out.map((x) => html`<li>${x}</li>`)}</ul>
      ${st.made ? html`<div class="dm-made" role="status">
        <p><strong>${icon('checkCircle', 16)} Link made.</strong> This link is shown only now: copy it and send it. CORE keeps only a fingerprint of it and cannot show it again.</p>
        <div class="sp-link"><code class="sp-url" id="dm-made-url">${st.made.url}</code><button type="button" class="btn primary" id="dm-copy">${icon('copy', 16)} Copy</button></div>
        ${st.made.password ? html`<p class="small muted">Send the password another way (a call or a text message), not in the same message as the link.</p>` : ''}
      </div>` : ''}
      <h3>Links</h3>
      ${lr == null ? html`<p class="muted">Loading…</p>` : lr.length ? html`<ul class="dm-links">${lr.map((l) => html`<li>
        <span class="badge ${l.mode === 'upload' ? 'blue' : l.mode === 'download' ? 'brand' : ''}">${MODE_LABEL[l.mode]}</span>
        <span class="grow"><strong class="mono">…${l.hint}</strong> ${badge(LINK_STATE[l.state]?.[0] || l.state, LINK_STATE[l.state]?.[1] || 'gray')}
          <small>Until ${day(l.expiresAt)} · ${l.hasPassword ? 'password' : 'no password'} · ${l.mode === 'upload' ? plural(l.uploads, 'file') + ' received' : `${plural(l.views, 'view')}${l.mode === 'download' ? `, ${l.downloads}${l.maxDownloads ? ` of ${l.maxDownloads}` : ''} downloads` : ''}`}</small>
          <small>Made by ${l.createdByName} ${timeAgo(l.createdAt)}${l.lastAccessAt ? ` · last opened ${timeAgo(l.lastAccessAt)}` : ' · not opened yet'}${l.note ? ` · “${l.note}”` : ''}</small></span>
        <button type="button" class="btn small-btn danger ghost" data-revoke="${l.id}">Turn off</button></li>`)}</ul>` : html`<p class="muted small">No links yet.</p>`}
      ${r.blocked ? html`<div class="notice">${icon('lock')}<p>${r.blocked}</p></div>` : html`<div class="dm-newlink">
        <h3>New link</h3>
        <div class="dm-modes" role="radiogroup" aria-label="What the link allows">
          <label class="dm-mode"><input type="radio" name="lk-mode" value="view" ${!item.canDownload && kind === 'document' ? 'checked' : ''} /> <span><strong>View only</strong><small>PDFs and pictures open in the browser; nothing is downloaded.</small></span></label>
          ${item.canDownload || kind === 'folder' ? html`<label class="dm-mode"><input type="radio" name="lk-mode" value="download" checked /> <span><strong>Download</strong><small>They can view and download${kind === 'folder' ? ' the documents in it' : ''}.</small></span></label>` : ''}
          ${kind === 'folder' && sharing.uploadLinks && atLeast(item.level, 'edit') ? html`<label class="dm-mode"><input type="radio" name="lk-mode" value="upload" /> <span><strong>Upload</strong><small>They send files into this folder; they see nothing in it.</small></span></label>` : ''}
        </div>
        <div class="grid two">
          <label class="field"><span>Password${r.pw ? html` <em>*</em>` : ' (optional)'}</span><input type="password" name="lk-password" autocomplete="new-password" minlength="${sharing.passwordMin}" placeholder="At least ${sharing.passwordMin} characters" /></label>
          <label class="field"><span>Days it works</span><input type="number" name="lk-days" min="1" max="${sharing.maxDays}" value="${sharing.defaultDays}" /><small class="muted">At most ${sharing.maxDays}.</small></label>
          <label class="field dm-lk-max"><span>Most downloads (optional)</span><input type="number" name="lk-max" min="0" max="100000" value="${sharing.maxDownloads || ''}" placeholder="No limit" /></label>
          <label class="field"><span>Note for them (optional)</span><input name="lk-note" maxlength="200" placeholder="The signed contract, as discussed" /></label>
        </div>
        <p class="form-error dm-lk-error" role="alert" hidden></p>
        <div class="actions end"><button type="button" class="btn primary" id="dm-lk-make">${icon('link', 16)} Make link</button></div>
      </div>`}`;
  };
  function render() {
    mount(box, html`
      <div class="seg-btns dm-tabs" role="tablist">
        <button type="button" role="tab" data-tab="inside" aria-selected="${st.tab === 'inside'}" class="${st.tab === 'inside' ? 'active' : ''}">${icon('users', 14)} People in the company</button>
        <button type="button" role="tab" data-tab="links" aria-selected="${st.tab === 'links'}" class="${st.tab === 'links' ? 'active' : ''}">${icon('link', 14)} Links outside the company</button>
      </div>
      <div class="dm-tabpanel">${st.tab === 'inside' ? insideTab() : linksTab()}</div>`);
    wireShare();
  }
  function fillTargets() {
    const type = box.querySelector('#dm-g-type')?.value;
    const sel = box.querySelector('#dm-g-target');
    if (!sel) return;
    const have = new Set(st.grants.filter((g) => g.type === type).map((g) => g.id));
    mount(sel, html`${targets(type).filter(([id]) => !have.has(id)).map(([id, label]) => html`<option value="${id}">${label}</option>`)}`);
    sel.hidden = type === 'everyone';
  }
  function wireShare() {
    box.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
      st.tab = b.dataset.tab;
      render();
      if (st.tab === 'links' && st.links == null) {
        await loadLinks().catch(() => (st.links = []));
        render();
      }
    }));
    fillTargets();
    box.querySelector('#dm-g-type')?.addEventListener('change', fillTargets);
    box.querySelector('#dm-g-add')?.addEventListener('click', () => {
      const type = box.querySelector('#dm-g-type').value;
      const id = type === 'everyone' ? '*' : box.querySelector('#dm-g-target').value;
      if (!id) return toast('Choose who to share with.', 'error');
      if (st.grants.some((g) => g.type === type && g.id === id)) return;
      const label = type === 'everyone' ? 'Everyone signed in' : type === 'user' ? META.people.find((p) => p.id === id)?.name : type === 'role' ? `${ROLES[id]?.label || id} (account type)` : `${id} (department)`;
      const level = box.querySelector('#dm-g-level').value;
      st.grants.push({ type, id, level, download: true, share: level === 'manage', until: null, label });
      st.dirty = true;
      render();
    });
    box.querySelectorAll('.dm-grant[data-i]').forEach((row) => {
      const g = st.grants[Number(row.dataset.i)];
      row.querySelectorAll('[data-f]').forEach((c) => c.addEventListener('change', () => {
        const f = c.dataset.f;
        if (f === 'level') {
          g.level = c.value;
          if (g.level !== 'view') g.download = true;
          if (g.level === 'manage') g.share = true;
        } else if (f === 'until') g.until = c.value ? new Date(`${c.value}T23:59:59`).toISOString() : null;
        else g[f] = c.checked;
        st.dirty = true;
        render();
      }));
    });
    box.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      st.grants.splice(Number(b.dataset.remove), 1);
      st.dirty = true;
      render();
    }));
    box.querySelector('#dm-inherit')?.addEventListener('change', (e) => {
      st.inherit = e.target.checked;
      st.dirty = true;
      box.querySelector('#dm-g-note').textContent = 'Not saved yet.';
    });
    box.querySelector('#dm-g-save')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const grants = st.grants.map(({ type, id, level, download, share, until }) => ({ type, id, level, download, share, until }));
        const out = await api.put(`/api/docs/${kind === 'document' ? 'documents' : 'folders'}/${item.id}/access`, kind === 'folder' ? { grants, inherit: st.inherit } : { grants });
        st.grants = (out.acl || []).map((g) => ({ ...g }));
        st.dirty = false;
        toast(grants.length ? 'Access saved.' : 'Access saved: only the owner (and document managers) have it now.');
        render();
      } catch (err) {
        toast(err.message, 'error');
        e.currentTarget.disabled = false;
      }
    });
    // Links
    const modeNow = () => box.querySelector('input[name=lk-mode]:checked')?.value;
    const showMax = () => {
      const m = box.querySelector('.dm-lk-max');
      if (m) m.hidden = modeNow() !== 'download';
    };
    box.querySelectorAll('input[name=lk-mode]').forEach((r) => r.addEventListener('change', showMax));
    showMax();
    box.querySelector('#dm-lk-make')?.addEventListener('click', async (e) => {
      const err = box.querySelector('.dm-lk-error');
      err.hidden = true;
      const password = box.querySelector('[name=lk-password]').value;
      const { pw } = linkRules();
      const fail = (m) => {
        err.textContent = m;
        err.hidden = false;
      };
      if (pw && !password) return fail(`Give the link a password (at least ${sharing.passwordMin} characters).`);
      if (password && password.length < sharing.passwordMin) return fail(`The password needs at least ${sharing.passwordMin} characters.`);
      e.currentTarget.disabled = true;
      try {
        const out = await api.post('/api/docs/links', {
          target: { kind, id: item.id }, mode: modeNow(), password, days: Number(box.querySelector('[name=lk-days]').value) || sharing.defaultDays,
          maxDownloads: modeNow() === 'download' ? Number(box.querySelector('[name=lk-max]').value) || 0 : 0, note: box.querySelector('[name=lk-note]').value,
        });
        st.made = { url: out.url, password: Boolean(password) };
        await loadLinks();
        render();
        box.querySelector('#dm-made-url')?.scrollIntoView({ block: 'nearest' });
      } catch (ex) {
        fail(ex.message);
        e.currentTarget.disabled = false;
      }
    });
    box.querySelector('#dm-copy')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(st.made.url);
        toast('Link copied.');
      } catch {
        getSelection().selectAllChildren(box.querySelector('#dm-made-url'));
        toast('Press Ctrl+C (or ⌘C) to copy the selected link.');
      }
    });
    box.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Turn this link off? It stops working at once for everyone who has it, and it cannot be turned on again (make a new one instead).', { confirmLabel: 'Turn off', title: 'Turn a link off' }))) return;
      try {
        await api.del(`/api/docs/links/${b.dataset.revoke}`);
        toast('Link turned off.');
        await loadLinks();
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    }));
  }
  render();
  if (st.tab === 'links' && st.links == null) loadLinks().then(render).catch(() => ((st.links = []), render()));
}
