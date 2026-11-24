// One document: a preview (PDFs and pictures), its details, versions, who has access and the links
// outside, check-out, a new version, and what happened to it (activity).
import { api } from '../../api.js';
import { ctx, pageHead } from '../../shell.js';
import { html, mount, modal, toast, formData, option, confirmDialog, badge, fmtDateTime } from '../../ui.js';
import { icon } from '../../icons.js';
import { docs, isManager, docIcon, docMarks, classBadge, fileUrl, when, fmtSize, uploadFiles, uploadPanel, CLASS_LABEL, STATUS_LABEL, LEVEL_LABEL } from '../state.js';
import { openShare } from './sharing.js';

const ACTION = {
  upload: 'Added', version: 'New version', view: 'Viewed', download: 'Downloaded', change: 'Changed', access: 'Access changed', checkout: 'Checked out', checkin: 'Checked in',
  trash: 'Moved to the trash', restore: 'Restored', purge: 'Deleted for good', hold: 'Placed on legal hold', unhold: 'Legal hold lifted', link: 'Link made', unlink: 'Link turned off',
  'link-opens': 'Opened through a link', 'link-views': 'Viewed through a link', 'link-downloads': 'Downloaded through a link', 'link-uploads': 'Sent through a link', 'link-password-wrong': 'Wrong link password',
};
const TABS = [['details', 'Details'], ['versions', 'Versions'], ['access', 'Access'], ['activity', 'Activity']];

export async function documentView(el, { id }, query = {}) {
  if (!docs.meta) await docs.refresh();
  const d = await api.get(`/api/docs/documents/${encodeURIComponent(id)}`);
  const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'details';
  const canEdit = ['edit', 'manage'].includes(d.level) && !d.trashedAt;
  const manage = d.level === 'manage' && !d.trashedAt;
  const co = d.checkout;
  const blocked = co && co.userId !== ctx.user.id;
  const crumbs = d.path.map((p) => [p.id === docs.meta.personalRoot ? '/files' : `/folder/${p.id}`, p.name]);
  const preview = d.inline ? (d.family === 'image'
    ? html`<img class="doc-preview-img" src="${fileUrl(d, { inline: true })}" alt="${d.title}" />`
    : html`<iframe class="doc-preview" src="${fileUrl(d, { inline: true })}" title="Preview of ${d.title}"></iframe>`)
    : html`<div class="doc-noprev">${docIcon(d, 40)}<p><strong>${d.name}</strong></p><p class="muted">${fmtSize(d.size)} · this kind of file opens on your computer, not in the browser.</p>${d.canDownload ? html`<a class="btn primary" href="${fileUrl(d)}" download>${icon('download', 16)} Download</a>` : html`<p class="muted">${d.classification === 'restricted' ? 'Restricted: only the people who manage it download it.' : 'You can see its details but not download it.'}</p>`}</div>`;
  const tabUrl = (k) => `#/doc/${d.id}?tab=${k}`;
  mount(el, html`
    ${pageHead(html`${d.title} ${docMarks(d)}`, html`${d.number} · ${d.name} · version ${d.version} · ${LEVEL_LABEL[d.level].toLowerCase()}`, html`
      ${d.trashedAt ? html`<button type="button" class="btn primary" id="restore">${icon('up', 16)} Restore</button>` : html`
        ${d.canDownload ? html`<a class="btn primary" href="${fileUrl(d)}" download>${icon('download', 16)} Download</a>` : ''}
        ${d.level === 'manage' || d.canShare ? html`<button type="button" class="btn" id="share">${icon('users', 16)} Share</button>` : ''}
        ${canEdit ? html`<button type="button" class="btn" id="new-version" ${blocked ? 'disabled' : ''}>${icon('upload', 16)} New version</button>` : ''}
        ${canEdit ? html`<button type="button" class="btn" id="checkout">${icon('lock', 16)} ${co ? (co.userId === ctx.user.id ? 'Check in' : manage ? 'Check in for them' : 'Checked out') : 'Check out'}</button>` : ''}
        ${manage ? html`<button type="button" class="btn danger ghost" id="trash" aria-label="Move to trash">${icon('trash', 16)}</button>` : ''}`}`, crumbs.length ? crumbs : '')}
    ${d.trashedAt ? html`<div class="notice bad">${icon('trash')}<p>In the trash since ${fmtDateTime(d.trashedAt)}. Restore it to use it again.</p></div>` : ''}
    ${co ? html`<div class="notice">${icon('lock')}<p>${co.userId === ctx.user.id ? 'You have it checked out' : `${co.name} has it checked out`} until ${fmtDateTime(co.until)}: ${co.userId === ctx.user.id ? 'others can open it, but only you add a new version. Check it in when you are done.' : 'you can open it, but not add a new version until it is checked in.'}</p></div>` : ''}
    ${!d.reviewed ? html`<div class="notice doc-received">${icon('inbox')}<p><strong>Received through an upload link${d.sender?.name ? ` from ${d.sender.name}` : ''}${d.sender?.email ? ` (${d.sender.email})` : ''}.</strong> ATLAS checked its type; look at it before you share it further.</p>${manage ? html`<button type="button" class="btn sm primary" id="reviewed">${icon('check', 14)} Mark reviewed</button>` : ''}</div>` : ''}
    ${uploadPanel()}
    <input type="file" id="version-input" hidden />
    <div class="doc-layout">
      <section class="card doc-preview-card">${preview}</section>
      <div class="doc-side">
        <nav class="tabs">${TABS.filter(([k]) => k !== 'access' || d.level === 'manage').map(([k, label]) => html`<a href="${tabUrl(k)}" class="${k === tab ? 'active' : ''}">${label}${k === 'versions' ? html` <span class="count">${d.versionList.length}</span>` : ''}</a>`)}</nav>
        <div id="tab">${TAB_VIEWS[tab](d, { canEdit, manage })}</div>
      </div>
    </div>`);

  const reload = () => documentView(el, { id }, query);
  const panel = el.querySelector('#upload-panel');
  el.querySelector('#upload-clear')?.addEventListener('click', () => {
    panel.querySelector('ul').innerHTML = '';
    panel.hidden = true;
  });
  const vin = el.querySelector('#version-input');
  el.querySelector('#new-version')?.addEventListener('click', () => vin.click());
  vin.addEventListener('change', async () => {
    const file = vin.files[0];
    vin.value = '';
    if (!file) return;
    if (await uploadFiles([file], panel, { documentId: d.id, extra: { checkin: Boolean(co && co.userId === ctx.user.id) } })) {
      toast('New version added.');
      setTimeout(reload, 900);
    }
  });
  el.querySelector('#share')?.addEventListener('click', () => openShare(d, 'document', (o) => !o?.keepOpen && reload()));
  el.querySelector('#checkout')?.addEventListener('click', async () => {
    try {
      await api.post(`/api/docs/documents/${d.id}/checkout`, { release: Boolean(co) });
      toast(co ? 'Checked in.' : `Checked out: until you check it in, only you add new versions (at most ${docs.meta.checkoutHours || 72} hours).`);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#trash')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Move “${d.title}” to the trash? It can be restored from Trash until it is removed for good.`, { confirmLabel: 'Move to trash' }))) return;
    try {
      await api.del(`/api/docs/documents/${d.id}`);
      toast('Moved to the trash.');
      history.back();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelector('#restore')?.addEventListener('click', async () => {
    await api.post('/api/docs/restore', { documentId: d.id });
    toast('Restored.');
    reload();
  });
  el.querySelector('#reviewed')?.addEventListener('click', async () => {
    await api.put(`/api/docs/documents/${d.id}`, { reviewed: true });
    toast('Marked reviewed.');
    ctx.refreshBadges?.();
    reload();
  });
  el.querySelector('#edit-details')?.addEventListener('click', () => editDetails(d, { manage }, reload));
  el.querySelector('#hold')?.addEventListener('click', async () => {
    try {
      await api.put(`/api/docs/documents/${d.id}`, { legalHold: !d.legalHold });
      toast(d.legalHold ? 'Legal hold lifted.' : 'Placed on legal hold: it cannot be deleted, and its versions are all kept.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  el.querySelectorAll('[data-restore-version]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog(`Make version ${b.dataset.restoreVersion} the current one again? It is added as a new version; nothing is lost.`, { confirmLabel: 'Restore this version', danger: false }))) return;
    try {
      await api.post(`/api/docs/documents/${d.id}/restore-version`, { no: Number(b.dataset.restoreVersion) });
      toast('Version restored.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  el.querySelector('#open-share')?.addEventListener('click', () => openShare(d, 'document', (o) => !o?.keepOpen && reload()));
}

const TAB_VIEWS = {
  details(d, { canEdit }) {
    return html`<section class="card">
      ${d.description ? html`<p class="pre doc-desc">${d.description}</p>` : ''}
      <dl class="info-grid doc-info">
        <div class="info"><dt>Classification</dt><dd>${classBadge(d.classification, true)}</dd></div>
        <div class="info"><dt>Status</dt><dd>${STATUS_LABEL[d.status]}</dd></div>
        <div class="info"><dt>Owner</dt><dd>${d.ownerId === ctx.user.id ? 'You' : d.ownerName}</dd></div>
        <div class="info"><dt>Size</dt><dd>${fmtSize(d.size)}</dd></div>
        <div class="info"><dt>Added</dt><dd>${fmtDateTime(d.createdAt)}</dd></div>
        <div class="info"><dt>Changed</dt><dd>${fmtDateTime(d.updatedAt)}</dd></div>
        <div class="info span-all"><dt>Tags</dt><dd>${d.tags.length ? d.tags.map((t) => html`<span class="chip tag">${t}</span> `) : html`<span class="muted">None</span>`}</dd></div>
        <div class="info span-all"><dt>Fingerprint (SHA-256)</dt><dd class="mono small sha">${d.versionList[0]?.sha256}</dd></div>
      </dl>
      ${canEdit || isManager() ? html`<div class="actions doc-detail-actions">
        ${canEdit ? html`<button type="button" class="btn" id="edit-details">${icon('edit', 16)} Edit details</button>` : ''}
        ${isManager() && !d.trashedAt ? html`<button type="button" class="btn" id="hold">${icon('shield', 16)} ${d.legalHold ? 'Lift legal hold' : 'Legal hold'}</button>` : ''}
      </div>` : ''}
    </section>`;
  },
  versions(d, { canEdit }) {
    return html`<section class="card scroll-x"><table class="table compact">
      <thead><tr><th>Version</th><th>By</th><th class="num">Size</th><th></th></tr></thead>
      <tbody>${d.versionList.map((v) => html`<tr>
        <td><strong>${v.no}${v.no === d.version ? html` ${badge('Current', 'green')}` : ''}</strong><small>${v.name}${v.note ? ` · ${v.note}` : ''}</small></td>
        <td data-label="By">${v.byName}<small>${fmtDateTime(v.at)}</small></td>
        <td class="num" data-label="Size">${fmtSize(v.size)}</td>
        <td class="row-actions">${d.canDownload ? html`<a class="btn sm quiet" href="${fileUrl(d, { v: v.no })}" download aria-label="Download version ${v.no}">${icon('download', 14)}</a>` : ''}${canEdit && v.no !== d.version ? html`<button type="button" class="btn sm" data-restore-version="${v.no}">Restore</button>` : ''}</td>
      </tr>`)}</tbody></table></section>`;
  },
  access(d) {
    return html`<section class="card">
      <h2>${icon('users')} Who has access</h2>
      <ul class="link-list"><li>${icon('user', 16)} ${d.ownerId === ctx.user.id ? 'You' : d.ownerName} <span class="muted small">owner</span></li>
        ${(d.acl || []).map((g) => html`<li>${icon(g.type === 'user' ? 'user' : 'users', 16)} ${g.label} <span class="muted small">${LEVEL_LABEL[g.level].toLowerCase()}${g.level === 'view' && !g.download ? ', no download' : ''}${g.until ? `, until ${fmtDateTime(g.until)}` : ''}</span></li>`)}</ul>
      <p class="hint">People who can open the folder ${d.path.at(-1)?.name ? `“${d.path.at(-1).name}”` : ''} can open it too, and document managers can open everything.</p>
      <h2 class="mt">${icon('link')} Links outside the school</h2>
      ${(d.links || []).length ? html`<p>${d.links.length} link${d.links.length === 1 ? '' : 's'} that still work.</p>` : html`<p class="muted">None.</p>`}
      ${!d.trashedAt ? html`<button type="button" class="btn" id="open-share">${icon('users', 16)} Change access and links</button>` : ''}
    </section>`;
  },
  activity(d) {
    return html`<section class="card"><ul class="doc-events">${d.events.length ? d.events.map((e) => html`<li><strong>${ACTION[e.action] || e.action}</strong> <span class="muted">${e.byName} · ${when(e.at)}${e.ip ? ` · ${e.ip}` : ''}</span>${e.note ? html`<small>${e.note}</small>` : ''}</li>`) : html`<li class="muted">Nothing yet.</li>`}</ul></section>`;
  },
};

async function editDetails(d, { manage }, reload) {
  const folders = manage ? (await api.get('/api/docs/folders')).folders.filter((f) => ['edit', 'manage'].includes(f.level)) : [];
  modal({
    title: 'Edit details',
    body: html`<div class="stack tight">
      <label class="field"><span>Title</span><input name="title" value="${d.title}" maxlength="200" required /></label>
      <label class="field"><span>Description</span><textarea name="description" maxlength="4000">${d.description}</textarea></label>
      <label class="field"><span>Tags (separated by commas)</span><input name="tags" value="${d.tags.join(', ')}" /></label>
      <div class="grid two">
        <label class="field"><span>Status</span><select name="status">${Object.entries(STATUS_LABEL).map(([k, l]) => option(k, l, k === d.status))}</select></label>
        <label class="field"><span>Classification</span><select name="classification" ${manage ? '' : 'disabled'}>${Object.entries(CLASS_LABEL).map(([k, l]) => option(k, l, k === d.classification))}</select>${manage ? '' : html`<span class="hint">Only people who manage it change this.</span>`}</label>
      </div>
      <p class="hint">${docs.meta.classifications.map((c) => `${c.label}: ${c.help}`).join(' ')}</p>
      ${manage && folders.length ? html`<label class="field"><span>Folder</span><select name="folderId">${folders.map((f) => option(f.id, f.personal && !f.parentId ? (f.ownerId === ctx.user.id ? 'My files' : `${f.ownerName}'s files`) : f.name, f.id === d.folderId))}</select></label>` : ''}
    </div>`,
    async onSubmit(form) {
      const v = formData(form);
      const body = { title: v.title, description: v.description, tags: v.tags, status: v.status };
      if (manage) {
        body.classification = v.classification;
        if (v.folderId) body.folderId = v.folderId;
      }
      await api.put(`/api/docs/documents/${d.id}`, body);
      toast('Details saved.');
      reload();
    },
  });
}
