// ATLAS Documents: My files and the folders inside it, School folders, Shared with me, Recent,
// Received, Trash, search, and My links. Files are added by choosing Upload or dropping them on the
// page; each goes up in pieces with its own progress line, and a refused file says why.
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { html, mount, modal, toast, formData, confirmDialog, badge, fmtDateTime } from '../../ui.js';
import { icon } from '../../icons.js';
import { docs, isManager, docIcon, folderIcon, docMarks, fileUrl, when, fmtSize, uploadFiles, uploadPanel, MODE_LABEL, LINK_STATE } from '../state.js';
import { openShare } from './sharing.js';

const searchBox = (q = '') => html`<form class="doc-search" id="doc-search" role="search"><span class="search-ic">${icon('search', 16)}</span><input type="search" name="q" value="${q}" placeholder="Search documents" aria-label="Search documents" /></form>`;
function wireSearch(el) {
  el.querySelector('#doc-search')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = formData(e.target).q.trim();
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
}

// One table for folders and documents.
function itemsTable({ folders = [], documents = [], trash = false, received = false }) {
  if (!folders.length && !documents.length) return '';
  return html`<div class="card scroll-x"><table class="table doc-table">
    <thead><tr><th>Name</th><th>Owner</th><th>${trash ? 'Deleted' : 'Updated'}</th><th class="num">Size</th><th></th></tr></thead>
    <tbody>
      ${folders.map((f) => html`<tr>
        <td><a class="doc-name" href="#/folder/${f.id}">${folderIcon(f)}<span><strong>${f.name}</strong>${f.legalHold ? html` ${badge('Legal hold', 'red')}` : ''}<small>Folder${f.acl?.length ? ` · shared with ${f.acl.length}` : ''}</small></span></a></td>
        <td data-label="Owner">${f.ownerId === ctx.user.id ? 'You' : f.ownerName}</td>
        <td data-label="${trash ? 'Deleted' : 'Updated'}">${trash ? when(f.trashedAt) : '—'}</td>
        <td class="num" data-label="Size">—</td>
        <td class="row-actions">${trash ? html`<button type="button" class="btn sm" data-restore-folder="${f.id}">${icon('up', 14)} Restore</button>` : ''}</td>
      </tr>`)}
      ${documents.map((d) => html`<tr>
        <td><a class="doc-name" href="#/doc/${d.id}">${docIcon(d)}<span><strong>${d.title}</strong> ${docMarks(d)}<small>${d.name} · ${d.number}${d.versions > 1 ? ` · version ${d.version}` : ''}</small></span></a></td>
        <td data-label="Owner">${d.ownerId === ctx.user.id ? 'You' : d.ownerName}</td>
        <td data-label="${trash ? 'Deleted' : 'Updated'}">${when(trash ? d.trashedAt : d.updatedAt)}</td>
        <td class="num" data-label="Size">${fmtSize(d.size)}</td>
        <td class="row-actions">
          ${trash ? html`<button type="button" class="btn sm" data-restore="${d.id}">${icon('up', 14)} Restore</button> <button type="button" class="btn sm danger ghost" data-purge="${d.id}">Delete for good</button>`
            : received ? html`<button type="button" class="btn sm primary" data-reviewed="${d.id}">${icon('check', 14)} Mark reviewed</button>`
              : d.canDownload ? html`<a class="btn sm quiet" href="${fileUrl(d)}" download aria-label="Download ${d.title}">${icon('download', 16)}</a>` : ''}
        </td>
      </tr>`)}
    </tbody></table></div>`;
}

function noticesBox() {
  const n = docs.meta?.notices || [];
  if (!n.length) return '';
  return html`<div class="notice info doc-notices">${icon('inbox')}<div class="grow"><ul>${n.slice(0, 5).map((x) => html`<li><a href="${x.link}"><strong>${x.title}</strong></a> <span class="muted">${x.body} · ${when(x.at)}</span></li>`)}</ul></div><button type="button" class="btn sm" id="notices-read">Dismiss</button></div>`;
}
function wireNotices(el) {
  el.querySelector('#notices-read')?.addEventListener('click', async () => {
    await api.post('/api/docs/notices/read', {});
    docs.meta.notices = [];
    el.querySelector('.doc-notices')?.remove();
  });
}

// Restore, delete for good and "reviewed" buttons in any list.
function wireRows(el, reload) {
  el.onclick = async (e) => { // assigned, not added: a view redraws itself into the same element
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.restore) {
        await api.post('/api/docs/restore', { documentId: b.dataset.restore });
        toast('Restored.');
      } else if (b.dataset.restoreFolder) {
        await api.post('/api/docs/restore', { folderId: b.dataset.restoreFolder });
        toast('Folder restored.');
      } else if (b.dataset.purge) {
        if (!(await confirmDialog('Delete this document and all its versions for good? It cannot be brought back.', { confirmLabel: 'Delete for good' }))) return;
        await api.del(`/api/docs/documents/${b.dataset.purge}/purge`);
        toast('Deleted for good.');
      } else if (b.dataset.reviewed) {
        await api.put(`/api/docs/documents/${b.dataset.reviewed}`, { reviewed: true });
        toast('Marked reviewed.');
        ctx.refreshBadges?.();
      } else return;
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

// ----- A folder (My files when no id) -----
export async function folderView(el, params = {}) {
  if (!docs.meta) await docs.refresh();
  const id = params.id || docs.meta.personalRoot;
  const list = await api.get(`/api/docs/list?view=folder&folder=${encodeURIComponent(id)}`);
  const f = list.folder;
  const mine = id === docs.meta.personalRoot;
  const canEdit = ['edit', 'manage'].includes(list.level);
  const crumbs = list.path.slice(0, -1).map((p) => [p.id === docs.meta.personalRoot ? '/files' : `/folder/${p.id}`, p.name]);
  const used = docs.meta.quotaMB ? html` · ${fmtSize(docs.meta.usedBytes)} of ${docs.meta.quotaMB >= 1024 ? `${docs.meta.quotaMB / 1024} GB` : `${docs.meta.quotaMB} MB`} used` : '';
  const sub = mine ? html`Your own files: only you see them until you share one.${used}` : html`${f.personal ? `In ${f.ownerId === ctx.user.id ? 'your' : `${f.ownerName}'s`} files` : 'A school folder'} · ${f.level === 'manage' ? 'you manage it' : f.level === 'edit' ? 'you can add and change files' : 'you can open its files'}${f.acl?.length ? ` · shared with ${f.acl.length}` : ''}`;
  mount(el, html`
    ${pageHead(mine ? 'My files' : html`${f.name}${f.legalHold ? html` ${badge('Legal hold', 'red')}` : ''}`, sub, html`
      ${canEdit ? html`<button type="button" class="btn primary" id="upload-btn">${icon('upload', 16)} Upload</button><button type="button" class="btn" id="new-folder">${icon('plus', 16)} New folder</button>` : ''}
      ${!mine && (f.level === 'manage' || f.canShare) ? html`<button type="button" class="btn" id="share-folder">${icon('users', 16)} Share</button>` : ''}
      ${!mine && f.level === 'manage' ? html`<button type="button" class="btn" id="folder-more" aria-haspopup="menu">${icon('settings', 16)} Folder</button>` : ''}`, crumbs.length ? crumbs : '')}
    ${mine ? noticesBox() : ''}
    <div class="toolbar">${searchBox()}</div>
    ${uploadPanel()}
    ${canEdit ? html`<input type="file" id="file-input" multiple hidden />` : ''}
    <div id="drop" class="${canEdit ? 'drop-target' : ''}">
      ${itemsTable(list) || html`<div class="card empty">${icon('folder', 40)}<h2>${mine ? 'Nothing here yet' : 'This folder is empty'}</h2><p>${canEdit ? 'Choose Upload, or drop files on this page. PDFs, pictures, Word, Excel and PowerPoint files and more are accepted.' : 'Nothing has been added here yet.'}</p></div>`}
      ${canEdit ? html`<p class="drop-hint muted small">${icon('upload', 14)} Drop files anywhere on this page to add them here. Up to ${docs.meta.maxUploadMB} MB each.</p>` : ''}
    </div>`);
  const reload = () => folderView(el, params);
  wireSearch(el);
  wireNotices(el);
  wireRows(el, reload);
  const panel = el.querySelector('#upload-panel');
  el.querySelector('#upload-clear')?.addEventListener('click', () => {
    panel.querySelector('ul').innerHTML = '';
    panel.hidden = true;
  });
  const send = async (files) => {
    const n = await uploadFiles(files, panel, { folderId: id });
    if (n) {
      await docs.refresh();
      const keep = panel.querySelector('ul').innerHTML;
      await reload();
      const p2 = el.querySelector('#upload-panel');
      p2.querySelector('ul').innerHTML = keep;
      p2.hidden = false;
    }
  };
  const input = el.querySelector('#file-input');
  el.querySelector('#upload-btn')?.addEventListener('click', () => input.click());
  input?.addEventListener('change', () => {
    send(input.files);
    input.value = '';
  });
  if (canEdit) {
    const zone = document.getElementById('app');
    const over = (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault();
      el.querySelector('#drop')?.classList.add('over');
    };
    const leave = (e) => (!e.relatedTarget || !zone.contains(e.relatedTarget)) && el.querySelector('#drop')?.classList.remove('over');
    const drop = (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      el.querySelector('#drop')?.classList.remove('over');
      send(e.dataTransfer.files);
    };
    el.ondragover = over;
    el.ondragleave = leave;
    el.ondrop = drop;
  }
  el.querySelector('#new-folder')?.addEventListener('click', () => newFolder(id, reload));
  el.querySelector('#share-folder')?.addEventListener('click', async () => {
    const fresh = (await api.get('/api/docs/folders')).folders.find((x) => x.id === id) || f;
    openShare(fresh, 'folder', (o) => !o?.keepOpen && reload());
  });
  el.querySelector('#folder-more')?.addEventListener('click', () => folderMenu(f, reload));
}

function newFolder(parentId, reload) {
  modal({
    title: 'New folder',
    submitLabel: 'Add folder',
    body: html`<label class="field"><span>Name</span><input name="name" maxlength="120" required placeholder="e.g. Class records 2026" /></label>
      ${parentId ? '' : html`<p class="hint">A school folder at the top level. Share it with the people who need it.</p>`}`,
    async onSubmit(form) {
      const { name } = formData(form);
      const f = await api.post('/api/docs/folders', { name, parentId });
      toast(`Folder “${f.name}” added.`);
      if (parentId) reload();
      else location.hash = `#/folder/${f.id}`;
    },
  });
}

function folderMenu(f, reload) {
  const { form, close } = modal({
    title: `Folder “${f.name}”`,
    submitLabel: 'Rename',
    body: html`<label class="field"><span>Name</span><input name="name" value="${f.name}" maxlength="120" required /></label>
      <div class="actions folder-actions">
        ${isManager() ? html`<button type="button" class="btn" data-hold>${icon('shield', 16)} ${f.legalHold ? 'Lift legal hold' : 'Place on legal hold'}</button>` : ''}
        <button type="button" class="btn danger ghost" data-trash>${icon('trash', 16)} Move to trash</button>
      </div>`,
    async onSubmit(fm) {
      await api.put(`/api/docs/folders/${f.id}`, { name: formData(fm).name });
      toast('Folder renamed.');
      reload();
    },
  });
  form.querySelector('[data-hold]')?.addEventListener('click', async () => {
    try {
      await api.put(`/api/docs/folders/${f.id}`, { legalHold: !f.legalHold });
      toast(f.legalHold ? 'Legal hold lifted.' : 'Placed on legal hold: nothing in it can be deleted.');
      close();
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  form.querySelector('[data-trash]').addEventListener('click', async () => {
    if (!(await confirmDialog(`Move “${f.name}” and everything in it to the trash? It can be restored from Trash for ${docs.meta?.trashDays || 30} days.`, { confirmLabel: 'Move to trash' }))) return;
    try {
      await api.del(`/api/docs/folders/${f.id}`);
      toast('Moved to the trash.');
      close();
      location.hash = f.parentId ? `#/folder/${f.parentId}` : '#/folders';
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ----- School folders: the shared folders at the top, and folders shared with you -----
export async function schoolFoldersView(el) {
  const { folders } = await api.get('/api/docs/folders');
  const top = folders.filter((f) => !f.personal && !f.parentId);
  const shared = folders.filter((f) => f.sharedRoot && !(f.personal && f.ownerId === ctx.user.id) && !(!f.personal && !f.parentId));
  mount(el, html`
    ${pageHead('School folders', 'Folders the school shares: each office, college or team keeps its documents in one, and decides who may open it.', isManager() ? html`<button type="button" class="btn primary" id="new-top">${icon('plus', 16)} New school folder</button>` : '')}
    <div class="toolbar">${searchBox()}</div>
    ${top.length ? itemsTable({ folders: top }) : html`<div class="card empty">${icon('building', 40)}<h2>No school folders for you yet</h2><p>${isManager() ? 'Add one with New school folder, then share it.' : 'When an office or your college shares a folder with you, it appears here.'}</p></div>`}
    ${shared.length ? html`<h3>Folders shared with you</h3>${itemsTable({ folders: shared })}` : ''}`);
  wireSearch(el);
  el.querySelector('#new-top')?.addEventListener('click', () => newFolder(null, () => schoolFoldersView(el)));
}

// ----- Shared with me, Recent, Received, Trash, search -----
const LISTS = {
  shared: ['Shared with me', 'Documents other people shared with you, or that you can open through a folder.', 'users', 'Nothing has been shared with you yet.'],
  recent: ['Recent', 'The documents you can open, newest changes first.', 'clock', 'Nothing yet.'],
  received: ['Received', 'Files people outside the school sent through your upload links. Check each one, then mark it reviewed.', 'inbox', 'Nothing is waiting to be reviewed.'],
  trash: ['Trash', '', 'trash', 'The trash is empty.'],
  search: ['Search', '', 'search', 'No document matches those words.'],
};
export async function listView(el, view, query = {}) {
  if (!docs.meta) await docs.refresh();
  const q = query.q || '';
  const list = await api.get(`/api/docs/list?view=${view}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const [title, sub0, ic, none] = LISTS[view];
  const sub = view === 'trash' ? `Deleted documents and folders stay here for ${list.trashDays} days, then are removed for good. Documents on legal hold are never removed.` : view === 'search' ? `${list.documents.length} document${list.documents.length === 1 ? '' : 's'} with “${q}”` : sub0;
  mount(el, html`
    ${pageHead(title, sub)}
    <div class="toolbar">${searchBox(q)}</div>
    ${itemsTable({ folders: list.folders, documents: list.documents, trash: view === 'trash', received: view === 'received' }) || html`<div class="card empty">${icon(ic, 40)}<h2>${none}</h2>${view === 'search' ? html`<p>ATLAS looks in titles, file names, numbers, tags, descriptions and the words inside text, Word, Excel, PowerPoint and OpenDocument files.</p>` : ''}</div>`}`);
  wireSearch(el);
  wireRows(el, () => listView(el, view, query));
}

// ----- My links: every link you made that still works -----
export async function linksView(el) {
  const { links } = await api.get('/api/docs/links');
  mount(el, html`
    ${pageHead('My links', 'Links you made for people outside the school. Turn one off when it is no longer needed; it stops working at once.')}
    ${links.length ? html`<div class="card scroll-x"><table class="table">
      <thead><tr><th>Link</th><th>For</th><th>Until</th><th>Used</th><th></th></tr></thead>
      <tbody>${links.map((l) => {
        const [st, k] = LINK_STATE[l.state] || [l.state, 'gray'];
        return html`<tr>
        <td><strong>…${l.hint}</strong> ${badge(st, k)}${l.hasPassword ? html` ${badge('Password', 'blue')}` : ''}<small>${MODE_LABEL[l.mode]}${l.note ? ` · “${l.note}”` : ''}</small></td>
        <td data-label="For"><a href="#/${l.target.kind === 'document' ? 'doc' : 'folder'}/${l.target.id}">${icon(l.target.kind === 'document' ? 'file' : 'folder', 14)} ${l.target.name}</a></td>
        <td data-label="Until">${fmtDateTime(l.expiresAt)}</td>
        <td data-label="Used">${l.mode === 'upload' ? `${l.uploads} file(s) received` : `${l.opens} open(s), ${l.downloads}${l.maxDownloads ? ` of ${l.maxDownloads}` : ''} download(s)`}</td>
        <td class="row-actions"><button type="button" class="btn sm danger ghost" data-off="${l.id}">Turn off</button></td></tr>`;
      })}</tbody></table></div>` : html`<div class="card empty">${icon('link', 40)}<h2>No links</h2><p>To send a document to someone outside the school, open it and choose Share.</p></div>`}`);
  el.onclick = async (e) => {
    const b = e.target.closest('[data-off]');
    if (!b) return;
    if (!(await confirmDialog('Turn this link off? Anyone who has it can no longer open it.', { confirmLabel: 'Turn off' }))) return;
    await api.del(`/api/docs/links/${b.dataset.off}`);
    toast('Link turned off.');
    linksView(el);
  };
}
