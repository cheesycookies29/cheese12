// Document circulation (Admin panel → System → Document circulation; also beside PDF Studio in ATLAS
// Tools, and under System in each app for the people who keep a module's forms): one table of every
// downloadable form of the modules this person keeps, with the current version (who uploaded it and
// when), a Versions list of the earlier ones (choosing one downloads it), and the actions: upload a
// new version, edit the details, restore a version, publish, retire or bring back, delete a draft.
// The pages call /api/forms/manage (server/forms.js).
import { api } from '../api.js';
import { html, mount, modal, toast, option, badge, fmtSize, fmtDateTime, confirmDialog, formData } from '../ui.js';
import { icon } from '../icons.js';
import { pageHead } from '../shell.js';
import { formsCss, kindOf } from '../forms.js';
import { sendInPieces } from '../documents/upload.js';

const STATUS_BADGE = { draft: 'amber', published: 'green', retired: 'gray' };
const request = (method, url, body) => (method === 'POST' ? api.post(url, body) : method === 'PUT' ? api.put(url, body) : api.del(url));
const when = (iso) => fmtDateTime(iso);
// Who a form is for, short: "Everyone in the module", or the first two account types and how many more
// (all of them on hover and for screen readers).
const versionUrl = (f, no) => `/api/forms/manage/${f.id}/versions/${no}/file`;
function download(url) {
  const a = Object.assign(document.createElement('a'), { href: url, download: '' });
  document.body.append(a);
  a.click();
  a.remove();
}

export async function formsAdminView(el, params, query) {
  formsCss();
  const state = { module: query.module || '', category: query.category || '', status: query.status || '', audience: query.audience || '', q: query.q || '' };
  let d;

  const load = async () => {
    d = await api.get('/api/forms/manage');
    draw();
  };
  const moduleOf = (id) => d.modules.find((m) => m.id === id);
  const roleName = (r) => d.roles.find((x) => x.id === r)?.label || r;
  const audienceShort = (f) => {
    if (!f.audience.length) return f.public ? '' : html`<span class="muted">—</span>`;
    if (f.audience.length === moduleOf(f.module)?.audience.length) return html`<small>Everyone in the module</small>`;
    const all = f.audience.map(roleName).join(', ');
    if (f.audience.length <= 3) return html`<small>${all}</small>`;
    return html`<small title="${all}" aria-label="${all}">${f.audience.slice(0, 2).map(roleName).join(', ')} <span class="muted">+${f.audience.length - 2} more</span></small>`;
  };
  const shown = () => d.forms.filter((f) => (!state.module || f.module === state.module)
    && (!state.category || f.category === state.category)
    && (!state.status || f.status === state.status)
    && (!state.audience || (state.audience === 'public' ? f.public : f.audience.includes(state.audience)))
    && (!state.q || `${f.title} ${f.code} ${f.category} ${f.description} ${f.current?.name || ''} ${f.current?.byName || ''}`.toLowerCase().includes(state.q.toLowerCase())));

  function draw() {
    const one = d.modules.length === 1 ? d.modules[0] : null;
    const total = d.forms.length;
    mount(el, html`
      ${pageHead('Document circulation', one
        ? `The forms and files ${one.name} gives its people to download. Upload a new version whenever a form changes: its users always get the latest, and the earlier ones stay here.`
        : 'Every form and file the systems give their people to download, in one place. Upload a new version whenever a form changes: users always get the latest, and the earlier ones stay here.',
      html`${d.canSettings ? html`<button type="button" class="btn" id="fm-settings">${icon('settings', 16)} Settings</button>` : ''}
        <button type="button" class="btn primary" id="fm-upload">${icon('upload', 16)} Upload a form</button>`)}
      <div class="stats fm-stats" aria-label="Forms per module">
        ${d.modules.map((m) => html`<button type="button" class="card fm-stat ${state.module === m.id ? 'accent' : ''}" data-module="${m.id}" aria-pressed="${state.module === m.id}">
          <small>${m.name}</small><strong>${m.counts.published}</strong> <span class="fm-stat-word">published</span>
          <span class="fm-stat-more muted small">${m.counts.draft} draft · ${m.counts.retired} retired</span></button>`)}
      </div>
      <section class="card">
        <form class="toolbar fm-filters" id="fm-filter">
          <input type="search" name="q" placeholder="Search title, form code, file, uploader…" value="${state.q}" aria-label="Search forms" />
          ${d.modules.length > 1 ? html`<select name="module" aria-label="Module">${option('', 'All modules', !state.module)}${d.modules.map((m) => option(m.id, m.name, state.module === m.id))}</select>` : ''}
          <select name="category" aria-label="Category">${option('', 'All categories', !state.category)}${[...new Set(d.forms.map((f) => f.category).filter(Boolean))].sort().map((c) => option(c, c, state.category === c))}</select>
          <select name="status" aria-label="Status">${[['', 'Any status'], ['published', 'Published'], ['draft', 'Draft'], ['retired', 'Retired']].map(([k, l]) => option(k, l, state.status === k))}</select>
          <select name="audience" aria-label="Who it is for">${option('', 'Anyone', !state.audience)}${option('public', 'Public (signed out)', state.audience === 'public')}${d.roles.map((r) => option(r.id, r.label, state.audience === r.id))}</select>
        </form>
        <div id="fm-list"></div>
      </section>
      <p class="muted small">${total} form${total === 1 ? '' : 's'}. Users see only the current version of published forms, on each system's <strong>Forms &amp; downloads</strong> page; public forms also on the sign-in page's <strong>Forms</strong>. Retired forms are hidden from users and kept here.</p>`);
    drawList();
    el.querySelector('#fm-upload').addEventListener('click', () => uploadForm());
    el.querySelector('#fm-settings')?.addEventListener('click', settingsDialog);
    el.querySelectorAll('[data-module]').forEach((b) => b.addEventListener('click', () => {
      state.module = state.module === b.dataset.module ? '' : b.dataset.module;
      draw();
    }));
    const form = el.querySelector('#fm-filter');
    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('change', (e) => {
      if (!e.target.name || e.target.name === 'q') return;
      state[e.target.name] = e.target.value;
      if (e.target.name === 'module') draw();
      else drawList();
    });
    form.querySelector('[name=q]').addEventListener('input', (e) => {
      state.q = e.target.value;
      drawList();
    });
  }

  function drawList() {
    const list = shown();
    const box = el.querySelector('#fm-list');
    if (!list.length) {
      return mount(box, html`<div class="empty">${icon('folder', 36)}<p>${d.forms.length ? 'No form matches these filters.' : 'No forms yet. Choose Upload a form to add the first one.'}</p></div>`);
    }
    mount(box, html`<div class="scroll-x"><table class="table fm-table">
      <thead><tr><th>Form</th><th>Module</th><th>Category</th><th>For</th><th>Status</th><th>Current version</th><th>Size</th><th>Versions</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${list.map((f) => html`<tr data-id="${f.id}">
        <td><strong>${f.title}</strong>${f.code ? html`<small class="block fm-code">${f.code}</small>` : ''}</td>
        <td>${f.moduleName}</td>
        <td>${f.category || html`<span class="muted">—</span>`}</td>
        <td class="fm-aud">${f.public ? html`${badge('Public', 'blue')} ` : ''}${audienceShort(f)}</td>
        <td>${badge(f.statusLabel, STATUS_BADGE[f.status])}</td>
        <td>${f.current ? html`<span class="fm-cur">${icon(kindOf(f.current.ext)[1], 15)} v${f.current.no}${f.current.restoredFrom ? html` <small class="muted">(from v${f.current.restoredFrom})</small>` : ''}</span>
          <small class="block"><strong>${f.current.byName}</strong> · ${when(f.current.at)}</small>${f.current.note ? html`<small class="block muted">${f.current.note}</small>` : ''}` : '—'}</td>
        <td class="nowrap">${f.current ? fmtSize(f.current.size) : '—'}</td>
        <td>${f.versions.length ? html`<span class="fm-ver-pick"><select class="fm-versions" data-versions="${f.id}" aria-label="Earlier versions of ${f.title} (${f.versions.length})">
            ${f.versions.map((v) => html`<option value="${v.no}">v${v.no} · ${when(v.at)} · ${v.byName}${v.note ? ` · ${v.note}` : ''}</option>`)}</select>
            <button type="button" class="btn sm" data-dlver="${f.id}" aria-label="Download the chosen earlier version of ${f.title}">${icon('download', 14)}<span class="fm-act-label">Download</span></button></span>`
          : html`<span class="muted small">None yet</span>`}</td>
        <td class="fm-actions"><button type="button" class="btn sm" data-act="version" data-id="${f.id}" title="Upload a new version" aria-label="Upload a new version of ${f.title}">${icon('upload', 14)}<span class="fm-act-label">New version</span></button>
          <details class="fm-more"><summary class="btn sm" title="More: edit, restore, publish or retire" aria-label="More for ${f.title}">${icon('chevronDown', 14)}<span class="fm-act-label">More</span></summary>
            <div class="menu-pop fm-menu" role="menu">
              <button type="button" role="menuitem" data-act="edit" data-id="${f.id}">${icon('edit')} Edit details</button>
              <button type="button" role="menuitem" data-act="download" data-id="${f.id}">${icon('download')} Download current version</button>
              ${f.versions.length ? html`<button type="button" role="menuitem" data-act="restore" data-id="${f.id}">${icon('undo')} Restore a version</button>` : ''}
              ${f.status === 'draft' ? html`<button type="button" role="menuitem" data-act="publish" data-id="${f.id}">${icon('checkCircle')} Publish</button>` : ''}
              ${f.status === 'published' ? html`<button type="button" role="menuitem" data-act="retire" data-id="${f.id}">${icon('eyeOff')} Retire</button>` : ''}
              ${f.status === 'retired' ? html`<button type="button" role="menuitem" data-act="unretire" data-id="${f.id}">${icon('eye')} Bring back</button>` : ''}
              ${f.deletable ? html`<button type="button" role="menuitem" class="danger-text" data-act="delete" data-id="${f.id}">${icon('trash')} Delete draft</button>` : ''}
            </div></details></td>
      </tr>`)}</tbody></table></div>`);
    // Choosing a version only chooses it (arrowing through the list downloads nothing); Download does.
    box.querySelectorAll('[data-dlver]').forEach((b) => b.addEventListener('click', () => {
      const s = box.querySelector(`[data-versions="${b.dataset.dlver}"]`);
      const f = d.forms.find((x) => x.id === b.dataset.dlver);
      if (!s?.value || !f) return;
      download(versionUrl(f, s.value));
      toast(`Downloading version ${s.value} of ${f.title}.`);
    }));
    // One "More" menu open at a time; a click elsewhere closes it.
    box.querySelectorAll('details.fm-more').forEach((dt) => dt.addEventListener('toggle', () => {
      if (dt.open) box.querySelectorAll('details.fm-more[open]').forEach((o) => o !== dt && (o.open = false));
    }));
    box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      b.closest('details')?.removeAttribute('open');
      act(b.dataset.act, d.forms.find((x) => x.id === b.dataset.id));
    }));
  }
  const closeMenus = (e) => {
    if (!e.target.closest?.('details.fm-more')) el.querySelectorAll('details.fm-more[open]').forEach((o) => (o.open = false));
  };
  document.addEventListener('click', closeMenus);

  async function act(what, f) {
    try {
      if (what === 'version') return uploadForm(f);
      if (what === 'edit') return detailsDialog(f);
      if (what === 'restore') return restoreDialog(f);
      if (what === 'download') return download(versionUrl(f, f.current.no));
      if (what === 'publish') {
        await api.post(`/api/forms/manage/${f.id}/publish`, {});
        toast(`${f.title} is published: its users can download it now.`);
      } else if (what === 'retire') {
        if (!(await confirmDialog(`Retire ${f.title}? It is hidden from users at once. It stays here with its versions, and you can bring it back.`, { confirmLabel: 'Retire', title: 'Retire this form' }))) return;
        await api.post(`/api/forms/manage/${f.id}/retire`, {});
        toast(`${f.title} is retired.`);
      } else if (what === 'unretire') {
        await api.post(`/api/forms/manage/${f.id}/unretire`, {});
        toast(`${f.title} is published again.`);
      } else if (what === 'delete') {
        if (!(await confirmDialog(`Delete the draft ${f.title} and its file${f.versionCount === 1 ? '' : 's'}? This cannot be undone.`, { confirmLabel: 'Delete draft' }))) return;
        await api.del(`/api/forms/manage/${f.id}`);
        toast(`${f.title} was deleted.`);
      }
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ----- Details: who the form is for depends on its module -----
  const audienceBoxes = (moduleId, chosen) => {
    const m = moduleOf(moduleId) || d.modules[0];
    return html`${m.audience.map((r) => html`<label class="check-row fm-check"><input type="checkbox" name="aud" value="${r.id}" ${chosen.includes(r.id) ? 'checked' : ''} /> <span>${r.label}</span></label>`)}`;
  };
  const detailFields = (f = null) => {
    const moduleId = f?.module || state.module || d.modules[0].id;
    const chosen = f ? f.audience : moduleOf(moduleId).audience.map((r) => r.id);
    return html`
      <label class="field"><span>Title</span><input name="title" maxlength="200" required value="${f?.title || ''}" placeholder="e.g. Leave application form" /></label>
      <div class="fm-pair">
        <label class="field"><span>Module</span><select name="module">${d.modules.map((m) => option(m.id, m.name, m.id === moduleId))}</select></label>
        <label class="field"><span>Category</span><input name="category" maxlength="60" list="fm-cats" value="${f?.category || ''}" placeholder="e.g. Leave, Enrollment, Procurement" /><datalist id="fm-cats">${d.categories.map((c) => html`<option value="${c}"></option>`)}</datalist></label>
      </div>
      <label class="field"><span>Form code / revision <span class="muted field-optional">(optional)</span></span><input name="code" maxlength="60" value="${f?.code || ''}" placeholder="e.g. HR-F-012 Rev. 3" /><span class="hint">As your school numbers its controlled forms. Shown with the title.</span></label>
      <label class="field"><span>Description <span class="muted field-optional">(optional)</span></span><textarea name="description" rows="2" maxlength="1000" placeholder="What it is for, and where to hand it in">${f?.description || ''}</textarea></label>
      <fieldset class="field fm-aud-field"><legend>Who may see and download it</legend>
        <div class="fm-checks" id="fm-aud">${audienceBoxes(moduleId, chosen)}</div>
        <label class="check-row fm-public"><input type="checkbox" name="public" ${f?.public ? 'checked' : ''} /> <span><strong>Public</strong>: anyone, signed out too (on the sign-in page's Forms), e.g. a blank application form.</span></label>
      </fieldset>`;
  };
  const wireDetails = (form) => {
    form.querySelector('[name=module]').addEventListener('change', (e) => mount(form.querySelector('#fm-aud'), audienceBoxes(e.target.value, moduleOf(e.target.value).audience.map((r) => r.id))));
  };
  const readDetails = (form) => {
    const v = formData(form);
    return { title: v.title, module: v.module, category: v.category, code: v.code, description: v.description, public: form.querySelector('[name=public]').checked, audience: [...form.querySelectorAll('[name=aud]:checked')].map((x) => x.value) };
  };

  // ----- Upload: a new form (f empty) or a new version of f -----
  function uploadForm(f = null) {
    const { form } = modal({
      title: f ? `New version of ${f.title}` : 'Upload a form',
      subtitle: f ? `Version ${f.versionCount + 1}. Users get it at once if the form is published; version ${f.current?.no || 1} stays in Versions.` : `PDF, Word, Excel, PowerPoint, OpenDocument, pictures or ZIP, up to ${d.settings.maxUploadMB} MB.`,
      wide: !f,
      submitLabel: f ? 'Upload version' : 'Upload',
      body: html`<div class="stack tight">
        <label class="field"><span>File</span><input type="file" name="file" accept="${d.accept}" required /><span class="hint">Programs, scripts, web pages, Office files with macros and password-protected files are never accepted.</span></label>
        ${f ? '' : detailFields()}
        <label class="field"><span>Change note <span class="muted field-optional">(optional)</span></span><input name="note" maxlength="300" placeholder="${f ? 'e.g. Signatories updated' : 'First version'}" /></label>
        ${f ? '' : html`<fieldset class="field"><legend>When users see it</legend>
          <label class="check-row"><input type="radio" name="status" value="draft" checked /> <span><strong>Keep as a draft</strong>: only the people who keep the forms see it; publish it later.</span></label>
          <label class="check-row"><input type="radio" name="status" value="published" /> <span><strong>Publish now</strong>: its users can download it at once.</span></label></fieldset>`}
        <p class="muted small" id="fm-progress" role="status" hidden></p>
      </div>`,
      async onSubmit(frm) {
        const file = frm.querySelector('[name=file]').files[0];
        if (!file) throw new Error('Choose the file to upload.');
        if (file.size > d.settings.maxUploadMB * 1024 * 1024) throw new Error(`${file.name} is larger than ${d.settings.maxUploadMB} MB, the most a form may be.`);
        const v = formData(frm);
        const finish = f ? { formId: f.id, note: v.note } : { ...readDetails(frm), note: v.note, status: v.status };
        if (!f && !finish.title) throw new Error('Give the form a title.');
        const progress = frm.querySelector('#fm-progress');
        progress.hidden = false;
        const row = await sendInPieces(file, { request, base: '/api/forms/manage/uploads', finish, onProgress: (p) => (progress.textContent = p < 1 ? `Uploading… ${Math.round(p * 100)}%` : 'Checking the file…') });
        toast(f ? `Version ${row.current.no} of ${row.title} uploaded.` : `${row.title} uploaded${row.status === 'published' ? ' and published' : ' as a draft'}.`);
        await load();
      },
    });
    if (!f) wireDetails(form);
    // The title from the file's name, until one is typed.
    const title = form.querySelector('[name=title]');
    form.querySelector('[name=file]').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (title && file && !title.value) title.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    });
  }

  function detailsDialog(f) {
    const { form } = modal({
      title: 'Edit details', subtitle: f.title, wide: true,
      body: html`<div class="stack tight">${detailFields(f)}</div>`,
      async onSubmit(frm) {
        await api.put(`/api/forms/manage/${f.id}`, readDetails(frm));
        toast('Details saved.');
        await load();
      },
    });
    wireDetails(form);
  }

  function restoreDialog(f) {
    modal({
      title: 'Restore a version', subtitle: f.title, submitLabel: 'Restore',
      body: html`<div class="stack tight">
        <p class="muted">The version you choose becomes current again as version ${f.versionCount + 1}, a copy of it. Nothing is removed: every version stays in the list.</p>
        <label class="field"><span>Version</span><select name="no">${f.versions.map((v, i) => option(v.no, `v${v.no} · ${when(v.at)} · ${v.byName}${v.note ? ` · ${v.note}` : ''}`, i === 0))}</select></label>
        <label class="field"><span>Change note <span class="muted field-optional">(optional)</span></span><input name="note" maxlength="300" placeholder="Restored from version …" /></label>
      </div>`,
      async onSubmit(frm) {
        const v = formData(frm);
        const row = await api.post(`/api/forms/manage/${f.id}/restore`, { no: Number(v.no), note: v.note });
        toast(`Version ${v.no} is current again, as version ${row.current.no}.`);
        await load();
      },
    });
  }

  function settingsDialog() {
    const s = d.settings;
    modal({
      title: 'Document circulation settings', subtitle: 'Also in the Settings center, with their history.',
      body: html`<div class="stack tight">
        <label class="field"><span>Largest file (MB)</span><input type="number" name="maxUploadMB" min="${s.range[0]}" max="${s.range[1]}" value="${s.maxUploadMB}" required /><span class="hint">${s.range[0]} to ${s.range[1]} MB. The default is 20.</span></label>
        <fieldset class="field"><legend>File types accepted</legend><div class="fm-checks">
          ${s.familyLabels.map((x) => html`<label class="check-row fm-check"><input type="checkbox" name="fam" value="${x.id}" ${s.families.includes(x.id) ? 'checked' : ''} /> <span>${x.label} <small class="muted">${x.exts.slice(0, 4).map((e) => `.${e}`).join(' ')}</small></span></label>`)}
        </div><span class="hint">Programs, scripts, web pages, Office files with macros and password-protected files are always refused.</span></fieldset>
      </div>`,
      async onSubmit(frm) {
        await api.put('/api/forms/settings', { maxUploadMB: Number(frm.querySelector('[name=maxUploadMB]').value), families: [...frm.querySelectorAll('[name=fam]:checked')].map((x) => x.value) });
        toast('Settings saved.');
        await load();
      },
    });
  }

  await load();
  return () => document.removeEventListener('click', closeMenus);
}
